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
import {
  MapBackgroundOptionsResult,
  MapBackgroundSelectionResult,
  MapBackgroundService,
} from '../map-background/map-background.service';
import { resolveMapTheme } from '../../libs';
import { PlaceCapabilityService } from '../place/place-capability.service';

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
    private mapBackgroundService: MapBackgroundService,
    private placeCapabilityService: PlaceCapabilityService,
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
    return this.mapBackgroundService.resolveOptions(theme, 'block', selectedIndex);
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
    const deputyCode = await this.roleRepository.roleMap.BlockDeputy;
    const ownerCode = await this.roleRepository.roleMap.BlockLeader;
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
    const deputyCode = await this.roleRepository.roleMap.BlockDeputy;
    const ownerCode = await this.roleRepository.roleMap.BlockLeader;
    let oldOwner = null;
    let newOwner = 0;
    const oldDeputies = [0,0,0,0,0,0,0,0];
    const newDeputies = [0,0,0,0,0,0,0,0];
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
    if (newOwner !== 0) {
      if (oldOwner !== 0) {
        await this.roleAssignmentRepository.removeIdFromAssignment(blockId, oldOwner, ownerCode);
        const response: any = await this.memberRepository.getPrimaryRoleName(oldOwner);
        if (response.length !== 0) {
          const primaryRoleId = response[0].primary_role_id;
          if (ownerCode === primaryRoleId){
            await this.memberRepository.update(oldOwner, {primary_role_id: null});
          }
        }
      }
      await this.roleAssignmentRepository.addIdToAssignment(blockId, newOwner, ownerCode);
    } else {
      if (oldOwner !== 0) {
        await this.roleAssignmentRepository.removeIdFromAssignment(blockId, oldOwner, ownerCode);
        const response: any = await this.memberRepository.getPrimaryRoleName(oldOwner);
        if (response.length !== 0) {
          const primaryRoleId = response[0].primary_role_id;
          if (ownerCode === primaryRoleId){
            await this.memberRepository.update(oldOwner, {primary_role_id: null});
          }
        }
      }
    }
    data.deputies.forEach((deputies, index) => {
      oldDeputies[index] = deputies.member_id;
    });
    for (let i = 0; i < givenDeputies.length; i++) {
      newDeputies[i] = await this.updateDeputyId(givenDeputies[i]);
    }
    oldDeputies.forEach((oldDeputies, index) => {
      if (oldDeputies !== newDeputies[index]) {
        if (newDeputies[index] === 0) {
          try {
            this.roleAssignmentRepository.removeIdFromAssignment(blockId, oldDeputies, deputyCode);
          } catch (e) {
            console.log(e);
          }
          if (oldDeputies !== 0) {
            this.memberRepository.getPrimaryRoleName(oldDeputies)
              .then((response: any) => {
                if (response.length !== 0) {
                  const primaryRoleId = response[0].primary_role_id;
                  if (primaryRoleId && deputyCode === primaryRoleId) {
                    this.memberRepository.update(oldDeputies, {primary_role_id: null});
                  }
                }
              });
          }
        } else {
          try {
            this.roleAssignmentRepository.removeIdFromAssignment(blockId, oldDeputies, deputyCode);
            this.memberRepository.getPrimaryRoleName(oldDeputies)
              .then((response: any) => {
                if (response.length !== 0) {
                  const primaryRoleId = response[0].primary_role_id;
                  if (deputyCode === primaryRoleId) {
                    this.memberRepository.update(oldDeputies, {primary_role_id: null});
                  }
                }
              });
            this
              .roleAssignmentRepository
              .addIdToAssignment(blockId, newDeputies[index], deputyCode);
          } catch (e) {
            console.log(e);
          }
        }
      }
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
   * Reports whether a member may administer a block.
   * @param blockId id of the block
   * @param memberId id of the member acting
   * @returns true when the member holds the classic owner capability at this block
   */
  public async canAdmin(blockId: number, memberId: number): Promise<boolean> {
    const { canAdmin } = await this.placeCapabilityService.resolve(blockId, memberId);
    return canAdmin;
  }

  /**
   * Reports whether a member may change a block's access rights.
   * @param blockId id of the block
   * @param memberId id of the member acting
   * @returns true when the member holds the classic rights capability at this block
   */
  public async canManageAccess(blockId: number, memberId: number): Promise<boolean> {
    const { canManageAccess } = await this.placeCapabilityService.resolve(blockId, memberId);
    return canManageAccess;
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
