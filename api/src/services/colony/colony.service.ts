import { Service } from 'typedi';

import {
  ColonyRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import { Place } from '../../types/models';
import * as console from 'console';
import { includes } from 'lodash';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';

/** Service for dealing with colony */
@Service()
export class ColonyService {
  constructor(
    private colonyRepository: ColonyRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
    private roleAssignmentService: RoleAssignmentService,
  ) { }

  public async find(colonyId: number): Promise<Place> {
    return await this.colonyRepository.find(colonyId);
  }

  public async getHoods(colonyId: number): Promise<any> {
    return await this.colonyRepository.getHoods(colonyId);
  }

  public async getAccessInfoByUsername(colonyId: number): Promise<object> {
    const deputyCode = await this.roleRepository.roleMap.ColonyDeputy;
    const ownerCode = await this.roleRepository.roleMap.ColonyLeader;
    return await this.roleAssignmentRepository.getAccessInfoByUsername(
      colonyId,
      ownerCode,
      deputyCode,
    );
  }

  public async postAccessInfo(
    colonyId: number,
    givenDeputies: any,
    givenOwner: string): Promise<void> {
    /**
     * old is coming from database
     * new is coming from access rights page
     */
    const deputyCode = await this.roleRepository.roleMap.ColonyDeputy;
    const ownerCode = await this.roleRepository.roleMap.ColonyLeader;
    let oldOwner = null;
    let newOwner = 0;
    const oldDeputies = [0, 0, 0, 0, 0, 0, 0, 0];
    const newDeputies = [0, 0, 0, 0, 0, 0, 0, 0];
    const data = await this
      .roleAssignmentRepository
      .getAccessInfoByID(colonyId, ownerCode, deputyCode);
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
      await this.roleAssignmentRepository.removeIdFromAssignment(colonyId, oldOwner, ownerCode);
      await this.roleAssignmentService.reconcilePrimaryRole(oldOwner);
    }
    if (newOwner !== 0) {
      await this.roleAssignmentRepository.addIdToAssignment(colonyId, newOwner, ownerCode);
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
            .removeIdFromAssignment(colonyId, oldDeputy, deputyCode);
          await this.roleAssignmentService.reconcilePrimaryRole(oldDeputy);
        }
        if (newDeputy !== 0) {
          await this.roleAssignmentRepository
            .addIdToAssignment(colonyId, newDeputy, deputyCode);
        }
      } catch (e) {
        console.log(e);
      }
    }
  }

  public async canAdmin(colonyId: number, memberId: number): Promise<boolean> {
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);

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
            assignment.place_id === colonyId)
        );
      })
    ) {
      return true;
    }
    else return false;
  }

  public async canManageAccess(colonyId: number, memberId: number): Promise<boolean> {
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);

    if (
      roleAssignments.find(assignment => {
        return (
          [
            this.roleRepository.roleMap.Admin,
            this.roleRepository.roleMap.ColonyRepresentative,
          ].includes(assignment.role_id) ||
          ([this.roleRepository.roleMap.ColonyLeader].includes(assignment.role_id) &&
            assignment.place_id === colonyId)
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
