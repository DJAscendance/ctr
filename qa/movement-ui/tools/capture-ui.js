'use strict';

/*
 * Visual proof for the walk-speed UI placement.
 *
 * Takes one screenshot of a world page with the sidebar visible, and - when
 * asked - a second one with the walk-speed panel opened the way a citizen
 * opens it: a real right-click inside the 3D window, then the "Walk Speed"
 * entry X_ITE renders into its own context menu.
 *
 * The right-click is dispatched through Playwright's mouse rather than a
 * synthetic DOM event, so what the shot proves is the real pointer path.
 *
 *   CTR_QA_URL=http://localhost:8001 DISPLAY=:0 \
 *     node qa/movement-ui/tools/capture-ui.js <outDir> [placeSlug] [world]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace, URL } = require('../../phase2/lib/beta-client');

const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

const outDir = process.argv[2] || path.join('artifacts', 'movement-ui');
const placeSlug = process.argv[3] || 'mall';
const world = process.argv[4] || 'shopping.wrl';

/* The X_ITE menu lives in the browser element's shadow root, so it is not
 * reachable from document.querySelector. Every probe goes through the canvas. */
const MENU_PROBE = () => {
  const c = document.querySelector('#world x3d-canvas');
  if (!c || !c.shadowRoot) return null;
  const ul = c.shadowRoot.querySelector('.context-menu-root');
  if (!ul) return null;
  return Array.from(ul.querySelectorAll('li'))
    .map(li => (li.textContent || '').trim())
    .filter(Boolean);
};

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await login(ctx, USER, PASS);

  /* A fresh QA account has no chatdefault=1 preference, so login lands in the
   * 2D chat pane. Flip to 3D once - the same switch the b3dchat.gif sidebar
   * control drives - or #world stays display:none and never gets a canvas. */
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.$store.methods.setView3d(true);
  });

  await enterPlace(page, `#/place/${placeSlug}`, world);
  await page.waitForTimeout(3000);

  const sidebar = path.join(outDir, 'sidebar.png');
  await page.screenshot({ path: sidebar });
  process.stdout.write(`sidebar        ${sidebar}\n`);

  /* What the sidebar actually shows, so the shot is not the only evidence.
   * Scoped to what is LAID OUT and OUTSIDE #world: the panel is v-show'd, so
   * its inputs stay in the DOM while closed and a bare presence test would
   * report the defect as still there. */
  const sidebarSpeed = await page.evaluate(() => {
    const world = document.querySelector('#world');
    return Array.from(document.querySelectorAll('#movement-speed, #movement-speed-number'))
      .some(el => el.getBoundingClientRect().width > 0
        && !(world && world.contains(el))
        && !el.closest('.cls-walk-speed-panel'));
  });
  process.stdout.write(`sidebar speed  ${sidebarSpeed ? 'PRESENT (defect)' : 'absent'}\n`);

  /* Right-click inside the 3D window, at a point well clear of every edge. */
  const box = await page.locator('#world').boundingBox();
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.waitForTimeout(800);

  const items = await page.evaluate(MENU_PROBE);
  process.stdout.write(`menu items     ${items ? JSON.stringify(items) : 'NONE'}\n`);

  const menuShot = path.join(outDir, 'world-context-menu.png');
  await page.screenshot({ path: menuShot });
  process.stdout.write(`context menu   ${menuShot}\n`);

  /* Open the walk-speed entry when this build has one. */
  const opened = await page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c || !c.shadowRoot) return false;
    const li = Array.from(c.shadowRoot.querySelectorAll('.context-menu-root li'))
      .find(n => /walk speed/i.test(n.textContent || ''));
    if (!li) return false;
    li.click();
    return true;
  });
  process.stdout.write(`walk speed     ${opened ? 'opened' : 'NOT IN MENU'}\n`);

  if (opened) {
    await page.waitForTimeout(600);
    const panelShot = path.join(outDir, 'walk-speed-panel.png');
    await page.screenshot({ path: panelShot });
    process.stdout.write(`panel          ${panelShot}\n`);
  }

  await browser.close();
}

main().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
