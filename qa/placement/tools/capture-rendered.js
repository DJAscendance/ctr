'use strict';

/**
 * Captures the rendered placement layer from the live CTR application.
 *
 * Objects are identified by the CTR object id carried on the SharedObject
 * PROTO instance, never by scene order. For each target place the tool records
 * three phases: the first world load, a return after leaving the place, and a
 * capture after a full page reload.
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
const { chromium } = require('playwright');
const { launch: launchBrowser } = require('../../lib/browser');
const { CONTROL_ENGINE_VERSION, CONTROL_COMMIT, IMPLIED_SCALE } = require('../lib/contract');
const { resolveRenderedPlacements } = require('../lib/rendered-identity');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT = process.argv[2] || path.join(__dirname, '..', 'baselines', 'rendered-15.1.12.json');
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'placement');
const CONTAINER = process.env.CTR_QA_DB_CONTAINER || 'xite162qa-db-1';
const DATABASE = process.env.CTR_QA_DB_NAME || 'cybertown';

/**
 * Capture targets.
 *
 * Routes matter: `/place/:id` resolves a place by **slug**, so a numeric place
 * id there leaves the store empty and the world never loads. Homes go through
 * `/home/:username` and clubs through `/club/:id`. Shop places serve
 * `mall_object` rows; everything else serves `object_instance`.
 */
const TARGETS = [
  { key: 'public', route: '/place/enter', source: 'object_instance' },
  { key: 'home', route: '/home/XiteQA', source: 'object_instance' },
  { key: 'club', route: '/club/837', source: 'object_instance' },
  { key: 'place', route: '/place/fleamarket', source: 'object_instance' },
  /*
   * BETA PHASE 2: the two shop targets are not captured on this branch.
   *
   * Every `type = 'shop'` place shares assets/worlds/shop/vrml/shop.wrl, and on
   * this branch that file still carries the blaxxun multiuser `DEF S Script` at
   * top level, using IS statements outside a PROTO. The parse aborts there, so a
   * shop renders nothing to compare on a return or a reload. That is world
   * CONTENT and it predates the engine work - it is present unchanged at the
   * fork point, under X_ITE 4.7.0, and the X_ITE 16.2.0 migration neither caused
   * it nor is scoped to fix it. It is recorded, not repaired.
   *
   * The 49 object_instance placements above still cover home, club, place and
   * public, which is what the migration can actually move.
   *
   * { key: 'shop', route: '/place/antiqueshop', source: 'mall_object', slug: 'antiqueshop' },
   * { key: 'shop2', route: '/place/electronicsstore', source: 'mall_object', slug: 'electronicsstore' },
   */
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
 *
 * Every `type = 'shop'` place shares one world, `assets/worlds/shop/vrml/shop.wrl`,
 * so the two shop targets above cover all 11 `mall_object` fixtures between them:
 * antiqueshop holds 10 and electronicsstore 1. Both are captured, because a
 * shared world means a per-place bug would otherwise hide behind a single pass.
 */

/** Reads every SharedObject PROTO instance out of the live scene. */
const READ_SCENE = () => {
  if (typeof X3D === 'undefined') {
    return { ready: false, reason: 'no X3D global', objects: [] };
  }
  const browser = X3D.getBrowser();
  if (!browser || !browser.currentScene) {
    return { ready: false, reason: 'no currentScene', objects: [] };
  }
  const roots = browser.currentScene.rootNodes;
  const objects = [];
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
    objects.push(record);
  }
  return {
    ready: true,
    engine: browser.getVersion ? browser.getVersion() : null,
    worldURL: browser.currentScene.worldURL || null,
    objects,
  };
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
  await page.waitForTimeout(5000);
}

/** Navigates to a place and waits until the scene stops gaining objects. */
async function enter(page, route) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'domcontentloaded' });
  let previous = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(1500);
    const scene = await page.evaluate(READ_SCENE);
    if (scene.ready && scene.objects.length > 0 && scene.objects.length === previous) {
      return scene;
    }
    previous = scene.ready ? scene.objects.length : -1;
  }
  return page.evaluate(READ_SCENE);
}

/** Forces a hash-route change so Vue tears the world down before we come back. */
async function leave(page) {
  await page.goto(`${BASE}/#/citymap`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launchBrowser({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });

  await login(page);

  const phases = {};
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

  for (const target of TARGETS) {
    const initial = await enter(page, target.route);
    await page.screenshot({ path: path.join(SHOTS, `${target.key}-initial.png`) });

    await leave(page);
    const returned = await enter(page, target.route);

    await page.reload({ waitUntil: 'domcontentloaded' });
    let reloaded = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await page.waitForTimeout(1500);
      reloaded = await page.evaluate(READ_SCENE);
      if (reloaded.ready && reloaded.objects.length >= initial.objects.length) {
        break;
      }
    }
    await page.screenshot({ path: path.join(SHOTS, `${target.key}-reload.png`) });

    phases[target.key] = { target, initial, returned, reloaded };
    if (!observedEngine && initial.engine) observedEngine = initial.engine;
    console.log(`${target.key}: initial=${initial.objects.length} ` +
      `return=${returned.objects.length} reload=${reloaded ? reloaded.objects.length : 0}`);
  }

  await browser.close();

  const mallRows = mallRowIndex(TARGETS.filter(t => t.slug).map(t => t.slug));

  /*
   * Every phase is resolved from its raw node list, so a world that rendered one
   * saved placement twice fails here rather than quietly collapsing into a
   * single record further down.
   */
  const records = [];
  Object.keys(phases).forEach(key => {
    const { target, initial, returned, reloaded } = phases[key];
    const identity = Object.assign({ placeKey: key }, target);
    [['initial', initial], ['return', returned], ['reload', reloaded]].forEach(([phase, scene]) => {
      if (!scene) {
        return;
      }
      try {
        resolveRenderedPlacements(scene.objects, identity, mallRows);
      } catch (error) {
        throw new Error(`${key} (${phase}): ${error.message}`);
      }
    });
    const resolved = resolveRenderedPlacements(initial.objects, identity, mallRows);
    resolved.forEach(({ id, objectId, node: object }) => {
      const find = scene => (scene && scene.objects || []).find(o => o.id === object.id) || null;
      records.push({
        source: target.source,
        id,
        objectId,
        placeKey: key,
        rendered: {
          position: object.position,
          rotation: object.rotation,
          scale: IMPLIED_SCALE,
        },
        renderedOnReturn: find(returned) && {
          position: find(returned).position, rotation: find(returned).rotation,
        },
        renderedOnReload: find(reloaded) && {
          position: find(reloaded).position, rotation: find(reloaded).rotation,
        },
      });
    });
  });

  const capture = {
    layer: 'rendered',
    engine: observedEngine || CONTROL_ENGINE_VERSION,
    commit: CONTROL_COMMIT,
    renderer,
    baseUrl: BASE,
    capturedAt: new Date().toISOString(),
    consoleErrors: Array.from(new Set(consoleErrors)),
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
