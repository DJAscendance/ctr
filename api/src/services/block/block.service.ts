import { Service } from 'typedi';

import {
  BlockRepository,
  ColonyRepository,
  MapLocationRepository,
  HoodRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import {Member, Place} from '../../types/models';
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
export class BlockService {
  constructor(
    private blockRepository: BlockRepository,
    private colonyRepository: ColonyRepository,
    private mapLocationRepository: MapLocationRepository,
    private hoodRepository: HoodRepository,
    private placeRepository: PlaceRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
    private roleAssignmentService: RoleAssignmentService,
    private placeAccessService: PlaceAccessService,
    private mapBackgroundService: MapBackgroundService,
  ) {}
  
  public async find(blockId: number): Promise<Place> {
    return await this.blockRepository.find(blockId);
  }

  public async getHood(blockId: number): Promise<Place> {
    const blockMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(blockId);
    return await this.hoodRepository.find(blockMapLocation.parent_place_id);
  }
  
  /** Walks block -> hood -> colony, because the map theme is a colony-level trait. */
  public async getColony(blockId: number): Promise<Place | undefined> {
    const hood = await this.getHood(blockId);
    if (!hood) {
      return undefined;
    }
    const hoodMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(hood.id);
    return await this.colonyRepository.find(hoodMapLocation.parent_place_id);
  }

  /**
   * Reports the block's current map background index and every index its
   * colony's theme offers at block level.
   * @param blockId id of the block to report on
   * @returns the report, or null if the block or its colony theme is unknown
   */
  public async getMapBackgroundOptions(
    blockId: number,
  ): Promise<MapBackgroundOptionsResult | null> {
    const block = await this.find(blockId);
    if (!block) {
      return null;
    }
    const colony = await this.getColony(blockId);
    const theme = resolveMapTheme(colony?.slug);
    if (!theme) {
      return null;
    }

    const selectedIndex = block.map_background_index ?? null;
    const [options, effectiveUrl] = await Promise.all([
      this.mapBackgroundService.listOptions(theme, 'block'),
      this.mapBackgroundService.getEffectiveUrl(theme, 'block', selectedIndex),
    ]);

    return {
      selectedIndex,
      effectiveIndex: selectedIndex ?? 0,
      effectiveUrl,
      options,
    };
  }

  /**
   * Persists a new map background index for the block, but only if the
   * block's own theme actually offers that index at block level.
   * The caller is responsible for authorizing the member first.
   * @param blockId id of the block to update
   * @param index the requested index, or null to reset to the default
   */
  public async updateMapBackgroundSelection(
    blockId: number,
    index: number | null,
  ): Promise<MapBackgroundSelectionResult> {
    const block = await this.find(blockId);
    if (!block) {
      return { status: 'not_found' };
    }
    const colony = await this.getColony(blockId);
    const theme = resolveMapTheme(colony?.slug);
    if (!theme) {
      return { status: 'not_found' };
    }

    const normalizedIndex = index === 0 ? null : index;
    if (normalizedIndex !== null) {
      const valid = await this.mapBackgroundService.isValidIndex(theme, 'block', normalizedIndex);
      if (!valid) {
        return { status: 'invalid' };
      }
    }

    await this.placeRepository.updateMapBackgroundIndex(blockId, normalizedIndex);
    return { status: 'success', selectedIndex: normalizedIndex };
  }

  public async getAccessInfoByUsername(blockId: number): Promise<object> {
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all. Both codes are named because they become query
    // bindings, where a missing role throws out of knex instead of denying anything.
    const roleMap = await this.roleRepository.awaitRoleMap('BlockDeputy', 'BlockLeader');
    const deputyCode = roleMap.BlockDeputy;
    const ownerCode = roleMap.BlockLeader;
    return await this.roleAssignmentRepository.getAccessInfoByUsername(
      blockId, 
      ownerCode, 
      deputyCode,
    );
  }
  
  public async postAccessInfo(
    blockId: number,
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
    const roleMap = await this.roleRepository.awaitRoleMap('BlockDeputy', 'BlockLeader');
    const deputyCode = roleMap.BlockDeputy;
    const ownerCode = roleMap.BlockLeader;
    let oldOwner = null;
    let newOwner = 0;
    const data = await this
      .roleAssignmentRepository
      .getAccessInfoByID(blockId, ownerCode, deputyCode);
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
      placeId: blockId,
      ownerRoleId: ownerCode,
      deputyRoleId: deputyCode,
      oldOwnerId: oldOwner,
      newOwnerId: newOwner,
      oldDeputyIds,
      newDeputyIds,
    });
  }

  public async getMapLocationAndPlaces(blockId: number): Promise<any> {
    return await this.blockRepository.getMapLocationAndPlacesByBlockId(blockId);
  }

  public async resetMapLocationAvailability(blockId: number): Promise<void> {
    return await this.mapLocationRepository.resetAvailabilityByParentPlaceId(blockId);
  }

  public async setMapLocationAvailable(blockId: number, location: number): Promise<void> {
    return await this.mapLocationRepository.createAvailableLocation(blockId, location);
  }

  /**
   * Delegates to the shared hierarchy walk, which resolves block -> hood -> colony from
   * map_location instead of the two hand-written lookups this used to do.
   *
   * Behaviour is unchanged: global Admin / Colony Representative, or the Leader/Deputy pair
   * for any level at that level's place. It also picks up a fix -- the old version read
   * roleRepository.roleMap directly, which is populated by an un-awaited constructor call
   * and so is empty for a window after startup, quietly denying real admins.
   */
  public async canAdmin(blockId: number, memberId: number): Promise<boolean> {
    return this.placeAccessService.hasGeographicAuthority(blockId, memberId);
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
  public async canManageAccess(blockId: number, memberId: number): Promise<boolean> {
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Admin',
      'ColonyRepresentative',
      'ColonyLeader',
      'ColonyDeputy',
      'NeighborhoodDeputy',
      'NeighborhoodLeader',
      'BlockLeader',
    );
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    const hood = await this.getHood(blockId);
    const hoodMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(hood.id);
    const colonyId = hoodMapLocation.parent_place_id;

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
            assignment.place_id === colonyId) ||
          ([
            roleMap.NeighborhoodDeputy,
            roleMap.NeighborhoodLeader,
          ].includes(assignment.role_id) &&
            assignment.place_id === hood.id) ||
          ([roleMap.BlockLeader].includes(assignment.role_id) &&
            assignment.place_id === blockId)
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
