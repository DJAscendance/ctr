'use strict';

/*
 * Hi-Tek: the spaceship transport, and the animated GIF that used to kill the
 * renderer.
 *
 * Two things are being proved here, and they are related.
 *
 * The transport is a chain of TimeSensors and interpolators that fly the camera
 * through a sequence of Viewpoints when a panel is touched. Hi-Tek's world file
 * is minified - its DEF names are `f8`, `ge`, `gl` - so the trigger cannot be
 * named in advance. The run therefore enumerates the TouchSensors, fires them
 * one at a time, and reports which one starts a sensor that was not running and
 * moves the camera. That is a stronger statement than picking a name out of the
 * file would be: it says a member touching the panel gets the flight.
 *
 * The GIF is `img/run.gif`, and run.wrl uses it as a MovieTexture with
 * loop TRUE, not as a still ImageTexture. That is why the original file crashed
 * the renderer and why re-encoding it was a fix rather than a cosmetic change,
 * and it is why a screenshot cannot settle the question: a MovieTexture that
 * failed to decode still draws, as nothing. duration_changed and isActive are
 * the fields that distinguish a running movie from a dead one.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-hitek.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { SCENE_ACCESS_SOURCE } = require('../lib/scene-access');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || null });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
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
  await page.waitForTimeout(6000);
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return previous;
}

const READ_STATE = () => {
  const a = window.__ctr;
  const scene = a.scene();
  const browser = a.browser();
  let viewpoint = null;
  try {
    const vp = browser.getActiveViewpoint ? browser.getActiveViewpoint() : null;
    if (vp) viewpoint = { description: a.readScalar(vp, 'description'), position: a.readVec3(vp, 'position') };
  } catch (e) {}
  let camera = null;
  try { const p = browser.viewpointPosition; if (p) camera = [p.x, p.y, p.z]; } catch (e) {}
  const timeSensors = a.findByType('TimeSensor', scene);
  return {
    rootNodes: scene.rootNodes.length,
    viewpoint,
    camera,
    timeSensorCount: timeSensors.length,
    activeTimeSensors: timeSensors.filter(n => a.readScalar(n, 'isActive') === true).length,
    movies: a.findByType('MovieTexture', scene).map(n => ({
      url: a.strings(a.field(n, 'url')),
      duration: a.readScalar(n, 'duration_changed'),
      isActive: a.readScalar(n, 'isActive'),
      loop: a.readScalar(n, 'loop'),
    })),
    touchSensorCount: a.findByType('TouchSensor', scene).length,
    canvasCount: document.querySelectorAll('#world x3d-canvas').length,
  };
};

/* Fires the nth TouchSensor in walk order, whatever it is called. */
const FIRE_NTH = (n) => {
  const a = window.__ctr;
  const sensors = a.findByType('TouchSensor', a.scene());
  const target = sensors[n];
  if (!target) return { ok: false, error: 'index out of range', count: sensors.length };
  try {
    const now = a.browser().getCurrentTime();
    a.field(target, 'isActive').setValue(true);
    a.field(target, 'touchTime').setValue(now);
    a.field(target, 'isActive').setValue(false);
    return { ok: true, def: a.defName(target), count: sensors.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), count: sensors.length };
  }
};

