import bcrypt from 'bcrypt';
import { Container } from 'typedi';

import { Db } from '../../db/db.class';
import { HomeService } from './home.service';
import { MemberService } from '../member/member.service';
import { MemberRepository } from '../../repositories';
import {
  cleanUpFixtures,
  createHome,
  createMember,
  describeWithDb,
  fixtureName,
  MemberFixture,
} from '@spec/integration-db';

/**
 * The one-time settle-a-home experience award, against a real MySQL.
 *
 * `e_propsettle 50` in colonycity/config/exper.cfg -- historical Cybertown behaviour, not a
 * revival invention.
 *
 * The whole point of these tests is the word ONCE. The obvious implementation ("does this
 * member own a home?") pays again every time somebody moves out and back, and a
 * read-then-write implementation pays twice when two settle requests arrive together. Both
 * are checked here explicitly.
 */
describeWithDb('first homestead award (real database)', () => {
  const knex = Container.get(Db).knex;
  const service = Container.get(HomeService);
  const memberService = Container.get(MemberService);
  const memberRepository = Container.get(MemberRepository);

  const AWARD = 50;

  /** A block with free plots, and a free plot number within it. */
  let blockId: number;

  async function freeLocation(): Promise<number> {
    const row = await knex('map_location')
      .where({ parent_place_id: blockId, available: true })
      .whereNull('place_id')
      .orderBy('location', 'asc')
      .first();
    if (!row) throw new Error('no free plot in the fixture block');
    return row.location;
  }

  async function xpOf(member: MemberFixture): Promise<number> {
    return (await knex('member').where({ id: member.id }).first()).xp;
  }

  async function rewardedAt(member: MemberFixture): Promise<Date | null> {
    return (await knex('member').where({ id: member.id }).first()).first_homestead_rewarded_at;
  }

  /** Settles a home through the real service path. */
  async function settle(member: MemberFixture): Promise<void> {
    await service.createHome(
      member.id,
      'First',
      'Last',
      blockId,
      await freeLocation(),
      fixtureName('home'),
      'a description',
      1,
      null,
    );
  }

  /** Gives up the home the way account teardown does: the rows simply go away. */
  async function moveOut(member: MemberFixture): Promise<void> {
    const home = await knex('place').where({ type: 'home', member_id: member.id }).first();
    await knex('map_location').where({ place_id: home.id }).update({ place_id: null });
    await knex('home').where({ place_id: home.id }).del();
    await knex('place').where({ id: home.id }).del();
  }

  beforeAll(async () => {
    // A fixture block of our own, with plots, so the suite never competes with seeded data
    // or with another spec for a location.
    [blockId] = await knex('place').insert({
      type: 'block',
      name: fixtureName('block'),
      status: 1,
    });
    await knex('map_location').insert(
      Array.from({ length: 12 }, (_unused, index) => ({
        parent_place_id: blockId,
        location: index + 1,
        available: true,
        place_id: null,
      })),
    );
  });

  afterAll(async () => {
    await knex('map_location').where({ parent_place_id: blockId }).del();
    await knex('place').where({ id: blockId }).del();
    await knex.destroy();
  });

  beforeEach(async () => {
    await cleanUpFixtures(knex);
    await knex('map_location').where({ parent_place_id: blockId }).update({ place_id: null });
  });

  afterEach(async () => {
    await cleanUpFixtures(knex);
    await knex('map_location').where({ parent_place_id: blockId }).update({ place_id: null });
  });

  it('pays 50 XP for a first successful settle', async () => {
    const member = await createMember(knex, { xp: 0 });

    await settle(member);

    expect(await xpOf(member)).toBe(AWARD);
    expect(await rewardedAt(member)).toBeTruthy();
  });

  it('pays nothing extra when a citizen settles again after moving out', async () => {
    // The behaviour a "does this member own a home" check would get wrong.
    const member = await createMember(knex, { xp: 0 });

    await settle(member);
    await moveOut(member);
    await settle(member);

    expect(await xpOf(member)).toBe(AWARD);
  });

  it('pays nothing extra when a citizen settles a different home later', async () => {
    const member = await createMember(knex, { xp: 0 });

    await settle(member);
    await moveOut(member);
    await settle(member);
    await moveOut(member);
    await settle(member);

    expect(await xpOf(member)).toBe(AWARD);
  });

  it('pays nothing when the settle fails', async () => {
    const member = await createMember(knex, { xp: 0 });

    await expect(service.createHome(
      member.id, 'First', 'Last', blockId, 9999, fixtureName('home'), 'x', 1, null,
    )).rejects.toThrow();

    expect(await xpOf(member)).toBe(0);
    expect(await rewardedAt(member)).toBeNull();
  });

  it('pays nothing when the plot is already taken', async () => {
    const first = await createMember(knex, { xp: 0 });
    const second = await createMember(knex, { xp: 0 });
    const location = await freeLocation();

    await service.createHome(
      first.id, 'A', 'B', blockId, location, fixtureName('home'), 'x', 1, null,
    );
    await expect(service.createHome(
      second.id, 'C', 'D', blockId, location, fixtureName('home'), 'x', 1, null,
    )).rejects.toThrow();

    expect(await xpOf(first)).toBe(AWARD);
    expect(await xpOf(second)).toBe(0);
  });

  it('pays nothing for editing the home description', async () => {
    const member = await createMember(knex, { xp: 0 });
    await settle(member);

    await service.updateHomeInformation(member.id, 'a new description');

    expect(await xpOf(member)).toBe(AWARD);
  });

  it('pays nothing for updating the home itself', async () => {
    const member = await createMember(knex, { xp: 0 });
    await settle(member);

    await service.updateHome(member.id, fixtureName('renamed'), 2, null);

    expect(await xpOf(member)).toBe(AWARD);
  });

  it('pays nothing for moving the home to another plot', async () => {
    const member = await createMember(knex, { xp: 0 });
    await settle(member);

    await service.moveHome(member.id, blockId, await freeLocation());

    expect(await xpOf(member)).toBe(AWARD);
  });

  it('pays exactly 50 in total when two first-settles arrive together', async () => {
    // Two requests, two plots, one member -- the controller's "home already exists" guard
    // is a read-then-decide and does not serialise. The award still has to be paid once,
    // which is the conditional UPDATE's job, not the guard's.
    const member = await createMember(knex, { xp: 0 });
    const locations = await knex('map_location')
      .where({ parent_place_id: blockId, available: true })
      .whereNull('place_id')
      .orderBy('location', 'asc')
      .limit(2);

    await Promise.allSettled(locations.map(row => service.createHome(
      member.id, 'A', 'B', blockId, row.location, fixtureName('home'), 'x', 1, null,
    )));

    expect(await xpOf(member)).toBe(AWARD);
  });

  it('keeps the award marker after the member row is re-read', async () => {
    // The marker is a column, not process state: it survives a restart by construction.
    const member = await createMember(knex, { xp: 0 });
    await settle(member);
    const stamped = await rewardedAt(member);

    await moveOut(member);
    await settle(member);

    expect(await rewardedAt(member)).toEqual(stamped);
    expect(await xpOf(member)).toBe(AWARD);
  });

  it('does not disturb XP a citizen already had', async () => {
    const member = await createMember(knex, { xp: 130 });

    await settle(member);

    expect(await xpOf(member)).toBe(130 + AWARD);
  });

  /*
   * ----------------------------------------------------------------------------------------
   * DEF-03: the award must be paid EVENTUALLY, not merely at most once.
   * ----------------------------------------------------------------------------------------
   *
   * Every test above proves "at most once". None of them proved "at least once", and
   * independent QA found the gap: the settle path swallowed a failed award, and because CTR
   * gives nobody a second FIRST home, the citizen could never reach that line again. Home
   * created, marker NULL, 50 XP gone for good.
   *
   * The fix is that the award is a RECONCILIATION -- "is this member owed it?" -- run both at
   * settle time and on every successful login. A failure at settle now costs a delay instead
   * of the award, and the same mechanism pays citizens who homesteaded before the award
   * existed at all. Both halves are proved below.
   *
   * `last_daily_login_credit` is stamped as today on every fixture here, so the daily login
   * bonus does not fire and the only XP movement under test is the homestead award.
   */
  describe('recovery and backfill', () => {
    const PASSWORD = 'correct-horse';

    /** A citizen who can actually log in, and who has already had today's daily credit. */
    async function createLoginableMember(xp = 0): Promise<MemberFixture> {
      return createMember(knex, {
        xp,
        password: await bcrypt.hash(PASSWORD, 10),
        last_daily_login_credit: new Date(),
      });
    }

    it('recovers an award the settle path failed to pay', async () => {
      const member = await createLoginableMember();

      // The transient failure QA reproduced: the home is created, the award write throws,
      // and HomeService swallows it so the citizen still gets their home.
      const failOnce = jest.spyOn(memberRepository, 'reconcileFirstHomesteadXp')
        .mockRejectedValueOnce(new Error('injected: award write failed'));
      await settle(member);
      failOnce.mockRestore();

      // The exact broken state: home present, nothing paid, marker still NULL. Under the
      // previous implementation this was terminal.
      const home = await knex('place').where({ type: 'home', member_id: member.id }).first();
      expect(home).toBeTruthy();
      expect(await xpOf(member)).toBe(0);
      expect(await rewardedAt(member)).toBeNull();

      // A later login reconciles it.
      await memberService.login(member.username, PASSWORD);
      expect(await xpOf(member)).toBe(AWARD);
      expect(await rewardedAt(member)).toBeTruthy();

      // And only once.
      await memberService.login(member.username, PASSWORD);
      expect(await xpOf(member)).toBe(AWARD);
    });

    it('backfills a citizen who homesteaded before the award existed', async () => {
      // The pre-lane population: a real home, and a marker that is NULL because the column
      // did not exist when they settled. Indistinguishable from a failed award, and
      // deliberately answered the same way.
      const member = await createLoginableMember();
      await createHome(knex, member.id);
      expect(await rewardedAt(member)).toBeNull();

      await memberService.login(member.username, PASSWORD);

      expect(await xpOf(member)).toBe(AWARD);
      expect(await rewardedAt(member)).toBeTruthy();
    });

    it('pays a backfilled citizen once and not again on every later login', async () => {
      const member = await createLoginableMember();
      await createHome(knex, member.id);

      await memberService.login(member.username, PASSWORD);
      await memberService.login(member.username, PASSWORD);
      await memberService.login(member.username, PASSWORD);

      expect(await xpOf(member)).toBe(AWARD);
    });

    it('pays nothing to a citizen who has no home', async () => {
      // The condition that stops the login hook paying the entire membership. Without the
      // EXISTS clause every citizen would collect 50 XP on their next login.
      const member = await createLoginableMember();

      await memberService.login(member.username, PASSWORD);

      expect(await xpOf(member)).toBe(0);
      expect(await rewardedAt(member)).toBeNull();
    });

    it('pays nothing on login to a citizen who has already been paid', async () => {
      const member = await createLoginableMember();
      await settle(member);
      expect(await xpOf(member)).toBe(AWARD);

      await memberService.reconcileFirstHomesteadXpForLogin(member.id);

      expect(await xpOf(member)).toBe(AWARD);
    });

    it('pays nothing on login after the citizen has moved out', async () => {
      // Marker stamped and no home: neither condition is satisfied, so nothing happens.
      const member = await createLoginableMember();
      await settle(member);
      await moveOut(member);

      await memberService.login(member.username, PASSWORD);

      expect(await xpOf(member)).toBe(AWARD);
    });

    it('pays nothing on login after the citizen has moved out and back in', async () => {
      const member = await createLoginableMember();
      await settle(member);
      await moveOut(member);
      await settle(member);

      await memberService.login(member.username, PASSWORD);

      expect(await xpOf(member)).toBe(AWARD);
    });

    it('pays exactly once when several logins reconcile at the same moment', async () => {
      // The conditional UPDATE is the whole of the concurrency control -- there is no read
      // anywhere for a second request to overtake.
      const member = await createLoginableMember();
      await createHome(knex, member.id);

      await Promise.all(Array.from({ length: 8 }, () =>
        memberService.reconcileFirstHomesteadXpForLogin(member.id)));

      expect(await xpOf(member)).toBe(AWARD);
    });

    it('pays exactly once when a settle and a login reconcile at the same moment', async () => {
      const member = await createLoginableMember();
      await createHome(knex, member.id);

      await Promise.all([
        memberService.reconcileFirstHomesteadXpForLogin(member.id),
        memberRepository.reconcileFirstHomesteadXp(member.id, AWARD),
      ]);

      expect(await xpOf(member)).toBe(AWARD);
    });

    it('does not fail the login when reconciliation throws', async () => {
      // The daily-credit philosophy: account access outranks an optional reward. The
      // difference from the old settle-only path is that the marker stays NULL, so the
      // NEXT login retries rather than the award being lost.
      const member = await createLoginableMember();
      await createHome(knex, member.id);

      const failOnce = jest.spyOn(memberRepository, 'reconcileFirstHomesteadXp')
        .mockRejectedValueOnce(new Error('injected: reconciliation failed'));
      await expect(memberService.login(member.username, PASSWORD)).resolves.toEqual(
        expect.any(String),
      );
      failOnce.mockRestore();

      expect(await xpOf(member)).toBe(0);
      expect(await rewardedAt(member)).toBeNull();

      await memberService.login(member.username, PASSWORD);
      expect(await xpOf(member)).toBe(AWARD);
    });
  });
});
