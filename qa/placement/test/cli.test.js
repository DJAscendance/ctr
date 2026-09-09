'use strict';

/**
 * End-to-end tests for `tools/compare.js`.
 *
 * These drive the real CLI as a child process, because the duplicate-key defect
 * they guard lived in the file loader rather than in the comparator: a capture
 * whose records merge into a `Map` loses one of any two rows sharing a key, and
 * only the CLI path does that merging.
 *
 * Every fixture is written to a throwaway temp directory. Nothing here reads or
 * writes the QA database or the committed baselines.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const COMPARE = path.join(__dirname, '..', 'tools', 'compare.js');

/** One synthetic capture record. No real citizen data is involved. */
function record(overrides) {
  const base = {
    source: 'object_instance',
    id: 77,
    stored: {
      placeId: 836,
      objectId: 11,
      memberId: 1,
      url: '/assets/object/qafix/ct-table/Table_finished.wrl',
      position: { x: 1.5, y: 0, z: -2.25 },
      rotation: { x: 0, y: 1, z: 0, angle: 1.5707963 },
      rawPosition: '{"x":1.5,"y":0,"z":-2.25}',
      rawRotation: '{"x":0,"y":1,"z":0,"angle":1.5707963}',
    },
    rendered: {
      position: { x: 1.5, y: 0, z: -2.25 },
      rotation: { x: 0, y: 1, z: 0, angle: 1.5707963 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  return Object.assign({}, base, overrides || {});
}

/** Writes a capture file into a fresh temp directory and returns its path. */
function writeCapture(name, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctr-placement-cli-'));
  const file = path.join(dir, `${name}.json`);
  const capture = { layer: 'merged', engine: '15.1.12', commit: 'test', records };
  fs.writeFileSync(file, `${JSON.stringify(capture, null, 2)}\n`);
  return file;
}

function runCompare(baseline, candidate) {
  return spawnSync(process.execPath, [COMPARE, baseline, candidate], { encoding: 'utf8' });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('CLI: a clean self-comparison exits 0', () => {
  const file = writeCapture('clean', [record()]);
  const run = runCompare(file, file);
  assert.strictEqual(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.indexOf('PASS') !== -1);
});

test('CLI: a duplicate object key in the candidate is rejected', () => {
  const baseline = writeCapture('baseline', [record()]);
  // The two copies disagree, so silently keeping either one hides real drift.
  const duplicated = writeCapture('candidate', [
    record(),
    record({ rendered: { position: { x: 99, y: 0, z: 0 },
      rotation: { x: 0, y: 1, z: 0, angle: 0 }, scale: { x: 1, y: 1, z: 1 } } }),
  ]);
  const run = runCompare(baseline, duplicated);
  assert.notStrictEqual(run.status, 0);
  assert.ok(run.stderr.indexOf('DUPLICATE_OBJECT_KEY object_instance:77') !== -1,
    `expected DUPLICATE_OBJECT_KEY in stderr, got: ${run.stderr}`);
});

test('CLI: a duplicate object key in the baseline is rejected', () => {
  const duplicated = writeCapture('baseline', [record(), record()]);
  const candidate = writeCapture('candidate', [record()]);
  const run = runCompare(duplicated, candidate);
  assert.notStrictEqual(run.status, 0);
  assert.ok(run.stderr.indexOf('DUPLICATE_OBJECT_KEY object_instance:77') !== -1, run.stderr);
});

test('CLI: a duplicate is refused rather than silently deduplicated', () => {
  const baseline = writeCapture('baseline', [record()]);
  const duplicated = writeCapture('candidate', [record(), record()]);
  const run = runCompare(baseline, duplicated);
  // Neither "first wins" (which would print PASS) nor "last wins" is acceptable.
  assert.ok(run.stdout.indexOf('PASS') === -1,
    `duplicate input must never report PASS, got: ${run.stdout}`);
  assert.ok(run.stdout.indexOf('compared') === -1,
    'the comparison must not run at all on duplicate input');
  assert.strictEqual(run.status, 3);
});

test('CLI: the same id in two different tables is not a duplicate', () => {
  const records = [record(), record({ source: 'mall_object' })];
  const file = writeCapture('two-tables', records);
  const run = runCompare(file, file);
  assert.strictEqual(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.indexOf('compared 2') !== -1, run.stdout);
});

test('CLI: a raw stored-text rewrite fails the run', () => {
  const baseline = writeCapture('baseline', [record()]);
  const rewritten = record();
  rewritten.stored = Object.assign({}, rewritten.stored,
    { rawPosition: '{"x":1.5000,"y":0,"z":-2.25}' });
  const candidate = writeCapture('candidate', [rewritten]);
  const run = runCompare(baseline, candidate);
  assert.strictEqual(run.status, 1, run.stdout + run.stderr);
  assert.ok(run.stdout.indexOf('STORED_RAW_CHANGED') !== -1, run.stdout);
  assert.ok(run.stdout.indexOf('stored raw mismatches      1') !== -1, run.stdout);
  assert.ok(run.stdout.indexOf('stored numeric mismatches  0') !== -1, run.stdout);
});

module.exports = tests;