async function main() {
  fs.mkdirSync(path.join(OUT_DIR, 'screenshots'), { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
  let rendererDied = null;
  page.on('crash', () => { rendererDied = 'page crashed'; });

  await login(page);
  const record = {};

  console.log('\nHi-Tek');
  const roots = await enter(page, '#/place/hitek_col');
  const start = await page.evaluate(READ_STATE);
  record.start = start;
  check('Hi-Tek builds its scene', roots > 0 && start.rootNodes === roots, `rootNodes ${roots}`);
  check('the transport start Viewpoint is bound',
    start.viewpoint && start.viewpoint.description === 'Shuttle Craft',
    `active viewpoint "${start.viewpoint && start.viewpoint.description}"`);
  await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'hitek-before-transport.png') });

  /* --- run.gif ---------------------------------------------------------- */
  console.log('\nrun.gif');
  const runMovie = start.movies.find(m => m.url && m.url.some(u => /run\.gif$/.test(u)));
  record.runMovie = runMovie;
  check('run.gif is loaded as a MovieTexture', !!runMovie,
    `MovieTextures in the scene: ${JSON.stringify(start.movies.map(m => m.url && m.url[0]))}`);
  check('run.gif decoded to a movie with a duration',
    runMovie && typeof runMovie.duration === 'number' && runMovie.duration > 0,
    `duration_changed ${runMovie && runMovie.duration}`);
  check('run.gif is playing and looping',
    runMovie && runMovie.isActive === true && runMovie.loop === true,
    `isActive ${runMovie && runMovie.isActive}, loop ${runMovie && runMovie.loop}`);

  /* --- find the transport trigger --------------------------------------- */
  console.log('\nTransport trigger');
  const attempts = [];
  let fired = null;
  const limit = Math.min(start.touchSensorCount, 30);
  for (let index = 0; index < limit && !fired; index += 1) {
    const before = await page.evaluate(READ_STATE);
    const result = await page.evaluate(FIRE_NTH, index);
    await page.waitForTimeout(2500);
    const after = await page.evaluate(READ_STATE);
    const startedSensors = after.activeTimeSensors - before.activeTimeSensors;
    const movedCamera = before.camera && after.camera
      ? Math.hypot(before.camera[0] - after.camera[0], before.camera[1] - after.camera[1],
        before.camera[2] - after.camera[2]) : 0;
    const changedViewpoint = (before.viewpoint && before.viewpoint.description)
      !== (after.viewpoint && after.viewpoint.description);
    attempts.push({
      index, def: result.def, startedSensors, movedCamera, changedViewpoint,
      viewpoint: after.viewpoint && after.viewpoint.description,
    });
    if (startedSensors > 0 || movedCamera > 1 || changedViewpoint) {
      fired = { index, def: result.def, startedSensors, movedCamera, changedViewpoint };
    }
  }
  record.attempts = attempts;
  record.fired = fired;
  check('a TouchSensor starts the transport',
    !!fired,
    fired ? `sensor #${fired.index} (DEF ${fired.def || 'anonymous'}) started ${fired.startedSensors} TimeSensor(s), `
      + `moved the camera ${fired.movedCamera.toFixed(2)} m, viewpoint changed ${fired.changedViewpoint}`
      : `${limit} TouchSensors fired, none started a sensor or moved the camera`);

  /* --- follow the flight ------------------------------------------------ */
  console.log('\nTransport flight');
  const timeline = [];
  for (let sample = 0; sample < 24; sample += 1) {
    const state = await page.evaluate(READ_STATE);
    timeline.push({
      t: sample * 2.5,
      camera: state.camera,
      viewpoint: state.viewpoint && state.viewpoint.description,
      activeTimeSensors: state.activeTimeSensors,
      rootNodes: state.rootNodes,
    });
    if (sample === 6) {
      await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'hitek-transport.png') });
    }
    await page.waitForTimeout(2500);
  }
  record.timeline = timeline;

  const cameras = timeline.map(t => t.camera).filter(Boolean);
  let travelled = 0;
  for (let i = 1; i < cameras.length; i += 1) {
    travelled += Math.hypot(cameras[i][0] - cameras[i - 1][0],
      cameras[i][1] - cameras[i - 1][1], cameras[i][2] - cameras[i - 1][2]);
  }
  const viewpointSequence = [...new Set(timeline.map(t => t.viewpoint).filter(v => v !== null))];
  const sensorPeak = Math.max(...timeline.map(t => t.activeTimeSensors));

  check('TimeSensors ran during the flight', sensorPeak > 0,
    `peak simultaneously active TimeSensors ${sensorPeak} of ${start.timeSensorCount}`);
  check('the camera actually travelled', travelled > 10,
    `${travelled.toFixed(1)} m along the path over ${(timeline.length * 2.5).toFixed(0)}s`);
  /*
   * Hi-Tek does not bind a series of Viewpoints. The shuttle's Viewpoint sits
   * inside a Transform that the flight's PositionInterpolator and
   * OrientationInterpolator drive, so the member stays in the same seat and the
   * seat is what moves: the active viewpoint's description is "Shuttle Craft"
   * from the first frame to the last. What advances is the camera along the
   * path, so that is what is counted - distinct, well-separated waypoints
   * rather than distinct viewpoint names.
   */
  const waypoints = [];
  for (const camera of cameras) {
    const last = waypoints[waypoints.length - 1];
    if (!last || Math.hypot(camera[0] - last[0], camera[1] - last[1], camera[2] - last[2]) > 5) {
      waypoints.push(camera);
    }
  }
  check('the Viewpoint advanced along the flight path', waypoints.length >= 3,
    `${waypoints.length} waypoints more than 5 m apart, carrying the "${viewpointSequence.join(', ')}"`
    + ` viewpoint from ${JSON.stringify(cameras[0] && cameras[0].map(n => Math.round(n)))}`
    + ` to ${JSON.stringify(cameras[cameras.length - 1] && cameras[cameras.length - 1].map(n => Math.round(n)))}`);

  const end = await page.evaluate(READ_STATE);
  record.end = end;
  check('the flight ended on a valid Viewpoint',
    !!(end.viewpoint && end.viewpoint.description !== null),
    `final viewpoint "${end.viewpoint && end.viewpoint.description}" at ${JSON.stringify(end.camera)}`);
  check('the renderer survived the transport',
    !rendererDied && end.canvasCount === 1 && end.rootNodes === start.rootNodes,
    `${rendererDied || 'no crash'}, canvases ${end.canvasCount}, rootNodes ${end.rootNodes}`);

  const endMovie = end.movies.find(m => m.url && m.url.some(u => /run\.gif$/.test(u)));
  check('run.gif is still animating after the transport',
    endMovie && endMovie.isActive === true && endMovie.duration > 0,
    `isActive ${endMovie && endMovie.isActive}, duration ${endMovie && endMovie.duration}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'hitek-after-transport.png') });

  const fatal = consoleErrors.filter(e =>
    /UnimplementedBXXMethod|n\.match is not a function|_value|WebGL|context lost/i.test(e));
  check('no regression signature appeared in the console', fatal.length === 0,
    fatal.length ? fatal.slice(0, 3).join('\n       ') : `${consoleErrors.length} console errors, none matching a regression signature`);

  record.consoleErrors = consoleErrors;
  record.results = results;
  fs.writeFileSync(path.join(OUT_DIR, 'hitek.json'), `${JSON.stringify(record, null, 2)}\n`);

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} Hi-Tek checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
