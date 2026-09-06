'use strict';

/*
 * X_ITE 16.2.0 final gate world survey.
 *
 * One browser session walks every world the final gate list names and records,
 * per world: the scene-graph census from lib/world-probe.js, every failed
 * network request, every console error, the X_ITE component requests the
 * engine made, cold and warm load timings, a frame-rate sample, and a
 * screenshot.
 *
 * It is deliberately one page for the whole run, for the same reason the memory
 * tool is: a reload between worlds builds a fresh renderer, and several of the
 * gates here (component fetches, listener bounds, scene replacement) can only
 * go wrong in a session that keeps going.
 *
 * Load timings are taken twice per world. The first visit in a session pays the
 * one-time cost of fetching shared textures and EXTERNPROTOs, so charging it to
 * the world makes every world look slow; "cold" is that first visit and "warm"
 * is a later revisit, and they are reported apart rather than averaged.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/final-gate/tools/survey-worlds.js [outDir] [samples]
 *
 * Exits 0 when every world produced a scene, 1 when one did not, 2 on a run
 * that could not complete at all.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { SURVEY_SOURCE } = require('../lib/world-probe');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

const OUT_DIR = process.argv[2]
  || path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'final-gate');
const SAMPLES = Number.parseInt(process.argv[3] || '3', 10);

/*
 * The worlds the gate list names, plus the ones the supporting matrices need.
 * `club` is resolved at run time because clubs are not seeded identically in
 * every QA database.
 */
const WORLDS = [
  { key: 'plaza', label: 'Plaza', hash: '#/place/enter' },
  { key: 'mall', label: 'Mall', hash: '#/place/mall' },
  { key: 'hitek', label: 'Hi-Tek', hash: '#/place/hitek_col' },
  { key: 'outlands', label: 'Outlands', hash: '#/place/outlands' },
  { key: 'adventure', label: 'Adventure', hash: '#/place/ad_col' },
  { key: 'innerrealms', label: 'Inner Realms', hash: '#/place/inrlms_col' },
  { key: 'electronicsstore', label: 'Electronics Store', hash: '#/place/electronicsstore' },
  { key: 'fleamarket', label: 'Flea Market', hash: '#/place/fleamarket' },
  /*
   * The QA database holds exactly one home, and it belongs to XiteQA, not to
   * the login account. `#/home/testqa` answers with a one-root scene on a 1x1
   * canvas, which is an empty world rather than a rendering fault, so the
   * survey asks for the home that exists. CTR_QA_HOME overrides it.
   */
  { key: 'home', label: 'Member home', hash: `#/home/${process.env.CTR_QA_HOME || 'XiteQA'}` },
  { key: 'club', label: 'Club', hash: null },
];

const FPS_WINDOW_MS = 4000;

function isEngineAsset(url) {
  return /x_ite@|\/x_ite\//.test(url);
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

async function resolveClub(page) {
  return page.evaluate(async () => {
    try {
      const token = localStorage.getItem('token')
        || (JSON.parse(localStorage.getItem('vuex') || '{}') || {}).token;
      const response = await fetch('/api/club/search?search=&limit=5&offset=0&orderBy=id&order=asc', {
        headers: { apiToken: token || '', bid: localStorage.getItem('bid') || '' },
      });
      if (!response.ok) return null;
      const body = await response.json();
      const first = ((body && body.results) || [])[0];
      return first ? String(first.id || first.place_id) : null;
    } catch (error) { return null; }
  });
}

/*
 * `/api/club/search` returns nothing for the QA account even though it belongs
 * to a club, so the club place id may be supplied directly. Without it the club
 * world is dropped from the plan and the run says so, rather than reporting a
 * gate it never reached.
 */
async function clubTarget(page) {
  if (process.env.CTR_QA_CLUB) return String(process.env.CTR_QA_CLUB);
  return resolveClub(page);
}

/*
 * Navigates in-app and waits until the scene stops gaining root nodes.
 *
 * The wait runs inside the page, not as a Node-side polling loop. A loop that
 * round-trips every 800 ms cannot report a load time finer than 800 ms, and the
 * first survey run proved it: every world came back within two milliseconds of
 * every other, because what was being measured was the polling interval rather
 * than the world. Timing in the page reads the same clock the engine does.
 *
 * Readiness is "root count stable across two consecutive 50 ms samples, having
 * been above zero", which is the same condition the Node-side loop used; only
 * the resolution changed.
 */
async function enter(page, hash) {
  const timing = await page.evaluate(async (h) => {
    const started = performance.now();
    window.location.hash = h;
    const roots = () => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c || typeof X3D === 'undefined') return -1;
      try {
        const s = X3D.getBrowser(c).currentScene;
        return s && s.rootNodes ? s.rootNodes.length : -1;
      } catch (e) { return -1; }
    };
    const worldURL = () => {
      const c = document.querySelector('#world x3d-canvas');
      if (!c || typeof X3D === 'undefined') return null;
      try {
        const s = X3D.getBrowser(c).currentScene;
        return s ? String(s.worldURL) : null;
      } catch (e) { return null; }
    };
    /*
     * The previous scene is still mounted at the moment the hash changes, so a
     * check that only asked "is the root count stable" latched onto the world
     * being left and reported a hundred-millisecond load for a world that had
     * not started. Readiness therefore needs the world URL to have changed
     * first, and only then the root count to settle.
     */
    const startingURL = worldURL();
    let previous = -1;
    let settleMs = null;
    let replacedMs = null;
    const deadline = started + 40000;
    while (performance.now() < deadline) {
      await new Promise(r => setTimeout(r, 50));
      if (replacedMs === null) {
        if (worldURL() !== startingURL) replacedMs = performance.now() - started;
        continue;
      }
      const now = roots();
      if (now > 0 && now === previous) { settleMs = performance.now() - started; break; }
      previous = now;
    }
    return {
      settleMs: settleMs === null ? null : Math.round(settleMs),
      replacedMs: replacedMs === null ? null : Math.round(replacedMs),
      startingURL,
      endingURL: worldURL(),
      rootNodes: previous,
    };
  }, hash);
  /* WorldBrowserPage adds the world's shared objects from a two-second timer,
   * so the scene is not finished when the root count settles. This wait is not
   * part of the load time and is reported separately. */
  await page.waitForTimeout(2600);
  return { settleMs: timing.settleMs, totalMs: timing.settleMs, replacedMs: timing.replacedMs,
    startingURL: timing.startingURL, endingURL: timing.endingURL, rootNodes: timing.rootNodes };
}

