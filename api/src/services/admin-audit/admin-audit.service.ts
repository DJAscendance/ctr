import { Request } from 'express';
import { Knex } from 'knex';
import { Service } from 'typedi';

import { AdminAuditEventRepository } from '../../repositories';
import {
  AUDIT_RESULTS,
  AuditAuthority,
  AuditEventName,
  AuditMetadataInput,
  AuditResult,
  AuditTarget,
  normaliseReason,
  normaliseSource,
  serialiseMetadata,
  utcTimestamp,
} from '../../libs/audit-event';

/** What a caller says about an administrative attempt. */
export interface AuditEventInput {
  /** The action, from the closed registry in `libs/audit-event.ts`. */
  event: AuditEventName;
  /**
   * The member who performed it.
   *
   * MUST be the id from `MemberService.decryptSession`. Baseline section 11 calls this
   * "the member id that performed the action", and a value the client could choose would
   * make every row in the store deniable. Nothing in this service reads a request body.
   */
  actorMemberId: number;
  /** Which layer of baseline section 4 granted it. */
  authority: AuditAuthority;
  /** What kind of entity was acted on. */
  targetType?: AuditTarget | null;
  /** That entity's id. */
  targetId?: number | null;
  /** The member the action was about, when the target is not itself a member. */
  targetMemberId?: number | null;
  /** Operator-supplied reason. Required by the baseline for bans, roles and removals. */
  reason?: unknown;
  /** Small named facts worth keeping. Scrubbed before storage; never a request body. */
  metadata?: AuditMetadataInput | null;
  /** The request, read only for its origin address. */
  request?: Request | null;
}

/**
 * Writes the operator audit store.
 *
 * Two entry points, and the split between them is the whole design:
 *
 *   - `recordChange` writes the `allowed` row for a mutation that succeeded, INSIDE that
 *     mutation's transaction. It throws when the insert fails, which rolls the mutation
 *     back with it. That is deliberate: baseline section 11 says a state change owes an
 *     event, so a state change that could not be recorded has not earned its commit.
 *
 *   - `recordOutcome` writes the `denied` and `failed` rows on the ordinary connection,
 *     and never throws. Neither has a transaction to join -- a refusal never opened one,
 *     and a failure's has already rolled back -- and neither may change the response the
 *     caller already decided on. An audit outage must not turn a 403 into a 500, and it
 *     must certainly not turn a refusal into an allowance.
 *
 * The consequence that matters: an `allowed` row can only exist where the business
 * mutation committed, because they commit together. A `denied` or `failed` row carries no
 * such promise and is documented as best-effort.
 */
@Service()
export class AdminAuditService {
  constructor(private adminAuditEventRepository: AdminAuditEventRepository) {}

  /**
   * Records a successful administrative state change, atomically with the change itself.
   *
   * @param trx the transaction the business mutation is running in
   * @param input the event
   * @throws whatever the insert throws, so the caller's transaction rolls back
   */
  public async recordChange(trx: Knex.Transaction, input: AuditEventInput): Promise<void> {
    await this.adminAuditEventRepository.insert(
      this.toRow(input, AUDIT_RESULTS.ALLOWED),
      trx,
    );
  }

  /**
   * Records a private-content read, before the content is disclosed.
   *
   * Baseline section 11: "reads of another member's private content -- chat history above
   * all -- owe an access event". A read has no business transaction to join, so there is
   * nothing here to be atomic WITH. What replaces atomicity is the order the caller keeps
   * and the fact that this **throws**: the read runs first, this row is written second,
   * and only then may the handler answer with the content. An audit store that cannot
   * record the access therefore blocks the disclosure instead of silently allowing an
   * unlogged one.
   *
   * `result` is always `allowed`, because this is only ever called after the read
   * succeeded. A refused attempt goes through `recordOutcome(DENIED, ...)` and a read that
   * errored goes through `recordOutcome(FAILED, ...)`; neither may produce an `allowed`
   * row, for the same reason the mutation paths may not.
   *
   * @param input the event; its metadata must name facts about the read, never its result
   * @throws whatever the insert throws, so the caller withholds the content
   */
  public async recordAccess(input: AuditEventInput): Promise<void> {
    await this.adminAuditEventRepository.insert(
      this.toRow(input, AUDIT_RESULTS.ALLOWED),
    );
  }

  /**
   * Records a refused or failed attempt, outside any transaction, best effort.
   *
   * @param result `denied` for a refused attempt, `failed` for one that errored
   * @param input the event
   */
  public async recordOutcome(
    result: Extract<AuditResult, 'denied' | 'failed'>,
    input: AuditEventInput,
  ): Promise<void> {
    try {
      await this.adminAuditEventRepository.insert(this.toRow(input, result));
    } catch (error) {
      // Swallowed on purpose. See the class comment: this path may not alter the
      // response that has already been decided. The loss is visible in the server log.
      console.error(`Audit ${result} event ${input.event} could not be written:`, error);
    }
  }

  /** Normalises and scrubs one attempt into the row shape the column list expects. */
  private toRow(input: AuditEventInput, result: AuditResult) {
    return {
      occurred_at: utcTimestamp(),
      event: input.event,
      result,
      authority: input.authority,
      actor_member_id: input.actorMemberId,
      target_type: input.targetType ?? null,
      target_id: normaliseId(input.targetId),
      target_member_id: normaliseId(input.targetMemberId),
      reason: normaliseReason(input.reason),
      source: normaliseSource(requestSource(input.request)),
      metadata: serialiseMetadata(input.metadata),
    };
  }
}

/**
 * An id as stored: a positive integer, or null.
 *
 * The admin routes accept raw ids and hand them on unvalidated -- a separate, known debt
 * -- so `Number(request.body.banId)` reaches here as `NaN` when a client sends nonsense.
 * A `NaN` binding is a thrown query, and on the atomic path a thrown query rolls back a
 * mutation that otherwise succeeded. Storing null instead records "no usable target",
 * which is the truth, without this lane changing what those routes accept.
 */
function normaliseId(id: number | null | undefined): number | null {
  if (id === null || id === undefined) return null;
  const value = Number(id);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The request's origin address, if express can name one.
 *
 * Only the address is read. No header, cookie or body is touched, so nothing carrying a
 * credential can reach the store through this path.
 */
function requestSource(request: Request | null | undefined): string | null {
  if (!request) return null;
  const ip = (request as unknown as { ip?: unknown }).ip;
  return typeof ip === 'string' ? ip : null;
}
