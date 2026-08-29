/**
 * Small database helpers for docker/beta/bootstrap-db.sh.
 *
 * They live in a file rather than inline `node -e` strings because the SQL needs
 * backtick-quoted identifiers, and getting those through a shell heredoc, then the
 * shell's own quoting, then JavaScript, is three chances to be wrong about escaping and
 * exactly one of them silently produces a syntax error at run time.
 *
 * Usage: node db-helpers.js <wait|create|assert-empty|migration-applied <name>>
 * Reads DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_DATABASE from the environment. Exits
 * non-zero on failure so `set -e` in the caller does the right thing.
 *
 * `migration-applied` is the exception to that and has a three-way contract, because for
 * it "no" is an answer rather than a failure:
 *
 *   0  the migration is recorded in the migrations table
 *   1  it is not recorded
 *   2  usage error (unknown command, missing argument)
 *   4  the question could not be answered -- no connection, or no migrations table
 *
 * Callers MUST distinguish 1 from 4. Collapsing them is how a bootstrap loop turns a
 * database outage or a renamed migrations table into "keep waiting", which is the shape of
 * the bug this command exists to replace.
 */
const mysql = require('mysql2/promise');

const connection = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};
const database = process.env.DB_DATABASE;

/**
 * knex's migration ledger. NOT `knex_migrations` -- src/knexfile.ts sets
 * `migrations.tableName` to 'migrations' in every environment, and querying the default
 * name instead would answer "not applied" forever against a perfectly healthy database.
 * Overridable so this file cannot drift silently if the knexfile is ever changed.
 */
const migrationsTable = process.env.DB_MIGRATIONS_TABLE || 'migrations';

/** See the three-way contract in the file docblock. */
const NOT_APPLIED = 1;
const CANNOT_ANSWER = 4;

async function wait() {
  const deadline = Date.now() + 120000;
  for (;;) {
    try {
      const c = await mysql.createConnection(connection);
      await c.end();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

async function create() {
  const c = await mysql.createConnection(connection);
  await c.query(
    'CREATE DATABASE IF NOT EXISTS ??  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      .replace('??', mysql.escapeId(database)));
  await c.end();
}

async function assertEmpty() {
  const c = await mysql.createConnection({ ...connection, database });
  const [rows] = await c.query('SHOW TABLES');
  await c.end();
  if (rows.length) {
    throw new Error(
      `Refusing to bootstrap: ${database} already has ${rows.length} table(s). ` +
      'This script is for a fresh, disposable database only.');
  }
}

/**
 * Answers whether one migration is recorded as run, from the ledger rather than from the
 * text of `knex migrate:list`.
 *
 * `migrate:list` prints the completed AND the pending migrations, so a `grep` for a
 * filename matches from the very first run onwards -- it reports "yes" for a migration
 * that has not run and, in the caller's loop, exited after migration #1.
 */
async function migrationApplied(args) {
  const name = args[0];
  if (!name) {
    console.error('db-helpers: migration-applied needs a migration name');
    return 2;
  }

  let c;
  try {
    c = await mysql.createConnection({ ...connection, database });
    const [rows] = await c.query(
      'SELECT 1 FROM ?? WHERE `name` = ? LIMIT 1', [migrationsTable, name]);
    return rows.length ? 0 : NOT_APPLIED;
  } catch (error) {
    // A missing ledger is deliberately NOT reported as "not applied". The caller only asks
    // after running a migration, so by then the table must exist; if it does not, the table
    // name is wrong and the honest answer is that the question is unanswerable.
    const why = error.code === 'ER_NO_SUCH_TABLE'
      ? `no ${migrationsTable} table in ${database} -- is migrations.tableName still ` +
        `'${migrationsTable}' in src/knexfile.ts?`
      : error.message;
    console.error(`db-helpers: migration-applied: ${why}`);
    return CANNOT_ANSWER;
  } finally {
    if (c) await c.end();
  }
}

const commands = {
  wait,
  create,
  'assert-empty': assertEmpty,
  'migration-applied': migrationApplied,
};
const command = commands[process.argv[2]];
if (!command) {
  console.error(`db-helpers: unknown command ${process.argv[2]}`);
  process.exit(2);
}
command(process.argv.slice(3))
  .then(code => process.exit(code || 0))
  .catch(error => {
    console.error(`db-helpers: ${error.message}`);
    process.exit(1);
  });
