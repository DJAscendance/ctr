import { Knex } from 'knex';

/**
 * Consolidates duplicate seeded `place` rows and prevents recurrence.
 *
 * Root cause, identical in shape to the one 20260717120000_dedupe_role_rows fixed for
 * `role`: `02-places.seed` and `07-mall.store.seed` call `knex('place').insert(...)`
 * unconditionally, so every extra run of the seed suite inserts another copy of every
 * public place and mall shop. (`03-places.colonies.seed` and `04-places.hoods.seed` delete
 * before inserting, which is why colonies and hoods are unaffected.) A database that has
 * been seeded three times ends up with three "The Plaza" rows, all `status = 1` and all
 * sharing the slug `enter` - and `PlaceRepository.findBySlug` returns whichever row the
 * database happens to hand back first. Nothing is visibly broken today only because that
 * is normally the lowest id, which is the one holding the real data.
 *
 * SCOPE - deliberately narrow. Duplicates are identified by `slug`, and ONLY for
 * `type IN ('public','shop')`. It is NOT safe to group places by (name, type):
 * neighbourhoods legitimately contain different blocks that share a display name -
 * "Atlantis" exists in both The Kingdoms and Fantasy, "Rivendell" in both Mystical Action
 * and Middle Earth - and each of those is a real, separately mapped place with its own
 * coordinate-derived slug. Grouping on name would delete 21 genuine blocks. Blocks, hoods
 * and colonies have zero duplicated slugs, which is the evidence that their name
 * collisions are legitimate rather than seed artefacts.
 *
 * SAFETY - a duplicate is only removed once nothing references it. References that can be
 * moved are repointed onto the canonical (lowest-id) row first; a duplicate still holding a
 * map slot is left alone rather than guessed at, because deleting it would take a real
 * place off a hood or colony map. Any such row is reported in the migration output.
 *
 * Safe (no-op) on a database that was seeded once.
 */

const UNIQUE_INDEX = 'place_slug_unique';

/** Every column that points at `place.id`, other than map_location (handled separately). */
const REFERENCING_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'message', column: 'place_id' },
  { table: 'inbox', column: 'place_id' },
  { table: 'messageboard', column: 'place_id' },
  { table: 'virtual_pet', column: 'place_id' },
  { table: 'vote_list', column: 'place_id' },
  { table: 'club_member', column: 'club_id' },
  { table: 'mall_object', column: 'place_id' },
  { table: 'object_instance', column: 'place_id' },
  { table: 'member', column: 'place_id' },
  { table: 'home', column: 'place_id' },
];

