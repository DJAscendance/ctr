import http from 'http';
import path from 'path';
import knexFactory, { Knex } from 'knex';
import jwt from 'jsonwebtoken';

import { describeWithDb } from './integration-db';
import { syncOutlandsAvatars } from '../db/migrations/20260911190000_sync_outlands_avatars';
import { OUTLANDS_GAME_MASTER_FILENAME, OUTLANDS_TEAM_AVATARS } from '../src/libs';

/*
 * STRICT AVATAR ID VALIDATION, OVER REAL HTTP.
 *
 * Independent QA found `POST /api/avatar/outlands` answering `avatarId = [13]`
 * with a real Outlands team avatar, because the id was compared after
 * `Number()` and `Number([13])` is `13`. The same shape reached
 * `POST /api/member/update_avatar`, where MySQL rather than `Number()` did the
 * coercing and `[11]` was then WRITTEN BACK as a citizen's stored avatar id.
 *
 * These cases are asserted through the actual transport: the real routes are
 * mounted on a real express app listening on an OS-assigned port, the bodies
 * are real JSON sent over a real socket, and the answer inspected is the real
 * HTTP status and payload. A helper asserted on its own would not have caught
 * the original defect, because the helper was not the thing that was wrong --
 * the comparison downstream of it was.
 *
 * Everything runs in a schema this file creates and drops. `describeWithDb`
 * refuses to run at all unless CTR_INTEGRATION_TEST_DB names the configured
 * database exactly, so an unattended or shared environment skips instead of
 * writing.
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

/** An ordinary public avatar. The citizen's own, and the control for a valid write. */
const PUBLIC_AVATAR = {
  id: 11,
  name: 'Sparkie',
  filename: 'sparkie.wrl',
  image: 'sparkie.jpg',
  directory: '11',
  status: 1,
  private: 0,
  member_id: null as number | null,
};

/*
 * The historical team mapping, restated as the answer a citizen must receive.
 * `ne_game.wrl` reads the side off the avatar FILE, so a wrong file here is a
 * citizen fighting for the wrong team.
 */
const TEAM_FILE_BY_ID: Record<number, string> = {
  13: 'bluef.wrl',
  14: 'bluem.wrl',
  15: 'redf.wrl',
  16: 'redm.wrl',
};

/*
 * The malformed values a JSON body can actually carry. JSON has no `undefined`
 * and no `NaN`/`Infinity` literal, so "missing" is tested by omitting the key
 * and the non-finite numbers are left to `client-id.spec.ts`, which can hold a
 * real JavaScript value. Inventing an impossible HTTP case would prove nothing.
 */
const MALFORMED_BODIES: Array<[string, Record<string, unknown>]> = [
  ['an array holding the id', { avatarId: [13] }],
  ['an array holding the id as a string', { avatarId: ['13'] }],
  ['an empty array', { avatarId: [] }],
  ['the id as a string', { avatarId: '13' }],
  ['the id as a zero-padded string', { avatarId: '013' }],
  ['the id as a padded string', { avatarId: ' 13 ' }],
  ['an object', { avatarId: {} }],
  ['an object carrying the id', { avatarId: { id: 13 } }],
  ['true', { avatarId: true }],
  ['false', { avatarId: false }],
  ['null', { avatarId: null }],
  ['a fraction', { avatarId: 13.5 }],
  ['a negative integer', { avatarId: -13 }],
  ['zero', { avatarId: 0 }],
  ['an integer past the safe range', { avatarId: Number.MAX_SAFE_INTEGER + 1 }],
  ['a very large numeric value', { avatarId: 1e308 }],
  ['a missing avatarId', {}],
];

let schemaName: string;
let db: Knex;
let server: http.Server;
let baseUrl: string;
let citizen: number;
let citizenToken: string;
let gameMasterId: number;

/** Express's own listening address, narrowed from the string|AddressInfo union. */
type AddressInfo = { port: number };

/** What a round trip answers with: the status, the parsed JSON, and the raw text. */
interface Answer {
  status: number;
  /*
   * Deliberately loose. These cases assert on what the API answers a MALFORMED
   * request with, and the whole point is that the shape is not known in advance
   * -- a field that should be absent is read exactly to prove it is absent.
   */
  body: Record<string, unknown> & {
    avatar?: { id: number; filename: string };
    avatars?: Array<{ filename: string }>;
  };
  raw: string;
}

