// Human-looking browser actions for recordings: a visible cursor, smooth mouse moves and natural typing.
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const CURSOR_SCRIPT = `(() => {
  const mk = () => {
    if (document.getElementById('__cur') || !document.body) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;';
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg"><path d="M5 3 L5 22 L10.2 17.4 L13.6 25 L16.8 23.6 L13.5 16.2 L20.5 16.2 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
  };
  document.addEventListener('DOMContentLoaded', mk); mk();
  document.addEventListener('mousemove', (e) => { mk(); const c = document.getElementById('__cur'); if (c) c.style.transform = 'translate(' + (e.clientX - 5) + 'px,' + (e.clientY - 3) + 'px)'; }, true);
})();`;

export function createActions(page) {
  async function moveTo(locator) {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  }

  async function click(locator) {
    await locator.scrollIntoViewIfNeeded();
    await moveTo(locator);
    await sleep(250);
    await locator.click();
  }

  async function type(text) {
    await page.keyboard.type(text, { delay: 28 });
  }

  return { moveTo, click, type };
}
