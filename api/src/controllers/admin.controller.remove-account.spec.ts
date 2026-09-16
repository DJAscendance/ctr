import { Request, Response } from 'express';
import { Knex } from 'knex';
import { Container } from 'typedi';

import { describeWithDb } from '@spec/integration-db';
import { Db } from '../db/db.class';
import {
  AvatarRepository,
  ClubMemberRepository,
  MemberRepository,
  ObjectRepository,
  WalletRepository,
} from '../repositories';
import {
  AdminService,
  AvatarService,
  ClubService,
  InboxService,
  MemberService,
  MessageService,
  MessageboardService,
  ObjectInstanceService,
  ObjectService,
  PlaceService,
  RoleAssignmentService,
} from '../services';
import { AdminController } from './admin.controller';

/**
 * Atomicity of the admin account-removal path, against a real MySQL.
 *
 * `removeAccount` fires a long sequence of destructive writes. Whether a failure part way
 * through leaves an account half deleted is a property of the database, not of the call
 * order, so mocks cannot prove it either way: only a real transaction can.
 *
 * The forced failures are injected at a repository, which is the layer the transaction has
 * to reach. A failure that rolls back when injected there rolls back wherever it is raised.
 *
 * Skipped, loudly, unless CTR_INTEGRATION_TEST_DB names the configured schema - these tests
 * delete rows, and must never be able to do so against a shared database.
 */

/**
 * A name unique to this process and call.
 *
 * Deliberately NOT the shared `fixtureName` helper: suites that use that prefix also clean
 * up by it, and a parallel run would delete this spec's member out from under it mid-test.
 */
let sequence = 0;
function secvName(label: string): string {
  sequence += 1;
  return `secv-${label}-${process.pid}-${sequence}`;
}

/** The ids a single fixture account spreads across the schema. */
interface AccountFixture {
  memberId: number;
  walletId: number;
  username: string;
  homePlaceId: number;
  clubPlaceId: number;
  roleId: number;
  ownedObjectId: number;
  placedObjectId: number;
  instanceId: number;
  avatarId: number;
  wornAvatarId: number;
  voteId: number;
  foreignPlaceId: number;
  foreignVoteId: number;
}

/** Every count and status the tests assert on, read in one pass. */
interface AccountState {
  member: number;
  wallet: number;
  ledger: number;
  avatar: number;
  object: number;
  ownedObjectStatus: number | null;
  placedObjectStatus: number | null;
  instanceOwner: number | null;
  instancePlace: number | null;
  message: number;
  inbox: number;
  messageboard: number;
  clubMember: number;
  roleAssignment: number;
  ban: number;
  place: number;
  home: number;
  mapLocation: number;
  virtualPet: number;
  voteList: number;
  voteResponse: number;
}

/**
 * A repository seen as a bag of async methods, so a test can replace one of them.
 *
 * The forced failures deliberately reach past the public service signatures: the point is
 * to break a write the sequence has already started, which is where a missing transaction
 * shows.
 */
function asSpyTarget(repository: unknown): Record<string, () => Promise<unknown>> {
  return repository as Record<string, () => Promise<unknown>>;
}

/** A response double that records the status and body the handler chose. */
function mockResponse(): Response & { statusCode?: number; body?: unknown } {
  const response = {} as Response & { statusCode?: number; body?: unknown };
  response.status = jest.fn().mockImplementation((code: number) => {
    response.statusCode = code;
    return response;
  });
  response.json = jest.fn().mockImplementation((body: unknown) => {
    response.body = body;
    return response;
  });
  return response;
}

/** The admin request the handler reads the target id from. */
function removeRequest(id: number): Request {
  return { body: { id }, headers: { apitoken: 'token' } } as unknown as Request;
}

