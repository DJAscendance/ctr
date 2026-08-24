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
