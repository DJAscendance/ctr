import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { Role } from '../../types/models';

/** Repository for fetching/interacting with role data in the database. */
@Service()
export class RoleRepository {
  constructor(private db: Db) {
    this.populateRoleMap();
  }
  public roleMap: any = {};

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
