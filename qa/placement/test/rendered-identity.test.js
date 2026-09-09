'use strict';

/**
 * Tests for live-scene placement identity and duplicate detection.
 *
 * The distinction these guard is the important one: one saved placement
 * rendered twice is a defect; two saved placements that happen to point at the
 * same catalogue object are two legitimate objects.
 */

const assert = require('assert');
const {
  resolveRenderedPlacements,
  DuplicateRenderedPlacementError,
  UnresolvedMallObjectError,
  AmbiguousMallIdentityError,
} = require('../lib/rendered-identity');

/** A live scene node as capture-rendered.js reads it. */
function node(id) {
  return {
    id: String(id),
    name: `QAFIX ${id}`,
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 1, z: 0, angle: 0 },
  };
}

const PLACE = { source: 'object_instance', placeKey: 'place' };
const SHOP = { source: 'mall_object', placeKey: 'shop', slug: 'antiqueshop' };

/** `<slug>:<object id>` -> every mall_object row using it. */
function mallRows(pairs) {
  const index = new Map();
  pairs.forEach(([key, ids]) => index.set(key, ids));
  return index;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('object_instance: distinct placements resolve one-to-one', () => {
  const resolved = resolveRenderedPlacements([node(70), node(71), node(72)], PLACE, null);
  assert.strictEqual(resolved.length, 3);
  assert.deepStrictEqual(resolved.map(r => r.id), [70, 71, 72]);
});

test('object_instance: one placement rendered twice fails', () => {
  assert.throws(
    () => resolveRenderedPlacements([node(70), node(71), node(70)], PLACE, null),
    error => {
      assert.ok(error instanceof DuplicateRenderedPlacementError);
      assert.ok(error.message.indexOf('DUPLICATE_RENDERED_PLACEMENT') === 0, error.message);
      assert.ok(error.message.indexOf('object_instance:70') !== -1, error.message);
      assert.ok(error.message.indexOf('in place') !== -1, error.message);
      assert.ok(error.message.indexOf('rendered 2x') !== -1, error.message);
      return true;
    });
});

test('object_instance: the error names every duplicated placement', () => {
  try {
    resolveRenderedPlacements([node(70), node(70), node(71), node(71)], PLACE, null);
    assert.fail('expected a duplicate failure');
  } catch (error) {
    assert.strictEqual(error.entries.length, 2);
    assert.deepStrictEqual(error.entries.map(e => e.id).sort(), [70, 71]);
    assert.ok(error.entries.every(e => e.copies === 2));
  }
});

test('mall_object: catalogue ids resolve to placement row ids', () => {
  const rows = mallRows([['antiqueshop:36', [12]], ['antiqueshop:37', [13]]]);
  const resolved = resolveRenderedPlacements([node(36), node(37)], SHOP, rows);
  assert.deepStrictEqual(resolved.map(r => r.id), [12, 13]);
  // The catalogue id is kept for traceability but is not the identity.
  assert.deepStrictEqual(resolved.map(r => r.objectId), [36, 37]);
});

test('mall_object: one placement rendered twice fails', () => {
  const rows = mallRows([['antiqueshop:36', [12]]]);
  assert.throws(
    () => resolveRenderedPlacements([node(36), node(36)], SHOP, rows),
    error => {
      assert.ok(error instanceof DuplicateRenderedPlacementError);
      // Reported against the placement row, not the catalogue object.
      assert.ok(error.message.indexOf('mall_object:12') !== -1, error.message);
      assert.ok(error.message.indexOf('in shop') !== -1, error.message);
      assert.ok(error.message.indexOf('rendered 2x') !== -1, error.message);
      return true;
    });
});

test('mall_object: two placements of different catalogue objects are not duplicates', () => {
  const rows = mallRows([['antiqueshop:36', [12]], ['antiqueshop:99', [13]]]);
  const resolved = resolveRenderedPlacements([node(36), node(99)], SHOP, rows);
  assert.deepStrictEqual(resolved.map(r => r.id), [12, 13]);
});

test('mall_object: two placements sharing one catalogue object are two placements', () => {
  // The shop stocks catalogue object 36 twice, as rows 12 and 13. These are two
  // real objects a citizen can see and move, so they must never collapse into
  // one. The scene node only carries the catalogue id, so they also cannot be
  // told apart -- which is a hard failure, not a silent pick of either row.
  const rows = mallRows([['antiqueshop:36', [12, 13]]]);
  assert.throws(
    () => resolveRenderedPlacements([node(36), node(36)], SHOP, rows),
    error => {
      assert.ok(error instanceof AmbiguousMallIdentityError, error.message);
      assert.ok(error.message.indexOf('AMBIGUOUS_MALL_IDENTITY') === 0, error.message);
      assert.ok(error.message.indexOf('12, 13') !== -1, error.message);
      return true;
    });
  // The ambiguity is about telling them apart, never about whether both exist.
  assert.strictEqual(rows.get('antiqueshop:36').length, 2);
});

test('mall_object: a rendered node with no placement row fails', () => {
  const rows = mallRows([['antiqueshop:36', [12]]]);
  assert.throws(
    () => resolveRenderedPlacements([node(404)], SHOP, rows),
    error => {
      assert.ok(error instanceof UnresolvedMallObjectError);
      assert.ok(error.message.indexOf('UNRESOLVED_MALL_OBJECT') === 0, error.message);
      return true;
    });
});

test('an empty scene resolves to no placements rather than failing', () => {
  assert.deepStrictEqual(resolveRenderedPlacements([], PLACE, null), []);
  assert.deepStrictEqual(resolveRenderedPlacements(null, PLACE, null), []);
});

test('the raw node list is inspected, not a deduplicating Map', () => {
  // Guards the actual defect: a Map keyed by placement id would have silently
  // collapsed these three nodes into one and reported a clean scene.
  const nodes = [node(70), node(70), node(70)];
  assert.strictEqual(new Set(nodes.map(n => n.id)).size, 1);
  try {
    resolveRenderedPlacements(nodes, PLACE, null);
    assert.fail('expected a duplicate failure');
  } catch (error) {
    assert.strictEqual(error.entries[0].copies, 3);
  }
});

module.exports = tests;
