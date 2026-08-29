import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { CountRow } from '../row.types';
import { Member, Transaction, TransactionReason, Wallet } from '../../types/models';

/**
 * A transaction row as the admin pages consume it: the stored columns plus the
 * usernames `AdminService` resolves onto them after the query.
 */
export interface TransactionRow extends Transaction {
  recipient_username?: Pick<Member, 'username'>[];
  sender_username?: Pick<Member, 'username'>[];
}

/** A `count(id)` result, as knex returns it: a single row holding the total. */
export interface TransactionCount {
  count: number;
}

/**
 * A transaction as the admin listings hand it back: the stored columns, plus the two
 * username fields `AdminService` resolves onto each row from the wallet ids once it has
 * them. Optional because the repository never sets them itself.
 */
export interface TransactionListRow extends Transaction {
  recipient_username?: { username: string }[];
  sender_username?: { username: string }[];
}

/** Repository for creating/interacting with transaction/wallet data in the database. */
@Service()
export class TransactionRepository {
  constructor(private db: Db) {}

  /**
   * Finds a transaction with the given search parameters if one exists.
   * @param transactionSearchParams object containing properties of a transaction for searching on
   * @returns promise resolving in the found transaction object, or rejecting on error
   */
  public async find(transactionSearchParams: Partial<Transaction>): Promise<Transaction> {
    const [transaction] = await this.db.transaction.where(transactionSearchParams);
    return transaction;
  }

  /*
   * NOTE on every money-moving method in this class.
   *
   * They ALL used to read a wallet's balance into JavaScript and write back the computed
   * total. That is a lost-update waiting to happen: two transactions read the same balance
   * and the second overwrites the first, so one of the two movements vanishes while its
   * ledger row survives to say it happened. `creditWallet` further down documents why in
   * full.
   *
   * This matters here more than it would in an isolated subsystem, because a citizen-to-
   * citizen Bank transfer can be moving money in or out of the very same wallet at the same
   * moment. The Bank takes SELECT ... FOR UPDATE on both wallets, but a lock only serialises
   * against other LOCKERS -- a plain read-then-write elsewhere never asks for the lock, so it
   * reads a stale balance and clobbers whatever the transfer committed. Measured: a wallet
   * holding 1000 that receives a 500 Bank transfer while being charged 100 by one of these
   * writers ended at 900 rather than 1400. 500cc destroyed, with a ledger row for each.
   *
   * An earlier revision of this lane hardened only four of them and left five behind as a
   * reported finding. Independent QA proved that was the wrong call: leaving a known
   * Bank-clobbering writer in place is not a smaller change, it is the same bug with fewer
   * witnesses. All of them now use SQL-side arithmetic.
   *
   * Two rules hold throughout, and both must survive any future edit:
   *
   *   1. `balance = balance +/- ?` in SQL -- `.increment()` / `.decrement()` -- never a read
   *      in JavaScript followed by a write of the computed total.
   *   2. Every read a method needs before it commits goes through its own `trx`. `this.find()`
   *      queries through the POOL's connection, which cannot see the uncommitted row anyway,
   *      and holds the transaction open while waiting for a SECOND pool connection. With
   *      `pool.max` 5, six concurrent callers each holding one connection and waiting for
   *      another exhaust the pool outright -- reproduced at 100% before this was fixed.
   *
   * Multi-wallet methods additionally lock both rows in ascending wallet-id order, never in
   * sender-then-recipient order: two mirrored operations would each hold one row and wait on
   * the other. See createObjectSellTransaction and TransferRepository.
   */

