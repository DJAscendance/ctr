import { Model } from './model';

/**
 * One row of the operator audit store: an administrative action that changed state, or
 * was refused.
 *
 * The field list is section 11 of `docs/ADMIN_SECURITY_BASELINE.md`. See
 * `db/migrations/20260918090000_create_admin_audit_event.ts` for why neither member
 * reference is a foreign key.
 */
export interface AdminAuditEvent extends Model {
  /** UTC wall clock of the attempt, written by the application. */
  occurred_at: Date;
  /** A name from `AUDIT_EVENTS`, never free text. */
  event: string;
  /** allowed | denied | failed. */
  result: string;
  /** Which authority layer of baseline section 4 the attempt relied on. */
  authority: string;
  /** The authenticated session's member id. Never a client-supplied value. */
  actor_member_id: number;
  /** What kind of entity was acted on, when there is one. */
  target_type: string | null;
  /** The acted-on entity's id, when there is one. */
  target_id: number | null;
  /** The member the action was about, when there is one. */
  target_member_id: number | null;
  /** Operator-supplied reason, capped to the column width. */
  reason: string | null;
  /** Request origin, when one was safe to record. */
  source: string | null;
  /** Scrubbed JSON of the facts worth keeping. Written only via `redactMetadata`. */
  metadata: string | null;
}
