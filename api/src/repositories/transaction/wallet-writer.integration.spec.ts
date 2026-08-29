import { Knex } from 'knex';
import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { TransactionRepository } from './transaction.repository';
import { Transaction, TransactionReason, Wallet } from '../../types/models';
import {
  cleanUpFixtures,
  createMember,
  describeWithDb,
  MemberFixture,
} from '@spec/integration-db';

/**
 * That the hardened wallet writers cannot lose money when they run concurrently.
 *
 * These methods used to read a balance into JavaScript and write back the computed total.
 * Two of them running at once both read the same balance, and the second overwrites the
 * first -- so one movement disappears while its ledger row survives to say it happened.
 * Taking a row lock elsewhere does not help: the Bank transfer holds SELECT ... FOR UPDATE
 * on both wallets, but a writer that never asks for a lock has already read a stale balance
 * and will overwrite whatever the transfer committed.
 *
 * The bursts below are the assertions that actually bite. Reverting
 * createSystemCreditTransaction to a read-then-write turns "keeps every one of a burst"
 * from 1250 into 1075 -- seven of ten credits silently gone.
 *
 * ALL NINE production writers are covered here. An earlier revision of this lane hardened
 * four and left five, and the `describe` blocks at the end of this file are the ones added
 * when independent QA proved that the remaining five could and did destroy Bank money.
 */
