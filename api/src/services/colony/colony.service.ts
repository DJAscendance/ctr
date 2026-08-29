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
   * Delegates to the shared hierarchy walk. Previously open-coded here, in HoodService and
   * in BlockService as three copies of the same logic at depths 1, 2 and 3.
   *
   * Behaviour is unchanged: global Admin / Colony Representative, or Colony Leader /
   * Colony Deputy held at this colony. It also picks up a fix -- the old version read
   * roleRepository.roleMap directly, which is populated by an un-awaited constructor call
   * and so is empty for a window after startup, quietly denying real admins.
   */
  public async canAdmin(colonyId: number, memberId: number): Promise<boolean> {
    return this.placeAccessService.hasGeographicAuthority(colonyId, memberId);
  }

  /**
   * Left with its own role set rather than delegated to placeAccessService: manage-access is
   * deliberately narrower than canAdmin (Leader, not Deputy), and that difference is the
   * point of the method.
   *
   * Role ids come from the awaited snapshot for the same reason canAdmin no longer reads
   * the repository's map directly -- it is populated by an un-awaited constructor call, so
   * for a window after startup every lookup is undefined and `[undefined].includes(role_id)`
   * denies a real admin. Naming the roles also makes a half-seeded snapshot detectable.
   */
  public async canManageAccess(colonyId: number, memberId: number): Promise<boolean> {
    const roleMap = await this.roleRepository.awaitRoleMap(
      'Admin',
      'ColonyRepresentative',
      'ColonyLeader',
    );
    const roleAssignments = await this.roleAssignmentRepository.getByMemberId(memberId);

    if (
      roleAssignments.find(assignment => {
        return (
          [
            roleMap.Admin,
            roleMap.ColonyRepresentative,
          ].includes(assignment.role_id) ||
          ([roleMap.ColonyLeader].includes(assignment.role_id) &&
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
