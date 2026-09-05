'use strict';

/*
 * The in-page probe used by the repeated-world memory run.
 *
 * Everything here is serialised into the browser by page.evaluate, so it may
 * not close over anything from Node. It is kept in its own module, as a string
 * of source rather than a function reference, because the same body is also
 * asserted against by test/probe.test.js without a browser.
 *
 * The probe reads three things the run has to watch:
 *
 *   1. the live X_ITE scene (root nodes, world URL, canvas count),
 *   2. the socket.io listener table, and
 *   3. the WorldBrowserPage component's own shared-object bookkeeping.
 *
 * None of these are exposed by the application on purpose, so each read is
 * defensive: a shape the probe does not recognise is reported as null and the
 * run records that field as unavailable rather than inventing a number. A
 * probe that guesses is worse than a probe that abstains, because the whole
 * point of the run is to decide whether a count grows.
 */

/*
 * socket.io's client Socket extends component-emitter, which stores handlers
 * on `_callbacks` keyed by the event name with a "$" prefix. TypeScript's
 * `private socket` on SocketManager is erased at runtime, so the instance is
 * reachable from any mounted Vue component through `$socket`.
 */
const PROBE_SOURCE = `(() => {
  const result = {
    ok: true,
    error: null,
    canvasCount: document.querySelectorAll('x3d-canvas').length,
    worldCanvasCount: document.querySelectorAll('#world x3d-canvas').length,
    worldChildCount: (document.querySelector('#world') || { children: [] }).children.length,
    rootNodes: null,
    worldURL: null,
    sceneId: null,
    worldGeneration: null,
    sharedObjectsMapSize: null,
    sharedObjectsLength: null,
    browserCallbacks: null,
    browserCallbackSource: null,
    listeners: null,
    listenerTotal: null,
    vueComponentCount: null,
    heapUsed: null,
    heapTotal: null,
  };

  /* Walks up from a known element to whichever node Vue tagged with __vue__. */
  function rootVm() {
    const nodes = [document.querySelector('#app'), document.body];
    for (const node of nodes) {
      for (let el = node; el; el = el.parentElement) {
        if (el && el.__vue__) return el.__vue__;
      }
    }
    const tagged = document.querySelector('[data-v-app], #app > *');
    return tagged && tagged.__vue__ ? tagged.__vue__ : null;
  }

  /* Depth-first walk of the live component tree, counting as it goes. */
  function walk(vm, visit) {
    if (!vm) return 0;
    let count = 1;
    visit(vm);
    const children = vm.$children || [];
    for (const child of children) count += walk(child, visit);
    return count;
  }

  const root = rootVm();

  if (root) {
    let worldPage = null;
    result.vueComponentCount = walk(root, (vm) => {
      if (worldPage === null && vm.sharedObjectsMap !== undefined
          && vm.worldGeneration !== undefined) {
        worldPage = vm;
      }
    });
    if (worldPage) {
      const map = worldPage.sharedObjectsMap;
      result.sharedObjectsMapSize = map && typeof map.size === 'number' ? map.size : null;
      result.sharedObjectsLength = Array.isArray(worldPage.sharedObjects)
        ? worldPage.sharedObjects.length : null;
      result.worldGeneration = typeof worldPage.worldGeneration === 'number'
        ? worldPage.worldGeneration : null;
    }

    const manager = root.$socket;
    const raw = manager && manager.socket ? manager.socket : null;
    const callbacks = raw && raw._callbacks ? raw._callbacks : null;
    if (callbacks) {
      const listeners = {};
      let total = 0;
      for (const key of Object.keys(callbacks)) {
        const handlers = callbacks[key];
        const size = Array.isArray(handlers) ? handlers.length : 0;
        listeners[key.replace(/^\\$/, '')] = size;
        total += size;
      }
      result.listeners = listeners;
      result.listenerTotal = total;
    }
  }

  const canvas = document.querySelector('#world x3d-canvas');
  if (canvas && typeof X3D !== 'undefined') {
    try {
      const browser = X3D.getBrowser(canvas);
      const scene = browser ? browser.currentScene : null;
      if (scene) {
        result.rootNodes = scene.rootNodes ? scene.rootNodes.length : null;
        result.worldURL = String(scene.worldURL);
        /*
         * X_ITE gives scenes no stable id, so the run needs one to tell a
         * replaced scene from a reused one. A property stamped on the scene
         * survives exactly as long as the scene object does, which is the
         * lifetime the run cares about.
         */
        if (!scene.__ctrSceneId) {
          window.__ctrSceneSeq = (window.__ctrSceneSeq || 0) + 1;
          try {
            Object.defineProperty(scene, '__ctrSceneId', {
              value: window.__ctrSceneSeq, enumerable: false, configurable: true,
            });
          } catch (error) { /* frozen scene: identity stays null */ }
        }
        result.sceneId = scene.__ctrSceneId || null;
      }

      /*
       * addBrowserCallback keys its callbacks by the caller's first argument.
       * X_ITE has moved where that table lives between versions, so each known
       * shape is tried in turn and the one that answered is recorded, letting a
       * later engine bump show up as browserCallbackSource going null rather
       * than as a silently wrong count.
       */
      const sources = [
        ['getBrowserCallbacks', () => browser.getBrowserCallbacks()],
        ['browserCallbacks', () => browser.browserCallbacks],
        ['_browserCallbacks', () => browser._browserCallbacks],
      ];
      for (const [name, read] of sources) {
        let table = null;
        try { table = read(); } catch (error) { table = null; }
        if (!table) continue;
        if (typeof table.size === 'number') {
          result.browserCallbacks = table.size;
        } else if (typeof table === 'object') {
          result.browserCallbacks = Object.keys(table).length;
        } else {
          continue;
        }
        result.browserCallbackSource = name;
        break;
      }
    } catch (error) {
      result.error = String(error);
    }
  }

  if (window.performance && performance.memory) {
    result.heapUsed = performance.memory.usedJSHeapSize;
    result.heapTotal = performance.memory.totalJSHeapSize;
  }

  return result;
})()`;

module.exports = { PROBE_SOURCE };
