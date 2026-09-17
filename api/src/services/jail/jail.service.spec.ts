import { createSpyObj } from 'jest-createspyobj';

// See admin.controller.authorization.spec.ts - reaching a service through the barrel builds
// every repository against a real connection unless the db module is stubbed first.
jest.mock('../../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { JailService } from './jail.service';
import { BanRepository } from '../../repositories/ban/ban.repository';
import { PlaceRepository } from '../../repositories/place/place.repository';
import { RoleRepository } from '../../repositories/role/role.repository';
import {
  RoleAssignmentRepository,
} from '../../repositories/role-assignment/role-assignment.repository';

const JAIL_PLACE_ID = 77;

/**
 * A role map shaped like the real one: names with whitespace stripped, ids that are NOT the
 * ids any earlier version of this codebase hardcoded.
 *
 * The odd numbering is the point. If a future change reaches for a literal id instead of a
 * name, these tests fail, which is the enforcement mechanism for "no hardcoded role ids".
 */
const ROLE_MAP: Record<string, number> = {
  Admin: 901,
  SecurityCommissioner: 902,
  SecurityChief: 903,
  DeputySecurityChief: 904,
  SecurityCaptain: 905,
  SecurityLieutenant: 906,
  SecuritySergeant: 907,
  SecurityOfficer: 908,
  SecurityAdvisor: 909,
  LeadJailGuard: 910,
  JailGuard: 911,
  Mayor: 950,
  Citizen: 951,
};

describe('JailService', () => {
  let banRepository: jest.Mocked<BanRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let service: JailService;

  beforeEach(() => {
    banRepository = createSpyObj(BanRepository);
    placeRepository = createSpyObj(PlaceRepository);
    roleRepository = createSpyObj(RoleRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    service = new JailService(
      banRepository, placeRepository, roleRepository, roleAssignmentRepository,
    );

    roleRepository.awaitRoleMap.mockResolvedValue(ROLE_MAP as never);
    placeRepository.findBySlug.mockResolvedValue({ id: JAIL_PLACE_ID } as never);
    banRepository.hasActiveJailBan.mockResolvedValue(false as never);
    roleAssignmentRepository.getByMemberId.mockResolvedValue([] as never);
  });

  describe('isInmate', () => {
    it('is a live jail ban and nothing else', async () => {
      banRepository.hasActiveJailBan.mockResolvedValue(true as never);
      expect(await service.isInmate(5)).toBe(true);
      expect(banRepository.hasActiveJailBan).toHaveBeenCalledWith(5);
    });

    it('is false once the sentence is gone', async () => {
      banRepository.hasActiveJailBan.mockResolvedValue(false as never);
      expect(await service.isInmate(5)).toBe(false);
    });

    it('never asks about a member id of zero', async () => {
      expect(await service.isInmate(0)).toBe(false);
      expect(banRepository.hasActiveJailBan).not.toHaveBeenCalled();
    });

    it('does not consult roles, places or assignments', async () => {
      await service.isInmate(5);
      expect(roleAssignmentRepository.getByMemberId).not.toHaveBeenCalled();
      expect(placeRepository.findBySlug).not.toHaveBeenCalled();
    });
  });

  describe('isStaff', () => {
    it.each(JailService.JAIL_AUTHORITY_ROLES.map(name => [name]))(
      'accepts %s',
      async (roleName: string) => {
        roleAssignmentRepository.getByMemberId.mockResolvedValue(
          [{ role_id: ROLE_MAP[roleName] }] as never,
        );
        expect(await service.isStaff(5)).toBe(true);
      },
    );

    it('refuses an office that is not Security or Jail', async () => {
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ role_id: ROLE_MAP.Mayor }, { role_id: ROLE_MAP.Citizen }] as never,
      );
      expect(await service.isStaff(5)).toBe(false);
    });

    it('refuses a member with no office at all', async () => {
      expect(await service.isStaff(5)).toBe(false);
    });

    it('asks the role map for every name it is about to read', async () => {
      await service.isStaff(5);
      expect(roleRepository.awaitRoleMap).toHaveBeenCalledWith(
        ...JailService.JAIL_AUTHORITY_ROLES,
      );
    });

    it('refuses everyone rather than guessing when no office resolves to an id', async () => {
      // The startup window: the role table has not been seeded, so every name is missing.
      // Refusing is correct; the alternative is comparing against a list of undefineds,
      // which would let any assignment whose role_id is undefined through.
      roleRepository.awaitRoleMap.mockResolvedValue({} as never);
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ role_id: undefined }] as never,
      );
      expect(await service.isStaff(5)).toBe(false);
    });
  });

  describe('applyWorldForMember', () => {
    const jailPlace = { id: JAIL_PLACE_ID, world_filename: 'vrml/jail.wrl' };

    it('serves an inmate the prisoner world', async () => {
      banRepository.hasActiveJailBan.mockResolvedValue(true as never);
      const place = await service.applyWorldForMember(jailPlace, 5);
      expect(place.world_filename).toBe(JailService.WORLD_INMATE);
    });

    it('serves staff the staff world', async () => {
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ role_id: ROLE_MAP.JailGuard }] as never,
      );
      const place = await service.applyWorldForMember(jailPlace, 5);
      expect(place.world_filename).toBe(JailService.WORLD_STAFF);
    });

    it('serves an ordinary visitor the visitor world', async () => {
      const place = await service.applyWorldForMember(jailPlace, 5);
      expect(place.world_filename).toBe(JailService.WORLD_VISITOR);
    });

    it('serves an unidentified caller the visitor world', async () => {
      const place = await service.applyWorldForMember(jailPlace, undefined);
      expect(place.world_filename).toBe(JailService.WORLD_VISITOR);
    });

    it('serves a JAILED guard the prisoner world, not the staff world', async () => {
      // A sentence outranks an office. Otherwise a guard could be sentenced and then walk
      // straight out of their own cell.
      banRepository.hasActiveJailBan.mockResolvedValue(true as never);
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ role_id: ROLE_MAP.SecurityChief }] as never,
      );
      const place = await service.applyWorldForMember(jailPlace, 5);
      expect(place.world_filename).toBe(JailService.WORLD_INMATE);
    });

    it('never answers with the seeded, barrier-free world file', async () => {
      const seen = new Set<string>();
      for (const inmate of [true, false]) {
        for (const staff of [true, false]) {
          banRepository.hasActiveJailBan.mockResolvedValue(inmate as never);
          roleAssignmentRepository.getByMemberId.mockResolvedValue(
            (staff ? [{ role_id: ROLE_MAP.JailGuard }] : []) as never,
          );
          const place = await service.applyWorldForMember(jailPlace, 5);
          seen.add(place.world_filename);
        }
      }
      expect(seen.has('vrml/jail.wrl')).toBe(false);
    });

    it('leaves every other place untouched', async () => {
      const elsewhere = { id: 1234, world_filename: 'vrml/plaza.wrl' };
      const place = await service.applyWorldForMember(elsewhere, 5);
      expect(place).toEqual(elsewhere);
    });

    it('copies rather than mutating, so a cached row is not rewritten', async () => {
      const original = { ...jailPlace };
      await service.applyWorldForMember(jailPlace, 5);
      expect(jailPlace).toEqual(original);
    });
  });

  describe('getStanding', () => {
    it('reports both facts independently', async () => {
      banRepository.hasActiveJailBan.mockResolvedValue(true as never);
      roleAssignmentRepository.getByMemberId.mockResolvedValue(
        [{ role_id: ROLE_MAP.JailGuard }] as never,
      );
      expect(await service.getStanding(5)).toEqual({
        inmate: true, staff: true, jailPlaceId: JAIL_PLACE_ID,
      });
    });
  });
});
