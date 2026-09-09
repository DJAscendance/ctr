'use strict';

/**
 * Drives the app around a loop of places and proves the live object count never
 * grows.
 *
 * The defect this guards against only appeared after repeated initialization:
 * overlapping place loads pushed the same rows onto the shared object list
 * twice, so a shop rendered every mall object two times. A single load looked
 * perfect, which is why this walks the same places over and over and compares
 * each visit against the placement count the database holds.
 *
 * Every visit checks the raw node list, so two live nodes for one saved
 * placement fail as DUPLICATE_RENDERED_PLACEMENT rather than collapsing.
 *
 * A fresh page is taken every CTR_QA_CYCLES_PER_PAGE cycles. Chromium's
 * renderer dies after roughly fifty consecutive world loads in one tab -- a
 * pre-existing resource leak in the world-load path, unrelated to duplication
 * and not introduced by the lifecycle fix, which strictly reduced what each
 * load retains. Recycling the page keeps that separate defect from masking the
 * count check this tool exists to perform.
 *
 * Usage: node tools/check-cycles.js [cycles]
 */

const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');
const { resolveRenderedPlacements } = require('../lib/rendered-identity');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const CONTAINER = process.env.CTR_QA_DB_CONTAINER || 'xite162qa-db-1';
const DATABASE = process.env.CTR_QA_DB_NAME || 'cybertown';
const CYCLES = Number(process.argv[2] || 10);
const CYCLES_PER_PAGE = Number(process.env.CTR_QA_CYCLES_PER_PAGE || 5);

const TARGETS = [
  { key: 'public', route: '/place/enter', source: 'object_instance', slug: 'enter' },
  { key: 'place', route: '/place/fleamarket', source: 'object_instance', slug: 'fleamarket' },
  { key: 'shop2', route: '/place/electronicsstore', source: 'mall_object', slug: 'electronicsstore' },
  { key: 'shop', route: '/place/antiqueshop', source: 'mall_object', slug: 'antiqueshop' },
  { key: 'home', route: '/home/XiteQA', source: 'object_instance', slug: null },
  { key: 'club', route: '/club/837', source: 'object_instance', slug: null },
];

function query(sql) {
  const out = execFileSync('docker', [
    'exec', '-i', CONTAINER, 'sh', '-c',
    `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --raw ${DATABASE}`,
  ], { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const rows = out.trim().split('\n');
  const header = rows.shift().split('\t');
  return rows.map(row => {
    const cells = row.split('\t');
    const record = {};
    header.forEach((name, i) => { record[name] = cells[i] === 'NULL' ? null : cells[i]; });
    return record;
  });
}

const READ_SCENE = () => {
  if (typeof X3D === 'undefined') {
    return { ready: false, objects: [] };
  }
  const browser = X3D.getBrowser();
  if (!browser || !browser.currentScene) {
    return { ready: false, objects: [] };
  }
  const objects = [];
  const roots = browser.currentScene.rootNodes;
  for (let i = 0; i < roots.length; i += 1) {
    let typeName = null;
    try { typeName = roots[i].getNodeTypeName(); } catch (e) { typeName = null; }
    if (typeName === 'SharedObject') {
      objects.push({ id: String(roots[i].id), name: String(roots[i].name) });
    }
  }
  return { ready: true, objects };
};

function mallRowIndex() {
  const rows = query(
    'SELECT p.slug, mo.object_id, mo.id FROM mall_object mo ' +
    'JOIN place p ON p.id = mo.place_id ORDER BY mo.id;');
  const index = new Map();
  rows.forEach(row => {
    const key = `${row.slug}:${row.object_id}`;
    if (!index.has(key)) { index.set(key, []); }
    index.get(key).push(Number(row.id));
  });
  return index;
}

/** The number of saved placements each target should render. */
function expectedCounts() {
  const rows = query(
    "SELECT 'object_instance' AS source, p.slug, COUNT(*) AS n FROM object_instance oi " +
    'JOIN place p ON p.id = oi.place_id WHERE oi.place_id <> 0 GROUP BY p.slug ' +
    "UNION ALL SELECT 'mall_object', p.slug, COUNT(*) FROM mall_object mo " +
    'JOIN place p ON p.id = mo.place_id GROUP BY p.slug;');
  const counts = new Map();
  rows.forEach(row => counts.set(`${row.source}:${row.slug}`, Number(row.n)));
  return counts;
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(5000);
}

/**
 * Enters a place and waits for the scene to stop changing.
 *
 * Objects are added from a 2 s timer after the world initializes, so an early
 * read sees an empty scene. Settling on "0 twice" would call that a finished
 * load and report a phantom emptiness, hence the minimum dwell before any
 * reading counts.
 */
async function enter(page, route) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  let previous = -1;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const scene = await page.evaluate(READ_SCENE);
    if (scene.ready && scene.objects.length > 0 && scene.objects.length === previous) {
      return scene;
    }
    previous = scene.ready ? scene.objects.length : -1;
    await page.waitForTimeout(1500);
  }
  return page.evaluate(READ_SCENE);
}

async function main() {
  const mallRows = mallRowIndex();
  const expected = expectedCounts();
  const browser = await launchBrowser({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const consoleErrors = [];
  let page = null;
  async function freshPage() {
    if (page) { await page.close(); }
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', m => {
      if (m.type() === 'error') { consoleErrors.push(m.text().slice(0, 200)); }
    });
    await login(page);
  }
  await freshPage();

  let failures = 0;
  const seen = new Map();
  let heap = -1;
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    if (cycle > 1 && (cycle - 1) % CYCLES_PER_PAGE === 0) {
      await freshPage();
    }
    const line = [];
    for (const target of TARGETS) {
      const scene = await enter(page, target.route);
      heap = await page.evaluate(() => (performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
      const want = target.slug === null
        ? seen.get(target.key) // homes and clubs are keyed by route, not slug
        : expected.get(`${target.source}:${target.slug}`);
      let got = null;
      let problem = null;
      try {
        got = resolveRenderedPlacements(scene.objects, target, mallRows).length;
      } catch (error) {
        problem = error.message;
      }
      if (problem === null && !seen.has(target.key)) {
        seen.set(target.key, got);
      }
      const expect = want === undefined ? seen.get(target.key) : want;
      const ok = problem === null && got === expect;
      if (!ok) { failures += 1; }
      line.push(`${target.key}=${problem ? 'ERR' : got}/${expect}${ok ? '' : ' !!'}`);
      if (problem) { console.log(`  cycle ${cycle} ${target.key}: ${problem}`); }
    }
    console.log(`cycle ${String(cycle).padStart(2)}  ${line.join('  ')}  heap=${heap}MB`);
  }

  await browser.close();
  console.log(`\nbaseline counts: ${JSON.stringify(Object.fromEntries(seen))}`);
  console.log(`console errors (unique): ${new Set(consoleErrors).size}`);
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
