import { Service } from 'typedi';

import {
  PlaceRoleAccessRepository,
  RoleAssignmentRepository,
} from '../../repositories';

/** Why a write was allowed or refused. Useful in logs and worth surfacing in the UI. */
export type WriteAccessReason =
  | 'owner'
  | 'deputy'
  | 'role-grant'
  | 'unrestricted'
  | 'denied';

export interface WriteAccessResult {
  allowed: boolean;
  reason: WriteAccessReason;
}

/**
 * Resolves write access at a place across both CS 4.x access axes.
 *
 * Axis 1, identity: the owner slot plus up to eight deputy slots, stored in
 * role_assignment and read via RoleAssignmentRepository.getAccessInfoByID. CTR already
 * had this.
 *
 * Axis 2, role grant: any role check-marked to grant write access to every holder,
 * stored in place_role_access. CTR had no representation for this, so
 * "let every City Guide write here" was inexpressible and owners had to name eight
 * individuals instead.
 *
 * Resolution order follows the original (see the CS 4.1 research notes, "Access rights"):
 * owner, then the deputy slots, then the role grant. The original then consulted a
 * rolemask and, failing that, walked up the place tree; that walk is not implemented here
 * yet -- see the note in canWrite.
 *
 * The default when nothing is configured is OPEN, not closed: the shipped UI states that
 * if no nickname and no role is set, all members may write. That is deliberately
 * faithful, and it is why canWrite must be given a real member id -- see below.
 */
@Service()
export class PlaceAccessService {
  constructor(
    private placeRoleAccessRepository: PlaceRoleAccessRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
  ) {}

  /** Roles currently granted write access at this place, with names for display. */
  public async getGrantedRoles(placeId: number): Promise<{ id: number; name: string }[]> {
    return this.placeRoleAccessRepository.getRolesByPlace(placeId);
  }

  /** Replaces the granted roles for a place with exactly this set. */
  public async setGrantedRoles(placeId: number, roleIds: number[]): Promise<void> {
    await this.placeRoleAccessRepository.setRolesForPlace(placeId, roleIds);
  }

  /** True if the member holds any role granted at this place. */
  public async memberHasGrantedRole(placeId: number, memberId: number): Promise<boolean> {
    if (!placeId || !memberId) return false;
    return this.placeRoleAccessRepository.memberHasGrantedRole(placeId, memberId);
  }

  /**
   * Resolves whether the member may write at this place.
   *
   * ownerCode and deputyCode are the role ids that mean "owner of" and "deputy of" for
   * this kind of place -- Block Leader / Block Deputy, Colony Leader / Colony Deputy and
   * so on. They are passed in rather than derived because CTR already resolves them
   * per place type at the call site (see PlaceService.findRoleIdsBySlug and the
   * per-service getAccessInfoByUsername methods), and duplicating that mapping here
   * would create a second source of truth for it.
   *
   * A falsy memberId is treated as a visitor and always refused. That matters because
   * the unconfigured default is open: the original's rule is that all MEMBERS may write,
   * and visitors never qualify -- an unauthenticated caller carries only the Visitor bit,
   * which never satisfies any grant.
   *
   * Not yet implemented: the hierarchical walk. In the original, a request neither
   * granted nor denied locally re-checks the parent place, three levels up to district,
   * so a district leader holds authority beneath without a per-place grant. Until that
   * lands, authority does not flow downward through this method -- though note
   * BlockService.canAdmin and its siblings already open-code a block -> hood -> colony
   * check of their own.
   */
  public async canWrite(
    placeId: number,
    memberId: number,
    ownerCode: number,
    deputyCode: number,
  ): Promise<WriteAccessResult> {
    if (!memberId) return { allowed: false, reason: 'denied' };

    const identity = await this.roleAssignmentRepository
      .getAccessInfoByID(placeId, ownerCode, deputyCode);

    if (identity.owner.some(entry => entry.member_id === memberId)) {
      return { allowed: true, reason: 'owner' };
    }
    if (identity.deputies.some(entry => entry.member_id === memberId)) {
      return { allowed: true, reason: 'deputy' };
    }
    if (await this.memberHasGrantedRole(placeId, memberId)) {
      return { allowed: true, reason: 'role-grant' };
    }

    // Nothing configured on either axis: the original leaves the place open to all
    // members. Only reached once both axes have been checked and found empty.
    const grantedRoles = await this.placeRoleAccessRepository.getRoleIdsByPlace(placeId);
    const unconfigured =
      identity.owner.length === 0 &&
      identity.deputies.length === 0 &&
      grantedRoles.length === 0;
    if (unconfigured) {
      return { allowed: true, reason: 'unrestricted' };
    }

    return { allowed: false, reason: 'denied' };
  }
}
