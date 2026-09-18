import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db, queryOn } from '../../db';

/** One audit row, already scrubbed and normalised by `AdminAuditService`. */
export interface AdminAuditEventInsert {
  occurred_at: string;
  event: string;
  result: string;
  authority: string;
  actor_member_id: number;
  target_type: string | null;
  target_id: number | null;
  target_member_id: number | null;
  reason: string | null;
  source: string | null;
  metadata: string | null;
}

/**
 * The operator audit store's only write path.
 *
 * INSERT ONLY, and that is the contract, not an omission. Baseline section 11 makes the
 * store the record of what administrators did; a record that ordinary application code
 * can edit or delete is not one. There is deliberately no `update`, no `delete` and no
 * `truncate` here, so no controller, service or future feature can reach for one. A
 * database administrator with a shell is outside this contract and always will be --
 * the point is that CTR itself offers no lever.
 *
 * Reads are absent for a different reason: nothing in CTR reads this table yet. The read
 * surface is its own item, and building an unused one now would ship an
 * admin-readable surface with no gate written for it.
 */
@Service()
export class AdminAuditEventRepository {
  constructor(private db: Db) {}

  /**
   * Writes one audit row.
   *
   * @param row the scrubbed event
   * @param trx the caller's transaction, when the row must commit with a business
   *   mutation. Omitted, the insert commits on its own -- which is what the denial and
   *   failure paths want, since neither has a transaction to join.
   */
  public async insert(row: AdminAuditEventInsert, trx?: Knex.Transaction): Promise<void> {
    await queryOn(this.db.knex, trx)('admin_audit_event').insert(row);
  }
}
