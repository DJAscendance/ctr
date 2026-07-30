import { Knex } from 'knex';

/**
 * Per-member named attributes -- the substrate the social layer hangs off.
 *
 * In CS 4.x this is the MD / memdata table, keyed by member id, and it is where the
 * buddy list actually lives: ten slots BU0..BU9 holding NICKNAMES, settled by writing a
 * buddy on a live 4.1 server and diffing the data files. Buddies are NOT a join table and
 * NOT in groups/groupmem -- those back the Group entries in the access-rights model
 * instead. sqserver.sql names this table Member_Data.
 *
 * A generic key/value store rather than a column per feature, because that is what the
 * original is: buddies (BU0..BU9), the hide-yourself privacy flag (IMS) and the per-place
 * defaults all live here as named attributes. Adding a feature should not need a
 * migration.
 *
 * Deliberately NOT normalised into a friend table. A ten-slot nickname-keyed list is the
 * fidelity target, and "improving" it into (member_id, friend_member_id) rows would lose
 * two behaviours the original has: a buddy slot can name someone who does not exist (or
 * who later renames), and the slot INDEX is meaningful and stable.
 *
 * `value` is text, not json: MySQL 5.7 is the deployment target, its JSON support is
 * weaker than 8.0's, and every value the original stores here is a short scalar anyway.
 */

const COLLATE = 'utf8mb4_unicode_ci';
const tableName = 'member_data';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(tableName)) return;

  console.log(`Creating ${tableName} table`);
  await knex.schema.createTable(tableName, table => {
    table.collate(COLLATE);
    table.increments('id').primary();
    table.timestamps(false, true);

    table.integer('member_id').unsigned().notNullable();
    table.foreign('member_id').references('member.id');

    // Attribute name, e.g. BU0..BU9 for buddy slots, IMS for the privacy flag.
    table.string('name', 32).notNullable();
    table.text('value');

    // One row per (member, attribute). Writes are upserts against this.
    table.unique(['member_id', 'name']);
    // Reads are almost always "all attributes for this member", or a prefix scan of one
    // family (BU%), so member_id leads.
    table.index(['member_id', 'name']);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!await knex.schema.hasTable(tableName)) return;
  console.log(`Dropping ${tableName} table`);
  await knex.schema.dropTable(tableName);
}
