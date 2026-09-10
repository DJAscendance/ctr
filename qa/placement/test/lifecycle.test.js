'use strict';

/**
 * Tests for `tools/check-lifecycle.js` and `tools/check-rendered-vs-stored.js`.
 *
 * These guard the one thing a placement run must never do: report a row nobody
 * managed to observe as agreement. The earlier capture emitted a record only
 * for objects it actually found, so a place that failed to load produced a
 * short list and every downstream count came out clean. A capture now carries
 * one record per expected placement row, and these tests prove the checks fail
 * on the ones that carry no observation.
 *
 * Every fixture is written to a throwaway temp directory. Nothing here reads or
 * writes the QA database or the committed baselines.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIFECYCLE = path.join(__dirname, '..', 'tools', 'check-lifecycle.js');
const VS_STORED = path.join(__dirname, '..', 'tools', 'check-rendered-vs-stored.js');

const POSITION = { x: 1.5, y: 0, z: -2.25 };
const ROTATION = { x: 0, y: 1, z: 0, angle: 1.5707963 };
const SCALE = { x: 1, y: 1, z: 1 };

/** One synthetic rendered record. No real citizen data is involved. */
function rendered(overrides) {
  const base = {
    source: 'object_instance',
    id: 77,
    placeKey: 'home',
    observation: 'RENDERED',
    rendered: { position: POSITION, rotation: ROTATION, scale: SCALE },
    renderedOnReturn: { position: POSITION, rotation: ROTATION },
    renderedOnReload: { position: POSITION, rotation: ROTATION },
  };
  return Object.assign({}, base, overrides || {});
}

/** The stored row a rendered record must agree with. */
function stored(overrides) {
  const base = {
    source: 'object_instance',
    id: 77,
    stored: { placeId: 836, objectId: 11, memberId: 1, position: POSITION, rotation: ROTATION },
  };
  return Object.assign({}, base, overrides || {});
}

function writeDir(renderedRecords, storedRecords) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctr-placement-life-'));
  fs.writeFileSync(path.join(dir, 'rendered-test.json'), `${JSON.stringify({
    layer: 'rendered', engine: '16.2.0', coverage: [], records: renderedRecords,
  })}\n`);
  fs.writeFileSync(path.join(dir, 'stored-test.json'), `${JSON.stringify({
    layer: 'stored', engine: '16.2.0', records: storedRecords || [],
  })}\n`);
  return dir;
}

function runLifecycle(records, env) {
  const dir = writeDir(records);
  return spawnSync(process.execPath, [LIFECYCLE, path.join(dir, 'rendered-test.json')],
    { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
}

function runVsStored(renderedRecords, storedRecords) {
  const dir = writeDir(renderedRecords, storedRecords);
  return spawnSync(process.execPath, [VS_STORED, dir], { encoding: 'utf8' });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a fully observed row passes all three phases', () => {
  const result = runLifecycle([rendered()]);
  assert.strictEqual(result.status, 0, result.stdout);
  assert.ok(/RENDERED: 1/.test(result.stdout), result.stdout);
  assert.ok(/world-return re-observed: 1/.test(result.stdout), result.stdout);
  assert.ok(/reload re-observed:       1/.test(result.stdout), result.stdout);
});

test('a row that never rendered fails rather than being skipped', () => {
  const result = runLifecycle([rendered({
    observation: 'NOT_RENDERED', rendered: null, renderedOnReturn: null, renderedOnReload: null,
  })]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/NOT_RENDERED \(never observed\)/.test(result.stdout), result.stdout);
});

test('a world-parse block fails by default', () => {
  const result = runLifecycle([rendered({
    observation: 'WORLD_PARSE_BLOCK', rendered: null, renderedOnReturn: null,
    renderedOnReload: null,
  })]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/WORLD_PARSE_BLOCK: 1/.test(result.stdout), result.stdout);
});

test('a world-parse block is accepted only when asked for explicitly', () => {
  const result = runLifecycle([rendered({
    observation: 'WORLD_PARSE_BLOCK', rendered: null, renderedOnReturn: null,
    renderedOnReload: null,
  })], { CTR_QA_ACCEPT_PARSE_BLOCK: '1' });
  assert.strictEqual(result.status, 0, result.stdout);
  // Accepted is not invisible: the ids are still printed under their heading.
  assert.ok(/WORLD_PARSE_BLOCK: 1/.test(result.stdout), result.stdout);
  assert.ok(/object_instance:77/.test(result.stdout), result.stdout);
});

test('an accepted parse block is never counted as a render', () => {
  const result = runLifecycle([rendered({
    observation: 'WORLD_PARSE_BLOCK', rendered: null, renderedOnReturn: null,
    renderedOnReload: null,
  })], { CTR_QA_ACCEPT_PARSE_BLOCK: '1' });
  assert.ok(/initial rendered:         0/.test(result.stdout), result.stdout);
  assert.ok(/world-return re-observed: 0/.test(result.stdout), result.stdout);
});

test('a row missing after the return fails', () => {
  const result = runLifecycle([rendered({ renderedOnReturn: null })]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/missing after return/.test(result.stdout), result.stdout);
});

test('a row missing after the reload fails', () => {
  const result = runLifecycle([rendered({ renderedOnReload: null })]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/missing after reload/.test(result.stdout), result.stdout);
});

test('drift beyond tolerance on the reload fails', () => {
  const moved = { position: { x: 1.6, y: 0, z: -2.25 }, rotation: ROTATION };
  const result = runLifecycle([rendered({ renderedOnReload: moved })]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/reload position\.x drift/.test(result.stdout), result.stdout);
});

test('rendered equals stored passes', () => {
  const result = runVsStored([rendered()], [stored()]);
  assert.strictEqual(result.status, 0, result.stdout);
  assert.ok(/translation mismatches 0/.test(result.stdout), result.stdout);
  assert.ok(/rotation mismatches    0/.test(result.stdout), result.stdout);
  assert.ok(/scale mismatches       0/.test(result.stdout), result.stdout);
});

test('a rendered transform that left its stored value fails', () => {
  const record = rendered();
  record.rendered = {
    position: { x: 1.5, y: 0.5, z: -2.25 }, rotation: ROTATION, scale: SCALE,
  };
  const result = runVsStored([record], [stored()]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/translation mismatches 1/.test(result.stdout), result.stdout);
});

test('a non-identity rendered scale fails', () => {
  const record = rendered();
  record.rendered = {
    position: POSITION, rotation: ROTATION, scale: { x: 1, y: 2, z: 1 },
  };
  const result = runVsStored([record], [stored()]);
  assert.strictEqual(result.status, 1, result.stdout);
  assert.ok(/scale mismatches       1/.test(result.stdout), result.stdout);
});

test('a blocked row is reported, never compared as agreement', () => {
  const record = rendered({
    observation: 'WORLD_PARSE_BLOCK', rendered: null, renderedOnReturn: null,
    renderedOnReload: null,
  });
  const result = runVsStored([record], [stored()]);
  assert.strictEqual(result.status, 0, result.stdout);
  assert.ok(/WORLD_PARSE_BLOCK: 1/.test(result.stdout), result.stdout);
  assert.ok(/RENDERED: 0/.test(result.stdout), result.stdout);
});

module.exports = tests;
