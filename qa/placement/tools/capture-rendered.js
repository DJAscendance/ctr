'use strict';

/**
 * Captures the rendered placement layer from the live CTR application.
 *
 * Objects are identified by the CTR object id carried on the SharedObject
 * PROTO instance, never by scene order. For each target place the tool records
 * three phases: the first world load, a return after leaving the place, and a
 * capture after a full page reload.
 *
 * Every expected placement row gets a record, whether or not it rendered. A
 * place that never loaded therefore reports blocked rows rather than a short
 * list, so a comparison can never mistake "not observed" for "unchanged".
 *
 * Rendering runs on the real GPU (ANGLE/OpenGL); software rasterisation is only
 * a fallback. Transforms are scene-graph values, so the rasteriser does not
 * affect them, but GPU rendering keeps the run fast and the screenshots honest.
 *
 * Usage: node tools/capture-rendered.js [outfile]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch: launchBrowser } = require('../../lib/browser');
const { CONTROL_ENGINE_VERSION, CONTROL_COMMIT, IMPLIED_SCALE } = require('../lib/contract');
const { resolveRenderedPlacements } = require('../lib/rendered-identity');
const { resolveTargets, expectedPlacements, samePath } = require('../lib/targets');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const HOME_OWNER = process.env.CTR_QA_HOME_OWNER || 'XiteQA';
const CLUB_SLUG = process.env.CTR_QA_CLUB_SLUG || 'personalclub';
const OUT = process.argv[2] || path.join(__dirname, '..', 'baselines', 'rendered-15.1.12.json');
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'placement');
const CONTAINER = process.env.CTR_QA_DB_CONTAINER || 'xite162qa-db-1';
const DATABASE = process.env.CTR_QA_DB_NAME || 'cybertown';

/** How long one phase may take to settle, in polls of POLL_MS. */
const POLL_MS = 1000;
const POLL_LIMIT = 45;

/**
 * Capture targets.
 *
 * Routes matter: `/place/:id` resolves a place by **slug**, so a numeric place
 * id there leaves the store empty and the world never loads. Homes go through
 * `/home/:username` and clubs through `/club/:placeId`. Shop places serve
 * `mall_object` rows; everything else serves `object_instance`.
 *
 * Neither the home nor the club place has a stable id across databases, so both
 * are looked up rather than written down. A hard-coded `/club/837` silently
 * misses on any freshly seeded database: the route resolves to some other place
 * or to the club door, and the capture then records nothing for ten real rows.
 */
const TARGETS = [
  { key: 'public', route: '/place/enter', source: 'object_instance', slug: 'enter' },
  { key: 'home', source: 'object_instance', slug: null, homeOwner: HOME_OWNER },
  { key: 'club', source: 'object_instance', slug: null, clubSlug: CLUB_SLUG },
  { key: 'place', route: '/place/fleamarket', source: 'object_instance', slug: 'fleamarket' },
  { key: 'shop', route: '/place/antiqueshop', source: 'mall_object', slug: 'antiqueshop' },
  { key: 'shop2', route: '/place/electronicsstore', source: 'mall_object', slug: 'electronicsstore' },
];

/*
 * Shop identity needs a translation step.
 *
 * `GET /api/mall/objects/:placeId` selects `object.*` alongside the mall row's
 * position and rotation, so `object.id` shadows `mall_object.id` and the id the
 * SPA puts on the SharedObject PROTO is the **catalogue object id**, not the
 * placement row id. The stored layer keys on `mall_object.id`, so this tool
 * resolves `(place_id, object_id)` back to the real row id below. Nothing is
 * ever matched by scene order.
 */

/**
 * Reads the live scene, the place the SPA believes it is in, and the world the
 * engine actually loaded.
 *
 * The last two are what stop a scene being credited to the wrong place. When a
 * route fails - `/api/home/:username` rejecting, or a world whose parse aborts
 * - Vue never swaps the place and X_ITE never swaps the world, so the previous
 * world and its SharedObject nodes are still standing. Reading only the node
 * list there reports the old place's objects as the new place's, which looks
 * exactly like a partial render of the place under test.
 */