/**
 * Anything in a response body that would be internal detail escaping: a stack
 * frame, a source location, a dependency path, a driver error code, or SQL.
 */
const LEAK = /at [A-Za-z]+\s*\(?\/|\.ts:\d+|node_modules|ER_|select \*|knex/;

/** A real HTTP round trip. Returns the status and the parsed JSON answer. */
function request(
  method: string,
  route: string,
  body: unknown,
  token: string,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const url = new URL(`${baseUrl}${route}`);
    const headers: Record<string, string> = { apitoken: token };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method, headers },
      response => {
        let raw = '';
        response.on('data', chunk => { raw += chunk; });
        response.on('end', () => {
          let parsed: Record<string, unknown> = null;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          resolve({ status: response.statusCode, body: parsed, raw });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** The Outlands gameplay selection, as the citizen's own token. */
function postOutlands(body: unknown): Promise<Answer> {
  return request('POST', '/api/avatar/outlands', body, citizenToken);
}

/** The persistent avatar write, as the citizen's own token. */
function postPersistent(body: unknown): Promise<Answer> {
  return request('POST', '/api/member/update_avatar', body, citizenToken);
}

/** The file names in a GET /avatar/outlands answer. */
function filenamesOf(answer: Answer): string[] {
  return answer.body.avatars.map(avatar => avatar.filename);
}

/** The stored avatar id of the citizen, straight off the row. */
async function storedAvatarId(): Promise<unknown> {
  const [row] = await db('member').select('avatar_id').where({ id: citizen });
  return row.avatar_id;
}

describeWithDb('outlands strict avatar id validation over HTTP', () => {
  beforeAll(async () => {
    schemaName = `ctr_strict_id_test_${process.pid}`;
    const admin = knexFactory({ client: 'mysql', connection });
    await admin.raw(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await admin.raw(`CREATE DATABASE \`${schemaName}\``);
    await admin.destroy();

    db = knexFactory({
      client: 'mysql',
      connection: { ...connection, database: schemaName },
      migrations: MIGRATIONS,
    });
    await db.migrate.latest();

    /*
     * The controllers are module-level singletons wired to a `Db` that reads
     * DB_DATABASE when it is first constructed. Pointing the variable at the
     * throwaway schema BEFORE the first require is what keeps this suite off
     * the configured database while still exercising the real, unmodified
     * wiring rather than a hand-built copy of it.
     */
    process.env.DB_DATABASE = schemaName;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const express = require('express');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { avatarRoutes, memberRoutes } = require('../src/routes');

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/api/avatar', avatarRoutes);
    app.use('/api/member', memberRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180000);

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    // The singleton `Db` the real routes were wired to holds its own pool. Left
    // open, jest reports the run as finished and then hangs on the handle.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Container } = require('typedi');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Db } = require('../src/db/db.class');
    await Container.get(Db).knex.destroy();
    if (db) await db.destroy();
    const admin = knexFactory({ client: 'mysql', connection });
    await admin.raw(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await admin.destroy();
  });

  beforeEach(async () => {
    await db('member').del();
    await db('wallet').del();
    await db('avatar').del();
    await db('avatar').insert(PUBLIC_AVATAR);
    // The migration a deployed Beta runs, so the rows are the deployed rows.
    await syncOutlandsAvatars(db);

    const [wallet] = await db('wallet').insert({ balance: 0 });
    [citizen] = await db('member').insert({
      username: 'strict_id_citizen', email: 'strict@example.test', password: 'x',
      avatar_id: PUBLIC_AVATAR.id, wallet_id: wallet,
    });
    citizenToken = jwt.sign(
      { id: citizen, username: 'strict_id_citizen', avatar: PUBLIC_AVATAR, admin: false },
      process.env.JWT_SECRET,
    );
    const [gm] = await db('avatar')
      .select('id').where({ filename: OUTLANDS_GAME_MASTER_FILENAME });
    gameMasterId = gm.id;
  });

  // -------------------------------------------------------------------------
  // The exact finding.
  // -------------------------------------------------------------------------

  describe('the exact QA finding', () => {
    it('refuses avatarId = [13] and issues no Outlands avatar', async () => {
      // The coercion that used to answer this with a real row.
      expect(Number([13])).toBe(13);

      const answer = await postOutlands({ avatarId: [13] });
      expect(answer.status).toBe(400);
      expect(answer.body.avatar).toBeUndefined();
      expect(answer.raw).not.toContain('bluef.wrl');
    });

    it('leaves the citizen holding their own avatar after [13] is refused', async () => {
      await request('POST', '/api/avatar/outlands', { avatarId: [13] }, citizenToken);
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });

    it('refuses avatarId = [11] on the persistent path and writes nothing', async () => {
      // MySQL coerces a single-element array in a `where id = ?` binding, so this
      // used to match avatar 11 and store the ARRAY as the citizen's avatar id.
      const answer = await postPersistent({ avatarId: [11] });
      expect(answer.status).toBe(400);
      expect(answer.body.token).toBeUndefined();
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/avatar/outlands
  // -------------------------------------------------------------------------

  describe('POST /avatar/outlands', () => {
    it.each(MALFORMED_BODIES)('refuses %s', async (_label, body) => {
      const answer = await request('POST', '/api/avatar/outlands', body, citizenToken);
      expect(answer.status).toBe(400);
      expect(answer.body.avatar).toBeUndefined();
      expect(answer.body.token).toBeUndefined();
    });

    it.each(MALFORMED_BODIES)('leaks no internal detail for %s', async (_label, body) => {
      const answer = await request('POST', '/api/avatar/outlands', body, citizenToken);
      expect(typeof answer.body.error).toBe('string');
      expect(answer.raw).not.toMatch(LEAK);
    });

    it.each(MALFORMED_BODIES)('leaves member.avatar_id unchanged for %s', async (_label, body) => {
      await request('POST', '/api/avatar/outlands', body, citizenToken);
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });

    it.each(Object.keys(TEAM_FILE_BY_ID).map(Number))(
      'still answers the valid team id %i with its historical avatar',
      async id => {
        const answer = await postOutlands({ avatarId: id });
        expect(answer.status).toBe(200);
        expect(answer.body.avatar.filename).toBe(TEAM_FILE_BY_ID[id]);
        expect(answer.body.avatar.id).toBe(id);
      },
    );

    it('issues no authentication token with a valid team avatar', async () => {
      const answer = await request('POST', '/api/avatar/outlands', { avatarId: 13 }, citizenToken);
      expect(answer.status).toBe(200);
      expect(answer.body.token).toBeUndefined();
    });

    it('does not write member.avatar_id for a valid team avatar', async () => {
      await request('POST', '/api/avatar/outlands', { avatarId: 13 }, citizenToken);
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });

    it('refuses the Game Master, a well formed id the database refuses', async () => {
      const answer = await request(
        'POST', '/api/avatar/outlands', { avatarId: gameMasterId }, citizenToken,
      );
      expect(answer.status).toBe(400);
      expect(answer.raw).not.toContain(OUTLANDS_GAME_MASTER_FILENAME);
    });

    it.each([1, 11, 17, 999999, Number.MAX_SAFE_INTEGER])(
      'refuses the well formed but unauthorised id %i',
      async id => {
        const answer = await postOutlands({ avatarId: id });
        expect(answer.status).toBe(400);
        expect(answer.body.avatar).toBeUndefined();
      },
    );

    it('refuses every id when the request carries no token', async () => {
      const answer = await request('POST', '/api/avatar/outlands', { avatarId: 13 }, 'not-a-token');
      expect(answer.status).toBe(400);
      expect(answer.body.avatar).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Database authority: the rows decide, not the client and not a constant.
  // -------------------------------------------------------------------------

  describe('database authority', () => {
    it('refuses a team id whose row is inactive, and omits it from the choices', async () => {
      await db('avatar').where({ filename: 'bluef.wrl' }).update({ status: 0 });

      const choices = await request('GET', '/api/avatar/outlands', undefined, citizenToken);
      expect(filenamesOf(choices)).not.toContain('bluef.wrl');

      const answer = await request('POST', '/api/avatar/outlands', { avatarId: 13 }, citizenToken);
      expect(answer.status).toBe(400);
      expect(answer.raw).not.toContain('bluef.wrl');
    });

    it('refuses a team id whose row is missing, and omits it from the choices', async () => {
      await db('avatar').where({ filename: 'bluef.wrl' }).del();

      const choices = await request('GET', '/api/avatar/outlands', undefined, citizenToken);
      expect(filenamesOf(choices)).not.toContain('bluef.wrl');

      const answer = await request('POST', '/api/avatar/outlands', { avatarId: 13 }, citizenToken);
      expect(answer.status).toBe(400);
      expect(answer.raw).not.toContain('bluef.wrl');
    });

    it('still serves the other three choices while one row is gone', async () => {
      await db('avatar').where({ filename: 'bluef.wrl' }).del();
      const choices = await request('GET', '/api/avatar/outlands', undefined, citizenToken);
      const files = filenamesOf(choices);
      expect(files.sort()).toEqual(['bluem.wrl', 'redf.wrl', 'redm.wrl']);
    });

    it('never offers the Game Master among the choices', async () => {
      const choices = await request('GET', '/api/avatar/outlands', undefined, citizenToken);
      const files = filenamesOf(choices);
      expect(files).not.toContain(OUTLANDS_GAME_MASTER_FILENAME);
      expect(files).toEqual(OUTLANDS_TEAM_AVATARS.map(avatar => avatar.filename));
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/member/avatar -- the persistent write. Same rule, same helper.
  // -------------------------------------------------------------------------

  describe('POST /member/update_avatar', () => {
    it.each(MALFORMED_BODIES)('refuses %s and persists nothing', async (_label, body) => {
      const answer = await request('POST', '/api/member/update_avatar', body, citizenToken);
      expect(answer.status).toBe(400);
      expect(answer.body.token).toBeUndefined();
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });

    it('still persists an ordinary public avatar', async () => {
      const [otherId] = await db('avatar').insert({
        name: 'Another', filename: 'other.wrl', image: 'other.jpg',
        directory: '900', status: 1, private: 0, member_id: null,
      });
      const answer = await request(
        'POST', '/api/member/update_avatar', { avatarId: otherId }, citizenToken,
      );
      expect(answer.status).toBe(200);
      expect(await storedAvatarId()).toBe(otherId);
    });

    it.each([12, 13, 14, 15, 16])('still refuses the system avatar id %i', async id => {
      const answer = await postPersistent({ avatarId: id });
      expect(answer.status).toBe(400);
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });

    it('refuses another private avatar, and accepts the citizen\'s own', async () => {
      const [otherWallet] = await db('wallet').insert({ balance: 0 });
      const [other] = await db('member').insert({
        username: 'strict_id_other', email: 'other@example.test', password: 'x',
        avatar_id: PUBLIC_AVATAR.id, wallet_id: otherWallet,
      });
      const [theirs] = await db('avatar').insert({
        name: 'Theirs', filename: 'theirs.wrl', image: 'theirs.jpg',
        directory: '901', status: 1, private: 1, member_id: other,
      });
      const [mine] = await db('avatar').insert({
        name: 'Mine', filename: 'mine.wrl', image: 'mine.jpg',
        directory: '902', status: 1, private: 1, member_id: citizen,
      });

      const refused = await request(
        'POST', '/api/member/update_avatar', { avatarId: theirs }, citizenToken,
      );
      expect(refused.status).toBe(400);
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);

      const allowed = await request(
        'POST', '/api/member/update_avatar', { avatarId: mine }, citizenToken,
      );
      expect(allowed.status).toBe(200);
      expect(await storedAvatarId()).toBe(mine);
    });

    it('refuses an avatar id that names no row', async () => {
      const answer = await request(
        'POST', '/api/member/update_avatar', { avatarId: 999999 }, citizenToken,
      );
      expect(answer.status).toBe(400);
      expect(await storedAvatarId()).toBe(PUBLIC_AVATAR.id);
    });
  });
});
