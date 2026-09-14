'use strict';

/*
 * CTR_BETA_SCRIPT_RELEASE
 *
 * Proves that the world CTR leaves behind gives up its X_ITE Script nodes.
 *
 * X_ITE 16.2.0 registers `window.addEventListener("unload", this.shutdown,
 * { once: true })` for every Script that defines a shutdown() function, and
 * `replaceWorld` never disposes the outgoing scene. The window's listener list
 * is a GC root, so each such Script - and the whole execution context behind it
 * - stayed alive for the life of the page. ne_game.wrl has exactly one Script
 * with a shutdown(); no other asset CTR serves has any, so it is the fixture
 * this gate loads - as an ordinary 3D place, through the ordinary world route.
 * Nothing here plays the game: no entrance, no team, no weapon and no ammunition
 * is read. What is measured is the ENGINE contract - Script.dispose(), the
 * window's unload listener count, the browser event mask and route, and whether
 * the replaced scene is collectible.
 *
 * The gate does not reimplement the production walk. It watches the two things
 * the walk is supposed to cause - `Script.dispose()` being called once per
 * Script, and the window's `unload` listener count returning to its baseline -
 * and then asks the collector whether the old world actually went.
 *
 * Usage:
 *   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
 *   export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
 *   CTR_QA_URL=http://127.0.0.1:8428 DISPLAY=:1 \
 *     node qa/phase2/tools/check-script-release.js [outDir]
 */

const fs = require('fs');
const path = require('path');
const { launch, login, enterPlace } = require('../lib/beta-client');

const REPO = path.join(__dirname, '..', '..', '..');
const OUT_DIR = process.argv[2]
  || path.join(REPO, '..', '..', '..', 'artifacts', 'script-release');

/*
 * The fixture world. Loaded through the ordinary 3D place route, exactly as any
 * other world is - this gate needs a world whose Script defines shutdown(), not
 * a game.
 */
