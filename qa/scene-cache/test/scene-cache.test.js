'use strict';

/**
 * Regression tests for spa/src/libs/x_ite_mods/scene_cache.js.
 *
 * The defect these guard: X_ITE keeps one process-wide scene cache, and a
 * loader inserts its cache entry before it fetches. When an EXTERNPROTO has a
 * url list and the first url fails, the loader moves to the second url, which
 * installs a new entry and overwrites the loader's `resolve`. The first entry
 * is then pending with nothing left to settle it, so the next scene that asks
 * for that url awaits forever. In the Mall that stalled the whole world load
 * and left a scene with no root nodes.
 *
 * The fake loader in ../lib/fake_file_loader.js reproduces that contract, so
 * these tests need no browser and no X_ITE build. The "old behaviour" case is
 * run unpatched, to prove the regression tests can actually fail.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { BASE, createFileLoaderClass } = require('../lib/fake_file_loader');

const PATCH_PATH = path.join(
  __dirname, '..', '..', '..', 'spa', 'src', 'libs', 'x_ite_mods', 'scene_cache.js',
);
const PATCH_SOURCE = fs.readFileSync(PATCH_PATH, 'utf8');

/* No test may hang the suite, so every wait is bounded. */
const SETTLE_MS = 200;

/*
 * Apply the real patch file to one FileLoader class.
 *
 * The patch is a browser IIFE that reads the global X3D and calls the AMD-shaped
 * X3D.require that x_ite_compat.js installs, so a matching stub is all it needs.
 */
function applyPatch(FileLoader) {
  const warnings = [];
  const X3D = {
    require(ids, callback) {
      assert.deepStrictEqual(ids, ['x_ite/InputOutput/FileLoader']);
      return callback(FileLoader);
    },
  };
  const consoleStub = { warn: (...args) => warnings.push(args.join(' ')), error: () => {} };
  new Function('X3D', 'console', PATCH_SOURCE)(X3D, consoleStub);
  return warnings;
}

/*
 * The Mall's real shape: an EXTERNPROTO whose first url is a dead blaxxun
 * target and whose second url is the one that works.
 */
const DEAD = `${BASE}protos/dead.wrl`;
const LIVE = `${BASE}protos/live.wrl`;
const URL_LIST = [DEAD, LIVE];
const NETWORK = { [LIVE]: 'live-scene' };

/* Load `urls` and report what the loader's callback finally received. */
function load(FileLoader, urls) {
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const loader = new FileLoader({ sceneCallback: (scene) => done({ scene }) });
  try {
    loader.loadDocument(urls);
  } catch (error) {
    done({ error });
  }
  return { loader, finished };
}

/* Resolve to `{ settled: false }` rather than hanging when nothing happens. */
function within(promise, ms) {
  return Promise.race([
    promise.then((value) => ({ settled: true, value }), (error) => ({ settled: true, error })),
    new Promise((resolve) => setTimeout(() => resolve({ settled: false }), ms)),
  ]);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('the patch installs against a FileLoader that has loadDocumentError', () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  const before = FileLoader.prototype.loadDocumentError;
  const warnings = applyPatch(FileLoader);
  assert.deepStrictEqual(warnings, [], 'the patch must not skip itself');
  assert.notStrictEqual(FileLoader.prototype.loadDocumentError, before);
});

test('applying the patch twice does not wrap it twice', () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  applyPatch(FileLoader);
  const once = FileLoader.prototype.loadDocumentError;
  applyPatch(FileLoader);
  assert.strictEqual(FileLoader.prototype.loadDocumentError, once);
});

test('a failed url leaves no entry behind in the shared scene cache', async () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  applyPatch(FileLoader);

  const first = load(FileLoader, URL_LIST);
  const result = await within(first.finished, SETTLE_MS);

  assert.ok(result.settled, 'the first load must finish');
  assert.strictEqual(result.value.scene.name, 'live-scene', 'the fallback url must be used');
  assert.strictEqual(
    FileLoader.sceneCache.has(DEAD), false,
    'the failed url must not be left in the cache',
  );
  assert.strictEqual(
    FileLoader.sceneCache.has(LIVE), true,
    'the url that worked must still be cached',
  );
});

