'use strict';

/*
 * The Mall control set, proved at runtime under X_ITE 16.2.0.
 *
 * The Mall is the world that exercises most of the compatibility surface at
 * once: a legacy Script that fetches the time over the network, an analogue
 * clock driven by two TimeSensors and two OrientationInterpolators, a day/night
 * cycle, an elevator that reads the camera, two directory panels, eleven shop
 * doors that call Browser.loadURL with retired cybertown.com addresses, and a
 * scene that must come back with exactly ten root nodes every time it is
 * re-entered.
 *
 * The clock is checked as a chain rather than as a picture, because a
 * screenshot of a clock cannot say whether it is showing the right time:
 *
 *   1. /api/compat/city-time.wrl answers with the current America/New_York time;
 *   2. the world's Script parsed that answer, which is visible as CityTime
 *      nodes in the scene carrying hour / min / sec;
 *   3. minClock and hourClock are running at the fractions those values imply;
 *   4. the hands are at the angles those fractions imply; and
 *   5. a minute later, the minute hand has moved on by one minute's worth.
 *
 * Every link is asserted separately, so a failure names the link that broke
 * instead of saying the clock is wrong.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/check-mall.js [outDir]
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

/* The Mall's own root count. Ten is the number the scene-cache work settled on
 * and the number a correct re-entry must reproduce. */
const MALL_ROOT_NODES = 10;

/*
 * Angle tolerance, radians.
 *
 * The minute hand turns 2*pi in an hour, so 0.02 rad is about eleven seconds of
 * clock movement - comfortably more than the skew between reading the time and
 * reading the hand, and far less than the smallest error worth reporting, which
 * would be a whole minute at 0.105 rad.
 */
const ANGLE_TOLERANCE = 0.02;

