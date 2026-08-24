import { Knex } from 'knex';

/**
 * The second access axis: roles check-marked to grant write access at a place.
 *
 * CS 4.x gives every place two independent axes (see the CS 4.1 research notes,
 * "Access rights"):
 *
 *   1. Up to eight identity entries, each a Group or a Member. CTR already has this as
 *      owner-plus-deputies in role_assignment, resolved by
 *      RoleAssignmentRepository.getAccessInfoByID.
 *   2. Any role may be check-marked to grant write access to EVERYONE holding it, across
 *      the full role list. CTR had no representation for this at all, which is why
 *      "let every City Guide write here" could not be expressed and place owners had to
 *      name eight individuals instead.
 *
 * This table is axis 2. A row means "holders of role_id may write at place_id".
 *
 * Deliberately NOT included: the capability bitfield (read 0x01 / change 0x02 /
 * write 0x04 / delete 0x08). Presence of a row means write access, matching the shipped
 * UI, which offers a checkbox per role and nothing finer. Adding capabilities is tracked
 * separately, and the research notes are emphatic that if they are added they must come
 * with the denial bookkeeping the original omitted -- the 4.1 delete branch recorded
 * grants but never denials, so an explicit denial was indistinguishable from silence and
 * fell through to the hierarchical walk, which could then grant it from an ancestor.
 * That is an authority-escalation path. Reproduce the model, not the bug.
 *
 * place_id has no foreign key on purpose: place rows are deleted and recreated wholesale
 * by 04-places.hoods.seed.ts, and an FK here would block that the same way the vote_list
 * FK already does. Orphan rows are pruned by pruneOrphans in the repository.
 */

const COLLATE = 'utf8mb4_unicode_ci';
const tableName = 'place_role_access';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(tableName)) return;

  console.log(`Creating ${tableName} table`);
  await knex.schema.createTable(tableName, table => {
    table.collate(COLLATE);
    table.increments('id').primary();
    table.timestamps(false, true);

    table.integer('place_id').unsigned().notNullable();

    table.integer('role_id').unsigned().notNullable();
    table.foreign('role_id').references('role.id');

    // One grant per (place, role); re-granting is a no-op rather than a duplicate.
    table.unique(['place_id', 'role_id']);
    // Every read is "which roles are granted at this place".
    table.index(['place_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!await knex.schema.hasTable(tableName)) return;
  console.log(`Dropping ${tableName} table`);
  await knex.schema.dropTable(tableName);
}