describeWithDb('hardened wallet writers (real database)', () => {
  const knex = Container.get(Db).knex;
  const repository = Container.get(TransactionRepository);

  const START = 1000;

  async function createFundedMember(balance: number = START): Promise<MemberFixture> {
    const member = await createMember(knex);
    await knex('wallet').where({ id: member.walletId }).update({ balance });
    return member;
  }

  async function balanceOf(member: MemberFixture): Promise<number> {
    return (await knex('wallet').where({ id: member.walletId }).first()).balance;
  }

  beforeEach(async () => {
    await cleanUpFixtures(knex);
  });

  afterEach(async () => {
    await cleanUpFixtures(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('charges every one of a burst of concurrent home purchases', async () => {
    const member = await createFundedMember();

    await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.createHomePurchaseTransaction(member.walletId, 30)),
    );

    expect(await balanceOf(member)).toBe(START - 300);
  });

  it('pays every one of a burst of concurrent home refunds', async () => {
    const member = await createFundedMember();

    await Promise.all(
      Array.from({ length: 10 }, () => repository.createHomeRefundTransaction(member.walletId, 40)),
    );

    expect(await balanceOf(member)).toBe(START + 400);
  });

  it('keeps every one of a burst of concurrent system credits', async () => {
    const member = await createFundedMember();

    await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.createSystemCreditTransaction(member.walletId, 25)),
    );

    expect(await balanceOf(member)).toBe(START + 250);
  });

  it('moves an object resale price between two wallets, conserving the total', async () => {
    const buyer = await createFundedMember();
    const seller = await createFundedMember();

    await repository.createObjectSellTransaction(buyer.walletId, seller.walletId, 400);

    expect(await balanceOf(buyer)).toBe(START - 400);
    expect(await balanceOf(seller)).toBe(START + 400);
  });

  it('does not deadlock when two members resell to each other at the same moment', async () => {
    const left = await createFundedMember();
    const right = await createFundedMember();

    await Promise.all([
      repository.createObjectSellTransaction(left.walletId, right.walletId, 100),
      repository.createObjectSellTransaction(right.walletId, left.walletId, 100),
    ]);

    expect(await balanceOf(left)).toBe(START);
    expect(await balanceOf(right)).toBe(START);
  });

  /*
   * ------------------------------------------------------------------------------------
   * DEF-01: the five writers an earlier revision left unhardened.
   * ------------------------------------------------------------------------------------
   *
   * Each is proved against a Bank transfer landing on the same wallet, in the exact ordering
   * that used to destroy money:
   *
   *   1. the legacy writer opens its transaction and takes its snapshot of the balance;
   *   2. the Bank transfer commits, changing that balance;
   *   3. the legacy writer writes.
   *
   * Step 3 is where the old code wrote an ABSOLUTE total computed from the value it read in
   * step 1, silently erasing step 2. The current code writes `balance = balance +/- ?`, so
   * step 2 survives.
   *
   * The ordering is CHOSEN, not raced. `runInterleaved` below parks the legacy writer on a
   * real InnoDB row lock and waits -- by polling `information_schema.processlist` until that
   * writer's UPDATE is provably in flight and unfinished, not by sleeping -- before letting
   * the Bank transfer commit. Firing two promises and hoping is exactly what this file must
   * not do: against the old code such a test passes most of the time. Against this one, the
   * upload case returns 900 where 1400 is correct, which is the defect QA reported.
   */

  /** Reads the wallet balance directly, for tests that hold their own transaction. */
  async function balanceOfWallet(walletId: number): Promise<number> {
    return (await knex<Wallet>('wallet').where({ id: walletId }).first()).balance;
  }

  /**
   * Blocks until `count` other connections are parked mid-UPDATE on the `wallet` table.
   *
   * A real barrier rather than a sleep. `processlist` reports a connection as `Query` with
   * its statement still in `info` for exactly as long as that statement has not finished, so
   * seeing our writer's UPDATE there means it has reached its write and gone no further --
   * which is the state the interleaving needs before the transfer is allowed to commit.
   * `CONNECTION_ID()` excludes this poll's own statement, which also matches `wallet` when
   * the query text is scanned.
   *
   * WHY NOT `innodb_trx`. The obvious form of this barrier -- polling for a transaction whose
   * `trx_state` is `LOCK WAIT` -- does not work, and fails in a way worth recording because it
   * looks like a test bug rather than a server behaviour. Polling INNODB_TRX in a loop takes
   * InnoDB's transaction-system and lock-system mutexes, which is the same machinery a
   * transaction needs in order to REGISTER its lock wait. On MySQL 5.7 a 25-50ms poll is
   * enough to starve the waiter indefinitely: the writer sat in `Sleep`, never entered
   * LOCK WAIT, and the barrier timed out after a full 5 seconds every time. PROCESSLIST reads
   * none of that machinery and reports the parked writer within about 50ms.
   */
  async function waitForLockWaiters(count: number): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [rows] = await knex.raw(
        'SELECT id FROM information_schema.processlist '
        + 'WHERE command = \'Query\' AND info LIKE \'%`wallet`%\' '
        + 'AND id <> CONNECTION_ID()');
      if (rows.length >= count) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${count} writer(s) to park on the wallet row.`);
  }

  /**
   * Runs a Bank transfer and a legacy wallet writer against one wallet, in the ordering that
   * used to destroy money.
   *
   * The Bank transfer is driven by hand rather than through TransferRepository, because the
   * whole point is to choose WHEN it commits relative to the legacy writer, and a method
   * that opens and commits its own transaction cannot be paused in the middle. The
   * statements issued are the ones TransferRepository issues -- both rows locked in
   * ascending id order, `balance +/- ?` in SQL, one ledger row carrying both wallets -- so
   * what is being interleaved is the real algorithm. That the repository itself behaves
   * correctly is transfer.integration.spec.ts's job.
   *
   * The sequence, and why each step is where it is:
   *
   *   1. the transfer takes both row locks and stops. It is now the lock holder, which is
   *      what lets the test hold the legacy writer without a third transaction -- an
   *      independent blocker would have to be released before the transfer could proceed,
   *      and releasing it would let the legacy writer through FIRST, which is the safe
   *      ordering and proves nothing;
   *   2. the legacy writer starts. On the old read-then-write code it completes its SELECT
   *      here -- capturing the pre-transfer balance -- and parks on its UPDATE. On the
   *      current code it parks on its UPDATE with no JavaScript-side balance at all;
   *   3. the test waits until it is PROVABLY parked, by polling innodb_trx for a
   *      transaction in LOCK WAIT;
   *   4. the transfer moves the money and commits. The wallet is now worth more;
   *   5. the legacy writer unblocks and writes. The old code writes the absolute total it
   *      computed in step 2, erasing step 4. The current code applies its delta to whatever
   *      the row now holds.
   *
   * @param senderWalletId wallet the transfer's money comes from
   * @param recipientWalletId wallet both operations touch
   * @param amount CityCash the transfer moves
   * @param legacy the legacy operation, already bound to the recipient wallet
   * @returns the recipient wallet's balance once both have finished
   */
  async function runInterleaved(
    senderWalletId: number,
    recipientWalletId: number,
    amount: number,
    legacy: () => Promise<unknown>,
  ): Promise<number> {
    const trx: Knex.Transaction = await knex.transaction();
    let legacyRun: Promise<unknown> | undefined;
    try {
      // 1. The transfer's own locking read, in ascending wallet-id order.
      await trx<Wallet>('wallet')
        .whereIn('id', [senderWalletId, recipientWalletId])
        .orderBy('id', 'asc')
        .forUpdate();

      // 2 and 3. The legacy writer starts and is held at its UPDATE by the lock above.
      // Its rejection is captured now so that a failure in step 3 cannot surface as an
      // unhandled rejection instead of as this test's error.
      legacyRun = legacy();
      const parked = legacyRun.catch(error => error);
      await waitForLockWaiters(1);

      // 4. The transfer completes and commits, while the legacy writer is still parked.
      await trx<Wallet>('wallet').where({ id: senderWalletId }).decrement('balance', amount);
      await trx<Wallet>('wallet').where({ id: recipientWalletId }).increment('balance', amount);
      await trx<Transaction>('transaction').insert({
        amount,
        reason: TransactionReason.MemberToMember,
        sender_wallet_id: senderWalletId,
        recipient_wallet_id: recipientWalletId,
      });
      await trx.commit();

      // 5. The legacy writer proceeds.
      await parked;
    } catch (error) {
      // Rolled back on any failure, so a broken test cannot leave a row locked and turn the
      // next test's fixture cleanup into a 50-second InnoDB lock wait.
      await trx.rollback().catch(() => undefined);
      await legacyRun?.catch(() => undefined);
      throw error;
    }
    return balanceOfWallet(recipientWalletId);
  }

  describe('a Bank transfer racing a legacy wallet writer', () => {
    /*
     * Every case below asserts the same invariant, which is the one QA found violated:
     *
     *   final balance = initial balance + Bank delta + legacy delta
     *
     * With the read-then-write code the legacy delta is applied to a stale total and the
     * Bank's 500 disappears -- 1000 + 500 - 100 came out as 900 rather than 1400.
     */
    const BANK_AMOUNT = 500;
    const LEGACY_AMOUNT = 100;
    /**
     * Generous, because the test deliberately parks a transaction on a row lock and waits
     * for InnoDB to report it. Well under InnoDB's own 50-second lock-wait timeout, so a
     * genuine regression still fails here rather than somewhere less legible.
     */
    const INTERLEAVE_TIMEOUT_MS = 20000;

    it('does not lose the transfer to an object upload charge', async () => {
      const member = await createFundedMember();
      const payer = await createFundedMember(BANK_AMOUNT);

      const balance = await runInterleaved(
        payer.walletId,
        member.walletId,
        BANK_AMOUNT,
        () => repository.createObjectUploadTransaction(member.walletId, LEGACY_AMOUNT),
      );

      expect(balance).toBe(START + BANK_AMOUNT - LEGACY_AMOUNT);
    }, INTERLEAVE_TIMEOUT_MS);

    it('does not lose the transfer to an object restock charge', async () => {
      const member = await createFundedMember();
      const payer = await createFundedMember(BANK_AMOUNT);

      const balance = await runInterleaved(
        payer.walletId,
        member.walletId,
        BANK_AMOUNT,
        () => repository.createObjectRestockTransaction(member.walletId, LEGACY_AMOUNT),
      );

      expect(balance).toBe(START + BANK_AMOUNT - LEGACY_AMOUNT);
    }, INTERLEAVE_TIMEOUT_MS);

    it('does not lose the transfer to an unsold-object refund', async () => {
      const member = await createFundedMember();
      const payer = await createFundedMember(BANK_AMOUNT);

      const balance = await runInterleaved(
        payer.walletId,
        member.walletId,
        BANK_AMOUNT,
        () => repository.createUnsoldObjectRefundTransaction(member.walletId, LEGACY_AMOUNT),
      );

      expect(balance).toBe(START + BANK_AMOUNT + LEGACY_AMOUNT);
    }, INTERLEAVE_TIMEOUT_MS);

    it('does not lose the transfer to an object purchase charge', async () => {
      const member = await createFundedMember();
      const payer = await createFundedMember(BANK_AMOUNT);

      const balance = await runInterleaved(
        payer.walletId,
        member.walletId,
        BANK_AMOUNT,
        () => repository.createObjectPurchaseTransaction(member.walletId, LEGACY_AMOUNT),
      );

      expect(balance).toBe(START + BANK_AMOUNT - LEGACY_AMOUNT);
    }, INTERLEAVE_TIMEOUT_MS);

    it('does not lose the transfer to an object profit payment', async () => {
      const member = await createFundedMember();
      const payer = await createFundedMember(BANK_AMOUNT);

      const balance = await runInterleaved(
        payer.walletId,
        member.walletId,
        BANK_AMOUNT,
        () => repository.createObjectProfitTransaction(member.walletId, LEGACY_AMOUNT),
      );

      expect(balance).toBe(START + BANK_AMOUNT + LEGACY_AMOUNT);
    }, INTERLEAVE_TIMEOUT_MS);
  });

  describe('bursts of the five formerly-unsafe writers', () => {
    /*
     * The same shape as the four bursts above, extended to the five that were left behind.
     * Weaker than the interleaved tests -- a burst can pass by luck -- but it exercises the
     * real repository method end to end rather than a replay of its statements, so the two
     * together cover both "the algorithm is safe" and "this method uses that algorithm".
     */
    it('charges every one of a burst of concurrent object uploads', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: 10 }, () =>
        repository.createObjectUploadTransaction(member.walletId, 30)));

      expect(await balanceOf(member)).toBe(START - 300);
    });

    it('charges every one of a burst of concurrent restocks', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: 10 }, () =>
        repository.createObjectRestockTransaction(member.walletId, 20)));

      expect(await balanceOf(member)).toBe(START - 200);
    });

    it('pays every one of a burst of concurrent unsold-object refunds', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: 10 }, () =>
        repository.createUnsoldObjectRefundTransaction(member.walletId, 15)));

      expect(await balanceOf(member)).toBe(START + 150);
    });

    it('charges every one of a burst of concurrent object purchases', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: 10 }, () =>
        repository.createObjectPurchaseTransaction(member.walletId, 25)));

      expect(await balanceOf(member)).toBe(START - 250);
    });

    it('pays every one of a burst of concurrent object profits', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: 10 }, () =>
        repository.createObjectProfitTransaction(member.walletId, 35)));

      expect(await balanceOf(member)).toBe(START + 350);
    });
  });

  /*
   * ------------------------------------------------------------------------------------
   * DEF-02: no writer asks the pool for a second connection while holding one.
   * ------------------------------------------------------------------------------------
   *
   * Every one of these methods ended by reading its new ledger row back. Five of them did it
   * with `this.find()`, which queries through the POOL rather than through the open
   * transaction. That is wrong twice over: the row is uncommitted, so the pool's connection
   * cannot see it; and the transaction stays open while waiting for a second connection.
   *
   * `pool.max` is 5 in the test environment (see knexfile.ts), which is what makes this
   * reproducible: with six or more concurrent callers, every pooled connection is held by a
   * transaction that is itself waiting for a connection, and nothing can ever proceed.
   * Independent QA measured 100% timeout at six callers.
   *
   * The bound below is what makes this a test rather than a hang. Each case would sit on
   * knex's own 60s acquire timeout under the old code; failing at 30s reports a pool
   * regression as a failure instead of as a stalled suite.
   */
  describe('pool safety under concurrency', () => {
    const POOL_EXHAUSTION_TIMEOUT_MS = 30000;
    /** Comfortably above `pool.max`, so a second-connection-per-caller design cannot finish. */
    const CONCURRENT_CALLERS = 10;

    it('runs ten concurrent object uploads on a pool of five', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: CONCURRENT_CALLERS }, () =>
        repository.createObjectUploadTransaction(member.walletId, 10)));

      expect(await balanceOf(member)).toBe(START - 100);
    }, POOL_EXHAUSTION_TIMEOUT_MS);

    it('runs ten concurrent restocks on a pool of five', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: CONCURRENT_CALLERS }, () =>
        repository.createObjectRestockTransaction(member.walletId, 10)));

      expect(await balanceOf(member)).toBe(START - 100);
    }, POOL_EXHAUSTION_TIMEOUT_MS);

    it('runs ten concurrent unsold-object refunds on a pool of five', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: CONCURRENT_CALLERS }, () =>
        repository.createUnsoldObjectRefundTransaction(member.walletId, 10)));

      expect(await balanceOf(member)).toBe(START + 100);
    }, POOL_EXHAUSTION_TIMEOUT_MS);

    it('runs ten concurrent object purchases on a pool of five', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: CONCURRENT_CALLERS }, () =>
        repository.createObjectPurchaseTransaction(member.walletId, 10)));

      expect(await balanceOf(member)).toBe(START - 100);
    }, POOL_EXHAUSTION_TIMEOUT_MS);

    it('runs ten concurrent object profits on a pool of five', async () => {
      const member = await createFundedMember();

      await Promise.all(Array.from({ length: CONCURRENT_CALLERS }, () =>
        repository.createObjectProfitTransaction(member.walletId, 10)));

      expect(await balanceOf(member)).toBe(START + 100);
    }, POOL_EXHAUSTION_TIMEOUT_MS);

    it('returns the ledger row it just wrote, read back through its own transaction', async () => {
      // The readback is the reason the second connection was being asked for. Asserting on
      // the returned row keeps the fix honest: dropping the readback entirely would also
      // stop exhausting the pool, and would be a different, worse change.
      const member = await createFundedMember();

      const written = await repository.createObjectUploadTransaction(member.walletId, 40);

      expect(written).toMatchObject({
        amount: 40,
        reason: TransactionReason.ObjectUpload,
        sender_wallet_id: member.walletId,
      });
    });
  });
});
