import { knex as makeKnex, Knex } from 'knex';
import { Container } from 'typedi';

import config from '../../knexfile';
import { Db } from '../../db/db.class';
import { RoleRepository } from './role.repository';
import { AdminService } from '../../services/admin/admin.services';
import { BlackMarketService } from '../../services/blackmarket/blackmarket.service';
import { ClubService } from '../../services/club/club.service';
import { ColonyService } from '../../services/colony/colony.service';
import { FleaMarketService } from '../../services/fleamarket/fleamarket.service';
import { LiveEventService } from '../../services/live-event/live-event.service';
import { MallService } from '../../services/mall/mall.service';
import { MemberService } from '../../services/member/member.service';
import { PlaceService } from '../../services/place/place.service';
import { PlaceAccessService } from '../../services/place-access/place-access.service';
import { describeWithDb, integrationDbAuthorized } from '@spec/integration-db';

/**
 * Cold-bootstrap authorization, against real MySQL.
 *
 * The scenario is the one that took beta down on its first boot, and the thing that makes
 * it a real test rather than a unit test with a fake table is that NOTHING RESTARTS: one
 * process starts against an empty `role` table, the seeds then run in their three passes,
 * and the very same service instances must start answering correctly. A restart would hide
 * every defect here, and so would visiting some other endpoint first -- the old code only
 * worked if something happened to call `awaitRoleMap` before the authorization check did.
 *
 * The three passes matter individually. 05-roles.seed.ts, 06-donor.roles.seed.ts and
 * 09-update.roles.seed.ts each insert roles the previous ones did not, and three of the
 * roles asserted below -- BlackMarketChief, ColonyRepresentative and HomeChatGuest -- exist
 * ONLY after the third. A snapshot taken after pass two is non-empty, so "did we see any
 * roles at all" cannot tell it apart from a finished bootstrap, and every holder of those
 * three roles is refused for the life of the process.
 *
 * Runs in its own schema, built with `CREATE TABLE ... LIKE` from the configured
 * integration database, so the table definitions are the real migrated ones and no fixture
 * here can touch a row another spec cares about.
 */

const ROLE_TABLES = ['role', 'role_assignment', 'place', 'map_location'];

// Members, each holding exactly one office.
const ADMIN = 9001;
const MALL_MANAGER = 9002;
const BLACKMARKET_CHIEF = 9003;
const FLEAMARKET_CHIEF = 9004;
const LIVE_EVENT_MANAGER = 9005;
const COLONY_LEADER = 9006;
const HOOD_LEADER = 9007;
const BLOCK_LEADER = 9008;
const CITY_COUNCIL = 9009;
const NOBODY = 9010;
const COLONY_REP = 9011;
const CLUB_OWNER = 9012;

// Places: a colony -> hood -> block chain, plus the Mall.
const COLONY = 8001;
const HOOD = 8002;
const BLOCK = 8003;
const MALL = 8004;
const BLACKMARKET = 8005;
const CLUB = 8006;

/** Pass 1: 05-roles.seed.ts. Names carry spaces exactly as the seed data does. */
const PASS_ONE = [
  'Admin', 'Mall Manager', 'Mall Deputy', 'Flea Market Chief', 'Flea Market Deputy',
  'Club Owner', 'Club Assistant', 'Colony Leader', 'Colony Deputy',
  'Neighborhood Leader', 'Neighborhood Deputy', 'Block Leader', 'Block Deputy',
  'City Mayor', 'Places Chief', 'City Council', 'CVN Editor',
  'Security Chief', 'Deputy Security Chief', 'Security Captain', 'Security Lieutenant',
  'Security Sergeant', 'Security Officer', 'Security Advisor', 'Security Commissioner',
  'Jail Guard', 'Senior City Guide', 'City Guide', 'Bank Manager', 'Bank Cashier',
];
/** Pass 2: 06-donor.roles.seed.ts. */
const PASS_TWO = ['Supporter', 'Advocate', 'Devotee', 'Champion'];
/** Pass 3: 09-update.roles.seed.ts -- and the ONLY source of these three. */
const PASS_THREE = ['Black Market Chief', 'Black Market Deputy', 'Colony Representative',
  'Home Chat Guest'];