const WORLD_ROUTE = process.env.CTR_QA_SCRIPT_WORLD_ROUTE || '#/place/outlands';
const WORLD_FILE = process.env.CTR_QA_SCRIPT_WORLD_FILE || 'ne_game.wrl';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? null : detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}\n`);
}

/*
 * The number of listeners registered on the window for `unload`.
 *
 * Read through CDP rather than from the page: `addEventListener` leaves nothing
 * a script can enumerate, which is exactly why this leak was invisible.
 */
async function unloadListeners(cdp) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: 'window' });
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
  return listeners.filter(l => l.type === 'unload').length;
}

/*
 * Count every Script.dispose() by node identity, so a Script disposed twice is
 * visible. Identity and not name: the fixture world has fourteen Scripts sharing
 * two names, and a DEF/USE pair is one node reachable by two paths.
 *
 * The table is a WeakMap and the totals are plain numbers. A Map here would
 * make the gate its own leak - it would hold every Script it counted, and a
 * Script holds its execution context, so the retained-world check below would
 * be measuring the instrumentation.
 */
const INSTRUMENT = () => {
  const Script = window.X3D.ConcreteNodes.get('Script');
  if (!Script || !Script.prototype || Script.prototype.ctrDisposeCounted__) return false;
  Script.prototype.ctrDisposeCounted__ = true;
  const counts = new WeakMap();
  window.__ctrDisposedNodes = 0;
  window.__ctrMaxDisposals = 0;
  window.__ctrDisposedWithShutdown = 0;
  const original = Script.prototype.dispose;
  Script.prototype.dispose = function () {
    const seen = (counts.get(this) || 0) + 1;
    counts.set(this, seen);
    if (seen === 1) window.__ctrDisposedNodes += 1;
    if (seen > window.__ctrMaxDisposals) window.__ctrMaxDisposals = seen;
    if (typeof this.shutdown === 'function') window.__ctrDisposedWithShutdown += 1;
    return original.apply(this, arguments);
  };
  window.__ctrOldScenes = [];
  return true;
};

/* Everything the gate reads out of the live page in one round trip. */
const snapshot = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas ? window.X3D.getBrowser(canvas) : null;
  const scene = b && b.currentScene;
  const view = (() => {
    const find = c => {
      if (c.$options && c.$options.name === 'WorldBrowserPage') return c;
      for (const k of c.$children) { const r = find(k); if (r) return r; }
      return null;
    };
    const app = document.querySelector('#app');
    return app && app.__vue__ ? find(app.__vue__) : null;
  })();
  const socket = view && view.$socket && view.$socket.socket;
  const maxDisposals = window.__ctrMaxDisposals || 0;
  const disposedNodes = window.__ctrDisposedNodes || 0;
  /* Scripts that are root nodes of the top-level scene, so the gate can tell a
   * root-only sweep from one that entered the nested execution contexts. */
  let rootScripts = 0, shutdownScripts = 0;
  if (scene && scene.rootNodes) {
    for (let i = 0; i < scene.rootNodes.length; i += 1) {
      try {
        if (scene.rootNodes[i].getNodeTypeName() === 'Script') rootScripts += 1;
      } catch (e) { /* not a node the SAI will name */ }
    }
  }
  /* The retainer itself: a Script whose shutdown() X_ITE put on the window. */
  const named = (() => {
    if (!scene) return null;
    try { return scene.getNamedNode('battle'); } catch (e) { return null; }
  })();
  if (named) {
    const symbols = Object.getOwnPropertySymbols(named);
    for (let i = 0; i < symbols.length; i += 1) {
      const held = named[symbols[i]];
      if (held && typeof held === 'object' && typeof held.shutdown === 'function') {
        shutdownScripts += 1;
      }
    }
  }
  return {
    worldURL: scene ? scene.worldURL : null,
    canvases: document.querySelectorAll('#world x3d-canvas').length,
    rootScripts,
    shutdownScripts,
    disposedNodes,
    maxDisposals,
    disposedWithShutdown: window.__ctrDisposedWithShutdown || 0,
    eventMask: b ? b.eventMask : null,
    browserEventRoutes: b ? (b.browserEventRoutes_ || []).length : null,
    /*
     * SharedEvent delivery. `eventNodeMap` is rebuilt from the current scene on
     * every place load, and the socket's "SE" handler is registered once for
     * the page - so a world that has been left can neither be delivered to nor
     * add a second delivery of its own. Both are read here so a regression that
     * started keeping the old world's nodes, or stacking a handler per visit,
     * shows up as a growing number rather than as a silent duplicate.
     */
    eventNodes: view && view.eventNodeMap
      ? Array.from(view.eventNodeMap.values()).reduce((n, list) => n + list.length, 0) : null,
    eventNodeNames: view && view.eventNodeMap ? view.eventNodeMap.size : null,
    sharedEventHandlers: socket && socket._callbacks && socket._callbacks.$SE
      ? socket._callbacks.$SE.length : null,
    oldScenesTracked: (window.__ctrOldScenes || []).length,
    oldScenesAlive: (window.__ctrOldScenes || []).filter(r => r.deref() !== undefined).length,
    /* Which surviving world, if any, is the one bxx_auth.js is holding in its
     * single getWorldStartTime() slot. That slot is one scene deep and is
     * overwritten by the next world that asks the browser for its start time,
     * so it cannot grow; naming it here keeps a bounded hold distinguishable
     * from a leak that has come back. */
    heldByWorldStartSlot: (window.__ctrOldScenes || [])
      .filter(r => b && r.deref() !== undefined && r.deref() === b.worldStartScene_).length,
  };
});

/* Remember the world that is about to be replaced, weakly, so the collector can
 * be asked later whether it actually went. */
const trackCurrentScene = page => page.evaluate(() => {
  const canvas = document.querySelector('#world x3d-canvas');
  const b = canvas ? window.X3D.getBrowser(canvas) : null;
  if (!b || !b.currentScene) return null;
  window.__ctrOldScenes.push(new WeakRef(b.currentScene));
  return b.currentScene.worldURL;
});

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launch();
  process.stdout.write(`renderer: ${browser.ctrRenderer}\n`);
  const ctx = await browser.newContext();
  const page = await login(ctx, process.env.CTR_QA_USER || 'testqa', process.env.CTR_QA_PASS || 'testqa');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const gc = () => cdp.send('HeapProfiler.collectGarbage');

  await enterPlace(page, '#/place/enter', 'enter.wrl');
  await page.waitForTimeout(2000);

  /* The Scripting component is fetched the first time a world needs it, so the
   * class only exists once a world with Scripts has loaded. */
  const instrumented = await page.evaluate(INSTRUMENT);
  check('the Script class can be instrumented', instrumented === true, instrumented);

  const baseListeners = await unloadListeners(cdp);
  const plaza = await snapshot(page);
  check('a world with no Script shutdown() registers no window unload listener',
    baseListeners === 0, { world: plaza.worldURL, unloadListeners: baseListeners });

  /* ---- first visit ---- */
  await enterPlace(page, WORLD_ROUTE, WORLD_FILE, 120000);
  await page.waitForTimeout(2500);

  const inside = await snapshot(page);
  const insideListeners = await unloadListeners(cdp);
  check('the outgoing world has a Script that defines shutdown()',
    inside.shutdownScripts >= 1, { world: inside.worldURL, scripts: inside.shutdownScripts });
  check('the active world holds exactly one more window unload listener',
    insideListeners === baseListeners + 1,
    { baseline: baseListeners, active: insideListeners });

  /* The world's Scripts are live: initialize() has claimed the browser event
   * mask and routed the browser's own event_changed into one of them. That is
   * the browser-level state the release has to give back, and it is read from
   * the browser, not from any gameplay variable. */
  check('the world\'s Scripts have claimed the browser event state',
    inside.browserEventRoutes > 0 && inside.eventMask > 0,
    { routes: inside.browserEventRoutes, mask: inside.eventMask });

  await trackCurrentScene(page);

  /* ---- leave ---- */
  await enterPlace(page, '#/place/enter', 'enter.wrl', 90000);
  await page.waitForTimeout(2000);

  const afterLeave = await snapshot(page);
  const leftListeners = await unloadListeners(cdp);
  check('leaving the world removes its window unload listener',
    leftListeners === baseListeners, { baseline: baseListeners, afterLeave: leftListeners });
  check('the Script that owned the listener was disposed',
    afterLeave.disposedWithShutdown >= 1, afterLeave.disposedWithShutdown);
  check('the sweep reached the nested execution contexts, not only the root nodes',
    afterLeave.disposedNodes > inside.rootScripts,
    { disposed: afterLeave.disposedNodes, rootScriptsInScene: inside.rootScripts });
  check('no Script was disposed more than once',
    afterLeave.maxDisposals === 1, { maxDisposals: afterLeave.maxDisposals });
  check('the browser event state the world took is given back',
    afterLeave.eventMask === 0 && afterLeave.browserEventRoutes === 0,
    { mask: afterLeave.eventMask, routes: afterLeave.browserEventRoutes });

  await gc();
  await page.waitForTimeout(500);
  await gc();
  const collected = await snapshot(page);
  /*
   * One world may survive here and it is not this defect. bxx_auth.js keeps the
   * scene it last measured a world start time for in a single slot
   * (`worldStartScene_`), which the next world overwrites. The rule that matters
   * is the one below - the count must not grow with visits.
   */
  check('at most one world survives being left, and it is the single-slot hold',
    collected.oldScenesAlive <= 1
      && collected.oldScenesAlive === collected.heldByWorldStartSlot,
    { tracked: collected.oldScenesTracked, alive: collected.oldScenesAlive,
      heldByWorldStartSlot: collected.heldByWorldStartSlot });

  /* ---- re-entry: the new world must be untouched by the old one's cleanup ---- */
  await enterPlace(page, WORLD_ROUTE, WORLD_FILE, 120000);
  await page.waitForTimeout(2500);

  const again = await snapshot(page);
  const againListeners = await unloadListeners(cdp);
  check('the re-entered world builds its own Script with a shutdown()',
    again.shutdownScripts >= 1, { scripts: again.shutdownScripts, world: again.worldURL });
  check('the new world registers its own window unload listener',
    againListeners === baseListeners + 1,
    { baseline: baseListeners, active: againListeners });
  check('the new world gets its own browser event route and mask',
    again.browserEventRoutes > 0 && again.eventMask > 0,
    { routes: again.browserEventRoutes, mask: again.eventMask });
  check('re-entry registers only the new world\'s SharedEvent nodes, and no second handler',
    again.eventNodes === inside.eventNodes
      && again.eventNodeNames === inside.eventNodeNames
      && again.sharedEventHandlers === 1,
    { firstVisit: { nodes: inside.eventNodes, names: inside.eventNodeNames },
      reEntry: { nodes: again.eventNodes, names: again.eventNodeNames },
      socketSEHandlers: again.sharedEventHandlers });
  check('nothing was disposed twice across the re-entry',
    again.maxDisposals === 1, { maxDisposals: again.maxDisposals });

  await trackCurrentScene(page);

  /* ---- leave again: the count must be flat, not merely lower ---- */
  await enterPlace(page, '#/place/enter', 'enter.wrl', 90000);
  await page.waitForTimeout(2000);
  await gc();
  await page.waitForTimeout(500);
  await gc();

  const final = await snapshot(page);
  const finalListeners = await unloadListeners(cdp);
  check('the window unload listener count is flat across two visits',
    finalListeners === baseListeners, { baseline: baseListeners, afterTwoVisits: finalListeners });
  /* The point of the whole fix: two visits must not leave two worlds. */
  check('the surviving-world count does not grow with visits',
    final.oldScenesTracked === 2 && final.oldScenesAlive <= 1
      && final.oldScenesAlive === final.heldByWorldStartSlot,
    { tracked: final.oldScenesTracked, alive: final.oldScenesAlive,
      heldByWorldStartSlot: final.heldByWorldStartSlot });
  check('still exactly one canvas', final.canvases === 1, final.canvases);
  check('no Script was disposed more than once, at the end',
    final.maxDisposals === 1, { maxDisposals: final.maxDisposals, nodes: final.disposedNodes });

  fs.writeFileSync(path.join(OUT_DIR, 'script-release.json'), JSON.stringify({
    results, renderer: browser.ctrRenderer,
    listeners: { baseline: baseListeners, inside: insideListeners, afterLeave: leftListeners,
      onReEntry: againListeners, final: finalListeners },
    snapshots: { plaza, inside, afterLeave, collected, again, final },
  }, null, 2));

  const passed = results.filter(r => r.pass).length;
  process.stdout.write(`\n${passed}/${results.length} checks passed\n`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
