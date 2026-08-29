/**
 * Small database helpers for docker/beta/bootstrap-db.sh.
 *
 * They live in a file rather than inline `node -e` strings because the SQL needs
 * backtick-quoted identifiers, and getting those through a shell heredoc, then the
 * shell's own quoting, then JavaScript, is three chances to be wrong about escaping and
 * exactly one of them silently produces a syntax error at run time.
 *
 * Usage: node db-helpers.js <wait|create|assert-empty>
 * Reads DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_DATABASE from the environment. Exits
 * non-zero on failure so `set -e` in the caller does the right thing.
 */
const mysql = require('mysql2/promise');

const connection = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
};
const database = process.env.DB_DATABASE;

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

const commands = { wait, create, 'assert-empty': assertEmpty };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`db-helpers: unknown command ${process.argv[2]}`);
  process.exit(2);
}
command().catch(error => {
  console.error(`db-helpers: ${error.message}`);
  process.exit(1);
});
