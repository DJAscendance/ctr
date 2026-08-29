import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { RoleAssignment } from '../../types/models';
import { wherePayingRole } from '../credit/credit.repository';

/** A member id, as the access-rights queries select it. */
interface MemberIdRow {
  member_id: number;
}

/** A username, as the access-rights and roster queries select it. */
interface UsernameRow {
  username: string;
}

/** A recent hire: who was given which role. */
interface LatestAssignmentRow extends UsernameRow {
  roleName: string;
}

/** A role a member holds, with the place it is scoped to if any. */
interface MemberRoleRow {
  id: number;
  place_id: number;
  name: string;
  place: string;
}

/** A `count(id)` result, as knex returns it: a single row holding the total. */
export interface AssignmentCount {
  count: number;
}

/** Repository for fetching/interacting with role assignment data in the database. */
/**
 * The four donor role ids, plus the level being granted.
 *
 * `AdminService.addDonor` resolves these from the role map before calling, so
 * the repository is handed ids rather than names.
 */
export interface DonorRoleIds {
  supporter: number;
  advocate: number;
  devotee: number;
  champion: number;
  donorLevel?: number;
}

/** A username from a place's role assignments. */
interface PlaceUsernameRow {
  username: string;
}

/** A member id from a place's role assignments. */
interface PlaceMemberRow {
  member_id: number;
}

/** A member due their weekly role pay, with the role that pays best. */
export interface RoleCreditRow {
  member_id: number;
  role_id: number;
  wallet_id: number;
  xp: number;
  income_cc: number;
  income_xp: number;
}

/** The one column `getDonor` selects: a role's name, or no row at all. */
export interface RoleNameRow {
  name: string;
}

/** A role assignment flattened for display: the role, and where it applies. */
export interface RoleNameAndId {
  id: number;
  place_id: number | null;
  name: string;
  place: string | null;
}

/**
 * The donor role ids that actually exist, as a `whereIn` list.
 *
 * A donor role is absent whenever the role map was resolved before 06-donor.roles ran --
 * and `whereIn('role_id', [undefined, ...])` is not a query that matches nothing, it is a
 * query knex refuses to compile ("Undefined binding(s) detected"). Filtering turns a
 * half-seeded database into the right answer, "this member holds no donor role", instead
 * of a 500. An empty list compiles to `where 1 = 0`, which is exactly that answer.
 */
function definedDonorIds(roleId: DonorRoleIds): number[] {
  return [roleId.supporter, roleId.advocate, roleId.devotee, roleId.champion]
    .filter((id): id is number => id !== undefined && id !== null);
}

@Service()
export class RoleAssignmentRepository {
  constructor(private db: Db) {}
  
