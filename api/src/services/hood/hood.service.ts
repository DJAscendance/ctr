import { Service } from 'typedi';

import {
  MapLocationRepository,
  HoodRepository,
  ColonyRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import { Place } from '../../types/models';
import {includes} from 'lodash';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';
import { PlaceAccessService } from '../place-access/place-access.service';

/** Service for dealing with blocks */
@Service()
export class HoodService {
  constructor(
    private mapLocationRepository: MapLocationRepository,
    private hoodRepository: HoodRepository,
    private colonyRepository: ColonyRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
    private roleAssignmentService: RoleAssignmentService,
    private placeAccessService: PlaceAccessService,
  ) {}
  
  public async find(hoodId: number): Promise<Place> {
    return await this.hoodRepository.find(hoodId);
  }
  
  public async getAccessInfoByUsername(hoodId: number): Promise<object> {
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all.
    const roleMap = await this.roleRepository.awaitRoleMap();
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
    // silently addressed no role at all.
    const roleMap = await this.roleRepository.awaitRoleMap();
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
   * roleMap is awaited because the constructor populates it without awaiting, so for a
   * window after startup every lookup is undefined and a real admin is denied.
   */
  public async canManageAccess(hoodId: number, memberId: number): Promise<boolean> {
    await this.roleRepository.awaitRoleMap();
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    const colony = await this.getColony(hoodId);

    if (
      roleAssignments.find(assignment => {
        return (
          [
            this.roleRepository.roleMap.Admin,
            this.roleRepository.roleMap.ColonyRepresentative,
          ].includes(assignment.role_id) ||
          ([
            this.roleRepository.roleMap.ColonyLeader,
            this.roleRepository.roleMap.ColonyDeputy,
          ].includes(assignment.role_id) &&
            assignment.place_id === colony.id) ||
          ([this.roleRepository.roleMap.NeighborhoodLeader].includes(assignment.role_id) &&
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
