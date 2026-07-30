import { Service } from 'typedi';

import {
  BlockRepository,
  MapLocationRepository,
  HoodRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import {Member, Place} from '../../types/models';
import {includes} from 'lodash';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';
import { PlaceAccessService } from '../place-access/place-access.service';

/** Service for dealing with blocks */
@Service()
export class BlockService {
  constructor(
    private blockRepository: BlockRepository,
    private mapLocationRepository: MapLocationRepository,
    private hoodRepository: HoodRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
    private roleAssignmentService: RoleAssignmentService,
    private placeAccessService: PlaceAccessService,
  ) {}
  
  public async find(blockId: number): Promise<Place> {
    return await this.blockRepository.find(blockId);
  }

  public async getHood(blockId: number): Promise<Place> {
    const blockMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(blockId);
    return await this.hoodRepository.find(blockMapLocation.parent_place_id);
  }
  
  public async getAccessInfoByUsername(blockId: number): Promise<object> {
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all.
    const roleMap = await this.roleRepository.awaitRoleMap();
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
    // silently addressed no role at all.
    const roleMap = await this.roleRepository.awaitRoleMap();
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
    // Both branches previously removed the old owner identically, so the removal is
    // hoisted out rather than duplicated.
    // Members whose displayed role may need re-checking once every write below has landed.
    // Reconciling inline here cleared the owner's badge on a save that did not even change
    // the owner: the assignment was removed, read as absent, and only then re-added.
    const touched = new Set<number>();
    if (oldOwner !== 0) {
      await this.roleAssignmentRepository.removeIdFromAssignment(blockId, oldOwner, ownerCode);
      touched.add(oldOwner);
    }
    if (newOwner !== 0) {
      await this.roleAssignmentRepository.addIdToAssignment(blockId, newOwner, ownerCode);
    }
    const oldDeputyIds = data.deputies.map(deputy => deputy.member_id);
    const newDeputyIds: number[] = [];
    for (const givenDeputy of givenDeputies) {
      newDeputyIds.push(await this.updateDeputyId(givenDeputy));
    }
    await this.roleAssignmentService
      .syncDeputies(blockId, deputyCode, oldDeputyIds, newDeputyIds, touched);
    await this.roleAssignmentService.reconcilePrimaryRoles(touched);
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
   * roleMap is awaited because the constructor populates it without awaiting, so for a
   * window after startup every lookup is undefined and a real admin is denied.
   */
  public async canManageAccess(blockId: number, memberId: number): Promise<boolean> {
    await this.roleRepository.awaitRoleMap();
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    const hood = await this.getHood(blockId);
    const hoodMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(hood.id);
    const colonyId = hoodMapLocation.parent_place_id;

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
            assignment.place_id === colonyId) ||
          ([
            this.roleRepository.roleMap.NeighborhoodDeputy,
            this.roleRepository.roleMap.NeighborhoodLeader,
          ].includes(assignment.role_id) &&
            assignment.place_id === hood.id) ||
          ([this.roleRepository.roleMap.BlockLeader].includes(assignment.role_id) &&
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
