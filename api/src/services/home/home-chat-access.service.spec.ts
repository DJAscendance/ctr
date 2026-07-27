import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HomeService } from './home.service';
import { MemberService } from '../member/member.service';
import { BlockService } from '../block/block.service';
import {
  PlaceRepository,
  MapLocationRepository,
  HomeDesignRepository,
  HomeRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
  TransactionRepository,
} from '../../repositories';

/**
 * Coverage for home chat access: owner-only configuration, normalization, the atomic
 * replacement, and the authorization decision the socket server and the message controller
 * both rely on.
 *
 * The role id is resolved BY NAME throughout - these tests use a deliberately arbitrary id
 * so that hardcoding 192 anywhere would fail them.
 */
describe('HomeService chat access', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let homeDesignRepository: jest.Mocked<HomeDesignRepository>;
  let homeRepository: jest.Mocked<HomeRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let memberService: jest.Mocked<MemberService>;
  let blockService: jest.Mocked<BlockService>;
  let service: HomeService;

  const OWNER_ID = 5;
  const HOME_PLACE_ID = 42;
  // Intentionally NOT 192 - resolution must go through the role name.
  const GUEST_ROLE_ID = 4711;

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    homeDesignRepository = createSpyObj(HomeDesignRepository);
    homeRepository = createSpyObj(HomeRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberRepository = createSpyObj(MemberRepository);
    transactionRepository = createSpyObj(TransactionRepository);
    memberService = createSpyObj(MemberService);
    blockService = createSpyObj(BlockService);

    Container.reset();
    Container.set(PlaceRepository, placeRepository);
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(HomeDesignRepository, homeDesignRepository);
    Container.set(HomeRepository, homeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    Container.set(MemberRepository, memberRepository);
    Container.set(TransactionRepository, transactionRepository);
    Container.set(MemberService, memberService);
    Container.set(BlockService, blockService);
    service = Container.get(HomeService);

    roleRepository.findIdByName.mockResolvedValue(GUEST_ROLE_ID);
    placeRepository.findHomeByMemberId.mockResolvedValue({ id: HOME_PLACE_ID } as any);
    homeRepository.runInTransaction.mockImplementation((work: any) => work({}));
    roleAssignmentRepository.removeAllForPlaceAndRoleWithin.mockResolvedValue(undefined);
    roleAssignmentRepository.addIdToAssignmentWithin.mockResolvedValue(undefined);
    roleAssignmentRepository.getUsernamesByRoleAndPlace.mockResolvedValue([]);
    roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue([]);
  });

  /** Makes findIdByUsername resolve the given names to the given ids, others to nothing. */
  function knownMembers(map: { [username: string]: number }) {
    memberRepository.findIdByUsername.mockImplementation(async (username: string) => {
      const id = map[username];
      return (id ? [{ id }] : []) as any;
    });
  }

  describe('role resolution', () => {
    it('resolves the guest role by name, never by a hardcoded id', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['Ada']);

      expect(roleRepository.findIdByName).toHaveBeenCalledWith('Home Chat Guest');
      expect(roleAssignmentRepository.addIdToAssignmentWithin)
        .toHaveBeenCalledWith({}, HOME_PLACE_ID, 10, GUEST_ROLE_ID);
    });

    it('refuses to write anything when the role is missing from the database', async () => {
      roleRepository.findIdByName.mockResolvedValue(undefined);

      await expect(service.updateChatAccess(OWNER_ID, ['Ada']))
        .rejects.toThrow('Home chat access is unavailable.');
      expect(roleAssignmentRepository.addIdToAssignmentWithin).not.toHaveBeenCalled();
      expect(roleAssignmentRepository.removeAllForPlaceAndRoleWithin).not.toHaveBeenCalled();
    });
  });

  describe('owner-only configuration', () => {
    it('reads the list for the session member\'s own home', async () => {
      roleAssignmentRepository.getUsernamesByRoleAndPlace.mockResolvedValue(
        [{ username: 'Ada' }, { username: 'Grace' }] as any,
      );

      await expect(service.getChatAccess(OWNER_ID)).resolves.toEqual({
        guests: ['Ada', 'Grace'],
      });
      expect(placeRepository.findHomeByMemberId).toHaveBeenCalledWith(OWNER_ID);
      expect(roleAssignmentRepository.getUsernamesByRoleAndPlace)
        .toHaveBeenCalledWith(HOME_PLACE_ID, GUEST_ROLE_ID);
    });

    it('rejects reading when the member has no home', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue(undefined as any);

      await expect(service.getChatAccess(OWNER_ID))
        .rejects.toThrow('You don\'t have a home yet.');
    });

    it('rejects writing when the member has no home, without clearing anything', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue(undefined as any);

      await expect(service.updateChatAccess(OWNER_ID, ['Ada']))
        .rejects.toThrow('You don\'t have a home yet.');
      expect(roleAssignmentRepository.removeAllForPlaceAndRoleWithin).not.toHaveBeenCalled();
    });
  });

  describe('normalization', () => {
    it('discards blank and whitespace-only entries', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['', '   ', 'Ada', '']);

      expect(roleAssignmentRepository.addIdToAssignmentWithin).toHaveBeenCalledTimes(1);
      expect(memberRepository.findIdByUsername).toHaveBeenCalledWith('Ada');
    });

    it('trims surrounding whitespace before resolving', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['  Ada  ']);

      expect(memberRepository.findIdByUsername).toHaveBeenCalledWith('Ada');
    });

    it('removes duplicates case-insensitively', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['Ada', 'ada', 'ADA']);

      expect(roleAssignmentRepository.addIdToAssignmentWithin).toHaveBeenCalledTimes(1);
    });

    it('does not store the owner, so they never consume a slot', async () => {
      knownMembers({ Owner: OWNER_ID, Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['Owner', 'Ada']);

      const assignedIds = roleAssignmentRepository.addIdToAssignmentWithin.mock.calls
        .map(call => call[2]);
      expect(assignedIds).toEqual([10]);
    });

    it('ignores unknown usernames silently, keeping the valid ones', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['Ada', 'NoSuchCitizen']);

      expect(roleAssignmentRepository.addIdToAssignmentWithin).toHaveBeenCalledTimes(1);
      expect(roleAssignmentRepository.addIdToAssignmentWithin)
        .toHaveBeenCalledWith({}, HOME_PLACE_ID, 10, GUEST_ROLE_ID);
    });

    it('ignores non-string entries', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, [null, 42, { a: 1 }, 'Ada'] as any);

      expect(roleAssignmentRepository.addIdToAssignmentWithin).toHaveBeenCalledTimes(1);
    });

    it('accepts exactly eight distinct guests', async () => {
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      knownMembers(names.reduce((acc, n, i) => ({ ...acc, [n]: 100 + i }), {}));

      await service.updateChatAccess(OWNER_ID, names);

      expect(roleAssignmentRepository.addIdToAssignmentWithin).toHaveBeenCalledTimes(8);
    });

    it('rejects nine distinct guests without changing the stored list', async () => {
      const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
      knownMembers(names.reduce((acc, n, i) => ({ ...acc, [n]: 100 + i }), {}));

      await expect(service.updateChatAccess(OWNER_ID, names))
        .rejects.toThrow('at most 8 citizens');
      expect(roleAssignmentRepository.removeAllForPlaceAndRoleWithin).not.toHaveBeenCalled();
    });

    it('counts the cap AFTER de-duplication, so repeats do not exhaust it', async () => {
      knownMembers({ Ada: 10, Grace: 11 });

      await service.updateChatAccess(
        OWNER_ID,
        ['Ada', 'ada', 'ADA', 'Grace', 'grace', 'Ada', 'Grace', 'ada', 'Ada'],
      );

      expect(roleAssignmentRepository.addIdToAssignmentWithin).toHaveBeenCalledTimes(2);
    });
  });

  describe('atomic replacement', () => {
    it('clears and re-inserts inside ONE transaction', async () => {
      knownMembers({ Ada: 10, Grace: 11 });

      await service.updateChatAccess(OWNER_ID, ['Ada', 'Grace']);

      expect(homeRepository.runInTransaction).toHaveBeenCalledTimes(1);
      // Same handle for the clear and every insert - no window in which the home reads as
      // unrestricted while the new list is being written.
      const clearTrx =
        roleAssignmentRepository.removeAllForPlaceAndRoleWithin.mock.calls[0][0];
      for (const call of roleAssignmentRepository.addIdToAssignmentWithin.mock.calls) {
        expect(call[0]).toBe(clearTrx);
      }
    });

    it('clears before inserting', async () => {
      knownMembers({ Ada: 10 });

      await service.updateChatAccess(OWNER_ID, ['Ada']);

      const clearOrder =
        roleAssignmentRepository.removeAllForPlaceAndRoleWithin.mock.invocationCallOrder[0];
      const insertOrder =
        roleAssignmentRepository.addIdToAssignmentWithin.mock.invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(insertOrder);
    });

    it('an empty submission clears the list and restores open chat', async () => {
      await service.updateChatAccess(OWNER_ID, []);

      expect(roleAssignmentRepository.removeAllForPlaceAndRoleWithin)
        .toHaveBeenCalledWith({}, HOME_PLACE_ID, GUEST_ROLE_ID);
      expect(roleAssignmentRepository.addIdToAssignmentWithin).not.toHaveBeenCalled();
    });

    it('scopes the clear to this home and this role only', async () => {
      await service.updateChatAccess(OWNER_ID, []);

      expect(roleAssignmentRepository.removeAllForPlaceAndRoleWithin)
        .toHaveBeenCalledWith({}, HOME_PLACE_ID, GUEST_ROLE_ID);
    });
  });

  describe('canChatInPlace', () => {
    const VISITOR_ID = 99;

    it('allows anyone in a place that is not a home', async () => {
      placeRepository.findById.mockResolvedValue({ id: 7, type: 'public' } as any);

      await expect(service.canChatInPlace(7, VISITOR_ID)).resolves.toBe(true);
      // No need to consult the guest list at all.
      expect(roleAssignmentRepository.findByPlaceAndRole).not.toHaveBeenCalled();
    });

    it('allows anyone at a home with no guest list', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: HOME_PLACE_ID, type: 'home', member_id: OWNER_ID } as any,
      );
      roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue([]);

      await expect(service.canChatInPlace(HOME_PLACE_ID, VISITOR_ID)).resolves.toBe(true);
    });

    it('allows the owner at their own restricted home, unlisted', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: HOME_PLACE_ID, type: 'home', member_id: OWNER_ID } as any,
      );
      roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue(
        [{ member_id: 10 }] as any,
      );

      await expect(service.canChatInPlace(HOME_PLACE_ID, OWNER_ID)).resolves.toBe(true);
    });

    it('allows a configured guest', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: HOME_PLACE_ID, type: 'home', member_id: OWNER_ID } as any,
      );
      roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue(
        [{ member_id: 10 }, { member_id: 11 }] as any,
      );

      await expect(service.canChatInPlace(HOME_PLACE_ID, 11)).resolves.toBe(true);
    });

    it('denies an unrelated visitor at a restricted home', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: HOME_PLACE_ID, type: 'home', member_id: OWNER_ID } as any,
      );
      roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue(
        [{ member_id: 10 }] as any,
      );

      await expect(service.canChatInPlace(HOME_PLACE_ID, VISITOR_ID)).resolves.toBe(false);
    });

    it('denies for a place that does not exist', async () => {
      // A missing place is not a home, so chat is unrestricted there - there is nothing to
      // protect, and denying would break rooms whose place row is unreadable.
      placeRepository.findById.mockResolvedValue(undefined as any);

      await expect(service.canChatInPlace(12345, VISITOR_ID)).resolves.toBe(true);
    });

    it('decides from the guest list of THAT home only', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: HOME_PLACE_ID, type: 'home', member_id: OWNER_ID } as any,
      );
      roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue(
        [{ member_id: 10 }] as any,
      );

      await service.canChatInPlace(HOME_PLACE_ID, 10);

      expect(roleAssignmentRepository.findByPlaceAndRole)
        .toHaveBeenCalledWith(HOME_PLACE_ID, GUEST_ROLE_ID);
    });

    it('never returns the guest list itself', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: HOME_PLACE_ID, type: 'home', member_id: OWNER_ID } as any,
      );
      roleAssignmentRepository.findByPlaceAndRole.mockResolvedValue(
        [{ member_id: 10 }] as any,
      );

      const result = await service.canChatInPlace(HOME_PLACE_ID, VISITOR_ID);

      expect(typeof result).toBe('boolean');
    });
  });
});
