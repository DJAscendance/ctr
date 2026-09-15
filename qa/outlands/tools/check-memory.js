'use strict';

/*
 * CTR_BETA_OUTLANDS_MEMORY
 *
 * Repeated Outlands entry and exit on the real GPU, measuring what the page is
 * still holding after each cycle.
 *
 * Each cycle is the real citizen path and not a shortcut around it: Plaza, then
 * the historical entrance, then a side, then the battle zone. Leaving Outlands
 * hands the citizen their ordinary avatar back, so the entrance is genuinely
 * shown again every time - which is also what makes this the heaviest of the
 * transitions CTR performs, since each one builds and tears down a Script-heavy
 * world with weapons, sensors and a browser event route.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   CTR_TRANSITIONS=100 DISPLAY=:1 node qa/outlands/tools/check-memory.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace } = require('../../phase2/lib/beta-client');
const O = require('../lib/outlands-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'outlands-memory');
const N = Number(process.env.CTR_TRANSITIONS || 100);
/* The brief's budget. A cycle is one Outlands entry plus one exit. */
const SLOPE_BUDGET_MB = Number(process.env.CTR_HEAP_SLOPE || 1.5);

/* Held so the failure path can close it: a gate that dies mid-run must not
 * leave its presences behind for the next run to find as ghost citizens. */
let openBrowser = null;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

const held = page => page.evaluate(() => {
  const app = document.querySelector('#app').__vue_app__._container._vnode.component.proxy;
  const __ctrChildren = p => { const out = []; const walk = v => { if (!v) return; if (v.component) { out.push(v.component.proxy); return; } if (Array.isArray(v.children)) v.children.forEach(walk); }; if (p && p.$) walk(p.$.subTree); return out; };
  const find = c => { if (c.$options.name === 'WorldBrowserPage') return c; for (const k of __ctrChildren(c)) { const r = find(k); if (r) return r; } return null; };
  const view = find(app);
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas ? X3D.getBrowser(canvas) : null;
  const socket = view.$socket && view.$socket.socket;
  return {
    canvases: document.querySelectorAll('#world x3d-canvas').length,
    renderedCitizens: Object.keys(view.users).length,
    boundNodes: view.remoteMembers
      ? view.remoteMembers.listRemoteMembers().filter(m => !!view.remoteMembers.getRemoteNode(m.key)).length : null,
    blaxxunAvatars: b && typeof b.blaxxunAvatarCount === 'function' ? b.blaxxunAvatarCount() : null,
    browserEventRoutes: b ? (b.browserEventRoutes_ || []).length : null,
    eventMask: b ? b.eventMask : null,
    socketListeners: socket && socket._callbacks
      ? Object.keys(socket._callbacks).reduce((n, k) => n + socket._callbacks[k].length, 0) : null,
    rendererAlive: !!(b && b.getBrowserProperty && true),
    unexpectedAbort: window.ctrUnexpectedWorldLoadAbort || null,
  };
});

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  openBrowser = browser;
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const ctx = await browser.newContext();
  const page = await login(ctx, process.env.CTR_QA_USER || 'testqa', process.env.CTR_QA_PASS || 'testqa');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const m = await cdp.send('Runtime.getHeapUsage');
    return m.usedSize / (1024 * 1024);
  };

  await O.wearOrdinaryAvatar(page);
  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await page.waitForTimeout(2000);

  const baseline = await heap();
  const first = await held(page);
  process.stdout.write(`baseline heap ${baseline.toFixed(2)} MB\n`);

  const samples = [];
  const sides = ['redm', 'redf', 'bluem', 'bluef'];
  let completed = 0;
  const started = Date.now();
  for (let i = 0; i < N; i += 1) {
    try {
      await O.enterOutlandsThroughEntrance(page, sides[i % sides.length], 90000);
      await enterPlace(page, '#/place/enter', 'enter.wrl', 60000);
    } catch (e) {
      process.stdout.write(`  cycle ${i + 1} FAILED: ${e.message.slice(0, 90)}\n`);
      break;
    }
    completed = i + 1;
    if (completed % 10 === 0) {
      const mb = await heap();
      const st = await held(page);
      samples.push([completed, mb]);
      process.stdout.write(
        `  ${String(completed).padStart(3)} cycles  heap ${mb.toFixed(2)} MB`
        + `  canvases ${st.canvases}  citizens ${st.renderedCitizens}`
        + `  routes ${st.browserEventRoutes}  mask ${st.eventMask}`
        + `  socket ${st.socketListeners}\n`,
      );
    }
  }
  const minutes = ((Date.now() - started) / 60000).toFixed(1);

  const n = samples.length;
  const sx = samples.reduce((a, s) => a + s[0], 0);
  const sy = samples.reduce((a, s) => a + s[1], 0);
  const sxy = samples.reduce((a, s) => a + s[0] * s[1], 0);
  const sxx = samples.reduce((a, s) => a + s[0] * s[0], 0);
  const slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : NaN;
  const final = await held(page);

  check(`all ${N} Outlands cycles completed`, completed === N, { completed, of: N, minutes });
  check(`the heap slope is within ${SLOPE_BUDGET_MB} MB per transition`,
    Number.isFinite(slope) && slope <= SLOPE_BUDGET_MB, { slopeMB: +slope.toFixed(3), samples });
  check('the renderer is still alive', final.rendererAlive, final.rendererAlive);
  check('there is exactly one canvas', final.canvases === 1, final.canvases);
  check('no citizen is retained from any Outlands visit',
    final.renderedCitizens === 0 && final.boundNodes === 0 && final.blaxxunAvatars === 0,
    { rendered: final.renderedCitizens, bound: final.boundNodes, registered: final.blaxxunAvatars });
  check('no gameplay browser state is retained',
    final.browserEventRoutes === 0 && final.eventMask === 0,
    { routes: final.browserEventRoutes, mask: final.eventMask });
  check('the socket listener count is unchanged from the first cycle',
    final.socketListeners === first.socketListeners,
    { before: first.socketListeners, after: final.socketListeners });
  check('no world load was aborted by anything the page did not start',
    final.unexpectedAbort === null, final.unexpectedAbort);

  fs.writeFileSync(path.join(OUT_DIR, 'memory.json'), JSON.stringify({
    results, renderer: browser.ctrRenderer, baseline, samples, slope, first, final, minutes,
  }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed  (${minutes} min)\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  process.stdout.write(`FATAL ${e && e.stack ? e.stack : e}\n`);
  if (openBrowser) { try { await openBrowser.close(); } catch (x) { /* already gone */ } }
  process.exit(1);
});
