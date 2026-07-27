import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { Knex } from 'knex';
import { RoleAssignment } from '../../types/models';

/** Repository for fetching/interacting with role assignment data in the database. */
@Service()
export class RoleAssignmentRepository {
  constructor(private db: Db) {}
  
  public async addDonor(member_id: number, roleId: any): Promise<void> {
    try{
      await this.db.knex('role_assignment')
        .where('member_id', member_id)
        .whereIn('role_id', [
          roleId.supporter,
          roleId.advocate,
          roleId.devotee,
          roleId.champion,
        ])
        .del();
    } finally {
      if (roleId.donorLevel !== undefined) {
        await this.db.knex('role_assignment').insert({
          member_id: member_id,
          role_id: roleId.donorLevel,
        });
      }
    }
  }

  public async addIdToAssignment(
    placeId: number,
    memberId: number,
    roleId: number,
  ): Promise<any> {
    return this.db.knex('role_assignment')
      .insert(
        {
          role_id: roleId,
          member_id: memberId,
          place_id: placeId,
        },
      );
  }

  public async getAccessInfoByID(
    placeId,
    ownerCode,
    deputyCode): Promise<{ owner: any[]; deputies: any[] }> {
    const owner: any[] = await this.db.knex
      .select(
        'member_id',
      )
      .from('role_assignment')
      .where('place_id', placeId)
      .where('role_id', ownerCode);
    const deputies: any[] = await this.db.knex
      .select(
        'member_id',
      )
      .from('role_assignment')
      .where('place_id', placeId)
      .where('role_id', deputyCode);
    return {deputies, owner};
  }

  public async getAccessInfoByUsername(
    placeId,
    ownerCode,
    deputyCode): Promise<{ owner: any[]; deputies: any[] }> {
    const owner: any[] = await this.db.knex
      .select(
        'member.username',
      )
      .from('role_assignment')
      .where('role_assignment.place_id', placeId)
      .where('role_assignment.role_id', ownerCode)
      .innerJoin('member', 'role_assignment.member_id', 'member.id');
    const deputies: any[] = await this.db.knex
      .select(
        'member.username',
      )
      .from('role_assignment')
      .where('role_assignment.place_id', placeId)
      .where('role_assignment.role_id', deputyCode)
      .innerJoin('member', 'role_assignment.member_id', 'member.id');
    return {deputies, owner};
  }
  
  public async getByMemberId(memberId: number): Promise<RoleAssignment[]> {
    const roleResults = await this.db.roleAssignment.where('member_id', memberId);
    return roleResults;
  }

  public async removeRoleAssignment(id: number): Promise<any> {
    await this.db.knex('role_assignment')
      .where('place_id', id)
      .del();
  }

  public async removeAllByUserId(id: number): Promise<any> {
    await this.db.knex('role_assignment')
      .where('member_id', id)
      .del();
  }

  public async getUsernamesByRoleId(roleId: number): Promise<any> {
    return this.db.knex('role_assignment')
      .select('member.username')
      .where('role_assignment.role_id', '=', roleId)
      .leftJoin('member', 'role_assignment.member_id', 'member.id');
  }

  public async getLatest(): Promise<any> {
    return this.db.knex('role_assignment')
      .select('member.username', 'role.name as roleName')
      .leftJoin('member', 'role_assignment.member_id', 'member.id')
      .join('role', 'role_assignment.role_id', 'role.id')
      .limit(5)
      .orderBy('role_assignment.id', 'desc');
  }
  
  public async getDonor(memberId: number, roleId: any): Promise<string> {
    return this.db.knex
      .select('role.name')
      .from('role_assignment')
      .innerJoin('role', 'role_assignment.role_id', 'role.id')
      .where('role_assignment.member_id', memberId)
      .whereIn('role_id', [
        roleId.supporter,
        roleId.advocate,
        roleId.devotee,
        roleId.champion,
      ])
      .limit(1)
      .first();
  }
  
  public async getRoleNameAndIdByMemberId(memberId: number): Promise<any> {
    return this.db.knex
      .distinct(
        'role_assignment.role_id as id',
        'role_assignment.place_id as place_id',
        'role.name as name',
        'place.name as place',
      )
      .from('role_assignment')
      .leftJoin('role', 'role_assignment.role_id', 'role.id')
      .leftJoin('place', 'role_assignment.place_id', 'place.id')
      .where('role_assignment.member_id', memberId);
  }
  
