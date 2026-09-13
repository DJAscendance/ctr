'use strict';

/*
 * CTR_MOVEMENT_SPEED - real-GPU measurement of the new walk-speed system.
 *
 * Drives the real page exactly as a citizen would (arrow key held for a
 * fixed window, real X_ITE WalkViewer, real NavigationInfo), reads the
 * avatar's own ProximitySensor-fed position (WorldBrowserPage's
 * this.position) before and after, and reports measured units/s - never
 * "feels faster".
 *
 * Each speed is measured from a FRESH spawn: the world is left and re-entered
 * before every walk, via a real vue-router navigation to a bounce place and
 * back (re-requesting the same hash is a no-op in this app's router). Walking
 * cumulatively across five speeds from one spawn was tried first and produced
 * misleading near-zero results once a bounded world's avatar had already
 * walked into a wall or off a ledge from an earlier, slower measurement.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
 *   export NODE_PATH="/home/ryan/cybertownrevival/node_modules"
 *   CTR_QA_URL=http://127.0.0.1:8001 DISPLAY=:1 node qa/movement/tools/check-movement-speed.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace } = require('../../phase2/lib/beta-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2] || path.join(REPO, '..', '..', 'artifacts', 'movement-speed');
const USER = process.env.CTR_QA_USER || 'dev';
const PASS = process.env.CTR_QA_PASS || 'dev';
const HOLD_MS = Number(process.env.CTR_QA_HOLD_MS || 2500);
const SETTLE_MS = 200;

const BOUNCE = { hash: '#/place/enter', world: 'enter.wrl' };

const WORLDS = [
  { label: 'Plaza', hash: '#/place/enter', world: 'enter.wrl', bounce: { hash: '#/place/mall', world: 'shopping.wrl' } },
  { label: 'Mall', hash: '#/place/mall', world: 'shopping.wrl', bounce: BOUNCE },
  { label: 'Shop (Antique Shop)', hash: '#/place/antiqueshop', world: 'shop.wrl', bounce: BOUNCE },
  { label: 'Beach (large/outdoor)', hash: '#/place/beach', world: 'beach.wrl', bounce: BOUNCE },
  { label: 'Jail (small/narrow)', hash: '#/place/jail', world: 'jail.wrl', bounce: BOUNCE },
];

// #32 REQUIRED TEST VALUES: minimum, new default, one faster user setting, maximum.
const SPEEDS = [0.5, 2.5, 4, 6];

const results = [];
function record(entry) {
  results.push(entry);
  process.stdout.write(`${entry.world}  x${entry.multiplier}  dist=${entry.dist.toFixed(3)}  `
    + `units/s=${entry.unitsPerSecond.toFixed(3)}  dy=${entry.dy.toFixed(3)}  ${entry.note || ''}\n`);
}

async function position(page) {
  return page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    const find = c => {
      if (c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; }
      return null;
    };
    const view = find(app);
    return view && Array.isArray(view.position) ? view.position.slice() : null;
  });
}

async function setSpeed(page, value) {
  await page.evaluate(v => {
    const app = document.querySelector('#app').__vue__;
    app.$store.methods.setMovementSpeedMultiplier(v);
  }, value);
}

async function focusCanvas(page) {
  await page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (c) c.focus();
  });
}

async function freshEnter(page, w) {
  // Round-trip through the bounce place so the target is a genuinely NEW
  // navigation (re-requesting the same hash the citizen is already on is a
  // no-op in this router - see navigation-place.helper.ts's duplicate-abort
  // handling), which is what forces X_ITE to replaceWorld() and reset the
  // avatar to the world's authored spawn Viewpoint.
  await enterPlace(page, w.bounce.hash, w.bounce.world);
  await page.waitForTimeout(300);
  await enterPlace(page, w.hash, w.world);
  await page.waitForTimeout(500);
}

async function walkAndMeasure(page, w, multiplier) {
  await freshEnter(page, w);
  await setSpeed(page, multiplier);
  await focusCanvas(page);
  const before = await position(page);
  if (!before) { record({ world: w.label, multiplier, dist: 0, unitsPerSecond: 0, dy: 0, note: 'NO POSITION - SKIPPED' }); return; }
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(HOLD_MS);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(SETTLE_MS);
  const after = await position(page);
  const dx = after[0] - before[0];
  const dy = after[1] - before[1];
  const dz = after[2] - before[2];
  const dist = Math.sqrt(dx * dx + dz * dz); // horizontal distance; dy reported separately (gravity/collision sanity)
  record({
    world: `${w.label} (${w.world})`,
    multiplier,
    dist,
    unitsPerSecond: dist / (HOLD_MS / 1000),
    dy,
    before,
    after,
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const ctx = await browser.newContext();
  const page = await login(ctx, USER, PASS);
  // The account used here has no chatdefault=1 preference, so a fresh login
  // lands in the 2D chat pane - flip to 3D once, the same switch the
  // b3dchat.gif control in App.vue's sidebar drives.
  await page.evaluate(() => {
    document.querySelector('#app').__vue__.$store.methods.setView3d(true);
  });
  await enterPlace(page, BOUNCE.hash, BOUNCE.world);

  for (const w of WORLDS) {
    process.stdout.write(`\n=== ${w.label} ===\n`);
    for (const speed of SPEEDS) {
      try {
        await walkAndMeasure(page, w, speed);
      } catch (error) {
        record({ world: w.label, multiplier: speed, dist: 0, unitsPerSecond: 0, dy: 0, note: `FAILED: ${error.message}` });
      }
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.stdout.write(`\nwrote ${path.join(OUT_DIR, 'results.json')}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