test('the cache entry a failed url created is settled, not left pending', async () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  applyPatch(FileLoader);

  // Hold on to the entry the failed url inserts, before the patch removes it.
  const captured = [];
  const set = FileLoader.sceneCache.set.bind(FileLoader.sceneCache);
  FileLoader.sceneCache.set = (key, promise) => {
    captured.push({ key, promise });
    return set(key, promise);
  };

  await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);

  const dead = captured.filter((entry) => entry.key === DEAD);
  assert.strictEqual(dead.length, 1, 'the failed url must have inserted one entry');

  const settled = await within(dead[0].promise, SETTLE_MS);
  assert.ok(settled.settled, 'the failed entry must not stay pending forever');
  assert.strictEqual(settled.value, null, 'X_ITE settles a dead url with null');
});

test('a second scene loading the same url list still completes', async () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  applyPatch(FileLoader);

  await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);
  const second = await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);

  assert.ok(second.settled, 'the second load must not wait on the failed first url');
  assert.ok(!second.value.error, `the second load must not throw: ${second.value.error}`);
  assert.strictEqual(second.value.scene.name, 'live-scene');
});

test('without the patch the second load hangs, which is the defect', async () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  // Deliberately unpatched.

  await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);
  const second = await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);

  assert.strictEqual(
    second.settled, false,
    'the unpatched loader must strand the second load, or these tests prove nothing',
  );
  assert.strictEqual(
    FileLoader.sceneCache.has(DEAD), true,
    'the unpatched cache keeps the failed url',
  );
});

test('a successful scene is still cached and reused without fetching again', async () => {
  const FileLoader = createFileLoaderClass({ [LIVE]: 'live-scene' });
  applyPatch(FileLoader);

  const first = await within(load(FileLoader, [LIVE]).finished, SETTLE_MS);
  const second = await within(load(FileLoader, [LIVE]).finished, SETTLE_MS);

  assert.ok(first.settled && second.settled, 'both loads must finish');
  assert.strictEqual(second.value.scene.name, 'live-scene');
  assert.strictEqual(
    FileLoader.fetches.filter((url) => url === LIVE).length, 1,
    'the second load must come from the cache, not a second fetch',
  );
  assert.strictEqual(
    first.value.scene, second.value.scene,
    'the cached scene object itself must be reused',
  );
});

test('success caching survives a failed url in the same list', async () => {
  const FileLoader = createFileLoaderClass(NETWORK);
  applyPatch(FileLoader);

  await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);
  await within(load(FileLoader, URL_LIST).finished, SETTLE_MS);

  assert.strictEqual(
    FileLoader.fetches.filter((url) => url === LIVE).length, 1,
    'the url that worked must be fetched once and cached',
  );
  assert.strictEqual(
    FileLoader.fetches.filter((url) => url === DEAD).length, 2,
    'the dead url is retried rather than cached, which is the intended trade',
  );
});

test('a url that fails outright still reports failure instead of stalling', async () => {
  const FileLoader = createFileLoaderClass({});
  applyPatch(FileLoader);

  const first = await within(load(FileLoader, [DEAD]).finished, SETTLE_MS);
  const second = await within(load(FileLoader, [DEAD]).finished, SETTLE_MS);

  assert.ok(first.settled, 'the first load must finish');
  assert.strictEqual(first.value.scene, null, 'a dead url produces no scene');
  assert.ok(second.settled, 'the second load must finish too');
  assert.strictEqual(second.value.scene, null);
  assert.strictEqual(FileLoader.sceneCache.has(DEAD), false);
});

module.exports = tests;
