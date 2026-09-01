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
import {
  MapBackgroundOptionsResult,
  MapBackgroundSelectionResult,
  MapBackgroundService,
} from '../map-background/map-background.service';
import { resolveMapTheme } from '../../libs';
import { PlaceCapabilityService } from '../place/place-capability.service';

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
    private mapBackgroundService: MapBackgroundService,
    private placeCapabilityService: PlaceCapabilityService,
  ) {}
  
  public async find(hoodId: number): Promise<Place> {
    return await this.hoodRepository.find(hoodId);
  }
  
  public async getAccessInfoByUsername(hoodId: number): Promise<object> {
    const deputyCode = await this.roleRepository.roleMap.NeighborhoodDeputy;
    const ownerCode = await this.roleRepository.roleMap.NeighborhoodLeader;
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
    const deputyCode = await this.roleRepository.roleMap.NeighborhoodDeputy;
    const ownerCode = await this.roleRepository.roleMap.NeighborhoodLeader;
    let oldOwner = null;
    let newOwner = 0;
    const oldDeputies = [0,0,0,0,0,0,0,0];
    const newDeputies = [0,0,0,0,0,0,0,0];
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
    if (newOwner !== 0) {
      if (oldOwner !== 0) {
        await this.roleAssignmentRepository.removeIdFromAssignment(hoodId, oldOwner, ownerCode);
        const response: any = await this.memberRepository.getPrimaryRoleName(oldOwner);
        if (response.length !== 0) {
          const primaryRoleId = response[0].primary_role_id;
          if (ownerCode === primaryRoleId){
            await this.memberRepository.update(oldOwner, {primary_role_id: null});
          }
        }
      }
      await this.roleAssignmentRepository.addIdToAssignment(hoodId, newOwner, ownerCode);
    } else {
      if (oldOwner !== 0) {
        await this.roleAssignmentRepository.removeIdFromAssignment(hoodId, oldOwner, ownerCode);
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
            this.roleAssignmentRepository.removeIdFromAssignment(hoodId, oldDeputies, deputyCode);
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
            this.roleAssignmentRepository.removeIdFromAssignment(hoodId, oldDeputies, deputyCode);
            this.memberRepository.getPrimaryRoleName(oldDeputies)
              .then((response: any) => {
                if (response.length !== 0) {
                  const primaryRoleId = response[0].primary_role_id;
                  if (deputyCode === primaryRoleId) {
                    this.memberRepository.update(oldDeputies, {primary_role_id: null});
                  }
                }
              });
            this.roleAssignmentRepository.addIdToAssignment(hoodId, newDeputies[index], deputyCode);
          } catch (e) {
            console.log(e);
          }
        }
      }
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
   * Reports whether a member may administer a neighborhood.
   * @param hoodId id of the neighborhood
   * @param memberId id of the member acting
   * @returns true when the member holds the classic owner capability at this neighborhood
   */
  public async canAdmin(hoodId: number, memberId: number): Promise<boolean> {
    const { canAdmin } = await this.placeCapabilityService.resolve(hoodId, memberId);
    return canAdmin;
  }

  /**
   * Reports whether a member may change a neighborhood's access rights.
   * @param hoodId id of the neighborhood
   * @param memberId id of the member acting
   * @returns true when the member holds the classic rights capability at this neighborhood
   */
  public async canManageAccess(hoodId: number, memberId: number): Promise<boolean> {
    const { canManageAccess } = await this.placeCapabilityService.resolve(hoodId, memberId);
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
