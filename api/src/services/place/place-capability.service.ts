import { Service } from 'typedi';

import {
  MapLocationRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleMap,
  RoleRepository,
} from '../../repositories';
import { Place, RoleAssignment } from '../../types/models';

/**
 * The capabilities a member holds at one place.
 *
 * These are the two place capabilities classic Cybertown gated its controls with. The
 * classic `place`/`neighbor`/`block` CGIs resolved the viewer against the place and set
 * template variables from the result; `owneraccess` gated the Update button and the place
 * wizard, and `rightsaccess` gated the Access Rights button.
 */
export interface PlaceCapabilities {
  /** Classic `owneraccess`: administer this place. */
  canAdmin: boolean;
  /** Classic `rightsaccess`: change who may do what at this place. */
  canManageAccess: boolean;
}

/** The place types that sit on the colony -> hood -> block geographic tree. */
export type ScopedPlaceType = 'colony' | 'hood' | 'block';

/** Each scoped type's parent type. A colony is the root, so it has none. */
const PARENT_TYPE: Record<ScopedPlaceType, ScopedPlaceType | null> = {
  colony: null,
  hood: 'colony',
  block: 'hood',
};

/** The leader and deputy role names for each scoped place type. */
const PLACE_ROLES: Record<ScopedPlaceType, { leader: string; deputy: string }> = {
  colony: { leader: 'ColonyLeader', deputy: 'ColonyDeputy' },
  hood: { leader: 'NeighborhoodLeader', deputy: 'NeighborhoodDeputy' },
  block: { leader: 'BlockLeader', deputy: 'BlockDeputy' },
};

/**
 * Roles that carry both capabilities at every place, with no place scoping. These stand in
 * for classic Cybertown's global grant, which was an access check against a single
 * city-wide object rather than against the place being viewed.
 */
const GLOBAL_ADMIN_ROLES = ['Admin'];

/**
 * Roles that hold deputy authority over every colony at once.
 *
 * A member holding one of these is resolved the way the resolver already treats authority
 * held above the place being acted on: the right to change access rights carries across the
 * whole geographic tree, and nothing else does. So the role may open Access Rights at any
 * colony, neighborhood or block, and may administer none of them. This reuses the existing
 * inherited-rights shape rather than adding a second authority model, and it keeps the role
 * clearly below a true global administrator.
 */
const GLOBAL_COLONY_DEPUTY_ROLES = ['ColonyRepresentative'];

/**
 * Every role name this resolver reads out of the role map.
 *
 * awaitRoleMap uses these to tell "this role does not exist" apart from "this role has not
 * been seeded yet", which is the difference between a correct denial and an outage during
 * the bootstrap window.
 */
const REQUIRED_ROLE_NAMES: string[] = [
  ...GLOBAL_ADMIN_ROLES,
  ...GLOBAL_COLONY_DEPUTY_ROLES,
  ...Object.keys(PLACE_ROLES).map(type => PLACE_ROLES[type as ScopedPlaceType].leader),
  ...Object.keys(PLACE_ROLES).map(type => PLACE_ROLES[type as ScopedPlaceType].deputy),
];

/** Depth guard, so malformed map_location rows cannot make the walk loop forever. */
const MAX_ANCESTOR_DEPTH = 8;

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const isScopedPlaceType = (type: string): type is ScopedPlaceType =>
  type === 'colony' || type === 'hood' || type === 'block';

/**
 * Resolves what a member may do at a place.
 *
 * This is the single authority answer for the geographic place tree: block, neighborhood
 * and colony all resolve through here, so a capability the API advertises and the check
 * the API enforces can never disagree.
 *
 * The rules are the ones classic Cybertown's `chDBCheckRights` implemented:
 *
 * - A place's own leader holds both capabilities at that place.
 * - A place's own deputy administers the place but may not change its access rights.
 * - Authority over an ancestor place carries `canManageAccess` down the tree, and nothing
 *   else. A colony leader could open a child neighborhood's Access Rights page but had no
 *   Update button there.
 * - Nothing travels sideways to a sibling, or up from a child to its parent.
 * - Everything else is denied.
 *
 * On top of those, two city-wide offices are resolved without a place: a global
 * administrator holds both capabilities everywhere, and a colony-wide deputy holds the
 * inherited capability everywhere on the tree. Each source is added to the result, so a
 * member who holds a city office and a local office keeps the best of both.
 */
@Service()
export class PlaceCapabilityService {
  constructor(
    private mapLocationRepository: MapLocationRepository,
    private placeRepository: PlaceRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
  ) {}