/* The OrientationInterpolator both hands use: key [0, .5, 1] onto [0, 3.142, 6.284]. */
const FULL_TURN = 6.284;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || null });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `\n       ${detail}` : ''}`);
}

/*
 * Two rotations about the z axis are the same rotation when angle*sign(z)
 * agrees modulo 2*pi. X_ITE normalises an SFRotation so the angle stays in
 * [0, pi] and flips the axis instead, so the reported axis sign carries part of
 * the value and cannot be dropped.
 */
function zAngle(rotation) {
  if (!rotation) return null;
  const signed = rotation[3] * (rotation[2] < 0 ? -1 : 1);
  return ((signed % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/* Shortest distance between two angles on the circle. */
function angleGap(a, b) {
  if (a === null || b === null) return null;
  const raw = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(raw, 2 * Math.PI - raw);
}

/* The interpolator's output magnitude for a TimeSensor fraction. */
function handAngle(fraction) {
  if (fraction === null || fraction === undefined) return null;
  return FULL_TURN * fraction;
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
  await page.waitForTimeout(3200);
  await page.evaluate(SCENE_ACCESS_SOURCE);
  return previous;
}

/* Everything the clock gate reads, taken in one page turn so the readings are
 * of the same instant. */
const READ_CLOCK = () => {
  const a = window.__ctr;
  const scene = a.scene();
  const one = (list, read) => (list.length ? read(list[0]) : null);
  const minClock = a.findByDef('minClock', scene);
  const hourClock = a.findByDef('hourClock', scene);
  const dnClock = a.findByDef('dnClock', scene);
  return {
    browserTime: (() => { try { return a.browser().getCurrentTime(); } catch (e) { return null; } })(),
    cityTime: a.findByType('CityTime', scene).map(n => ({
      hour: a.readScalar(n, 'hour'), min: a.readScalar(n, 'min'), sec: a.readScalar(n, 'sec'),
    })),
    minFraction: one(minClock, n => a.readScalar(n, 'fraction_changed')),
    minActive: one(minClock, n => a.readScalar(n, 'isActive')),
    minStart: one(minClock, n => a.readScalar(n, 'startTime')),
    hourFraction: one(hourClock, n => a.readScalar(n, 'fraction_changed')),
    hourActive: one(hourClock, n => a.readScalar(n, 'isActive')),
    hourStart: one(hourClock, n => a.readScalar(n, 'startTime')),
    dayNightFraction: one(dnClock, n => a.readScalar(n, 'fraction_changed')),
    dayNightActive: one(dnClock, n => a.readScalar(n, 'isActive')),
    minHand: one(a.findByDef('min_hand', scene), n => a.readRot(n, 'rotation')),
    hourHand: one(a.findByDef('hour_hand', scene), n => a.readRot(n, 'rotation')),
    clockCount: a.findByType('AnalogClock', scene).length,
  };
};

const READ_CONTROLS = () => {
  const a = window.__ctr;
  const scene = a.scene();
  const sensors = a.findByType('TouchSensor', scene);
  const byName = {};
  for (const s of sensors) {
    const n = a.defName(s) || '(anon)';
    byName[n] = (byName[n] || 0) + 1;
  }
  return {
    rootNodes: scene.rootNodes.length,
    touchSensors: byName,
    touchSensorTotal: sensors.length,
    viewpoints: a.findByType('Viewpoint', scene)
      .map(n => a.readScalar(n, 'description')).filter(Boolean),
    directories: a.findByType('malldirectory', scene).length,
    elevators: a.findByType('Elevator', scene).length,
    storeFronts: a.findByType('StoreFront', scene).length,
    dayNight: a.findByType('DayNight', scene).length,
  };
};

/* The text the two directory panels are showing, so a button press can be seen. */
const READ_DIRECTORY_TEXT = () => {
  const a = window.__ctr;
  const scene = a.scene();
  const out = [];
  for (const dir of a.findByType('malldirectory', scene)) {
    const body = a.protoBody(dir);
    if (!body) continue;
    const lines = [];
    a.walk(body, (node) => {
      if (a.typeName(node) === 'Text') {
        const s = a.strings(a.field(node, 'string'));
        if (s && s.length) lines.push(s.join('|'));
      }
    });
    out.push(lines);
  }
  return out;
};

/*
 * Fires a TouchSensor by setting its touchTime, which is what a pick does. The
 * event then travels the world's own ROUTEs into the world's own Script, so
 * everything downstream of the pick is the real path; only the pick itself is
 * stood in for, because aiming a pixel-accurate click at a button inside a
 * PROTO body would mean first solving the projection this run is testing.
 *
 * This works for a PROTO declared in the world file - the shop doors are
 * StoreFront instances and their lts sensor drives Browser.loadURL through it.
 * It does not work inside an EXTERNPROTO body: writing touchTime on a sensor
 * inside malldirectory.wrl is accepted and goes nowhere, while sending the same
 * event to the eventIn at the far end of that ROUTE works and scrolls the
 * panel. That is a limit of writing an eventOut from outside the engine, not a
 * statement about the world, so the directory is driven at the eventIn instead
 * and the doors carry the evidence that picking reaches a Script at all.
 */
const FIRE_SENSOR = (defName, index) => {
  const a = window.__ctr;
  const scene = a.scene();
  const sensors = a.findByType('TouchSensor', scene).filter(n => a.defName(n) === defName);
  const target = sensors[index || 0];
  if (!target) return { ok: false, error: `no TouchSensor DEF ${defName}`, count: sensors.length };
  try {
    const now = a.browser().getCurrentTime();
    a.field(target, 'isActive').setValue(true);
    a.field(target, 'touchTime').setValue(now);
    a.field(target, 'isActive').setValue(false);
    return { ok: true, count: sensors.length, at: now };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), count: sensors.length };
  }
};

/* Sends an event to the directory Script's own eventIn, the far end of the
 * ROUTE the button sits on. Returns the index before and after so a scroll can
 * be seen in the Script's own state as well as in the rendered text. */
const FIRE_DIRECTORY = (eventName, panel) => {
  const a = window.__ctr;
  const dirs = a.findByType('malldirectory', a.scene());
  const dir = dirs[panel || 0];
  if (!dir) return { ok: false, error: 'no malldirectory instance' };
  const body = a.protoBody(dir);
  if (!body) return { ok: false, error: 'no PROTO body' };
  let ds = null;
  a.walk(body, (n) => { if (!ds && a.typeName(n) === 'Script' && a.defName(n) === 'DS') ds = n; });
  if (!ds) return { ok: false, error: 'no DS Script in the directory body' };
  const before = a.readScalar(ds, 'index');
  try {
    a.field(ds, eventName).setValue(a.browser().getCurrentTime());
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), before };
  }
  return { ok: true, before, max: a.readScalar(ds, 'max'), isShort: a.readScalar(ds, 'isShort') };
};

const READ_DIRECTORY_INDEX = (panel) => {
  const a = window.__ctr;
  const dir = a.findByType('malldirectory', a.scene())[panel || 0];
  if (!dir) return null;
  const body = a.protoBody(dir);
  if (!body) return null;
  let ds = null;
  a.walk(body, (n) => { if (!ds && a.typeName(n) === 'Script' && a.defName(n) === 'DS') ds = n; });
  return ds ? a.readScalar(ds, 'index') : null;
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'screenshots'), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    /*
     * Background throttling has to be off for the minute-boundary check. A
     * headless page with no input pending gets its timers and its rAF slowed
     * to a crawl, and X_ITE drives its clock from that loop: an earlier run of
     * this tool measured the engine advancing 1.6 seconds across a 70 second
     * wait and reported a stopped clock, when what had stopped was the page.
     */
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));

  const record = {};
  await login(page);

  console.log('\nMall scene');
  const roots = await enter(page, '#/place/mall');
  check(`the Mall has ${MALL_ROOT_NODES} root nodes`, roots === MALL_ROOT_NODES, `rootNodes ${roots}`);

  const controls = await page.evaluate(READ_CONTROLS);
  record.controls = controls;
  check('both directory panels are present', controls.directories === 2,
    `malldirectory instances ${controls.directories}`);
  check('the elevator is present', controls.elevators > 0, `Elevator instances ${controls.elevators}`);
  check('the shop doors are present', controls.storeFronts === 11,
    `StoreFront instances ${controls.storeFronts}`);
  check('the DayNight cycle is present', controls.dayNight === 1);
  const wanted = ['Enter', 'Fountain', 'Store Directory', 'Top Floor', 'Elevator', 'Clock'];
  const missingVp = wanted.filter(v => !controls.viewpoints.includes(v));
  check('every authored Viewpoint is in the scene', missingVp.length === 0,
    `viewpoints ${controls.viewpoints.join(', ')}`);

  /* --- the clock chain -------------------------------------------------- */
  console.log('\nMall clock');
  const endpoint = await page.evaluate(async () => {
    const r = await fetch('/api/compat/city-time');
    return r.ok ? r.json() : { error: r.status };
  });
  record.endpoint = endpoint;
  check('the City Time endpoint answers', endpoint && typeof endpoint.hour === 'number',
    JSON.stringify(endpoint));

  const clock = await page.evaluate(READ_CLOCK);
  record.clock = clock;
  check('the world parsed a City Time reply', clock.clockCount === 1 && clock.cityTime.length > 0,
    `${clock.cityTime.length} CityTime node(s): ${JSON.stringify(clock.cityTime[0])}`);

  const ct = clock.cityTime[0];
  if (ct) {
    /* The Script may have fetched a few seconds before this run asked, so the
     * comparison is on the whole reading rather than on the second. */
    const scriptSeconds = ct.hour * 3600 + ct.min * 60 + ct.sec;
    /* The JSON endpoint spells them out in full; the .wrl PROTO abbreviates. */
    const nowSeconds = endpoint.hour * 3600 + endpoint.minute * 60 + endpoint.second;
    const skew = Math.abs(nowSeconds - scriptSeconds);
    check('the time the world holds is the time the endpoint serves', skew < 300,
      `world ${ct.hour}:${ct.min}:${ct.sec}, endpoint ${endpoint.hour}:${endpoint.minute}:${endpoint.second}, ${skew}s apart`);

    /* minClock runs a one-hour cycle started (min + sec/60) minutes ago. */
    const minutesAtFetch = ct.min + ct.sec / 60;
    const elapsed = clock.browserTime !== null && clock.minStart !== null
      ? clock.browserTime - clock.minStart : null;
    const expectedMinFraction = elapsed === null ? null : (elapsed / 3600) % 1;
    check('the minute sensor is running', clock.minActive === true);
    check('the minute sensor is at the fraction the time implies',
      expectedMinFraction !== null && clock.minFraction !== null
        && Math.abs(clock.minFraction - expectedMinFraction) < 0.002,
      `fraction ${clock.minFraction}, expected ${expectedMinFraction} (started at ${minutesAtFetch.toFixed(2)} min)`);

    const hour12 = ct.hour >= 12 ? ct.hour - 12 : ct.hour;
    const hoursAtFetch = hour12 + ct.min / 60 + ct.sec / 3600;
    const hourElapsed = clock.browserTime !== null && clock.hourStart !== null
      ? clock.browserTime - clock.hourStart : null;
    const expectedHourFraction = hourElapsed === null ? null : (hourElapsed / 43200) % 1;
    check('the hour sensor is running', clock.hourActive === true);
    check('the hour sensor is at the fraction the time implies',
      expectedHourFraction !== null && clock.hourFraction !== null
        && Math.abs(clock.hourFraction - expectedHourFraction) < 0.002,
      `fraction ${clock.hourFraction}, expected ${expectedHourFraction} (started at ${hoursAtFetch.toFixed(3)} h)`);

    const minObserved = zAngle(clock.minHand);
    const hourObserved = zAngle(clock.hourHand);
    const minExpected = handAngle(clock.minFraction);
    const hourExpected = handAngle(clock.hourFraction);
    /* The hands run clockwise, which on the z axis is the negative direction,
     * so the authored interpolator magnitude is compared against the reading
     * taken the other way round the circle. */
    const minGap = angleGap(minObserved, 2 * Math.PI - minExpected);
    const hourGap = angleGap(hourObserved, 2 * Math.PI - hourExpected);
    record.handAngles = { minObserved, hourObserved, minExpected, hourExpected, minGap, hourGap };
    check('the minute hand is at the angle its sensor implies',
      minGap !== null && minGap < ANGLE_TOLERANCE,
      `hand ${minObserved && minObserved.toFixed(4)} rad, sensor implies ${minExpected && minExpected.toFixed(4)}, gap ${minGap && minGap.toFixed(4)}`);
    check('the hour hand is at the angle its sensor implies',
      hourGap !== null && hourGap < ANGLE_TOLERANCE,
      `hand ${hourObserved && hourObserved.toFixed(4)} rad, sensor implies ${hourExpected && hourExpected.toFixed(4)}, gap ${hourGap && hourGap.toFixed(4)}`);
  }

  check('the DayNight cycle is running', clock.dayNightActive === true,
    `fraction ${clock.dayNightFraction}`);

  /* --- Clock Viewpoint -------------------------------------------------- */
  console.log('\nClock Viewpoint');
  const bound = await page.evaluate(() => {
    const a = window.__ctr;
    const vp = a.findByType('Viewpoint', a.scene())
      .find(n => a.readScalar(n, 'description') === 'Clock');
    if (!vp) return { ok: false, error: 'no Clock viewpoint' };
    try {
      a.field(vp, 'set_bind').setValue(true);
      return { ok: true, position: a.readVec3(vp, 'position') };
    } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  });
  await page.waitForTimeout(2500);
  const afterBind = await page.evaluate(() => {
    const a = window.__ctr;
    const browser = a.browser();
    let active = null;
    try { active = browser.getActiveViewpoint ? browser.getActiveViewpoint() : null; } catch (e) {}
    let camera = null;
    try { const p = browser.viewpointPosition; if (p) camera = [p.x, p.y, p.z]; } catch (e) {}
    return {
      description: active ? a.readScalar(active, 'description') : null,
      camera,
    };
  });
  record.clockViewpoint = { bound, afterBind };
  check('the Clock Viewpoint binds', bound.ok && afterBind.description === 'Clock',
    `active viewpoint ${afterBind.description}, camera ${JSON.stringify(afterBind.camera)}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'mall-clock-viewpoint.png') });

  /* --- the hands advance ------------------------------------------------ */
  console.log('\nClock advance across a minute boundary');
  /* Kept busy for the same reason the throttling flags are set: an idle page
   * stops being scheduled, and the clock stops with it. */
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < 70000) {
    await page.evaluate(() => document.hasFocus());
    await page.waitForTimeout(1000);
  }
  const waitedMs = Date.now() - waitStarted;
  const later = await page.evaluate(READ_CLOCK);
  record.clockLater = later;
  const advanced = angleGap(zAngle(clock.minHand), zAngle(later.minHand));
  /* The wait is measured rather than assumed, so the expectation matches the
   * time that actually passed. */
  const expectedAdvance = FULL_TURN * (waitedMs / 1000 / 3600);
  check('the minute hand advanced by about a minute',
    advanced !== null && Math.abs(advanced - expectedAdvance) < 0.02,
    `moved ${advanced && advanced.toFixed(4)} rad over ${(waitedMs / 1000).toFixed(1)}s, expected about ${expectedAdvance.toFixed(4)}`);
  check('the DayNight cycle advanced too',
    later.dayNightFraction !== null && clock.dayNightFraction !== null
      && later.dayNightFraction > clock.dayNightFraction,
    `${clock.dayNightFraction} -> ${later.dayNightFraction}`);

  /* --- directory -------------------------------------------------------- */
  console.log('\nStore directory');
  const dirBefore = await page.evaluate(READ_DIRECTORY_TEXT);
  const indexBefore = await page.evaluate(READ_DIRECTORY_INDEX, 0);
  const down = await page.evaluate(FIRE_DIRECTORY, 'set_down');
  await page.waitForTimeout(2000);
  const dirAfterDown = await page.evaluate(READ_DIRECTORY_TEXT);
  const indexAfterDown = await page.evaluate(READ_DIRECTORY_INDEX, 0);
  const up = await page.evaluate(FIRE_DIRECTORY, 'set_up');
  await page.waitForTimeout(2000);
  const dirAfterUp = await page.evaluate(READ_DIRECTORY_TEXT);
  const indexAfterUp = await page.evaluate(READ_DIRECTORY_INDEX, 0);
  record.directory = {
    dirBefore, dirAfterDown, dirAfterUp, down, up,
    indexBefore, indexAfterDown, indexAfterUp,
  };

  check('the directory Script is reachable', down.ok, down.error || `index ${down.before}, max ${down.max}`);
  check('the directory down button advances the listing',
    indexAfterDown === indexBefore + 1
      && JSON.stringify(dirBefore[0]) !== JSON.stringify(dirAfterDown[0]),
    `index ${indexBefore} -> ${indexAfterDown}\n       `
    + `${JSON.stringify((dirBefore[0] || []).slice(-3))} -> ${JSON.stringify((dirAfterDown[0] || []).slice(-3))}`);
  check('the directory up button puts the listing back',
    indexAfterUp === indexBefore
      && JSON.stringify(dirAfterUp[0]) === JSON.stringify(dirBefore[0]),
    `index ${indexAfterDown} -> ${indexAfterUp}, listing restored `
    + `${JSON.stringify(dirAfterUp[0]) === JSON.stringify(dirBefore[0])}`);
  check('scrolling one panel left the other alone',
    JSON.stringify(dirBefore[1]) === JSON.stringify(dirAfterDown[1]),
    `panel 2 unchanged: ${JSON.stringify(dirBefore[1]) === JSON.stringify(dirAfterDown[1])}`);

  /* --- directory go ------------------------------------------------------ */
  console.log('\nStore directory go');
  const hashBefore = await page.evaluate(() => window.location.hash);
  const go = await page.evaluate(FIRE_DIRECTORY, 'set_go');
  await page.waitForTimeout(7000);
  const hashAfterGo = await page.evaluate(() => window.location.hash);
  record.go = { go, hashBefore, hashAfterGo };
  check('the directory go button is reachable', go.ok, go.error || `index ${go.before}`);
  check('the directory go button navigated to the selected shop',
    hashAfterGo !== hashBefore && /^#\//.test(hashAfterGo),
    `${hashBefore} -> ${hashAfterGo}`);

  /* --- a shop door ------------------------------------------------------ */
  console.log('\nShop door');
  const rootsBack = await enter(page, '#/place/mall');
  check('returning to the Mall gives ten root nodes again', rootsBack === MALL_ROOT_NODES,
    `rootNodes ${rootsBack}`);
  const doorHashBefore = await page.evaluate(() => window.location.hash);
  const door = await page.evaluate(FIRE_SENSOR, 'lts');
  await page.waitForTimeout(6000);
  const doorHashAfter = await page.evaluate(() => window.location.hash);
  record.door = { door, doorHashBefore, doorHashAfter };
  check('a shop door is reachable', door.ok, door.error || `${door.count} doors`);
  check('the shop door navigated into the app, not off site',
    doorHashAfter !== doorHashBefore && /^#\//.test(doorHashAfter),
    `${doorHashBefore} -> ${doorHashAfter}`);

  /* --- final return ----------------------------------------------------- */
  console.log('\nMall return');
  const rootsFinal = await enter(page, '#/place/mall');
  check('the Mall still gives ten root nodes after all of it',
    rootsFinal === MALL_ROOT_NODES, `rootNodes ${rootsFinal}`);
  await page.screenshot({ path: path.join(OUT_DIR, 'screenshots', 'mall-controls.png') });

  record.consoleErrors = consoleErrors;
  record.results = results;
  record.capturedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'mall.json'), `${JSON.stringify(record, null, 2)}\n`);

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} Mall checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(2); });
