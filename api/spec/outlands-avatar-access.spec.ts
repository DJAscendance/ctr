import path from 'path';
import knexFactory, { Knex } from 'knex';

import { describeWithDb } from './integration-db';
import { OUTLANDS_AVATARS } from '../db/seed_data/outlands_avatars';
import { syncOutlandsAvatars } from '../db/migrations/20260911190000_sync_outlands_avatars';
import { OUTLANDS_GAME_MASTER_FILENAME, OUTLANDS_TEAM_AVATARS } from '../src/libs';
import { AvatarRepository } from '../src/repositories';
import { AvatarService } from '../src/services';
import { MemberService } from '../src/services';

/*
 * The Outlands avatars are system gameplay resources, not citizen avatars.
 *
 * These specs hold the access rule that makes that true, against a real schema
 * built by the repository's own migrations, through the REAL repository and
 * service objects rather than a restatement of their SQL. Three separate
 * things have to hold and each is checked on its own:
 *
 *   1. the ordinary avatar library never serves one, to anybody;
 *   2. the persistent avatar-change path never accepts one, to anybody;
 *   3. the Outlands gameplay path serves exactly the four playable ones.
 *
 * Every case runs in its own throwaway schema, created and dropped here, so the
 * schema named by DB_DATABASE is never written.
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

/** The four playable choices, by file name. */
const TEAM_FILES = OUTLANDS_TEAM_AVATARS.map(avatar => avatar.filename);

/** An ordinary public avatar. It stands for the rest of the library. */
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

let schemaName: string;
let db: Knex;
let avatarRepository: AvatarRepository;
let avatarService: AvatarService;

/** The member ids the fixtures use. Citizen A owns a private avatar; citizen B owns none. */
let citizenA: number;
let citizenB: number;
/** Citizen A's own private avatar. */
let privateAvatarId: number;

/**
 * The real repository, pointed at the throwaway schema.
 *
 * `Db` builds its own knex from the ambient environment, which is the schema
 * this spec must never write, so the one member the repository uses is supplied
 * directly. The repository code under test is untouched.
 */
function repositoryFor(knexInstance: Knex): AvatarRepository {
  const stubDb = {
    get avatar() {
      return knexInstance('avatar');
    },
  };
  return new AvatarRepository(stubDb as any);
}

/** `MemberService.updateAvatar` with only the two repositories it uses. */
function memberServiceFor(
  repository: AvatarRepository,
  updated: { memberId?: number; fields?: any },
): MemberService {
  const memberRepository = {
    update: async (memberId: number, fields: any) => {
      updated.memberId = memberId;
      updated.fields = fields;
    },
  };
  return new MemberService(
    repository, null, memberRepository as any, null, null, null, null, null, null, null,
    null, null, null,
  );
}

