import { Service } from 'typedi';

import {
  MemberRepository,
  PlaceRepository,
  TransferRepository,
  WalletRepository,
} from '../../repositories';
import { MAX_WALLET_BALANCE } from '../../repositories/transfer/transfer.repository';
import { Member, Transaction, TransactionReason } from '../../types/models';

/**
 * Longest reason a citizen may attach to a transfer.
 *
 * The original Bank's own limit: `<input type="text" name="TO_NAM" size="16"
 * maxlength="30">` in colonycity/templates/bank/phase1.tmpl. Enforced here as well as in
 * the form, because an HTML attribute is a convenience, not a constraint.
 *
 * (Cross-reference note: `TO_REA` is the FUNDBOX reason field. In the Bank, `TO_NAM` is the
 * reason; in Fundbox `TO_NAM` means the recipient place's name. Same limit either way.)
 */
export const MEMO_MAX_LENGTH = 30;

/**
 * Largest value `wallet.balance` can hold.
 *
 * Re-exported from TransferRepository, which is where it is now declared and where the
 * AUTHORITATIVE check lives -- under the recipient's row lock. The pre-check in this service
 * reads an unlocked balance, so it can only ever be an optimisation: two senders can each
 * pass it and together carry a recipient past the maximum. Kept because a refusal decided
 * before any transaction opens is cheaper and clearer than one decided inside a rollback.
 */
export { MAX_WALLET_BALANCE };

/**
 * Bounds on the idempotency key a client must name each transfer intent with.
 *
 * Wide enough for a canonical v4 UUID (36 characters), which is what the Bank console sends,
 * without mandating that exact format -- an API caller may use any opaque token it can
 * generate uniquely. Narrow enough that the column, and the unique index on it, are bounded.
 */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 64;

/**
 * Characters an idempotency key may contain: URL-safe base64's alphabet, which covers UUIDs.
 *
 * Restricted rather than free-form because this value arrives in a header, is stored, and is
 * compared -- keeping it to an unambiguous alphabet removes every question about whitespace,
 * case folding and encoding from a value whose whole job is to be compared exactly.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Why a transfer was refused. Maps one-to-one onto a message the citizen is shown. */
export type TransferRefusal =
  | 'sender-unknown'
  | 'sender-banned'
  | 'recipient-unknown'
  | 'self-transfer'
  | 'invalid-amount'
  | 'sender-no-home'
  | 'recipient-no-home'
  | 'insufficient-funds'
  | 'recipient-balance-overflow'
  | 'idempotency-key-required'
  | 'idempotency-conflict';

/** The outcome of a transfer attempt, as the controller reports it. */
export interface TransferResult {
  /** Whether the money moved. */
  success: boolean;
  /** Why not, when it did not. */
  refusal?: TransferRefusal;
  /** Sender's balance afterwards. Only on success. */
  balance?: number;
  /** Recipient's display name as stored, for echoing back. Only on success. */
  recipient?: string;
  /** Amount moved. Only on success. */
  amount?: number;
  /**
   * True when this response reports a transfer an EARLIER request already committed, rather
   * than one this request made. The citizen sees the same success either way -- that is the
   * point of idempotency -- but the distinction matters to tests and to anything counting
   * money movements.
   */
  replayed?: boolean;
}

/** What the Bank console needs to render its entry screen. */
export interface BankAccountView {
  /** The citizen's display name. */
  username: string;
  /** Their current CityCash balance. */
  balance: number;
  /**
   * Whether this citizen may send a transfer at all -- i.e. whether they have a home.
   * The console uses it to explain the restriction up front instead of only on submit.
   */
  canTransfer: boolean;
}

/**
 * The Cybertown Bank: citizen-to-citizen CityCash transfer.
 *
 * This is the whole of the historical Bank. It was never savings, interest, loans, deposits
 * or statements -- the surviving source and the surviving transfer log describe exactly one
 * operation, one citizen sending another citizen money with a short reason attached.
 *
 * Every rule below is enforced here, on the server, because the original enforced almost
 * none of them there. Its transfer executor took the sender's identity, and both parties'
 * home ids, from hidden fields in the submitted form, and never checked the session ticket
 * it was passed -- so the "do both parties have a home" test could be satisfied by anyone
 * willing to edit the request. See TransferRepository for the rest of what was not ported.
 */
