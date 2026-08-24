import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { Role } from '../../types/models';

/** Repository for fetching/interacting with role data in the database. */
@Service()
export class RoleRepository {
  constructor(private db: Db) {
    // Kept eager so existing direct readers of roleMap behave as before; the promise is
    // retained so awaitRoleMap can join this same population rather than starting another.
    this.roleMapReady = this.startPopulate();
    // Nobody awaits the eager attempt, so its rejection would be an unobserved promise
    // rejection -- a warning normally, and fatal under --unhandled-rejections=throw. It is
    // observed and discarded here; startPopulate has already cleared the memo, so the next
    // awaitRoleMap caller starts a fresh attempt rather than inheriting this failure.
    this.roleMapReady.catch(() => undefined);
  }
  public roleMap: any = {};

  /** Memoized in-flight/settled population, so awaitRoleMap resolves once and is shared. */
  private roleMapReady: Promise<void> | null = null;

  /**
   * Starts a population attempt and memoizes it, clearing the memo if it fails.
   *
   * Without the reset a single transient database error at startup was permanent: the
   * rejected promise stayed in roleMapReady, so every later awaitRoleMap re-awaited the same
   * rejection and the process could not recover without a restart.
   *
   * The identity check matters -- a late-settling older attempt must not clear a newer one's
   * memo, which would leave two populations racing with no shared result.
   */
  private startPopulate(): Promise<void> {
    const pending = this.populateRoleMap().catch(error => {
      if (this.roleMapReady === pending) this.roleMapReady = null;
      throw error;
    });
    return pending;
  }

  /**
   * Resolves once roleMap is populated, then returns it.
   *
   * The constructor kicks off populateRoleMap without awaiting it -- it cannot await, and
   * typedi gives no async construction hook. So for a window after startup roleMap is
   * still `{}`, every lookup on it is `undefined`, and an authorization test of the form
   * `[roleMap.Admin, ...].includes(assignment.role_id)` is comparing against undefined and
   * quietly returns false. That denies legitimate admins until the query settles, so new
   * code should await this instead of reading roleMap directly.
   *
   * This REJECTS if population fails rather than returning a half-empty map. That is
   * deliberate: returning `{}` would put callers back on the silent-denial path this method
   * exists to close, where a real admin is told "no" instead of "could not determine". The
   * rejection reaches the controllers' existing try/catch as an error response, and because
   * the memo is cleared the following request retries rather than inheriting the failure.
   */
  public async awaitRoleMap(): Promise<Record<string, number>> {
    if (!this.roleMapReady) this.roleMapReady = this.startPopulate();
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
