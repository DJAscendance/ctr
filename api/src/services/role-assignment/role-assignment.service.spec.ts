import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { RoleAssignmentService } from './role-assignment.service';
import { MemberRepository, RoleAssignmentRepository } from '../../repositories';

describe('RoleAssignmentService', () => {
  let memberRepository: jest.Mocked<MemberRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let service: RoleAssignmentService;

  beforeEach(() => {
    memberRepository = createSpyObj(MemberRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    Container.reset();
    Container.set(MemberRepository, memberRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    service = Container.get(RoleAssignmentService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  describe('reconcilePrimaryRole', () => {
    const MEMBER_ID = 11;
    const BLOCK_LEADER = 18;
    const HOOD_DEPUTY = 20;

    const assignments = (...roleIds: number[]) =>
      roleIds.map(role_id => ({ member_id: MEMBER_ID, role_id, place_id: 1 })) as any;

    describe('when the displayed role is still held', () => {
      it('leaves it alone', async () => {
        memberRepository.getPrimaryRoleId.mockResolvedValue(BLOCK_LEADER);
        roleAssignmentRepository.getByMemberId
          .mockResolvedValue(assignments(BLOCK_LEADER, HOOD_DEPUTY));
        await service.reconcilePrimaryRole(MEMBER_ID);
        expect(memberRepository.update).not.toHaveBeenCalled();
      });
    });

    describe('when the displayed role is no longer held', () => {
      it('clears it', async () => {
        memberRepository.getPrimaryRoleId.mockResolvedValue(BLOCK_LEADER);
        roleAssignmentRepository.getByMemberId.mockResolvedValue(assignments(HOOD_DEPUTY));
        await service.reconcilePrimaryRole(MEMBER_ID);
        expect(memberRepository.update)
          .toHaveBeenCalledWith(MEMBER_ID, { primary_role_id: null });
      });
    });

    /**
     * The bug in the code this replaced. It compared the *revoked* role against
     * primary_role_id, so losing Block Leader cleared the display role of a member who
     * still held Neighborhood Deputy. Reconciling against remaining assignments keeps
     * a role the member still holds.
     */
    describe('when another role is lost but the displayed one is retained', () => {
      it('does not clear the displayed role', async () => {
        memberRepository.getPrimaryRoleId.mockResolvedValue(HOOD_DEPUTY);
        roleAssignmentRepository.getByMemberId.mockResolvedValue(assignments(HOOD_DEPUTY));
        await service.reconcilePrimaryRole(MEMBER_ID);
        expect(memberRepository.update).not.toHaveBeenCalled();
      });
    });

    describe('when no role is displayed', () => {
      it('does nothing and does not query assignments', async () => {
        memberRepository.getPrimaryRoleId.mockResolvedValue(null);
        await service.reconcilePrimaryRole(MEMBER_ID);
        expect(roleAssignmentRepository.getByMemberId).not.toHaveBeenCalled();
        expect(memberRepository.update).not.toHaveBeenCalled();
      });
    });

    describe('when given a falsy member id', () => {
      it('does nothing', async () => {
        await service.reconcilePrimaryRole(0);
        expect(memberRepository.getPrimaryRoleId).not.toHaveBeenCalled();
      });
    });
  });
});
