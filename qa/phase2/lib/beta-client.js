'use strict';
const { chromium } = require('playwright');
const URL = process.env.CTR_QA_URL || 'http://127.0.0.1:8128';
const SOFTWARE = /SwiftShader|llvmpipe|Software Rasterizer|Mesa OffScreen|Disabled/i;

async function launch() {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=gl'] });
  const p = await b.newPage();
  await p.goto(URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const r = await p.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
  });
  await p.close();
  if (!r || SOFTWARE.test(r)) {
    await b.close();
    throw new Error('refusing to run on a software renderer: ' + r);
  }
  b.ctrRenderer = r;
  return b;
}

/* Log in through the real form. Seeding localStorage does not work: the SPA
 * calls destroySession() during boot whenever the user fetch fails. */
async function login(context, username, password) {
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('error: ' + m.text()); });
  p.ctrErrors = errors;
  await p.goto(URL + '/#/login', { waitUntil: 'networkidle', timeout: 60000 });
  await p.fill('input[type="text"]', username);
  await p.fill('input[type="password"]', password);
  await p.click('button:has-text("Login"), button.btn');
  await p.waitForFunction(
    () => !!(window.localStorage && window.localStorage.getItem('token')),
    { timeout: 30000 },
  );
  return p;
}

function worldURL(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c) return null;
    try {
      const b = X3D.getBrowser(c);
      return (b && b.currentScene && b.currentScene.worldURL) || null;
    } catch (e) { return null; }
  });
}

/*
 * Navigate to a place and wait for the world that place names.
 *
 * Waiting for "a scene with root nodes" is not enough: the previous world is
 * still mounted while the next one loads, so that condition is already true on
 * arrival and the gate would measure the world it just left. The wait is on the
 * scene's own worldURL ending in the expected file.
 */
async function enterPlace(page, hash, expectWorld, timeout = 90000) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
  await page.waitForFunction(want => {
    const c = document.querySelector('#world x3d-canvas');
    if (!c) return false;
    try {
      const b = X3D.getBrowser(c);
      const url = b && b.currentScene && b.currentScene.worldURL;
      if (!url) return false;
      if (!b.currentScene.rootNodes || !b.currentScene.rootNodes.length) return false;
      return url.indexOf(want) !== -1;
    } catch (e) { return false; }
  }, expectWorld, { timeout });
}

module.exports = { launch, login, enterPlace, worldURL, URL };
