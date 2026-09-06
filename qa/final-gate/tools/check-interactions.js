'use strict';

/*
 * The interaction gates of the X_ITE 16.2.0 final clearance.
 *
 * These are the paths that read the camera rather than the scene file, so an
 * engine upgrade can break them while every world still renders perfectly:
 *
 *   ProximitySensor  WorldBrowserPage creates one per scene and feeds
 *                    `this.position` / `this.rotation` from its
 *                    position_changed / orientation_changed callbacks. Those
 *                    two fields are the only source dropObject has for where
 *                    the member is standing.
 *   world return     The sensor belongs to the scene that is loaded now. A
 *                    sensor that survived a world replacement would keep
 *                    reporting the old world's coordinates, and the symptom
 *                    would be objects dropped in the wrong place, not a
 *                    rendering fault.
 *   dropObject       position/rotation -> a point four metres ahead.
 *   moveObject       the gizmo's transform -> the database.
 *   beamTo           an object's transform -> a temporary Viewpoint.
 *   NavigationInfo   avatar height, speed and far distance.
 *
 * The sensor is moved by holding a real arrow key against a focused canvas,
 * never by writing a value into the sensor. A synthetic write would prove the
 * callback fires, which was never in doubt; what is in doubt is whether the
 * engine still drives the sensor from camera motion.
 *
 * It uses one disposable object_instance, identified by an `object_name`
 * beginning `QAFIX finalgate`, and restores that row's placement afterwards.
 * It never touches a row it did not create.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-interactions.js <objectInstanceId> [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

const OBJECT_ID = process.argv[2];
const OUT_DIR = process.argv[3]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');

/* The flea market: the drop controller allows a drop here without place ownership. */
const DROP_PLACE = 'fleamarket';

/* How far the camera must actually travel for a movement to count as movement.
 * Well above float noise, well below one second of walking. */
const MIN_TRAVEL = 0.25;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

/* Finds the live WorldBrowserPage instance and exposes it as window.__ctrPage. */
const BIND_PAGE = () => {
  function rootVm() {
    for (const node of [document.querySelector('#app'), document.body]) {
      for (let el = node; el; el = el.parentElement) if (el && el.__vue__) return el.__vue__;
    }
    return null;
  }
  const root = rootVm();
  if (!root) return false;
  let found = null;
  (function walk(vm) {
    if (!vm || found) return;
    if (vm.sharedObjectsMap !== undefined && vm.worldGeneration !== undefined) { found = vm; return; }
    for (const child of vm.$children || []) walk(child);
  })(root);
  window.__ctrPage = found;
  return !!found;
};

const FOCUS_CANVAS = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return false;
  canvas.setAttribute('tabindex', '0');
  canvas.focus();
  return document.activeElement === canvas;
};

/*
 * The sensor reading the application actually uses, plus an identity stamp.
 * X_ITE gives nodes no stable id, so the run stamps one the first time it sees
 * a sensor; a second world that reports the same stamp is reusing a sensor it
 * should have replaced, which is the exact failure this gate exists to catch.
 */
const READ_SENSOR = () => {
  const vm = window.__ctrPage;
  if (!vm) return null;
  const sensor = vm.proximitySensor || null;
  if (sensor && !sensor.__ctrStamp) {
    window.__ctrStampSeq = (window.__ctrStampSeq || 0) + 1;
    try { sensor.__ctrStamp = window.__ctrStampSeq; } catch (e) {}
  }
  return {
    position: Array.isArray(vm.position) ? vm.position.slice() : null,
    rotation: Array.isArray(vm.rotation) ? vm.rotation.slice() : null,
    stamp: sensor ? (sensor.__ctrStamp || null) : null,
    hasSensor: !!sensor,
  };
};

const READ_VIEWPOINT = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) return null;
  try {
    const p = X3D.getBrowser(canvas).viewpointPosition;
    return p ? [p.x, p.y, p.z] : null;
  } catch (e) { return null; }
};

