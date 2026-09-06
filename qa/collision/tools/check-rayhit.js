'use strict';

/*
 * The ray-cast gate for the restored object-move collision toggle.
 *
 * `Browser.computeRayHit` is a blaxxun Contact call with no X_ITE 16.2.0
 * equivalent, so `spa/src/libs/x_ite_mods/bxx_rayhit.js` reimplements it. Two
 * pieces of restored content depend on it and neither fails loudly when it is
 * wrong: the VWP 5.1 collision checkbox silently stops blocking, and the
 * Outlands Turret Script silently fails to find its siblings. This ruler is
 * what makes either failure visible.
 *
 * It asserts the properties the callers actually rely on rather than exact
 * coordinates, because the coordinates belong to the world file and would make
 * the gate a copy of the content instead of a test of the engine:
 *
 *   - a ray fired at the ground from above it hits something;
 *   - a ray fired away from the world, into empty sky, hits nothing;
 *   - a hit carries a `hitPath` whose first entry is a scene root node, which
 *     is the shape the Turret's `hitPath[0].children` walk depends on;
 *   - a zero-length ray hits nothing, so a drag that has not moved cannot
 *     block itself;
 *   - a node named in setRayHitIgnore does not register a hit, which is what
 *     stops a moving object colliding with its own geometry.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/collision/tools/check-rayhit.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'collision');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(900);
    const roots = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return -1;
      try { const s = X3D.getBrowser(c).currentScene; return s ? s.rootNodes.length : -1; } catch (e) { return -1; }
    });
    if (roots > 0 && roots === previous) break;
    previous = roots;
  }
  await page.waitForTimeout(3000);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await login(page);
  await enter(page, '#/place/enter');

  const probe = await page.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (!canvas) return { error: 'no canvas' };
    const b = X3D.getBrowser(canvas);
    const out = { version: b.getVersion(), installed: typeof b.computeRayHit === 'function' };
    if (!out.installed) return out;

    const V = (x, y, z) => new X3D.SFVec3f(x, y, z);
    const shape = h => (h ? {
      hasPath: Array.isArray(h.hitPath),
      pathLength: Array.isArray(h.hitPath) ? h.hitPath.length : -1,
      firstIsRoot: Array.isArray(h.hitPath) && h.hitPath.length > 0
        && b.currentScene.rootNodes.indexOf(h.hitPath[0]) >= 0,
      firstHasChildren: (() => {
        try { return !!h.hitPath[0].getField('children'); } catch (e) { return false; }
      })(),
    } : null);

    /* Straight down through the world, the cast the Outlands Turret makes. */
    const t0 = performance.now();
    const down = b.computeRayHit(V(0, 1000, 0), V(0, -1000, 0));
    out.downMs = Math.round(performance.now() - t0);
    out.down = !!down;
    out.downShape = shape(down);

    /* Far outside the world, well above anything it contains. */
    out.sky = !!b.computeRayHit(V(9000, 9000, 9000), V(9600, 9600, 9600));

    /* A step of no length cannot be blocked. */
    out.zero = !!b.computeRayHit(V(0, 5, 0), V(0, 5, 0));

    /* Ignoring the thing that was hit must turn the hit off again. */
    if (down && down.hitPath && down.hitPath.length) {
      const target = down.hitPath[0];
      b.setRayHitIgnore([target]);
      const again = b.computeRayHit(V(0, 1000, 0), V(0, -1000, 0));
      b.setRayHitIgnore(null);
      out.ignoreWorks = !again || (again.hitPath && again.hitPath[0] !== target);
    }
    return out;
  });

  if (probe.error) {
    check('plaza renders a canvas', false, probe);
  } else {
    check('engine is X_ITE 16.2.0', probe.version === '16.2.0', probe.version);
    check('computeRayHit is installed', probe.installed);
    check('ray through the world hits geometry', probe.down === true);
    check('hit carries a hitPath', probe.downShape && probe.downShape.hasPath);
    check('hitPath[0] is a scene root node', probe.downShape && probe.downShape.firstIsRoot);
    check('hitPath[0] exposes children', probe.downShape && probe.downShape.firstHasChildren);
    check('ray into empty space misses', probe.sky === false);
    check('zero-length ray misses', probe.zero === false);
    check('setRayHitIgnore suppresses the hit', probe.ignoreWorks === true);
    check('cast completes inside one frame budget', probe.downMs !== undefined && probe.downMs < 400, `${probe.downMs}ms`);
  }

  await page.screenshot({ path: path.join(OUT_DIR, 'rayhit-plaza.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'rayhit.json'),
    JSON.stringify({ probe, results }, null, 2));

  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
