import { Service } from 'typedi';

import { Db } from '../../db';
import { PlaceRoleAccess } from '../../types/models';

/**
 * Reads and writes the role-grant access axis: which roles are check-marked to give
 * write access at a place.
 *
 * Complements RoleAssignmentRepository.getAccessInfoByID, which covers the other axis
 * (the owner and deputy identity slots).
 */
@Service()
export class PlaceRoleAccessRepository {
  constructor(private db: Db) {}

  /** Role ids granted write access at this place. */
  public async getRoleIdsByPlace(placeId: number): Promise<number[]> {
    const rows = await this.db.knex('place_role_access')
      .select('role_id')
      .where('place_id', placeId)
      .orderBy('role_id');
    return rows.map(row => row.role_id);
  }

  /** Granted roles with their names, for rendering the checkbox list. */
  public async getRolesByPlace(placeId: number): Promise<{ id: number; name: string }[]> {
    return this.db.knex('place_role_access')
      .select('role.id', 'role.name')
      .where('place_role_access.place_id', placeId)
      .innerJoin('role', 'place_role_access.role_id', 'role.id')
      .orderBy('role.name');
  }

  /**
   * Replaces the grants for a place with exactly `roleIds`.
   *
   * A single transaction, so a failure part-way cannot leave a place with a half-applied
   * access list -- which would silently widen or narrow who can write there.
   */
  public async setRolesForPlace(placeId: number, roleIds: number[]): Promise<void> {
    const unique = [...new Set(roleIds.map(Number))].filter(id => Number.isInteger(id) && id > 0);
    await this.db.knex.transaction(async trx => {
      await trx('place_role_access').where('place_id', placeId).del();
      if (unique.length) {
        await trx('place_role_access').insert(
          unique.map(roleId => ({ place_id: placeId, role_id: roleId })),
        );
      }
    });
  }

  /**
   * True if the member holds at least one role granted at this place.
   *
   * Joins role_assignment, which is the authority for what a member holds. Note the
   * member's assignment may be scoped to a different place: holding "City Guide" anywhere
   * satisfies a City Guide grant here, which is the point of the axis -- it grants by
   * role, not by locality. Locality is what the owner/deputy axis and the hierarchy walk
   * are for.
   */
  public async memberHasGrantedRole(placeId: number, memberId: number): Promise<boolean> {
    const row = await this.db.knex('place_role_access')
      .select('place_role_access.id')
      .where('place_role_access.place_id', placeId)
      .innerJoin(
        'role_assignment',
        'place_role_access.role_id',
        'role_assignment.role_id',
      )
      .where('role_assignment.member_id', memberId)
      .first();
    return !!row;
  }

  /** Every grant for a place, used by callers that need the raw rows. */
  public async findByPlace(placeId: number): Promise<PlaceRoleAccess[]> {
    return this.db.placeRoleAccess.where({ place_id: placeId });
  }

  public async removeAllForPlace(placeId: number): Promise<void> {
    await this.db.knex('place_role_access').where('place_id', placeId).del();
  }

  /**
   * Deletes grants pointing at places that no longer exist.
   *
   * place_id deliberately carries no foreign key -- 04-places.hoods.seed.ts deletes and
   * recreates every hood and block, and an FK would block that the way the vote_list FK
   * already does. The cost of that choice is orphans, so they are swept here rather than
   * left to accumulate.
   */
  public async pruneOrphans(): Promise<number> {
    return this.db.knex('place_role_access')
      .whereNotIn('place_id', this.db.knex('place').select('id'))
      .del();
  }
}
