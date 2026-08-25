import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { Member, Transaction, TransactionReason, Wallet } from '../../types/models';

/** CityCash and experience granted by a single credit. */
export interface CreditAmount {
  /** CityCash added to the member's wallet. */
  cc: number;
  /** Experience points added to the member. */
  xp: number;
}

/** What a payout attempt did. */
export interface CreditOutcome {
  /**
   * `true` when this call is the one that paid. `false` means the member was not
   * eligible when the row was actually held - already credited, or holding no earning
   * role - and nothing was written.
   */
  credited: boolean;
  /** Amounts paid. Only present when `credited`. */
  amount?: CreditAmount;
  /** Role the weekly payment was made for. Only present on a weekly credit. */
  roleId?: number;
}

/**
 * Whether a member has already had their daily login bonus since the beginning
 * (00:00:00) of the current day.
 *
 * Lives here rather than on MemberService because the check that decides whether money
 * moves has to run inside the transaction that moves it. MemberService keeps a method
 * of the same name, delegating here, so both answer identically.
 */
export function hasReceivedDailyCreditToday(lastCredit: Date, now: Date = new Date()): boolean {
  return lastCredit.getTime() >= new Date(now).setHours(0, 0, 0, 0);
}

/**
 * Repository owning the two job-credit payouts, each as a single database transaction.
 *
 * Both payouts move four things that have to agree: a wallet balance, a ledger row, the
 * member's XP, and the eligibility timestamp that decides whether the payout may happen
 * again. Splitting them across transactions is what let a failed second half leave money
 * moved with the member still eligible, and reading eligibility outside the transaction
 * that pays is what let two callers both decide to pay.
 *
 * So every method here follows the same shape:
 *
 *   1. lock the member row with SELECT ... FOR UPDATE;
 *   2. re-evaluate eligibility against the locked row, not against anything a caller
 *      passed in or a batch query read earlier;
 *   3. write wallet, ledger, XP and timestamp;
 *   4. commit.
 *
 * A second caller arriving concurrently blocks at step 1, and a locking read returns the
 * latest committed row rather than the transaction's snapshot, so it sees the first
 * caller's timestamp at step 2 and becomes a no-op. Wallet balances are moved with
 * `balance = balance + ?` rather than a read followed by a write of the total, so a
 * credit landing on a wallet another transaction is also crediting cannot overwrite it.
 *
 * The member row is always the first row locked, so these paths cannot deadlock against
 * each other.
 */
@Service()
export class CreditRepository {
  constructor(private db: Db) {}

  /**
   * Gives the member their daily login bonus, unless they have already had it today.
   * @param memberId id of the member to credit
   * @param amounts amounts to award, by whether the member holds any role
   * @returns what was paid, or `credited: false` if the bonus had already been given
   */
  public async giveDailyCredit(
    memberId: number,
    amounts: { unemployed: CreditAmount; employed: CreditAmount },
  ): Promise<CreditOutcome> {
    return this.db.knex.transaction(async trx => {
      const member = await this.lockMember(trx, memberId);
      if (!member) return { credited: false };
      if (hasReceivedDailyCreditToday(member.last_daily_login_credit)) {
        return { credited: false };
      }

      // Holding any role at all is what counts as employed for the daily bonus,
      // including a role that pays nothing. That is existing policy, unchanged here -
      // the earning-role filter belongs to weekly payroll, not to this.
      const [{ roles }] = await trx('role_assignment')
        .where('member_id', memberId)
        .count({ roles: '*' });
      const amount = Number(roles) > 0 ? amounts.employed : amounts.unemployed;

      await this.pay(trx, member.wallet_id, amount.cc, TransactionReason.DailyCredit);
      await trx<Member>('member')
        .where({ id: memberId })
        .update({
          xp: trx.raw('xp + ?', [amount.xp]),
          last_daily_login_credit: new Date(),
        });

      return { credited: true, amount };
    });
  }

  /**
   * Locks a member row for the life of the transaction.
   *
   * A locking read, so it returns the latest committed row rather than the snapshot the
   * transaction started with - which is what makes the eligibility recheck that follows
   * it see a concurrent payout that has already committed.
   */
  private async lockMember(trx: Knex.Transaction, memberId: number): Promise<Member> {
    return trx<Member>('member').where({ id: memberId }).forUpdate().first();
  }

  /**
   * Moves CityCash into a wallet and records it in the ledger.
   *
   * `increment` emits `balance = balance + ?`, so the new balance is computed by the
   * database from whatever is committed at that moment. Reading the balance and writing
   * back `read + amount` instead is what let one of two concurrent credits vanish.
   *
   * The ledger row is written even when the amount is zero: an XP-only role still earns
   * a weekly credit, and the row is the only record that it happened.
   */
  private async pay(
    trx: Knex.Transaction,
    walletId: number,
    amount: number,
    reason: string,
  ): Promise<void> {
    await trx<Wallet>('wallet').where({ id: walletId }).increment('balance', amount);
    await trx<Transaction>('transaction').insert({
      amount,
      reason,
      recipient_wallet_id: walletId,
    });
  }
}
