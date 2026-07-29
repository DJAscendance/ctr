import { spawnSync } from 'child_process';

import knexFactory, { Knex } from 'knex';

import { sanitizeUserHtml } from '../../src/libs';
import {
  up,
  down,
} from '../../db/migrations/20260729010000_split_place_information';

/**
 * The sanitizer is wrapped so a failure can be injected part-way through the
 * copy loop - i.e. AFTER some rows have already been written inside the
 * transaction. That is the only realistic mid-migration failure, and it is a far
 * better probe than stubbing knex.transaction (which is a read-only property on
 * the knex function and cannot be spied on anyway).
 */
jest.mock('../../src/libs', () => {
  const actual = jest.requireActual('../../src/libs');
  return { ...actual, sanitizeUserHtml: jest.fn(actual.sanitizeUserHtml) };
});
const realSanitize = jest.requireActual('../../src/libs').sanitizeUserHtml;

/**
 * Behavioural tests for the Information/Description split migration.
 *
 * These run against a REAL MySQL database, because every property worth testing
 * here is a database property: that a transaction actually rolls back, that a
 * partial backup is actually detected, that a row created after `up()` actually
 * survives `down()`. A mocked knex would only prove the code calls the methods
 * this file already says it calls.
 *
 * A disposable scratch database is created and dropped per run, so nothing
 * touches the preview data. Connection details come from the same environment
 * the API uses.
 *
 * IF NO DATABASE IS REACHABLE the suite skips rather than fails: the repository's
 * existing baseline has suites that cannot run without MySQL, and this must not
 * add a new failure where none existed. A skip is reported loudly.
 */