@Service()
export class BankService {
  constructor(
    private memberRepository: MemberRepository,
    private placeRepository: PlaceRepository,
    private transferRepository: TransferRepository,
    private walletRepository: WalletRepository,
  ) {}

  /**
   * Builds the Bank console's opening screen for the authenticated citizen.
   * @param memberId id of the citizen at the console
   */
  public async getAccount(memberId: number): Promise<BankAccountView> {
    const member = await this.memberRepository.findById(memberId);
    if (!member) throw new Error('Account not found.');

    const wallet = await this.walletRepository.findById(member.wallet_id);
    const homes = await this.placeRepository.findHomePlaceIdsByMemberIds([memberId]);

    return {
      username: member.username,
      balance: wallet ? wallet.balance : 0,
      canTransfer: homes.has(memberId),
    };
  }

  /**
   * Validates and performs a citizen-to-citizen CityCash transfer.
   *
   * @param senderId id of the SENDING member, which must come from the authenticated
   * session. Never accept this from the request body: doing so is what made the original a
   * confused deputy, able to debit any account the caller could name.
   * @param recipientUsername the name typed into the console
   * @param rawAmount the amount as submitted, before validation
   * @param rawMemo the reason as submitted, before trimming and capping
   * @param rawIdempotencyKey the `Idempotency-Key` header naming this transfer INTENT. One
   * key per intent: a retry of the same intent reuses it and moves money once; a deliberate
   * second transfer of the same amount to the same citizen uses a new one and is honoured.
   */
  public async transfer(
    senderId: number,
    recipientUsername: string,
    rawAmount: unknown,
    rawMemo: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<TransferResult> {
    // Demanded before anything is read, because it is the only rule whose absence means the
    // request cannot be made safe at all: without a key there is no way to tell a retry from
    // a second transfer, and the endpoint would be back to paying twice for one intent.
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);
    if (idempotencyKey === null) {
      return { success: false, refusal: 'idempotency-key-required' };
    }

    const sender = await this.memberRepository.findById(senderId);
    if (!sender) return { success: false, refusal: 'sender-unknown' };
    // A banned account keeps its money but cannot move it. status 0 is the ban state that
    // login itself refuses on, checked again here because a session issued before the ban
    // is still cryptographically valid.
    if (sender.status === 0) return { success: false, refusal: 'sender-banned' };

    const amount = this.parseAmount(rawAmount);
    if (amount === null) return { success: false, refusal: 'invalid-amount' };

    const name = typeof recipientUsername === 'string' ? recipientUsername.trim() : '';
    if (!name) return { success: false, refusal: 'recipient-unknown' };

    // Case-insensitive by virtue of the column's utf8mb4_unicode_ci collation, which
    // matches the original's behaviour: it looked citizens up by `NNK`, a canonical
    // lowercase key, and its own form lowercased the field before submitting. Doing this
    // with LOWER() in SQL instead would give the same answer while defeating the index.
    const recipient = await this.memberRepository.find({ username: name });
    if (!recipient) return { success: false, refusal: 'recipient-unknown' };

    const memo = this.normalizeMemo(rawMemo);

    // Answered here, BEFORE the remaining rules, because a retry must succeed even if the
    // world has moved on since the original committed -- the recipient may have given up
    // their home, or the sender may have spent the money since. Those would refuse a NEW
    // transfer, and rightly; refusing a retry on them would tell a citizen their completed
    // transfer had failed. This lookup is not what PREVENTS a double transfer: the unique
    // index is. See TransferRepository.
    const replay = await this.replayCommittedTransfer(
      idempotencyKey, sender, recipient, amount, memo,
    );
    if (replay) return replay;

    if (recipient.id === sender.id) return { success: false, refusal: 'self-transfer' };

    // Both parties, one query. The historical rule -- and in CTR also a structural
    // requirement, since a receipt has nowhere to be filed for a member without a home.
    const homes = await this.placeRepository.findHomePlaceIdsByMemberIds([
      sender.id,
      recipient.id,
    ]);
    const senderHomePlaceId = homes.get(sender.id);
    const recipientHomePlaceId = homes.get(recipient.id);
    if (senderHomePlaceId === undefined) {
      return { success: false, refusal: 'sender-no-home' };
    }
    if (recipientHomePlaceId === undefined) {
      return { success: false, refusal: 'recipient-no-home' };
    }

    const recipientWallet = await this.walletRepository.findById(recipient.wallet_id);
    if (!recipientWallet) return { success: false, refusal: 'recipient-unknown' };
    // An optimisation only: this balance is not locked, so two senders can each pass this
    // and together carry the recipient past the maximum. The authoritative check is the one
    // TransferRepository makes against the LOCKED row. Kept because refusing before any
    // transaction opens is cheaper and clearer than refusing inside a rollback.
    if (recipientWallet.balance > MAX_WALLET_BALANCE - amount) {
      return { success: false, refusal: 'recipient-balance-overflow' };
    }

    const outcome = await this.transferRepository.transfer({
      senderWalletId: sender.wallet_id,
      recipientWalletId: recipient.wallet_id,
      amount,
      senderHomePlaceId,
      recipientHomePlaceId,
      senderMemberId: sender.id,
      recipientMemberId: recipient.id,
      senderUsername: sender.username,
      recipientUsername: recipient.username,
      memo,
      idempotencyKey,
    });

    if (!outcome.transferred) {
      // A concurrent request carrying the same key won the unique index while this one was
      // in flight; this transaction rolled back whole. Read the committed original and
      // report it, which is the same answer the loser would have got had it arrived a
      // moment later and taken the fast path above.
      if (outcome.reason === 'duplicate-intent') {
        const raced = await this.replayCommittedTransfer(
          idempotencyKey, sender, recipient, amount, memo,
        );
        // `raced` is only null if the winning row vanished between the failed insert and
        // this read, which nothing in CTR does. Reported as a conflict rather than as a
        // success nobody can point at.
        return raced ?? { success: false, refusal: 'idempotency-conflict' };
      }
      return { success: false, refusal: outcome.reason };
    }

    return {
      success: true,
      balance: outcome.senderBalance,
      recipient: recipient.username,
      amount,
    };
  }

