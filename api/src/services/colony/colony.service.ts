import { Service } from 'typedi';

import {
  ColonyRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';
import { Place } from '../../types/models';
import { PlaceCapabilityService } from '../place/place-capability.service';
import * as console from 'console';
import { includes } from 'lodash';
import { RoleAssignmentService } from '../role-assignment/role-assignment.service';
import { PlaceAccessService } from '../place-access/place-access.service';

/** Service for dealing with colony */
@Service()
export class ColonyService {
  constructor(
    private colonyRepository: ColonyRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
    private roleRepository: RoleRepository,
    private memberRepository: MemberRepository,
    private roleAssignmentService: RoleAssignmentService,
    private placeAccessService: PlaceAccessService,
    private placeCapabilityService: PlaceCapabilityService,
  ) { }

  public async find(colonyId: number): Promise<Place> {
    return await this.colonyRepository.find(colonyId);
  }

  public async getHoods(colonyId: number): Promise<any> {
    return await this.colonyRepository.getHoods(colonyId);
  }

  public async getAccessInfoByUsername(colonyId: number): Promise<object> {
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all. Both codes are named because they become query
    // bindings, where a missing role throws out of knex instead of denying anything.
    const roleMap = await this.roleRepository.awaitRoleMap('ColonyDeputy', 'ColonyLeader');
    const deputyCode = roleMap.ColonyDeputy;
    const ownerCode = roleMap.ColonyLeader;
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
    // awaitRoleMap, not a bare roleMap read. The previous `await roleMap.X` awaited a
    // NUMBER, which resolves immediately and waits for nothing -- so during the startup
    // window before population these were both undefined and the role codes below
    // silently addressed no role at all. Both codes are named because they become query
    // bindings, where a missing role throws out of knex instead of denying anything.
    const roleMap = await this.roleRepository.awaitRoleMap('ColonyDeputy', 'ColonyLeader');
    const deputyCode = roleMap.ColonyDeputy;
    const ownerCode = roleMap.ColonyLeader;
    let oldOwner = null;
    let newOwner = 0;
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
    const oldDeputyIds = data.deputies.map(deputy => deputy.member_id);
    const newDeputyIds: number[] = [];
    for (const givenDeputy of givenDeputies) {
      newDeputyIds.push(await this.updateDeputyId(givenDeputy));
    }
    // Owner swap, deputy set and reconciliation are one sequence whose ORDER matters, so it
    // lives in RoleAssignmentService rather than being re-implemented per place type.
    await this.roleAssignmentService.syncPlaceAccess({
      placeId: colonyId,
      ownerRoleId: ownerCode,
      deputyRoleId: deputyCode,
      oldOwnerId: oldOwner,
      newOwnerId: newOwner,
      oldDeputyIds,
      newDeputyIds,
    });
  }

  /**
   * Reports whether a member may administer a colony.
   * @param colonyId id of the colony
   * @param memberId id of the member acting
   * @returns true when the member holds the classic owner capability at this colony
   */
  public async canAdmin(colonyId: number, memberId: number): Promise<boolean> {
    const { canAdmin } = await this.placeCapabilityService.resolve(colonyId, memberId);
    return canAdmin;
  }

  /**
   * Reports whether a member may change a colony's access rights.
   * @param colonyId id of the colony
   * @param memberId id of the member acting
   * @returns true when the member holds the classic rights capability at this colony
   */
  public async canManageAccess(colonyId: number, memberId: number): Promise<boolean> {
    const { canManageAccess } = await this.placeCapabilityService.resolve(colonyId, memberId);
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
