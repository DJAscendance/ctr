'use strict';

/*
 * Repeated-world memory regression run.
 *
 * The defect this guards is retention across world replacement: the tab used to
 * die at roughly fifty world loads, and every earlier attempt to measure it was
 * inconclusive because the QA tools reloaded the page between worlds. A reload
 * builds a fresh renderer with a fresh heap, which is precisely the state the
 * defect does not live in.
 *
 * So the hard rule of this tool is one page for the whole run. It logs in once,
 * then drives every transition by writing `location.hash`. It never calls
 * page.goto again, never closes the page, and never restarts Chromium. If it
 * did, a passing result would prove nothing.
 *
 * What it records per transition is in lib/probe.js. What it decides on is
 * lib/gates.js. This file is only the driver.
 *
 * Usage:
 *   NODE_PATH=<dir containing playwright> \
 *   DISPLAY=:1 node qa/memory/tools/check-world-memory.js [transitions] [outDir]
 *
 * Exits 0 on PASS, 1 on a gate failure, 2 on a run that could not complete.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');

const { PROBE_SOURCE } = require('../lib/probe');
const { evaluateGates, formatReport } = require('../lib/gates');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

const TRANSITIONS = Number.parseInt(process.argv[2] || '100', 10);
const OUT_DIR = process.argv[3] || path.join(__dirname, '..', '..', '..', 'artifacts', 'memory');

/*
 * One cycle mixes the world kinds that matter: a public plaza, the Mall and
 * repeated returns to it, two different shops, the flea market, and a member
 * home. The home is not decoration - it is served by a different route record
 * (`user-home`) than the shops (`world-browser`), so it is the only step that
 * forces vue-router to destroy and rebuild WorldBrowserPage. A plan made only
 * of `/place/:id` slugs reuses one component instance for the whole run and
 * cannot expose a mount-time registration that is never undone.
 */
const CYCLE = [
  { kind: 'place', slug: 'enter', label: 'Plaza' },
  { kind: 'place', slug: 'mall', label: 'Mall' },
  { kind: 'place', slug: 'electronicsstore', label: 'Electronics Store' },
  { kind: 'place', slug: 'mall', label: 'Mall' },
  { kind: 'place', slug: 'fleamarket', label: 'Flea Market' },
  { kind: 'home', slug: USER, label: 'Member home' },
  { kind: 'club', slug: null, label: 'Club' },
  { kind: 'place', slug: 'mall', label: 'Mall' },
  { kind: 'place', slug: 'antiqueshop', label: 'Antique Shop' },
  { kind: 'place', slug: 'mall', label: 'Mall' },
];

/* Forced-GC checkpoints. 1 is the warm-up reference every later one is read against. */
const CHECKPOINTS = [1, 5, 10, 20, 40, 60, 80, 100];

function hashFor(step) {
  if (step.kind === 'home') return `#/home/${step.slug}`;
  if (step.kind === 'club') return `#/club/${step.slug}`;
  return `#/place/${step.slug}`;
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
}

/*
 * Resolves a club the test account can enter, so the plan can include the third
 * route record. Clubs are not seeded in every QA database; when none is found
 * the club step is dropped and the run records why, rather than spending every
 * cycle on a route that never loads.
 */
async function resolveClub(page) {
  return page.evaluate(async () => {
    try {
      const token = (JSON.parse(localStorage.getItem('vuex') || '{}') || {}).token
        || localStorage.getItem('token');
      const query = 'search=&limit=5&offset=0&orderBy=id&order=asc';
      const response = await fetch(`/api/club/search?${query}`, {
        headers: { apiToken: token || '', bid: localStorage.getItem('bid') || '' },
      });
      if (!response.ok) return null;
      const body = await response.json();
      const rows = (body && body.results) || [];
      const first = rows[0];
      return first ? String(first.id || first.place_id) : null;
    } catch (error) {
      return null;
    }
  });
}

/*
 * Navigates in-app and waits until the scene stops gaining root nodes.
 *
 * The final probe is taken after a further pause rather than at the moment the
 * root count settles. WorldBrowserPage adds a world's shared objects from a
 * two-second timer, so a sample taken the instant the scene is ready reads
 * `sharedObjectsMapSize` as zero for a world that is about to have ten. Reading
 * early made the same route report 0 on one visit and 10 on another, which the
 * drift gate cannot tell apart from real growth.
 */