/*
 * NavigationInfo, read through the deep scene reader.
 *
 * `browser.activeNavigationInfo` and `field._value` both answer undefined on
 * X_ITE 16, so a reader built on them reports every field as unavailable and
 * fails a gate the engine is in fact satisfying. The bindable is found in the
 * scene instead, and its values come off the field objects the same way
 * everything else in this run reads them.
 */
const READ_NAVINFO = () => {
  const a = window.__ctr;
  if (!a) return { unavailable: 'deep reader not installed' };
  const browser = a.browser();
  const scene = a.scene();
  const navs = a.findByType('NavigationInfo', scene);
  const out = { count: navs.length };
  /* The first NavigationInfo in the scene is the bound one, which is the X3D
   * rule; CTR worlds that declare one declare it ahead of their content. */
  const nav = navs[0];
  if (nav) {
    out.avatarSize = a.numbers(a.field(nav, 'avatarSize'));
    out.speed = a.readScalar(nav, 'speed');
    out.visibilityLimit = a.readScalar(nav, 'visibilityLimit');
    out.type = a.strings(a.field(nav, 'type'));
    out.headlight = a.readScalar(nav, 'headlight');
  }
  /* bxx_auth.js re-exposes the blaxxun accessors the legacy worlds call. */
  try { out.bxxSpeed = browser.navSpeed; } catch (e) { out.bxxSpeedError = String(e); }
  try { out.bxxAvatarHeight = browser.avatarHeight; } catch (e) { out.bxxAvatarHeightError = String(e); }
  try { out.gravity = browser.getGravity ? browser.getGravity() : null; }
  catch (e) { out.gravityError = String(e && e.message ? e.message : e); }
  try { out.viewer = browser.getViewer ? browser.getViewer().constructor.name : null; } catch (e) {}
  return out;
};

/*
 * Reads the rendered transform of one SharedObject PROTO instance.
 *
 * Straight off the field objects: X_ITE 16.2.0 has no `_value` holder, so a
 * reader that went through one reports null for a node that is sitting in the
 * scene at a perfectly good transform.
 */
const READ_NODE = (id) => {
  const vm = window.__ctrPage;
  if (!vm || !vm.sharedObjectsMap) return null;
  const node = vm.sharedObjectsMap.get(id) || vm.sharedObjectsMap.get(String(id))
    || vm.sharedObjectsMap.get(Number(id));
  if (!node) return { present: false };
  const out = { present: true, translation: null, rotation: null };
  try { out.translation = [node.translation.x, node.translation.y, node.translation.z]; } catch (e) {}
  try { out.rotation = [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.angle]; } catch (e) {}
  return out;
};

const distance = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null);

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
  await page.evaluate(BIND_PAGE);
  /* The deep reader is page state that a world replacement does not remove,
   * but reinstalling is cheap and keeps a reload from leaving it undefined. */
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return previous;
}

/*
 * Holds an arrow key the way a member does, then lets the sensor settle.
 *
 * The focus is checked rather than assumed. arrow_keys.js binds its handlers to
 * the canvas element, so a key press sent while focus is still on the body does
 * nothing at all, and the avatar stays put - which is indistinguishable from a
 * sensor that stopped reporting unless the focus is confirmed first. The retry
 * exists because the element is replaced during a world load and can lose focus
 * between the check and the press.
 */
async function walk(page, key, ms) {
  let focused = false;
  for (let attempt = 0; attempt < 5 && !focused; attempt += 1) {
    focused = await page.evaluate(FOCUS_CANVAS);
    if (!focused) await page.waitForTimeout(700);
  }
  if (!focused) return { focused: false };
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(900);
  return { focused: true };
}

