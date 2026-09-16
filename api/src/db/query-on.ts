import { Knex } from 'knex';

/**
 * Chooses what a statement runs through: the caller's transaction when one is supplied,
 * and the ordinary connection when it is not.
 *
 * Every destructive step of admin account removal takes an optional `trx` and routes its
 * queries through this helper, so the whole sequence commits or rolls back as one unit.
 * Callers that pass nothing keep the behaviour they have always had - each statement
 * commits on its own - which is what every pre-existing caller of those methods gets.
 *
 * The transaction is returned directly rather than attached with `.transacting()`, so the
 * statement is built by, and runs on, the transaction's own connection. That matters here:
 * several repositories hold a `Db` instance whose pool is not the one the transaction was
 * opened on, and a builder from the wrong pool is a silent way to leave a write outside
 * the transaction it was meant to join.
 * @param connection the repository's ordinary knex instance
 * @param trx optional transaction to run the statement inside
 */
export function queryOn(connection: Knex, trx?: Knex.Transaction): Knex {
  return trx ?? connection;
}
