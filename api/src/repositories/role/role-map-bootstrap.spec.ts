import { Db } from '../../db/db.class';
import { RoleRepository } from './role.repository';

/**
 * The cold-bootstrap lifecycle, as a spec.
 *
 * A fresh deployment starts the API against a database that has no roles in it yet, and
 * bootstrap seeds them underneath the already-running process. Nothing restarts the API
 * afterwards, so whatever the role map decided during that window is what the process
 * lives with. These specs pin down that it must catch up on its own.
 *
 * They are written against a `role` table whose contents change between queries rather
 * than against MySQL, because the property under test is entirely about *when* the
 * repository looks, not about what SQL it emits.
 */

interface RoleRow { id: number; name: string; }

/** The roles 05-roles.seed.ts inserts, reduced to the two these specs read. */
const BASE_ROLES: RoleRow[] = [
  { id: 1, name: 'Admin' },
  { id: 2, name: 'City Mayor' },
];

/** The roles 06-donor.roles.seed.ts inserts, one bootstrap pass later than the base set. */
const DONOR_ROLES: RoleRow[] = [
  { id: 75, name: 'Supporter' },
  { id: 76, name: 'Champion' },
];

/** A `role` table whose rows and reachability can both change between queries. */
class FakeRoleTable {
  public rows: RoleRow[] = [];
  public failure: Error | null = null;
  public queries = 0;
  /** When set, a query does not settle until this does -- so it can be held in flight. */
  public hold: Promise<void> | null = null;
}

/** A promise and the handle that settles it. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

/** A `Db` over one of those tables, shaped as the single call `findAll` makes. */
function dbFor(table: FakeRoleTable): Db {
  return {
    get role() {
      return {
        where: () => {
          table.queries += 1;
          // Read rows when the query SETTLES, not when it is issued, so a seed that lands
          // while a population is in flight behaves the way a real one would.
          const settle = () => {
            if (table.failure) throw table.failure;
            return [...table.rows];
          };
          const hold = table.hold;
          return hold ? hold.then(settle) : Promise.resolve().then(settle);
        },
      };
    },
  } as unknown as Db;
}

