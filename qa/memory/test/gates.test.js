'use strict';

/*
 * Tests for the pass rule, not for the browser.
 *
 * The live run takes twenty minutes and needs a GPU, a logged-in account and a
 * seeded database, so the decision it makes is kept in a pure function and
 * tested here against synthetic runs. What these cases pin down is the part
 * that is easy to get wrong in a way nobody notices: a gate that passes a
 * leaking run. Every "leaking" case below is modelled on a shape the
 * application has actually produced.
 */

const assert = require('assert');

const { evaluateGates, slope, WARMUP_TRANSITIONS } = require('../lib/gates');

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* Builds a run of `count` transitions from per-transition generators. */
function makeRun(count, fields = {}) {
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    const row = {
      transition: i,
      route: i % 2 === 0 ? '#/place/mall' : '#/place/enter',
      rootNodes: 10,
      canvasCount: 1,
      worldCanvasCount: 1,
      listenerTotal: 19,
      browserCallbacks: 1,
      sharedObjectsMapSize: 4,
      checkpoint: i === 1 || i % 20 === 0 || i === count,
    };
    for (const [key, value] of Object.entries(fields)) {
      row[key] = typeof value === 'function' ? value(i) : value;
    }
    if (row.checkpoint && row.retainedHeap === undefined) {
      row.retainedHeap = 300 * 1048576;
    }
    rows.push(row);
  }
  return rows;
}

function run(rows, extra = {}) {
  return evaluateGates(Object.assign(
    { rows, requested: rows.length, completed: rows.length, rendererDied: null, notes: [] },
    extra));
}

test('a flat run passes', () => {
  const result = run(makeRun(100));
  assert.strictEqual(result.verdict, 'PASS', result.failures.join('; '));
});

test('growing socket listeners fail even when memory is flat', () => {
  const result = run(makeRun(100, { listenerTotal: i => 19 + 6 * i }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /socket listeners grew/.test(f)), result.failures.join(';'));
});

test('a listener that rises once and then holds still fails', () => {
  /* Bounded-but-wrong is still wrong; the report just describes it differently. */
  const result = run(makeRun(100, { listenerTotal: i => (i < 50 ? 19 : 25) }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /socket listeners grew/.test(f)));
});

test('surviving the run is not enough when retained heap climbs', () => {
  /* The historical signal: tens of megabytes per transition, renderer alive. */
  const result = run(makeRun(100, {
    retainedHeap: i => (100 + 20 * i) * 1048576,
  }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /retained heap grew/.test(f)), result.failures.join(';'));
});

test('warm-up cost is not charged to the slope', () => {
  /*
   * A run that pays a large one-time cost over its first few loads and is flat
   * afterwards is the shape of a healthy engine filling its caches. Fitting
   * from transition 1 would read that startup step as a per-transition rate.
   */
  const rows = makeRun(100, {
    retainedHeap: i => (i <= WARMUP_TRANSITIONS ? 100 + 30 * i : 400) * 1048576,
  });
  const result = run(rows);
  assert.strictEqual(result.verdict, 'PASS', result.failures.join('; '));
});

test('an empty world fails', () => {
  const result = run(makeRun(100, { rootNodes: i => (i === 42 ? 0 : 10) }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /empty world/.test(f)));
});

test('a second world canvas fails', () => {
  const result = run(makeRun(100, { worldCanvasCount: i => (i > 30 ? 2 : 1) }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /#world canvas/.test(f)));
});

test('shared objects drifting upward on one repeated route fails', () => {
  /* Only the Mall rows drift; the plaza rows stay put. */
  const rows = makeRun(100, {
    sharedObjectsMapSize: i => (i % 2 === 0 ? 4 + Math.floor(i / 10) : 4),
  });
  const result = run(rows);
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /shared-object counts drifted/.test(f)));
});

test('shared objects differing between routes is not drift', () => {
  const result = run(makeRun(100, {
    sharedObjectsMapSize: i => (i % 2 === 0 ? 60 : 4),
  }));
  assert.strictEqual(result.verdict, 'PASS', result.failures.join('; '));
});

test('a short run fails even if every gate is otherwise clean', () => {
  const result = run(makeRun(40));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /60 is the minimum/.test(f)));
});

test('a dead renderer fails', () => {
  const result = run(makeRun(100), { rendererDied: 'page crashed' });
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /renderer did not survive/.test(f)));
});

test('unavailable listener counts fail rather than pass silently', () => {
  /*
   * If the probe cannot read the socket - because the application stopped
   * exposing it, or a version bump renamed the table - the run has no evidence
   * about listeners at all. That must read as FAIL, not as a clean sheet.
   */
  const result = run(makeRun(100, { listenerTotal: null }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /listener counts were unavailable/.test(f)));
});

test('growing X_ITE browser callbacks fail', () => {
  const result = run(makeRun(100, { browserCallbacks: i => i }));
  assert.strictEqual(result.verdict, 'FAIL');
  assert.ok(result.failures.some(f => /browser callbacks grew/.test(f)));
});

test('slope returns null when it cannot be fitted', () => {
  assert.strictEqual(slope([]), null);
  assert.strictEqual(slope([{ x: 1, y: 1 }]), null);
  assert.strictEqual(slope([{ x: 1, y: 1 }, { x: 1, y: 9 }]), null);
  assert.strictEqual(slope([{ x: 0, y: 0 }, { x: 2, y: 4 }]), 2);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    process.stdout.write(`ok   ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`FAIL ${name}\n     ${error.message}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);
