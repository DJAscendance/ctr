import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { BankService } from './bank.service';
import { TransactionRepository } from '../../repositories';
import { TransactionReason } from '../../types/models';
import {
  cleanUpFixtures,
  createHome,
  createMember,
  describeWithDb,
  intentKey,
  MemberFixture,
} from '@spec/integration-db';

/**
 * DEF-05: one transfer INTENT moves money exactly once, however many times it is sent.
 *
 * The historical Bank had no such concept -- its confirm button could be clicked twice and
 * would transfer twice -- so this is a deliberate modern addition rather than a restoration.
 * It exists because the alternative is unfixable from the client: a lost response is
 * indistinguishable from a lost request, and a citizen who resubmits after one has no way to
 * know which happened.
 *
 * The distinction being drawn is between:
 *
 *   - ONE intent, sent more than once  -- a double-click, a browser retry, a proxy replay.
 *     Must move money once, and must report the committed transfer both times;
 *   - TWO intents that look identical  -- someone genuinely sending 100cc to the same friend
 *     twice. Must move money twice.
 *
 * These are indistinguishable from the payload, so the client names each intent with a key.
 * The guarantee is the UNIQUE index on `transaction.idempotency_key`, not a lookup: a
 * "has this key been used?" check followed by a transfer is a check-then-act race that two
 * concurrent retries would both pass. The concurrent case below is the one that would catch
 * such an implementation.
 */