async function uniqueSlugIndexExists(knex: Knex): Promise<boolean> {
  const [rows] = await knex.raw(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'place' AND index_name = ?`,
    [UNIQUE_INDEX],
  );
  return Number(rows[0].c) > 0;
}

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async trx => {
    // Map every duplicate (non-canonical) seeded place to its canonical lowest-id sibling.
    await trx.raw('DROP TEMPORARY TABLE IF EXISTS place_dup_map');
    await trx.raw(
      `CREATE TEMPORARY TABLE place_dup_map AS
         SELECT p.id AS dup_id, c.canon_id AS canon_id
         FROM place p
         JOIN (
           SELECT slug, type, MIN(id) AS canon_id
           FROM place
           WHERE type IN ('public','shop') AND slug IS NOT NULL AND slug <> ''
           GROUP BY slug, type
         ) c ON c.slug = p.slug AND c.type = p.type
        WHERE p.type IN ('public','shop')
          AND p.slug IS NOT NULL AND p.slug <> ''
          AND p.id <> c.canon_id`,
    );

    // Repoint movable references onto the canonical row. In a database whose duplicates are
    // inert (the usual case) these all affect zero rows; they exist so a database where a
    // citizen wandered into a duplicate - member.place_id - or posted in one still keeps
    // that data, attached to the row the application actually resolves.
    for (const { table, column } of REFERENCING_COLUMNS) {
      await trx.raw(
        `UPDATE ${table} t JOIN place_dup_map m ON m.dup_id = t.${column}
            SET t.${column} = m.canon_id`,
      );
    }

    // role_assignment can collide: repointing may produce a row identical to one that
    // already exists for the canonical place. Drop those before repointing the remainder,
    // exactly as the role dedupe migration does. The derived table lets MySQL 5.7 read
    // role_assignment while deleting from it.
    await trx.raw(
      `DELETE ra FROM role_assignment ra
         JOIN place_dup_map m ON m.dup_id = ra.place_id
        WHERE EXISTS (
          SELECT 1 FROM (SELECT member_id, role_id, place_id FROM role_assignment) keep
           WHERE keep.member_id = ra.member_id
             AND keep.role_id = ra.role_id
             AND keep.place_id = m.canon_id
        )`,
    );
    await trx.raw(
      `UPDATE role_assignment ra JOIN place_dup_map m ON m.dup_id = ra.place_id
          SET ra.place_id = m.canon_id`,
    );

    // A duplicate that still occupies a map slot, or that other places are mapped under, is
    // NOT a safe delete - removing it would take a real place off a map. Leave those rows
    // in place and say so; the dedupe is still correct for everything else.
    const [mapped] = await trx.raw(
      `SELECT p.id, p.name, p.slug FROM place p
         JOIN place_dup_map m ON m.dup_id = p.id
        WHERE EXISTS (SELECT 1 FROM map_location ml WHERE ml.place_id = p.id)
           OR EXISTS (SELECT 1 FROM map_location ml WHERE ml.parent_place_id = p.id)`,
    );
    if (Array.isArray(mapped) && mapped.length > 0) {
      for (const row of mapped) {
        console.log(
          `dedupe_seeded_places: keeping duplicate place ${row.id} (${row.slug}) - still mapped`,
        );
      }
      await trx.raw(
        `DELETE m FROM place_dup_map m
          WHERE EXISTS (SELECT 1 FROM map_location ml WHERE ml.place_id = m.dup_id)
             OR EXISTS (SELECT 1 FROM map_location ml WHERE ml.parent_place_id = m.dup_id)`,
      );
    }

    const [before] = await trx.raw('SELECT COUNT(*) AS c FROM place_dup_map');
    console.log(`dedupe_seeded_places: removing ${before[0].c} duplicate place rows`);

    await trx.raw('DELETE p FROM place p JOIN place_dup_map m ON m.dup_id = p.id');
    await trx.raw('DROP TEMPORARY TABLE IF EXISTS place_dup_map');
  });

  // Guard against recurrence, the same way the role dedupe does. Only added when every
  // non-null slug is already unique - if a duplicate had to be kept above because it is
  // still mapped, the index would fail, and failing the whole migration over that would be
  // worse than leaving the guard off. Slugs are NULL for homes and storage areas, and MySQL
  // permits repeated NULLs in a unique index, so those are unaffected.
  const [remaining] = await knex.raw(
    `SELECT COUNT(*) AS c FROM (
       SELECT slug FROM place
        WHERE slug IS NOT NULL AND slug <> ''
        GROUP BY slug HAVING COUNT(*) > 1
     ) z`,
  );
  if (Number(remaining[0].c) > 0) {
    console.log(
      'dedupe_seeded_places: duplicate slugs remain, skipping the UNIQUE(slug) guard',
    );
    return;
  }
  if (!(await uniqueSlugIndexExists(knex))) {
    await knex.schema.alterTable('place', table => {
      table.unique(['slug'], { indexName: UNIQUE_INDEX });
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Only the guard index is reversible. Re-creating the duplicate rows would restore the
  // ambiguous slug resolution this migration exists to remove.
  if (await uniqueSlugIndexExists(knex)) {
    await knex.schema.alterTable('place', table => {
      table.dropUnique(['slug'], UNIQUE_INDEX);
    });
  }
}