  /**
   * Resolves a member's capabilities at a single place.
   * @param placeId id of the place being acted on
   * @param memberId id of the member acting
   * @returns the capabilities held; every capability is false unless proven otherwise
   */
  public async resolve(placeId: number, memberId: number): Promise<PlaceCapabilities> {
    const denied: PlaceCapabilities = { canAdmin: false, canManageAccess: false };

    if (!isPositiveInteger(placeId) || !isPositiveInteger(memberId)) {
      return denied;
    }

    const place = await this.placeRepository.findById(placeId);
    if (!place || !place.type || !isScopedPlaceType(place.type)) {
      return denied;
    }

    const assignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    if (!assignments || assignments.length === 0) {
      return denied;
    }

    // One awaited snapshot for the whole resolution. Reading the repository's map directly
    // is not possible here by design: it is populated after construction, so a synchronous
    // read during the startup or bootstrap window silently denies real admins.
    const roleMap = await this.roleRepository.awaitRoleMap(...REQUIRED_ROLE_NAMES);

    if (this.holdsAnyRoleOf(roleMap, assignments, GLOBAL_ADMIN_ROLES)) {
      return { canAdmin: true, canManageAccess: true };
    }

    const capabilities: PlaceCapabilities = { canAdmin: false, canManageAccess: false };

    // A colony-wide deputy carries the inherited capability, and only that, to every place
    // on the tree. Authority held at the place itself is added below, so a member who holds
    // both sources ends up with the union of the two.
    if (this.holdsAnyRoleOf(roleMap, assignments, GLOBAL_COLONY_DEPUTY_ROLES)) {
      capabilities.canManageAccess = true;
    }

    const own = PLACE_ROLES[place.type];
    if (this.holdsRoleAt(roleMap, assignments, own.leader, place.id)) {
      capabilities.canAdmin = true;
      capabilities.canManageAccess = true;
    } else if (this.holdsRoleAt(roleMap, assignments, own.deputy, place.id)) {
      capabilities.canAdmin = true;
    }

    // Only the right to change access rights is inherited, and only downwards. The walk is
    // skipped when the member already holds it at the place itself.
    if (!capabilities.canManageAccess) {
      const ancestors = await this.getAncestors(place);
      for (const ancestor of ancestors) {
        const roles = PLACE_ROLES[ancestor.type as ScopedPlaceType];
        if (
          this.holdsRoleAt(roleMap, assignments, roles.leader, ancestor.id) ||
          this.holdsRoleAt(roleMap, assignments, roles.deputy, ancestor.id)
        ) {
          capabilities.canManageAccess = true;
          break;
        }
      }
    }

    return capabilities;
  }

  /**
   * Walks the geographic tree upwards from a place, nearest ancestor first.
   *
   * A step is only taken when the parent really is the type that belongs above the current
   * place, so a mislinked map_location cannot invent an ancestor and widen authority.
   * @param place the place to walk up from
   * @returns the ancestor places, nearest first; empty for a colony
   */
  private async getAncestors(place: Place): Promise<Place[]> {
    const ancestors: Place[] = [];
    const visited = new Set<number>([place.id]);
    let current = place;

    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      const expectedType = PARENT_TYPE[current.type as ScopedPlaceType];
      if (!expectedType) {
        break;
      }

      const mapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(current.id);
      const parentId = mapLocation?.parent_place_id;
      if (!isPositiveInteger(parentId) || visited.has(parentId)) {
        break;
      }

      const parent = await this.placeRepository.findById(parentId);
      if (!parent || parent.type !== expectedType) {
        break;
      }

      visited.add(parent.id);
      ancestors.push(parent);
      current = parent;
    }

    return ancestors;
  }

  /**
   * Reports whether the member holds a named role at one specific place.
   * @param roleMap the awaited role-id snapshot
   * @param assignments the member's role assignments
   * @param roleName role name as it appears in the role map, without spaces
   * @param placeId the place the role must be held at
   * @returns true only when a matching, place-scoped assignment exists
   */
  private holdsRoleAt(
    roleMap: RoleMap,
    assignments: RoleAssignment[],
    roleName: string,
    placeId: number,
  ): boolean {
    const roleId = this.roleId(roleMap, roleName);
    if (!isPositiveInteger(roleId)) {
      return false;
    }
    return assignments.some(
      assignment => assignment.role_id === roleId && assignment.place_id === placeId,
    );
  }

  /**
   * Reports whether the member holds any of the named roles, at any place or at none.
   *
   * The place an assignment names is deliberately ignored here. These roles are city-wide
   * offices, and the admin panel stores them with no place at all.
   * @param roleMap the awaited role-id snapshot
   * @param assignments the member's role assignments
   * @param roleNames role names as they appear in the role map, without spaces
   * @returns true when at least one of the named roles is held
   */
  private holdsAnyRoleOf(
    roleMap: RoleMap,
    assignments: RoleAssignment[],
    roleNames: string[],
  ): boolean {
    const roleIds = roleNames
      .map(name => this.roleId(roleMap, name))
      .filter(isPositiveInteger);
    if (roleIds.length === 0) {
      return false;
    }
    return assignments.some(assignment => roleIds.includes(assignment.role_id));
  }

  /**
   * Looks a role name up in an awaited role-map snapshot.
   *
   * A name still absent after awaitRoleMap has re-read the table resolves to nothing rather
   * than throwing. An unknown role is then denied by `holdsRoleAt` and `holdsAnyRoleOf`,
   * which is the safe direction.
   * @param roleMap the awaited role-id snapshot
   * @param roleName role name as it appears in the role map, without spaces
   * @returns the role id, or undefined when the name is not mapped
   */
  private roleId(roleMap: RoleMap, roleName: string): number | undefined {
    return roleMap[roleName];
  }
}