describeWithDb('Bank transfer idempotency (real database)', () => {
  const knex = Container.get(Db).knex;
  const service = Container.get(BankService);

  const START = 1000;
  const AMOUNT = 100;
  const MEMO = 'for the pizza';

  async function createCitizen(balance: number = START): Promise<MemberFixture> {
    const member = await createMember(knex);
    await knex('wallet').where({ id: member.walletId }).update({ balance });
    await createHome(knex, member.id);
    return member;
  }

  async function balanceOf(member: MemberFixture): Promise<number> {
    return (await knex('wallet').where({ id: member.walletId }).first()).balance;
  }

  /** Every member-to-member ledger row this sender has written. */
  async function ledgerRows(sender: MemberFixture): Promise<Record<string, unknown>[]> {
    return knex('transaction')
      .where({ sender_wallet_id: sender.walletId, reason: TransactionReason.MemberToMember })
      .orderBy('id', 'asc');
  }

  /** Every receipt filed at either party's home. */
  async function receiptCount(...members: MemberFixture[]): Promise<number> {
    const homes = await knex('place')
      .select('id')
      .where({ type: 'home' })
      .whereIn('member_id', members.map(member => member.id));
    const [row] = await knex('inbox')
      .count('id as count')
      .whereIn('place_id', homes.map(home => home.id));
    return Number(row.count);
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

  describe('the same intent, sent twice', () => {
    it('moves money once and reports success both times', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      const first = await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const second = await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      // The retry is a success, not an error: from the citizen's point of view their
      // transfer went through, which it did.
      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      // ... but only the first one actually moved anything.
      expect(first.replayed).toBeUndefined();
      expect(second.replayed).toBe(true);

      expect(await balanceOf(sender)).toBe(START - AMOUNT);
      expect(await balanceOf(recipient)).toBe(START + AMOUNT);
    });

    it('writes one ledger row', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      const rows = await ledgerRows(sender);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        amount: AMOUNT,
        recipient_wallet_id: recipient.walletId,
        memo: MEMO,
        idempotency_key: key,
      });
    });

    it('files one pair of receipts, not two', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      expect(await receiptCount(sender, recipient)).toBe(2);
    });

    it('reports the recipient and amount of the committed transfer on the retry', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const retry = await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      expect(retry).toMatchObject({
        success: true,
        recipient: recipient.username,
        amount: AMOUNT,
        // The sender's CURRENT balance, re-read. The balance at the instant the original
        // committed is not stored -- only the movement is -- and current truth is the more
        // useful answer for a console about to display it.
        balance: START - AMOUNT,
      });
    });

    it('answers a retry even when the sender could no longer afford the transfer', async () => {
      // The reason the key is checked BEFORE the other rules. The original committed; the
      // sender has since spent the rest. Refusing the retry would tell a citizen their
      // completed transfer had failed.
      const sender = await createCitizen(AMOUNT);
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      expect(await balanceOf(sender)).toBe(0);

      const retry = await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      expect(retry.success).toBe(true);
      expect(retry.replayed).toBe(true);
      expect(await balanceOf(sender)).toBe(0);
    });

    it('answers a retry even after the recipient has given up their home', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const home = await knex('place').where({ type: 'home', member_id: recipient.id }).first();
      await knex('inbox').where({ place_id: home.id }).del();
      await knex('home').where({ place_id: home.id }).del();
      await knex('place').where({ id: home.id }).del();

      const retry = await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      expect(retry.success).toBe(true);
      expect(retry.replayed).toBe(true);
      expect(await balanceOf(recipient)).toBe(START + AMOUNT);
    });
  });

  describe('the same intent, sent concurrently', () => {
    it('moves money once when two identical requests race', async () => {
      // The case a check-then-act implementation fails: both requests look up the key,
      // both find nothing, both pay. Here both attempt the insert and the unique index
      // rejects one, taking its whole transaction down with it.
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      const results = await Promise.all([
        service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key),
        service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key),
      ]);

      expect(results.every(result => result.success)).toBe(true);
      expect(await balanceOf(sender)).toBe(START - AMOUNT);
      expect(await balanceOf(recipient)).toBe(START + AMOUNT);
      expect(await ledgerRows(sender)).toHaveLength(1);
      expect(await receiptCount(sender, recipient)).toBe(2);
    });

    it('moves money once when eight identical requests race', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      const results = await Promise.all(Array.from({ length: 8 }, () =>
        service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key)));

      expect(results.every(result => result.success)).toBe(true);
      // Exactly one of the eight did the work; the other seven reported it.
      expect(results.filter(result => !result.replayed)).toHaveLength(1);
      expect(await balanceOf(sender)).toBe(START - AMOUNT);
      expect(await ledgerRows(sender)).toHaveLength(1);
      expect(await receiptCount(sender, recipient)).toBe(2);
    });
  });

  describe('a key reused for a different operation', () => {
    it('refuses a changed amount and moves nothing', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const conflict = await service.transfer(sender.id, recipient.username, 250, MEMO, key);

      expect(conflict).toEqual({ success: false, refusal: 'idempotency-conflict' });
      expect(await balanceOf(sender)).toBe(START - AMOUNT);
      expect(await ledgerRows(sender)).toHaveLength(1);
    });

    it('refuses a changed recipient and moves nothing', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const other = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const conflict = await service.transfer(sender.id, other.username, AMOUNT, MEMO, key);

      expect(conflict).toEqual({ success: false, refusal: 'idempotency-conflict' });
      expect(await balanceOf(other)).toBe(START);
      expect(await ledgerRows(sender)).toHaveLength(1);
    });

    it('refuses a changed memo and moves nothing', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const conflict = await service.transfer(
        sender.id, recipient.username, AMOUNT, 'something else', key,
      );

      expect(conflict).toEqual({ success: false, refusal: 'idempotency-conflict' });
      expect(await ledgerRows(sender)).toHaveLength(1);
    });

    it('refuses another citizen using the same key, and tells them nothing about it', async () => {
      // The response must not become a way to read someone else's transfer history one
      // guessed key at a time, so the conflict carries no detail at all -- not the amount,
      // not the counterparty, not even that a transfer exists between those two.
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const stranger = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const conflict = await service.transfer(
        stranger.id, recipient.username, AMOUNT, MEMO, key,
      );

      expect(conflict).toEqual({ success: false, refusal: 'idempotency-conflict' });
      expect(Object.keys(conflict)).toEqual(['success', 'refusal']);
      expect(await balanceOf(stranger)).toBe(START);
      expect(await ledgerRows(stranger)).toHaveLength(0);
    });

    it('treats a memo differing only in whitespace as the same intent', async () => {
      // The stored memo is the NORMALIZED form, so the comparison must use that form too --
      // otherwise a retry whose field picked up a trailing space would read as a conflict.
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);
      const retry = await service.transfer(
        sender.id, recipient.username, AMOUNT, `  ${MEMO}  `, key,
      );

      expect(retry.success).toBe(true);
      expect(retry.replayed).toBe(true);
    });
  });

  describe('deliberately repeating a transfer', () => {
    it('honours the same payload sent under a new key', async () => {
      // The behaviour idempotency must not break: sending a friend 100cc twice is an
      // ordinary thing to want, and the historical Bank allowed it.
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const first = await service.transfer(
        sender.id, recipient.username, AMOUNT, MEMO, intentKey(),
      );
      const second = await service.transfer(
        sender.id, recipient.username, AMOUNT, MEMO, intentKey(),
      );

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.replayed).toBeUndefined();
      expect(await balanceOf(sender)).toBe(START - AMOUNT * 2);
      expect(await balanceOf(recipient)).toBe(START + AMOUNT * 2);
      expect(await ledgerRows(sender)).toHaveLength(2);
      expect(await receiptCount(sender, recipient)).toBe(4);
    });

    it('lets a refused transfer be retried under its own key once fixed', async () => {
      // A refusal commits nothing, so it consumes no key. The citizen corrects the amount
      // and sends again with the intent key they still hold.
      const sender = await createCitizen(AMOUNT);
      const recipient = await createCitizen();
      const key = intentKey();

      const refused = await service.transfer(sender.id, recipient.username, 5000, MEMO, key);
      const accepted = await service.transfer(sender.id, recipient.username, 40, MEMO, key);

      expect(refused).toEqual({ success: false, refusal: 'insufficient-funds' });
      expect(accepted.success).toBe(true);
      expect(accepted.replayed).toBeUndefined();
      expect(await balanceOf(sender)).toBe(AMOUNT - 40);
    });
  });

  describe('the key itself', () => {
    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['too short', 'abc'],
      ['too long', 'k'.repeat(65)],
      ['containing a space', 'key with space'],
      ['containing punctuation', 'key.with.dots'],
      ['not a string', 12345678],
    ])('refuses a %s key without moving money', async (_label, key) => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const result = await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key);

      expect(result).toEqual({ success: false, refusal: 'idempotency-key-required' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await ledgerRows(sender)).toHaveLength(0);
    });

    it('accepts a canonical UUID, which is what the console sends', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const result = await service.transfer(
        sender.id, recipient.username, AMOUNT, MEMO,
        '3f1a9c7e-5b42-4d18-9a60-7c2e8d4f10bb',
      );

      expect(result.success).toBe(true);
    });

    it('treats keys differing only in case as different intents', async () => {
      // The column is `utf8mb4_bin`, so the index agrees with the byte-for-byte comparison
      // the service makes. Under the table's default case-insensitive collation these two
      // would collide and the second would be silently treated as a retry of the first.
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const key = intentKey();

      await service.transfer(sender.id, recipient.username, AMOUNT, MEMO, key.toLowerCase());
      const second = await service.transfer(
        sender.id, recipient.username, AMOUNT, MEMO, key.toUpperCase(),
      );

      expect(second.success).toBe(true);
      expect(second.replayed).toBeUndefined();
      expect(await ledgerRows(sender)).toHaveLength(2);
    });
  });

  it('lets many non-Bank transactions coexist with no key at all', async () => {
    // Every other transaction type, and every row written before the column existed, carries
    // NULL. MySQL permits any number of NULLs in a UNIQUE index, which is what makes this a
    // column addition rather than a data migration: nothing needed backfilling, and no
    // existing row was invalidated. Written through the repository the system credit path
    // actually uses, so this would notice a key being set where none belongs.
    const member = await createCitizen();
    const transactionRepository = Container.get(TransactionRepository);

    await transactionRepository.createSystemCreditTransaction(member.walletId, 10);
    await transactionRepository.createSystemCreditTransaction(member.walletId, 20);
    await transactionRepository.createHomeRefundTransaction(member.walletId, 30);

    const rows = await knex('transaction')
      .where({ recipient_wallet_id: member.walletId })
      .orderBy('id', 'asc');
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.idempotency_key === null)).toBe(true);
    expect(await balanceOf(member)).toBe(START + 60);
  });
});
