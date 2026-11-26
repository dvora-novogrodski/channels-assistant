// Opens the Slack web client with the signed-in profile created by `npm run login:slack`.
import path from 'path';
import { chromium } from 'playwright';
import { CURSOR_SCRIPT } from './actions.mjs';

export const SLACK_WORKSPACE_URL = process.env.SLACK_WORKSPACE_URL ?? 'https://app.slack.com/client';
export const PROFILE_DIR = path.resolve(import.meta.dirname, '../../.slack-profile');

// Headless Chrome announces itself as "HeadlessChrome", which Slack rejects; report the installed version instead.
async function desktopChromeUserAgent() {
  const browser = await chromium.launch({ channel: 'chrome' });
  const major = browser.version().split('.')[0];
  await browser.close();
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export async function openSlack({ headless = true } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    channel: 'chrome',
    viewport: { width: 1920, height: 1080 },
    userAgent: await desktopChromeUserAgent(),
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30000);
  return { context, page };
}
