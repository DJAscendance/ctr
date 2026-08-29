import { Knex } from 'knex';

/**
 * Free-text reason attached to a CityCash transfer.
 *
 * Restores a field the original Bank always had. In the surviving source
 * (colonycity/templates/bank/phase1.tmpl) the citizen types it into
 * `<input type="text" name="TO_NAM" size="16" maxlength="30">`, labelled "Please enter a
 * description for this transfer:", and phase3.pl renders it into both Inbox receipts as
 * `...cc<br>reason : <TO_NAM>`. It is also the last pipe-delimited field of every row in
 * bank_transfers.log, so it was durable, not just display.
 *
 * NOTE for anyone cross-referencing the recon: the Bank's memo field is `TO_NAM`. `TO_REA`
 * is the FUNDBOX field (templates/fundbox/phase7.tmpl) -- in Fundbox `TO_NAM` already means
 * the recipient PLACE name, which is why the donate flow needed a second field for the
 * reason. Both are maxlength=30. Documents naming the Bank's memo `TO_REA` have imported a
 * Fundbox name.
 *
 * 60 rather than 30: the historical contract is 30 characters of INPUT, and the service
 * enforces that. Sizing the column at exactly the input limit would make the database the
 * thing that truncates if that limit is ever revisited, and silent truncation of a stored
 * financial record is a worse failure than a rejected form.
 *
 * Nullable, because a memo was always optional -- rows 3 and 4 of the surviving transfer
 * log have an empty one.
 */

const tableName = 'transaction';
const columnName = 'memo';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn(tableName, columnName)) return;

  console.log(`Adding ${columnName} to ${tableName} table`);
  await knex.schema.alterTable(tableName, table => {
    table.string(columnName, 60).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!await knex.schema.hasColumn(tableName, columnName)) return;

  console.log(`Removing ${columnName} from ${tableName} table`);
  await knex.schema.alterTable(tableName, table => {
    table.dropColumn(columnName);
  });
}
