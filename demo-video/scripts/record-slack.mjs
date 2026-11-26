// Records the Slack flow in the Travel Assistant DM into recordings/slack.
// Needs the signed-in profile from `npm run login:slack`. Only the conversation pane is used in the video:
// the crop box (below the channel header, excluding the sidebar) is saved with the timeline.
import path from 'path';
import { createActions, sleep } from './lib/actions.mjs';
import { startRecording } from './lib/recorder.mjs';
import { openSlack } from './lib/slack-session.mjs';

const DM_URL = process.env.SLACK_DM_URL ?? 'https://app.slack.com/client/T0CLAN1PZ8E/D0CLTPUBX5K';
const RECORDINGS = path.resolve(import.meta.dirname, '../recordings');

const { context, page } = await openSlack();
await page.goto(DM_URL);
const composer = page.locator('[data-qa="message_input"]').first();
await composer.waitFor({ timeout: 60000 });
await sleep(3000);
await page.getByRole('button', { name: /close/i }).last().click({ timeout: 2000 }).catch(() => {});

const crop = await page.evaluate(() => {
  const pane = document.querySelector('[data-qa="message_pane"]').getBoundingClientRect();
  const input = document.querySelector('[data-qa="message_input"]').getBoundingClientRect();
  const top = pane.top + 4;
  const bottom = Math.min(window.innerHeight, input.bottom + 64);
  return { x: Math.round(pane.left), y: Math.round(top), width: Math.round(pane.width), height: Math.round(bottom - top) };
});
console.log('crop', crop);

await page.mouse.move(crop.x + crop.width / 2, crop.y + crop.height / 2);
const recording = await startRecording(page, path.join(RECORDINGS, 'slack'));
const { mark } = recording;
const { moveTo, click, type } = createActions(page);
const placeholder = () => page.getByText('Planning your trip…').last();

async function waitForBot() {
  await placeholder().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await placeholder().waitFor({ state: 'hidden', timeout: 180000 });
  await sleep(1500);
}

async function send(text, label, { expectReply = true } = {}) {
  await click(composer);
  await type(text);
  await sleep(400);
  mark(`send:${label}`);
  await page.keyboard.press('Enter');
  if (expectReply) await waitForBot();
  else await sleep(2500);
  mark(`reply:${label}`);
  await sleep(2000);
}

const lastButton = (name) => page.getByRole('button', { name }).last();

mark('start');
await send('new trip', 'new-trip', { expectReply: false });
await send('Somewhere warm with beaches in February for 2 people, flying from TLV', 'search');
mark('cards');
await sleep(2500);

await click(lastButton(/^Plan this trip$/).first());
mark('send:plan');
await waitForBot();
mark('reply:plan');
await sleep(2000);

const confirmButton = lastButton(/Confirm & pay/);
if (!(await confirmButton.isVisible().catch(() => false))) {
  await send('5 nights from February 10 2027 with the cheapest flight, please prepare it', 'book');
}
await confirmButton.waitFor({ timeout: 60000 });
await moveTo(confirmButton);
mark('proposal');
await sleep(3500);

// Earlier trips in the DM also show these texts, so wait for one more occurrence than before the click.
async function waitForNewOccurrence(text, countBefore, timeout) {
  const deadline = Date.now() + timeout;
  while ((await page.getByText(text).count()) <= countBefore && Date.now() < deadline) await sleep(250);
}
const ticketsBefore = await page.getByText('Your tickets').count();
const bookedBefore = await page.getByText('Trip booked:').count();
await click(confirmButton);
mark('booking-progress');
await waitForNewOccurrence('Your tickets', ticketsBefore, 60000);
mark('booked');
await sleep(3000);
await waitForNewOccurrence('Trip booked:', bookedBefore, 30000);
await sleep(4500);
mark('end');

console.log(await recording.stop({ crop }));
await context.close();