const READ_SCENE = () => {
  const out = { ready: false, reason: null, placeId: null, worldURL: null, objects: [] };
  try {
    const app = document.querySelector('#app');
    const store = app && app.__vue_app__ && app.__vue_app__.config.globalProperties.$store;
    const place = store && store.data && store.data.place;
    out.placeId = place && place.id !== undefined ? Number(place.id) : null;
    out.expectedWorld = place && place.assets_dir !== null && place.assets_dir !== undefined
      ? `/assets/worlds/${place.assets_dir}${place.world_filename}` : null;
  } catch (e) {
    out.storeError = e.message;
  }
  if (typeof X3D === 'undefined') {
    out.reason = 'no X3D global';
    return out;
  }
  const browser = X3D.getBrowser();
  if (!browser || !browser.currentScene) {
    out.reason = 'no currentScene';
    return out;
  }
  out.ready = true;
  out.engine = browser.getVersion ? browser.getVersion() : null;
  out.worldURL = browser.currentScene.worldURL || null;
  const roots = browser.currentScene.rootNodes;
  for (let i = 0; i < roots.length; i += 1) {
    const node = roots[i];
    let typeName = null;
    try {
      typeName = node.getNodeTypeName();
    } catch (e) {
      typeName = null;
    }
    if (typeName !== 'SharedObject') {
      continue;
    }
    const record = { id: String(node.id), name: String(node.name) };
    try {
      record.position = { x: node.translation.x, y: node.translation.y, z: node.translation.z };
      record.rotation = {
        x: node.rotation.x, y: node.rotation.y, z: node.rotation.z, angle: node.rotation.angle,
      };
    } catch (e) {
      record.error = e.message;
    }
    out.objects.push(record);
  }
  return out;
};

/** Runs a read-only query against the QA database. */
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
    header.forEach((name, i) => {
      record[name] = cells[i] === 'NULL' ? null : cells[i];
    });
    return record;
  });
}

/**
 * Maps `<place slug>:<object id>` to every `mall_object.id` that uses it.
 *
 * Every row is kept rather than the first, so a shop stocking one catalogue
 * object twice shows up as two real placements. resolve-time is where that is
 * judged: two rows under one key means the rendered node cannot be tied to
 * either, which `resolveRenderedPlacements` reports as AMBIGUOUS_MALL_IDENTITY.
 */
function mallRowIndex(slugs) {
  if (slugs.length === 0) {
    return new Map();
  }
  const list = slugs.map(slug => `'${slug}'`).join(',');
  const rows = query(
    `SELECT p.slug, mo.object_id, mo.id FROM mall_object mo ` +
    `JOIN place p ON p.id = mo.place_id WHERE p.slug IN (${list}) ORDER BY mo.id;`);
  const index = new Map();
  rows.forEach(row => {
    const key = `${row.slug}:${row.object_id}`;
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(Number(row.id));
  });
  return index;
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => !/#\/login/.test(window.location.hash), null, { timeout: 30000 });
}

/**
 * Observes one phase and reports what it actually saw.
 *
 * Settling is driven by application state, not by a fixed wait: the place the
 * SPA holds, the world X_ITE loaded, and an object count that has stopped
 * changing. The poll ceiling is only an upper bound on how long a real signal
 * is waited for; reaching it is reported as `settled: false`, never as a pass.
 */
async function observe(page, target) {
  let previous = -1;
  let stable = 0;
  let scene = null;
  for (let attempt = 0; attempt < POLL_LIMIT; attempt += 1) {
    await page.waitForTimeout(POLL_MS);
    scene = await page.evaluate(READ_SCENE);
    const inPlace = scene.placeId === target.placeId;
    const worldLoaded = inPlace && samePath(scene.worldURL, scene.expectedWorld);
    if (!inPlace || !worldLoaded) {
      previous = -1;
      stable = 0;
      continue;
    }
    if (scene.objects.length === previous) {
      stable += 1;
      // Two identical reads after the world is up, and the count is the one the
      // database holds: nothing further is going to arrive.
      if (stable >= 2 || scene.objects.length === target.expected.length) {
        break;
      }
    } else {
      stable = 0;
    }
    previous = scene.objects.length;
  }
  const inPlace = scene && scene.placeId === target.placeId;
  return {
    ready: !!(scene && scene.ready),
    inPlace,
    worldURL: scene ? scene.worldURL : null,
    expectedWorld: scene ? scene.expectedWorld : null,
    worldLoaded: !!(inPlace && samePath(scene.worldURL, scene.expectedWorld)),
    settled: !!(inPlace && scene && scene.objects.length === target.expected.length),
    engine: scene ? scene.engine : null,
    objects: scene ? scene.objects : [],
  };
}

async function enter(page, target) {
  await page.goto(`${BASE}/#${target.route}`, { waitUntil: 'domcontentloaded' });
  return observe(page, target);
}

/**
 * Forces a hash-route change so Vue tears the world down before we come back.
 *
 * The teardown is waited for, not assumed. The map page is 2D and never calls
 * `setPlace`, so `$store.data.place` still names the place we just left; what
 * does change is the loaded world, which the 2D branch replaces with an empty
 * scene whose `worldURL` is the page itself. That replacement is the teardown,
 * so it is the signal, and a return is only a real return once it has happened.
 */
