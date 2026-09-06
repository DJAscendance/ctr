'use strict';

/*
 * The object placement collision gate.
 *
 * VWP 5.1's object-move HUD carried a collision checkbox
 * (commserv/community/home/vrml/sharedobject.wrl, 8 November 2001). The
 * contract it restored into spa/assets/externprotos/shared_xite.wrl is small
 * and this gate holds it to exactly that size:
 *
 *   collision is on by default
 *   the setting is one Script field on one PROTO instance
 *   it is never persisted, and never shared with another object
 *   each movement step casts a ray along the step
 *   any hit refuses the step
 *   walls, floors and other placed objects are not told apart
 *   there is no snap-to-floor and no object-versus-avatar test
 *
 * The object being moved is excluded from its own cast, so a refused step
 * means the step met something else.
 *
 * Only the disposable QAFIX objects are touched, and only through the Script's
 * movement eventIns. `set_done` is never sent, so nothing is written back: a
 * reload restores the object, and the placement contract is re-run afterwards
 * to prove it.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/collision/tools/check-object-collision.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { SCENE_ACCESS_SOURCE } = require('../../final-gate/lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'collision');

/* The Plaza is the densest world CTR serves and the one the QAFIX objects sit
 * in, so a long step through it is certain to meet geometry. */
const PLACE = 'enter';
/* How far down the object is asked to travel. Down is used because the floor
 * is the one piece of solid geometry every world is guaranteed to have. */
const DROP = -60;

const results = [];
const record = {};
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

async function enterPlace(page, slug) {
  await page.evaluate(s => { window.location.hash = '#/citymap'; }, slug);
  await page.waitForTimeout(1200);
  await page.evaluate(s => { window.location.hash = `#/place/${s}`; }, slug);
  for (let attempt = 0; attempt < 28; attempt += 1) {
    await page.waitForTimeout(900);
    const ready = await page.evaluate(() => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c) return false;
      try {
        const scene = X3D.getBrowser(c).currentScene;
        return Array.from(scene.rootNodes)
          .some(n => n && n.getNodeTypeName && n.getNodeTypeName() === 'SharedObject');
      } catch (e) { return false; }
    });
    if (ready) break;
  }
  /* the objects arrive after the world, on the externproto delay */
  await page.waitForTimeout(4000);
  await page.evaluate(SCENE_ACCESS_SOURCE);
}

/*
 * Drive one QAFIX object's movement Script and report where it ended up.
 *
 * `turnOff` sends the historical checkbox event first, which is the only way
 * the setting is ever changed. Nothing else about the run differs, so the two
 * runs ask for exactly the same movement.
 */
function moveRun(page, spec) {
  return page.evaluate(async cfg => {
    const api = window.__ctr;
    const scene = api.scene();
    const objects = Array.from(scene.rootNodes)
      .filter(n => api.typeName(n) === 'SharedObject')
      .map(n => ({ node: n, name: api.readScalar(n, 'name') }))
      .filter(o => typeof o.name === 'string' && o.name.indexOf('QAFIX ') === 0)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    const chosen = objects.find(o => o.name === cfg.name) || objects[0];
    if (!chosen) return { error: 'no QAFIX object in this world' };

    const body = api.protoBody(chosen.node);
    if (!body) return { error: 'no PROTO body' };
    const script = api.findByDef('SOScript', body)[0];
    const t1 = api.findByDef('T1', body)[0];
    if (!script || !t1) return { error: 'no SOScript/T1' };

    const out = {
      name: chosen.name,
      collisionDefault: api.readScalar(script, 'collisionDetection'),
      start: api.readVec3(t1, 'translation'),
      others: objects.filter(o => o !== chosen).map(o => {
        const b = api.protoBody(o.node);
        const s = b && api.findByDef('SOScript', b)[0];
        return { name: o.name, collision: s ? api.readScalar(s, 'collisionDetection') : null };
      }),
    };

    /* The HUD sends startMove before any axis event, and the Script reads its
     * starting position there. Without it the run would cast its ray from the
     * world origin instead of from the object. */
    script.set_enable = true;
    await new Promise(r => setTimeout(r, 400));
    out.afterEnable = api.readVec3(t1, 'translation');

    if (cfg.turnOff) {
      script.collisionClicked = true;
      await new Promise(r => setTimeout(r, 300));
    }
    out.collisionBefore = api.readScalar(script, 'collisionDetection');

    /* One long requested step, exactly as a drag delivers it. */
    const began = performance.now();
    script.set_Y = new X3D.SFVec3f(0, cfg.drop, 0);
    await new Promise(r => setTimeout(r, 600));
    out.oneStepMs = performance.now() - began;
    out.afterOne = api.readVec3(t1, 'translation');
    out.afterOneInstance = api.readVec3(chosen.node, 'translation');

    /*
     * Then a drag. Each step waits for the frame that carries it, because
     * assigning the eventIn only queues it - a loop that does not wait times
     * the assignment and nothing else. One frame per step is what a member
     * dragging the axis handle actually gets.
     */
    const steps = 20;
    const frame = () => new Promise(r => requestAnimationFrame(() => r()));
    await frame();
    const dragBegan = performance.now();
    for (let i = 1; i <= steps; i += 1) {
      script.set_Y = new X3D.SFVec3f(0, cfg.drop + (cfg.drop * i) / steps, 0);
      await frame();
    }
    out.dragMs = performance.now() - dragBegan;
    out.dragSteps = steps;
    await new Promise(r => setTimeout(r, 600));
    out.end = api.readVec3(t1, 'translation');
    out.endInstance = api.readVec3(chosen.node, 'translation');
    out.collisionAfter = api.readScalar(script, 'collisionDetection');
    out.othersAfter = objects.filter(o => o !== chosen).map(o => {
      const b = api.protoBody(o.node);
      const s = b && api.findByDef('SOScript', b)[0];
      return { name: o.name, collision: s ? api.readScalar(s, 'collisionDetection') : null };
    });
    return out;
  }, spec);
}