/* Counts real animation frames over a fixed window; a one-frame sample is noise. */
async function measureFps(page) {
  return page.evaluate((ms) => new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    function tick() {
      frames += 1;
      if (performance.now() - started >= ms) {
        resolve(Math.round((frames / (performance.now() - started)) * 1000 * 10) / 10);
        return;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }), FPS_WINDOW_MS);
}

function median(values) {
  const list = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'screenshots'), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  /* Collectors. `current` is retargeted before each world so every event lands
   * in the record for the world that was actually loading when it happened. */
  let current = { failures: [], consoleErrors: [], components: [] };
  const allComponents = [];

  page.on('requestfailed', (req) => {
    current.failures.push({ url: req.url(), type: req.resourceType(), reason: (req.failure() || {}).errorText });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (isEngineAsset(url)) {
      const entry = { url, status: res.status() };
      current.components.push(entry);
      allComponents.push(entry);
    }
    if (res.status() >= 400) {
      current.failures.push({ url, type: res.request().resourceType(), reason: `HTTP ${res.status()}` });
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') current.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => { current.consoleErrors.push(`pageerror: ${err.message}`); });

  await login(page);

  const clubId = await clubTarget(page);
  const plan = WORLDS.filter((w) => {
    if (w.key !== 'club') return true;
    if (!clubId) return false;
    w.hash = `#/club/${clubId}`;
    return true;
  });

  const results = [];

  for (const world of plan) {
    current = { failures: [], consoleErrors: [], components: [] };
    const timings = [];

    /*
     * Cold: the first visit of the session. The session lands somewhere after
     * login, and if that somewhere is the world about to be measured the URL
     * never changes, so the run steps away first and the timing is of a real
     * transition into the world.
     */
    const here = await page.evaluate(() => window.location.hash);
    if (here === world.hash) await enter(page, world.key === 'plaza' ? '#/place/fleamarket' : '#/place/enter');
    const cold = await enter(page, world.hash);
    const survey = await page.evaluate(SURVEY_SOURCE);
    const fps = await measureFps(page);
    await page.screenshot({
      path: path.join(OUT_DIR, 'screenshots', `${world.key}.png`),
      fullPage: false,
    });

    /*
     * Warm: leave to another world and come back, once per extra sample. This
     * also exercises world return, which several gates depend on separately.
     *
     * The world it leaves to has to differ from the world under test. Leaving
     * the Plaza to the Plaza never changes the world URL, so readiness never
     * fires and the Plaza - which the performance gate names explicitly - came
     * back unmeasured.
     */
    const away = world.key === 'plaza' ? '#/place/fleamarket' : '#/place/enter';
    const warm = [];
    for (let sample = 1; sample < SAMPLES; sample += 1) {
      await enter(page, away);
      const again = await enter(page, world.hash);
      warm.push(again.totalMs);
    }
    const surveyOnReturn = warm.length ? await page.evaluate(SURVEY_SOURCE) : null;

    results.push({
      key: world.key,
      label: world.label,
      hash: world.hash,
      coldMs: cold.totalMs,
      coldSettleMs: cold.settleMs,
      warmMs: warm,
      warmMedianMs: median(warm),
      fps,
      survey,
      surveyOnReturn,
      failures: current.failures,
      consoleErrors: current.consoleErrors,
      componentRequests: current.components,
    });

    const ok = survey && survey.ok && survey.rootNodes > 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${world.label.padEnd(18)}`
      + ` roots=${survey && survey.rootNodes} cold=${cold.totalMs}ms`
      + ` warm=${median(warm)}ms fps=${fps}`
      + ` canvas=${survey && survey.canvas ? survey.canvas.drawWidth + 'x' + survey.canvas.drawHeight : '?'}`
      + ` fails=${current.failures.length} errs=${current.consoleErrors.length}`);
    timings.length = 0;
  }

  const report = {
    engine: (results.find(r => r.survey && r.survey.engine) || { survey: {} }).survey.engine || null,
    base: BASE,
    capturedAt: new Date().toISOString(),
    clubId,
    samples: SAMPLES,
    worlds: results,
    componentRequests: allComponents,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'survey.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nengine ${report.engine}`);
  console.log(`report ${path.join(OUT_DIR, 'survey.json')}`);

  await browser.close();

  const failed = results.filter(r => !(r.survey && r.survey.ok && r.survey.rootNodes > 0));
  if (failed.length) {
    console.log(`\n${failed.length} world(s) produced no scene: ${failed.map(f => f.label).join(', ')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
