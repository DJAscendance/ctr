import { Service } from 'typedi';

import { RoleAssignment } from '../../types/models';
import {
  RoleAssignmentRepository,
  MemberRepository,
  TransactionRepository,
} from '../../repositories';

/** Service for interacting with roles */
@Service()
export class RoleAssignmentService {
  constructor(
    private roleAssignmentRepository: RoleAssignmentRepository,
    private memberRepository: MemberRepository,
    private transactionRepository: TransactionRepository,
  ) {}
  
  public async getMembersRoles(memberId: number): Promise<RoleAssignment[]> {
    const response = this.roleAssignmentRepository.getByMemberId(memberId);
    return response;
  }

  /**
   * Clears member.primary_role_id if it is no longer a role the member holds.
   *
   * Call after any change to a member's role assignments. role_assignment is the
   * authority for what a member holds; primary_role_id only records which of those they
   * chose to display, so it has to be re-checked whenever assignments change.
   *
   * Replaces a block that was copy-pasted across the hood, block, colony, place and
   * admin services. That version compared the *revoked* role against primary_role_id
   * and nulled the column on a match, which is wrong in one direction: a member holding
   * both Block Leader and Neighborhood Deputy who lost Block Leader had their displayed
   * role cleared even though they still held another. Checking the assignments that
   * remain, rather than the single one just removed, fixes that.
   *
   * The old version was also fire-and-forget inside forEach callbacks, so the write
   * could land after the request completed. This awaits.
   */
  public async reconcilePrimaryRole(memberId: number): Promise<void> {
    if (!memberId) return;
    const current = await this.memberRepository.getPrimaryRoleId(memberId);
    if (current === null || current === undefined) return;
    const assignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    const stillHeld = assignments
      .some(assignment => Number(assignment.role_id) === Number(current));
    if (!stillHeld) {
      await this.memberRepository.update(memberId, { primary_role_id: null });
    }
  }
  
  /**
   * How many deputy slots a place has.
   *
   * Comes from the `[0,0,0,0,0,0,0,0]` arrays that block, hood, colony and place each
   * declared. Kept as an explicit cap on incoming deputies so this change does not quietly
   * widen how many deputies a place can be given.
   */
  public static readonly DEPUTY_SLOTS = 8;

  /**
   * Brings a place's deputy assignments from one set of members to another.
   *
   * Replaces a loop that was duplicated verbatim in the block, hood, colony and place
   * services, and which paired old against new BY INDEX -- so it was order-sensitive.
   * Given old [A, B] and new [B, A], index 0 saw A != B and so removed A and added B;
   * index 1 then saw B != A and removed B, which had just been added and was meant to
   * stay. B lost the role, and took a reconcilePrimaryRole call while still a deputy --
   * exactly the spurious primary-role clearing that reconcilePrimaryRole exists to
   * prevent. Reordering the slots in the UI was enough to trigger it.
   *
   * Membership, not position, is what a deputy assignment means, so the comparison is
   * between sets: a member in both is left alone, which also means no needless
   * remove/re-add churn on their row.
   *
   * Old ids are not capped, so deputies beyond the slot count still get cleaned up if
   * they somehow exist; new ids are capped, matching the fixed arrays this replaces.
   * 0 is the "empty slot" sentinel throughout this codebase and is not a member id.
   *
   * Failures are caught per member so one bad row does not abandon the rest of the
   * reconciliation, which is what the loops it replaces did.
   */
  public async syncDeputies(
    placeId: number,
    // Optional because 'jail' and 'cityhall' have an owner role and no deputy role, so
    // findRoleIdsBySlug genuinely returns nothing for them. The guard below relied on that
    // while the signature denied it.
    deputyRoleId: number | null | undefined,
    oldDeputyIds: number[],
    newDeputyIds: number[],
  ): Promise<void> {
    if (deputyRoleId === undefined || deputyRoleId === null) return;

    const asIdSet = (ids: number[]): Set<number> =>
      new Set(ids.map(Number).filter(id => Number.isInteger(id) && id !== 0));

    const oldIds = asIdSet(oldDeputyIds);
    const newIds = asIdSet(newDeputyIds.slice(0, RoleAssignmentService.DEPUTY_SLOTS));

    for (const memberId of oldIds) {
      if (newIds.has(memberId)) continue;
      try {
        await this.roleAssignmentRepository
          .removeIdFromAssignment(placeId, memberId, deputyRoleId);
        await this.reconcilePrimaryRole(memberId);
      } catch (e) {
        console.error(e);
      }
    }

    for (const memberId of newIds) {
      if (oldIds.has(memberId)) continue;
      try {
        await this.roleAssignmentRepository.addIdToAssignment(placeId, memberId, deputyRoleId);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /**
   * Grabs all payments due to users from database 50 at a time and
   * places them in response array sorts respone into highest cc payout
   * then drops all other payouts to the same user
   */
  public async getMembersDueRoleCredit(limit: number): Promise<any[]> {
    const response = await this.roleAssignmentRepository.getMembersDueRoleCredit(limit);
    return response;
  }
  public async giveWeeklyRoleCredit(
    memberId: number,
    memberXp: number,
    walletId: number,
    incomeXp: number,
    incomeCc: number,
    roleId: number,
  ): Promise<void> {
    await this.transactionRepository.createWeeklyRoleCreditTransaction(
      walletId,
      incomeCc,
      roleId,
    );

    await this.memberRepository.update(memberId, {
      last_weekly_role_credit: new Date(),
      xp: memberXp + incomeXp,
      
    });
  }

  public async countByAssigned(id: number): Promise<RoleAssignment[]> {
    return await this.roleAssignmentRepository.countByAssigned(id);
  }
}
