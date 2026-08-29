import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { escapeHtml } from '../../libs/html';
import { Inbox, Transaction, TransactionReason, Wallet } from '../../types/models';

/**
 * Largest value `wallet.balance` can hold.
 *
 * The column is MySQL INT UNSIGNED. Declared here, beside the code that enforces it under
 * the row lock, rather than in the service that merely pre-checks it -- the authoritative
 * check is the one that happens while the row is held, and a constant should live with its
 * enforcement.
 */
export const MAX_WALLET_BALANCE = 4294967295;

/** The parties and terms of one citizen-to-citizen CityCash transfer. */
export interface TransferRequest {
  /** Wallet the money leaves. Derived from the authenticated session, never from input. */
  senderWalletId: number;
  /** Wallet the money arrives in. */
  recipientWalletId: number;
  /** Whole, positive CityCash amount. Validated before it reaches here. */
  amount: number;
  /** Sender's home place id -- where their copy of the receipt is filed. */
  senderHomePlaceId: number;
  /** Recipient's home place id -- where their copy of the receipt is filed. */
  recipientHomePlaceId: number;
  /** Sender's member id, used as the author of both receipts. */
  senderMemberId: number;
  /** Recipient's member id, used as the author of the recipient's receipt. */
  recipientMemberId: number;
  /** Sender's display name, as it appears in the recipient's receipt. */
  senderUsername: string;
  /** Recipient's display name, as it appears in the sender's receipt. */
  recipientUsername: string;
  /** The sender's free-text reason, already trimmed and length-capped. May be empty. */
  memo: string;
  /**
   * Caller-supplied key identifying this transfer INTENT, unique across the table.
   *
   * Stored on the ledger row, so the database itself refuses a second commit of the same
   * intent. See the class docblock.
   */
  idempotencyKey: string;
}

/** Why a transfer did not happen. */
export type TransferRefusalReason =
  | 'insufficient-funds'
  | 'recipient-balance-overflow'
  | 'duplicate-intent';

/** What a transfer attempt did. */
export interface TransferOutcome {
  /** `true` when the money moved. `false` means nothing at all was written. */
  transferred: boolean;
  /**
   * Why the transfer was refused, when it was. Present only when `transferred` is false.
   *
   * `duplicate-intent` is not a refusal in the same sense as the other two: it means this
   * exact intent has ALREADY been committed, and the caller should read that committed
   * result rather than report a failure.
   */
  reason?: TransferRefusalReason;
  /** Sender's balance after the transfer. Only present when `transferred`. */
  senderBalance?: number;
  /** Recipient's balance after the transfer. Only present when `transferred`. */
  recipientBalance?: number;
  /** Id of the ledger row written. Only present when `transferred`. */
  transactionId?: number;
}

/** MySQL's error code for a unique-constraint violation. */
const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

/**
 * The citizen-to-citizen CityCash transfer, as one database transaction.
 *
 * This is a restoration of the Cybertown Bank's `phase3.pl`, and the single most important
 * thing to know about that script is that its ALGORITHM must not be copied. It performed
 * three unlocked round-trips to a remote database over a shell command line: read the
 * sender's balance, write sender minus amount, read the recipient's balance, write
 * recipient plus amount. Concurrent transfers could both pass the sufficiency check; a
 * failure between the two writes left the money destroyed; and its own error text admitted
 * as much -- "Also the system was unable to credit you your funds back."
 *
 * What IS restored is the behaviour: both parties must have a home, the amount must be
 * positive and affordable, the sender may send their entire balance, no fee or commission
 * is taken, one ledger record is written, and both parties receive an Inbox receipt naming
 * the other party, the amount and the reason.
 *
 * The shape follows CreditRepository, which already solved this problem for the daily and
 * weekly payouts -- read its class docblock before changing anything here:
 *
 *   1. lock the rows that money will move between, with SELECT ... FOR UPDATE;
 *   2. re-evaluate EVERY balance-dependent rule against the LOCKED rows, never against a
 *      value a caller read earlier or passed in;
 *   3. move balances with `balance = balance +/- ?` in SQL, never a read in JavaScript
 *      followed by a write of the computed total;
 *   4. write the ledger row and both receipts in the same transaction;
 *   5. commit, or roll all of it back.
 *
 * LOCK ORDER is the one thing this class needs that CreditRepository did not. Two citizens
 * can transfer to each other at the same moment. If each transaction locked "my wallet then
 * theirs", the two would hold one lock each and wait forever on the other. Both wallets are
 * therefore locked in ascending wallet-id order -- an order both directions of a mirrored
 * pair agree on -- so one transaction always acquires both and the other simply waits.
 *
 * IDEMPOTENCY is the one thing the original had no concept of, and is a deliberate modern
 * addition rather than a restoration. A citizen who double-clicks CONFIRM, or whose browser
 * retries a request whose response was lost, must not send twice; a citizen who genuinely
 * wants to send the same amount to the same person again must still be able to. Those two
 * are indistinguishable from the payload alone, so the client names each INTENT with a key
 * and the database enforces that a key commits at most once, via a UNIQUE index on
 * `transaction.idempotency_key`.
 *
 * That guarantee is the INDEX, not a lookup. A "does this key exist yet" query followed by
 * a transfer is exactly the check-then-act race this class exists to avoid: two concurrent
 * retries would both find nothing and both pay. Here they both attempt the insert, MySQL
 * fails the second, and its whole transaction -- both balance changes and both receipts --
 * rolls back. The caller then reads the committed original.
 */
