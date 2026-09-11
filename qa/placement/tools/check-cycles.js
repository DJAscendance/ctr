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
const { launch: launchBrowser } = require('../../lib/browser');
const { resolveRenderedPlacements } = require('../lib/rendered-identity');
const { resolveTargets, expectedPlacements, samePath } = require('../lib/targets');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const CONTAINER = process.env.CTR_QA_DB_CONTAINER || 'xite162qa-db-1';
const DATABASE = process.env.CTR_QA_DB_NAME || 'cybertown';
const CYCLES = Number(process.argv[2] || 10);
const CYCLES_PER_PAGE = Number(process.env.CTR_QA_CYCLES_PER_PAGE || 5);

const HOME_OWNER = process.env.CTR_QA_HOME_OWNER || 'XiteQA';
const CLUB_SLUG = process.env.CTR_QA_CLUB_SLUG || 'personalclub';
const ACCEPT_PARSE_BLOCK = process.env.CTR_QA_ACCEPT_PARSE_BLOCK === '1';

/*
 * Home and club ids are resolved, never written down - see lib/targets.js. The
 * count each target must reach comes from the database for every target alike;
 * taking it from the first observation instead makes the check self-fulfilling,
 * because whatever the first cycle happened to see becomes the standard the
 * remaining cycles are measured against.
 */
const TARGETS = [
  { key: 'public', route: '/place/enter', source: 'object_instance', slug: 'enter' },
  { key: 'place', route: '/place/fleamarket', source: 'object_instance', slug: 'fleamarket' },
  { key: 'shop2', route: '/place/electronicsstore', source: 'mall_object', slug: 'electronicsstore' },
  { key: 'shop', route: '/place/antiqueshop', source: 'mall_object', slug: 'antiqueshop' },
  { key: 'home', source: 'object_instance', slug: null, homeOwner: HOME_OWNER },
  { key: 'club', source: 'object_instance', slug: null, clubSlug: CLUB_SLUG },
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
  const out = { ready: false, placeId: null, worldURL: null, expectedWorld: null, objects: [] };
  try {
    const app = document.querySelector('#app');
    const store = app && app.__vue__ && app.__vue__.$store;
    const place = store && store.data && store.data.place;
    out.placeId = place && place.id !== undefined ? Number(place.id) : null;
    out.expectedWorld = place && place.assets_dir !== null && place.assets_dir !== undefined
      ? `/assets/worlds/${place.assets_dir}${place.world_filename}` : null;
  } catch (e) { out.storeError = e.message; }
  if (typeof X3D === 'undefined') { return out; }
  const browser = X3D.getBrowser();
  if (!browser || !browser.currentScene) { return out; }
  out.ready = true;
  out.worldURL = browser.currentScene.worldURL || null;
  const roots = browser.currentScene.rootNodes;
  for (let i = 0; i < roots.length; i += 1) {
    let typeName = null;
    try { typeName = roots[i].getNodeTypeName(); } catch (e) { typeName = null; }
    if (typeName === 'SharedObject') {
      out.objects.push({ id: String(roots[i].id), name: String(roots[i].name) });
    }
  }
  return out;
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
 * Nothing counts until the SPA holds this place and X_ITE holds its world.
 * Objects are added from a 2 s timer after the world initializes, so a read
 * taken before then sees an empty scene; settling on "0 twice" would call that
 * a finished load and report a phantom emptiness. Waiting on the world instead
 * of on a fixed dwell also stops a failed load being counted, because the
 * previous world's nodes are still standing when one fails.
 */
async function enter(page, target) {
  await page.goto(`${BASE}/#${target.route}`, { waitUntil: 'domcontentloaded' });
  let previous = -1;
  let stable = 0;
  let scene = null;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await page.waitForTimeout(1000);
    scene = await page.evaluate(READ_SCENE);
    const loaded = scene.placeId === target.placeId
      && samePath(scene.worldURL, scene.expectedWorld);
    if (!loaded) { previous = -1; stable = 0; continue; }
    if (scene.objects.length === previous) {
      stable += 1;
      if (stable >= 2 || scene.objects.length === target.expected.length) { break; }
    } else { stable = 0; }
    previous = scene.objects.length;
  }
  const loaded = !!(scene && scene.placeId === target.placeId
    && samePath(scene.worldURL, scene.expectedWorld));
  return { ready: !!(scene && scene.ready), worldLoaded: loaded,
    objects: scene ? scene.objects : [] };
}

async function main() {
  const mallRows = mallRowIndex();
  const targets = resolveTargets(query, TARGETS);
  const expected = expectedPlacements(query, targets);
  targets.forEach(target => { target.expected = expected.get(target.key); });
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
  let blocked = 0;
  let heap = -1;
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    if (cycle > 1 && (cycle - 1) % CYCLES_PER_PAGE === 0) {
      await freshPage();
    }
    const line = [];
    for (const target of targets) {
      const scene = await enter(page, target);
      heap = await page.evaluate(() => (performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1));
      const expect = target.expected.length;
      if (!scene.worldLoaded) {
        // The previous world and its nodes are still standing when a load
        // fails, so counting them here would credit them to this place.
        blocked += 1;
        if (!ACCEPT_PARSE_BLOCK) { failures += 1; }
        line.push(`${target.key}=BLOCKED/${expect}${ACCEPT_PARSE_BLOCK ? '' : ' !!'}`);
        continue;
      }
      let got = null;
      let problem = null;
      try {
        got = resolveRenderedPlacements(scene.objects, target, mallRows).length;
      } catch (error) {
        problem = error.message;
      }
      const ok = problem === null && got === expect;
      if (!ok) { failures += 1; }
      line.push(`${target.key}=${problem ? 'ERR' : got}/${expect}${ok ? '' : ' !!'}`);
      if (problem) { console.log(`  cycle ${cycle} ${target.key}: ${problem}`); }
    }
    console.log(`cycle ${String(cycle).padStart(2)}  ${line.join('  ')}  heap=${heap}MB`);
  }

  await browser.close();
  console.log(`\nexpected counts: ${JSON.stringify(Object.fromEntries(
    targets.map(t => [t.key, t.expected.length])))}`);
  console.log(`blocked visits: ${blocked}`);
  console.log(`console errors (unique): ${new Set(consoleErrors).size}`);
  console.log(failures === 0 ? 'PASS' : `FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