describe('RoleRepository role map bootstrap lifecycle', () => {
  it('picks up roles seeded after startup instead of caching the empty table forever', async () => {
    const table = new FakeRoleTable();
    // The API comes up first: migrations have created `role`, bootstrap has not filled it.
    const repository = new RoleRepository(dbFor(table));

    await expect(repository.awaitRoleMap()).resolves.toEqual({});

    // Bootstrap runs. The API is not restarted.
    table.rows = [...BASE_ROLES];

    // Before the fix this still resolved to `{}`: populating from an empty table counted
    // as success, so the resolved promise stayed memoized and nothing ever looked again.
    const roleMap = await repository.awaitRoleMap();
    expect(roleMap.Admin).toBe(1);
    expect(roleMap.CityMayor).toBe(2);
  });

  it('hands back an isolated snapshot rather than the live map', async () => {
    const table = new FakeRoleTable();
    table.rows = [...BASE_ROLES];
    const repository = new RoleRepository(dbFor(table));

    const snapshot = await repository.awaitRoleMap();
    // Until roleMap was made private this object WAS the repository's own map, so any
    // consumer could rewrite shared authorization state -- deliberately or by accident.
    (snapshot as Record<string, number>).Admin = 999;

    await expect(repository.awaitRoleMap()).resolves.toEqual({ Admin: 1, CityMayor: 2 });
  });

  it('re-reads for a required role missing from a snapshot taken mid-bootstrap', async () => {
    const table = new FakeRoleTable();
    // 05-roles.seed.ts has run, 06-donor.roles.seed.ts has not. The table is non-empty, so
    // "did we see any roles at all" cannot tell this apart from a finished bootstrap.
    table.rows = [...BASE_ROLES];
    const repository = new RoleRepository(dbFor(table));
    await expect(repository.awaitRoleMap()).resolves.toEqual({ Admin: 1, CityMayor: 2 });

    table.rows = [...BASE_ROLES, ...DONOR_ROLES];

    const roleMap = await repository.awaitRoleMap('Supporter', 'Champion');
    expect(roleMap.Supporter).toBe(75);
    expect(roleMap.Champion).toBe(76);
  });

  it('keeps re-reading for a required role that later seed passes may still add', async () => {
    const table = new FakeRoleTable();
    table.rows = [...BASE_ROLES];
    const repository = new RoleRepository(dbFor(table));

    // Two calls land in the gap between the two seed passes and find nothing.
    await repository.awaitRoleMap('Supporter');
    await repository.awaitRoleMap('Supporter');

    // 06-donor.roles.seed.ts finally runs.
    table.rows = [...BASE_ROLES, ...DONOR_ROLES];

    // Spending a one-shot retry on the earlier calls would have stranded the process here.
    await expect(repository.awaitRoleMap('Supporter')).resolves.toMatchObject({
      Supporter: 75,
    });
  });

  it('costs one extra read per call for a missing role, and none once it is present', async () => {
    const table = new FakeRoleTable();
    table.rows = [...BASE_ROLES];
    const repository = new RoleRepository(dbFor(table));
    await repository.awaitRoleMap();
    const settled = table.queries;

    // A missing name means "this snapshot may predate a seed" -- one re-read, not a loop.
    await repository.awaitRoleMap('NoSuchRole');
    expect(table.queries).toBe(settled + 1);

    // A name already in the map costs nothing at all.
    await repository.awaitRoleMap('Admin');
    expect(table.queries).toBe(settled + 1);
  });

  it('does not re-query once a populated map has settled', async () => {
    const table = new FakeRoleTable();
    table.rows = [...BASE_ROLES];
    const repository = new RoleRepository(dbFor(table));

    await repository.awaitRoleMap();
    await repository.awaitRoleMap();
    await repository.awaitRoleMap('Admin');

    // The eager constructor query, and nothing more: the fix must not turn a cached map
    // into a per-call lookup.
    expect(table.queries).toBe(1);
  });

  it('still recovers when the startup query fails outright', async () => {
    const table = new FakeRoleTable();
    // The API beat the migrations, so `role` does not exist yet.
    table.failure = new Error('ER_NO_SUCH_TABLE');
    const repository = new RoleRepository(dbFor(table));
    await expect(repository.awaitRoleMap()).rejects.toThrow('ER_NO_SUCH_TABLE');

    table.failure = null;
    table.rows = [...BASE_ROLES];
    await expect(repository.awaitRoleMap()).resolves.toEqual({ Admin: 1, CityMayor: 2 });
  });

  it('resolves duplicate role names to the lowest id', async () => {
    const table = new FakeRoleTable();
    // The legacy bad-seed artifact: every role present twice. Ordering here is what stops
    // authorization flipping to a later duplicate, and must survive the lifecycle changes.
    table.rows = [
      { id: 114, name: 'Admin' },
      { id: 1, name: 'Admin' },
    ];
    const repository = new RoleRepository(dbFor(table));

    await expect(repository.awaitRoleMap()).resolves.toEqual({ Admin: 1 });
  });

  describe('concurrent callers', () => {
    it('share one in-flight population instead of each starting their own', async () => {
      const table = new FakeRoleTable();
      table.rows = [...BASE_ROLES];
      const gate = deferred();
      table.hold = gate.promise;

      // The constructor's population is now in flight and cannot settle yet.
      const repository = new RoleRepository(dbFor(table));
      const callers = [
        repository.awaitRoleMap(),
        repository.awaitRoleMap('Admin'),
        repository.awaitRoleMap('CityMayor'),
      ];
      table.hold = null;
      gate.release();
      const results = await Promise.all(callers);

      expect(table.queries).toBe(1);
      results.forEach(result => expect(result).toEqual({ Admin: 1, CityMayor: 2 }));
      // Sharing the population must not mean sharing one mutable object.
      expect(results[0]).not.toBe(results[1]);
    });

    it('all catch up together when the seed lands after an empty read', async () => {
      const table = new FakeRoleTable();
      const repository = new RoleRepository(dbFor(table));

      const cold = await Promise.all([repository.awaitRoleMap(), repository.awaitRoleMap()]);
      cold.forEach(result => expect(result).toEqual({}));

      table.rows = [...BASE_ROLES];
      const warm = await Promise.all([repository.awaitRoleMap(), repository.awaitRoleMap()]);
      warm.forEach(result => expect(result).toEqual({ Admin: 1, CityMayor: 2 }));
    });

    it('never assemble a partial map when racing a mid-bootstrap seed', async () => {
      const table = new FakeRoleTable();
      table.rows = [...BASE_ROLES];
      const repository = new RoleRepository(dbFor(table));
      await repository.awaitRoleMap();

      // 06-donor.roles lands, and three callers asking for different subsets race it.
      table.rows = [...BASE_ROLES, ...DONOR_ROLES];
      const results = await Promise.all([
        repository.awaitRoleMap('Supporter'),
        repository.awaitRoleMap('Champion'),
        repository.awaitRoleMap('Supporter', 'Champion'),
      ]);

      const complete = { Admin: 1, CityMayor: 2, Supporter: 75, Champion: 76 };
      results.forEach(result => expect(result).toEqual(complete));
    });

    it('fail together on a broken query, and the next caller still recovers', async () => {
      const table = new FakeRoleTable();
      table.failure = new Error('ER_NO_SUCH_TABLE');
      const gate = deferred();
      table.hold = gate.promise;
      const repository = new RoleRepository(dbFor(table));

      const callers = [repository.awaitRoleMap(), repository.awaitRoleMap()];
      table.hold = null;
      gate.release();
      // Rejecting is the point: a half-empty map would silently deny a real admin.
      await Promise.all(
        callers.map(caller => expect(caller).rejects.toThrow('ER_NO_SUCH_TABLE')));

      // The memo was cleared, so the failure is not inherited by the next request.
      table.failure = null;
      table.rows = [...BASE_ROLES];
      await expect(repository.awaitRoleMap()).resolves.toEqual({ Admin: 1, CityMayor: 2 });
    });
  });
});
