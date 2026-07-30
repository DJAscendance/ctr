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
   * Call after the COMPLETE set of assignment changes has landed, never between a remove
   * and the add that replaces it. This method reads role_assignment to decide what is still
   * held, so calling it mid-sequence lets it observe a state that never settles. The
   * callers used to do exactly that: postAccessInfo removed the owner's assignment,
   * reconciled, and only then re-added it -- so re-saving an access page WITHOUT changing
   * the owner cleared that owner's displayed role, because at the moment of the read they
   * genuinely held nothing. They kept the role and lost the badge, with nothing in the
   * request to explain it.
   *
   * role_assignment is the authority for what a member holds; primary_role_id only records
   * which of those they chose to display, so it has to be re-checked whenever assignments
   * change.
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
    /**
     * Optional collector for members whose displayed role needs re-checking. Given one, this
     * method defers reconciliation instead of doing it, so a caller that is also changing
     * the owner can reconcile everything once after ALL of its writes rather than partway
     * through.
     */
    deferTo?: Set<number>,
  ): Promise<void> {
    if (deputyRoleId === undefined || deputyRoleId === null) return;

    const asIdSet = (ids: number[]): Set<number> =>
      new Set(ids.map(Number).filter(id => Number.isInteger(id) && id !== 0));

    const oldIds = asIdSet(oldDeputyIds);
    const newIds = asIdSet(newDeputyIds.slice(0, RoleAssignmentService.DEPUTY_SLOTS));

    const removed: number[] = [];
    for (const memberId of oldIds) {
      if (newIds.has(memberId)) continue;
      try {
        await this.roleAssignmentRepository
          .removeIdFromAssignment(placeId, memberId, deputyRoleId);
        removed.push(memberId);
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

    // Reconciled only once every write above has landed. reconcilePrimaryRole reads
    // role_assignment to decide whether the displayed role is still held, so running it
    // between the removes and the adds let it observe a state that never settles -- see
    // reconcilePrimaryRoles.
    //
    // When the caller passes a collector, reconciliation is deferred to it instead, so a
    // place update that also changes the owner reconciles the whole set exactly once at the
    // very end rather than once per axis.
    if (deferTo) {
      removed.forEach(memberId => deferTo.add(memberId));
      return;
    }
    await this.reconcilePrimaryRoles(removed);
  }

  /**
   * Applies a place's whole access update: owner swap, deputy set, then reconciliation.
   *
   * The ordering here is the point. reconcilePrimaryRole must not run until every write has
   * landed, and getting that wrong is invisible -- the request succeeds and a member quietly
   * loses their displayed role. Keeping the sequence in one place means the block, hood,
   * colony and place services cannot each get it subtly differently, which is how the
   * original bug survived in four copies while being fixed in none.
   *
   * Callers still own resolving usernames to ids; this owns the order of the writes.
   */
  public async syncPlaceAccess(params: {
    placeId: number;
    ownerRoleId: number;
    /** Absent for places with an owner role and no deputy role ('jail', 'cityhall'). */
    deputyRoleId?: number | null;
    /** 0 when the place currently has no owner. */
    oldOwnerId: number;
    /** 0 when the update leaves the place without an owner. */
    newOwnerId: number;
    oldDeputyIds: number[];
    newDeputyIds: number[];
  }): Promise<void> {
    const {
      placeId, ownerRoleId, deputyRoleId, oldOwnerId, newOwnerId, oldDeputyIds, newDeputyIds,
    } = params;

    // Members whose displayed role may need re-checking once every write below has landed.
    const touched = new Set<number>();

    if (oldOwnerId !== 0) {
      await this.roleAssignmentRepository
        .removeIdFromAssignment(placeId, oldOwnerId, ownerRoleId);
      touched.add(oldOwnerId);
    }
    if (newOwnerId !== 0) {
      await this.roleAssignmentRepository.addIdToAssignment(placeId, newOwnerId, ownerRoleId);
    }

    // Defers into `touched` rather than reconciling, so the pass below is the only one.
    await this.syncDeputies(placeId, deputyRoleId, oldDeputyIds, newDeputyIds, touched);

    await this.reconcilePrimaryRoles(touched);
  }

  /**
   * Reconciles several members' displayed roles, after all assignment writes are done.
   *
   * Deduplicated because the same member can be touched on more than one axis of a single
   * update -- losing a deputy slot while also being the outgoing owner, say -- and
   * reconciling them twice is just a second round trip to reach the same answer.
   */
  public async reconcilePrimaryRoles(memberIds: Iterable<number>): Promise<void> {
    for (const memberId of new Set(memberIds)) {
      if (!memberId) continue;
      try {
        await this.reconcilePrimaryRole(memberId);
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
