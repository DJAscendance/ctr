'use strict';

/*
 * CTR_RAPID_NAVIGATION_PROMISE_SETTLEMENT - the live half.
 *
 * One property: no world load leaves a promise pending, however fast the
 * citizen navigates.
 *
 * X_ITE 16.2.0 reports a load on two channels. The browser callback slot is
 * keyed by the component, so a second navigation replaces it and the first run
 * never hears INITIALIZED_EVENT again. The promise `loadURL()` returns is
 * private to that call, and X3DBrowser rejects it with
 * `Loading of X3D file aborted.` when a newer load supersedes it.
 *
 * startX3D() used to listen on the callback only and drop the loadURL promise,
 * so a superseded run had no way out at all. Plaza -> Mall -> Plaza at a 150 ms
 * gap stranded one startX3D() promise, one loadAndJoinPlace() promise, and left
 * the abort unanswered in the page.
 *
 * What is measured here:
 *
 *   - every loadAndJoinPlace(), startX3D() and loadURL() promise settles;
 *   - a superseded run settles quietly and does no later product work;
 *   - the current run still resolves through INITIALIZED_EVENT;
 *   - no "Loading of X3D file aborted." reaches the page unhandled;
 *   - a real failed load still rejects, and does not JOIN;
 *   - the callback slot, the canvas and the generation stay where they belong.
 *
 * Promise state is read without disturbing it. The wrappers only keep the
 * promise object; handlers are attached at the end of a scenario, after the
 * page has already had every chance to report an unhandled rejection. Wrapping
 * with a handler up front would answer X_ITE's abort for the product and hide
 * the very thing the abort count exists to prove.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/promise-settlement/tools/check-rapid-navigation.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch: launchBrowser } = require('../../lib/browser');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'rapid-navigation');

const PLAZA = { hash: '#/place/enter', name: 'Entry Plaza', slug: 'enter' };
const MALL = { hash: '#/place/mall', name: 'Mall', slug: 'mall' };

/* A world that is not there. Served by the QA stack from /assets, which 404s a
 * missing file rather than falling back to index.html, so X_ITE sees a real
 * failed load. Nothing on disk is touched. */
const MISSING_WORLD = '/assets/worlds/__qa_missing__/no-such-world.wrl';

const ABORT = 'Loading of X3D file aborted.';
const REPLACED = 'Replacing world aborted.';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(
    `${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/* ------------------------------------------------------------------ *
 * Page setup
 * ------------------------------------------------------------------ */

/* Installed before any application script runs, so nothing is missed. */
const RECORDER = `
  window.__ctrErrors = { unhandled: [], errors: [] };
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    window.__ctrErrors.unhandled.push(
      reason && reason.message ? reason.message : String(reason));
  });
  window.addEventListener('error', event => {
    window.__ctrErrors.errors.push(String(event.message));
  });