const CONNECTION = {
  host: process.env.DB_HOST ? process.env.DB_HOST.replace(/"/g, '') : '127.0.0.1',
  port: Number.parseInt((process.env.DB_PORT || '3306').replace(/"/g, ''), 10),
  user: process.env.DB_USER ? process.env.DB_USER.replace(/"/g, '') : 'root',
  password: process.env.DB_PASS ? process.env.DB_PASS.replace(/"/g, '') : '',
};

const SCRATCH_DB = 'ctr_split_information_spec';

/**
 * Whether the database can be reached, decided SYNCHRONOUSLY at module load.
 *
 * It has to be synchronous: Jest picks `describe` vs `describe.skip` while the
 * file is being evaluated, long before any async hook has run. Deciding this in
 * `beforeAll` silently skipped the whole suite even when MySQL was up - the
 * tests reported as "skipped" and nothing was actually verified.
 */
function databaseReachable(): boolean {
  const probe = spawnSync(process.execPath, ['-e', `
    const net = require('net');
    const socket = net.connect(${CONNECTION.port}, ${JSON.stringify(CONNECTION.host)});
    socket.setTimeout(3000);
    socket.on('connect', () => { socket.destroy(); process.exit(0); });
    socket.on('error', () => process.exit(1));
    socket.on('timeout', () => { socket.destroy(); process.exit(1); });
  `], { timeout: 8000 });
  return probe.status === 0;
}

let db: Knex | null = null;
const available = databaseReachable();

if (!available) {
  // eslint-disable-next-line no-console
  console.warn(
    `SKIPPING migration suite: no MySQL at ${CONNECTION.host}:${CONNECTION.port}. `
    + 'These tests need a real database; run with DB_HOST/DB_PORT pointing at one.',
  );
}

/** The subset of `place` this migration reads or writes. */
async function createPlaceTable(target: Knex): Promise<void> {
  // utf8mb4_unicode_ci deliberately: that is the real `place` table's collation,
  // and it differs from the utf8mb4_general_ci a freshly created table inherits.
  // Creating the fixture with the database default hid a real defect - down()'s
  // text comparison died with ER_CANT_AGGREGATE_2COLLATIONS on the actual data
  // while every test here passed.
  await target.raw(`
    create table place (
      id int unsigned not null auto_increment primary key,
      name varchar(255) not null default '',
      slug varchar(255) null,
      type varchar(255) not null default 'public',
      description text
    ) default charset=utf8mb4 collate=utf8mb4_unicode_ci
  `);
}

const FIXTURES = [
  // A public place holding manager HTML: its administrative description is
  // provable from the seed (description = slug).
  {
    id: 7, name: 'mall', slug: 'mall', type: 'public',
    description: '<h3>Welcome to the Mall</h3><p>Open <b>daily</b>.</p>',
  },
  // A hood holding manager HTML: hoods are never seeded with a description.
  {
    id: 891, name: 'The Shadows', slug: '0101020200000000', type: 'hood',
    description: '<h3>The Shadows</h3>',
  },
  // Plain text on a non-home place: presumed administrative, must be untouched.
  {
    id: 1369, name: 'Psychology', slug: null, type: 'block',
    description: 'this is a test',
  },
  // A home: description was only ever its Information.
  {
    id: 857, name: 'BassMekanik\'s Home', slug: null, type: 'home',
    description: 'Welcome to my <b>house boat</b><script>alert(1)</script>',
  },
  // An administrative description with no Information editor at all.
  {
    id: 900, name: 'A Shop', slug: 'shop-a', type: 'shop',
    description: 'shop admin text',
  },
];

async function resetFixtures(): Promise<void> {
  const target = db as Knex;
  await target.schema.dropTableIfExists('place_information_migration_backup');
  await target.schema.dropTableIfExists('place_information_rollback_archive');
  await target.schema.dropTableIfExists('place');
  await createPlaceTable(target);
  await target('place').insert(FIXTURES);
}

const describeIfDb = () => (available ? describe : describe.skip);

beforeAll(async () => {
  if (!available) return;
  const root = knexFactory({ client: 'mysql', connection: CONNECTION });
  await root.raw(`drop database if exists ${SCRATCH_DB}`);
  await root.raw(`create database ${SCRATCH_DB} character set utf8mb4`);
  await root.destroy();
  db = knexFactory({
    client: 'mysql',
    connection: { ...CONNECTION, database: SCRATCH_DB, charset: 'utf8mb4' },
  });
  await db.raw('select 1');
}, 30000);

afterAll(async () => {
  if (db) {
    await db.raw(`drop database if exists ${SCRATCH_DB}`).catch(() => undefined);
    await db.destroy();
  }
});

describeIfDb()('20260729010000_split_place_information', () => {
  const backup = () => (db as Knex)('place_information_migration_backup');
  const places = () => (db as Knex)('place');
  const byId = async (id: number) => (await places().where('id', id).first()) as any;

  beforeEach(async () => {
    // jest.config sets clearMocks, which strips the passthrough implementation.
    (sanitizeUserHtml as jest.Mock).mockImplementation(realSanitize);
    await resetFixtures();
  });

  describe('up: moving existing data', () => {
    beforeEach(async () => {
      await up(db as Knex);
    });

    it('copies every Information value into the new column, sanitized', async () => {
      expect((await byId(7)).information)
        .toEqual('<h3>Welcome to the Mall</h3><p>Open <b>daily</b>.</p>');
      // The home's value was never sanitized before; the script must be gone.
      expect((await byId(857)).information)
        .toEqual('Welcome to my <b>house boat</b>');
    });

    it('restores a public place\'s administrative description from its slug', async () => {
      expect((await byId(7)).description).toEqual('mall');
    });

    it('clears a hood description, which was never seeded', async () => {
      expect((await byId(891)).description).toBeNull();
    });

    it('leaves plain administrative text alone', async () => {
      expect((await byId(1369)).description).toEqual('this is a test');
    });

    it('clears a home description, which was only ever Information', async () => {
      expect((await byId(857)).description).toBeNull();
    });

    it('ignores types with no Information editor', async () => {
      const shop = await byId(900);
      expect(shop.description).toEqual('shop admin text');
      expect(shop.information).toBeNull();
    });

    it('backs up every row that had a description, stamped with this migration',
      async () => {
        const rows = await backup().select('*').orderBy('place_id');
        expect(rows.map((r: any) => r.place_id)).toEqual([7, 857, 891, 900, 1369]);
        expect(rows.every((r: any) => r.migration_id
          === '20260729010000_split_place_information')).toBe(true);
        expect(rows.find((r: any) => r.place_id === 857).description)
          .toEqual('Welcome to my <b>house boat</b><script>alert(1)</script>');
      });
  });

  describe('up: failure inside the content phase', () => {
    it('rolls back every description when a mid-migration failure is injected',
      async () => {
        const before = await places().select('id', 'description').orderBy('id');

        // Succeed for the first row, then fail. By then at least one row has
        // already had `information` written inside the transaction, so a rollback
        // is genuinely required rather than merely convenient.
        (sanitizeUserHtml as jest.Mock)
          .mockImplementationOnce(realSanitize)
          .mockImplementationOnce(() => {
            throw new Error('injected mid-migration failure');
          });

        await expect(up(db as Knex)).rejects.toThrow('injected mid-migration failure');

        const after = await places().select('id', 'description').orderBy('id');
        expect(after).toEqual(before);

        // No row may have been left half-copied either.
        const copied = await places().whereNotNull('information').count({ c: '*' });
        expect(Number((copied[0] as any).c)).toEqual(0);
      });

    it('leaves the backup table safe to retry after a failed attempt', async () => {
      (sanitizeUserHtml as jest.Mock)
        .mockImplementationOnce(realSanitize)
        .mockImplementationOnce(() => {
          throw new Error('injected mid-migration failure');
        });
      await expect(up(db as Knex)).rejects.toThrow();

      // The retry must succeed: the backup left behind is complete and ours.
      (sanitizeUserHtml as jest.Mock).mockImplementation(realSanitize);
      await up(db as Knex);

      expect((await byId(7)).description).toEqual('mall');
      expect((await byId(857)).description).toBeNull();
    });
  });

  describe('up: an existing backup table', () => {
    beforeEach(async () => {
      await (db as Knex).schema.createTable(
        'place_information_migration_backup', table => {
          table.integer('place_id').unsigned().primary();
          table.text('description').nullable();
          table.text('description_after').nullable();
          table.string('migration_id', 128).notNullable();
        },
      );
    });

    it('fails closed when the backup is incomplete', async () => {
      await backup().insert({
        place_id: 7, description: 'mall', migration_id:
          '20260729010000_split_place_information',
      });

      await expect(up(db as Knex)).rejects.toThrow(/incomplete/);
      // and nothing was cleared on top of it
      expect((await byId(857)).description).toContain('house boat');
    });

    it('fails closed when the backup belongs to another migration', async () => {
      for (const row of FIXTURES) {
        await backup().insert({
          place_id: row.id, description: row.description, migration_id: 'something-else',
        });
      }

      await expect(up(db as Knex)).rejects.toThrow(/stale or foreign/);
      expect((await byId(857)).description).toContain('house boat');
    });

    it('fails closed when the backup has the wrong schema', async () => {
      await (db as Knex).schema.dropTable('place_information_migration_backup');
      await (db as Knex).schema.createTable(
        'place_information_migration_backup', table => {
          table.integer('place_id').unsigned().primary();
        },
      );

      await expect(up(db as Knex)).rejects.toThrow(/unexpected schema/);
      expect((await byId(857)).description).toContain('house boat');
    });

    it('fails closed on duplicate backup rows', async () => {
      // A composite-keyed table is the only way to hold duplicates; rebuild it so
      // the duplicate can exist at all, which is precisely the ambiguous state.
      await (db as Knex).schema.dropTable('place_information_migration_backup');
      await (db as Knex).schema.createTable(
        'place_information_migration_backup', table => {
          table.integer('place_id').unsigned().notNullable();
          table.text('description').nullable();
          table.text('description_after').nullable();
          table.string('migration_id', 128).notNullable();
        },
      );
      for (const row of FIXTURES) {
        await backup().insert({
          place_id: row.id,
          description: row.description,
          migration_id: '20260729010000_split_place_information',
        });
      }
      await backup().insert({
        place_id: 7, description: 'a different original',
        migration_id: '20260729010000_split_place_information',
      });

      await expect(up(db as Knex)).rejects.toThrow(/duplicated place_id/);
      expect((await byId(857)).description).toContain('house boat');
    });
  });

  describe('down: what it may and may not touch', () => {
    beforeEach(async () => {
      await up(db as Knex);
    });

    it('restores the original descriptions exactly', async () => {
      await down(db as Knex);

      expect((await byId(7)).description)
        .toEqual('<h3>Welcome to the Mall</h3><p>Open <b>daily</b>.</p>');
      expect((await byId(891)).description).toEqual('<h3>The Shadows</h3>');
      expect((await byId(857)).description)
        .toEqual('Welcome to my <b>house boat</b><script>alert(1)</script>');
      expect((await byId(1369)).description).toEqual('this is a test');
    });

    it('leaves a row created AFTER up() untouched', async () => {
      await places().insert({
        id: 5000, name: 'New Place', slug: 'new-place', type: 'public',
        description: 'created after the migration',
      });

      await down(db as Knex);

      expect((await byId(5000)).description).toEqual('created after the migration');
    });

    it('keeps an administrative description written to a previously-null row',
      async () => {
        // 891's description was cleared by up(); an administrator then wrote one.
        await places().where('id', 891).update({ description: 'a real admin summary' });

        await down(db as Knex);

        expect((await byId(891)).description).toEqual('a real admin summary');
      });

    it('keeps an administrative description CHANGED after up()', async () => {
      await places().where('id', 1369).update({ description: 'edited by an admin' });

      await down(db as Knex);

      expect((await byId(1369)).description).toEqual('edited by an admin');
    });

    it('archives Information written after up() instead of destroying it', async () => {
      await places().where('id', 7).update({ information: '<p>brand new notice</p>' });

      await down(db as Knex);

      const archived = await (db as Knex)('place_information_rollback_archive')
        .where('place_id', 7).first() as any;
      expect(archived.information).toEqual('<p>brand new notice</p>');
    });

    it('drops the column and the backup table', async () => {
      await down(db as Knex);

      expect(await (db as Knex).schema.hasColumn('place', 'information')).toBe(false);
      expect(await (db as Knex).schema
        .hasTable('place_information_migration_backup')).toBe(false);
    });
  });

  describe('up -> down -> up again', () => {
    it('returns the same result as the first run', async () => {
      await up(db as Knex);
      const first = await places().select('id', 'description', 'information').orderBy('id');

      await down(db as Knex);
      const restored = await places().select('id', 'description').orderBy('id');
      // Plain objects: the driver returns RowDataPacket instances, which are not
      // deep-equal to object literals however identical their contents.
      expect(restored.map((r: any) => ({ id: r.id, description: r.description })))
        .toEqual(
          [...FIXTURES]
            .sort((a, b) => a.id - b.id)
            .map(f => ({ id: f.id, description: f.description })),
        );

      await up(db as Knex);
      const second = await places().select('id', 'description', 'information').orderBy('id');
      expect(second.map((r: any) => ({ ...r }))).toEqual(first.map((r: any) => ({ ...r })));
    });
  });
});
