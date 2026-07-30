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

  describe('syncDeputies', () => {
    const PLACE = 42;
    const DEPUTY_ROLE = 20;
    const A = 101;
    const B = 102;
    const C = 103;

    /** Nobody holds a primary role by default, so reconcilePrimaryRole is a no-op. */
    beforeEach(() => {
      memberRepository.getPrimaryRoleId.mockResolvedValue(null);
      roleAssignmentRepository.getByMemberId.mockResolvedValue([] as any);
    });

    const removed = () =>
      roleAssignmentRepository.removeIdFromAssignment.mock.calls.map(call => call[1]).sort();
    const added = () =>
      roleAssignmentRepository.addIdToAssignment.mock.calls.map(call => call[1]).sort();

    /**
     * The bug this method exists to fix. The old index-paired loop saw A != B at index 0 and
     * so removed A and added B, then saw B != A at index 1 and removed B -- which it had just
     * added and which was meant to stay. Membership is unchanged here, so nothing should move.
     */
    it('does nothing when the same members are reordered', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A, B], [B, A]);
      expect(roleAssignmentRepository.removeIdFromAssignment).not.toHaveBeenCalled();
      expect(roleAssignmentRepository.addIdToAssignment).not.toHaveBeenCalled();
    });

    /** A reordered member must not have their displayed role reconciled away either. */
    it('does not reconcile the primary role of a member who stays a deputy', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A, B], [B, A]);
      expect(memberRepository.getPrimaryRoleId).not.toHaveBeenCalled();
    });

    it('removes only members who are no longer deputies', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A, B], [A]);
      expect(removed()).toEqual([B]);
      expect(added()).toEqual([]);
    });

    it('adds only members who were not deputies before', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A], [A, C]);
      expect(added()).toEqual([C]);
      expect(removed()).toEqual([]);
    });

    it('handles a straight swap', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A], [C]);
      expect(removed()).toEqual([A]);
      expect(added()).toEqual([C]);
    });

    it('reconciles the primary role of a removed deputy', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A], []);
      expect(memberRepository.getPrimaryRoleId).toHaveBeenCalledWith(A);
    });

    /** 0 is the empty-slot sentinel the fixed eight-element arrays were filled with. */
    it('ignores the 0 sentinel on both sides', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [A, 0, 0], [A, 0, 0, 0]);
      expect(roleAssignmentRepository.removeIdFromAssignment).not.toHaveBeenCalled();
      expect(roleAssignmentRepository.addIdToAssignment).not.toHaveBeenCalled();
    });

    /** The same person submitted twice is still one deputy, so one write. */
    it('deduplicates repeated ids', async () => {
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [], [C, C]);
      expect(added()).toEqual([C]);
    });

    it('caps incoming deputies at the slot count', async () => {
      const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [], nine);
      expect(added()).toHaveLength(RoleAssignmentService.DEPUTY_SLOTS);
      expect(added()).not.toContain(9);
    });

    /** 'jail' and 'cityhall' have an owner role and no deputy role. */
    it('does nothing when the place has no deputy role', async () => {
      await service.syncDeputies(PLACE, undefined, [A], [C]);
      expect(roleAssignmentRepository.removeIdFromAssignment).not.toHaveBeenCalled();
      expect(roleAssignmentRepository.addIdToAssignment).not.toHaveBeenCalled();
    });

    /** One failing row must not abandon the rest of the reconciliation. */
    it('continues past a failed write', async () => {
      roleAssignmentRepository.addIdToAssignment
        .mockRejectedValueOnce(new Error('duplicate'))
        .mockResolvedValue(undefined as any);
      await service.syncDeputies(PLACE, DEPUTY_ROLE, [], [B, C]);
      expect(roleAssignmentRepository.addIdToAssignment).toHaveBeenCalledTimes(2);
    });
  });
});
