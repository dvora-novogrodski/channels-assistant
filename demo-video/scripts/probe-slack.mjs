// Diagnostic: opens the Travel Assistant DM and reports the layout used for cropping.
import path from 'path';
import { openSlack, SLACK_WORKSPACE_URL } from './lib/slack-session.mjs';

const { context, page } = await openSlack();
await page.goto(SLACK_WORKSPACE_URL);
await page.waitForTimeout(12000);
console.log('url:', page.url());

const dm = page.getByRole('treeitem', { name: /Travel Assistant/ }).first();
if (await dm.isVisible().catch(() => false)) {
  await dm.click();
  await page.waitForTimeout(5000);
}
const report = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  return {
    title: document.title,
    messagePane: box('[data-qa="message_pane"]'),
    primaryView: box('.p-workspace__primary_view'),
    primaryContents: box('.p-workspace__primary_view_contents'),
    footer: box('.p-workspace__primary_view_footer'),
    composer: box('[data-qa="message_input"]'),
    header: box('.p-view_header'),
  };
});
console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: path.resolve(import.meta.dirname, '../recordings/slack-probe.png') });
await context.close();
