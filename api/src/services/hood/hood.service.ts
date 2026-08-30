import { Service } from 'typedi';

import {
  MapLocationRepository,
  HoodRepository,
  ColonyRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import { Place } from '../../types/models';
import {includes} from 'lodash';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';
import { PlaceAccessService } from '../place-access/place-access.service';
import {
  MapBackgroundOptionsResult,
  MapBackgroundSelectionResult,
  MapBackgroundService,
} from '../map-background/map-background.service';
import { resolveMapTheme } from '../../libs';

/** Service for dealing with blocks */
@Service()
export class HoodService {
  constructor(
    private mapLocationRepository: MapLocationRepository,
    private hoodRepository: HoodRepository,
    private colonyRepository: ColonyRepository,
    private placeRepository: PlaceRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
    private roleAssignmentService: RoleAssignmentService,
    private placeAccessService: PlaceAccessService,
    private mapBackgroundService: MapBackgroundService,
  ) {}
  
  public async find(hoodId: number): Promise<Place> {
    return await this.hoodRepository.find(hoodId);
  }
  
  public async getAccessInfoByUsername(hoodId: number): Promise<object> {
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all. Both codes are named because they become query
    // bindings, where a missing role throws out of knex instead of denying anything.
    const roleMap = await this.roleRepository.awaitRoleMap(
      'NeighborhoodDeputy', 'NeighborhoodLeader');
    const deputyCode = roleMap.NeighborhoodDeputy;
    const ownerCode = roleMap.NeighborhoodLeader;
    return await this.roleAssignmentRepository.getAccessInfoByUsername(
      hoodId, 
      ownerCode, 
      deputyCode,
    );
  }

  public async postAccessInfo(
    hoodId: number,
    givenDeputies: any,
    givenOwner: string): Promise<void> {
    /**
     * old is coming from database
     * new is coming from access rights page
     */
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all. Both codes are named because they become query
    // bindings, where a missing role throws out of knex instead of denying anything.
    const roleMap = await this.roleRepository.awaitRoleMap(
      'NeighborhoodDeputy', 'NeighborhoodLeader');
    const deputyCode = roleMap.NeighborhoodDeputy;
    const ownerCode = roleMap.NeighborhoodLeader;
    let oldOwner = null;
    let newOwner = 0;
    const data = await this
      .roleAssignmentRepository
      .getAccessInfoByID(hoodId, ownerCode, deputyCode);
    if (data.owner.length > 0) {
      oldOwner = data.owner[0].member_id;
    } else {
      oldOwner = 0;
    }
    if (givenOwner !== null && givenOwner !== '') {
      const result = await this.memberRepository.findIdByUsername(givenOwner);
      if (Array.isArray(result) && result.length > 0 && result[0].id) {
        newOwner = result[0].id;
      }
    }
    const oldDeputyIds = data.deputies.map(deputy => deputy.member_id);
    const newDeputyIds: number[] = [];
    for (const givenDeputy of givenDeputies) {
      newDeputyIds.push(await this.updateDeputyId(givenDeputy));
    }
    // Owner swap, deputy set and reconciliation are one sequence whose ORDER matters, so it
    // lives in RoleAssignmentService rather than being re-implemented per place type.
    await this.roleAssignmentService.syncPlaceAccess({
      placeId: hoodId,
      ownerRoleId: ownerCode,
      deputyRoleId: deputyCode,
      oldOwnerId: oldOwner,
      newOwnerId: newOwner,
      oldDeputyIds,
      newDeputyIds,
    });
  }
  
  public async getColony(hoodId: number): Promise<Place> {
    const hoodMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(hoodId);
    return await this.colonyRepository.find(hoodMapLocation.parent_place_id);
  }

  public async getBlocks(hoodId: number): Promise<any> {
    return await this.hoodRepository.getBlocks(hoodId);
  }

  /**
   * Reports the neighborhood's current map background index and every index
   * its colony's theme offers at hood level.
   * @param hoodId id of the neighborhood to report on
   * @returns the report, or null if the hood or its colony theme is unknown
   */
  public async getMapBackgroundOptions(hoodId: number): Promise<MapBackgroundOptionsResult | null> {
    const hood = await this.find(hoodId);
    if (!hood) {
      return null;
    }
    const colony = await this.getColony(hoodId);
    const theme = resolveMapTheme(colony?.slug);
    if (!theme) {
      return null;
    }

    const selectedIndex = hood.map_background_index ?? null;
    return this.mapBackgroundService.resolveOptions(theme, 'hood', selectedIndex);
  }

  /**
   * Persists a new map background index for the neighborhood, but only if the
   * hood's own theme actually offers that index at hood level.
   * The caller is responsible for authorizing the member first.
   * @param hoodId id of the neighborhood to update
   * @param index the requested index, or null to reset to the default
   */
  public async updateMapBackgroundSelection(
    hoodId: number,
    index: number | null,
  ): Promise<MapBackgroundSelectionResult> {
    const hood = await this.find(hoodId);
    if (!hood) {
      return { status: 'not_found' };
    }
    const colony = await this.getColony(hoodId);
    const theme = resolveMapTheme(colony?.slug);
    if (!theme) {
      return { status: 'not_found' };
    }

    const normalizedIndex = index === 0 ? null : index;
    if (normalizedIndex !== null) {
      const valid = await this.mapBackgroundService.isValidIndex(theme, 'hood', normalizedIndex);
      if (!valid) {
        return { status: 'invalid' };
      }
    }

    await this.placeRepository.updateMapBackgroundIndex(hoodId, normalizedIndex);
    return { status: 'success', selectedIndex: normalizedIndex };
  }

  /**
   * Delegates to the shared hierarchy walk, which resolves the hood -> colony chain from
   * map_location rather than fetching the colony by hand.
   *
   * Behaviour is unchanged: global Admin / Colony Representative, Colony Leader or Deputy
   * at the parent colony, or Neighborhood Leader or Deputy at this hood. It also picks up
   * a fix -- the old version read roleRepository.roleMap directly, which is populated by an
   * un-awaited constructor call and so is empty for a window after startup, quietly
   * denying real admins.
   */
  public async canAdmin(hoodId: number, memberId: number): Promise<boolean> {
    return this.placeAccessService.hasGeographicAuthority(hoodId, memberId);
  }

  /**
   * Kept on its own role set rather than delegated to placeAccessService: manage-access is
   * deliberately narrower than canAdmin (Leader, not Deputy).
   *
   * Role ids come from the awaited snapshot rather than the repository's map, which is
   * filled in by an un-awaited constructor call and so is empty for a window after startup
   * -- and for the whole of a bootstrap that seeds roles after the API starts. Naming the
   * roles also makes a half-seeded snapshot detectable rather than a silent denial.
   */
  public async canManageAccess(hoodId: number, memberId: number): Promise<boolean> {
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Admin',
      'ColonyRepresentative',
      'ColonyLeader',
      'ColonyDeputy',
      'NeighborhoodLeader',
    );
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    const colony = await this.getColony(hoodId);

    if (
      roleAssignments.find(assignment => {
        return (
          [
            roleMap.Admin,
            roleMap.ColonyRepresentative,
          ].includes(assignment.role_id) ||
          ([
            roleMap.ColonyLeader,
            roleMap.ColonyDeputy,
          ].includes(assignment.role_id) &&
            assignment.place_id === colony.id) ||
          ([roleMap.NeighborhoodLeader].includes(assignment.role_id) &&
            assignment.place_id === hoodId)
        );
      })
    ) {
      return true;
    }
    return false;
  }

  private async updateDeputyId(deputy: any): Promise<number> {
    let newDeputies = 0;
    if (deputy.username !== null && deputy.username !== '') {
      const result = await this.memberRepository.findIdByUsername(deputy.username);
      if (Array.isArray(result) && result.length > 0 && result[0].id) {
        newDeputies = result[0].id;
      }
    }
    return newDeputies;
  }
}
