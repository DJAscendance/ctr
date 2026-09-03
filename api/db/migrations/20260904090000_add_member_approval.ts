import { Knex } from 'knex';

const TABLE = 'member';

/**
 * Adds the manual-immigration-approval columns to `member`.
 *
 * `approved_at` is nullable and null means "waiting for a city administrator". That makes
 * the DEFAULT for a brand new row -- null -- the safe value: a deployment that switches
 * `MEMBER_APPROVAL_REQUIRED` on mid-flight starts holding new arrivals immediately rather
 * than letting a window of unreviewed accounts through.
 *
 * Every member that already exists is backfilled to approved. They immigrated under the
 * rules CTR had at the time, when immigration was immediate; a migration is not the place
 * to retroactively suspend an entire city. `created_at` is used rather than NOW() so the
 * column reads as "approved since", not "the day we ran the migration".
 *
 * There is no matching `rejected_at`. Refusing an application is what the existing ban
 * mechanism already expresses (`member.status = 0`), and the pending queue filters those
 * out, so a second, parallel notion of "not allowed in" is not introduced here.
 */
export async function up(knex: Knex): Promise<void> {
  const hasApprovedAt = await knex.schema.hasColumn(TABLE, 'approved_at');
  if (!hasApprovedAt) {
    await knex.schema.alterTable(TABLE, table => {
      table.datetime('approved_at').nullable();
      table.integer('approved_by').unsigned().nullable();
    });
    await knex(TABLE).whereNull('approved_at').update({
      approved_at: knex.ref('created_at'),
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasApprovedAt = await knex.schema.hasColumn(TABLE, 'approved_at');
  if (hasApprovedAt) {
    await knex.schema.alterTable(TABLE, table => {
      table.dropColumn('approved_at');
      table.dropColumn('approved_by');
    });
  }
}
