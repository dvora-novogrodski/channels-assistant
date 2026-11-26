// Records the web flow on the live site into recordings/web and a second, separate user into recordings/isolation.
// Every step is marked; scripts/build.mjs uses the marks for pacing, cuts and captions.
import path from 'path';
import { chromium } from 'playwright';
import { CURSOR_SCRIPT, createActions, sleep } from './lib/actions.mjs';
import { startRecording } from './lib/recorder.mjs';

const BASE = process.env.DEMO_URL ?? 'https://travel-assistant-caod.onrender.com';
const RECORDINGS = path.resolve(import.meta.dirname, '../recordings');
const VIEWPORT = { width: 1920, height: 1080 };

const browser = await chromium.launch({ headless: true, channel: 'chrome' });

async function openFreshUser() {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  return { context, page };
}

// ---------- main flow ----------
const { context, page } = await openFreshUser();
await page.goto(BASE);
await page.getByText('Where would you like to go?').waitFor({ timeout: 120000 });
await page.mouse.move(1100, 600);

const recording = await startRecording(page, path.join(RECORDINGS, 'web'));
const { mark } = recording;
const { moveTo, click, type } = createActions(page);

const composer = () => page.getByRole('textbox', { name: 'Message' });
const thinking = () => page.getByText('Planning your trip…');
const retryButtons = () => page.getByRole('button', { name: 'Try again' });

async function waitForReply({ retryOnError, errorsBefore }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await thinking().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await thinking().waitFor({ state: 'hidden', timeout: 180000 });
    await sleep(600);
    const isNewError = (await retryButtons().count()) > errorsBefore;
    if (!retryOnError || !isNewError) return;
    mark('retry-after-error');
    await click(retryButtons().last());
  }
  throw new Error('The assistant did not answer after several retries');
}

async function send(text, label, { retryOnError = true } = {}) {
  await click(composer());
  await type(text);
  await sleep(400);
  const errorsBefore = await retryButtons().count();
  mark(`send:${label}`);
  await page.keyboard.press('Enter');
  await waitForReply({ retryOnError, errorsBefore });
  mark(`reply:${label}`);
  await sleep(2500);
}

mark('home');
await sleep(3000);

await send('I live in Tel Aviv and travel with my partner. Somewhere romantic with beaches in May?', 'search');
const planButton = page.getByText('Plan this trip →').first();
if (await planButton.isVisible().catch(() => false)) {
  await planButton.scrollIntoViewIfNeeded();
  await moveTo(planButton);
  mark('cards');
  await sleep(3500);
}

await send('What should I pack for the first one?', 'followup');

await send('Book it for 5 nights from May 10 next year with the nicer hotel and the cheapest flight', 'book');
if (!(await page.getByRole('button', { name: /Confirm & pay/ }).isVisible().catch(() => false))) {
  await send('Yes, please prepare that trip with the cheapest flight from TLV', 'book-clarify');
}
const card = page.locator('[aria-label="Trip proposal"]').last();
await card.scrollIntoViewIfNeeded();
mark('proposal');
await sleep(3500);

try {
  await click(card.locator('input[aria-label="Pay with"]'));
  await sleep(700);
  await click(page.getByRole('option', { name: /Mastercard/ }));
  mark('card-selected');
  await sleep(1200);
} catch (error) {
  console.log('Card selection skipped:', error.message.split('\n')[0]);
  await page.keyboard.press('Escape').catch(() => {});
}

await click(card.getByRole('button', { name: /Confirm & pay/ }));
mark('booking-progress');
const ticketsHeading = page.getByText('Your tickets', { exact: true }).last();
await ticketsHeading.waitFor({ timeout: 30000 });
mark('booked');
await ticketsHeading.scrollIntoViewIfNeeded();
await sleep(4000);
await page.getByText('Have a great trip!').last().scrollIntoViewIfNeeded().catch(() => {});
mark('confirmation');
await sleep(3500);

await send('simulate failure', 'failure', { retryOnError: false });
mark('failure-shown');
await sleep(3000);
await send('What have I booked so far?', 'recovery');
mark('end');
console.log(await recording.stop());
await context.close();

// ---------- isolation: a second user has an empty history ----------
const second = await openFreshUser();
await second.page.goto(BASE);
await second.page.getByText('Where would you like to go?').waitFor({ timeout: 120000 });
const isolation = await startRecording(second.page, path.join(RECORDINGS, 'isolation'));
isolation.mark('start');
await sleep(4500);
isolation.mark('end');
console.log(await isolation.stop());
await second.context.close();

await browser.close();
