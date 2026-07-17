import { Knex } from 'knex';

/**
 * Consolidates duplicate `role` rows and prevents recurrence.
 *
 * Root cause: `05-roles.seed`/`06-donor.roles.seed` insert unconditionally, so running the
 * seed suite more than once inserts a second copy of every role name. `RoleRepository`
 * resolved each name to whichever id was iterated last, so authorization silently depended
 * on which duplicate happened to have the higher id (e.g. `roleMap.Admin === 114`). That is
 * not durable: adding another duplicate would silently move which id is treated as "Admin".
 *
 * This migration keeps the lowest id per name as the canonical row, repoints every
 * `role_assignment` onto that canonical id, removes assignment rows that would become exact
 * duplicates after repointing, deletes the redundant role rows, and adds a UNIQUE(name)
 * index so a duplicate can never be inserted again. Duplicate rows share identical metadata,
 * so keeping the lowest id loses nothing. Safe (no-op) on databases with no duplicates.
 */

const UNIQUE_INDEX = 'role_name_unique';

async function uniqueNameIndexExists(knex: Knex): Promise<boolean> {
  const [rows] = await knex.raw(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'role' AND index_name = ?`,
    [UNIQUE_INDEX],
  );
  return Number(rows[0].c) > 0;
}

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async trx => {
    // Map every duplicate (non-canonical) role id to its canonical (lowest-id) sibling.
    await trx.raw('DROP TEMPORARY TABLE IF EXISTS role_dup_map');
    await trx.raw(
      `CREATE TEMPORARY TABLE role_dup_map AS
         SELECT r.id AS dup_id, c.canon_id AS canon_id
         FROM role r
         JOIN (SELECT name, MIN(id) AS canon_id FROM role GROUP BY name) c
           ON c.name = r.name
        WHERE r.id <> c.canon_id`,
    );

    // Drop non-canonical assignments that would collide with an existing canonical
    // assignment after repointing (same member, same canonical role, same place). The
    // derived table lets MySQL 5.7 read role_assignment while deleting from it.
    await trx.raw(
      `DELETE ra FROM role_assignment ra
         JOIN role_dup_map m ON m.dup_id = ra.role_id
        WHERE EXISTS (
          SELECT 1 FROM (SELECT member_id, role_id, place_id FROM role_assignment) keep
           WHERE keep.member_id = ra.member_id
             AND keep.role_id = m.canon_id
             AND (keep.place_id <=> ra.place_id)
        )`,
    );

    // Repoint the remaining duplicate assignments onto the canonical role id.
    await trx.raw(
      `UPDATE role_assignment ra
         JOIN role_dup_map m ON m.dup_id = ra.role_id
          SET ra.role_id = m.canon_id`,
    );

    // Now that nothing references them, delete the duplicate role rows.
    await trx.raw(
      'DELETE r FROM role r JOIN role_dup_map m ON m.dup_id = r.id',
    );

    await trx.raw('DROP TEMPORARY TABLE IF EXISTS role_dup_map');
  });

  // Guarantee names stay unique going forward. Added outside the transaction because MySQL
  // implicitly commits DDL; the guard keeps the migration safe to re-run.
  if (!(await uniqueNameIndexExists(knex))) {
    await knex.schema.alterTable('role', table => {
      table.unique(['name'], { indexName: UNIQUE_INDEX });
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Only the guard index is reversible. The row consolidation is intentionally not undone:
  // re-creating duplicate rows would restore the exact bug this migration removes.
  if (await uniqueNameIndexExists(knex)) {
    await knex.schema.alterTable('role', table => {
      table.dropUnique(['name'], UNIQUE_INDEX);
    });
  }
}
