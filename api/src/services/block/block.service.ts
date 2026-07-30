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
  ) {}
  
  public async find(blockId: number): Promise<Place> {
    return await this.blockRepository.find(blockId);
  }

  public async getHood(blockId: number): Promise<Place> {
    const blockMapLocation = await this.mapLocationRepository.findPlaceIdMapLocation(blockId);
    return await this.hoodRepository.find(blockMapLocation.parent_place_id);
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
    // Both branches previously removed the old owner identically, so the removal is
    // hoisted out rather than duplicated.
    if (oldOwner !== 0) {
      await this.roleAssignmentRepository.removeIdFromAssignment(blockId, oldOwner, ownerCode);
      await this.roleAssignmentService.reconcilePrimaryRole(oldOwner);
    }
    if (newOwner !== 0) {
      await this.roleAssignmentRepository.addIdToAssignment(blockId, newOwner, ownerCode);
    }
    data.deputies.forEach((deputies, index) => {
      oldDeputies[index] = deputies.member_id;
    });
    for (let i = 0; i < givenDeputies.length; i++) {
      newDeputies[i] = await this.updateDeputyId(givenDeputies[i]);
    }
    // Was a forEach containing un-awaited promise chains, so the primary-role write
    // could land after the request had already returned. A for loop lets these await.
    for (let index = 0; index < oldDeputies.length; index++) {
      const oldDeputy = oldDeputies[index];
      const newDeputy = newDeputies[index];
      if (oldDeputy === newDeputy) continue;
      try {
        if (oldDeputy !== 0) {
          await this.roleAssignmentRepository
            .removeIdFromAssignment(blockId, oldDeputy, deputyCode);
          await this.roleAssignmentService.reconcilePrimaryRole(oldDeputy);
        }
        if (newDeputy !== 0) {
          await this.roleAssignmentRepository
            .addIdToAssignment(blockId, newDeputy, deputyCode);
        }
      } catch (e) {
        console.log(e);
      }
    }
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

  public async canAdmin(blockId: number, memberId: number): Promise<boolean> {
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
          ([
            this.roleRepository.roleMap.BlockDeputy,
            this.roleRepository.roleMap.BlockLeader,
          ].includes(assignment.role_id) &&
            assignment.place_id === blockId)
        );
      })
    ) {
      return true;
    }
    return false;
  }

  public async canManageAccess(blockId: number, memberId: number): Promise<boolean> {
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