  /**
   * Answers a request whose idempotency key has already committed a transfer.
   *
   * Three outcomes:
   *
   *   - the key has never committed        -> null, and the caller proceeds normally;
   *   - the key committed THIS operation   -> the original success, reported again;
   *   - the key committed a DIFFERENT one  -> a conflict.
   *
   * The comparison is what separates "my request was retried" from "my key was reused for
   * something else". Every field that identifies the operation is compared: both parties,
   * the amount, the memo and the reason. A key that names a transfer between other people,
   * or for another amount, is not this request, and honouring it would report a stranger's
   * transfer as this citizen's own.
   *
   * A conflict is reported WITHOUT any detail of the committed row. When the senders differ
   * that is the whole point -- the response must not become a way to read another citizen's
   * transfer history one guessed key at a time.
   *
   * The balance reported on a replay is the sender's CURRENT balance, re-read now, not the
   * balance at the moment the original committed. The original's is not stored -- only the
   * movement is -- and current truth is the more useful of the two answers to a console that
   * is about to display it.
   */
  private async replayCommittedTransfer(
    idempotencyKey: string,
    sender: Member,
    recipient: Member,
    amount: number,
    memo: string,
  ): Promise<TransferResult | null> {
    const committed = await this.transferRepository.findByIdempotencyKey(idempotencyKey);
    if (!committed) return null;

    if (!this.describesSameTransfer(committed, sender, recipient, amount, memo)) {
      return { success: false, refusal: 'idempotency-conflict' };
    }

    const wallet = await this.walletRepository.findById(sender.wallet_id);
    return {
      success: true,
      balance: wallet ? wallet.balance : undefined,
      recipient: recipient.username,
      amount,
      replayed: true,
    };
  }