const SHARED_OBJECT_SETTLE_MS = 2600;

async function enter(page, step) {
  const target = hashFor(step);
  await page.evaluate((h) => { window.location.hash = h; }, target);
  let previous = -1;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    await page.waitForTimeout(1200);
    const sample = await page.evaluate(PROBE_SOURCE);
    if (sample.rootNodes > 0 && sample.rootNodes === previous) break;
    previous = sample.rootNodes;
  }
  await page.waitForTimeout(SHARED_OBJECT_SETTLE_MS);
  return page.evaluate(PROBE_SOURCE);
}

/*
 * Forced GC plus a settled heap read.
 *
 * collectGarbage is asked for twice with a pause between: the first pass can
 * leave objects that only became unreachable because the first pass ran. The
 * number this returns is the one the slope is measured on, because an
 * un-collected heap reading rises and falls with allocation noise that has
 * nothing to do with retention.
 */
async function forcedHeap(cdp) {
  for (let pass = 0; pass < 2; pass += 1) {
    await cdp.send('HeapProfiler.collectGarbage');
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const usage = await cdp.send('Runtime.getHeapUsage');
  return { retainedHeap: usage.usedSize, totalHeap: usage.totalSize };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await launchBrowser({
    args: [
      '--no-sandbox',
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('Runtime.enable');

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  let rendererDied = null;
  page.on('crash', () => { rendererDied = 'page crashed'; });

  const rows = [];
  const notes = [];
  let completed = 0;

  try {
    await login(page);

    const clubId = await resolveClub(page);
    if (!clubId) {
      notes.push('no club found for the test account; club step skipped this run');
    }
    const plan = CYCLE
      .filter(step => step.kind !== 'club' || clubId)
      .map(step => (step.kind === 'club' ? Object.assign({}, step, { slug: clubId }) : step));

    for (let i = 1; i <= TRANSITIONS; i += 1) {
      const step = plan[(i - 1) % plan.length];
      const before = consoleErrors.length;
      const sample = await enter(page, step);
      completed = i;

      const row = Object.assign({
        transition: i,
        route: hashFor(step),
        label: step.label,
        newConsoleErrors: consoleErrors.slice(before),
      }, sample);

      if (CHECKPOINTS.includes(i) || i === TRANSITIONS) {
        Object.assign(row, await forcedHeap(cdp));
        /* Re-probe after GC: listener and node counts must survive collection. */
        const settled = await page.evaluate(PROBE_SOURCE);
        row.postGcListenerTotal = settled.listenerTotal;
        row.postGcCanvasCount = settled.canvasCount;
        row.checkpoint = true;
      }

      rows.push(row);
      process.stdout.write(
        `#${String(i).padStart(3)} ${step.label.padEnd(18)} roots=${row.rootNodes}` +
        ` canvas=${row.canvasCount} listeners=${row.listenerTotal}` +
        ` scene=${row.sceneId}` +
        (row.retainedHeap ? ` retained=${(row.retainedHeap / 1048576).toFixed(1)}MB` : '') +
        '\n');

      if (rendererDied) break;
    }
  } catch (error) {
    rendererDied = rendererDied || String(error);
  }

  const result = evaluateGates({
    rows, requested: TRANSITIONS, completed, rendererDied, notes,
  });

  fs.writeFileSync(path.join(OUT_DIR, 'memory-run.json'),
    `${JSON.stringify({ result, rows }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'memory-run.csv'), toCsv(rows));
  process.stdout.write(formatReport(result));

  await browser.close();
  if (rendererDied) process.exit(2);
  process.exit(result.verdict === 'PASS' ? 0 : 1);
}

function toCsv(rows) {
  const columns = [
    'transition', 'route', 'label', 'rootNodes', 'canvasCount', 'worldCanvasCount',
    'sharedObjectsMapSize', 'sharedObjectsLength', 'browserCallbacks', 'listenerTotal',
    'sceneId', 'worldGeneration', 'vueComponentCount', 'heapUsed', 'retainedHeap',
  ];
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => (row[c] === undefined || row[c] === null ? '' : row[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

main();
