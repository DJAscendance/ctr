import { Service } from 'typedi';

import {
  MapLocationRepository,
  PlaceRepository,
  PlaceRoleAccessRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';

/** Why a write was allowed or refused. Useful in logs and worth surfacing in the UI. */
export type WriteAccessReason =
  | 'owner'
  | 'deputy'
  | 'role-grant'
  | 'inherited'
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
  /**
   * The offices that confer authority over a place of each type -- and, because authority
   * inherits downward, over everything beneath it.
   *
   * Names, not ids: role ids come from auto-increment insert order in roles_data.json, so
   * hardcoding them would break silently if that file were reordered.
   */
  private static readonly OFFICES_BY_TYPE: Record<string, string[]> = {
    colony: ['ColonyLeader', 'ColonyDeputy'],
    hood: ['NeighborhoodLeader', 'NeighborhoodDeputy'],
    block: ['BlockLeader', 'BlockDeputy'],
  };

  /** Roles holding authority everywhere, independent of the hierarchy. */
  private static readonly GLOBAL_OFFICES = ['Admin', 'ColonyRepresentative'];

  /**
   * Every office name this service can resolve, derived from the two tables above so it
   * cannot drift out of step with them. Passed to awaitRoleMap so that a role map snapshot
   * taken part-way through the seeds is recognised and re-read, rather than quietly
   * resolving an office to undefined -- which idsFor below would then filter away, turning
   * a half-seeded database into a clean-looking denial for a real leader.
   */
  private static readonly ALL_OFFICES = [...new Set([
    ...PlaceAccessService.GLOBAL_OFFICES,
    ...Object.values(PlaceAccessService.OFFICES_BY_TYPE).flat(),
  ])];

  /**
   * Place types that participate in the upward walk: home -> block -> hood -> colony,
   * mirroring the original's property -> block -> neighborhood -> district.
   *
   * Deliberately excludes club, public and storage. The research notes are specific that
   * city, office and club places do not recurse, so a colony leader does not automatically
   * gain authority inside a club that happens to sit beneath them.
   */
  private static readonly RECURSING_TYPES = ['home', 'block', 'hood', 'colony'];

  /** Safety stop. The real hierarchy is four deep; anything longer means a cycle. */
  private static readonly MAX_DEPTH = 8;

  constructor(
    private mapLocationRepository: MapLocationRepository,
    private placeRepository: PlaceRepository,
    private placeRoleAccessRepository: PlaceRoleAccessRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
  ) {}

  /**
   * The place itself followed by its ancestors, nearest first: home, block, hood, colony.
   *
   * Walks map_location upward. Stops as soon as a place's type is not one that recurses,
   * so a club or a public place terminates the chain instead of leaking authority in from
   * the colony above it.
   */
  public async getAncestry(placeId: number): Promise<{ id: number; type: string }[]> {
    const chain: { id: number; type: string }[] = [];
    const seen = new Set<number>();
    let currentId = placeId;

    for (let depth = 0; depth < PlaceAccessService.MAX_DEPTH; depth++) {
      if (!currentId || seen.has(currentId)) break;
      seen.add(currentId);

      const place = await this.placeRepository.findById(currentId);
      if (!place) break;
      chain.push({ id: place.id, type: place.type });

      // Only recursing types continue upward. Note the check is on the place we just
      // added: a club stops the walk at the club, it does not inherit from its parent.
      if (!PlaceAccessService.RECURSING_TYPES.includes(place.type)) break;
      if (place.type === 'colony') break; // district is the top; nothing above it inherits

      const location = await this.mapLocationRepository.findPlaceIdMapLocation(currentId);
      if (!location || !location.parent_place_id) break;
      currentId = location.parent_place_id;
    }
    return chain;
  }

  /**
   * True if the member holds an office granting authority over this place, either globally
   * or at the place itself or any ancestor of it.
   *
   * This is the inherent-authority axis, distinct from a place's own access list: a colony
   * leader holds authority over the hoods and blocks beneath them without appearing in any
   * of those places' owner or deputy slots. The research notes put it plainly -- rights
   * inherit up the place hierarchy, and a district leader therefore holds change rights
   * over everything beneath.
   *
   * Replaces three separately hand-written walks in ColonyService, HoodService and
   * BlockService, which implemented depths 1, 2 and 3 of this same logic with hardcoded
   * role sets. Those could not be extended to a new place type without a fourth copy.
   */
  public async hasGeographicAuthority(placeId: number, memberId: number): Promise<boolean> {
    if (!placeId || !memberId) return false;

    const [assignments, roleIds] = await Promise.all([
      this.roleAssignmentRepository.getByMemberId(memberId),
      this.roleRepository.awaitRoleMap(...PlaceAccessService.ALL_OFFICES),
    ]);
    if (!assignments.length) return false;

    const idsFor = (names: string[]) =>
      names.map(name => roleIds[name]).filter(id => id !== undefined);

    const globalIds = idsFor(PlaceAccessService.GLOBAL_OFFICES);
    if (assignments.some(a => globalIds.includes(a.role_id))) return true;

    const ancestry = await this.getAncestry(placeId);
    for (const place of ancestry) {
      const officeIds = idsFor(PlaceAccessService.OFFICES_BY_TYPE[place.type] || []);
      if (!officeIds.length) continue;
      if (assignments.some(a => officeIds.includes(a.role_id) && a.place_id === place.id)) {
        return true;
      }
    }
    return false;
  }

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
   * One deliberate divergence from the original, worth stating because it is a loosening.
   *
   * The original consults the hierarchy only when a request was neither granted nor denied
   * locally -- an explicit local denial stops the walk. (Or should: 4.1's delete branch
   * never recorded denials, so denial was indistinguishable from silence and fell through
   * to the walk anyway, which is the escalation defect the research notes say to fix
   * rather than reproduce.)
   *
   * Here, hasGeographicAuthority is consulted even when the place has a configured access
   * list that the member does not appear in. That matches what CTR already does -- the
   * existing per-service canAdmin methods treat a colony leader's authority as
   * unconditional -- and tightening it so a block owner could shut their colony leader out
   * is a product decision, not something a refactor should slip in. If that tightening is
   * ever wanted, it belongs above this comment, and it must record denials explicitly so
   * "denied" and "no opinion" stay distinguishable.
   */
  public async canWrite(
    placeId: number,
    memberId: number,
    ownerCode: number,
    // Optional: 'jail' and 'cityhall' have an owner role and no deputy role. The repository
    // skips the deputy query rather than letting knex throw on an undefined binding, so this
    // resolves to no deputies rather than to an error.
    deputyCode?: number,
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
    if (await this.hasGeographicAuthority(placeId, memberId)) {
      return { allowed: true, reason: 'inherited' };
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
