'use strict';

/**
 * Emits the SQL that seeds the placement fixture set.
 *
 * This writes only to a disposable QA database. It never updates an existing
 * `object_instance` or `mall_object` row: every statement is an INSERT of a
 * `QAFIX ` row, and the companion `--purge` output removes exactly those rows
 * again. Real citizen placement is never read, rewritten or rounded.
 *
 * Usage:
 *   node tools/seed-fixtures.js          > seed.sql
 *   node tools/seed-fixtures.js --purge  > purge.sql
 */

const fs = require('fs');
const path = require('path');

const SET = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fixture-set.json'), 'utf8'));

const PURGE = process.argv.indexOf('--purge') !== -1;
const MARKER = 'QAFIX ';

const lines = [];

function emit(sql) {
  lines.push(sql);
}

if (PURGE) {
  emit(`DELETE oi FROM object_instance oi JOIN object o ON o.id = oi.object_id
        WHERE o.name LIKE '${MARKER}%';`);
  emit(`DELETE mo FROM mall_object mo JOIN object o ON o.id = mo.object_id
        WHERE o.name LIKE '${MARKER}%';`);
  emit(`DELETE FROM object WHERE name LIKE '${MARKER}%';`);
  emit(`DELETE FROM place WHERE name = 'QAFIX Club';`);
  console.log(lines.join('\n'));
  return;
}

emit(`START TRANSACTION;`);

// Club place: the QA database ships with no club, so create one for the group.
emit(`INSERT INTO place
  (name, slug, type, member_id, private, status, description, assets_dir, world_filename)
  SELECT 'QAFIX Club', 'personalclub', 'club', 1, 0, 1, 'placement fixture club',
         '/club/vrml/', 'club_proto.wrl'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM place WHERE name = 'QAFIX Club');`);

// Club access: the QA login user must own the fixture club or the club door
// blocks the 3D view and no object can be observed. Membership and role rows
// only; no object placement value is touched.
emit(`INSERT INTO club_member (club_id, member_id, status)
  SELECT p.id, m.id, 'member' FROM place p, member m
   WHERE p.name = 'QAFIX Club' AND m.username = 'testqa'
     AND NOT EXISTS (SELECT 1 FROM club_member c
                      WHERE c.club_id = p.id AND c.member_id = m.id);`);
emit(`INSERT INTO role_assignment (member_id, role_id, place_id)
  SELECT m.id, r.id, p.id FROM place p, member m, role r
   WHERE p.name = 'QAFIX Club' AND m.username = 'testqa' AND r.name = 'Club Owner'
     AND NOT EXISTS (SELECT 1 FROM role_assignment a
                      WHERE a.place_id = p.id AND a.member_id = m.id AND a.role_id = r.id);`);
emit(`UPDATE place p JOIN member m ON m.username = 'testqa'
   SET p.member_id = m.id WHERE p.name = 'QAFIX Club';`);

// The QA seed home place carries no world file, so the 3D view never loads and
// no object can be observed in it. Fill it in from its home_design_id. This is
// place metadata only: no object placement value is read or written here.
emit(`UPDATE place p
  JOIN home h ON h.place_id = p.id
   SET p.assets_dir = CONCAT('/', h.home_design_id, '/'),
       p.world_filename = 'home.wrl'
 WHERE p.type = 'home' AND (p.world_filename IS NULL OR p.assets_dir IS NULL);`);

/*
 * A home also needs its block.
 *
 * `place` has no parent column: the home-to-block link lives in `map_location`,
 * and `GET /api/home/:username` walks it through `homeService.getHomeBlock`. A
 * home place inserted without a claimed lot makes that walk dereference an
 * undefined row, so the route answers 400, `main.ts` never calls `setPlace`,
 * and the SPA stays in whatever place it was already in. The 3D view then shows
 * the *previous* world, still holding the previous place's objects - which
 * reads as a home that partly rendered rather than as a home that was never
 * reached. Claiming a free lot is place metadata only; no placement value is
 * read or written here.
 */
emit(`UPDATE map_location ml
  JOIN (SELECT p.id AS place_id FROM place p
         WHERE p.type = 'home'
           AND NOT EXISTS (SELECT 1 FROM map_location m WHERE m.place_id = p.id)
         ORDER BY p.id LIMIT 1) unlinked
  JOIN (SELECT parent_place_id, MIN(location) AS location FROM map_location
         WHERE available = 1 AND (place_id IS NULL OR place_id = 0)
         GROUP BY parent_place_id ORDER BY parent_place_id LIMIT 1) free
    ON ml.parent_place_id = free.parent_place_id AND ml.location = free.location
   SET ml.place_id = unlinked.place_id;`);

SET.objects.forEach(object => {
  emit(`INSERT INTO object (name, filename, directory, member_id, quantity, status, price)
  SELECT ${sql(object.name)}, ${sql(object.filename)}, ${sql(object.directory)}, 1, 999, 1, 0
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM object WHERE name = ${sql(object.name)});`);
});

const PLACE_SQL = {
  home: `(SELECT place_id FROM home ORDER BY place_id LIMIT 1)`,
  club: `(SELECT id FROM place WHERE name = 'QAFIX Club' LIMIT 1)`,
  shop: `(SELECT id FROM place WHERE type = 'shop' ORDER BY id LIMIT 1)`,
  plaza: `(SELECT id FROM place WHERE slug = 'enter' LIMIT 1)`,
  fleamarket: `(SELECT id FROM place WHERE slug = 'fleamarket' LIMIT 1)`,
};

SET.fixtures.forEach(fixture => {
  const object = SET.objects.find(o => o.objectRef === fixture.objectRef);
  const position = sql(JSON.stringify(fixture.position));
  const rotation = sql(JSON.stringify(fixture.rotation));
  const objectId = `(SELECT id FROM object WHERE name = ${sql(object.name)} LIMIT 1)`;
  const placeId = PLACE_SQL[fixture.placeKey];
  // Historical rows get a back-dated created_at so the set spans object eras.
  const createdAt = fixture.era === 'historical'
    ? `'2003-06-14 12:00:00'` : `CURRENT_TIMESTAMP`;
  const name = sql(`${object.name} ${fixture.fixtureRef}`);

  if (fixture.source === 'object_instance') {
    emit(`INSERT INTO object_instance
  (object_id, object_name, member_id, place_id, position, rotation, created_at, updated_at)
  VALUES (${objectId}, ${name}, 1, ${placeId}, ${position}, ${rotation},
    ${createdAt}, CURRENT_TIMESTAMP);`);
  } else {
    emit(`INSERT INTO mall_object (object_id, place_id, position, rotation, created_at, updated_at)
  VALUES (${objectId}, ${placeId}, ${position}, ${rotation}, ${createdAt}, CURRENT_TIMESTAMP);`);
  }
});

emit(`COMMIT;`);

function sql(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

console.log(lines.join('\n'));