  public async addDonor(member_id: number, roleId: DonorRoleIds): Promise<void> {
    try{
      await this.db.knex('role_assignment')
        .where('member_id', member_id)
        .whereIn('role_id', definedDonorIds(roleId))
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
  ): Promise<number[]> {
    return this.db.knex('role_assignment')
      .insert(
        {
          role_id: roleId,
          member_id: memberId,
          place_id: placeId,
        },
      );
  }

  /**
   * Owner and deputy holders at a place.
   *
   * deputyCode is optional because some places have an owner role and no deputy role at all:
   * 'jail' (Security Chief) and 'cityhall' (City Council). Passing undefined through to
   * `.where('role_id', undefined)` makes knex throw "Undefined binding(s) detected when
   * compiling SELECT", which took down the entire call -- including the owner lookup, which
   * would otherwise have been fine. A place with no deputy role has no deputies, so that
   * query is skipped and `deputies` comes back empty instead.
   *
   * Guarded here rather than at each call site because every caller has the same exposure:
   * canWrite, and postAccessInfo in the block, hood, colony and place services.
   */
  public async getAccessInfoByID(
    placeId,
    ownerCode,
    deputyCode?): Promise<{ owner: MemberIdRow[]; deputies: MemberIdRow[] }> {
    const owner: MemberIdRow[] = await this.db.knex
      .select(
        'member_id',
      )
      .from('role_assignment')
      .where('place_id', placeId)
      .where('role_id', ownerCode);
    if (deputyCode === undefined || deputyCode === null) {
      return { deputies: [], owner };
    }
    const deputies: MemberIdRow[] = await this.db.knex
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
    deputyCode): Promise<{ owner: UsernameRow[]; deputies: UsernameRow[] }> {
    const owner: UsernameRow[] = await this.db.knex
      .select(
        'member.username',
      )
      .from('role_assignment')
      .where('role_assignment.place_id', placeId)
      .where('role_assignment.role_id', ownerCode)
      .innerJoin('member', 'role_assignment.member_id', 'member.id');
    const deputies: UsernameRow[] = await this.db.knex
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

  public async removeRoleAssignment(id: number): Promise<void> {
    await this.db.knex('role_assignment')
      .where('place_id', id)
      .del();
  }

  public async removeAllByUserId(id: number): Promise<void> {
    await this.db.knex('role_assignment')
      .where('member_id', id)
      .del();
  }

  public async getUsernamesByRoleId(roleId: number): Promise<UsernameRow[]> {
    return this.db.knex('role_assignment')
      .select('member.username')
      .where('role_assignment.role_id', '=', roleId)
      .leftJoin('member', 'role_assignment.member_id', 'member.id');
  }

  public async getLatest(): Promise<LatestAssignmentRow[]> {
    return this.db.knex('role_assignment')
      .select('member.username', 'role.name as roleName')
      .leftJoin('member', 'role_assignment.member_id', 'member.id')
      .join('role', 'role_assignment.role_id', 'role.id')
      .limit(5)
      .orderBy('role_assignment.id', 'desc');
  }
  
  public async getDonor(memberId: number, roleId: DonorRoleIds): Promise<RoleNameRow | undefined> {
    return this.db.knex
      .select('role.name')
      .from('role_assignment')
      .innerJoin('role', 'role_assignment.role_id', 'role.id')
      .where('role_assignment.member_id', memberId)
      .whereIn('role_id', definedDonorIds(roleId))
      .limit(1)
      .first();
  }
  
  public async getRoleNameAndIdByMemberId(memberId: number): Promise<MemberRoleRow[]> {
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
   * Finds members who are due weekly job pay.
   *
   * Returns ids and nothing else. Everything the payout needs - which role pays, what it
   * pays, the member's XP and wallet - is re-read by CreditRepository inside the
   * transaction that moves the money, because anything read here is already stale by the
   * time a worker gets to it, and a second worker may have paid in between.
   *
   * The join to `role` is what makes the batch worth its size: without the earning-role
   * filter, a member whose only role pays nothing qualifies, takes one of `limit` slots,
   * and displaces someone who actually earned pay.
   * @param limit maximum number of members to return
   * @returns ids of members eligible for weekly pay, at most `limit` of them
   */
  public async getMembersDueRoleCredit(limit: number): Promise<number[]> {
    const rows = await this.db.knex
      .distinct('member.id')
      .from('member')
      .innerJoin('role_assignment', 'member.id', 'role_assignment.member_id')
      .innerJoin('role', 'role_assignment.role_id', 'role.id')
      .where('member.status', 1)
      .where(wherePayingRole)
      .whereRaw('DATE(member.last_weekly_role_credit) != DATE(NOW())')
      .whereRaw('DATE(member.last_daily_login_credit) >= DATE(NOW() - INTERVAL 7 DAY)')
      .limit(limit);
    return rows.map(row => row.id);
  }

  public async removeIdFromAssignment(
    placeId: number,
    memberId: number,
    roleId: number,
  ): Promise<number> {
    return await this.db.knex('role_assignment')
      .where('place_id', placeId)
      .where('member_id', memberId)
      .where('role_id', roleId)
      .del();
  }

  public async getUsernamesByRoleAndPlace(placeId: number, roleId: number): Promise<any[]> {
    return this.db.knex('role_assignment')
      .select('member.username')
      .where('role_assignment.place_id', placeId)
      .where('role_assignment.role_id', roleId)
      .innerJoin('member', 'role_assignment.member_id', 'member.id');
  }

  public async removeAllForPlaceAndRole(placeId: number, roleId: number): Promise<any> {
    return this.db.knex('role_assignment')
      .where('place_id', placeId)
      .where('role_id', roleId)
      .del();
  }

  public async countByAssigned(id: number): Promise<AssignmentCount[]> {
    // knex types an untyped `count` as a dictionary of unnamed columns; the alias makes
    // the shape known here in a way the builder's own types cannot express.
    const rows = await this.db.knex('role_assignment')
      .count('id as count')
      .where('role_id', id);
    return <AssignmentCount[]><unknown>rows;
  }
}