describeWithDb('outlands system-only avatar access', () => {
  beforeAll(async () => {
    schemaName = `ctr_outlands_access_spec_${process.pid}`;
    const server = knexFactory({ client: 'mysql', connection });
    await server.raw(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await server.raw(`CREATE DATABASE \`${schemaName}\``);
    await server.destroy();

    db = knexFactory({
      client: 'mysql',
      connection: { ...connection, database: schemaName },
      migrations: MIGRATIONS,
    });
    await db.migrate.latest();

    avatarRepository = repositoryFor(db);
    avatarService = new AvatarService(avatarRepository);
  }, 120000);

  afterAll(async () => {
    if (db) await db.destroy();
    const server = knexFactory({ client: 'mysql', connection });
    await server.raw(`DROP DATABASE IF EXISTS \`${schemaName}\``);
    await server.destroy();
  });

  beforeEach(async () => {
    await db('member').del();
    await db('wallet').del();
    await db('avatar').del();
    await db('avatar').insert(PUBLIC_AVATAR);

    // The migration is what a deployed Beta runs, so the rows under test are
    // exactly the rows a deployment ends up with.
    await syncOutlandsAvatars(db);

    const [walletA] = await db('wallet').insert({ balance: 0 });
    const [walletB] = await db('wallet').insert({ balance: 0 });
    [citizenA] = await db('member').insert({
      username: 'access_spec_a', email: 'a@example.test', password: 'x',
      avatar_id: PUBLIC_AVATAR.id, wallet_id: walletA,
    });
    [citizenB] = await db('member').insert({
      username: 'access_spec_b', email: 'b@example.test', password: 'x',
      avatar_id: PUBLIC_AVATAR.id, wallet_id: walletB,
    });
    [privateAvatarId] = await db('avatar').insert({
      name: 'A private avatar', filename: 'apriv.wrl', image: 'apriv.jpg',
      directory: '900', status: 1, private: 1, member_id: citizenA,
    });
  });

  describe('the ordinary avatar library', () => {
    it('serves no Outlands system avatar to any citizen', async () => {
      for (const memberId of [citizenA, citizenB]) {
        const library = await avatarRepository.findAllForMemberId(memberId);
        const files = library.map(avatar => avatar.filename);
        for (const avatar of OUTLANDS_AVATARS) {
          expect(files).not.toContain(avatar.filename);
        }
      }
    });

    it('still serves the ordinary public avatars', async () => {
      const library = await avatarRepository.findAllForMemberId(citizenB);
      expect(library.map(avatar => avatar.filename)).toContain('sparkie.wrl');
    });

    it('still serves a citizen their own private avatar, and nobody else theirs', async () => {
      const mine = await avatarRepository.findAllForMemberId(citizenA);
      expect(mine.map(avatar => avatar.filename)).toContain('apriv.wrl');
      const theirs = await avatarRepository.findAllForMemberId(citizenB);
      expect(theirs.map(avatar => avatar.filename)).not.toContain('apriv.wrl');
    });
  });

  describe('the persistent avatar-change path', () => {
    it('refuses every Outlands system avatar, by id, for any citizen', async () => {
      const updated: any = {};
      const service = memberServiceFor(avatarRepository, updated);
      for (const avatar of OUTLANDS_AVATARS) {
        for (const memberId of [citizenA, citizenB]) {
          await expect(service.updateAvatar(memberId, avatar.id))
            .rejects.toThrow(`No avatar exists with id ${avatar.id}`);
        }
      }
      expect(updated.fields).toBeUndefined();
    });

    it('refuses an avatar that belongs to another citizen', async () => {
      const updated: any = {};
      const service = memberServiceFor(avatarRepository, updated);
      await expect(service.updateAvatar(citizenB, privateAvatarId)).rejects.toThrow();
      expect(updated.fields).toBeUndefined();
    });

    it('still accepts an ordinary public avatar', async () => {
      const updated: any = {};
      const service = memberServiceFor(avatarRepository, updated);
      await service.updateAvatar(citizenB, PUBLIC_AVATAR.id);
      expect(updated.memberId).toBe(citizenB);
      expect(updated.fields).toEqual({ avatar_id: PUBLIC_AVATAR.id });
    });

    it('still accepts a citizen their own private avatar', async () => {
      const updated: any = {};
      const service = memberServiceFor(avatarRepository, updated);
      await service.updateAvatar(citizenA, privateAvatarId);
      expect(updated.fields).toEqual({ avatar_id: privateAvatarId });
    });
  });

  describe('the Outlands gameplay path', () => {
    it('serves exactly the four playable avatars, in the historical order', async () => {
      const avatars = await avatarService.getOutlandsTeamAvatars();
      expect(avatars.map(avatar => avatar.filename)).toEqual(TEAM_FILES);
    });

    it('never serves the Game Master', async () => {
      const avatars = await avatarService.getOutlandsTeamAvatars();
      expect(avatars.map(avatar => avatar.filename))
        .not.toContain(OUTLANDS_GAME_MASTER_FILENAME);
    });

    it('carries the historical team of each choice', async () => {
      const avatars = await avatarService.getOutlandsTeamAvatars();
      const teams = new Map(avatars.map(avatar => [avatar.filename, avatar.team]));
      expect(teams.get('redm.wrl')).toBe(1);
      expect(teams.get('redf.wrl')).toBe(1);
      expect(teams.get('bluem.wrl')).toBe(2);
      expect(teams.get('bluef.wrl')).toBe(2);
    });

    it('carries the canonical id and directory of each choice', async () => {
      const avatars = await avatarService.getOutlandsTeamAvatars();
      for (const avatar of avatars) {
        const canonical = OUTLANDS_AVATARS.find(row => row.filename === avatar.filename);
        expect(Number(avatar.id)).toBe(canonical.id);
        expect(avatar.directory).toBe(String(canonical.id));
      }
    });

    it('answers with the gameplay fields alone, and no citizen bookkeeping', async () => {
      const avatars = await avatarService.getOutlandsTeamAvatars();
      for (const avatar of avatars) {
        /*
         * The runtime reads exactly these four. A system row carries an owner
         * column, a private flag, a status and gestures that no citizen may
         * act on, so none of them leave the API.
         */
        expect(Object.keys(avatar).sort()).toEqual(['directory', 'filename', 'id', 'team']);
      }
    });

    it('mints no token: wearing a side is not a change of identity', async () => {
      /*
       * The one way this path could put a system avatar into a citizen's
       * durable identity is by issuing a token that names it. MemberService no
       * longer has a way to do that at all -- the avatar in a token is always
       * the member's own `avatar_id` -- so the Outlands answer is gameplay data
       * and nothing a browser could mistake for a login.
       */
      const methods = Object.getOwnPropertyNames(MemberService.prototype);
      expect(methods).not.toContain('getMemberTokenWearing');
      const encode = Object.getOwnPropertyDescriptor(MemberService.prototype, 'encodeMemberToken');
      expect(typeof encode.value).toBe('function');
      // One parameter: the member. There is no second one to override the avatar.
      expect(encode.value.length).toBe(1);
    });

    it('serves no unrelated avatar', async () => {
      const avatars = await avatarService.getOutlandsTeamAvatars();
      expect(avatars.map(avatar => avatar.filename)).not.toContain('sparkie.wrl');
      expect(avatars.map(avatar => avatar.filename)).not.toContain('apriv.wrl');
    });

    it('reports a missing row rather than inventing one', async () => {
      await db('avatar').where({ filename: 'redm.wrl' }).del();
      const avatars = await avatarService.getOutlandsTeamAvatars();
      expect(avatars).toHaveLength(3);
      expect(avatars.map(avatar => avatar.filename)).not.toContain('redm.wrl');
    });

    it('never reaches a citizen upload that happens to share a file name', async () => {
      await db('avatar').where({ filename: 'redf.wrl' }).del();
      await db('avatar').insert({
        name: 'not the Outlands one', filename: 'redf.wrl', image: 'x.jpg',
        directory: '901', status: 1, private: 0, member_id: citizenA,
      });
      const avatars = await avatarService.getOutlandsTeamAvatars();
      expect(avatars.map(avatar => avatar.filename)).not.toContain('redf.wrl');
    });
  });
});
