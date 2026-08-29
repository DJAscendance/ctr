import { Knex } from 'knex';

/**
 * Records that a member has been paid the one-time settle-a-home experience award.
 *
 * The award itself is historical, not a revival invention: colonycity/config/exper.cfg
 * carries `e_propsettle 50` under the "# Home" heading, alongside e_prop2Dhomebuy 1,
 * e_prop3Dhomebuy 2 and e_propimageupload 3. Settling a home paid 50 XP.
 *
 * This column exists because CTR has no other way to answer "has this member EVER
 * homesteaded". Every candidate signal is current-state only:
 *
 *   - `place`/`home`/`map_location` rows are hard-deleted when a home is given up, so
 *     "owns a home" would pay again on every move-out and move-back;
 *   - a `home-purchase` transaction row is written ONLY when a paid 3D design was chosen,
 *     so a citizen who settles with a free 2D house leaves no ledger trace at all -- and
 *     the same reason is also written on later redecorations, so it is neither necessary
 *     nor sufficient.
 *
 * A timestamp rather than a boolean: it costs the same, and it answers "when" for the
 * administrative correction surface that will eventually need to audit XP grants.
 *
 * Nullable with no default. NULL means "never rewarded", and the award is claimed with a
 * conditional `UPDATE ... WHERE first_homestead_rewarded_at IS NULL`, so the column is
 * itself the concurrency control -- two simultaneous first-settles both attempt the update,
 * exactly one reports a matched row, and only that one pays.
 *
 * Deliberately NOT backfilled for citizens who already own homes. Retroactively minting XP
 * for an existing population is an economy decision, not a migration.
 */

const tableName = 'member';
const columnName = 'first_homestead_rewarded_at';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn(tableName, columnName)) return;

  console.log(`Adding ${columnName} to ${tableName} table`);
  await knex.schema.alterTable(tableName, table => {
    table.timestamp(columnName).nullable().defaultTo(null);
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!await knex.schema.hasColumn(tableName, columnName)) return;

  console.log(`Removing ${columnName} from ${tableName} table`);
  await knex.schema.alterTable(tableName, table => {
    table.dropColumn(columnName);
  });
}
