'use strict';

/**
 * Resolves the places the placement tools drive, from the database.
 *
 * Two of them have no fixed id. A home place is created when a citizen settles
 * and a club place when the fixture seed runs, so both land on whatever
 * auto-increment value the database happens to be at. A written-down id such as
 * `/club/837` therefore points at some other place - or at nothing - on every
 * freshly seeded database, and the tool then observes a place it was not asked
 * about while reporting zero rows for the one it was. That is not a small
 * inaccuracy: it is ten real placements recorded as unobserved.
 *
 * Routes matter too. `/place/:id` resolves a place by **slug**, so a numeric id
 * there leaves the store empty and the world never loads. Homes go through
 * `/home/:username` and clubs through `/club/:placeId`.
 */

/**
 * @param {(sql: string) => object[]} query read-only query runner
 * @param {object[]} targets target descriptors
 * @returns {object[]} the same targets with `placeId` and `route` filled in
 */
function resolveTargets(query, targets) {
  return targets.map(target => {
    const resolved = Object.assign({}, target);
    if (target.homeOwner) {
      const rows = query(
        `SELECT p.id FROM place p JOIN member m ON m.id = p.member_id ` +
        `WHERE p.type = 'home' AND m.username = '${target.homeOwner}' LIMIT 1;`);
      if (rows.length === 0) {
        throw new Error(`NO_HOME_PLACE for member ${target.homeOwner}`);
      }
      resolved.placeId = Number(rows[0].id);
      resolved.route = `/home/${target.homeOwner}`;
    } else if (target.clubSlug) {
      const rows = query(
        `SELECT id FROM place WHERE slug = '${target.clubSlug}' AND type = 'club' LIMIT 1;`);
      if (rows.length === 0) {
        throw new Error(`NO_CLUB_PLACE for slug ${target.clubSlug}`);
      }
      resolved.placeId = Number(rows[0].id);
      resolved.route = `/club/${resolved.placeId}`;
    } else {
      const rows = query(`SELECT id FROM place WHERE slug = '${target.slug}' LIMIT 1;`);
      if (rows.length === 0) {
        throw new Error(`NO_PLACE for slug ${target.slug}`);
      }
      resolved.placeId = Number(rows[0].id);
    }
    return resolved;
  });
}

/** The saved placement row ids each target must render, straight from the database. */
function expectedPlacements(query, targets) {
  const expected = new Map();
  targets.forEach(target => {
    const table = target.source === 'mall_object' ? 'mall_object' : 'object_instance';
    const rows = query(`SELECT id FROM ${table} WHERE place_id = ${target.placeId} ORDER BY id;`);
    expected.set(target.key, rows.map(row => Number(row.id)));
  });
  return expected;
}

/** Two URLs name the same asset when only their slash runs differ. */
function samePath(a, b) {
  if (!a || !b) {
    return false;
  }
  const strip = value => String(value).replace(/^https?:\/\/[^/]+/, '').replace(/\/{2,}/g, '/');
  return strip(a) === strip(b);
}

module.exports = { resolveTargets, expectedPlacements, samePath };