describeWithDb('cold bootstrap authorization (real database)', () => {
  const schema = `${process.env.DB_DATABASE}_rolecold_${process.pid}`;
  let admin: Knex;
  let conn: Knex;
  let roleIds: Record<string, number>;

  // Services, all resolved BEFORE any role exists.
  let roleRepository: RoleRepository;
  let memberService: MemberService;
  let mallService: MallService;
  let blackMarketService: BlackMarketService;
  let fleaMarketService: FleaMarketService;
  let liveEventService: LiveEventService;
  let placeService: PlaceService;
  let placeAccessService: PlaceAccessService;
  let clubService: ClubService;
  let colonyService: ColonyService;
  let adminService: AdminService;

  const seedRoles = async (names: string[]) => {
    const existing = await conn('role').select('name');
    const known = new Set(existing.map((row: { name: string }) => row.name));
    const rows = names.filter(name => !known.has(name)).map(name => ({ name }));
    if (rows.length) await conn('role').insert(rows);
    const all = await conn('role').select('id', 'name');
    roleIds = {};
    all.forEach((row: { id: number; name: string }) => {
      roleIds[row.name.replace(/\s/g, '')] = row.id;
    });
  };

  const assign = (memberId: number, roleName: string, placeId: number | null = null) =>
    conn('role_assignment').insert({
      member_id: memberId, role_id: roleIds[roleName], place_id: placeId,
    });

  beforeAll(async () => {
    if (!integrationDbAuthorized()) return;
    const base = config[process.env.NODE_ENV] as Knex.Config;
    const baseConnection = base.connection as Knex.MySqlConnectionConfig;

    admin = makeKnex({ ...base, connection: { ...baseConnection, database: null } });
    await admin.raw('CREATE DATABASE ??', [schema]);
    for (const table of ROLE_TABLES) {
      await admin.raw('CREATE TABLE ??.?? LIKE ??.??',
        [schema, table, baseConnection.database, table]);
    }

    conn = makeKnex({ ...base, connection: { ...baseConnection, database: schema } });

    // The place hierarchy the geographic checks walk. `role` stays EMPTY.
    await conn('place').insert([
      { id: COLONY, name: 'Test Colony', type: 'colony' },
      { id: HOOD, name: 'Test Hood', type: 'hood' },
      { id: BLOCK, name: 'Test Block', type: 'block' },
      { id: MALL, name: 'Mall', type: 'public', slug: 'mall' },
      { id: BLACKMARKET, name: 'Black Market', type: 'public', slug: 'blackmarket' },
      { id: CLUB, name: 'Test Club', type: 'club', slug: 'personalclub' },
    ]);
    await conn('map_location').insert([
      { place_id: HOOD, parent_place_id: COLONY, location: 1 },
      { place_id: BLOCK, parent_place_id: HOOD, location: 1 },
    ]);

    // A Db bound to the isolated schema. Object.create sidesteps the constructor, which
    // builds its own knex from the environment and enforces the test-database naming rule.
    const db = Object.create(Db.prototype) as Db;
    db.knex = conn;

    Container.reset();
    Container.set(Db, db);

    // Resolved while `role` is still empty: every constructor's eager population runs now
    // and finds nothing, which is the state the process would really come up in.
    roleRepository = Container.get(RoleRepository);
    memberService = Container.get(MemberService);
    mallService = Container.get(MallService);
    blackMarketService = Container.get(BlackMarketService);
    fleaMarketService = Container.get(FleaMarketService);
    liveEventService = Container.get(LiveEventService);
    placeService = Container.get(PlaceService);
    placeAccessService = Container.get(PlaceAccessService);
    clubService = Container.get(ClubService);
    colonyService = Container.get(ColonyService);
    adminService = Container.get(AdminService);
  });

  afterAll(async () => {
    if (conn) await conn.destroy();
    if (admin) {
      await admin.raw('DROP DATABASE IF EXISTS ??', [schema]);
      await admin.destroy();
    }
    Container.reset();
  });

  it('authorizes every office as soon as the seeds finish, with no restart and no priming',
    async () => {
      // ---- the process is up, the role table is empty ------------------------------
      await expect(roleRepository.awaitRoleMap()).resolves.toEqual({});
      // Nobody holds a role that does not exist yet, so this is a correct denial. What it
      // must NOT do is memoize the empty table as a finished population.
      expect(await memberService.getAccessLevel(ADMIN)).toEqual([]);

      // ---- pass 1: 05-roles.seed.ts ------------------------------------------------
      await seedRoles(PASS_ONE);
      await Promise.all([
        assign(ADMIN, 'Admin'),
        assign(MALL_MANAGER, 'MallManager', MALL),
        assign(FLEAMARKET_CHIEF, 'FleaMarketChief'),
        assign(LIVE_EVENT_MANAGER, 'CityMayor'),
        assign(COLONY_LEADER, 'ColonyLeader', COLONY),
        assign(HOOD_LEADER, 'NeighborhoodLeader', HOOD),
        assign(BLOCK_LEADER, 'BlockLeader', BLOCK),
        assign(CITY_COUNCIL, 'CityCouncil'),
        assign(CLUB_OWNER, 'ClubOwner', CLUB),
      ]);

      // The SAME instances, no restart, no other endpoint visited first.
      expect(await memberService.getAccessLevel(ADMIN)).toEqual(
        expect.arrayContaining(['admin']));
      expect(await mallService.canAdmin(MALL_MANAGER)).toBe(true);
      expect(await fleaMarketService.canAdmin(FLEAMARKET_CHIEF)).toBe(true);
      expect(await liveEventService.canManage(LIVE_EVENT_MANAGER)).toBe(true);
      expect(await memberService.canLeader(ADMIN)).toBe(true);
      expect(await memberService.canStaff(BLOCK_LEADER)).toBe(true);
      expect(await placeService.canAdmin('cityhall', 0, CITY_COUNCIL)).toBe(true);
      expect(await placeService.canAdmin('mall', MALL, MALL_MANAGER)).toBe(true);
      expect(await clubService.isOwner(CLUB, CLUB_OWNER)).toBe(true);
      expect(await placeService.canAdmin('personalclub', CLUB, CLUB_OWNER)).toBe(true);
      expect(await placeAccessService.hasGeographicAuthority(COLONY, COLONY_LEADER))
        .toBe(true);
      expect(await placeAccessService.hasGeographicAuthority(HOOD, HOOD_LEADER)).toBe(true);
      expect(await placeAccessService.hasGeographicAuthority(BLOCK, BLOCK_LEADER))
        .toBe(true);
      // Authority inherits downward but never upward.
      expect(await placeAccessService.hasGeographicAuthority(BLOCK, COLONY_LEADER))
        .toBe(true);
      expect(await placeAccessService.hasGeographicAuthority(COLONY, BLOCK_LEADER))
        .toBe(false);

      // Donor roles do not exist yet. That must be an answer, not an exception: no
      // undefined id may reach knex as a binding.
      await expect(adminService.getDonor(ADMIN)).resolves.toBeUndefined();

      // ---- pass 2: 06-donor.roles.seed.ts ------------------------------------------
      await seedRoles([...PASS_ONE, ...PASS_TWO]);
      await assign(ADMIN, 'Champion');
      expect(await adminService.getDonor(ADMIN)).toEqual({ name: 'Champion' });

      // ---- pass 3: 09-update.roles.seed.ts -----------------------------------------
      // The snapshot in memory is non-empty and has been refreshed twice already, so only a
      // per-call required-name check can notice that these three arrived late.
      await seedRoles([...PASS_ONE, ...PASS_TWO, ...PASS_THREE]);
      await Promise.all([
        assign(BLACKMARKET_CHIEF, 'BlackMarketChief', BLACKMARKET),
        assign(COLONY_REP, 'ColonyRepresentative'),
      ]);

      expect(await blackMarketService.canAdmin(BLACKMARKET_CHIEF)).toBe(true);
      expect(await placeService.canAdmin('blackmarket', BLACKMARKET, BLACKMARKET_CHIEF))
        .toBe(true);
      expect(await colonyService.canManageAccess(COLONY, COLONY_REP)).toBe(true);
      expect(await placeAccessService.hasGeographicAuthority(BLOCK, COLONY_REP)).toBe(true);

      // ---- fail-closed is preserved throughout -------------------------------------
      expect(await memberService.getAccessLevel(NOBODY)).toEqual([]);
      expect(await mallService.canAdmin(NOBODY)).toBe(false);
      expect(await blackMarketService.canAdmin(NOBODY)).toBe(false);
      expect(await mallService.canAdmin(FLEAMARKET_CHIEF)).toBe(false);
      expect(await colonyService.canManageAccess(COLONY, NOBODY)).toBe(false);
      expect(await clubService.isOwner(CLUB, NOBODY)).toBe(false);
      expect(await placeService.canAdmin('mall', MALL, NOBODY)).toBe(false);
      // The office is scoped to its own place: the black market chief is not a mall admin.
      expect(await placeService.canAdmin('mall', MALL, BLACKMARKET_CHIEF)).toBe(false);
      await expect(adminService.getDonor(NOBODY)).resolves.toBeUndefined();
    });
});
