'use strict';

/*
 * The Mall object preview, under X_ITE 16.2.0.
 *
 * ObjectProperties.vue is the only place in CTR that builds a second X_ITE
 * browser. It calls X3D.createBrowser() by hand, appends the canvas to
 * #objectModel, loads the empty assets/object/ObjectPreview.wrl, and then adds
 * the object's own file as a bare Inline root node three seconds later. That
 * makes it the one page where the two X_ITE 16 changes this migration ran into
 * can both bite at once: createBrowser() no longer fills its parent, so the
 * canvas falls back to 300x150 unless the sizing rule in index.scss applies to
 * #objectModel as well as to #world; and the page is a route, so it is
 * destroyed and rebuilt on every open and its listeners have to go with it.
 *
 * The previous pass could not run this gate because no object in the QA
 * database had a model file on disk. It now uses a QAFIX catalogue row - added
 * for QA, pointing at assets/object/1/5000exp.wrl, which ships in the repo and
 * carries a relative texture - so the normal preview path has something real to
 * load. No existing Mall inventory row is touched.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-object-preview.js <objectId> [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OBJECT_ID = process.argv[2];
const OUT_DIR = process.argv[3]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || null });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

/* The preview canvas, its scene, and the listener counts the teardown gate wants. */
const READ_PREVIEW = () => {
  const out = {
    container: !!document.querySelector('#objectModel'),
    canvasCount: document.querySelectorAll('#objectModel x3d-canvas').length,
    allCanvases: document.querySelectorAll('x3d-canvas').length,
    canvas: null,
    rootNodes: null,
    worldURL: null,
    census: null,
    censusTotal: null,
    inlineUrls: null,
    textureUrls: null,
    socketListeners: null,
  };
  const el = document.querySelector('#objectModel x3d-canvas');
  if (el) {
    const inner = (el.shadowRoot && el.shadowRoot.querySelector('canvas')) || el.querySelector('canvas');
    out.canvas = {
      hostWidth: el.clientWidth, hostHeight: el.clientHeight,
      drawWidth: inner ? inner.width : null, drawHeight: inner ? inner.height : null,
    };
    try {
      const a = window.__ctr;
      const browser = X3D.getBrowser(el);
      const scene = browser.currentScene;
      if (scene) {
        out.rootNodes = scene.rootNodes.length;
        out.worldURL = String(scene.worldURL);
        const c = a.census(scene);
        out.census = c.census;
        out.censusTotal = c.total;
        out.inlineUrls = a.findByType('Inline', scene)
          .map(n => ({ url: a.strings(a.field(n, 'url')), loaded: !!a.inlineScene(n) }));
        out.textureUrls = a.findByType('ImageTexture', scene)
          .map(n => a.strings(a.field(n, 'url'))).map(u => (u && u[0]) || null).filter(Boolean);
      }
    } catch (e) { out.error = String(e && e.message ? e.message : e); }
  }
  /* Socket listener totals, the same table the memory run watches. */
  try {
    let root = null;
    for (let node = document.querySelector('#app'); node; node = node.parentElement) {
      if (node.__vue__) { root = node.__vue__; break; }
    }
    const raw = root && root.$socket && root.$socket.socket ? root.$socket.socket : null;
    if (raw && raw._callbacks) {
      let total = 0;
      for (const key of Object.keys(raw._callbacks)) {
        total += Array.isArray(raw._callbacks[key]) ? raw._callbacks[key].length : 0;
      }
      out.socketListeners = total;
    }
  } catch (e) {}
  return out;
};

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

/*
 * Opens the object and switches to the model tab, which is what starts the
 * preview: loadObjectPreview only runs from changeACtive.
 */
async function openPreview(page, id) {
  await page.evaluate(i => { window.location.hash = `#/mall/object/${i}`; }, id);
  await page.waitForTimeout(5000);
  /*
   * The preview is behind one control: a <span> reading "HERE" inside the
   * sentence "Click HERE to view the object in 3D!", wired to changeACtive().
   * Nothing on the page says "model", so a search for that word finds nothing
   * and the run reports a missing preview for a page that simply was not asked
   * for one.
   */
  const clicked = await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('span, a, button'))) {
      if (el.children.length === 0 && /^\s*HERE\s*$/.test(el.textContent || '')) {
        el.click();
        return true;
      }
    }
    return false;
  });
  /* loadObjectPreview waits 100 ms, then loadObject waits a further 3000 ms. */
  await page.waitForTimeout(9000);
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return clicked;
}

