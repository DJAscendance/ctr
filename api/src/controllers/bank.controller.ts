import { Request, Response } from 'express';
import { Container } from 'typedi';

import { BankService, MemberService } from '../services';
import { TransferRefusal } from '../services/bank/bank.service';

/**
 * What the citizen is told when a transfer is refused.
 *
 * The wording is the Bank's own, from phase3.pl, kept because it is what citizens knew --
 * including phrasing that reads awkwardly today. What is NOT kept is its spelling: the
 * original wrote "insuffient" and "recieve", and both are corrected here. An earlier
 * revision of this lane preserved "insuffient" on fidelity grounds; that is the wrong
 * trade. A misspelling is not something citizens recognised, it is a defect they lived
 * with, and shipping a known typo into a money screen to simulate authenticity makes the
 * product look broken rather than historical. The literal originals are recorded in this
 * comment and in the lane report, which is where that fidelity belongs.
 *
 * Not restored: "you have been reported to security.", which the original showed for a
 * non-positive amount. Nothing was ever reported anywhere -- it was a bluff, and
 * reimplementing it either lies to the citizen or creates a security-report firehose from a
 * typo.
 *
 * The last two refusals have no historical counterpart -- the original Bank had no
 * idempotency concept at all -- so their wording is plain modern English rather than an
 * imitation of a sentence that never existed.
 */
const REFUSAL_MESSAGES: Record<TransferRefusal, string> = {
  'sender-no-home': 'Sorry you need to have a home in CT to use this function',
  'recipient-no-home':
    'Sorry your recipient needs to have a home in CT to be able to receive transfers',
  'insufficient-funds': 'You have insufficient funds to be able to complete that transfer.',
  'recipient-unknown': 'No Such Citizen!',
  'self-transfer': 'You cannot transfer CityCash to yourself.',
  'invalid-amount': 'Please enter a whole, positive amount of CityCash.',
  'recipient-balance-overflow':
    'That transfer would exceed the amount of CityCash an account can hold.',
  'sender-banned': 'Your account cannot make transfers at this time.',
  'sender-unknown': 'Account not found.',
  'idempotency-key-required':
    'This transfer could not be identified. Please close the console and try again.',
  'idempotency-conflict':
    'That transfer reference has already been used for a different transfer.',
};

/**
 * HTTP status for a refusal, where it is not the default 400.
 *
 * 400 for everything a citizen can fix by changing what they submitted, which is every
 * restored refusal. 409 for the idempotency conflict, because that one says nothing about
 * the transfer's terms -- it says the key names an operation that already exists, which is
 * what 409 is for, and an API client that retries on 400 would otherwise loop.
 */
const REFUSAL_STATUS: Partial<Record<TransferRefusal, number>> = {
  'idempotency-conflict': 409,
};

/**
 * Header naming the transfer INTENT, so a retry of one intent moves money once.
 *
 * The standard `Idempotency-Key` rather than a field inside the historical form, so the
 * infrastructure concern stays out of the restored payload -- the body carries what the
 * citizen typed and nothing else.
 */
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** The Cybertown Bank -- citizen-to-citizen CityCash transfer. */
class BankController {
  constructor(
    private memberService: MemberService,
    private bankService: BankService,
  ) {}

  /**
   * The Bank console's opening screen: who the citizen is, what they hold, and whether they
   * are allowed to send at all.
   */
  public async getAccount(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    try {
      const account = await this.bankService.getAccount(session.id);
      response.status(200).json({ status: 'success', account });
    } catch (error) {
      console.error(error);
      response.status(400).json({ error: error.message });
    }
  }

  /**
   * Performs a transfer.
   *
   * The sender is taken from the session and from nowhere else. The body supplies only the
   * recipient, the amount and the reason -- never any field naming the account to debit.
   * The original Bank's executor read the sender from its own form input and ignored the
   * session ticket it was handed, which meant the form was the authorization.
   *
   * The intent is named by the `Idempotency-Key` header, which the console generates once
   * per transfer and reuses across retries of that transfer. Its absence is a refusal, not a
   * default: a server-invented key would differ on every request and so would make every
   * retry look like a fresh transfer, which is the failure it exists to prevent.
   */
  public async transfer(request: Request, response: Response): Promise<void> {
    const session = this.memberService.decryptSession(request, response);
    if (!session) return;

    const { recipient, amount, memo } = request.body;
    const idempotencyKey = request.get(IDEMPOTENCY_KEY_HEADER);

    try {
      const result = await this.bankService.transfer(
        session.id,
        recipient,
        amount,
        memo,
        idempotencyKey,
      );

      if (!result.success) {
        // A refusal is a normal outcome of using the Bank, not a server fault, so it is
        // reported as the citizen-facing sentence and nothing else -- no SQL, no table
        // names, no driver error object.
        const status = REFUSAL_STATUS[result.refusal] ?? 400;
        response.status(status).json({ error: REFUSAL_MESSAGES[result.refusal] });
        return;
      }

      // A replayed transfer answers exactly like the original did. The citizen retried
      // something that had already worked; telling them so would be describing our own
      // plumbing, and any difference in this shape would give a client a reason to treat
      // the two differently when the entire point is that they are the same outcome.
      response.status(200).json({
        status: 'success',
        balance: result.balance,
        recipient: result.recipient,
        amount: result.amount,
      });
    } catch (error) {
      console.error(error);
      response.status(500).json({
        error: 'There has been a problem during this transfer.',
      });
    }
  }
}

const memberService = Container.get(MemberService);
const bankService = Container.get(BankService);
export const bankController = new BankController(memberService, bankService);
