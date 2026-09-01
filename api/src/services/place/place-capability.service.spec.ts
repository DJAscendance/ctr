/*
 * Importing the repository barrel eagerly constructs a real knex instance, and
 * this project ships no knex configuration for the test environment. These
 * specs only ever exercise mocked repositories, so the db module is stubbed out
 * before anything can pull the real one in.
 */
jest.mock('../../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceCapabilityService } from './place-capability.service';
import {
  MapLocationRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';
import { MapLocation, Place, RoleAssignment } from '../../types/models';

/*
 * The expectations below are the behaviour of the historical software, read off the
 * running IVN11 guests on 2026-08-31. The classic `place`/`neighbor`/`block` CGIs share
 * one resolver, `chDBCheckRights`, and it walks to the parent place for exactly one
 * capability - the right to change access rights - and for nothing else. Observed:
 *
 *   Block Leader   at own block     -> Update YES, Access Rights YES
 *   Block Deputy   at own block     -> Update YES, Access Rights NO
 *   Block Leader   at sibling block -> neither
 *   Hood Leader    at child block   -> Update NO,  Access Rights YES
 *   Colony Leader  at child hood    -> Update NO,  Access Rights YES
 *   Colony Leader  at grandchild    -> Update NO,  Access Rights YES
 *   Colony Leader  at other colony  -> neither
 */
describe('PlaceCapabilityService', () => {
  const COLONY_ID = 10;
  const OTHER_COLONY_ID = 11;
  const HOOD_ID = 20;
  const SIBLING_HOOD_ID = 21;
  const BLOCK_ID = 30;
  const SIBLING_BLOCK_ID = 31;
  const OTHER_HOOD_BLOCK_ID = 32;

  const MEMBER_ID = 500;

  const roleMap = {
    Admin: 1,
    ColonyRepresentative: 2,
    ColonyLeader: 3,
    ColonyDeputy: 4,
    NeighborhoodLeader: 5,
    NeighborhoodDeputy: 6,
    BlockLeader: 7,
    BlockDeputy: 8,
    Concierge: 9,
  };

  const places: Record<number, Partial<Place>> = {
    [COLONY_ID]: { id: COLONY_ID, type: 'colony' },
    [OTHER_COLONY_ID]: { id: OTHER_COLONY_ID, type: 'colony' },
    [HOOD_ID]: { id: HOOD_ID, type: 'hood' },
    [SIBLING_HOOD_ID]: { id: SIBLING_HOOD_ID, type: 'hood' },
    [BLOCK_ID]: { id: BLOCK_ID, type: 'block' },
    [SIBLING_BLOCK_ID]: { id: SIBLING_BLOCK_ID, type: 'block' },
    [OTHER_HOOD_BLOCK_ID]: { id: OTHER_HOOD_BLOCK_ID, type: 'block' },
  };

  /* colony 10 -> hoods 20, 21; hood 20 -> blocks 30, 31; hood 21 -> block 32. */
  const parents: Record<number, number> = {
    [HOOD_ID]: COLONY_ID,
    [SIBLING_HOOD_ID]: COLONY_ID,
    [BLOCK_ID]: HOOD_ID,
    [SIBLING_BLOCK_ID]: HOOD_ID,
    [OTHER_HOOD_BLOCK_ID]: SIBLING_HOOD_ID,
  };

  const assignment = (roleId: number, placeId: number): RoleAssignment =>
    ({ member_id: MEMBER_ID, role_id: roleId, place_id: placeId } as RoleAssignment);

  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let service: PlaceCapabilityService;

  /** Points the member's role assignments at the given list for this test. */
  const givenAssignments = (assignments: RoleAssignment[]): void => {
    roleAssignmentRepository.getByMemberId.mockResolvedValue(assignments);
  };

  beforeEach(() => {
    mapLocationRepository = createSpyObj(MapLocationRepository);
    placeRepository = createSpyObj(PlaceRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);

    roleRepository.awaitRoleMap.mockResolvedValue({ ...roleMap });

    placeRepository.findById.mockImplementation(
      async (placeId: number) => places[placeId] as Place,
    );
    mapLocationRepository.findPlaceIdMapLocation.mockImplementation(
      async (placeId: number) =>
        (parents[placeId]
          ? ({ place_id: placeId, parent_place_id: parents[placeId] } as MapLocation)
          : undefined) as MapLocation,
    );
    givenAssignments([]);

    Container.reset();
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(PlaceRepository, placeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    service = Container.get(PlaceCapabilityService);
  });

  describe('a member with no relevant authority', () => {
    it('denies an ordinary member with no role assignments at all', async () => {
      givenAssignments([]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a member whose only role is unrelated to places', async () => {
      givenAssignments([assignment(roleMap.Concierge, BLOCK_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies an unknown role id, even when it is scoped to the place', async () => {
      givenAssignments([assignment(9999, BLOCK_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a leader role that is not scoped to any place', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, null as unknown as number)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });
  });

  describe('authority at the member\'s own place', () => {
    it('grants a block leader both capabilities at their own block', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, BLOCK_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });

    it('grants a block deputy admin only, never access rights', async () => {
      givenAssignments([assignment(roleMap.BlockDeputy, BLOCK_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: false,
      });
    });

    it('grants a neighborhood leader both capabilities at their own neighborhood', async () => {
      givenAssignments([assignment(roleMap.NeighborhoodLeader, HOOD_ID)]);
      expect(await service.resolve(HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });

    it('grants a neighborhood deputy admin only at their own neighborhood', async () => {
      givenAssignments([assignment(roleMap.NeighborhoodDeputy, HOOD_ID)]);
      expect(await service.resolve(HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: false,
      });
    });

    it('grants a colony leader both capabilities at their own colony', async () => {
      givenAssignments([assignment(roleMap.ColonyLeader, COLONY_ID)]);
      expect(await service.resolve(COLONY_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });

    it('grants a colony deputy admin only at their own colony', async () => {
      givenAssignments([assignment(roleMap.ColonyDeputy, COLONY_ID)]);
      expect(await service.resolve(COLONY_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: false,
      });
    });

    it('denies a leader whose role is scoped to the wrong level of place', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, HOOD_ID)]);
      expect(await service.resolve(HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });
  });

  describe('authority does not widen sideways or upwards', () => {
    it('denies a block leader everything at a sibling block in the same neighborhood', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, BLOCK_ID)]);
      expect(await service.resolve(SIBLING_BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a block leader everything at a block in another neighborhood', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, BLOCK_ID)]);
      expect(await service.resolve(OTHER_HOOD_BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a block leader everything at their own parent neighborhood', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, BLOCK_ID)]);
      expect(await service.resolve(HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a neighborhood leader everything at a sibling neighborhood', async () => {
      givenAssignments([assignment(roleMap.NeighborhoodLeader, HOOD_ID)]);
      expect(await service.resolve(SIBLING_HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a neighborhood leader everything at a block in a sibling neighborhood', async () => {
      givenAssignments([assignment(roleMap.NeighborhoodLeader, HOOD_ID)]);
      expect(await service.resolve(OTHER_HOOD_BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a colony leader everything at an unrelated colony', async () => {
      givenAssignments([assignment(roleMap.ColonyLeader, COLONY_ID)]);
      expect(await service.resolve(OTHER_COLONY_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });
  });

  describe('only access rights are inherited down the tree', () => {
    it('gives a neighborhood leader access rights but no admin at a child block', async () => {
      givenAssignments([assignment(roleMap.NeighborhoodLeader, HOOD_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives a neighborhood deputy access rights but no admin at a child block', async () => {
      givenAssignments([assignment(roleMap.NeighborhoodDeputy, HOOD_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives a colony leader access rights but no admin at a child neighborhood', async () => {
      givenAssignments([assignment(roleMap.ColonyLeader, COLONY_ID)]);
      expect(await service.resolve(HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives a colony leader access rights but no admin at a grandchild block', async () => {
      givenAssignments([assignment(roleMap.ColonyLeader, COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives a colony deputy access rights but no admin at a grandchild block', async () => {
      givenAssignments([assignment(roleMap.ColonyDeputy, COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('keeps admin from the place itself while inheriting nothing extra', async () => {
      givenAssignments([
        assignment(roleMap.BlockDeputy, BLOCK_ID),
        assignment(roleMap.ColonyLeader, COLONY_ID),
      ]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });
  });

  describe('a global administrator', () => {
    it('grants an Admin both capabilities at any place', async () => {
      givenAssignments([assignment(roleMap.Admin, OTHER_COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });

    it('grants an Admin both capabilities at every level of the tree', async () => {
      givenAssignments([assignment(roleMap.Admin, null as unknown as number)]);
      for (const placeId of [COLONY_ID, OTHER_COLONY_ID, HOOD_ID, BLOCK_ID]) {
        expect(await service.resolve(placeId, MEMBER_ID)).toEqual({
          canAdmin: true,
          canManageAccess: true,
        });
      }
    });
  });

  /*
   * Owner decision, 2026-08-31: Colony Representative is a deputy over every colony, not a
   * global administrator. It therefore resolves the way authority held above a place
   * already resolves - access rights across the whole tree, and no admin anywhere.
   */
  describe('a colony-wide deputy', () => {
    it('gives a Colony Representative access rights but no admin at a colony', async () => {
      givenAssignments([assignment(roleMap.ColonyRepresentative, null as unknown as number)]);
      expect(await service.resolve(COLONY_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives the same result at a second, unrelated colony', async () => {
      givenAssignments([assignment(roleMap.ColonyRepresentative, null as unknown as number)]);
      expect(await service.resolve(OTHER_COLONY_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives access rights but no admin at a neighborhood under a colony', async () => {
      givenAssignments([assignment(roleMap.ColonyRepresentative, null as unknown as number)]);
      expect(await service.resolve(HOOD_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('gives access rights but no admin at a block under a colony', async () => {
      givenAssignments([assignment(roleMap.ColonyRepresentative, null as unknown as number)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('never grants admin at any place on the tree', async () => {
      givenAssignments([assignment(roleMap.ColonyRepresentative, COLONY_ID)]);
      for (const placeId of [
        COLONY_ID,
        OTHER_COLONY_ID,
        HOOD_ID,
        SIBLING_HOOD_ID,
        BLOCK_ID,
        SIBLING_BLOCK_ID,
        OTHER_HOOD_BLOCK_ID,
      ]) {
        expect(await service.resolve(placeId, MEMBER_ID)).toEqual({
          canAdmin: false,
          canManageAccess: true,
        });
      }
    });

    it('resolves the same whichever place the assignment names', async () => {
      givenAssignments([assignment(roleMap.ColonyRepresentative, OTHER_COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('grants nothing at a place that is not on the geographic tree', async () => {
      placeRepository.findById.mockResolvedValue({ id: 77, type: 'club' } as Place);
      givenAssignments([assignment(roleMap.ColonyRepresentative, null as unknown as number)]);
      expect(await service.resolve(77, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('grants nothing once the role is no longer held', async () => {
      givenAssignments([assignment(roleMap.Concierge, null as unknown as number)]);
      expect(await service.resolve(COLONY_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });
  });

  describe('a colony-wide deputy who also holds a local office', () => {
    it('adds the local block deputy\'s admin to the colony-wide access rights', async () => {
      givenAssignments([
        assignment(roleMap.ColonyRepresentative, null as unknown as number),
        assignment(roleMap.BlockDeputy, BLOCK_ID),
      ]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });

    it('keeps the local block leader\'s full authority at their own block', async () => {
      givenAssignments([
        assignment(roleMap.ColonyRepresentative, null as unknown as number),
        assignment(roleMap.BlockLeader, BLOCK_ID),
      ]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: true,
        canManageAccess: true,
      });
    });

    it('does not carry the local office sideways to a sibling block', async () => {
      givenAssignments([
        assignment(roleMap.ColonyRepresentative, null as unknown as number),
        assignment(roleMap.BlockDeputy, BLOCK_ID),
      ]);
      expect(await service.resolve(SIBLING_BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: true,
      });
    });

    it('adds nothing at a place that is not on the geographic tree', async () => {
      placeRepository.findById.mockResolvedValue({ id: 77, type: 'club' } as Place);
      givenAssignments([
        assignment(roleMap.ColonyRepresentative, null as unknown as number),
        assignment(roleMap.BlockDeputy, 77),
      ]);
      expect(await service.resolve(77, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });
  });

  describe('malformed input fails closed', () => {
    it('denies a place id that does not exist', async () => {
      givenAssignments([assignment(roleMap.BlockLeader, BLOCK_ID)]);
      expect(await service.resolve(9999, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies a place whose type is not on the geographic tree', async () => {
      placeRepository.findById.mockResolvedValue({ id: 77, type: 'club' } as Place);
      givenAssignments([assignment(roleMap.BlockLeader, 77)]);
      expect(await service.resolve(77, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it.each([0, -1, NaN, 1.5])('denies place id %p', async (placeId: number) => {
      givenAssignments([assignment(roleMap.Admin, COLONY_ID)]);
      expect(await service.resolve(placeId, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it.each([0, -1, NaN, 1.5])('denies member id %p', async (memberId: number) => {
      givenAssignments([assignment(roleMap.Admin, COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, memberId)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('denies when the role map has not been populated yet', async () => {
      roleRepository.awaitRoleMap.mockResolvedValue({});
      givenAssignments([assignment(roleMap.BlockLeader, BLOCK_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('stops the walk when a block is mislinked straight to a colony', async () => {
      mapLocationRepository.findPlaceIdMapLocation.mockImplementation(
        async (placeId: number) =>
          (placeId === BLOCK_ID
            ? ({ place_id: BLOCK_ID, parent_place_id: COLONY_ID } as MapLocation)
            : undefined) as MapLocation,
      );
      givenAssignments([assignment(roleMap.ColonyLeader, COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });

    it('stops the walk when the map locations form a cycle', async () => {
      mapLocationRepository.findPlaceIdMapLocation.mockImplementation(
        async (placeId: number) =>
          ({
            place_id: placeId,
            parent_place_id: placeId === BLOCK_ID ? HOOD_ID : BLOCK_ID,
          } as MapLocation),
      );
      givenAssignments([assignment(roleMap.ColonyLeader, COLONY_ID)]);
      expect(await service.resolve(BLOCK_ID, MEMBER_ID)).toEqual({
        canAdmin: false,
        canManageAccess: false,
      });
    });
  });
});