  /**
   * Deducts the given amount from the balance for the wallet with the given id, and creates
   * a transaction record.
   * @param walletId id of recipient wallet
   * @param amount amount transacted
   * @returns promise resolving in the created transaction object, or rejecting on error
   */
  public async createHomePurchaseTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).decrement('balance', amount);
      const [transactionId] = await trx<Transaction>('transaction').insert({
        amount,
        reason: TransactionReason.HomePurchase,
        sender_wallet_id: walletId,
      });
      // Read back through the same `trx`. `this.find()` would query through the pool's own
      // connection, which cannot see this row until the transaction commits -- so the
      // transaction sits open waiting on a SECOND pool connection, and enough concurrent
      // callers exhaust the pool and deadlock each other. `creditWallet` below documents
      // the same rule.
      const [transaction] = await trx<Transaction>('transaction').where({ id: transactionId });
      return transaction;
    });
  }

  /**
   * Applies the given amount to the balance for the wallet with the given id, and creates
   * a transaction record.
   * @param walletId id of recipient wallet
   * @param amount amount transacted
   * @returns promise resolving in the created transaction object, or rejecting on error
   */
  public async createHomeRefundTransaction(walletId: number, amount: number): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).increment('balance', amount);
      const [transactionId] = await trx<Transaction>('transaction').insert({
        amount,
        reason: TransactionReason.HomeRefund,
        recipient_wallet_id: walletId,
      });
      // Read back through the same `trx`. `this.find()` would query through the pool's own
      // connection, which cannot see this row until the transaction commits -- so the
      // transaction sits open waiting on a SECOND pool connection, and enough concurrent
      // callers exhaust the pool and deadlock each other. `creditWallet` below documents
      // the same rule.
      const [transaction] = await trx<Transaction>('transaction').where({ id: transactionId });
      return transaction;
    });
  }

  public async createSystemCreditTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).increment('balance', amount);
      const [transactionId] = await trx<Transaction>('transaction').insert({
        amount,
        reason: TransactionReason.SystemToMember,
        recipient_wallet_id: walletId,
      });
      // Read back through the same `trx`. `this.find()` would query through the pool's own
      // connection, which cannot see this row until the transaction commits -- so the
      // transaction sits open waiting on a SECOND pool connection, and enough concurrent
      // callers exhaust the pool and deadlock each other. `creditWallet` below documents
      // the same rule.
      const [transaction] = await trx<Transaction>('transaction').where({ id: transactionId });
      return transaction;
    });
  }

  /**
   * Inserts a ledger row inside the caller's transaction and reads it straight back through
   * that same transaction.
   *
   * The readback exists because every caller returns the stored row. It goes through `trx`
   * and not `this.find()` for the reason rule 2 above gives: `this.find()` asks the pool for
   * a second connection while this one is still held, which both cannot see the uncommitted
   * row and exhausts the pool under concurrency.
   */
  private async recordTransaction(
    trx: Knex.Transaction,
    row: Partial<Transaction>,
  ): Promise<Transaction> {
    const [transactionId] = await trx<Transaction>('transaction').insert(row);
    const [transaction] = await trx<Transaction>('transaction').where({ id: transactionId });
    return transaction;
  }

  /**
   * Charges a member's wallet the fee for uploading an object to the Mall.
   *
   * Debit only, single wallet, no affordability check -- the caller
   * (ObjectService.performObjectUploadTransaction) has always relied on the column being
   * INT UNSIGNED to refuse an overdraft, and this correction deliberately does not add or
   * remove that behaviour. What changed is only HOW the balance moves.
   */
  public async createObjectUploadTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).decrement('balance', amount);
      return this.recordTransaction(trx, {
        amount,
        reason: TransactionReason.ObjectUpload,
        sender_wallet_id: walletId,
      });
    });
  }

  /** Charges a member's wallet for restocking an object they sell. Debit, single wallet. */
  public async createObjectRestockTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).decrement('balance', amount);
      return this.recordTransaction(trx, {
        amount,
        reason: TransactionReason.ObjectRestock,
        sender_wallet_id: walletId,
      });
    });
  }

  /**
   * Credits a wallet and records the matching ledger row.
   *
   * Split out so a caller that is already inside a transaction can have the
   * credit and the row commit together with its own writes, rather than
   * committing separately and leaving a window where one landed and the other
   * did not.
   */
  private async creditWallet(
    trx: Knex.Transaction,
    walletId: number,
    amount: number,
    reason: TransactionReason,
  ): Promise<Transaction> {
    // `balance = balance + ?` in SQL, not read-then-write in JavaScript. The
    // object-row lock only serialises rejections of the same object; two
    // different objects belonging to one uploader can be rejected at the same
    // moment, and a read-modify-write would let both transactions read the same
    // balance so the second overwrites the first -- losing a refund the ledger
    // still says was paid.
    const credited = await trx<Wallet>('wallet')
      .where({ id: walletId })
      .increment('balance', amount);
    if (!credited) {
      // No such wallet. Raised rather than ignored: the caller is mid-refund and
      // must not commit a ledger row for money that was never credited.
      throw new Error(`Cannot credit unknown wallet ${walletId}`);
    }
    const [transactionId] = await trx<Transaction>('transaction').insert({
      amount,
      reason,
      recipient_wallet_id: walletId,
    });
    // Read back through the same `trx`, not `this.find()` -- that queries
    // through the pool's own connection, which cannot see this row until the
    // transaction commits, and holds the transaction open waiting on a second
    // pool connection. Concurrent refunds could then contend the pool itself.
    const [transaction] = await trx<Transaction>('transaction').where({ id: transactionId });
    return transaction;
  }

  /**
   * Refunds an upload fee.
   *
   * Joins the caller's transaction when one is supplied - the Mall rejection
   * needs the refund and the object's status change to be the same commit - and
   * otherwise opens its own, which is what every existing caller gets.
   */
  public async createObjectUploadRefundTransaction(
    walletId: number,
    amount: number,
    trx?: Knex.Transaction,
  ): Promise<Transaction> {
    if (trx) {
      return this.creditWallet(trx, walletId, amount, TransactionReason.ObjectUploadRefund);
    }
    return await this.db.knex.transaction(async ownTrx =>
      this.creditWallet(ownTrx, walletId, amount, TransactionReason.ObjectUploadRefund));
  }

  /** Refunds a seller for object instances that never sold. Credit, single wallet. */
  public async createUnsoldObjectRefundTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).increment('balance', amount);
      return this.recordTransaction(trx, {
        amount,
        reason: TransactionReason.ObjectUnsoldInstancesRefund,
        recipient_wallet_id: walletId,
      });
    });
  }

  /** Charges a buyer for a Mall object. Debit, single wallet. */
  public async createObjectPurchaseTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).decrement('balance', amount);
      return this.recordTransaction(trx, {
        amount,
        reason: TransactionReason.ObjectPurchase,
        sender_wallet_id: walletId,
      });
    });
  }

  /** Pays a seller their proceeds from a Mall object. Credit, single wallet. */
  public async createObjectProfitTransaction(
    walletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet').where({ id: walletId }).increment('balance', amount);
      return this.recordTransaction(trx, {
        amount,
        reason: TransactionReason.ObjectProfit,
        recipient_wallet_id: walletId,
      });
    });
  }

  /**
   * Moves the price of a resold object from the buyer to the seller.
   *
   * The parameters are WALLET ids, not member ids. They were named `buyerId`/`sellerId`,
   * which reads as member ids and is not what any caller passes -- see
   * ObjectInstanceService.buyObjectInstance, which hands over `buyerWallet.id` and
   * `sellerWallet.id`. Renamed rather than reinterpreted.
   *
   * Both rows are locked in ascending id order before either is written, matching
   * TransferRepository: two members trading with each other in opposite directions at the
   * same moment would otherwise each hold one row and wait on the other.
   */
  public async createObjectSellTransaction(
    buyerWalletId: number,
    sellerWalletId: number,
    amount: number,
  ): Promise<Transaction> {
    return await this.db.knex.transaction(async trx => {
      await trx<Wallet>('wallet')
        .whereIn('id', [buyerWalletId, sellerWalletId])
        .orderBy('id', 'asc')
        .forUpdate();
      await trx<Wallet>('wallet')
        .where({ id: sellerWalletId })
        .increment('balance', amount);
      await trx<Wallet>('wallet')
        .where({ id: buyerWalletId })
        .decrement('balance', amount);
      const [transactionId] = await trx<Transaction>('transaction').insert({
        amount,
        reason: TransactionReason.ObjectSell,
        recipient_wallet_id: sellerWalletId,
        sender_wallet_id: buyerWalletId,
      });
      // Read back through the same `trx`. `this.find()` would query through the pool's own
      // connection, which cannot see this row until the transaction commits -- so the
      // transaction sits open waiting on a SECOND pool connection, and enough concurrent
      // callers exhaust the pool and deadlock each other. `creditWallet` below documents
      // the same rule.
      const [transaction] = await trx<Transaction>('transaction').where({ id: transactionId });
      return transaction;
    });
  }

  public async getTransactions(
    type: string,
    limit: number,
    offset: number,
  ): Promise<TransactionListRow[]> {
    return this.db.knex
      .select(
        'id',
        'created_at',
        'amount',
        'recipient_wallet_id',
        'sender_wallet_id',
        'reason',
      )
      .from('transaction')
      .where('reason', type)
      .limit(limit)
      .offset(offset)
      .orderBy('id', 'DESC');
  }

  public async getTransactionsByWalletId(
    id: number,
    limit: number,
    offset: number,
  ): Promise<TransactionListRow[]> {
    return this.db.knex
      .select(
        'id',
        'created_at',
        'amount',
        'recipient_wallet_id',
        'sender_wallet_id',
        'reason',
      )
      .from('transaction')
      .where('recipient_wallet_id', id)
      .orWhere('sender_wallet_id', id)
      .limit(limit)
      .offset(offset)
      .orderBy('id', 'DESC');
  }

  public async getLatestTransactions(time: Date): Promise<TransactionListRow[]> {
    return this.db.knex
      .select('transaction.*')
      .from('transaction')
      .where('created_at', '>=', time)
      .limit(30)
      .orderBy('transaction.id', 'DESC');
  }

  public async getTotal( type: string): Promise<TransactionCount[]> {
    // knex types an untyped `count` as a dictionary of unnamed columns; the alias makes
    // the shape known here in a way the builder's own types cannot express.
    const rows = await this.db.knex
      .count('id as count')
      .from('transaction')
      .where('reason', type);
    return <TransactionCount[]><unknown>rows;
  }

  public async getWalletTotal( id: number): Promise<TransactionCount[]> {
    const rows = await this.db.knex
      .count('id as count')
      .from('transaction')
      .where('recipient_wallet_id', id)
      .orWhere('sender_wallet_id', id);
    return <TransactionCount[]><unknown>rows;
  }

  public async removeAllByWalletId(id: number): Promise<void> {
    await this.db.knex('transaction')
      .where('recipient_wallet_id', id)
      .orWhere('sender_wallet_id', id)
      .del();
  }
}
