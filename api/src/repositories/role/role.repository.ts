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

  /** Memoized name -> id resolutions for findIdByName. */
  private idByName: Map<string, number> = new Map();

  private async populateRoleMap(): Promise<void> {
    const roles = await this.findAll();

    // Resolve each role name to a single, deterministic id. If duplicate role rows ever
    // exist again, always resolve to the LOWEST id, so authorization can never silently
    // flip to a later duplicate based on row order. 20260717120000_dedupe_role_rows removed
    // the duplicates and added UNIQUE(name); ordering here is defence in depth so
    // resolution stays stable regardless of the database's state.
    [...roles]
      .sort((a, b) => a.id - b.id)
      .forEach(role => {
        const sanitizedName = role.name.replace(/\s/g, '');
        if (!(sanitizedName in this.roleMap)) {
          this.roleMap[sanitizedName] = role.id;
        }
      });
  }

  /**
   * Resolves a role's id from its exact name, reading the database on first use and
   * memoizing the answer.
   *
   * `roleMap` is filled by an UN-AWAITED call in the constructor, so a caller running early
   * can observe it empty. That is survivable for a check that gets retried, but not for a
   * lookup whose result is written into a row - an undefined id would be persisted. Anything
   * that stores a role id resolves it through here instead.
   *
   * Never returns a hardcoded id: the name is the contract and the id is whatever the
   * database says. MIN(id) keeps it deterministic even if uniqueness were ever lost.
   * @param name exact role name, e.g. 'Home Chat Guest'
   */
  public async findIdByName(name: string): Promise<number | undefined> {
    if (this.idByName.has(name)) {
      return this.idByName.get(name);
    }
    const row = await this.db.knex('role')
      .min('id as id')
      .where('name', name)
      .first();
    const id = row && row.id ? Number(row.id) : undefined;
    if (typeof id === 'number') {
      this.idByName.set(name, id);
    }
    return id;
  }

  public async findAll(): Promise<Role[]> {
    return this.db.role.where({});
  }
}
