import { Knex } from 'knex';

/**
 * The operator audit store: one row per administrative action that changed state, or
 * was refused.
 *
 * `docs/ADMIN_SECURITY_BASELINE.md` section 11 states the obligation -- "every
 * administrative action that changes state owes an audit event" -- and names this table
 * as the store that receives them (`CTBL-0025`). Section 12 states what may never be
 * written into one. The column list below is section 11's field table, made concrete.
 *
 * NO FOREIGN KEYS, DELIBERATELY. Both member references are plain unsigned integers:
 *
 *   - `target_member_id` cannot reference `member.id`. The single most important row this
 *     table will ever hold is the account-removal event, and that action deletes the
 *     member row it names. A RESTRICT foreign key would block the removal outright; a
 *     CASCADE one would delete the evidence along with the account. Both outcomes destroy
 *     the record the store exists to keep.
 *   - `actor_member_id` cannot reference it either, for the mirror reason: an operator's
 *     own account may be removed later, and everything they did must stay attributable
 *     after it is.
 *
 * The same reasoning also protects the append-only contract in section 13 of
 * `docs/ADMIN_AUDIT_TRAIL.md`: with no foreign key there is no cascade, so no delete
 * anywhere else in the schema can reach in and rewrite history. `place_role_access` omits
 * a `place_id` foreign key for a comparable reason and is the precedent.
 *
 * `occurred_at` is written by the application as an explicit UTC wall clock rather than
 * left to `CURRENT_TIMESTAMP`, which is only UTC when the server's session timezone
 * happens to be. `created_at` stays for consistency with every other table here; when the
 * two disagree, `occurred_at` is the one to read.
 */

const COLLATE = 'utf8mb4_unicode_ci';
const tableName = 'admin_audit_event';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(tableName)) return;

  console.log(`Creating ${tableName} table`);
  await knex.schema.createTable(tableName, table => {
    table.collate(COLLATE);
    table.increments('id').primary();
    table.timestamps(false, true);

    // Section 11 `time`. Set by the writer, in UTC. See the note above.
    table.dateTime('occurred_at').notNullable();

    // Section 11 `action`. A name from the registry in `libs/audit-event.ts`, never a
    // free-text description: these are matched on, not read as prose.
    table.string('event', 64).notNullable();

    // Section 11 `result`: allowed | denied | failed.
    table.string('result', 16).notNullable();

    // Section 11 `authority`: which layer of section 4 the action relied on.
    table.string('authority', 32).notNullable();

    // Section 11 `actor`. Always the authenticated session's member id, never a value
    // the client sent.
    table.integer('actor_member_id').unsigned().notNullable();

    // Section 11 `target`, as a type plus an id. `target_member_id` is split out because
    // "what was done to this member" is the question the store is asked most often, and
    // it deserves its own index rather than a scan filtered on a type string.
    table.string('target_type', 32).nullable();
    table.integer('target_id').unsigned().nullable();
    table.integer('target_member_id').unsigned().nullable();

    // Section 11 `reason`. Required by the baseline for bans, role changes and account
    // removal; nullable here because the column is shared with actions that have none.
    table.string('reason', 255).nullable();

    // Section 11 `source`. The request origin, wide enough for an IPv6 literal.
    table.string('source', 45).nullable();

    // Section 11 `before` / `after`, as a small scrubbed JSON object. Written only through
    // `redactMetadata`, which drops credential-shaped keys and message bodies outright.
    // TEXT, not JSON: MySQL 5.7 has a JSON type but the rest of this schema does not use
    // it, and nothing here queries inside the document.
    table.text('metadata').nullable();

    // "What did this operator do", newest first.
    table.index(['actor_member_id', 'id'], 'admin_audit_event_actor_index');
    // "What was done to this member", newest first -- the account-removal read path.
    table.index(['target_member_id', 'id'], 'admin_audit_event_target_member_index');
    // "Every ban added in this window": one action, bounded by time.
    table.index(['event', 'occurred_at'], 'admin_audit_event_event_time_index');
    // The plain timeline. Cannot use the composite above, whose leading column is `event`.
    table.index(['occurred_at'], 'admin_audit_event_time_index');
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!await knex.schema.hasTable(tableName)) return;
  console.log(`Dropping ${tableName} table`);
  await knex.schema.dropTable(tableName);
}
