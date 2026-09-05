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
const { chromium } = require('playwright');
const { CONTROL_ENGINE_VERSION, CONTROL_COMMIT, IMPLIED_SCALE } = require('../lib/contract');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';
const OUT = process.argv[2] || path.join(__dirname, '..', 'baselines', 'rendered-15.1.12.json');
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'artifacts', 'placement');

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
];

/*
 * Individual shop worlds (`/place/<shopslug>`, `type = 'shop'`) are captured at
 * the stored layer only. Their world never finishes loading at the 15.1.12
 * baseline — `assets/worlds/shop/vrml/shop.wrl` pulls in
 * `externprotos/malldirectory/malldirectory.wrl`, which references
 * `/places/shop/sounds/*.wav`; those paths fall through the QA static server to
 * `index.html`, so X_ITE waits on audio that never decodes and
 * `INITIALIZED_EVENT` never fires. Verified stuck at 180 s. This is a content
 * and asset-path gap, not a placement defect, and it predates any engine work.
 */

const GPU_ARGS = [
  '--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl',
];

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
  const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text().slice(0, 300));
    }
  });

  await login(page);

  const phases = {};
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
    console.log(`${target.key}: initial=${initial.objects.length} ` +
      `return=${returned.objects.length} reload=${reloaded ? reloaded.objects.length : 0}`);
  }

  await browser.close();

  const records = [];
  Object.keys(phases).forEach(key => {
    const { target, initial, returned, reloaded } = phases[key];
    initial.objects.forEach(object => {
      const find = scene => (scene && scene.objects || []).find(o => o.id === object.id) || null;
      records.push({
        source: target.source,
        id: Number(object.id),
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
    engine: CONTROL_ENGINE_VERSION,
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
