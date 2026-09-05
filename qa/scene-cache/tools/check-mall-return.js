'use strict';

/**
 * Proves the Mall still loads on a second visit inside one page session.
 *
 * This is the live counterpart to test/scene-cache.test.js. The unit tests hold
 * the cache contract; this one holds the symptom that contract was written for,
 * because only a real X_ITE run can show a world coming back with no root nodes.
 *
 * Navigation is deliberately done by writing `location.hash`, never
 * `page.goto`. A full page load builds a new X_ITE runtime with an empty scene
 * cache, so it cannot reproduce the defect at all; the failure only appears on
 * the second Mall load within one page session.
 *
 * The route list walks Mall -> shop -> Mall and Mall -> Plaza -> Mall, and
 * every Mall load must report `rootNodes > 0`.
 *
 * Usage: node tools/check-mall-return.js
 * Requires the QA frontend from qa/placement/README.md and `playwright` on
 * NODE_PATH; exits non-zero on any empty Mall.
 */

const { chromium } = require('playwright');

const BASE = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const USER = process.env.CTR_QA_USER || 'testqa';
const PASS = process.env.CTR_QA_PASS || 'testqa';

/* Mall, then somewhere else, then Mall again — each detour a different kind. */
const ROUTE_PLAN = [
  'mall',
  'fineartshop', 'mall',
  'generalstore', 'mall',
  'electronicsstore', 'mall',
  'enter', 'mall',
];

const READ_SCENE = () => {
  const canvas = document.querySelector('#world x3d-canvas');
  if (!canvas) {
    return { rootNodes: -1, worldURL: null };
  }
  try {
    const scene = X3D.getBrowser(canvas).currentScene;
    return {
      rootNodes: scene ? scene.rootNodes.length : -1,
      worldURL: scene ? String(scene.worldURL) : null,
    };
  } catch (error) {
    return { rootNodes: -1, worldURL: null, error: String(error) };
  }
};

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], input[name="username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(8000);
}

/** Navigates in-app and waits until the scene stops gaining root nodes. */
async function enter(page, slug) {
  await page.evaluate(s => { window.location.hash = `#/place/${s}`; }, slug);
  let previous = -1;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    await page.waitForTimeout(1500);
    const scene = await page.evaluate(READ_SCENE);
    if (scene.rootNodes > 0 && scene.rootNodes === previous) {
      return scene;
    }
    previous = scene.rootNodes;
  }
  return page.evaluate(READ_SCENE);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await login(page);

  const failures = [];
  const mallLoads = [];

  for (const slug of ROUTE_PLAN) {
    const scene = await enter(page, slug);
    console.log(`${slug.padEnd(18)} rootNodes=${scene.rootNodes}`);
    if (slug === 'mall') {
      mallLoads.push(scene.rootNodes);
      if (!(scene.rootNodes > 0)) {
        failures.push(`mall load ${mallLoads.length} returned rootNodes=${scene.rootNodes}`);
      }
    }
  }

  await browser.close();

  console.log(`\nmall loads: ${mallLoads.length}, root nodes ${JSON.stringify(mallLoads)}`);
  failures.forEach(failure => console.log(`FAIL ${failure}`));
  console.log(failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
