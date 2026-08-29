import { createSpyObj } from 'jest-createspyobj';
import { Container } from 'typedi';

import { BankService, MAX_WALLET_BALANCE } from './bank.service';
import { intentKey } from '@spec/integration-db';
import {
  MemberRepository,
  PlaceRepository,
  TransferRepository,
  WalletRepository,
} from '../../repositories';

/**
 * The Bank's rules, in isolation from the database.
 *
 * Everything here is about REFUSAL: which requests never reach the money-moving transaction
 * at all, and why. The transaction itself -- atomicity, lock order, what the balances
 * actually end up being -- cannot be answered by mocks and is covered by
 * transfer.integration.spec.ts against a real MySQL.
 *
 * The single most important assertion in this file is the negative one repeated throughout:
 * `expect(transferRepository.transfer).not.toHaveBeenCalled()`. A rule that returns the
 * right error message while still moving money is not a rule.
 */
describe('BankService', () => {
  const SENDER_ID = 11;
  const RECIPIENT_ID = 22;
  const SENDER_WALLET = 101;
  const RECIPIENT_WALLET = 202;
  const SENDER_HOME = 1001;
  const RECIPIENT_HOME = 2002;

  let memberRepository: jest.Mocked<MemberRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let transferRepository: jest.Mocked<TransferRepository>;
  let walletRepository: jest.Mocked<WalletRepository>;
  let service: BankService;

  const sender = {
    id: SENDER_ID,
    username: 'Sender',
    wallet_id: SENDER_WALLET,
    status: 1,
  };
  const recipient = {
    id: RECIPIENT_ID,
    username: 'Recipient',
    wallet_id: RECIPIENT_WALLET,
    status: 1,
  };

  /** Both parties homesteaded -- the ordinary case. */
  function bothHomesteaded(): Map<number, number> {
    return new Map([[SENDER_ID, SENDER_HOME], [RECIPIENT_ID, RECIPIENT_HOME]]);
  }

  beforeEach(() => {
    memberRepository = createSpyObj(MemberRepository);
    placeRepository = createSpyObj(PlaceRepository);
    transferRepository = createSpyObj(TransferRepository);
    walletRepository = createSpyObj(WalletRepository);

    memberRepository.findById.mockResolvedValue(sender as never);
    memberRepository.find.mockResolvedValue(recipient as never);
    placeRepository.findHomePlaceIdsByMemberIds.mockResolvedValue(bothHomesteaded());
    walletRepository.findById.mockResolvedValue({ id: RECIPIENT_WALLET, balance: 500 } as never);
    // No transfer has ever committed under the key a test supplies, unless that test says
    // otherwise. Left explicit rather than relying on an auto-mock returning undefined,
    // because the whole idempotency path hinges on what this returns.
    transferRepository.findByIdempotencyKey.mockResolvedValue(undefined);
    transferRepository.transfer.mockResolvedValue({
      transferred: true,
      senderBalance: 900,
      recipientBalance: 600,
      transactionId: 7,
    });

    Container.reset();
    Container.set(MemberRepository, memberRepository);
    Container.set(PlaceRepository, placeRepository);
    Container.set(TransferRepository, transferRepository);
    Container.set(WalletRepository, walletRepository);
    service = Container.get(BankService);
  });

  describe('a valid transfer', () => {
    it('moves the money and reports the sender their new balance', async () => {
      const result = await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(result).toEqual({
        success: true,
        balance: 900,
        recipient: 'Recipient',
        amount: 100,
      });
    });

    it('debits the wallet of the AUTHENTICATED sender, not one named in the request', async () => {
      await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(transferRepository.transfer).toHaveBeenCalledWith(
        expect.objectContaining({
          senderWalletId: SENDER_WALLET,
          recipientWalletId: RECIPIENT_WALLET,
          senderMemberId: SENDER_ID,
          amount: 100,
        }),
      );
    });

    it('files each receipt at its own owner home', async () => {
      await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(transferRepository.transfer).toHaveBeenCalledWith(
        expect.objectContaining({
          senderHomePlaceId: SENDER_HOME,
          recipientHomePlaceId: RECIPIENT_HOME,
        }),
      );
    });

    it('asks about both parties homes in one query', async () => {
      await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(placeRepository.findHomePlaceIdsByMemberIds)
        .toHaveBeenCalledWith([SENDER_ID, RECIPIENT_ID]);
    });
  });

  describe('the memo', () => {
    it('caps at the historical 30 characters', async () => {
      await service.transfer(SENDER_ID, 'Recipient', 100, 'x'.repeat(45), intentKey());

      expect(transferRepository.transfer)
        .toHaveBeenCalledWith(expect.objectContaining({ memo: 'x'.repeat(30) }));
    });

    it('is trimmed', async () => {
      await service.transfer(SENDER_ID, 'Recipient', 100, '   happy birthday   ', intentKey());

      expect(transferRepository.transfer)
        .toHaveBeenCalledWith(expect.objectContaining({ memo: 'happy birthday' }));
    });

    it('is optional', async () => {
      const result = await service.transfer(SENDER_ID, 'Recipient', 100, undefined, intentKey());

      expect(result.success).toBe(true);
      expect(transferRepository.transfer)
        .toHaveBeenCalledWith(expect.objectContaining({ memo: '' }));
    });

    it('keeps markup as literal text rather than stripping or interpreting it', async () => {
      // Stored as typed; it is rendered as plain text, so there is nothing to sanitise
      // away and nothing that can execute.
      await service.transfer(SENDER_ID, 'Recipient', 100, '<script>x</script>', intentKey());

      expect(transferRepository.transfer)
        .toHaveBeenCalledWith(expect.objectContaining({ memo: '<script>x</script>' }));
    });
  });

  describe('the homestead rule', () => {
    it('refuses when the sender has no home', async () => {
      placeRepository.findHomePlaceIdsByMemberIds
        .mockResolvedValue(new Map([[RECIPIENT_ID, RECIPIENT_HOME]]));

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-no-home' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('refuses when the recipient has no home', async () => {
      placeRepository.findHomePlaceIdsByMemberIds
        .mockResolvedValue(new Map([[SENDER_ID, SENDER_HOME]]));

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-no-home' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('refuses when neither has a home, naming the sender first', async () => {
      placeRepository.findHomePlaceIdsByMemberIds.mockResolvedValue(new Map());

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-no-home' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });
  });

  describe('the parties', () => {
    it('refuses an unknown sender', async () => {
      memberRepository.findById.mockResolvedValue(undefined as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-unknown' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('refuses a banned sender even with a still-valid session', async () => {
      memberRepository.findById.mockResolvedValue({ ...sender, status: 0 } as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'sender-banned' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('refuses an unknown recipient', async () => {
      memberRepository.find.mockResolvedValue(undefined as never);

      const result = await service.transfer(SENDER_ID, 'Nobody', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-unknown' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('refuses an empty recipient without querying for one', async () => {
      const result = await service.transfer(SENDER_ID, '   ', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-unknown' });
      expect(memberRepository.find).not.toHaveBeenCalled();
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('refuses a transfer to oneself', async () => {
      // The original had no such guard: a citizen could send themselves money, which was
      // harmless but produced two receipts and a ledger row describing nothing.
      memberRepository.find.mockResolvedValue(sender as never);

      const result = await service.transfer(SENDER_ID, 'Sender', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'self-transfer' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('looks the recipient up by the name as typed, trimmed', async () => {
      await service.transfer(SENDER_ID, '  Recipient  ', 100, '', intentKey());

      expect(memberRepository.find).toHaveBeenCalledWith({ username: 'Recipient' });
    });
  });

  describe('the amount', () => {
    // The original parsed nothing: it fed the raw string to Perl's numeric coercion, so
    // '10abc' transferred 10 and 'abc' transferred 0.
    const rejected: Array<[string, unknown]> = [
      ['zero', 0],
      ['a negative number', -100],
      ['a fraction', 10.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a non-numeric string', 'abc'],
      ['a number with trailing junk', '10abc'],
      ['an empty string', ''],
      ['whitespace', '   '],
      ['null', null],
      ['an object', {}],
      ['an array', [10]],
      ['a value past MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER + 2],
    ];

    it.each(rejected)('refuses %s', async (_label, amount) => {
      const result = await service.transfer(SENDER_ID, 'Recipient', amount, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'invalid-amount' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('accepts a numeric string, as the form submits', async () => {
      const result = await service.transfer(SENDER_ID, 'Recipient', '250', '', intentKey());

      expect(result.success).toBe(true);
      expect(transferRepository.transfer)
        .toHaveBeenCalledWith(expect.objectContaining({ amount: 250 }));
    });

    it('refuses an amount that would overflow the recipient wallet column', async () => {
      walletRepository.findById
        .mockResolvedValue({ id: RECIPIENT_WALLET, balance: MAX_WALLET_BALANCE - 5 } as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 10, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-balance-overflow' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('allows a transfer that exactly fills the recipient wallet column', async () => {
      walletRepository.findById
        .mockResolvedValue({ id: RECIPIENT_WALLET, balance: MAX_WALLET_BALANCE - 10 } as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 10, '', intentKey());

      expect(result.success).toBe(true);
    });
  });

  describe('insufficient funds', () => {
    it('reports the refusal the transaction came back with', async () => {
      // Affordability is decided inside the transaction, under the row lock -- never here,
      // where the answer would already be stale by the time the money moved.
      transferRepository.transfer
        .mockResolvedValue({ transferred: false, reason: 'insufficient-funds' });

      const result = await service.transfer(SENDER_ID, 'Recipient', 5000, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'insufficient-funds' });
    });
  });

  describe('getAccount', () => {
    it('reports the balance and that a homesteaded citizen may transfer', async () => {
      placeRepository.findHomePlaceIdsByMemberIds
        .mockResolvedValue(new Map([[SENDER_ID, SENDER_HOME]]));
      walletRepository.findById
        .mockResolvedValue({ id: SENDER_WALLET, balance: 1234 } as never);

      const account = await service.getAccount(SENDER_ID);

      expect(account).toEqual({ username: 'Sender', balance: 1234, canTransfer: true });
    });

    it('reports that a citizen with no home may not transfer', async () => {
      placeRepository.findHomePlaceIdsByMemberIds.mockResolvedValue(new Map());
      walletRepository.findById
        .mockResolvedValue({ id: SENDER_WALLET, balance: 1234 } as never);

      const account = await service.getAccount(SENDER_ID);

      expect(account.canTransfer).toBe(false);
    });
  });

  describe('the idempotency key', () => {
    /*
     * The key is validated before anything else is read, and its absence is a refusal rather
     * than a shrug. A server-generated fallback would be worse than nothing: it differs on
     * every request, so every retry would look like a new transfer and the endpoint would be
     * back to paying twice for one intent -- which is the defect this exists to prevent.
     *
     * As everywhere else in this file, the assertion that matters is the negative one.
     */
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['too short', 'abc'],
      ['too long', 'k'.repeat(65)],
      ['containing a space', 'has a space'],
      ['containing punctuation', 'has.dots'],
      ['not a string', 42],
    ])('refuses a %s key and never reaches the transfer', async (_label, key) => {
      const result = await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', key);

      expect(result).toEqual({ success: false, refusal: 'idempotency-key-required' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('passes a valid key through to the transfer', async () => {
      await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', 'abcdefgh-1234');

      expect(transferRepository.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'abcdefgh-1234' }),
      );
    });

    it('does not rewrite the key it was given', async () => {
      // Compared byte-for-byte against a unique index, so trimming or case-folding it here
      // would make two keys the client considers different collide, or two it considers the
      // same diverge.
      await service.transfer(SENDER_ID, 'Recipient', 100, '', 'MixedCase-Key_1');

      expect(transferRepository.transfer).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'MixedCase-Key_1' }),
      );
    });

    it('replays a committed transfer instead of making a second one', async () => {
      transferRepository.findByIdempotencyKey.mockResolvedValue({
        id: 7,
        amount: 100,
        reason: 'member-to-member',
        sender_wallet_id: SENDER_WALLET,
        recipient_wallet_id: RECIPIENT_WALLET,
        memo: 'thanks',
      } as never);
      walletRepository.findById
        .mockResolvedValue({ id: SENDER_WALLET, balance: 900 } as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(result).toEqual({
        success: true,
        balance: 900,
        recipient: 'Recipient',
        amount: 100,
        replayed: true,
      });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it.each([
      ['a different amount', { amount: 250 }],
      ['a different recipient', { recipient_wallet_id: 999 }],
      ['a different memo', { memo: 'something else' }],
      ['a different sender', { sender_wallet_id: 999 }],
      ['a different reason', { reason: 'home-purchase' }],
    ])('refuses a key already committed with %s', async (_label, difference) => {
      transferRepository.findByIdempotencyKey.mockResolvedValue({
        id: 7,
        amount: 100,
        reason: 'member-to-member',
        sender_wallet_id: SENDER_WALLET,
        recipient_wallet_id: RECIPIENT_WALLET,
        memo: 'thanks',
        ...difference,
      } as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(result).toEqual({ success: false, refusal: 'idempotency-conflict' });
      expect(transferRepository.transfer).not.toHaveBeenCalled();
    });

    it('reads the committed transfer when the insert loses the unique-index race', async () => {
      // The concurrent duplicate: this request reached the insert and the index rejected it,
      // so its whole transaction rolled back. The committed original is then reported, which
      // is the same answer it would have got had it arrived a moment later.
      transferRepository.transfer.mockResolvedValue({
        transferred: false, reason: 'duplicate-intent',
      });
      transferRepository.findByIdempotencyKey
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          id: 7,
          amount: 100,
          reason: 'member-to-member',
          sender_wallet_id: SENDER_WALLET,
          recipient_wallet_id: RECIPIENT_WALLET,
          memo: 'thanks',
        } as never);
      walletRepository.findById
        .mockResolvedValue({ id: SENDER_WALLET, balance: 900 } as never);

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, 'thanks', intentKey());

      expect(result).toMatchObject({ success: true, replayed: true, amount: 100 });
    });

    it('reports the repository refusal it was actually given', async () => {
      // Every non-duplicate refusal from the transaction is passed through as itself. An
      // earlier revision reported all of them as 'insufficient-funds', which would have
      // shown a citizen the wrong reason for an overflow.
      transferRepository.transfer.mockResolvedValue({
        transferred: false, reason: 'recipient-balance-overflow',
      });

      const result = await service.transfer(SENDER_ID, 'Recipient', 100, '', intentKey());

      expect(result).toEqual({ success: false, refusal: 'recipient-balance-overflow' });
    });
  });
});
