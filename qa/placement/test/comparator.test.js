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

test('identical raw stored text passes the raw-storage gate', () => {
  const result = compareCaptures(capture([record()]), capture([record()]));
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.records[0].storedRawEqual, true);
  assert.strictEqual(result.records[0].storedNumericEqual, true);
  assert.strictEqual(result.summary.storedRawMismatches, 0);
});

test('reformatted raw text with equal numbers fails the raw-storage gate', () => {
  // `1.0` and `1.0000` parse alike. The column was still rewritten.
  const reformatted = mutate(r => {
    r.stored.rawPosition = '{"x":1.5000,"y":0,"z":-2.25}';
  });
  const result = compareCaptures(capture([record()]), capture([reformatted]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.records[0].storedRawEqual, false);
  // The numbers did not move, so this must not be reported as movement.
  assert.strictEqual(result.records[0].storedNumericEqual, true);
  assert.strictEqual(result.records[0].renderedEqual, true);
  assert.ok(result.records[0].failures.some(f => f.startsWith('STORED_RAW_CHANGED')));
  assert.strictEqual(result.summary.storedRawMismatches, 1);
  assert.strictEqual(result.summary.storedNumericMismatches, 0);
  assert.strictEqual(result.summary.renderedMismatches, 0);
});

test('raw rotation whitespace change fails the raw-storage gate', () => {
  const respaced = mutate(r => {
    r.stored.rawRotation = '{"x": 0, "y": 1, "z": 0, "angle": 1.5707963}';
  });
  const result = compareCaptures(capture([record()]), capture([respaced]));
  assert.strictEqual(result.pass, false);
  assert.ok(result.records[0].failures.some(
    f => f.indexOf('STORED_RAW_CHANGED stored.rawRotation') === 0));
  assert.strictEqual(result.records[0].storedNumericEqual, true);
});

test('key reordering in raw text fails the raw-storage gate', () => {
  const reordered = mutate(r => {
    r.stored.rawPosition = '{"z":-2.25,"y":0,"x":1.5}';
  });
  const result = compareCaptures(capture([record()]), capture([reordered]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.records[0].storedRawEqual, false);
  assert.strictEqual(result.records[0].storedNumericEqual, true);
});

test('a raw column disappearing fails the raw-storage gate', () => {
  const dropped = mutate(r => {
    r.stored.rawPosition = null;
  });
  const result = compareCaptures(capture([record()]), capture([dropped]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.records[0].storedRawEqual, false);
});

test('different numeric values fail even when raw text is untouched', () => {
  // Only the parsed layer moved. Raw stays equal, so the two gates disagree and
  // the report must show exactly which one tripped.
  const moved = mutate(r => {
    r.stored.position.x = 9.5;
  });
  const result = compareCaptures(capture([record()]), capture([moved]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.records[0].storedRawEqual, true);
  assert.strictEqual(result.records[0].storedNumericEqual, false);
  assert.strictEqual(result.summary.storedRawMismatches, 0);
  assert.strictEqual(result.summary.storedNumericMismatches, 1);
});

test('rendered drift inside tolerance leaves both stored gates equal', () => {
  const noisy = mutate(r => {
    r.rendered.position.x += 0.00009;
  });
  const result = compareCaptures(capture([record()]), capture([noisy]));
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.records[0].storedRawEqual, true);
  assert.strictEqual(result.records[0].storedNumericEqual, true);
  assert.strictEqual(result.records[0].renderedEqual, true);
});

test('rendered drift outside tolerance fails with both stored gates equal', () => {
  const moved = mutate(r => {
    r.rendered.position.x += 0.02;
  });
  const result = compareCaptures(capture([record()]), capture([moved]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.records[0].storedRawEqual, true);
  assert.strictEqual(result.records[0].storedNumericEqual, true);
  assert.strictEqual(result.records[0].renderedEqual, false);
  assert.strictEqual(result.summary.renderedMismatches, 1);
});

test('captures with no raw layer on either side still compare', () => {
  // The pre-raw baseline format must keep working rather than failing closed.
  const legacy = mutate(r => {
    delete r.stored.rawPosition;
    delete r.stored.rawRotation;
  });
  const result = compareCaptures(capture([legacy]), capture([legacy]));
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.records[0].storedRawEqual, true);
});

test('the three gates are reported separately in one run', () => {
  const rawOnly = record({ id: 4001 });
  const rawOnlyCand = mutate(r => {
    r.stored.rawPosition = '{"x":1.50,"y":0,"z":-2.25}';
  });
  const numericOnly = record({ id: 4002 });
  const numericOnlyCand = mutate(r => {
    r.id = 4002;
    r.stored.position.z = -9;
    r.stored.rawPosition = record().stored.rawPosition;
  });
  const renderedOnly = record({ id: 4003 });
  const renderedOnlyCand = mutate(r => {
    r.id = 4003;
    r.rendered.position.y = 5;
  });
  const result = compareCaptures(
    capture([rawOnly, numericOnly, renderedOnly]),
    capture([rawOnlyCand, numericOnlyCand, renderedOnlyCand]));
  assert.strictEqual(result.pass, false);
  assert.strictEqual(result.summary.storedRawMismatches, 1);
  assert.strictEqual(result.summary.storedNumericMismatches, 1);
  assert.strictEqual(result.summary.renderedMismatches, 1);
});

test('same id in different tables does not collide', () => {
  const mall = record({ source: 'mall_object' });
  const result = compareCaptures(capture([record(), mall]), capture([record(), mall]));
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.summary.compared, 2);
});

module.exports = tests;
