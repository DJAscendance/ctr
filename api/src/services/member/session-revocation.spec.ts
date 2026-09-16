import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { MemberService } from './member.service';

/**
 * Standing, as the session guard reads it -- and as an unban must reverse it.
 *
 * Driven against an in-memory stand-in for the `ban` table that answers the same two
 * questions the repository does, so the rules are asserted rather than the SQL. The point of
 * the file is the pair: a ban stops the session AND removing the ban gives it back, with
 * `member.status` never written on either side.
 */
describe('session revocation and its reversal', () => {
  const MEMBER_ID = 11;

  /** One row of the `ban` table, only the columns standing depends on. */
  interface BanRow {
    type: 'full' | 'jail';
    status: number;
    end_date: Date;
  }

  function future(days = 3): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  function build(member: { status: number }, bans: BanRow[]) {
    const memberRepository = {
      findById: jest.fn(async () => ({ id: MEMBER_ID, ...member })),
      update: jest.fn(async () => undefined),
      find: jest.fn(async () => ({
        id: MEMBER_ID,
        username: 'citizen',
        password: 'hashed',
        avatar_id: 1,
        approved_at: new Date(),
        ...member,
      })),
    };
    const banRepository = {
      hasActiveFullBan: jest.fn(async () => bans.some(ban =>
        ban.type === 'full' && ban.status === 1 && ban.end_date > new Date(),
      )),
      getBanMaxDate: jest.fn(async () => {
        const live = bans
          .filter(ban => ban.status === 1)
          .sort((a, b) => b.end_date.getTime() - a.end_date.getTime());
        return live.length ? live[0] : undefined;
      }),
    };
    const service = new MemberService(
      { find: jest.fn(async () => ({ id: 1 })) } as any,
      banRepository as any,
      memberRepository as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, memberRepository, banRepository };
  }

  it('leaves a citizen in good standing alone', async () => {
    const { service } = build({ status: 1 }, []);
    await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(false);
  });

  it('revokes a citizen under a live full ban', async () => {
    const { service } = build({ status: 1 }, [
      { type: 'full', status: 1, end_date: future() },
    ]);
    await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(true);
  });

  it('does NOT revoke a jailed citizen -- jail keeps them logged in, in the Jail', async () => {
    const { service } = build({ status: 1 }, [
      { type: 'jail', status: 1, end_date: future() },
    ]);
    await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(false);
    // ...while the city still considers them sanctioned, which is a different question.
    await expect(service.isBanned(MEMBER_ID)).resolves.toMatchObject({ banned: true });
  });

  it('revokes a disabled account, which login has always refused', async () => {
    const { service } = build({ status: 0 }, []);
    await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(true);
  });

  it('stops revoking once the ban row is withdrawn, exactly as deleteBan leaves it',
    async () => {
      const bans: BanRow[] = [{ type: 'full', status: 1, end_date: future() }];
      const { service, memberRepository } = build({ status: 1 }, bans);
      await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(true);

      // What BanRepository.deleteBan does: status 1 -> 0. Nothing else moves.
      bans[0].status = 0;
      await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(false);

      // The ban never touched member.status, so an unban has nothing to guess at restoring.
      expect(memberRepository.update).not.toHaveBeenCalled();
    });

  it('stops revoking once the ban simply runs out', async () => {
    const bans: BanRow[] = [{ type: 'full', status: 1, end_date: future(-1) }];
    const { service } = build({ status: 1 }, bans);
    await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(false);
  });

  it('revokes a member row that has gone missing', async () => {
    const { service, memberRepository } = build({ status: 1 }, []);
    memberRepository.findById.mockResolvedValue(undefined as any);
    await expect(service.isSessionRevoked(MEMBER_ID)).resolves.toBe(true);
  });

  /**
   * The other half of "a ban ends a session": it must also stop a NEW one being opened.
   * Revoking the token a banned citizen already holds while still letting them log in for a
   * fresh one would close nothing at all.
   */
  describe('login', () => {
    function buildLogin(bans: BanRow[], member: { status: number } = { status: 1 }) {
      const built = build(member, bans);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);
      // Neither daily award may fail a login, and neither is what this file is about.
      jest.spyOn(built.service, 'giveDailyCreditsForLogin')
        .mockResolvedValue(undefined as never);
      jest.spyOn(built.service as any, 'reconcileFirstHomesteadXpForLogin')
        .mockResolvedValue(undefined as never);
      return built;
    }

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('lets a citizen in good standing in, with a token that carries an expiry', async () => {
      const { service } = buildLogin([]);
      const token = await service.login('citizen', 'correct horse');
      const claims = jwt.decode(token) as jwt.JwtPayload;
      expect(claims.id).toBe(MEMBER_ID);
      expect(typeof claims.exp).toBe('number');
    });

    it('refuses a citizen under a live full ban', async () => {
      const { service } = buildLogin([{ type: 'full', status: 1, end_date: future() }]);
      await expect(service.login('citizen', 'correct horse')).rejects.toThrow('banned');
    });

    it('still lets a JAILED citizen log in -- jail is served inside the city', async () => {
      const { service } = buildLogin([{ type: 'jail', status: 1, end_date: future() }]);
      await expect(service.login('citizen', 'correct horse')).resolves.toEqual(
        expect.any(String),
      );
    });

    it('refuses a disabled account, exactly as it always has', async () => {
      const { service } = buildLogin([], { status: 0 });
      await expect(service.login('citizen', 'correct horse')).rejects.toThrow('banned');
    });

    it('lets the citizen back in once the ban is withdrawn', async () => {
      const bans: BanRow[] = [{ type: 'full', status: 1, end_date: future() }];
      const { service } = buildLogin(bans);
      await expect(service.login('citizen', 'correct horse')).rejects.toThrow('banned');

      bans[0].status = 0;
      const token = await service.login('citizen', 'correct horse');
      expect((jwt.decode(token) as jwt.JwtPayload).id).toBe(MEMBER_ID);
    });

    it('refuses a wrong password before it ever looks at standing', async () => {
      const { service, banRepository } = buildLogin([]);
      (bcrypt.compare as unknown as jest.Mock).mockImplementation(async () => false);
      await expect(service.login('citizen', 'wrong'))
        .rejects.toThrow('Incorrect login details.');
      expect(banRepository.hasActiveFullBan).not.toHaveBeenCalled();
    });
  });
});
