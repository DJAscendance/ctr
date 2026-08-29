import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { Role } from '../../types/models';

/**
 * A resolved snapshot of sanitized role name -> role id.
 *
 * Readonly, and a copy rather than the repository's live map, so a consumer cannot mutate
 * shared authorization state and cannot observe the map changing underneath a decision it
 * is halfway through making.
 */
export type RoleMap = Readonly<Record<string, number>>;

/** Repository for fetching/interacting with role data in the database. */
@Service()
export class RoleRepository {
  constructor(private db: Db) {
    // Eager, so the map is usually already warm by the time the first request needs it and
    // awaitRoleMap resolves without a database round trip. Nothing depends on it having
    // finished -- awaitRoleMap joins this same population, or starts a new one if this one
    // failed or found an empty table.
    this.roleMapReady = this.startPopulate();
    // Nobody awaits the eager attempt, so its rejection would be an unobserved promise
    // rejection -- a warning normally, and fatal under --unhandled-rejections=throw. It is
    // observed and discarded here; startPopulate has already cleared the memo, so the next
    // awaitRoleMap caller starts a fresh attempt rather than inheriting this failure.
    this.roleMapReady.catch(() => undefined);
  }

  /**
   * PRIVATE ON PURPOSE. Reading this synchronously is the defect that took beta down on its
   * first boot: it is filled in by an un-awaited constructor call, so for a window after
   * startup -- and for the whole of a bootstrap that seeds roles after the API starts -- it
   * is `{}`. Every lookup on it is then `undefined`, which turns
   * `[roleMap.Admin].includes(assignment.role_id)` into a silent denial of a real admin,
   * and turns an id destined for a query binding into a knex "Undefined binding(s)" throw.
   *
   * Consumers go through awaitRoleMap instead. Keeping this private is what makes
   * `tsc --noEmit` the enforcement mechanism for that: a new direct reader does not compile.
   */
  private roleMap: Record<string, number> = {};

  /** Memoized in-flight/settled population, so awaitRoleMap resolves once and is shared. */
  private roleMapReady: Promise<void> | null = null;

  /**
   * Starts a population attempt and memoizes it, clearing the memo if it fails or if it
   * found nothing to populate from.
   *
   * Without the reset a single transient database error at startup was permanent: the
   * rejected promise stayed in roleMapReady, so every later awaitRoleMap re-awaited the same
   * rejection and the process could not recover without a restart.
   *
   * The identity check matters -- a late-settling older attempt must not clear a newer one's
   * memo, which would leave two populations racing with no shared result.
   */
  private startPopulate(): Promise<void> {
    const pending = this.populateRoleMap()
      .then(populated => {
        // An empty role table is not a populated map -- see populateRoleMap. Dropping the
        // memo for it is what lets a process that started before bootstrap seeded the roles
        // pick them up later, instead of caching `{}` for the rest of its life.
        if (!populated && this.roleMapReady === pending) this.roleMapReady = null;
      })
      .catch(error => {
        if (this.roleMapReady === pending) this.roleMapReady = null;
        throw error;
      });
    return pending;
  }

  /**
   * Resolves the role map, then returns a snapshot of it. This is the only way for a
   * consumer to obtain role ids; see the note on roleMap for why.
   *
   * This REJECTS if population fails rather than returning a half-empty map. That is
   * deliberate: returning `{}` would put callers back on the silent-denial path this method
   * exists to close, where a real admin is told "no" instead of "could not determine". The
   * rejection reaches the controllers' existing try/catch as an error response, and because
   * the memo is cleared the following request retries rather than inheriting the failure.
   *
   * @param requiredNames the role names the caller is about to read out of the snapshot.
   * Pass them. They cost nothing when the map already holds them -- every name used
   * anywhere in this codebase is present once the seeds have run -- and when it does not,
   * they are the only thing that distinguishes "this role does not exist" from "this role
   * has not been seeded yet", which is the difference between a correct denial and an
   * outage.
   */
  public async awaitRoleMap(...requiredNames: string[]): Promise<RoleMap> {
    if (!this.roleMapReady) this.roleMapReady = this.startPopulate();
    await this.roleMapReady;

    // A caller that names the roles it needs also tells us how to recognise a snapshot
    // taken too early. Bootstrap seeds roles in three passes (05-roles, 06-donor.roles and
    // 09-update.roles), so a population that ran between them is non-empty -- the emptiness
    // check in startPopulate is satisfied -- yet permanently missing everything the later
    // passes insert.
    //
    // Deliberately NOT remembered across calls. Marking a name as "already retried once"
    // would reintroduce the very defect this closes: the retry would be spent during the
    // gap between two seed passes, and the roles the later pass inserts would then be
    // unreachable for the life of the process. The cost of not remembering is one small
    // read of a ~115-row table per call that asks for a role which really does not exist.
    if (requiredNames.some(name => !(name in this.roleMap))) {
      this.roleMapReady = this.startPopulate();
      await this.roleMapReady;
    }

    return { ...this.roleMap };
  }

  /**
   * Populates roleMap from the database.
   *
   * @returns whether the table held any roles. An empty `role` table is NOT a populated
   * map -- it is a database bootstrap has not seeded yet. Reporting that as a successful
   * population is the defect this returns for: the resolved promise stayed memoized in
   * roleMapReady, every later awaitRoleMap handed back `{}`, and the roles bootstrap went
   * on to insert were invisible until the process was restarted.
   */
  private async populateRoleMap(): Promise<boolean> {
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

    return roles.length > 0;
  }

  public async findAll(): Promise<Role[]> {
    return this.db.role.where({});
  }
}
