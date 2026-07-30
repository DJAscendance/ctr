import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceAccessService } from './place-access.service';
import {
  PlaceRoleAccessRepository,
  RoleAssignmentRepository,
} from '../../repositories';

describe('PlaceAccessService', () => {
  const PLACE_ID = 42;
  const MEMBER_ID = 11;
  const OWNER_CODE = 18;
  const DEPUTY_CODE = 19;

  let placeRoleAccessRepository: jest.Mocked<PlaceRoleAccessRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let service: PlaceAccessService;

  /** Nobody in the identity slots, no role grants: the unconfigured baseline. */
  const emptyAccess = () => {
    roleAssignmentRepository.getAccessInfoByID.mockResolvedValue({ owner: [], deputies: [] });
    placeRoleAccessRepository.memberHasGrantedRole.mockResolvedValue(false);
    placeRoleAccessRepository.getRoleIdsByPlace.mockResolvedValue([]);
  };

  beforeEach(() => {
    placeRoleAccessRepository = createSpyObj(PlaceRoleAccessRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    Container.reset();
    Container.set(PlaceRoleAccessRepository, placeRoleAccessRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    service = Container.get(PlaceAccessService);
    emptyAccess();
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
});