  /**
   * query finds all users with job who meet pay requirements
   * the inner join is just there to check for holding a job
   * then the for function will gather the highest paying role information per user
   * the for function also packages all the information for the return
   *
   * "Holding a job" means holding a role that PAYS SOMETHING. Without that predicate ANY
   * role_assignment row qualified a member for payroll, including roles seeded with no
   * income at all - Admin is one, and place-scoped Home Chat Guest assignments are another.
   * Such a member reached giveWeeklyRoleCredit unconditionally, which wrote a 0-CityCash
   * `weekly-role-credit` row and stamped last_weekly_role_credit. The batch is capped
   * (`limit`), so those rows also displaced members who had actually earned pay. Filtering
   * on income makes this query do what its own comment always claimed.
   *
   * "Pays something" is deliberately income_cc OR income_xp, not income_cc alone. The two
   * are independent columns, so a role could reward XP without CityCash; filtering on
   * CityCash alone would silently stop such a role accruing XP. No seeded role is XP-only
   * today, which is exactly why the narrower predicate would have gone unnoticed.
   * @param limit
   * @returns list of users with jobs that earned pay
   */
  public async getMembersDueRoleCredit(limit: number): Promise<any> {
    const query = await this.db.knex
      .select(
        'member.id',
        'member.wallet_id',
        'member.xp',
      )
      .from('member')
      .innerJoin('role_assignment', 'member.id', 'role_assignment.member_id')
      .innerJoin('role', 'role_assignment.role_id', 'role.id')
      .where('member.status', 1)
      .where(builder => builder
        .where('role.income_cc', '>', 0)
        .orWhere('role.income_xp', '>', 0))
      .whereRaw('DATE(member.last_weekly_role_credit) != DATE(NOW())')
      .whereRaw('DATE(member.last_daily_login_credit) >= DATE(NOW() - INTERVAL 7 DAY)')
      .limit(limit)
      .distinct('member.id');
    
    const results = [];
    for (const index in query) {
      const member_info = query[index];
      const role_info = await this.db.knex
        .select(
          'role_assignment.role_id',
          'role.income_cc',
          'role.income_xp',
        )
        .from('role_assignment')
        .innerJoin('role', 'role_assignment.role_id', 'role.id')
        .where('role_assignment.member_id', member_info.id)
        .where(builder => builder
          .where('role.income_cc', '>', 0)
          .orWhere('role.income_xp', '>', 0))
        // Secondary sort so that among roles paying the same CityCash - including several
        // paying none - the one granting the most XP wins, rather than an arbitrary row.
        .orderBy('role.income_cc','desc')
        .orderBy('role.income_xp','desc')
        .first();
      if (role_info) {
        results[index] = {
          member_id: member_info.id,
          role_id: role_info.role_id,
          wallet_id: member_info.wallet_id,
          xp: member_info.xp,
          income_cc: role_info.income_cc,
          income_xp: role_info.income_xp,
        };
      }
    }
    return results;
  }

  public async removeIdFromAssignment(
    placeId: number,
    memberId: number,
    roleId: number,
  ): Promise<any> {
    return await this.db.knex('role_assignment')
      .where('place_id', placeId)
      .where('member_id', memberId)
      .where('role_id', roleId)
      .del();
  }

  /**
   * Lists the usernames holding a given role AT a given place. Used for a home's chat guest
   * list, where the (place, role) pair is the whole scope - a guest of one home is never
   * returned for another.
   * @param placeId place the role is scoped to
   * @param roleId role to list holders of
   */
  public async getUsernamesByRoleAndPlace(placeId: number, roleId: number): Promise<any[]> {
    return this.db.knex('role_assignment')
      .select('member.username')
      .where('role_assignment.place_id', placeId)
      .where('role_assignment.role_id', roleId)
      .innerJoin('member', 'role_assignment.member_id', 'member.id');
  }

  /**
   * Lists the raw assignments of a role at a place. Returns member ids rather than
   * usernames, so an access check can compare against a token-derived member id without
   * ever resolving - or exposing - who else is on the list.
   * @param placeId place the role is scoped to
   * @param roleId role to list
   */
  public async findByPlaceAndRole(placeId: number, roleId: number): Promise<any[]> {
    return this.db.knex('role_assignment')
      .select('member_id')
      .where('place_id', placeId)
      .where('role_id', roleId);
  }

  /**
   * Removes every assignment of one role at one place, inside an existing transaction.
   *
   * Scoped to BOTH place and role on purpose: it must never touch a different home's guest
   * list, and never a different role at the same place. Used to replace a guest list
   * atomically (clear then insert in one transaction, so there is no moment where the home
   * is unrestricted) and by home reset.
   * @param trx transaction handle
   * @param placeId place the role is scoped to
   * @param roleId role to clear
   */
  public async removeAllForPlaceAndRoleWithin(
    trx: Knex.Transaction,
    placeId: number,
    roleId: number,
  ): Promise<void> {
    await trx('role_assignment')
      .where('place_id', placeId)
      .where('role_id', roleId)
      .del();
  }

  /**
   * Adds a place-scoped role assignment inside an existing transaction.
   * @param trx transaction handle
   * @param placeId place to scope the assignment to
   * @param memberId member receiving it
   * @param roleId role being assigned
   */
  public async addIdToAssignmentWithin(
    trx: Knex.Transaction,
    placeId: number,
    memberId: number,
    roleId: number,
  ): Promise<void> {
    await trx('role_assignment').insert({
      role_id: roleId,
      member_id: memberId,
      place_id: placeId,
    });
  }

  public async countByAssigned(id: number): Promise<any> {
    return this.db.knex('role_assignment')
      .count('id as count')
      .where('role_id', id);
  }
}