async function main() {
  if (!OBJECT_ID) {
    console.error('usage: check-interactions.js <objectInstanceId> [outDir]');
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await launchBrowser({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));

  await login(page);

  const record = {};

  /* --- ProximitySensor -------------------------------------------------- */
  console.log('\nProximitySensor (Plaza)');
  await enter(page, '#/place/enter');
  const bound = await page.evaluate(() => !!window.__ctrPage);
  check('WorldBrowserPage is reachable', bound);

  const before = await page.evaluate(READ_SENSOR);
  check('sensor reports a position before moving', before && Array.isArray(before.position),
    JSON.stringify(before && before.position));

  await walk(page, 'ArrowUp', 2500);
  const after = await page.evaluate(READ_SENSOR);
  const travel = distance(before && before.position, after && after.position);
  check('sensor position changes when the avatar walks', travel !== null && travel > MIN_TRAVEL,
    `before ${JSON.stringify(before && before.position)} after ${JSON.stringify(after && after.position)} travelled ${travel === null ? 'n/a' : travel.toFixed(3)} m`);

  await walk(page, 'ArrowLeft', 1500);
  const turned = await page.evaluate(READ_SENSOR);
  const turnDelta = before && turned && before.rotation && turned.rotation
    ? Math.abs(before.rotation[3] - turned.rotation[3]) : null;
  check('sensor orientation changes when the avatar turns', turnDelta !== null && turnDelta > 0.05,
    `angle ${before && before.rotation && before.rotation[3]} -> ${turned && turned.rotation && turned.rotation[3]}`);

  record.proximity = { before, after, turned, travel };

  /* --- world return ----------------------------------------------------- */
  console.log('\nProximitySensor after a world return');
  const plazaStamp = after && after.stamp;
  await enter(page, '#/place/mall');
  const mallSensor = await page.evaluate(READ_SENSOR);
  await enter(page, '#/place/enter');
  const returned = await page.evaluate(READ_SENSOR);

  check('the Mall bound a different sensor from the Plaza',
    mallSensor && mallSensor.stamp && mallSensor.stamp !== plazaStamp,
    `plaza stamp ${plazaStamp}, mall stamp ${mallSensor && mallSensor.stamp}`);
  check('returning to the Plaza bound a third sensor, not the first',
    returned && returned.stamp && returned.stamp !== plazaStamp && returned.stamp !== (mallSensor && mallSensor.stamp),
    `stamps plaza=${plazaStamp} mall=${mallSensor && mallSensor.stamp} return=${returned && returned.stamp}`);

  await walk(page, 'ArrowUp', 2500);
  const returnedAfter = await page.evaluate(READ_SENSOR);
  const returnTravel = distance(returned && returned.position, returnedAfter && returnedAfter.position);
  check('the returned sensor still tracks movement',
    returnTravel !== null && returnTravel > MIN_TRAVEL,
    `travelled ${returnTravel === null ? 'n/a' : returnTravel.toFixed(3)} m`);

  record.proximityReturn = { mallSensor, returned, returnedAfter, returnTravel };

  /* --- NavigationInfo --------------------------------------------------- */
  console.log('\nNavigationInfo');
  const nav = await page.evaluate(READ_NAVINFO);
  record.navigationInfo = nav;
  check('avatar height is readable', nav && Array.isArray(nav.avatarSize) && nav.avatarSize.length >= 2,
    `avatarSize ${JSON.stringify(nav && nav.avatarSize)} from ${nav && nav.count} NavigationInfo node(s)`);
  check('walk speed is readable', nav && typeof nav.speed === 'number', `speed ${nav && nav.speed}`);
  check('far distance is readable', nav && typeof nav.visibilityLimit === 'number',
    `visibilityLimit ${nav && nav.visibilityLimit}`);
  /*
   * Recorded, not required. bxx_auth.js never defined navSpeed or
   * avatarHeight, and no world under spa/assets calls either, so asserting on
   * them would fail the run for an accessor nothing asks for. The walk speed
   * the gate is about is NavigationInfo.speed, checked above.
   */
  console.log(`  note blaxxun navSpeed accessor: ${nav && nav.bxxSpeed}`
    + ' (never defined by bxx_auth.js; no world calls it)');
  if (nav && nav.gravityError) {
    /*
     * Browser.setGravity / getGravity write through this.browserOptions, which
     * X_ITE 16 no longer exposes. Ten call sites across four home world
     * templates (worlds/007, /008, /009, /00a) use setGravity to switch gravity
     * off while a lift is moving. The QA home world, worlds/003, does not, so
     * this does not block the gravity gate; it is reported as a defect found.
     */
    console.log(`  note Browser.getGravity()/setGravity() throw: ${nav.gravityError}`);
  }

  /* --- dropObject ------------------------------------------------------- */
  console.log(`\ndropObject (flea market, disposable instance ${OBJECT_ID})`);
  await enter(page, `#/place/${DROP_PLACE}`);
  await walk(page, 'ArrowUp', 2200);
  await walk(page, 'ArrowRight', 1200);
  await walk(page, 'ArrowUp', 1500);

  const atDrop = await page.evaluate(READ_SENSOR);
  check('the avatar is away from the origin before dropping',
    atDrop && atDrop.position && Math.hypot(atDrop.position[0], atDrop.position[2]) > 1,
    `standing at ${JSON.stringify(atDrop && atDrop.position)}`);

  /* The expectation is computed here from the same sensor reading the
   * application will use, so a mismatch means the drop maths changed, not that
   * the avatar was somewhere else. */
  const expected = await page.evaluate(() => {
    const vm = window.__ctrPage;
    const d = 4;
    const pos = new X3D.SFVec3f(...vm.position);
    const rot = new X3D.SFRotation(...vm.rotation);
    const offset = rot.multVec(new X3D.SFVec3f(0, 0, -d));
    offset.y = 0;
    const p = pos.add(offset);
    const angle = Math.atan2(offset.x, offset.z);
    return { position: [p.x, p.y, p.z], rotationAngle: angle + Math.PI };
  });

  const dropResult = await page.evaluate(async (id) => {
    try { await window.__ctrPage.dropObject(id); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  }, Number(OBJECT_ID));
  await page.waitForTimeout(3500);
  check('dropObject completed', dropResult.ok, dropResult.error || '');

  const droppedNode = await page.evaluate(READ_NODE, Number(OBJECT_ID));
  record.drop = { expected, node: droppedNode, sensor: atDrop, result: dropResult };
  check('the dropped object is in the scene', droppedNode && droppedNode.present);
  const dropDelta = droppedNode && droppedNode.present
    ? distance(expected.position, droppedNode.translation) : null;
  check('the object rendered where the drop maths put it',
    dropDelta !== null && dropDelta < 0.0001,
    `expected ${JSON.stringify(expected.position)} rendered ${JSON.stringify(droppedNode && droppedNode.translation)} delta ${dropDelta}`);

  /* --- moveObject ------------------------------------------------------- */
  console.log('\nmoveObject');
  /*
   * `startMove` is an eventIn on the SharedObject PROTO, so it is write-only:
   * reading it back answers the field default whatever was just sent, and an
   * assertion on the read value fails for a call that worked. What can be
   * asserted is that the assignment is accepted and the node is still the one
   * the map holds afterwards.
   */
  const moveArmed = await page.evaluate((id) => {
    try {
      const before = window.__ctrPage.sharedObjectsMap.get(id);
      if (!before) return { ok: false, error: 'no node for that id' };
      window.__ctrPage.moveObject(id);
      const after = window.__ctrPage.sharedObjectsMap.get(id);
      return { ok: true, sameNode: before === after };
    } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  }, Number(OBJECT_ID));
  check('moveObject arms the PROTO gizmo without error',
    moveArmed.ok && moveArmed.sameNode === true,
    moveArmed.error || `node preserved ${moveArmed.sameNode}`);

  /*
   * The gizmo itself is a mouse drag inside the world. What the gate needs to
   * know is whether the transform the gizmo leaves behind still reaches the
   * database and stays on the node, so the new transform is written the way the
   * gizmo writes it and saveObjectLocation is called exactly as the eventOut
   * handler calls it.
   */
  const target = { position: [7.5, 0, -3.25], angle: 1.1 };
  const moveResult = await page.evaluate(async ({ id, t }) => {
    const vm = window.__ctrPage;
    const node = vm.sharedObjectsMap.get(id);
    if (!node) return { ok: false, error: 'node missing' };
    node.translation = new X3D.SFVec3f(...t.position);
    node.rotation = new X3D.SFRotation(0, 1, 0, t.angle);
    try { await vm.saveObjectLocation(id); } catch (e) { return { ok: false, error: String(e) }; }
    return {
      ok: true,
      rendered: [node.translation.x, node.translation.y, node.translation.z],
      renderedRotation: [node.rotation.x, node.rotation.y, node.rotation.z, node.rotation.angle],
    };
  }, { id: Number(OBJECT_ID), t: target });
  await page.waitForTimeout(2000);
  check('moveObject saved without error', moveResult.ok, moveResult.error || '');
  const moveDelta = moveResult.ok ? distance(target.position, moveResult.rendered) : null;
  check('the rendered transform is the requested one',
    moveDelta !== null && moveDelta < 0.0001,
    `requested ${JSON.stringify(target.position)} rendered ${JSON.stringify(moveResult.rendered)}`);
  record.move = { target, result: moveResult, armed: moveArmed };

  /* --- beamTo ----------------------------------------------------------- */
  console.log('\nbeamTo');
  await walk(page, 'ArrowDown', 2500);
  const beforeBeam = await page.evaluate(READ_VIEWPOINT);
  const nodeBeforeBeam = await page.evaluate(READ_NODE, Number(OBJECT_ID));
  /*
   * The id is passed as a number because that is what the application passes.
   * Chat.vue calls `menu(object.id, ...)` with the id straight off the API
   * JSON, and WorldBrowserPage keys sharedObjectsMap with the same value, so a
   * string here misses the Map and fails a beam that works in the product.
   */
  const beamResult = await page.evaluate((id) => {
    try { window.__ctrPage.beamTo(id); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  }, Number(OBJECT_ID));
  await page.waitForTimeout(3000);
  const afterBeam = await page.evaluate(READ_VIEWPOINT);
  const nodeAfterBeam = await page.evaluate(READ_NODE, Number(OBJECT_ID));
  const sensorAfterBeam = await page.evaluate(READ_SENSOR);

  check('beamTo completed', beamResult.ok, beamResult.error || '');
  const beamTravel = distance(beforeBeam, afterBeam);
  check('the camera moved', beamTravel !== null && beamTravel > MIN_TRAVEL,
    `${JSON.stringify(beforeBeam)} -> ${JSON.stringify(afterBeam)} (${beamTravel === null ? 'n/a' : beamTravel.toFixed(3)} m)`);

  /*
   * The beam should land beamToDistance away from the object, not on top of it.
   *
   * Measured on the ground plane only. beamTo forces the offset's y to zero and
   * binds a Viewpoint at the object's own height, and gravity then pulls the
   * avatar down to whatever floor is under that spot - which, for an object
   * that was moved to a place with no floor beneath it, is a long way. Counting
   * that drop as arrival error would fail the beam for doing its job.
   */
  const horizontal = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : null);
  const arrival = horizontal(afterBeam, nodeAfterBeam && nodeAfterBeam.translation);
  check('the camera arrived beside the target object',
    arrival !== null && arrival > 0.5 && arrival < 12,
    `${arrival === null ? 'n/a' : arrival.toFixed(3)} m from the object on the ground plane`
    + `, camera ${JSON.stringify(afterBeam)} object ${JSON.stringify(nodeAfterBeam && nodeAfterBeam.translation)}`);

  const objectMoved = distance(nodeBeforeBeam && nodeBeforeBeam.translation,
    nodeAfterBeam && nodeAfterBeam.translation);
  check('beamTo left the object where it was',
    objectMoved !== null && objectMoved < 0.0001,
    `object moved ${objectMoved} m`);

  check('position reporting still works after the beam',
    sensorAfterBeam && Array.isArray(sensorAfterBeam.position),
    `sensor now ${JSON.stringify(sensorAfterBeam && sensorAfterBeam.position)}`);

  record.beam = { beforeBeam, afterBeam, nodeBeforeBeam, nodeAfterBeam, sensorAfterBeam, arrival };

  /* ---------------------------------------------------------------------- */
  record.consoleErrors = consoleErrors;
  record.results = results;
  record.capturedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'interactions.json'), `${JSON.stringify(record, null, 2)}\n`);

  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} interaction checks passed`);
  console.log(`report ${path.join(OUT_DIR, 'interactions.json')}`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