const travelled = run => {
  if (!run.start || !run.end) return null;
  return Math.abs(run.end[0] - run.start[0])
    + Math.abs(run.end[1] - run.start[1])
    + Math.abs(run.end[2] - run.start[2]);
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await login(page);

  /* Collision on - the historical default. Nothing is clicked. */
  await enterPlace(page, PLACE);
  const on = await moveRun(page, { drop: DROP, turnOff: false });
  record.on = on;
  if (on.error) {
    check('a disposable QA object can be driven', false, on.error);
  } else {
    check('collision is on by default', on.collisionDefault === true, on.collisionDefault);
    check('the setting is per object, not shared',
      on.others.every(o => o.collision === true), on.others);
    check('collision ON: the movement step is refused',
      travelled(on) < 0.001, { start: on.start, end: on.end });
    check('collision ON: no snap-to-floor happened',
      on.end && on.start && on.end[1] === on.start[1], { y: on.end && on.end[1] });
  }

  /* Collision off - the same object, the same requested movement, after the
   * historical checkbox is clicked once. The world is reloaded first so the
   * PROTO instance starts from its own default again. */
  await enterPlace(page, PLACE);
  const off = await moveRun(page, { drop: DROP, turnOff: true, name: on.name });
  record.off = off;
  if (off.error) {
    check('the same object can be driven with collision off', false, off.error);
  } else {
    check('collision OFF: the checkbox turns the setting off',
      off.collisionBefore === false, off.collisionBefore);
    check('collision OFF: the same movement proceeds',
      travelled(off) > 0.001, { start: off.start, end: off.end, moved: travelled(off) });
    check('collision OFF: it is the same object as the ON run',
      off.name === on.name, { on: on.name, off: off.name });
    check('turning it off for one object leaves the others on',
      off.othersAfter.every(o => o.collision === true), off.othersAfter);
  }

  /* Performance. The ray is cast once per requested step, so the drag rate is
   * what a member feels. This is reported, and only fails if a single step
   * costs more than a slow frame. */
  record.performance = {
    withCollision: { dragMs: on.dragMs, steps: on.dragSteps, msPerStep: on.dragMs / on.dragSteps },
    withoutCollision: { dragMs: off.dragMs, steps: off.dragSteps, msPerStep: off.dragMs / off.dragSteps },
  };
  record.performance.rayCostMsPerStep =
    record.performance.withCollision.msPerStep - record.performance.withoutCollision.msPerStep;
  /*
   * Reported, not gated. Each figure includes the whole frame the step rode in
   * on, and a headless Plaza frame is both slow and uneven - repeat runs of
   * the same drag have differed by a factor of four - so a threshold here
   * would only measure the machine. The cast itself is timed directly and
   * gated in qa/collision/tools/check-rayhit.js.
   */
  console.log(`  note drag: ${record.performance.withCollision.msPerStep.toFixed(1)} ms per step `
    + `with collision, ${record.performance.withoutCollision.msPerStep.toFixed(1)} ms without, `
    + `so the ray adds about ${record.performance.rayCostMsPerStep.toFixed(1)} ms. `
    + 'Headless frame times are uneven; see check-rayhit.js for the cast itself.');

  /* Nothing was committed: set_done was never sent, so a reload has to show
   * the object exactly where the database still says it is. */
  await enterPlace(page, PLACE);
  const after = await page.evaluate(name => {
    const api = window.__ctr;
    const found = Array.from(api.scene().rootNodes)
      .filter(n => api.typeName(n) === 'SharedObject')
      .find(n => api.readScalar(n, 'name') === name);
    if (!found) return null;
    const body = api.protoBody(found);
    const t1 = body && api.findByDef('T1', body)[0];
    return t1 ? api.readVec3(t1, 'translation') : null;
  }, on.name);
  record.afterReload = after;
  check('the QA object is back where it started',
    after && on.start && after.every((v, i) => Math.abs(v - on.start[i]) < 0.001),
    { before: on.start, after });

  await page.screenshot({ path: path.join(OUT_DIR, 'object-collision.png') });
  fs.writeFileSync(path.join(OUT_DIR, 'object-collision.json'),
    JSON.stringify({ record, results }, null, 2));
  await browser.close();

  const failed = results.filter(r => !r.pass).length;
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('ERROR', err); process.exit(2); });
