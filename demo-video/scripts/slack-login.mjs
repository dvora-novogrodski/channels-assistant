// Opens a visible Chrome window with a dedicated profile so the user can sign in to Slack themselves.
// The window stays open until the user closes it; the session is kept in the profile for recording.
import path from 'path';
import { chromium } from 'playwright';

const ctx = await chromium.launchPersistentContext(path.resolve(import.meta.dirname, '../.slack-profile'), {
  headless: false,
  channel: 'chrome',
  viewport: null,
  args: ['--start-maximized'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://the-travel-agent.slack.com/');
console.log('Sign-in window open. Close it when you are signed in and see the Travel Assistant DM.');
await new Promise((resolve) => ctx.on('close', resolve));
console.log('Window closed, profile saved.');
