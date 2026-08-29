import { Knex } from 'knex';

/**
 * The key that makes a retried Bank transfer move money exactly once.
 *
 * NOT a restoration. The historical Bank had no such concept: its confirm button could be
 * clicked twice and would transfer twice, and a lost response left the citizen no way to
 * tell whether their money had moved. This is a deliberate modern safety addition, made now
 * rather than later because retrofitting it onto a released money endpoint means changing
 * the contract of an endpoint citizens are already using.
 *
 * WHY A UNIQUE INDEX RATHER THAN A LOOKUP. "Has this key been used yet?" followed by a
 * transfer is a check-then-act race: two concurrent retries both find nothing and both pay.
 * The index moves the decision into the database, where the second insert simply fails and
 * takes its whole transaction -- both balance changes and both receipts -- down with it.
 *
 * WHY ON `transaction` RATHER THAN A NEW TABLE. The thing being made unique IS the ledger
 * row. A separate idempotency table would need its own transaction-spanning consistency
 * with this one to mean anything, which is a second copy of the problem, not a solution.
 *
 * NULLS. MySQL's UNIQUE indexes permit any number of NULLs, which is exactly what is needed:
 * every pre-existing row, and every non-Bank transaction type, carries NULL and none of them
 * collide. Nothing needs backfilling and nothing existing is invalidated.
 *
 * SIZE. varchar(64), utf8mb4. A v4 UUID in canonical form is 36 characters; 64 leaves room
 * for a different key representation without another migration, while staying far inside the
 * 3072-byte index limit (64 x 4 bytes = 256).
 *
 * COLLATION. `utf8mb4_bin`, explicitly, rather than the table's `utf8mb4_unicode_ci`. A key
 * is an opaque identifier compared for exact equality, and the service compares it
 * byte-for-byte in JavaScript; a case-INSENSITIVE index would disagree with that, treating
 * `A1b2...` and `a1B2...` as the same key. The consequence would not be a lost transfer --
 * the service re-checks the whole operation before honouring any key -- but it would let two
 * genuinely different intents collide, and a unique index whose notion of equality differs
 * from the application's is a latent bug regardless of how unlikely the collision is.
 */

const tableName = 'transaction';
const columnName = 'idempotency_key';
const indexName = 'transaction_idempotency_key_unique';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn(tableName, columnName)) return;

  console.log(`Adding ${columnName} to ${tableName} table`);
  await knex.schema.alterTable(tableName, table => {
    // `specificType` rather than `string(...)`: this knex version's ColumnBuilder has no
    // `.collate()`, and the collation is not incidental here -- see the note above.
    table.specificType(columnName, 'varchar(64) COLLATE utf8mb4_bin').nullable().defaultTo(null);
    table.unique([columnName], { indexName });
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!await knex.schema.hasColumn(tableName, columnName)) return;

  console.log(`Removing ${columnName} from ${tableName} table`);
  // The index is dropped explicitly and first: MySQL will not drop a column an index still
  // references, and knex does not infer the drop from the column removal.
  await knex.schema.alterTable(tableName, table => {
    table.dropUnique([columnName], indexName);
  });
  await knex.schema.alterTable(tableName, table => {
    table.dropColumn(columnName);
  });
}
