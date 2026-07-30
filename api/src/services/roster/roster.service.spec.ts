import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { RosterService } from './roster.service';
import { MemberDataService } from '../member-data/member-data.service';
import { MemberDataRepository, MemberRepository } from '../../repositories';

describe('RosterService', () => {
  const VIEWER = 11;
  const BUDDY = 22;
  const STRANGER = 33;
  const HIDDEN = 44;
  const ACTIVE_SINCE = new Date(0);

  let memberRepository: jest.Mocked<MemberRepository>;
  let memberDataRepository: jest.Mocked<MemberDataRepository>;
  let memberDataService: jest.Mocked<MemberDataService>;
  let service: RosterService;

  const online = (...members: { id: number; username: string }[]) =>
    memberRepository.findOnlineUsers.mockResolvedValue(members as any);

  const hidden = (...ids: number[]) =>
    memberDataRepository.getForMembers.mockResolvedValue(
      new Map(ids.map(id => [id, '1'])),
    );

  beforeEach(() => {
    memberRepository = createSpyObj(MemberRepository);
    memberDataRepository = createSpyObj(MemberDataRepository);
    memberDataService = createSpyObj(MemberDataService);
    memberDataService.getBuddyNameSet.mockResolvedValue(new Set());
    Container.reset();
    Container.set(MemberRepository, memberRepository);
    Container.set(MemberDataRepository, memberDataRepository);
    Container.set(MemberDataService, memberDataService);
    service = Container.get(RosterService);

    online(
      { id: VIEWER, username: 'Viewer' },
      { id: BUDDY, username: 'Buddy' },
      { id: STRANGER, username: 'Stranger' },
    );
    hidden();
  });

  /**
   * Gap 04. message/count.html emits the roster link only when NNM != "Visitor", so a
   * visitor learns HOW MANY are online and nothing else.
   */
  describe('for a visitor', () => {
    it('returns the count and no names', async () => {
      const roster = await service.getRoster(null, ACTIVE_SINCE);
      expect(roster.count).toBe(3);
      expect(roster.entries).toBeNull();
    });

    it('does not read buddy slots', async () => {
      await service.getRoster(null, ACTIVE_SINCE);
      expect(memberDataService.getBuddyNameSet).not.toHaveBeenCalled();
    });

    it('still excludes hidden members from the count', async () => {
      online(
        { id: VIEWER, username: 'Viewer' },
        { id: HIDDEN, username: 'Ghost' },
      );
      hidden(HIDDEN);
      const roster = await service.getRoster(null, ACTIVE_SINCE);
      expect(roster.count).toBe(1);
    });
  });

  /** Gap 05. The BU_ loop flag gated a <B> wrapper -- the whole visual buddy affordance. */
  describe('for a member', () => {
    it('flags buddies, case-insensitively', async () => {
      memberDataService.getBuddyNameSet.mockResolvedValue(new Set(['buddy']));
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      const byName = Object.fromEntries(roster.entries.map(e => [e.username, e]));
      expect(byName['Buddy'].isBuddy).toBe(true);
      expect(byName['Stranger'].isBuddy).toBe(false);
    });

    it('flags the viewer as self', async () => {
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      const byName = Object.fromEntries(roster.entries.map(e => [e.username, e]));
      expect(byName['Viewer'].isSelf).toBe(true);
      expect(byName['Stranger'].isSelf).toBe(false);
    });

    it('count matches the number of entries returned', async () => {
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      expect(roster.count).toBe(roster.entries.length);
    });
  });

  /**
   * The privacy flag. A hidden member appears OFFLINE, so they are absent from the entries
   * AND from the count -- counting them while omitting the name would leak that someone is
   * hiding, because the count would exceed the visible names.
   */
  describe('hidden members', () => {
    beforeEach(() => {
      online(
        { id: VIEWER, username: 'Viewer' },
        { id: HIDDEN, username: 'Ghost' },
        { id: STRANGER, username: 'Stranger' },
      );
      hidden(HIDDEN);
    });

    it('are omitted from the entries', async () => {
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      expect(roster.entries.map(e => e.username)).not.toContain('Ghost');
    });

    it('are omitted from the count, so the count cannot leak them', async () => {
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      expect(roster.count).toBe(2);
      expect(roster.count).toBe(roster.entries.length);
    });

    /** Turning "hide me" on must not make you vanish from your own roster. */
    it('still see themselves', async () => {
      const roster = await service.getRoster(HIDDEN, ACTIVE_SINCE);
      const self = roster.entries.find(e => e.username === 'Ghost');
      expect(self).toBeDefined();
      expect(self.isSelf).toBe(true);
    });
  });

  describe('when nobody is online', () => {
    it('returns an empty roster for a member, not null', async () => {
      online();
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      expect(roster.count).toBe(0);
      expect(roster.entries).toEqual([]);
    });

    /**
     * The roster endpoint is polled, so the nobody-online case should cost nothing. This
     * previously asserted getForMembers HAD been called with [], which contradicted the
     * test's own name and locked in the wasted round trip.
     */
    it('does not query attributes for an empty member list', async () => {
      online();
      await service.getRoster(null, ACTIVE_SINCE);
      expect(memberDataRepository.getForMembers).not.toHaveBeenCalled();
    });

    it('does not fetch buddies for a member when nobody is online', async () => {
      online();
      const roster = await service.getRoster(VIEWER, ACTIVE_SINCE);
      expect(memberDataService.getBuddyNameSet).not.toHaveBeenCalled();
      expect(roster.entries).toEqual([]);
    });
  });
});
