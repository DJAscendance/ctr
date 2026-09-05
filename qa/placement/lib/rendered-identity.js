'use strict';

/**
 * Turns the raw live scene node list into placement records.
 *
 * This is deliberately separate from the browser driver so it can be tested
 * without one, and it deliberately works on the **raw** node list rather than a
 * Map. Collapsing nodes into a Map keyed by placement id is exactly what would
 * hide a world that rendered the same saved placement twice.
 *
 * Two ideas are kept apart on purpose:
 *
 * - a **placement** is one saved row (`object_instance.id` / `mall_object.id`);
 * - a **catalogue object** is the item that row points at (`object.id`).
 *
 * One shop legitimately stocking two copies of the same catalogue object is two
 * placements, not a duplicate. Two live nodes for one placement is the defect.
 */

/** Raised when one saved placement is rendered more than once. */
class DuplicateRenderedPlacementError extends Error {
  constructor(entries) {
    const detail = entries
      .map(e => `${e.source}:${e.id} in ${e.placeKey} rendered ${e.copies}x`)
      .join('; ');
    super(`DUPLICATE_RENDERED_PLACEMENT ${detail}`);
    this.name = 'DuplicateRenderedPlacementError';
    this.entries = entries;
  }
}

/** Raised when a rendered shop node matches no `mall_object` row. */
class UnresolvedMallObjectError extends Error {}

/**
 * Raised when a rendered shop node cannot be tied to a single `mall_object`.
 *
 * The SPA puts the catalogue object id on the SharedObject PROTO, not the
 * placement row id, so if one shop stocks the same catalogue object twice the
 * two live nodes are indistinguishable. Both placements are real and must not
 * be merged, so this is a hard failure rather than a guess.
 */
class AmbiguousMallIdentityError extends Error {}

/**
 * Resolves the placement identity of one rendered node.
 *
 * @param node       live scene node, carrying the id the SPA assigned
 * @param target     capture target (`source`, `placeKey`, `slug`)
 * @param mallRows   `<slug>:<object id>` -> array of `mall_object.id`
 */
function resolveIdentity(node, target, mallRows) {
  const nodeId = Number(node.id);
  if (target.source !== 'mall_object') {
    return { id: nodeId, objectId: null };
  }
  const key = `${target.slug}:${nodeId}`;
  const rows = (mallRows && mallRows.get(key)) || [];
  if (rows.length === 0) {
    throw new UnresolvedMallObjectError(
      `UNRESOLVED_MALL_OBJECT ${key} rendered but has no mall_object row`);
  }
  if (rows.length > 1) {
    throw new AmbiguousMallIdentityError(
      `AMBIGUOUS_MALL_IDENTITY ${key} maps to mall_object rows ${rows.join(', ')}: ` +
      'the scene node carries only the catalogue object id, so these two real ' +
      'placements cannot be told apart');
  }
  return { id: rows[0], objectId: nodeId };
}

/**
 * Resolves every rendered node, and fails if any saved placement appears twice.
 *
 * @returns {{ id, objectId, node }[]} one entry per live node, in scene order
 */
function resolveRenderedPlacements(nodes, target, mallRows) {
  const resolved = (nodes || []).map(node => {
    const identity = resolveIdentity(node, target, mallRows);
    return { id: identity.id, objectId: identity.objectId, node };
  });

  const counts = new Map();
  resolved.forEach(entry => {
    const key = `${target.source}:${entry.id}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const duplicates = [];
  counts.forEach((copies, key) => {
    if (copies > 1) {
      duplicates.push({
        source: target.source,
        id: Number(key.split(':')[1]),
        placeKey: target.placeKey,
        copies,
      });
    }
  });
  if (duplicates.length > 0) {
    throw new DuplicateRenderedPlacementError(duplicates);
  }
  return resolved;
}

module.exports = {
  resolveRenderedPlacements,
  resolveIdentity,
  DuplicateRenderedPlacementError,
  UnresolvedMallObjectError,
  AmbiguousMallIdentityError,
};
