import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { BankService, TransferResult } from './bank.service';
import { TransferRepository } from '../../repositories';
import {
  cleanUpFixtures,
  createHome,
  createMember,
  describeWithDb,
  intentKey,
  MemberFixture,
} from '@spec/integration-db';

/**
 * The Cybertown Bank's citizen-to-citizen transfer, against a real MySQL.
 *
 * The questions worth asking here are all about what the database is left holding: whether
 * two transfers racing the same wallet can overspend it, whether a mirrored pair deadlocks,
 * whether a failure part way through leaves money moved, and whether the receipts and the
 * ledger row agree with the balances. A mocked query builder cannot answer any of them --
 * and every one of them is a bug the original Bank actually had.
 *
 * Requires the disposable-database opt-in described in `spec/integration-db.ts`, and
 * `--runInBand`.
 */
describeWithDb('bank transfer (real database)', () => {
  const knex = Container.get(Db).knex;
  const service = Container.get(BankService);
  const transferRepository = Container.get(TransferRepository);

  const START = 1000;

  /** A citizen with a home, and therefore able to send and receive. */
  async function createCitizen(balance: number = START): Promise<MemberFixture> {
    const member = await createMember(knex);
    await knex('wallet').where({ id: member.walletId }).update({ balance });
    await createHome(knex, member.id);
    return member;
  }

  /** A citizen with no home -- the historical "cannot use this function" case. */
  async function createHomeless(): Promise<MemberFixture> {
    return createMember(knex);
  }

  async function balanceOf(member: MemberFixture): Promise<number> {
    const wallet = await knex('wallet').where({ id: member.walletId }).first();
    return wallet.balance;
  }

  async function ledgerRows(member: MemberFixture) {
    return knex('transaction')
      .where({ sender_wallet_id: member.walletId, reason: 'member-to-member' });
  }

  async function inboxFor(member: MemberFixture) {
    const home = await knex('place').where({ type: 'home', member_id: member.id }).first();
    return knex('inbox').where({ place_id: home.id }).orderBy('id', 'asc');
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

  describe('a successful transfer', () => {
    it('debits the sender and credits the recipient exactly, with no fee', async () => {
      // Verified against all 55 surviving rows of bank_transfers.log: closing balances are
      // always opening -/+ the amount. Cybertown took no commission.
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const result = await service.transfer(
        sender.id, recipient.username, 250, 'for the pizza', intentKey(),
      );

      expect(result.success).toBe(true);
      expect(await balanceOf(sender)).toBe(START - 250);
      expect(await balanceOf(recipient)).toBe(START + 250);
    });

    it('conserves the total amount of money in play', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      await service.transfer(sender.id, recipient.username, 377, '', intentKey());

      expect(await balanceOf(sender) + await balanceOf(recipient)).toBe(START * 2);
    });

    it('writes one ledger row naming both wallets and carrying the memo', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      await service.transfer(sender.id, recipient.username, 120, 'happy birthday', intentKey());

      const rows = await ledgerRows(sender);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({
        amount: 120,
        reason: 'member-to-member',
        sender_wallet_id: sender.walletId,
        recipient_wallet_id: recipient.walletId,
        memo: 'happy birthday',
      }));
    });

    it('stores a missing memo as null rather than as an empty string', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      await service.transfer(sender.id, recipient.username, 10, '', intentKey());

      expect((await ledgerRows(sender))[0].memo).toBeNull();
    });

    it('files a receipt in each party inbox, naming the other party', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      await service.transfer(sender.id, recipient.username, 500, 'rent', intentKey());

      const sent = await inboxFor(sender);
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe('Receipt of funds sent');
      expect(sent[0].message).toContain(`${recipient.username} has been transferred 500cc`);
      expect(sent[0].message).toContain('reason : rent');

      const received = await inboxFor(recipient);
      expect(received).toHaveLength(1);
      expect(received[0].subject).toBe('Receipt of funds received');
      expect(received[0].message).toContain(`${sender.username} has transferred you 500cc`);
      expect(received[0].message).toContain('reason : rent');
    });

    it('omits the reason line from the receipts when no memo was given', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      await service.transfer(sender.id, recipient.username, 25, '', intentKey());

      expect((await inboxFor(sender))[0].message).not.toContain('reason :');
    });

    it('lets a citizen send their entire balance', async () => {
      // The original's server test was `>=`, so sending everything was allowed even though
      // its own form JavaScript used a strict `<` and refused it. The server rule wins.
      const sender = await createCitizen(400);
      const recipient = await createCitizen();

      const result = await service.transfer(sender.id, recipient.username, 400, '', intentKey());

      expect(result.success).toBe(true);
      expect(await balanceOf(sender)).toBe(0);
    });

    it('finds the recipient regardless of the case typed', async () => {
      // Historically the lookup key was `NNK`, a canonical lowercase nickname, and the form
      // lowercased the field before submitting. CTR gets the same behaviour from the
      // member table's utf8mb4_unicode_ci collation.
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const result = await service.transfer(
        sender.id,
        recipient.username.toUpperCase(),
        50,
        '',
        intentKey(),
      );

      expect(result.success).toBe(true);
      expect(await balanceOf(recipient)).toBe(START + 50);
    });
  });

  describe('the homestead rule', () => {
    it('refuses when the sender has no home, and moves nothing', async () => {
      const sender = await createHomeless();
      const recipient = await createCitizen();

      const result = await service.transfer(sender.id, recipient.username, 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-no-home' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await balanceOf(recipient)).toBe(START);
    });

    it('refuses when the recipient has no home, and moves nothing', async () => {
      const sender = await createCitizen();
      const recipient = await createHomeless();

      const result = await service.transfer(sender.id, recipient.username, 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-no-home' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await balanceOf(recipient)).toBe(START);
    });

    it('refuses when neither party has a home', async () => {
      const sender = await createHomeless();
      const recipient = await createHomeless();

      const result = await service.transfer(sender.id, recipient.username, 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-no-home' });
      expect(await balanceOf(sender)).toBe(START);
    });
  });

  describe('refusals leave the database untouched', () => {
    it('refuses more than the sender holds', async () => {
      const sender = await createCitizen(100);
      const recipient = await createCitizen();

      const result = await service.transfer(sender.id, recipient.username, 101, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'insufficient-funds' });
      expect(await balanceOf(sender)).toBe(100);
      expect(await balanceOf(recipient)).toBe(START);
      expect(await ledgerRows(sender)).toHaveLength(0);
      expect(await inboxFor(sender)).toHaveLength(0);
    });

    it('refuses a transfer to a citizen who does not exist', async () => {
      const sender = await createCitizen();

      const result = await service.transfer(sender.id, 'nobody-by-that-name', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-unknown' });
      expect(await balanceOf(sender)).toBe(START);
    });

    it('refuses a transfer to oneself', async () => {
      const sender = await createCitizen();

      const result = await service.transfer(sender.id, sender.username, 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'self-transfer' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await inboxFor(sender)).toHaveLength(0);
    });

    it('refuses a banned sender', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();
      await knex('member').where({ id: sender.id }).update({ status: 0 });

      const result = await service.transfer(sender.id, recipient.username, 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-banned' });
      expect(await balanceOf(sender)).toBe(START);
    });

    it.each([
      ['zero', 0],
      ['a negative amount', -50],
      ['a fractional amount', 10.5],
      ['a non-numeric amount', 'abc'],
      ['an amount with trailing junk', '10abc'],
    ])('refuses %s', async (_label, amount) => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const result = await service.transfer(sender.id, recipient.username, amount, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'invalid-amount' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await balanceOf(recipient)).toBe(START);
    });
  });

  describe('concurrency', () => {
    it('cannot be made to overspend by two transfers arriving together', async () => {
      // The original could: both requests read the same balance, both passed the
      // sufficiency test, and both wrote. Here the second blocks on the first's row lock
      // and re-reads the balance it actually left behind.
      const sender = await createCitizen(100);
      const first = await createCitizen();
      const second = await createCitizen();

      const results = await Promise.all([
        service.transfer(sender.id, first.username, 100, '', intentKey()),
        service.transfer(sender.id, second.username, 100, '', intentKey()),
      ]);

      const succeeded = results.filter(result => result.success);
      expect(succeeded).toHaveLength(1);
      expect(await balanceOf(sender)).toBe(0);
      expect(await balanceOf(first) + await balanceOf(second)).toBe(START * 2 + 100);
    });

    it('does not lose a credit when two senders pay the same recipient at once', async () => {
      const first = await createCitizen();
      const second = await createCitizen();
      const recipient = await createCitizen();

      await Promise.all([
        service.transfer(first.id, recipient.username, 300, '', intentKey()),
        service.transfer(second.id, recipient.username, 400, '', intentKey()),
      ]);

      expect(await balanceOf(recipient)).toBe(START + 700);
    });

    it('does not deadlock when two citizens transfer to each other simultaneously', async () => {
      // This is what the ascending-wallet-id lock order exists for. Locking "mine then
      // theirs" would have each transaction holding one row and waiting on the other.
      const left = await createCitizen();
      const right = await createCitizen();

      const results = await Promise.all([
        service.transfer(left.id, right.username, 100, 'ping', intentKey()),
        service.transfer(right.id, left.username, 100, 'pong', intentKey()),
      ]);

      expect(results.every(result => result.success)).toBe(true);
      expect(await balanceOf(left)).toBe(START);
      expect(await balanceOf(right)).toBe(START);
    });

    it('keeps money conserved under a burst of concurrent transfers', async () => {
      const sender = await createCitizen(1000);
      const recipient = await createCitizen();

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          service.transfer(sender.id, recipient.username, 200, '', intentKey())),
      );

      const paid = results.filter(result => result.success).length;
      expect(paid).toBe(5);
      expect(await balanceOf(sender)).toBe(1000 - paid * 200);
      expect(await balanceOf(recipient)).toBe(START + paid * 200);
      expect(await ledgerRows(sender)).toHaveLength(paid);
    });
  });

  describe('atomicity', () => {
    it('moves no money when a receipt cannot be written', async () => {
      // The failure the original tolerated: it committed the money, then filed the
      // receipts, and reported success either way -- its own log still carries rows reading
      // "Success but unable to inbox". Here a receipt is part of what a transfer IS.
      //
      // Driven through the repository rather than the service, because the service's own
      // checks make an unwritable receipt unreachable: the place id below cannot satisfy
      // `inbox.place_id`'s foreign key, so the second insert fails after the money and the
      // ledger row have already been written inside the transaction.
      const sender = await createCitizen();
      const recipient = await createCitizen();
      const recipientHome = await knex('place')
        .where({ type: 'home', member_id: recipient.id })
        .first();

      await expect(transferRepository.transfer({
        senderWalletId: sender.walletId,
        recipientWalletId: recipient.walletId,
        amount: 100,
        senderHomePlaceId: 2147483000,
        recipientHomePlaceId: recipientHome.id,
        senderMemberId: sender.id,
        recipientMemberId: recipient.id,
        senderUsername: sender.username,
        recipientUsername: recipient.username,
        memo: '',
        idempotencyKey: intentKey(),
      })).rejects.toThrow();

      expect(await balanceOf(sender)).toBe(START);
      expect(await balanceOf(recipient)).toBe(START);
      expect(await ledgerRows(sender)).toHaveLength(0);
      expect(await inboxFor(recipient)).toHaveLength(0);
    });

    it('leaves balances correct after a rejected transfer is followed by a valid one', async () => {
      const sender = await createCitizen(100);
      const recipient = await createCitizen();

      const rejected = await service.transfer(sender.id, recipient.username, 500, '', intentKey());
      const accepted = await service.transfer(
        sender.id, recipient.username, 60, 'second try', intentKey(),
      );

      expect(rejected.success).toBe(false);
      expect(accepted.success).toBe(true);
      expect(await balanceOf(sender)).toBe(40);
      expect(await balanceOf(recipient)).toBe(START + 60);
      expect(await ledgerRows(sender)).toHaveLength(1);
    });
  });

  /*
   * ----------------------------------------------------------------------------------------
   * DEF-06: recipient capacity is decided under the row lock, not before it.
   * ----------------------------------------------------------------------------------------
   *
   * `wallet.balance` is INT UNSIGNED, so a recipient cannot hold more than 4,294,967,295.
   * BankService checks that before opening the transaction, which is useful -- refusing early
   * is cheaper and clearer -- but that check reads an UNLOCKED balance, so it is only an
   * optimisation. Two senders can each pass it against the same pre-transfer balance and
   * together carry the recipient past the maximum.
   *
   * Independent QA reproduced exactly that: the second transfer reached the UPDATE, MySQL
   * raised ER_WARN_DATA_OUT_OF_RANGE, and the citizen got an HTTP 500 with a driver error
   * behind it. The authoritative check now happens inside TransferRepository against the
   * LOCKED row, and is written as a subtraction rather than an addition so the arithmetic
   * itself cannot leave the range JavaScript represents exactly.
   */
  describe('recipient capacity', () => {
    /** The largest value `wallet.balance` can hold: MySQL INT UNSIGNED. */
    const MAX_BALANCE = 4294967295;

    it('refuses a transfer that would carry the recipient past the maximum', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen(MAX_BALANCE - 50);

      const result = await service.transfer(
        sender.id, recipient.username, 100, '', intentKey(),
      );

      expect(result).toEqual({ success: false, refusal: 'recipient-balance-overflow' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await balanceOf(recipient)).toBe(MAX_BALANCE - 50);
    });

    it('allows a transfer that lands exactly on the maximum', async () => {
      // The boundary, in the direction that must still work. `balance > MAX - amount` is
      // false when the two are equal, so filling a wallet to the brim is permitted.
      const sender = await createCitizen();
      const recipient = await createCitizen(MAX_BALANCE - 100);

      const result = await service.transfer(
        sender.id, recipient.username, 100, '', intentKey(),
      );

      expect(result.success).toBe(true);
      expect(await balanceOf(recipient)).toBe(MAX_BALANCE);
    });

    it('lets exactly one of two concurrent transfers into a nearly-full wallet', async () => {
      // The race the unlocked pre-check cannot decide. Both senders see MAX - 100 and both
      // conclude 100 will fit. Only the one holding the lock is right.
      const first = await createCitizen();
      const second = await createCitizen();
      const recipient = await createCitizen(MAX_BALANCE - 100);

      const results = await Promise.all([
        service.transfer(first.id, recipient.username, 100, '', intentKey()),
        service.transfer(second.id, recipient.username, 100, '', intentKey()),
      ]);

      const succeeded = results.filter(result => result.success);
      const refused = results.filter(result => !result.success);
      expect(succeeded).toHaveLength(1);
      expect(refused).toHaveLength(1);

      // A clean business refusal, not a database error surfacing as one.
      expect(refused[0]).toEqual({ success: false, refusal: 'recipient-balance-overflow' });

      // The column's limit is never exceeded ...
      expect(await balanceOf(recipient)).toBe(MAX_BALANCE);
      // ... the winner paid exactly once, and the loser paid nothing at all.
      const balances = [await balanceOf(first), await balanceOf(second)]
        .sort((left, right) => left - right);
      expect(balances).toEqual([START - 100, START]);

      // And only the successful transfer left any trace.
      const ledger = [...await ledgerRows(first), ...await ledgerRows(second)];
      expect(ledger).toHaveLength(1);
      expect(await inboxFor(recipient)).toHaveLength(1);
    });

    it('refuses without a database error when eight senders race a full wallet', async () => {
      // Every one of these fails, and the failure must be the typed refusal rather than
      // ER_WARN_DATA_OUT_OF_RANGE escaping as a rejected promise.
      const senders = await Promise.all(Array.from({ length: 8 }, () => createCitizen()));
      const recipient = await createCitizen(MAX_BALANCE);

      const results = await Promise.allSettled(senders.map(sender =>
        service.transfer(sender.id, recipient.username, 100, '', intentKey())));

      expect(results.every(result => result.status === 'fulfilled')).toBe(true);
      for (const result of results) {
        expect((result as PromiseFulfilledResult<TransferResult>).value).toEqual({
          success: false, refusal: 'recipient-balance-overflow',
        });
      }
      expect(await balanceOf(recipient)).toBe(MAX_BALANCE);
    });

    it('refuses under the lock even when the pre-check was told nothing useful', async () => {
      // Straight at the repository, bypassing the service's pre-check entirely, to prove the
      // locked check stands on its own rather than relying on having been screened first.
      const sender = await createCitizen();
      const recipient = await createCitizen(MAX_BALANCE);
      const senderHome = await knex('place')
        .where({ type: 'home', member_id: sender.id }).first();
      const recipientHome = await knex('place')
        .where({ type: 'home', member_id: recipient.id }).first();

      const outcome = await transferRepository.transfer({
        senderWalletId: sender.walletId,
        recipientWalletId: recipient.walletId,
        amount: 1,
        senderHomePlaceId: senderHome.id,
        recipientHomePlaceId: recipientHome.id,
        senderMemberId: sender.id,
        recipientMemberId: recipient.id,
        senderUsername: sender.username,
        recipientUsername: recipient.username,
        memo: '',
        idempotencyKey: intentKey(),
      });

      expect(outcome).toEqual({ transferred: false, reason: 'recipient-balance-overflow' });
      expect(await balanceOf(sender)).toBe(START);
      expect(await balanceOf(recipient)).toBe(MAX_BALANCE);
    });
  });
});
