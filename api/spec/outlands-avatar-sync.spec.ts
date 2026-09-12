import path from 'path';
import knexFactory, { Knex } from 'knex';

import { describeWithDb } from './integration-db';
import { OUTLANDS_AVATARS } from '../db/seed_data/outlands_avatars';
import {
  SYNCED_FIELDS,
  syncOutlandsAvatars,
} from '../db/migrations/20260911190000_sync_outlands_avatars';

/*
 * The Outlands avatar migration runs once, against a database that already
 * holds deployed rows. These specs exercise the deterministic helper the
 * migration calls, which is the only way to run it twice and to inject a
 * failure.
 *
 * Every case runs in its own throwaway schema on the configured server, created
 * and dropped here, so the schema named by DB_DATABASE is never written. The
 * schema is built by the repository's own migrations, so `avatar` has the shape
 * the migration will actually meet.
 */

const MIGRATIONS = {
  directory: path.resolve(__dirname, '../db/migrations'),
  extension: 'ts',
  tableName: 'migrations',
};

const connection = {
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  charset: 'utf8mb4',
};

/** The four public choices the entrance offers, by file name. */
const TEAM_FILES = ['redm.wrl', 'redf.wrl', 'bluem.wrl', 'bluef.wrl'];

/**
 * A stock avatar every deployed database already has. It stands for the rest of
 * the library, and it must come through every case untouched.
 */
const UNRELATED = {
  id: 11,
  name: 'Sparkie',
  filename: 'sparkie.wrl',
  image: 'sparkie.jpg',
  directory: '11',
  status: 1,
  private: 0,
  member_id: null as number | null,
};

let schemaName: string;
let db: Knex;

/** A deployed row for `filename`, deliberately drifted away from the canonical one. */
function staleRow(filename: string): Record<string, unknown> {
  const canonical = OUTLANDS_AVATARS.find(avatar => avatar.filename === filename);
  return {
    id: canonical.id,
    name: `stale ${filename}`,
    filename,
    image: 'stale.jpg',
    directory: 'stale',
    // The state that makes the defect invisible: the row is present and the
    // Outlands entrance still will not serve it, because that path requires
    // `status = 1`. `private = 0` is drifted too -- a system avatar left
    // public is a row a citizen could list and wear.
    status: 2,
    private: 0,
  };
}

/** The row exactly as the seed writes it. */
function seededRow(filename: string): Record<string, unknown> {
  const canonical = OUTLANDS_AVATARS.find(avatar => avatar.filename === filename);
  return {
    id: canonical.id,
    name: canonical.name,
    filename: canonical.filename,
    image: canonical.image,
    directory: String(canonical.id),
    status: 1,
    private: 1,
  };
}

async function avatarByFile(filename: string): Promise<Record<string, any>> {
  return db('avatar').where({ filename }).first();
}

async function countAvatars(): Promise<number> {
  const [{ total }] = await db('avatar').count('id as total');
  return Number(total);
}

/**
 * What `AvatarRepository.findAllForMemberId` serves a member who owns nothing:
 * active and public. The Outlands avatars must NEVER be in this list -- they
 * are system gameplay resources, not citizen avatars -- so this is the negative
 * control the corrected product rule is measured against.
 */
async function publicLibraryFiles(): Promise<string[]> {
  const rows = await db('avatar').where({ status: 1, private: 0 }).select('filename');
  return rows.map(row => row.filename);
}

/**
 * What `AvatarRepository.findSystemByFilenames` serves the Outlands entrance:
 * active, unowned, and reached by file name regardless of `private`.
 */
async function outlandsSystemFiles(): Promise<string[]> {
  const rows = await db('avatar')
    .where({ status: 1 })
    .whereNull('member_id')
    .whereIn('filename', OUTLANDS_AVATARS.map(avatar => avatar.filename))
    .select('filename');
  return rows.map(row => row.filename);
}