async function main() {
  if (!OBJECT_ID) {
    console.error('usage: check-object-preview.js <objectId> [outDir]');
    process.exit(2);
  }
  fs.mkdirSync(path.join(OUT_DIR, 'screenshots'), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const failures = [];
  page.on('response', (r) => { if (r.status() >= 400) failures.push(`${r.url()} ${r.status()}`); });
  page.on('requestfailed', (r) => failures.push(`${r.url()} ${(r.failure() || {}).errorText}`));
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await login(page);
  const record = {};

  console.log(`\nObject preview (catalogue object ${OBJECT_ID})`);
  const clicked = await openPreview(page, OBJECT_ID);
  check('the model tab was found and opened', clicked);

  const first = await page.evaluate(READ_PREVIEW);
  record.first = first;
  check('the preview built one canvas in #objectModel', first.canvasCount === 1,
    `#objectModel canvases ${first.canvasCount}, total on page ${first.allCanvases}`);
  check('the preview loaded ObjectPreview.wrl', !!first.worldURL && /ObjectPreview\.wrl/.test(first.worldURL),
    first.worldURL);
  check('the object was added as a root Inline', first.rootNodes >= 1
    && first.inlineUrls && first.inlineUrls.length >= 1,
    `rootNodes ${first.rootNodes}, inline urls ${JSON.stringify((first.inlineUrls || []).map(i => i.url))}`);
  check('the object model loaded', first.inlineUrls && first.inlineUrls.every(i => i.loaded)
    && first.censusTotal > 10,
    `${first.censusTotal} nodes in the preview scene`);
  check('the object texture loaded', (first.textureUrls || []).length > 0,
    `textures ${JSON.stringify(first.textureUrls)}`);

  /*
   * The canvas gate. X3D.createBrowser() defaults to 300x150; the rule in
   * spa/src/assets/index.scss is what stops the preview shipping at that size.
   */
  const c = first.canvas || {};
  check('the preview canvas fills its container, not the 300x150 default',
    c.drawWidth > 300 && c.drawHeight > 150,
    `canvas ${c.drawWidth}x${c.drawHeight}, container ${c.hostWidth}x${c.hostHeight}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'object-preview.png') });

  /* --- mouse rotation --------------------------------------------------- */
  console.log('\nMouse rotation');
  const before = await page.evaluate(() => {
    const el = document.querySelector('#objectModel x3d-canvas');
    try {
      const p = X3D.getBrowser(el).viewpointPosition;
      const o = X3D.getBrowser(el).viewpointOrientation;
      return { position: p ? [p.x, p.y, p.z] : null, orientation: o ? [o.x, o.y, o.z, o.angle] : null };
    } catch (e) { return { error: String(e) }; }
  });
  const box = await page.locator('#objectModel x3d-canvas').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(box.x + box.width / 2 + step * 12, box.y + box.height / 2 + step * 2);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(1200);
  }
  const after = await page.evaluate(() => {
    const el = document.querySelector('#objectModel x3d-canvas');
    try {
      const p = X3D.getBrowser(el).viewpointPosition;
      const o = X3D.getBrowser(el).viewpointOrientation;
      return { position: p ? [p.x, p.y, p.z] : null, orientation: o ? [o.x, o.y, o.z, o.angle] : null };
    } catch (e) { return { error: String(e) }; }
  });
  record.rotation = { before, after, box: !!box };
  const moved = before.position && after.position
    ? Math.hypot(before.position[0] - after.position[0],
      before.position[1] - after.position[1],
      before.position[2] - after.position[2]) : null;
  const turned = before.orientation && after.orientation
    ? Math.abs(before.orientation[3] - after.orientation[3]) : null;
  check('dragging the mouse moved the preview camera',
    (moved !== null && moved > 0.01) || (turned !== null && turned > 0.01),
    `camera moved ${moved === null ? 'n/a' : moved.toFixed(4)}, turned ${turned === null ? 'n/a' : turned.toFixed(4)} rad`);
  await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'object-preview-rotated.png') });

  /* --- leave and reopen -------------------------------------------------- */
  console.log('\nLeave and reopen');
  await page.evaluate(() => { window.location.hash = '#/place/enter'; });
  await page.waitForTimeout(8000);
  const away = await page.evaluate(READ_PREVIEW);
  check('leaving the object removed the preview canvas', away.canvasCount === 0,
    `#objectModel canvases ${away.canvasCount}`);

  await openPreview(page, OBJECT_ID);
  const second = await page.evaluate(READ_PREVIEW);
  record.second = second;
  record.away = away;
  check('reopening builds the preview again', second.canvasCount === 1 && second.censusTotal > 10,
    `canvases ${second.canvasCount}, nodes ${second.censusTotal}`);
  check('reopening did not leave a second canvas behind', second.allCanvases <= 2,
    `canvases on the page ${second.allCanvases}`);
  check('the socket listener count did not grow across the round trip',
    first.socketListeners !== null && second.socketListeners !== null
      && second.socketListeners <= first.socketListeners,
    `${first.socketListeners} -> ${second.socketListeners}`);

  record.failures = failures;
  record.consoleErrors = consoleErrors;
  record.results = results;
  fs.writeFileSync(path.join(OUT_DIR, 'object-preview.json'), `${JSON.stringify(record, null, 2)}\n`);

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} object preview checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
