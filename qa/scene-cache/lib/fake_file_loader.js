'use strict';

/**
 * A stand-in for X_ITE's FileLoader, built to the shape the real one has in
 * 15.1.12 (x_ite.js, FileLoader.loadDocumentAsync / loadDocumentError).
 *
 * Only the parts the scene-cache defect lives in are reproduced:
 *
 *   - `FileLoader.sceneCache` is one process-wide Map keyed by the request url
 *     without its fragment, shared by every loader.
 *   - A loader that misses the cache inserts its own pending entry *before*
 *     fetching, and keeps that entry's resolve function in `this.resolve`.
 *   - A loader that hits the cache awaits the entry and hands the scene to its
 *     callback; it never fetches.
 *   - `loadDocumentError` walks to the next url in the list. Doing so runs
 *     loadDocumentAsync again, which overwrites `this.resolve` with the new
 *     attempt's resolve. The entry the failed url inserted is then unreachable
 *     and stays pending for the life of the process.
 *
 * That last point is the defect. Reproducing it here means the regression test
 * needs no browser, no network and no X_ITE build.
 */

const BASE = 'https://ctr.test/';

function deferred() {
  // Node 14 has no Promise.withResolvers; X_ITE's use of it is equivalent.
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * A stand-in for a parsed X3D scene. The real cache-hit path calls
 * setWorldURL on whatever the cache produced, so a null cache value is fatal
 * there; keeping that behaviour makes the fake fail the same way X_ITE does.
 */
function makeScene(name) {
  return {
    name,
    worldURL: null,
    setWorldURL(url) { this.worldURL = url; },
  };
}

/**
 * Build a fresh FileLoader class with an empty shared cache.
 *
 * `network` maps an absolute url to either a scene name (the fetch succeeds)
 * or null (the fetch throws, as checkResponse does on a non-ok response).
 */
function createFileLoaderClass(network) {
  const fetches = [];

  function FileLoader(options) {
    this.url = [];
    this.resolve = null;
    this.fileURL = null;
    this.cacheScene = true;
    this.sceneCallback = options.sceneCallback;
    this.errors = [];
  }

  FileLoader.sceneCache = new Map();
  FileLoader.fetches = fetches;

  FileLoader.prototype.callback = function (scene) {
    this.sceneCallback(scene);
  };

  /* The url X_ITE keys the cache by: the request url with its fragment cut. */
  FileLoader.prototype.cacheURL = function () {
    const url = new URL(this.fileURL);
    url.hash = '';
    return url.href;
  };

  FileLoader.prototype.loadDocumentAsync = async function (url) {
    this.fileURL = new URL(url, BASE);

    if (this.sceneCallback && this.cacheScene && !this.fileURL.search.length) {
      const key = this.cacheURL();
      const cached = FileLoader.sceneCache.get(key);
      if (cached) {
        const scene = await cached;
        // X_ITE does this unguarded, so a cache entry settled with null is a
        // TypeError here rather than a clean miss.
        scene.setWorldURL(this.fileURL.href);
        return this.callback(scene);
      }
      const entry = deferred();
      this.resolve = entry.resolve;
      FileLoader.sceneCache.set(key, entry.promise);
    }

    fetches.push(this.fileURL.href);
    const name = network[this.fileURL.href];
    // A missing or null entry stands for a non-ok response.
    await new Promise((r) => setTimeout(r, 0));
    if (!name) {
      throw new Error(`Couldn't load URL '${this.fileURL.href}'.`);
    }

    const scene = makeScene(name);
    scene.setWorldURL(this.fileURL.href);
    if (this.resolve) {
      this.resolve(scene);
    }
    return this.callback(scene);
  };

  FileLoader.prototype.loadDocumentError = function (error) {
    this.errors.push(String(error && error.message));

    if (this.url.length) {
      this.loadDocumentAsync(String(this.url.shift()))
        .catch(this.loadDocumentError.bind(this));
      return;
    }
    if (this.resolve) {
      this.resolve(null);
    }
    this.callback(null);
  };

  /* The entry point: an EXTERNPROTO or Inline url list. */
  FileLoader.prototype.loadDocument = function (urls) {
    this.url = urls.slice();
    this.loadDocumentAsync(String(this.url.shift()))
      .catch(this.loadDocumentError.bind(this));
  };

  return FileLoader;
}

module.exports = {
  BASE,
  createFileLoaderClass,
};