describeWithDb('outlands avatar sync', () => {
  beforeAll(async () => {
    schemaName = `ctr_outlands_avatar_spec_${process.pid}`;
    const server = knexFactory({ client: 'mysql', connection });
    await server.raw('DROP DATABASE IF EXISTS ??', [schemaName]);
    await server.raw('CREATE DATABASE ?? CHARACTER SET utf8mb4', [schemaName]);
    await server.destroy();

    db = knexFactory({
      client: 'mysql',
      connection: { ...connection, database: schemaName },
      pool: { min: 0, max: 5 },
      migrations: MIGRATIONS,
    });
    await db.migrate.latest();
  }, 300000);

  afterAll(async () => {
    if (!db) return;
    await db.raw('DROP DATABASE IF EXISTS ??', [schemaName]);
    await db.destroy();
  });

  beforeEach(async () => {
    await db('avatar').del();
  });

  it('leaves an empty avatar table to the seeds', async () => {
    const result = await syncOutlandsAvatars(db);

    expect(result.skipped).toBe(true);
    expect(result.inserted).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(await countAvatars()).toBe(0);
  });

  it('inserts all five into a deployed database that has none of them', async () => {
    await db('avatar').insert(UNRELATED);

    const result = await syncOutlandsAvatars(db);

    expect(result.skipped).toBe(false);
    expect(result.inserted.sort()).toEqual(
      OUTLANDS_AVATARS.map(avatar => avatar.filename).sort(),
    );
    expect(result.updated).toEqual([]);
    expect(await countAvatars()).toBe(OUTLANDS_AVATARS.length + 1);
  });

  it('gives the entrance all four team avatars and the library none of them', async () => {
    await db('avatar').insert(UNRELATED);
    expect(await outlandsSystemFiles()).not.toEqual(expect.arrayContaining(TEAM_FILES));

    await syncOutlandsAvatars(db);

    // The Outlands-only path finds every one of them.
    expect(await outlandsSystemFiles()).toEqual(expect.arrayContaining(TEAM_FILES));
    // The ordinary citizen library finds none of them, the Game Master included.
    const library = await publicLibraryFiles();
    for (const avatar of OUTLANDS_AVATARS) {
      expect(library).not.toContain(avatar.filename);
    }
    // and it still holds the avatars that are genuinely public.
    expect(library).toContain('sparkie.wrl');
  });

  it('inserts only the rows that are missing and keeps the ids of the rest', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert(seededRow('redm.wrl'));
    await db('avatar').insert(seededRow('bluef.wrl'));
    const before = new Map(
      (await db('avatar').select('id', 'filename')).map(row => [row.filename, row.id]),
    );

    const result = await syncOutlandsAvatars(db);

    expect(result.inserted.sort()).toEqual(['bluem.wrl', 'gm.wrl', 'redf.wrl']);
    expect(result.updated).toEqual([]);
    expect(await countAvatars()).toBe(OUTLANDS_AVATARS.length + 1);

    const after = new Map(
      (await db('avatar').select('id', 'filename')).map(row => [row.filename, row.id]),
    );
    for (const [filename, id] of before) expect(after.get(filename)).toBe(id);
  });

  it('repairs a stale row in place and keeps its id', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert(staleRow('redm.wrl'));
    const before = await avatarByFile('redm.wrl');

    const result = await syncOutlandsAvatars(db);

    expect(result.updated).toEqual(['redm.wrl']);
    const after = await avatarByFile('redm.wrl');
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('Outlands Red Team (male)');
    expect(after.image).toBe('redm.jpg');
    expect(after.directory).toBe('16');
    expect(Number(after.status)).toBe(1);
    expect(Number(after.private)).toBe(1);
  });

  it('matches every canonical field and leaves unrelated avatars alone', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert(staleRow('bluem.wrl'));

    await syncOutlandsAvatars(db);

    const rows = await db('avatar').select('*');
    const byFile = new Map(rows.map(row => [row.filename, row]));
    const mismatches: string[] = [];
    for (const avatar of OUTLANDS_AVATARS) {
      const row = byFile.get(avatar.filename);
      if (!row) {
        mismatches.push(`${avatar.filename}: missing`);
        continue;
      }
      if (Number(row.id) !== avatar.id) mismatches.push(`${avatar.filename}: id ${row.id}`);
      if (row.name !== avatar.name) mismatches.push(`${avatar.filename}: name`);
      if (row.image !== avatar.image) mismatches.push(`${avatar.filename}: image`);
      if (row.directory !== String(avatar.id)) mismatches.push(`${avatar.filename}: directory`);
      if (Number(row.status) !== 1) mismatches.push(`${avatar.filename}: status`);
      if (Number(row.private) !== 1) mismatches.push(`${avatar.filename}: private`);
    }
    expect(mismatches).toEqual([]);

    const sparkie = await avatarByFile('sparkie.wrl');
    expect(sparkie.name).toBe('Sparkie');
    expect(sparkie.directory).toBe('11');
    expect(Number(sparkie.id)).toBe(11);
  });

  it('changes nothing on a second run', async () => {
    await db('avatar').insert(UNRELATED);
    await syncOutlandsAvatars(db);
    const before = await db('avatar').select('*').orderBy('id');

    const result = await syncOutlandsAvatars(db);

    expect(result.skipped).toBe(false);
    expect(result.inserted).toEqual([]);
    expect(result.updated).toEqual([]);
    const after = await db('avatar').select('*').orderBy('id');
    expect(after).toEqual(before);
  });

  it('refuses to take an id that belongs to another avatar', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert({
      id: 15, name: 'Someone else', filename: 'someoneelse.wrl', image: 'x.jpg',
      directory: '15', status: 1, private: 0,
    });

    await expect(syncOutlandsAvatars(db)).rejects.toThrow(
      /avatar id 15 is already someoneelse\.wrl/,
    );
    // The conflict is found before a single write, so nothing landed.
    expect(await countAvatars()).toBe(2);
    expect(await avatarByFile('redm.wrl')).toBeUndefined();
  });

  it('refuses to move an Outlands file name that is already another id', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert({
      id: 40, name: 'Copy of Red', filename: 'redm.wrl', image: 'x.jpg',
      directory: '40', status: 1, private: 0,
    });

    await expect(syncOutlandsAvatars(db)).rejects.toThrow(
      /redm\.wrl is already avatar id 40/,
    );
    expect(await countAvatars()).toBe(2);
  });

  it('refuses to take over a row a member owns', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert({ ...seededRow('bluef.wrl'), member_id: 77 });

    await expect(syncOutlandsAvatars(db)).rejects.toThrow(
      /avatar id 13 \(bluef\.wrl\) belongs to member 77/,
    );
    expect(await countAvatars()).toBe(2);
    expect(await avatarByFile('redm.wrl')).toBeUndefined();
  });

  it('rolls back every write when the repair fails part way through', async () => {
    await db('avatar').insert(UNRELATED);
    await db('avatar').insert(staleRow('redm.wrl'));
    const before = await db('avatar').select('*').orderBy('id');

    /*
     * Fail after the inserts and the updates have been issued but before the
     * migration's own transaction commits. A Proxy stands in for the knex
     * instance so the migration is not modified to be testable: it still calls
     * `knex('avatar')` and `knex.transaction` exactly as it does in production.
     */
    const failing = new Proxy(db, {
      get(target: any, prop, receiver) {
        if (prop === 'transaction') {
          return (handler: any) => target.transaction(async (trx: Knex.Transaction) => {
            await handler(trx);
            throw new Error('injected failure');
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as Knex;

    await expect(syncOutlandsAvatars(failing)).rejects.toThrow('injected failure');

    const after = await db('avatar').select('*').orderBy('id');
    expect(after).toEqual(before);
    expect(await countAvatars()).toBe(2);
  });

  it('owns exactly the columns it claims to own', () => {
    expect(SYNCED_FIELDS).toEqual(
      ['name', 'filename', 'image', 'directory', 'status', 'private'],
    );
  });
});
