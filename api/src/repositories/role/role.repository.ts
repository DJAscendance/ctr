import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { Role } from '../../types/models';

/** Repository for fetching/interacting with role data in the database. */
@Service()
export class RoleRepository {
  constructor(private db: Db) {
    // Kept eager so existing direct readers of roleMap behave as before; the promise is
    // retained so awaitRoleMap can join this same population rather than starting another.
    this.roleMapReady = this.populateRoleMap();
  }
  public roleMap: any = {};

  /** Memoized in-flight/settled population, so awaitRoleMap resolves once and is shared. */
  private roleMapReady: Promise<void> | null = null;

  /**
   * Resolves once roleMap is populated, then returns it.
   *
   * The constructor kicks off populateRoleMap without awaiting it -- it cannot await, and
   * typedi gives no async construction hook. So for a window after startup roleMap is
   * still `{}`, every lookup on it is `undefined`, and an authorization test of the form
   * `[roleMap.Admin, ...].includes(assignment.role_id)` is comparing against undefined and
   * quietly returns false. That denies legitimate admins until the query settles. It fails
   * closed rather than open, so it is a correctness bug rather than a security hole, but
   * new code should await this instead of reading roleMap directly.
   */
  public async awaitRoleMap(): Promise<Record<string, number>> {
    if (!this.roleMapReady) this.roleMapReady = this.populateRoleMap();
    await this.roleMapReady;
    return this.roleMap;
  }

  private async populateRoleMap(): Promise<void> {
    const roles = await this.findAll();

    // Resolve each role name to a single, deterministic id. If duplicate role rows exist
    // (a legacy bad-seed artifact), always resolve to the lowest id so authorization can
    // never silently flip to a later duplicate based on row order. The dedupe migration
    // removes the duplicates and a UNIQUE(name) index prevents recurrence; ordering here is
    // defense in depth so resolution stays stable regardless of the database's state.
    [...roles]
      .sort((a, b) => a.id - b.id)
      .forEach(role => {
        const sanitizedName = role.name.replace(/\s/g, '');
        if (!(sanitizedName in this.roleMap)) {
          this.roleMap[sanitizedName] = role.id;
        }
      });
  }

  public async findAll(): Promise<Role[]> {
    return this.db.role.where({});
  }
}