`;

async function login(browser) {
  const page = await browser.newPage();
  await page.addInitScript(RECORDER);
  page.on('console', message => {
    if (message.type() === 'error') process.stdout.write(`      console: ${message.text().slice(0, 160)}\n`);
  });
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  return page;
}

async function enter(page, world, settleMs) {
  await page.evaluate(h => { window.location.hash = h; }, world.hash);
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
    await page.waitForTimeout(1500);
    ready = await page.evaluate(() => {
      const canvas = document.querySelector('#world x3d-canvas');
      if (!canvas || !window.X3D) return false;
      const b = X3D.getBrowser(canvas);
      if (!b || !b.currentScene) return false;
      const p = b.viewpointPosition;
      return b.currentScene.rootNodes.length > 0 && !!p && p.y !== 0;
    });
  }
  await page.waitForTimeout(settleMs === undefined ? 9000 : settleMs);
  return ready;
}

/*
 * Wrap the three promise sources. Each wrapper keeps the promise and nothing
 * else: no handler is attached here.
 */
const INSTALL = () => {
  const app = document.querySelector('#app').__vue__;
  const find = c => {
    if (typeof c.startX3D === 'function' && typeof c.loadAndJoinPlace === 'function') return c;
    for (const child of c.$children) { const found = find(child); if (found) return found; }
    return null;
  };
  const comp = find(app);
  if (!comp) return { installed: false };
  if (window.__ctrNav) return { installed: true, again: true };

  const nav = {
    seq: 0, load: [], start: [], url: [], joins: [], listeners: 0,
  };
  window.__ctrNav = nav;
  window.__ctrComp = comp;

  const record = (bucket, promise, extra) => {
    const rec = Object.assign({ id: ++nav.seq, state: 'pending' }, extra);
    rec.promise = promise;
    bucket.push(rec);
    return rec;
  };

  const originalLoad = comp.loadAndJoinPlace;
  comp.loadAndJoinPlace = function () {
    const generation = comp.worldGeneration + 1;
    const promise = originalLoad.apply(this, arguments);
    record(nav.load, promise, { generation, at: Date.now() });
    return promise;
  };

  const originalStart = comp.startX3D;
  comp.startX3D = function (generation) {
    const promise = originalStart.apply(this, arguments);
    record(nav.start, promise, { generation, at: Date.now() });
    return promise;
  };

  const originalJoin = comp.joinPlace;
  comp.joinPlace = function () {
    nav.joins.push({
      at: Date.now(),
      place: comp.$store.data.place ? comp.$store.data.place.slug : null,
      generation: comp.worldGeneration,
    });
    return originalJoin.apply(this, arguments);
  };

  /* loadURL lives on the one browser the page ever builds. */
  const canvas = document.querySelector('#world x3d-canvas');
  const browser = canvas && window.X3D ? X3D.getBrowser(canvas) : null;
  if (browser && !browser.__ctrLoadURLWrapped) {
    const originalLoadURL = browser.loadURL;
    browser.loadURL = function () {
      const promise = originalLoadURL.apply(this, arguments);
      record(nav.url, promise, { url: comp.worldUrl, at: Date.now() });
      return promise;
    };
    browser.__ctrLoadURLWrapped = true;
  }
  return { installed: true, again: false, wrappedLoadURL: !!browser };
};

/*
 * Attach handlers and report. Called only once a scenario is over, so an
 * unhandled rejection has already been counted by the recorder above.
 */
const READ = async () => {
  const nav = window.__ctrNav;
  const attach = rec => {
    if (rec.tracked) return;
    rec.tracked = true;
    rec.promise.then(
      value => {
        rec.state = 'resolved';
        rec.value = value === undefined ? 'undefined' : (value === null ? 'null' : 'browser');
      },
      error => {
        rec.state = 'rejected';
        rec.error = error && error.message ? error.message : String(error);
      });
  };
  [nav.load, nav.start, nav.url].forEach(bucket => bucket.forEach(attach));
  await new Promise(resolve => setTimeout(resolve, 300));

  const strip = bucket => bucket.map(rec => ({
    id: rec.id, generation: rec.generation, state: rec.state,
    value: rec.value, error: rec.error, url: rec.url,
  }));
  return { load: strip(nav.load), start: strip(nav.start), url: strip(nav.url), joins: nav.joins };
};

const RESET = () => {
  const nav = window.__ctrNav;
  nav.load.length = 0;
  nav.start.length = 0;
  nav.url.length = 0;
  nav.joins.length = 0;
  window.__ctrErrors.unhandled.length = 0;
  window.__ctrErrors.errors.length = 0;
  delete window.ctrUnexpectedWorldLoadAbort;
};

const STATE = () => {
  const comp = window.__ctrComp;
  const canvases = document.querySelectorAll('#world x3d-canvas');
  const canvas = canvases[0];
  const browser = canvas && window.X3D ? X3D.getBrowser(canvas) : null;
  let callbacks = null;
  let callbackSource = null;
  const sources = [
    ['getBrowserCallbacks', () => browser.getBrowserCallbacks()],
    ['browserCallbacks', () => browser.browserCallbacks],
    ['_browserCallbacks', () => browser._browserCallbacks],
  ];
  for (const [name, read] of sources) {
    let table = null;
    try { table = read(); } catch (error) { table = null; }
    if (!table) continue;
    if (typeof table.size === 'number') callbacks = table.size;
    else if (typeof table === 'object') callbacks = Object.keys(table).length;
    else continue;
    callbackSource = name;
    break;
  }
  let roots = 0;
  try { roots = browser && browser.currentScene ? browser.currentScene.rootNodes.length : 0; }
  catch (error) { roots = -1; }
  const position = browser && browser.viewpointPosition
    ? [browser.viewpointPosition.x, browser.viewpointPosition.y, browser.viewpointPosition.z]
    : null;
  return {
    place: comp.$store.data.place
      ? { id: comp.$store.data.place.id, slug: comp.$store.data.place.slug } : null,
    worldGeneration: comp.worldGeneration,
    loaded: !!comp.loaded,
    worldUrl: comp.worldUrl,
    canvasCount: canvases.length,
    browserCallbacks: callbacks,
    browserCallbackSource: callbackSource,
    roots,
    position,
    unexpectedAbort: window.ctrUnexpectedWorldLoadAbort || null,
    errors: {
      unhandled: window.__ctrErrors.unhandled.slice(),
      errors: window.__ctrErrors.errors.slice(),
    },
  };
};

async function walk(page, ms) {
  const before = await page.evaluate(STATE);
  await page.evaluate(() => {
    const canvas = document.querySelector('#world x3d-canvas');
    if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
  });
  await page.waitForTimeout(300);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(ms === undefined ? 2500 : ms);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(2500);
  const after = await page.evaluate(STATE);
  if (!before.position || !after.position) return { moved: null, before, after };
  const moved = Math.hypot(
    after.position[0] - before.position[0],
    after.position[1] - before.position[1],
    after.position[2] - before.position[2]);
  return { moved, before, after };
}

/* Straight hash change, no waiting - the point of a rapid hop. */
const hop = (page, world) => page.evaluate(h => { window.location.hash = h; }, world.hash);

function pending(list) {
  return list.filter(rec => rec.state === 'pending');
}

function abortsIn(errors) {
  return errors.unhandled.filter(message => message.indexOf(ABORT) !== -1);
}

function replacedIn(errors) {
  return errors.unhandled
    .concat(errors.errors)
    .filter(message => message.indexOf(REPLACED) !== -1);
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

const evidence = {};

async function normalTransition(page) {
  process.stdout.write('\n--- normal transition: Entry Plaza -> Mall ---\n');
  await page.evaluate(RESET);
  await enter(page, MALL);
  const read = await page.evaluate(READ);
  const state = await page.evaluate(STATE);
  evidence.normal = { read, state };

  check('normal: every loadAndJoinPlace promise settled',
    pending(read.load).length === 0, read.load);
  check('normal: every startX3D promise settled',
    pending(read.start).length === 0, read.start);
  check('normal: every loadURL promise settled',
    pending(read.url).length === 0, read.url);
  check('normal: the current run resolved with the browser',
    read.start.length > 0 && read.start[read.start.length - 1].value === 'browser',
    read.start);
  check('normal: the Mall is the current place',
    state.place && state.place.slug === MALL.slug, state.place);
  check('normal: the scene has root nodes', state.roots > 0, state.roots);
  check('normal: loaded is true', state.loaded === true, state.loaded);
  check('normal: the Mall room was joined',
    read.joins.some(join => join.place === MALL.slug), read.joins);
  check('normal: one canvas', state.canvasCount === 1, state.canvasCount);
  check('normal: one browser callback slot',
    state.browserCallbacks === 1, [state.browserCallbacks, state.browserCallbackSource]);
  check('normal: no unhandled abort', abortsIn(state.errors).length === 0, state.errors.unhandled);
  check('normal: no "Replacing world aborted."', replacedIn(state.errors).length === 0,
    state.errors.unhandled);

  const walked = await walk(page);
  check('normal: WALK moves the camera', walked.moved !== null && walked.moved > 0.5, walked.moved);
  evidence.normal.walk = walked.moved;
}

/*
 * The proven failing sequence. Two hops, the second `gapMs` after the first,
 * so the second load supersedes the first while it is still in flight.
 */
async function rapid(page, gapMs) {
  const label = `rapid ${gapMs} ms`;
  process.stdout.write(`\n--- ${label}: Plaza -> Mall -> Plaza ---\n`);
  await enter(page, PLAZA);
  await page.evaluate(RESET);
  const before = await page.evaluate(STATE);

  await hop(page, MALL);
  await page.waitForTimeout(gapMs);
  await hop(page, PLAZA);

  /* Let the final world finish on its own terms. */
  await page.waitForTimeout(30000);

  const read = await page.evaluate(READ);
  const state = await page.evaluate(STATE);
  evidence[`rapid-${gapMs}`] = { read, state, before };

  const oldLoad = pending(read.load);
  const oldStart = pending(read.start);
  const oldUrl = pending(read.url);

  check(`${label}: pending loadAndJoinPlace promises = 0`, oldLoad.length === 0, oldLoad);
  check(`${label}: pending startX3D promises = 0`, oldStart.length === 0, oldStart);
  check(`${label}: pending loadURL promises = 0`, oldUrl.length === 0, oldUrl);
  check(`${label}: at least one load was superseded`,
    read.url.some(rec => rec.state === 'rejected' && String(rec.error).indexOf(ABORT) !== -1)
    || read.start.length > 1,
    read.url);
  check(`${label}: every superseded startX3D ended quietly`,
    read.start.slice(0, -1).every(rec => rec.state === 'resolved'),
    read.start);
  check(`${label}: the current startX3D resolved with the browser`,
    read.start.length > 0 && read.start[read.start.length - 1].value === 'browser',
    read.start[read.start.length - 1]);
  check(`${label}: unhandled "${ABORT}" page errors = 0`,
    abortsIn(state.errors).length === 0, state.errors.unhandled);
  check(`${label}: no abort was reported on a current generation`,
    state.unexpectedAbort === null, state.unexpectedAbort);
  check(`${label}: "${REPLACED}" = 0`, replacedIn(state.errors).length === 0, state.errors.unhandled);
  check(`${label}: the final scene is the Plaza`,
    state.place && state.place.slug === PLAZA.slug, state.place);
  check(`${label}: the final scene has root nodes`, state.roots > 0, state.roots);
  check(`${label}: loaded is true`, state.loaded === true, state.loaded);
  check(`${label}: worldGeneration advanced by two`,
    state.worldGeneration === before.worldGeneration + 2,
    [before.worldGeneration, state.worldGeneration]);
  check(`${label}: the last JOIN is the final place`,
    read.joins.length > 0 && read.joins[read.joins.length - 1].place === PLAZA.slug, read.joins);
  check(`${label}: one canvas`, state.canvasCount === 1, state.canvasCount);
  check(`${label}: one browser callback slot`,
    state.browserCallbacks === 1, [state.browserCallbacks, state.browserCallbackSource]);

  const walked = await walk(page);
  check(`${label}: WALK moves the camera`, walked.moved !== null && walked.moved > 0.5, walked.moved);
  evidence[`rapid-${gapMs}`].walk = walked.moved;
}

/* Far enough apart that the first world initialises before the second starts:
 * nothing may be cancelled here. */
async function outOfWindow(page, gapMs) {
  const label = `clean ${gapMs} ms`;
  process.stdout.write(`\n--- ${label}: Plaza -> Mall -> Plaza ---\n`);
  await enter(page, PLAZA);
  await page.evaluate(RESET);

  await hop(page, MALL);
  await page.waitForTimeout(gapMs);
  await hop(page, PLAZA);
  await page.waitForTimeout(30000);

  const read = await page.evaluate(READ);
  const state = await page.evaluate(STATE);
  evidence[`clean-${gapMs}`] = { read, state };

  check(`${label}: every promise settled`,
    pending(read.load).length === 0 && pending(read.start).length === 0
    && pending(read.url).length === 0,
    [pending(read.load).length, pending(read.start).length, pending(read.url).length]);
  check(`${label}: the final scene is the Plaza`,
    state.place && state.place.slug === PLAZA.slug, state.place);
  check(`${label}: loaded is true`, state.loaded === true, state.loaded);
  check(`${label}: one browser callback slot`, state.browserCallbacks === 1, state.browserCallbacks);
  check(`${label}: no unhandled abort`, abortsIn(state.errors).length === 0, state.errors.unhandled);
  check(`${label}: nothing was cancelled - every startX3D resolved with the browser`,
    read.start.every(rec => rec.value === 'browser'), read.start);
  check(`${label}: no abort was reported on a current generation`,
    state.unexpectedAbort === null, state.unexpectedAbort);

  const walked = await walk(page);
  check(`${label}: WALK moves the camera`, walked.moved !== null && walked.moved > 0.5, walked.moved);
  evidence[`clean-${gapMs}`].walk = walked.moved;
}

/*
 * A real failed load. The computed worldUrl is replaced on the instance for
 * one run only; the place, the routes and the assets on disk are untouched.
 */
async function realFailure(page) {
  process.stdout.write('\n--- real failed load ---\n');
  await enter(page, PLAZA);
  await page.evaluate(RESET);
  const before = await page.evaluate(STATE);

  const outcome = await page.evaluate(async missing => {
    const comp = window.__ctrComp;
    /* worldUrl is a computed, so it lives on the prototype unless something
     * has already shadowed it on the instance. Both cases are put back. */
    const descriptor = Object.getOwnPropertyDescriptor(comp, 'worldUrl');
    Object.defineProperty(comp, 'worldUrl', {
      configurable: true, enumerable: true, get: () => missing,
    });
    let state = 'pending';
    let error = null;
    try {
      await comp.startX3D(comp.worldGeneration);
      state = 'resolved';
    } catch (thrown) {
      state = 'rejected';
      error = thrown && thrown.message ? thrown.message : String(thrown);
    }
    if (descriptor) Object.defineProperty(comp, 'worldUrl', descriptor);
    else delete comp.worldUrl;
    return { state, error, restored: comp.worldUrl };
  }, MISSING_WORLD);

  await page.waitForTimeout(4000);
  const state = await page.evaluate(STATE);
  const read = await page.evaluate(READ);
  evidence.realFailure = { outcome, state, read };

  check('real failure: startX3D rejects', outcome.state === 'rejected', outcome);
  check('real failure: it is not answered as a cancellation',
    outcome.state !== 'resolved', outcome);
  check('real failure: no abort was recorded as unexpected',
    state.unexpectedAbort === null, state.unexpectedAbort);
  check('real failure: no JOIN followed it',
    read.joins.length === 0, read.joins);
  check('real failure: the place is unchanged',
    state.place && state.place.slug === PLAZA.slug, state.place);
  check('real failure: the real world URL is back',
    outcome.restored === before.worldUrl, [outcome.restored, before.worldUrl]);
  check('real failure: the old scene is still standing',
    state.roots > 0, state.roots);
  check('real failure: one browser callback slot',
    state.browserCallbacks === 1, state.browserCallbacks);
  check('real failure: one canvas', state.canvasCount === 1, state.canvasCount);

  /* The page must still be usable afterwards. */
  await enter(page, MALL);
  const recovered = await page.evaluate(STATE);
  check('real failure: the page recovers into another world',
    recovered.place && recovered.place.slug === MALL.slug && recovered.roots > 0,
    [recovered.place, recovered.roots]);
  const walked = await walk(page);
  check('real failure: WALK works after recovery',
    walked.moved !== null && walked.moved > 0.5, walked.moved);
  evidence.realFailure.recovered = recovered;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const page = await login(browser);

  const ready = await enter(page, PLAZA);
  check('the Entry Plaza is up before anything is measured', ready === true, ready);

  const installed = await page.evaluate(INSTALL);
  check('the promise wrappers are installed', installed.installed === true, installed);

  await normalTransition(page);
  await rapid(page, 150);
  await rapid(page, 400);
  await rapid(page, 800);
  await rapid(page, 1500);
  await outOfWindow(page, 3000);
  await realFailure(page);

  fs.writeFileSync(path.join(OUT_DIR, 'rapid-navigation.json'),
    `${JSON.stringify({ results, evidence }, null, 2)}\n`);

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} PASS\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(error => {
  process.stdout.write(`\nFAIL  ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