describeWithDb('AdminController.removeAccount atomicity (real database)', () => {
  let db: Db;
  let knex: Knex;
  let controller: AdminController;
  let memberService: MemberService;
  let fixture: AccountFixture;

  beforeAll(async () => {
    db = Container.get(Db);
    knex = db.knex;
    await knex.raw('select 1');
  });

  afterAll(async () => {
    await knex.destroy();
  });

  /** Builds one account with a row in every table the removal path touches. */
  async function createAccountFixture(): Promise<AccountFixture> {
    const username = secvName('secv');
    const [walletId] = await knex('wallet').insert({ balance: 1234 });
    // The avatar a member wears is a public one, owned by nobody; `member.avatar_id` is NOT
    // NULL and has a foreign key, so the fixture has to supply a real row to point at. The
    // member's OWN avatar, created below, is the one the removal path deletes.
    const [wornAvatarId] = await knex('avatar').insert({
      filename: 'worn.wrl', name: secvName('worn'), private: 0, status: 1, member_id: null,
    });
    const [memberId] = await knex('member').insert({
      username,
      email: `${username}@example.invalid`,
      password: 'not-a-real-hash',
      wallet_id: walletId,
      avatar_id: wornAvatarId,
    });
    const [homePlaceId] = await knex('place').insert({
      type: 'home', member_id: memberId, name: secvName('home'), status: 1,
    });
    const [clubPlaceId] = await knex('place').insert({
      type: 'club', member_id: memberId, name: secvName('club'), status: 1,
    });
    await knex('home').insert({ place_id: homePlaceId, image_status: 'none' });
    // `map_location`'s primary key is (parent_place_id, location), and other suites claim
    // the low numbers. Keyed off this fixture's own place ids so parallel runs cannot
    // collide.
    await knex('map_location').insert({
      parent_place_id: clubPlaceId, place_id: homePlaceId, location: homePlaceId,
      available: 0,
    });
    await knex('virtual_pet').insert({ place_id: homePlaceId, pet_name: 'Fixture', active: 1 });

    const [roleId] = await knex('role').insert({ name: secvName('role') });
    await knex('role_assignment').insert({ member_id: memberId, role_id: roleId });
    await knex('ban').insert({
      ban_member_id: memberId,
      assigner_member_id: memberId,
      end_date: '2030-01-01',
      type: 'jail',
      reason: 'fixture',
      status: 1,
    });
    await knex('transaction').insert({
      amount: 10, recipient_wallet_id: walletId, reason: 'fixture',
    });

    const [avatarId] = await knex('avatar').insert({
      filename: 'fixture.wrl', name: secvName('avatar'), private: 0, status: 1,
      member_id: memberId,
    });

    // An object the member still holds (status 1) and one that is out in the world on an
    // instance (status 3), so the two preservation branches are both exercised.
    const [ownedObjectId] = await knex('object').insert({
      filename: 'owned.wrl', name: secvName('owned'), quantity: 1, status: 1,
      member_id: memberId, price: 5,
    });
    const [placedObjectId] = await knex('object').insert({
      filename: 'placed.wrl', name: secvName('placed'), quantity: 1, status: 3,
      member_id: memberId, price: 5,
    });
    const [instanceId] = await knex('object_instance').insert({
      object_id: placedObjectId, member_id: memberId, place_id: homePlaceId,
      object_name: 'placed',
    });

    await knex('message')
      .insert({ body: 'fixture', member_id: memberId, place_id: homePlaceId });
    await knex('inbox').insert({
      place_id: homePlaceId, member_id: memberId, subject: 's', message: 'm',
      reply: 0, status: 1,
    });
    await knex('messageboard').insert({
      place_id: homePlaceId, member_id: memberId, subject: 's', message: 'm',
      reply: 0, status: 1,
    });
    await knex('club_member')
      .insert({ club_id: clubPlaceId, member_id: memberId, status: 'member' });

    // A poll the member started, and a response the member left on somebody else's poll.
    // The member's own poll carries no options on purpose: `vote_options` has a foreign key
    // to `vote_list` that nothing in the removal path clears, so a poll WITH options cannot
    // be deleted at all. That is a separate pre-existing defect, not the one under test.
    const [voteId] = await knex('vote_list').insert({
      title: secvName('vote'), place_id: homePlaceId, creator_member_id: memberId,
    });
    const [foreignPlaceId] = await knex('place').insert({
      type: 'club', member_id: null, name: secvName('foreign'), status: 1,
    });
    const [foreignVoteId] = await knex('vote_list').insert({
      title: secvName('foreignvote'), place_id: foreignPlaceId, creator_member_id: null,
    });
    const [optionId] = await knex('vote_options')
      .insert({ option_text: 'yes', vote_id: foreignVoteId });
    await knex('vote_response').insert({
      status: 1, vote_id: foreignVoteId, option_id: optionId, member_id: memberId,
    });

    return {
      memberId, walletId, username, homePlaceId, clubPlaceId, roleId,
      ownedObjectId, placedObjectId, instanceId, avatarId, wornAvatarId, voteId,
      foreignPlaceId, foreignVoteId,
    };
  }

  /** Deletes the fixture in foreign-key order, whatever the test left behind. */
  async function dropAccountFixture(built?: AccountFixture): Promise<void> {
    if (!built) return;
    const places = [built.homePlaceId, built.clubPlaceId, built.foreignPlaceId];
    await knex('vote_response').whereIn('vote_id', [built.voteId, built.foreignVoteId]).del();
    await knex('vote_options').whereIn('vote_id', [built.voteId, built.foreignVoteId]).del();
    await knex('vote_list').whereIn('id', [built.voteId, built.foreignVoteId]).del();
    await knex('club_member').whereIn('club_id', places).del();
    await knex('club_member').where('member_id', built.memberId).del();
    await knex('messageboard').whereIn('place_id', places).del();
    await knex('inbox').whereIn('place_id', places).del();
    await knex('message').whereIn('place_id', places).del();
    await knex('object_instance').where('object_id', built.placedObjectId).del();
    await knex('object').whereIn('id', [built.ownedObjectId, built.placedObjectId]).del();
    await knex('avatar').where('id', built.avatarId).del();
    await knex('virtual_pet').whereIn('place_id', places).del();
    await knex('map_location').whereIn('place_id', places).del();
    await knex('home').whereIn('place_id', places).del();
    await knex('place').whereIn('id', places).del();
    await knex('place').where('id', built.foreignPlaceId).del();
    await knex('role_assignment').where('member_id', built.memberId).del();
    await knex('role_assignment').where('role_id', built.roleId).del();
    await knex('role').where('id', built.roleId).del();
    await knex('ban').where('ban_member_id', built.memberId).del();
    await knex('member').where('id', built.memberId).del();
    await knex('transaction')
      .where('recipient_wallet_id', built.walletId)
      .orWhere('sender_wallet_id', built.walletId)
      .del();
    await knex('wallet').where('id', built.walletId).del();
    await knex('avatar').where('id', built.wornAvatarId).del();
  }

  /** Counts the rows in one table matching `where`. */
  async function count(table: string, where: Record<string, unknown>): Promise<number> {
    const [row] = await knex(table).count({ total: '*' }).where(where);
    return Number((row as { total: number }).total);
  }

  /** Reads everything the assertions compare, for one fixture. */
  async function readState(built: AccountFixture): Promise<AccountState> {
    const objects = await knex('object')
      .select('id', 'status', 'member_id')
      .whereIn('id', [built.ownedObjectId, built.placedObjectId]);
    const owned = objects.find(row => row.id === built.ownedObjectId);
    const placed = objects.find(row => row.id === built.placedObjectId);
    const [instance] = await knex('object_instance')
      .select('member_id', 'place_id')
      .where('id', built.instanceId);
    return {
      member: await count('member', { id: built.memberId }),
      wallet: await count('wallet', { id: built.walletId }),
      ledger: await count('transaction', { recipient_wallet_id: built.walletId }),
      avatar: await count('avatar', { member_id: built.memberId }),
      object: objects.length,
      ownedObjectStatus: owned ? owned.status : null,
      placedObjectStatus: placed ? placed.status : null,
      instanceOwner: instance ? instance.member_id : null,
      instancePlace: instance ? instance.place_id : null,
      message: await count('message', { member_id: built.memberId }),
      inbox: await count('inbox', { member_id: built.memberId }),
      messageboard: await count('messageboard', { member_id: built.memberId }),
      clubMember: await count('club_member', { member_id: built.memberId }),
      roleAssignment: await count('role_assignment', { member_id: built.memberId }),
      ban: await count('ban', { ban_member_id: built.memberId }),
      place: await count('place', { member_id: built.memberId }),
      home: await count('home', { place_id: built.homePlaceId }),
      mapLocation: await count('map_location', { place_id: built.homePlaceId }),
      virtualPet: await count('virtual_pet', { place_id: built.homePlaceId }),
      voteList: await count('vote_list', { creator_member_id: built.memberId }),
      voteResponse: await count('vote_response', { member_id: built.memberId }),
    };
  }

  beforeEach(async () => {
    memberService = Container.get(MemberService);
    controller = new AdminController(
      Container.get(AdminService),
      memberService,
      Container.get(AvatarService),
      Container.get(PlaceService),
      Container.get(RoleAssignmentService),
      Container.get(ObjectInstanceService),
      Container.get(ObjectService),
      Container.get(MessageService),
      Container.get(InboxService),
      Container.get(MessageboardService),
      Container.get(ClubService),
    );
    // Authorization is proved in admin.controller.authorization.spec.ts; these tests are
    // about what happens after the gate opens.
    jest.spyOn(memberService, 'decryptSession').mockReturnValue({ id: 1 } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
    fixture = await createAccountFixture();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dropAccountFixture(fixture);
  });

  it('removes the account and its related records when every step succeeds', async () => {
    const response = mockResponse();

    await controller.removeAccount(removeRequest(fixture.memberId), response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: 'success' });
    const after = await readState(fixture);
    expect(after.member).toBe(0);
    expect(after.wallet).toBe(0);
    expect(after.ledger).toBe(0);
    expect(after.avatar).toBe(0);
    expect(after.message).toBe(0);
    expect(after.inbox).toBe(0);
    expect(after.messageboard).toBe(0);
    expect(after.clubMember).toBe(0);
    expect(after.roleAssignment).toBe(0);
    expect(after.ban).toBe(0);
    expect(after.place).toBe(0);
    expect(after.home).toBe(0);
    expect(after.mapLocation).toBe(0);
    expect(after.virtualPet).toBe(0);
    expect(after.voteList).toBe(0);
    expect(after.voteResponse).toBe(0);
    // Objects are preserved, not deleted: both rows survive, disowned, and the instance is
    // returned to the world rather than destroyed.
    expect(after.object).toBe(2);
    expect(after.ownedObjectStatus).toBe(4);
    expect(after.placedObjectStatus).toBe(4);
    expect(after.instanceOwner).toBeNull();
    expect(after.instancePlace).toBe(0);
  });

  /**
   * Each case injects one rejection at a repository the sequence reaches, named by how far
   * in it sits: before any destructive write of its own has a chance to matter, half way
   * through, and at the very last write.
   */
  const FAILURE_POINTS = [
    { label: 'early', target: () => asSpyTarget(Container.get(ObjectRepository)) },
    { label: 'middle', target: () => asSpyTarget(Container.get(ClubMemberRepository)) },
    { label: 'late', target: () => asSpyTarget(Container.get(MemberRepository)) },
    { label: 'last write', target: () => asSpyTarget(Container.get(WalletRepository)) },
  ];

  describe.each(FAILURE_POINTS)('$label failure', ({ target }) => {
    it('rolls every write back and leaves the account whole', async () => {
      const before = await readState(fixture);
      jest.spyOn(target(), 'removeAccount')
        .mockRejectedValue(new Error('forced failure'));
      const response = mockResponse();

      await controller.removeAccount(removeRequest(fixture.memberId), response);

      expect(response.statusCode).toBe(400);
      const after = await readState(fixture);
      expect(after).toEqual(before);
    });
  });

  it('settles two removals of the same member into one deletion', async () => {
    const first = mockResponse();
    const second = mockResponse();

    await Promise.all([
      controller.removeAccount(removeRequest(fixture.memberId), first),
      controller.removeAccount(removeRequest(fixture.memberId), second),
    ]);

    // The member row lock serializes them: whichever gets there first deletes the account,
    // and the other finds no member to remove rather than deleting half of one twice.
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 400]);
    const after = await readState(fixture);
    expect(after.member).toBe(0);
    expect(after.wallet).toBe(0);
    expect(after.place).toBe(0);
    expect(after.object).toBe(2);
  });

  it('refuses an id that is not a member without deleting anything', async () => {
    const before = await readState(fixture);
    const missing = fixture.memberId + 1000000;
    const response = mockResponse();

    await controller.removeAccount(removeRequest(missing), response);

    expect(response.statusCode).toBe(400);
    expect(await readState(fixture)).toEqual(before);
  });

  it('reports a failure without leaking database internals', async () => {
    jest.spyOn(asSpyTarget(Container.get(AvatarRepository)), 'removeAllAvatars')
      .mockRejectedValue(new Error('ER_LOCK_DEADLOCK: fixture detail'));
    const response = mockResponse();

    await controller.removeAccount(removeRequest(fixture.memberId), response);

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain('ER_LOCK_DEADLOCK');
    expect(JSON.stringify(response.body)).not.toContain('fixture detail');
  });
});
