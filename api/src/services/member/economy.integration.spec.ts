import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { MemberService } from './member.service';
import {
  assignRole,
  cleanUpFixtures,
  createRole,
  daysAgo,
  describeWithDb,
  fixtureName,
} from '@spec/integration-db';

/**
 * Cybertown's final-era economy, measured as observed balance and XP deltas rather than as
 * assertions about constants.
 *
 * The distinction matters: a spec that imports DAILY_CC_AMOUNT and checks the payout equals
 * DAILY_CC_AMOUNT passes no matter what that number is. These tests hard-code the amounts
 * the live server's own config files specify, so a change to the constants has to be a
 * deliberate change here too.
 *
 *   m_immigrate            20,000    e_member_daily_login    5
 *   m_member_daily_login       80    e_job_daily_login      16
 *   m_job_daily_login         256
 *
 * See libs/economy.ts for the files, their hashes, and why these differ from the amounts on
 * Cybertown's public help pages.
 */
describeWithDb('final-era economy (real database)', () => {
  const knex = Container.get(Db).knex;
  const service = Container.get(MemberService);

  const IMMIGRATION_CC = 20000;
  const DAILY_CC = 80;
  const DAILY_XP = 5;
  const EMPLOYED_CC = 336;
  const EMPLOYED_XP = 21;

  async function walletOf(memberId: number): Promise<number> {
    const member = await knex('member').where({ id: memberId }).first();
    const wallet = await knex('wallet').where({ id: member.wallet_id }).first();
    return wallet.balance;
  }

  async function xpOf(memberId: number): Promise<number> {
    return (await knex('member').where({ id: memberId }).first()).xp;
  }

  /** Creates a citizen through the real signup path, so the grant runs as it would live. */
  async function immigrate(): Promise<{ id: number; username: string }> {
    const username = fixtureName('member');
    const token = await service.createMemberAndLogin(
      `${username}@example.invalid`,
      username,
      'not-a-real-password',
    );
    const session = service.decodeMemberToken(token);
    return { id: session.id, username };
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

  describe('immigration', () => {
    it('grants a new citizen exactly 20,000 CityCash', async () => {
      const member = await immigrate();

      // Exactly the grant, with no daily bonus on top: `last_daily_login_credit` defaults
      // to NOW(), so a citizen created today already counts as credited today.
      expect(await walletOf(member.id)).toBe(IMMIGRATION_CC);
    });

    it('records the grant in the ledger so it can be accounted for', async () => {
      const member = await immigrate();
      const { wallet_id } = await knex('member').where({ id: member.id }).first();

      const rows = await knex('transaction')
        .where({ recipient_wallet_id: wallet_id, reason: 'immigration-grant' });

      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(IMMIGRATION_CC);
      expect(rows[0].sender_wallet_id).toBeNull();
    });

    it('grants it once, not once per login', async () => {
      const member = await immigrate();

      await service.login(member.username, 'not-a-real-password');

      const { wallet_id } = await knex('member').where({ id: member.id }).first();
      const rows = await knex('transaction')
        .where({ recipient_wallet_id: wallet_id, reason: 'immigration-grant' });
      expect(rows).toHaveLength(1);
    });
  });

  describe('the daily login bonus', () => {
    it('pays an ordinary citizen 80cc and 5xp', async () => {
      const member = await immigrate();
      await knex('member')
        .where({ id: member.id })
        .update({ last_daily_login_credit: daysAgo(1), xp: 0 });
      const before = await walletOf(member.id);

      await service.maybeGiveDailyCredits(member.id);

      expect(await walletOf(member.id) - before).toBe(DAILY_CC);
      expect(await xpOf(member.id)).toBe(DAILY_XP);
    });

    it('pays an employed citizen 336cc and 21xp in TOTAL, not on top of the base', async () => {
      // The failure this guards against: reading the historical config as additive at the
      // call site and paying 80 + 336 = 416, or 5 + 21 = 26.
      const member = await immigrate();
      await knex('member')
        .where({ id: member.id })
        .update({ last_daily_login_credit: daysAgo(1), xp: 0 });
      await assignRole(knex, member.id, await createRole(knex, {
        name: fixtureName('Job'),
        income_cc: 100,
        income_xp: 5,
      }));
      const before = await walletOf(member.id);

      await service.maybeGiveDailyCredits(member.id);

      const paid = await walletOf(member.id) - before;
      expect(paid).toBe(EMPLOYED_CC);
      expect(paid).not.toBe(DAILY_CC + EMPLOYED_CC);
      expect(await xpOf(member.id)).toBe(EMPLOYED_XP);
      expect(await xpOf(member.id)).not.toBe(DAILY_XP + EMPLOYED_XP);
    });

    it('pays only once on a second login the same day', async () => {
      const member = await immigrate();
      await knex('member')
        .where({ id: member.id })
        .update({ last_daily_login_credit: daysAgo(1), xp: 0 });
      const before = await walletOf(member.id);

      await service.maybeGiveDailyCredits(member.id);
      await service.maybeGiveDailyCredits(member.id);

      expect(await walletOf(member.id) - before).toBe(DAILY_CC);
      expect(await xpOf(member.id)).toBe(DAILY_XP);
    });

    it('pays once when two logins arrive together', async () => {
      const member = await immigrate();
      await knex('member')
        .where({ id: member.id })
        .update({ last_daily_login_credit: daysAgo(1), xp: 0 });
      const before = await walletOf(member.id);

      await Promise.all([
        service.maybeGiveDailyCredits(member.id),
        service.maybeGiveDailyCredits(member.id),
      ]);

      expect(await walletOf(member.id) - before).toBe(DAILY_CC);
    });
  });

  describe('login ordering (the behaviour PR #11 established)', () => {
    it('has the credit already applied by the time login returns a token', async () => {
      // Originally the daily credit was started but not awaited, so a caller could read
      // its own balance back and not see the money yet, and nothing kept the process
      // interested in a write that outlived the response.
      const member = await immigrate();
      await knex('member')
        .where({ id: member.id })
        .update({ last_daily_login_credit: daysAgo(1), xp: 0 });
      const before = await walletOf(member.id);

      const token = await service.login(member.username, 'not-a-real-password');

      // Read immediately, with no intervening tick for an unawaited promise to settle in.
      expect(token).toBeTruthy();
      expect(await walletOf(member.id) - before).toBe(DAILY_CC);
    });

    it('still logs the citizen in when the bonus itself fails', async () => {
      // A missed bonus must never cost someone their account. The payout is all-or-nothing,
      // so a failure here leaves no half-applied credit behind either.
      const member = await immigrate();
      const creditRepository = (service as never as {
        creditRepository: { giveDailyCredit: unknown };
      }).creditRepository;
      const original = creditRepository.giveDailyCredit;
      creditRepository.giveDailyCredit = jest.fn()
        .mockRejectedValue(new Error('credit unavailable'));

      try {
        const token = await service.login(member.username, 'not-a-real-password');
        expect(token).toBeTruthy();
      } finally {
        creditRepository.giveDailyCredit = original;
      }
    });
  });
});