  /**
   * Whether a committed ledger row is the same operation this request is asking for.
   *
   * `memo` is compared against the NORMALIZED form, which is what was stored, so a retry
   * that differs only in trailing whitespace is still recognised as the same intent.
   * The ledger stores an absent memo as NULL and the service represents it as '', so the
   * two are reconciled here rather than in either of them.
   */
  private describesSameTransfer(
    committed: Transaction,
    sender: Member,
    recipient: Member,
    amount: number,
    memo: string,
  ): boolean {
    return committed.reason === TransactionReason.MemberToMember
      && committed.sender_wallet_id === sender.wallet_id
      && committed.recipient_wallet_id === recipient.wallet_id
      && committed.amount === amount
      && (committed.memo ?? '') === memo;
  }

  /**
   * Validates the `Idempotency-Key` header, returning it in the exact form that will be
   * stored and compared, or null if it is unusable.
   *
   * Not generated server-side when absent, which would defeat the purpose entirely: a key
   * the server invents is different on every request, so every retry would look like a new
   * transfer. Naming the intent is the CLIENT's job, because only the client knows which
   * requests are the same intent.
   *
   * No trimming, no case folding: the key is compared byte-for-byte against a unique index,
   * so quietly rewriting it here would make two keys the client considers different collide,
   * or two it considers identical diverge.
   */
  private normalizeIdempotencyKey(rawKey: unknown): string | null {
    if (typeof rawKey !== 'string') return null;
    if (rawKey.length < IDEMPOTENCY_KEY_MIN_LENGTH) return null;
    if (rawKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) return null;
    if (!IDEMPOTENCY_KEY_PATTERN.test(rawKey)) return null;
    return rawKey;
  }

  /**
   * Turns whatever arrived in the request into a whole positive number of CityCash, or null
   * if it is not one.
   *
   * Deliberately strict where the original was not. `phase3.pl` never parsed the amount at
   * all -- it fed the raw string straight into Perl's numeric comparisons, so "10abc"
   * transferred 10 and "abc" transferred 0, and the only thing standing between a citizen
   * and a fractional or malformed amount was an `isNaN` check in the browser.
   *
   * Rejects: empty, non-numeric, NaN, Infinity, negative, zero, fractional, and anything
   * beyond the range JavaScript can represent exactly -- past MAX_SAFE_INTEGER the
   * arithmetic that decides whether someone can afford a transfer stops being reliable.
   */
  private parseAmount(rawAmount: unknown): number | null {
    if (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') return null;
    // Number('') is 0 and Number(' ') is 0, so an empty field would otherwise read as a
    // zero amount rather than as no amount.
    if (typeof rawAmount === 'string' && rawAmount.trim() === '') return null;

    const amount = Number(rawAmount);
    if (!Number.isFinite(amount)) return null;
    if (!Number.isInteger(amount)) return null;
    if (amount <= 0) return null;
    if (amount > Number.MAX_SAFE_INTEGER) return null;
    return amount;
  }

  /**
   * Trims the reason and caps it at the historical 30 characters.
   *
   * Trimming and capping ONLY. The memo is stored in the ledger exactly as the citizen typed
   * it, so a memo of `5 < 10` reads back as `5 < 10`, and a memo containing an angle bracket
   * is a financial record of what they wrote rather than an encoded version of it.
   *
   * It is NOT sanitised or escaped here, and that is a deliberate placement rather than an
   * omission. Escaping belongs at the sink -- TransferRepository escapes it on its way into
   * `inbox.message`, which the SPA renders with `v-html`. An earlier revision of this lane
   * argued the memo was safe because it was "stored and rendered as plain text"; independent
   * QA disproved the second half of that claim, and the fix is to escape where the HTML is
   * built, not to corrupt the stored record. See libs/html.ts.
   *
   * Also deliberately not passed through InboxService.sanitize: that is an allowlist which
   * PERMITS tags -- anchors, bold, even marquee -- which is right for a message one citizen
   * writes to another and wrong for a system-generated receipt whose only variable parts are
   * plain text.
   */
  private normalizeMemo(rawMemo: unknown): string {
    if (typeof rawMemo !== 'string') return '';
    return rawMemo.trim().slice(0, MEMO_MAX_LENGTH);
  }
}
