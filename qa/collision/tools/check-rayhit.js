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

  /*
   * The narrow-phase fixture pass. Synthetic geometry is created inside the
   * live scene, far above the world (y 4000..4100), so every assertion below
   * is about the triangle reader, the transform chain and the hit ordering -
   * not about the world file. Each fixture would have failed under one of the
   * two historical faults: the single-form typeName() that never recognised a
   * geometry read out of a field, and the getValue() reader that saw X_ITE's
   * flat internal storage and turned every vertex into the origin.
   */
  const fixture = await page.evaluate(async () => {
    const canvas = document.querySelector('#world x3d-canvas');
    const b = X3D.getBrowser(canvas);
    const scene = b.currentScene;
    const V = (x, y, z) => new X3D.SFVec3f(x, y, z);
    const out = {};
    const added = [];

    function plate(cx, cy, cz, half) {
      const coord = scene.createNode('Coordinate');
      coord.point = new X3D.MFVec3f(
        V(cx - half, cy - half, cz), V(cx + half, cy - half, cz),
        V(cx + half, cy + half, cz), V(cx - half, cy + half, cz),
      );
      const ifs = scene.createNode('IndexedFaceSet');
      ifs.coord = coord;
      ifs.coordIndex = new X3D.MFInt32(0, 1, 2, 3, -1);
      const shape = scene.createNode('Shape');
      shape.geometry = ifs;
      /* A node created at runtime reports a 0-size bbox until it has been
       * rendered once; these lanes sit far off screen, so the broad phase
       * would skip them. An explicit bbox is part of the Shape contract and
       * keeps the fixture independent of the render loop. */
      shape.bboxCenter = V(cx, cy, cz);
      shape.bboxSize = V(2 * half, 2 * half, 0.02);
      return shape;
    }
    function root(node) {
      const g = scene.createNode('Transform');
      g.children = new X3D.MFNode(node);
      scene.addRootNode(g);
      added.push(g);
      return g;
    }
    function hit(sx, sy, sz, ex, ey, ez) {
      return b.computeRayHit(V(sx, sy, sz), V(ex, ey, ez));
    }
    function near(p, x, y, z) {
      return p && Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01
        && Math.abs(p.z - z) < 0.01;
    }
    function lastOf(h) { return h && h.hitPath ? h.hitPath[h.hitPath.length - 1] : null; }

    try {
      /* Build every lane first; the casts come after one settle, because a
       * node created at runtime keeps a stale bbox until the next update
       * tick and the broad phase would skip it. */

      /* Lane 4000: nested Transforms with translation, rotation and scale.
       * A unit plate at local z -1 under scale 2 and a +90-degree yaw sits in
       * world at x 8, facing +X. A ray fired along +X must strike it at
       * exactly (8, 4000, 0). Under the old reader this lane could not hit at
       * all; with a broken transform chain it hits at the wrong point. */
      const inner = scene.createNode('Transform');
      inner.translation = V(0, 0, -1);
      inner.children = new X3D.MFNode(plate(0, 0, 0, 1));
      const outer = scene.createNode('Transform');
      outer.translation = V(10, 4000, 0);
      outer.rotation = new X3D.SFRotation(0, 1, 0, Math.PI / 2);
      outer.scale = V(2, 2, 2);
      outer.children = new X3D.MFNode(inner);
      scene.addRootNode(outer);
      added.push(outer);

      /* Lane 4020: two solids on one ray; the front one must win. */
      const nearPlate = root(plate(0, 4020, -5, 2));
      root(plate(0, 4020, -10, 2));

      /* Lane 4040: one Shape whose two small plates sit 50 m apart, so its
       * bounding box spans the gap. A ray crossing the empty middle of that
       * box must miss - this is what the narrow phase adds over boxes. */
      const wideCoord = scene.createNode('Coordinate');
      wideCoord.point = new X3D.MFVec3f(
        V(-51, 4039, 0), V(-49, 4039, 0), V(-49, 4041, 0), V(-51, 4041, 0),
        V(49, 4039, 0), V(51, 4039, 0), V(51, 4041, 0), V(49, 4041, 0),
      );
      const wideIfs = scene.createNode('IndexedFaceSet');
      wideIfs.coord = wideCoord;
      wideIfs.coordIndex = new X3D.MFInt32(0, 1, 2, 3, -1, 4, 5, 6, 7, -1);
      const wideShape = scene.createNode('Shape');
      wideShape.geometry = wideIfs;
      wideShape.bboxCenter = V(0, 4040, 0);
      wideShape.bboxSize = V(102, 2, 0.02);
      root(wideShape);

      /* Lane 4060: a box-only fallback (Sphere primitive) in front of a
       * triangle plate. Both distances are fractions of the same segment, so
       * the sphere's box entry at 0.15 must beat the plate's 0.6. Under the
       * old mixed scale the two were measured in different units and the
       * winner was arbitrary. */
      const sphere = scene.createNode('Sphere');
      const sShape = scene.createNode('Shape');
      sShape.geometry = sphere;
      const sT = scene.createNode('Transform');
      sT.translation = V(0, 4060, -4);
      sT.children = new X3D.MFNode(sShape);
      scene.addRootNode(sT);
      added.push(sT);
      root(plate(0, 4060, -12, 2));

      /* And the converse: a plate in front of the sphere's box must win. */
      const sT2 = scene.createNode('Transform');
      sT2.translation = V(0, 4080, -10);
      const sShape2 = scene.createNode('Shape');
      sShape2.geometry = scene.createNode('Sphere');
      sT2.children = new X3D.MFNode(sShape2);
      scene.addRootNode(sT2);
      added.push(sT2);
      const frontPlate = root(plate(0, 4080, -3, 2));

      /* Lane 4100: the plate approached from behind. VRML walls are routinely
       * one-sided; the placement contract counts back faces. */
      root(plate(0, 4100, 0, 2));

      await new Promise(resolve => setTimeout(resolve, 1500));

      const tHit = hit(4, 4000, 0, 12, 4000, 0);
      out.transformHit = !!tHit;
      out.transformPoint = tHit ? [tHit.hitPoint.x, tHit.hitPoint.y, tHit.hitPoint.z] : null;
      out.transformOk = !!tHit && near(tHit.hitPoint, 8, 4000, 0);
      /* The same ray fired past the plate's edge (the un-rotated position)
       * must miss, or the rotation was never applied. */
      out.transformMissOk = !hit(4, 4000, 5, 12, 4000, 5);

      const nHit = hit(0, 4020, 0, 0, 4020, -20);
      out.nearestOk = !!nHit && lastOf(nHit) !== null
        && nHit.hitPath.indexOf(nearPlate) >= 0 && near(nHit.hitPoint, 0, 4020, -5);

      out.falsePositiveOk = !hit(0, 4040, 10, 0, 4040, -10);
      out.falsePositiveControl = !!hit(50, 4040, 10, 50, 4040, -10);

      const mHit = hit(0, 4060, 0, 0, 4060, -20);
      out.mixedScaleOk = !!mHit && mHit.hitPath.indexOf(sT) >= 0;
      const mHit2 = hit(0, 4080, 0, 0, 4080, -20);
      out.mixedScaleFrontOk = !!mHit2 && mHit2.hitPath.indexOf(frontPlate) >= 0;

      out.backFaceOk = !!hit(0, 4100, -5, 0, 4100, 5);
    } catch (err) {
      out.error = String(err && err.message || err);
    } finally {
      for (const node of added) {
        try { scene.removeRootNode(node); } catch (e) { /* leave it */ }
      }
    }
    return out;
  });

  if (fixture.error) {
    check('narrow-phase fixture pass runs', false, fixture.error);
  } else {
    check('triangle hit lands on a nested, rotated, scaled plate',
      fixture.transformOk === true, fixture.transformPoint);
    check('rotation is really applied (offset ray misses)', fixture.transformMissOk === true);
    check('nearest of two solids wins', fixture.nearestOk === true);
    check('ray inside a large box but off its triangles misses', fixture.falsePositiveOk === true);
    check('the same box hit on its triangles still hits', fixture.falsePositiveControl === true);
    check('box-only hit in front outranks triangle hit behind', fixture.mixedScaleOk === true);
    check('triangle hit in front outranks box-only hit behind', fixture.mixedScaleFrontOk === true);
    check('a back face still counts', fixture.backFaceOk === true);
  }

  await page.screenshot({ path: path.join(OUT_DIR, 'rayhit-plaza.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'rayhit.json'),
    JSON.stringify({ probe, fixture, results }, null, 2));

  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
