'use strict';

const assert = require('assert');
const { compareCaptures } = require('../lib/comparator');
const { CONTROL_ENGINE_VERSION } = require('../lib/contract');

/** Builds a single synthetic capture record. No real user data is involved. */
function record(overrides) {
  const base = {
    source: 'object_instance',
    id: 4001,
    stored: {
      placeId: 836,
      objectId: 11,
      memberId: 1,
      url: '/assets/object/qafix/ct-table/Table_finished.wrl',
      position: { x: 1.5, y: 0, z: -2.25 },
      rotation: { x: 0, y: 1, z: 0, angle: 1.5707963 },
    },
    rendered: {
      position: { x: 1.5, y: 0, z: -2.25 },
      rotation: { x: 0, y: 1, z: 0, angle: 1.5707963 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  return Object.assign({}, base, overrides || {});
}

function capture(records) {
  return { engine: CONTROL_ENGINE_VERSION, commit: 'test', records };
}

/** Deep-clones a record and applies a mutation callback. */
function mutate(fn) {
  const clone = JSON.parse(JSON.stringify(record()));
  fn(clone);
  return clone;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('identical captures pass', () => {
  const result = compareCaptures(capture([record()]), capture([record()]));
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.summary.failed, 0);
  assert.strictEqual(result.records[0].status, 'PASS');
});

test('rendered float noise inside tolerance passes', () => {
  const noisy = mutate(r => {
    r.rendered.position.x += 0.00005;
    r.rendered.rotation.angle -= 0.00002;
    r.rendered.scale.y += 0.00001;
  });
  const result = compareCaptures(capture([record()]), capture([noisy]));
  assert.strictEqual(result.pass, true);
});

test('rendered movement beyond tolerance fails', () => {
  const moved = mutate(r => {
    r.rendered.position.z += 0.01;
  });
  const result = compareCaptures(capture([record()]), capture([moved]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(f => f.startsWith('rendered.position.z')));
  assert.ok(Math.abs(result.records[0].renderedPositionDelta.z - 0.01) < 1e-9);
});

test('rendered rotation change fails', () => {
  const turned = mutate(r => {
    r.rendered.rotation.angle += 0.05;
  });
  const result = compareCaptures(capture([record()]), capture([turned]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(f => f.startsWith('rendered.rotation.angle')));
});

test('rendered scale change fails', () => {
  const scaled = mutate(r => {
    r.rendered.scale.x = 1.2;
  });
  const result = compareCaptures(capture([record()]), capture([scaled]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(f => f.startsWith('rendered.scale.x')));
});

test('stored value change fails even below the rendered tolerance', () => {
  const rewritten = mutate(r => {
    r.stored.position.x += 0.00001;
  });
  const result = compareCaptures(capture([record()]), capture([rewritten]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(f => f.startsWith('stored.position.x')));
});

test('stored rotation rewrite fails', () => {
  const rewritten = mutate(r => {
    r.stored.rotation.angle = 1.5707;
  });
  const result = compareCaptures(capture([record()]), capture([rewritten]));
  assert.strictEqual(result.pass, false);
});

test('stored identity change fails', () => {
  const moved = mutate(r => {
    r.stored.placeId = 837;
  });
  const result = compareCaptures(capture([record()]), capture([moved]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(f => f.startsWith('stored.placeId')));
});

test('missing object fails and is not skipped', () => {
  const result = compareCaptures(capture([record()]), capture([]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.records.length, 1);
  assert.deepStrictEqual(result.records[0].failures, ['missing from candidate capture']);
});

test('extra object in candidate fails', () => {
  const extra = record({ id: 4002 });
  const result = compareCaptures(capture([record()]), capture([record(), extra]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records.some(r => (r.failures || []).some(f => f.startsWith('unexpected object'))));
});

test('duplicate object key fails', () => {
  const result = compareCaptures(capture([record()]), capture([record(), record()]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records.some(r => (r.failures || []).some(f => f.indexOf('duplicate key') !== -1)));
});

test('rendered block missing from candidate fails', () => {
  const noRender = mutate(r => {
    delete r.rendered;
  });
  const result = compareCaptures(capture([record()]), capture([noRender]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(f => f.indexOf('missing from candidate') !== -1));
});

test('an object with no stored placement on either side still passes', () => {
  // Rows whose `position` column is NULL render at the origin. Both sides are
  // absent in the same way, so this is agreement, not a difference.
  const nulled = mutate(r => {
    r.stored.position = { x: null, y: null, z: null };
    r.stored.rotation = { x: null, y: null, z: null, angle: null };
  });
  const result = compareCaptures(capture([nulled]), capture([nulled]));
  assert.strictEqual(result.pass, true);
});

test('a stored value appearing where the baseline had none fails', () => {
  const before = mutate(r => {
    r.stored.position = { x: null, y: null, z: null };
  });
  const after = mutate(r => {
    r.stored.position = { x: 0, y: 0, z: 0 };
  });
  const result = compareCaptures(capture([before]), capture([after]));
  assert.strictEqual(result.pass, false);
});

test('same id in different tables does not collide', () => {
  const mall = record({ source: 'mall_object' });
  const result = compareCaptures(capture([record(), mall]), capture([record(), mall]));
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.summary.compared, 2);
});

module.exports = tests;
