import { Knex } from 'knex';

const rolesData = require('./../seed_data/roles_data.json');

/**
 * Seeds the role table, inserting each role only when its name is not already present and
 * otherwise refreshing the existing row.
 *
 * This seed's bare `insert()` is the root cause 20260717120000_dedupe_role_rows documents:
 * every extra run added a second copy of all 74 roles, and RoleRepository then resolved
 * each name to whichever duplicate came last, so authorization silently depended on row
 * order. That migration consolidated the duplicates and added UNIQUE(role.name) - which
 * means an unconditional insert no longer duplicates, it fails the whole seed run with
 * ER_DUP_ENTRY against any already-populated database.
 *
 * Matching on name keeps existing role ids stable, so role_assignment rows continue to
 * point at the right roles.
 */
export async function seed(knex: Knex): Promise<void> {
  console.log('Seeding role data');

  for (const role of rolesData) {
    const existing = await knex('role').where('name', role.name).first();
    if (existing) {
      await knex('role').where('name', role.name).update(role);
    } else {
      await knex('role').insert(role);
    }
  }
}
