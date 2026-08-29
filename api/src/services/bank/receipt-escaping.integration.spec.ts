import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { BankService } from './bank.service';
import {
  cleanUpFixtures,
  createHome,
  createMember,
  describeWithDb,
  fixtureName,
  intentKey,
  MemberFixture,
} from '@spec/integration-db';

/**
 * DEF-04: a Bank transfer memo cannot inject markup into either party's Inbox receipt.
 *
 * `spa/src/pages/Inbox.vue` renders a message body with `v-html`. Anything reaching
 * `inbox.message` is therefore parsed as HTML when a citizen opens it, and a transfer memo
 * is text the SENDER types which is filed into the RECIPIENT's inbox and rendered later --
 * stored XSS by construction if it arrives raw. Independent QA demonstrated
 * `<img src=x onerror=...>` executing on open.
 *
 * Two properties are asserted throughout, and they pull in opposite directions, which is the
 * whole reason this file exists:
 *
 *   1. `inbox.message` -- the HTML sink -- contains the memo ESCAPED. No bracket, no quote,
 *      nothing that can open a tag or close an attribute;
 *   2. `transaction.memo` -- the financial record -- contains the citizen's LITERAL text. A
 *      memo of `5 < 10` reads back as `5 < 10`, not `5 &lt; 10`.
 *
 * Escaping the ledger instead of the markup would satisfy the first and break the second,
 * and would double-escape the moment anything but this renderer consumed it.
 */
describeWithDb('Bank receipt escaping (real database)', () => {
  const knex = Container.get(Db).knex;
  const service = Container.get(BankService);

  const START = 1000;

  /** The payloads QA used, plus the ordinary punctuation that must survive them. */
  const MEMOS = {
    script: '<script>alert(1)</script>',
    image: '<img src=x onerror=alert(1)>',
    svg: '<svg onload=alert(1)>',
    bold: '<b>bold</b>',
    comparison: '5 < 10',
    ampersand: 'Tom & Jerry',
    quotes: 'quotes " \'',
  };

  async function createCitizen(balance: number = START): Promise<MemberFixture> {
    const member = await createMember(knex);
    await knex('wallet').where({ id: member.walletId }).update({ balance });
    await createHome(knex, member.id);
    return member;
  }

  /** Both receipts written for a transfer, sender's first. */
  async function receiptsFor(
    sender: MemberFixture,
    recipient: MemberFixture,
  ): Promise<{ message: string; subject: string }[]> {
    // Both copies are authored by the SENDER's member id -- the recipient's receipt is
    // addressed to them but stamped with who it came from -- so `member_id` alone would
    // find only one of the two. They are told apart by the home they were filed at.
    const homes = await knex('place')
      .select('id')
      .where({ type: 'home' })
      .whereIn('member_id', [sender.id, recipient.id]);
    return knex('inbox')
      .whereIn('place_id', homes.map(home => home.id))
      .orderBy('id', 'asc');
  }

  async function storedMemo(sender: MemberFixture): Promise<string> {
    const row = await knex('transaction').where({ sender_wallet_id: sender.walletId }).first();
    return row.memo;
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

  describe.each(Object.entries(MEMOS))('a memo of %s', (_label, memo) => {
    it('reaches the ledger literally and the Inbox escaped', async () => {
      const sender = await createCitizen();
      const recipient = await createCitizen();

      const result = await service.transfer(
        sender.id, recipient.username, 100, memo, intentKey(),
      );
      expect(result.success).toBe(true);

      // The financial record keeps what the citizen typed.
      expect(await storedMemo(sender)).toBe(memo);

      const receipts = await receiptsFor(sender, recipient);
      expect(receipts).toHaveLength(2);
      for (const receipt of receipts) {
        // The memo's own characters never survive as markup.
        expect(receipt.message).toContain(escapedFormOf(memo));
        expect(receipt.message).not.toContain(memo);
        // The only markup in the whole message is the separator this application wrote.
        expect(tagsIn(receipt.message)).toEqual(['<br>']);
      }
    });
  });

  it('files a receipt with no markup at all when there is no memo', async () => {
    const sender = await createCitizen();
    const recipient = await createCitizen();

    await service.transfer(sender.id, recipient.username, 100, '', intentKey());

    for (const receipt of await receiptsFor(sender, recipient)) {
      expect(tagsIn(receipt.message)).toEqual([]);
    }
  });

  it('escapes a username as well as the memo', async () => {
    // Usernames are citizen-controlled too, and both receipts name the other party. CTR's
    // signup rules may or may not permit a bracket today; the receipt does not depend on
    // that remaining true.
    const sender = await createCitizen();
    const recipient = await createCitizen();
    // Prefixed with the fixture tag so cleanUpFixtures can still find this member: the
    // helper matches on the username, and a rename that dropped the prefix would leave the
    // row behind to collide with the next run's unique index.
    const hostile = `${fixtureName('xss')}<img src=x onerror=alert(1)>`;
    await knex('member').where({ id: sender.id }).update({ username: hostile });

    await service.transfer(sender.id, recipient.username, 100, 'ok', intentKey());

    const [, recipientReceipt] = await receiptsFor(sender, recipient);
    expect(recipientReceipt.message).not.toContain(hostile);
    // The trusted separator, and nothing the username smuggled in.
    expect(tagsIn(recipientReceipt.message)).toEqual(['<br>']);
  });

  it('keeps the historical wording and amount readable around the escaping', async () => {
    // The escaping must not have eaten the sentence. This is the original's phrasing from
    // phase3.pl, with its `<br>`-joined reason.
    const sender = await createCitizen();
    const recipient = await createCitizen();

    await service.transfer(sender.id, recipient.username, 250, 'for the pizza', intentKey());

    const [sent, received] = await receiptsFor(sender, recipient);
    expect(sent.subject).toBe('Receipt of funds sent');
    expect(sent.message).toBe(
      `${recipient.username} has been transferred 250cc<br>reason : for the pizza`,
    );
    expect(received.subject).toBe('Receipt of funds received');
    expect(received.message).toBe(
      `${sender.username} has transferred you 250cc<br>reason : for the pizza`,
    );
  });
});

/** The escaped form the receipt should carry, computed independently of the implementation. */
function escapedFormOf(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Every HTML tag in a string.
 *
 * Used to assert that the only markup a receipt contains is what trusted code put there.
 * Deliberately a crude scan rather than a parser: the question is not "is this valid HTML"
 * but "does anything here look like a tag at all".
 */
function tagsIn(message: string): string[] {
  return message.match(/<[^>]*>/g) ?? [];
}