@Service()
export class TransferRepository {
  constructor(private db: Db) {}

  /**
   * Moves CityCash between two citizens' wallets, atomically and at most once per intent.
   *
   * Every rule other than the balance-dependent ones is the caller's to enforce before
   * calling: this method does not know who is authenticated, whether either party has a
   * home, or whether the amount is well formed. Affordability and recipient capacity are
   * the exceptions, because their answers can change between a check and the write, so both
   * are asked while the rows are held.
   * @param request the parties and terms of the transfer
   * @returns what happened; `transferred: false` means nothing was written
   */
  public async transfer(request: TransferRequest): Promise<TransferOutcome> {
    try {
      return await this.attemptTransfer(request);
    } catch (error) {
      // The unique index on `idempotency_key` rejected the ledger row, so this intent has
      // already been committed by an earlier -- or concurrent -- request. The transaction
      // is already rolled back by the time this is caught: no balance change, no ledger
      // row, no receipts. The caller reads the committed original instead.
      if (error && error.code === DUPLICATE_ENTRY) {
        return { transferred: false, reason: 'duplicate-intent' };
      }
      throw error;
    }
  }

  /** The transfer proper. Separated so {@link transfer} can own the duplicate-key policy. */
  private async attemptTransfer(request: TransferRequest): Promise<TransferOutcome> {
    const {
      senderWalletId,
      recipientWalletId,
      amount,
      memo,
      idempotencyKey,
    } = request;

    return this.db.knex.transaction(async trx => {
      const balances = await this.lockWallets(trx, senderWalletId, recipientWalletId);
      const senderBalance = balances[senderWalletId];
      const recipientBalance = balances[recipientWalletId];

      // Re-read under the lock, not trusted from the caller. The balance the Bank screen
      // showed the citizen is by now arbitrarily old -- a purchase, a daily credit or
      // another transfer may have landed since.
      if (senderBalance === undefined || recipientBalance === undefined) {
        throw new Error('Cannot transfer between unknown wallets.');
      }
      if (senderBalance < amount) {
        return { transferred: false, reason: 'insufficient-funds' as const };
      }
      // Recipient capacity, asked of the LOCKED row. The service pre-checks this too, but
      // that check reads an unlocked balance and is therefore only an optimisation: two
      // senders can each pass it and together carry the recipient past the column's
      // maximum. Written as a subtraction rather than `recipientBalance + amount > MAX`
      // because the addition can leave the range JavaScript represents exactly, and
      // because letting the column raise ER_WARN_DATA_OUT_OF_RANGE instead would surface a
      // raw database error to the citizen as a 500 rather than as a refusal.
      if (recipientBalance > MAX_WALLET_BALANCE - amount) {
        return { transferred: false, reason: 'recipient-balance-overflow' as const };
      }

      // `balance - ?` / `balance + ?` in SQL. `wallet.balance` is INT UNSIGNED, so an
      // underflow would be a database error rather than a silent wrap -- but the checks
      // above are what prevent it, not the column.
      await trx<Wallet>('wallet').where({ id: senderWalletId }).decrement('balance', amount);
      await trx<Wallet>('wallet').where({ id: recipientWalletId }).increment('balance', amount);

      // ONE row carrying both wallet ids, which is how CTR already represents a
      // member-to-member movement (see createObjectSellTransaction). Paired debit/credit
      // rows alongside it would be a second, contradictory account of the same event.
      //
      // This insert is also where a duplicate intent dies: `idempotency_key` is UNIQUE, so
      // a second commit of the same intent raises here and takes the two balance changes
      // above down with it.
      const [transactionId] = await trx<Transaction>('transaction').insert({
        amount,
        reason: TransactionReason.MemberToMember,
        sender_wallet_id: senderWalletId,
        recipient_wallet_id: recipientWalletId,
        // Stored empty-as-null so "no reason given" is one value in the ledger, not two.
        memo: memo || null,
        idempotency_key: idempotencyKey,
      });

      await this.writeReceipts(trx, request);

      return {
        transferred: true,
        senderBalance: senderBalance - amount,
        recipientBalance: recipientBalance + amount,
        transactionId,
      };
    });
  }

