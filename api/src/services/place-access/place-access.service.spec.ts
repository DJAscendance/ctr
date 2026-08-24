import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceAccessService } from './place-access.service';
import {
  MapLocationRepository,
  PlaceRepository,
  PlaceRoleAccessRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';

describe('PlaceAccessService', () => {
  const PLACE_ID = 42;
  const MEMBER_ID = 11;
  const OWNER_CODE = 18;
  const DEPUTY_CODE = 19;

  /** Role ids as the seeds would produce them -- arbitrary, resolved by name. */
  const ROLE_IDS: Record<string, number> = {
    Admin: 1,
    ColonyRepresentative: 2,
    ColonyLeader: 3,
    ColonyDeputy: 4,
    NeighborhoodLeader: 5,
    NeighborhoodDeputy: 6,
    BlockLeader: 7,
    BlockDeputy: 8,
  };
  const COLONY_ID = 100;
  const HOOD_ID = 200;
  const BLOCK_ID = 300;

  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let placeRoleAccessRepository: jest.Mocked<PlaceRoleAccessRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let service: PlaceAccessService;

  /** Nobody in the identity slots, no role grants: the unconfigured baseline. */
  const emptyAccess = () => {
    roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({ owner: [], deputies: [] });
    placeRoleAccessRepository.memberHasGrantedRole.mockResolvedValue(false);
    placeRoleAccessRepository.getRoleIdsByPlace.mockResolvedValue([]);
    roleAssignmentRepository.getByMemberId.mockResolvedValue([]);
  };

  /** block(300) inside hood(200) inside colony(100), wired through map_location. */
  const geography = (blockType = 'block') => {
    const places: Record<number, { id: number; type: string }> = {
      [BLOCK_ID]: { id: BLOCK_ID, type: blockType },
      [HOOD_ID]: { id: HOOD_ID, type: 'hood' },
      [COLONY_ID]: { id: COLONY_ID, type: 'colony' },
    };
    const parents: Record<number, number> = { [BLOCK_ID]: HOOD_ID, [HOOD_ID]: COLONY_ID };
    placeRepository.findById.mockImplementation(
      async (id: number) => places[id] as any,
    );
    mapLocationRepository.findPlaceIdMapLocation.mockImplementation(
      async (id: number) => ({ parent_place_id: parents[id] }) as any,
    );
  };

  beforeEach(() => {
    mapLocationRepository = createSpyObj(MapLocationRepository);
    placeRepository = createSpyObj(PlaceRepository);
    placeRoleAccessRepository = createSpyObj(PlaceRoleAccessRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    roleRepository.awaitRoleMap.mockResolvedValue(ROLE_IDS);
    Container.reset();
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(PlaceRepository, placeRepository);
    Container.set(PlaceRoleAccessRepository, placeRoleAccessRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    service = Container.get(PlaceAccessService);
    emptyAccess();
    geography();
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  describe('canWrite', () => {
    describe('when the member is the owner', () => {
      it('allows, without consulting the role grants', async () => {
        roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({
          owner: [{ member_id: MEMBER_ID }], deputies: [],
        });
        const result = await service.canWrite(PLACE_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: true, reason: 'owner' });
        expect(placeRoleAccessRepository.memberHasGrantedRole).not.toHaveBeenCalled();
      });
    });

    describe('when the member is a deputy', () => {
      it('allows', async () => {
        roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({
          owner: [{ member_id: 999 }], deputies: [{ member_id: MEMBER_ID }],
        });
        const result = await service.canWrite(PLACE_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: true, reason: 'deputy' });
      });
    });

    /** The whole point of the axis: grant by role, not by naming individuals. */
    describe('when the member holds a granted role but is neither owner nor deputy', () => {
      it('allows via the role grant', async () => {
        roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({
          owner: [{ member_id: 999 }], deputies: [],
        });
        placeRoleAccessRepository.memberHasGrantedRole.mockResolvedValue(true);
        const result = await service.canWrite(PLACE_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: true, reason: 'role-grant' });
      });
    });

    /**
     * The shipped UI's rule: if no nickname and no role is set, all members may write.
     * Faithful to the original, and the reason canWrite refuses a falsy member id.
     */
    describe('when neither axis is configured', () => {
      it('allows any member', async () => {
        const result = await service.canWrite(PLACE_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: true, reason: 'unrestricted' });
      });
    });

    describe('when the place is configured and the member matches nothing', () => {
      it('denies', async () => {
        roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({
          owner: [{ member_id: 999 }], deputies: [{ member_id: 998 }],
        });
        const result = await service.canWrite(PLACE_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: false, reason: 'denied' });
      });

      it('denies when only a role grant is configured and the member lacks it', async () => {
        placeRoleAccessRepository.getRoleIdsByPlace.mockResolvedValue([OWNER_CODE]);
        const result = await service.canWrite(PLACE_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: false, reason: 'denied' });
      });
    });

    /**
     * A visitor must never benefit from the open default. The original gives an
     * unauthenticated caller only the Visitor bit, which satisfies nothing.
     */
    describe('when there is no member id (a visitor)', () => {
      it('denies even on a completely unconfigured place', async () => {
        const result = await service.canWrite(PLACE_ID, 0, OWNER_CODE, DEPUTY_CODE);
        expect(result).toEqual({ allowed: false, reason: 'denied' });
        expect(roleAssignmentRepository.getAccessInfoByID).not.toHaveBeenCalled();
      });
    });
  });

  describe('memberHasGrantedRole', () => {
    it('is false without a member id, and does not hit the database', async () => {
      expect(await service.memberHasGrantedRole(PLACE_ID, 0)).toBe(false);
      expect(placeRoleAccessRepository.memberHasGrantedRole).not.toHaveBeenCalled();
    });
  });

  describe('getAncestry', () => {
    it('walks block -> hood -> colony and stops at the colony', async () => {
      expect(await service.getAncestry(BLOCK_ID)).toEqual([
        { id: BLOCK_ID, type: 'block' },
        { id: HOOD_ID, type: 'hood' },
        { id: COLONY_ID, type: 'colony' },
      ]);
    });

    /**
     * The research notes are specific that city, office and club places do not recurse, so
     * a colony leader must not gain authority inside a club merely because it sits beneath
     * them in the map.
     */
    it('does not recurse out of a club', async () => {
      geography('club');
      expect(await service.getAncestry(BLOCK_ID)).toEqual([{ id: BLOCK_ID, type: 'club' }]);
    });

    it('terminates on a cycle rather than looping', async () => {
      placeRepository.findById.mockImplementation(
        async (id: number) => ({ id, type: 'block' }) as any,
      );
      mapLocationRepository.findPlaceIdMapLocation.mockImplementation(
        async () => ({ parent_place_id: BLOCK_ID }) as any,
      );
      const chain = await service.getAncestry(BLOCK_ID);
      expect(chain).toEqual([{ id: BLOCK_ID, type: 'block' }]);
    });
  });

  describe('hasGeographicAuthority', () => {
    const holding = (roleId: number, placeId: number | null) =>
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ member_id: MEMBER_ID, role_id: roleId, place_id: placeId }] as any,
      );

    /** The point of the whole task: authority flows downward. */
    it('grants a colony leader authority over a block beneath them', async () => {
      holding(ROLE_IDS.ColonyLeader, COLONY_ID);
      expect(await service.hasGeographicAuthority(BLOCK_ID, MEMBER_ID)).toBe(true);
    });

    it('grants a hood deputy authority over a block beneath them', async () => {
      holding(ROLE_IDS.NeighborhoodDeputy, HOOD_ID);
      expect(await service.hasGeographicAuthority(BLOCK_ID, MEMBER_ID)).toBe(true);
    });

    it('grants a block leader authority over their own block', async () => {
      holding(ROLE_IDS.BlockLeader, BLOCK_ID);
      expect(await service.hasGeographicAuthority(BLOCK_ID, MEMBER_ID)).toBe(true);
    });

    /** Authority must not flow the other way. */
    it('denies a block leader authority over the hood above them', async () => {
      holding(ROLE_IDS.BlockLeader, BLOCK_ID);
      expect(await service.hasGeographicAuthority(HOOD_ID, MEMBER_ID)).toBe(false);
    });

    /** An office is scoped to its own place, not to the level generally. */
    it('denies a leader of a different colony', async () => {
      holding(ROLE_IDS.ColonyLeader, 999);
      expect(await service.hasGeographicAuthority(BLOCK_ID, MEMBER_ID)).toBe(false);
    });

    it('grants global Admin everywhere, without walking the tree', async () => {
      holding(ROLE_IDS.Admin, null);
      expect(await service.hasGeographicAuthority(BLOCK_ID, MEMBER_ID)).toBe(true);
      expect(placeRepository.findById).not.toHaveBeenCalled();
    });

    it('denies a member holding no roles', async () => {
      expect(await service.hasGeographicAuthority(BLOCK_ID, MEMBER_ID)).toBe(false);
    });

    it('denies a visitor without querying', async () => {
      expect(await service.hasGeographicAuthority(BLOCK_ID, 0)).toBe(false);
      expect(roleAssignmentRepository.getByMemberId).not.toHaveBeenCalled();
    });
  });

  describe('canWrite with inherited authority', () => {
    it('allows a colony leader to write in a block owned by someone else', async () => {
      roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({
        owner: [{ member_id: 999 }], deputies: [],
      });
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ member_id: MEMBER_ID, role_id: ROLE_IDS.ColonyLeader, place_id: COLONY_ID }] as any,
      );
      const result = await service.canWrite(BLOCK_ID, MEMBER_ID, OWNER_CODE, DEPUTY_CODE);
      expect(result).toEqual({ allowed: true, reason: 'inherited' });
    });
  });
});
