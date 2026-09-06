'use strict';

/*
 * Navigation, collision and gravity under X_ITE 16.2.0.
 *
 * These three are one measurement taken three ways, because all three are
 * statements about where the camera ends up after the avatar is driven:
 *
 *   navigation  the world binds a viewer at all, and a VRML97 world that names
 *               no navigation type gets WALK rather than X3D's EXAMINE - which
 *               is what vrml_nav_default.js restores.
 *   collision   walking into the world's geometry stops the avatar. The test is
 *               a comparison, not a threshold: the same key is held for the same
 *               time in the same world, once from a spot with something in front
 *               and once after turning around, and a world with working
 *               collision cannot produce the unobstructed distance in both.
 *   gravity     the camera settles at a stable height and stays there. A world
 *               with gravity off does not fall; a world with a broken floor
 *               falls without bound. Both are distinguished by watching the
 *               height settle rather than by reading a flag.
 *
 * Speed comes from the bound NavigationInfo, so the distance a clear walk should
 * cover is computed per world instead of assumed - the Plaza walks at 10 and the
 * Mall at 1, and a fixed expectation would fail one of them.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-navigation.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');

const WORLDS = [
  { key: 'plaza', label: 'Plaza', hash: '#/place/enter' },
  { key: 'mall', label: 'Mall', hash: '#/place/mall' },
  { key: 'club', label: 'Club', hash: `#/club/${process.env.CTR_QA_CLUB || '837'}` },
  { key: 'hitek', label: 'Hi-Tek', hash: '#/place/hitek_col' },
];

const WALK_MS = 6000;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || null });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

const FOCUS_CANVAS = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return false;
  canvas.setAttribute('tabindex', '0');
  canvas.focus();
  return document.activeElement === canvas;
};

const READ = () => {
  const a = window.__ctr;
  const browser = a.browser();
  const scene = a.scene();
  let camera = null;
  try { const p = browser.viewpointPosition; if (p) camera = [p.x, p.y, p.z]; } catch (e) {}
  const navs = a.findByType('NavigationInfo', scene);
  const nav = navs[0];
  let viewer = null;
  try { viewer = browser.getViewer ? browser.getViewer().constructor.name : null; } catch (e) {}
  return {
    camera,
    viewer,
    navCount: navs.length,
    type: nav ? a.strings(a.field(nav, 'type')) : null,
    speed: nav ? a.readScalar(nav, 'speed') : null,
    avatarSize: nav ? a.numbers(a.field(nav, 'avatarSize')) : null,
    collisions: a.findByType('Collision', scene).length,
    rootNodes: scene.rootNodes.length,
  };
};

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

async function enter(page, hash) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  let previous = -1;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(900);
    const roots = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return -1;
      try { const s = X3D.getBrowser(c).currentScene; return s ? s.rootNodes.length : -1; }
      catch (e) { return -1; }
    });
    if (roots > 0 && roots === previous) break;
    previous = roots;
  }
  await page.waitForTimeout(4000);
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return previous;
}

async function hold(page, key, ms) {
  let focused = false;
  for (let attempt = 0; attempt < 5 && !focused; attempt += 1) {
    focused = await page.evaluate(FOCUS_CANVAS);
    if (!focused) await page.waitForTimeout(600);
  }
  if (!focused) return false;
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(900);
  return true;
}

const flat = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : null);

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser({
    args: [
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await login(page);

  const record = {};
  /* The first world names WALK, so its viewer names the class the minifier gave
   * the walk viewer; every later world is compared against that name. */
  let walkViewerName = null;

  for (const world of WORLDS) {
    console.log(`\n${world.label}`);
    await enter(page, world.hash);
    const start = await page.evaluate(READ);
    if (walkViewerName === null) walkViewerName = start.viewer;

    check(`${world.key}: a viewer is bound`, !!start.viewer, `viewer ${start.viewer}`);
    check(`${world.key}: the world walks rather than examines`,
      start.viewer === walkViewerName,
      `type ${JSON.stringify(start.type)} (VRML97 omits it; vrml_nav_default supplies WALK),`
      + ` viewer ${start.viewer} vs walk viewer ${walkViewerName}`);

    /* --- gravity ------------------------------------------------------- */
    const heights = [];
    for (let sample = 0; sample < 8; sample += 1) {
      const state = await page.evaluate(READ);
      if (state.camera) heights.push(state.camera[1]);
      await page.waitForTimeout(800);
    }
    const settled = heights.slice(-4);
    const drift = settled.length ? Math.max(...settled) - Math.min(...settled) : null;
    const finalHeight = settled.length ? settled[settled.length - 1] : null;
    check(`${world.key}: the avatar stands on a floor and does not fall through`,
      drift !== null && drift < 0.05 && finalHeight !== null && finalHeight > -5,
      `height settled at ${finalHeight === null ? 'n/a' : finalHeight.toFixed(3)},`
      + ` drift over the last four samples ${drift === null ? 'n/a' : drift.toFixed(4)}`);

    /* --- collision ----------------------------------------------------- */
    const before = await page.evaluate(READ);
    const walkedForward = await hold(page, 'ArrowUp', WALK_MS);
    const afterForward = await page.evaluate(READ);
    /* Turn right around and walk the same amount the other way. */
    await hold(page, 'ArrowLeft', 2600);
    await hold(page, 'ArrowLeft', 2600);
    const beforeBack = await page.evaluate(READ);
    await hold(page, 'ArrowUp', WALK_MS);
    const afterBack = await page.evaluate(READ);

    const outward = flat(before.camera, afterForward.camera);
    const back = flat(beforeBack.camera, afterBack.camera);
    const clear = (start.speed || 1) * (WALK_MS / 1000);
    record[world.key] = { start, before, afterForward, beforeBack, afterBack, outward, back, clear, heights };

    check(`${world.key}: holding the key moves the avatar`, walkedForward && (outward > 0.2 || back > 0.2),
      `forward ${outward === null ? 'n/a' : outward.toFixed(2)} m,`
      + ` reversed ${back === null ? 'n/a' : back.toFixed(2)} m,`
      + ` unobstructed would be about ${clear.toFixed(1)} m at speed ${start.speed}`);
    check(`${world.key}: geometry stops the avatar in at least one direction`,
      outward !== null && back !== null && Math.min(outward, back) < clear * 0.9,
      `shorter walk ${Math.min(outward, back).toFixed(2)} m against an unobstructed ${clear.toFixed(1)} m;`
      + ` ${start.collisions} Collision node(s) in the scene`);
    check(`${world.key}: the avatar did not fall out of the world while walking`,
      afterBack.camera && afterBack.camera[1] > -20,
      `height after walking ${afterBack.camera && afterBack.camera[1].toFixed(2)}`);
  }

  record.results = results;
  fs.writeFileSync(path.join(OUT_DIR, 'navigation.json'), `${JSON.stringify(record, null, 2)}\n`);
  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} navigation checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