async function leave(page, target) {
  await page.goto(`${BASE}/#/citymap`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    world => {
      if (typeof X3D === 'undefined') {
        return true;
      }
      const browser = X3D.getBrowser();
      if (!browser || !browser.currentScene) {
        return true;
      }
      const strip = value => String(value)
        .replace(/^https?:\/\/[^/]+/, '').replace(/\/{2,}/g, '/');
      return strip(browser.currentScene.worldURL || '') !== strip(world);
    },
    target.loadedWorld,
    { timeout: 30000 });
}

/** Indexes one phase's nodes by placement row id, or reports why it has none. */
function indexPhase(phase, target, mallRows) {
  if (!phase || !phase.worldLoaded) {
    return { byId: new Map(), blocked: true };
  }
  const resolved = resolveRenderedPlacements(phase.objects, target, mallRows);
  const byId = new Map();
  resolved.forEach(entry => byId.set(entry.id, entry));
  return { byId, blocked: false };
}

function transformOf(entry) {
  return entry ? { position: entry.node.position, rotation: entry.node.rotation } : null;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const targets = resolveTargets(query, TARGETS);
  const expected = expectedPlacements(query, targets);
  targets.forEach(target => { target.expected = expected.get(target.key); });
  const mallRows = mallRowIndex(targets.filter(t => t.source === 'mall_object').map(t => t.slug));

  const browser = await launchBrowser({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });

  await login(page);

  /*
   * The engine version is read from the runtime that actually produced this
   * capture, not from the contract constant. A capture labelled with the
   * control version regardless of what ran would let an upgrade compare
   * "15.1.12 -> 15.1.12" while a different engine was under test.
   */
  let observedEngine = null;
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  const records = [];
  const coverage = [];

  for (const target of targets) {
    const before = consoleErrors.length;
    const initial = await enter(page, target);
    await page.screenshot({ path: path.join(SHOTS, `${target.key}-initial.png`) });

    let returned = null;
    let reloaded = null;
    if (initial.worldLoaded) {
      target.loadedWorld = initial.worldURL;
      await leave(page, target);
      returned = await enter(page, target);
      await page.reload({ waitUntil: 'domcontentloaded' });
      reloaded = await observe(page, target);
      await page.screenshot({ path: path.join(SHOTS, `${target.key}-reload.png`) });
    }

    const phaseErrors = consoleErrors.slice(before);
    const parseError = phaseErrors.find(text => /Parser error/i.test(text)) || null;
    const initialIndex = indexPhase(initial, target, mallRows);
    const returnIndex = indexPhase(returned, target, mallRows);
    const reloadIndex = indexPhase(reloaded, target, mallRows);

    target.expected.forEach(id => {
      const entry = initialIndex.byId.get(id);
      let observation = 'RENDERED';
      if (!initial.worldLoaded) {
        observation = parseError ? 'WORLD_PARSE_BLOCK' : 'WORLD_NOT_LOADED';
      } else if (!entry) {
        observation = 'NOT_RENDERED';
      }
      records.push({
        source: target.source,
        id,
        objectId: entry ? entry.objectId : null,
        placeKey: target.key,
        placeId: target.placeId,
        observation,
        rendered: entry ? {
          position: entry.node.position,
          rotation: entry.node.rotation,
          scale: IMPLIED_SCALE,
        } : null,
        renderedOnReturn: transformOf(returnIndex.byId.get(id)),
        renderedOnReload: transformOf(reloadIndex.byId.get(id)),
      });
    });

    coverage.push({
      placeKey: target.key,
      placeId: target.placeId,
      route: target.route,
      source: target.source,
      expected: target.expected.length,
      worldURL: initial.worldURL,
      expectedWorld: initial.expectedWorld,
      worldLoaded: initial.worldLoaded,
      parseError,
      initial: initialIndex.byId.size,
      return: returnIndex.byId.size,
      reload: reloadIndex.byId.size,
      settled: { initial: initial.settled, return: returned && returned.settled,
        reload: reloaded && reloaded.settled },
    });
    if (!observedEngine && initial.engine) observedEngine = initial.engine;
    console.log(`${target.key}: expected=${target.expected.length} ` +
      `world=${initial.worldLoaded ? 'loaded' : 'BLOCKED'} ` +
      `initial=${initialIndex.byId.size} return=${returnIndex.byId.size} ` +
      `reload=${reloadIndex.byId.size}`);
  }

  await browser.close();

  const capture = {
    layer: 'rendered',
    engine: observedEngine || CONTROL_ENGINE_VERSION,
    commit: CONTROL_COMMIT,
    renderer,
    baseUrl: BASE,
    capturedAt: new Date().toISOString(),
    consoleErrors: Array.from(new Set(consoleErrors)),
    coverage,
    records,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(capture, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${records.length} rendered placement records`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