  /**
   * Finds the committed transfer an idempotency key names, if there is one.
   *
   * Used to ANSWER a retry, never to decide whether a transfer may proceed -- that decision
   * belongs to the unique index. See the class docblock.
   * @param idempotencyKey the key to look up
   * @returns the committed ledger row, or undefined if this key has never committed
   */
  public async findByIdempotencyKey(idempotencyKey: string): Promise<Transaction | undefined> {
    return this.db.knex<Transaction>('transaction')
      .where({ idempotency_key: idempotencyKey })
      .first();
  }

  /**
   * Locks both wallet rows for the life of the transaction and returns their balances.
   *
   * Ordered by ascending id rather than by which wallet is sending, so that two transfers
   * running in opposite directions between the same pair request the two locks in the same
   * sequence and cannot deadlock. `whereIn` with an `orderBy` issues this as a single
   * locking read, so there is no window between acquiring the first lock and the second.
   *
   * A locking read also returns the latest committed row rather than the transaction's
   * snapshot, which is what makes the checks that follow see a concurrent transfer that has
   * already committed.
   */
  private async lockWallets(
    trx: Knex.Transaction,
    senderWalletId: number,
    recipientWalletId: number,
  ): Promise<Record<number, number>> {
    const rows = await trx<Wallet>('wallet')
      .select('id', 'balance')
      .whereIn('id', [senderWalletId, recipientWalletId])
      .orderBy('id', 'asc')
      .forUpdate();

    const balances: Record<number, number> = {};
    for (const row of rows) {
      balances[row.id] = row.balance;
    }
    return balances;
  }

  /**
   * Files both parties' Inbox receipts inside the caller's transaction.
   *
   * Inside, not after: a receipt is part of what a transfer IS. The original filed them
   * after committing the money and reported success even when they failed, which is why its
   * log carries rows reading "Success but unable to inbox". Here the money and its evidence
   * commit together or not at all.
   *
   * Written directly against `trx` rather than through InboxRepository, which talks to a
   * module-level knex instance and so would commit separately -- exactly the split this
   * method exists to avoid.
   *
   * ESCAPING. `inbox.message` is rendered with `v-html` by spa/src/pages/Inbox.vue, so this
   * string is parsed as HTML when the citizen opens it. Everything a citizen controls --
   * the memo, and both usernames -- is therefore escaped here, at the sink, while the `<br>`
   * separators are written by this method and are the only markup that survives. An earlier
   * revision instead emitted plain text with `\n` separators, on the theory that plain text
   * cannot inject; that is only true of a plain-text sink, and independent QA demonstrated
   * `<img src=x onerror=...>` executing from a memo. The stored ledger memo is deliberately
   * NOT escaped -- see libs/html.ts for why that distinction matters.
   *
   * The wording is the original's, from phase3.pl, including its `<br>`-joined shape. One
   * deliberate departure: the recipient's copy is authored by the SENDER's member id where
   * the original stamped BOTH copies with the sender's identity, which made a citizen's own
   * outgoing receipt look like it came from them and their incoming one look like it came
   * from the sender's account rather than being addressed to them.
   */
  private async writeReceipts(
    trx: Knex.Transaction,
    request: TransferRequest,
  ): Promise<void> {
    const {
      amount,
      memo,
      senderHomePlaceId,
      senderMemberId,
      senderUsername,
      recipientHomePlaceId,
      recipientMemberId,
      recipientUsername,
    } = request;

    // `amount` is a validated number and needs no escaping; the two names and the memo are
    // citizen-controlled and do.
    const reason = memo ? `<br>reason : ${escapeHtml(memo)}` : '';
    const sender = escapeHtml(senderUsername);
    const recipient = escapeHtml(recipientUsername);

    await this.postReceipt(
      trx,
      senderMemberId,
      senderHomePlaceId,
      'Receipt of funds sent',
      `${recipient} has been transferred ${amount}cc${reason}`,
    );
    await this.postReceipt(
      trx,
      recipientMemberId,
      recipientHomePlaceId,
      'Receipt of funds received',
      `${sender} has transferred you ${amount}cc${reason}`,
    );
  }

  /**
   * Inserts one Inbox message, mirroring InboxRepository.postInboxMessage's convention that
   * a top-level message is its own parent.
   */
  private async postReceipt(
    trx: Knex.Transaction,
    memberId: number,
    placeId: number,
    subject: string,
    message: string,
  ): Promise<void> {
    const [id] = await trx<Inbox>('inbox').insert({
      member_id: memberId,
      place_id: placeId,
      subject,
      message,
      parent_id: 0,
    });
    await trx<Inbox>('inbox').where({ id }).update({ parent_id: id });
  }
}
