import { Request, Response } from 'express';
import { Container } from 'typedi';

import { cleanUpFixtures, createMember, describeWithDb, fixtureName } from '@spec/integration-db';
import { Db } from '../db/db.class';
import { AdminAuditEventRepository, BanRepository } from '../repositories';
import {
  AdminAuditService,
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
 * CTBL-0025 atomicity, against a real MySQL.
 *
 * `admin.controller.audit.spec.ts` proves the SHAPE of every event with mocks: who the
 * actor is, what the name is, what never reaches a row. It cannot prove that an audit
 * insert and a business write actually commit as one unit, because that is a property of
 * the database and not of the call order -- a mocked transaction rolls back because the
 * test says so.
 *
 * This spec asks the database instead. It is the hard gate for three claims:
 *
 *   1. A ban and its `allowed` event are visible together, or neither is.
 *   2. An audit insert that fails takes the ban with it -- no unlogged sanction.
 *   3. The account-removal event outlives the account it names, which is the whole reason
 *      `admin_audit_event` carries no foreign key to `member`.
 *
 * Skipped, loudly, unless CTR_INTEGRATION_TEST_DB names the configured schema: these tests
 * write and delete rows and must never be able to do so against a shared database.
 */

/** The operator every case acts as. Created per test, so the actor id is a real member. */
let actorId: number;

interface MockResponse extends Partial<Response> {
  statusCode?: number;
  body?: unknown;
}

function mockResponse(): MockResponse {
  const response: MockResponse = {};
  response.status = jest.fn().mockImplementation((code: number) => {
    response.statusCode = code;
    return response;
  }) as never;
  response.json = jest.fn().mockImplementation((body: unknown) => {
    response.body = body;
    return response;
  }) as never;
  return response;
}

function request(body: Record<string, unknown>): Request {
  return {
    ip: '203.0.113.7',
    headers: { apitoken: 'not-read-by-the-audit-path' },
    body,
  } as unknown as Request;
}

/** A repository seen as a bag of async methods, so a test can replace one of them. */
function asSpyTarget(target: unknown): Record<string, (...args: unknown[]) => unknown> {
  return target as Record<string, (...args: unknown[]) => unknown>;
}

describeWithDb('CTBL-0025 audit atomicity against a real database', () => {
  const knex = Container.get(Db).knex;
  let controller: AdminController;
  let memberService: MemberService;
  let targetId: number;
  /** Audit ids this spec created, so cleanup can never reach a row it did not make. */
  let createdAuditIds: number[];

  async function auditRows(event?: string) {
    const query = knex('admin_audit_event')
      .select('*')
      .whereIn('actor_member_id', [actorId])
      .orderBy('id');
    if (event) query.where('event', event);
    return query;
  }

  beforeAll(async () => {
    // `member.avatar_id` is NOT NULL with a default of 1 and a foreign key, so a schema
    // with no avatars cannot hold a member at all. Created once, not per test.
    const existing = await knex('avatar').select('id').where('id', 1).first();
    if (!existing) {
      await knex('avatar')
        .insert({ id: 1, name: fixtureName('avatar'), filename: 'ctbl25.wrl', status: 1 });
    }
  });

  beforeEach(async () => {
    createdAuditIds = [];
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
      Container.get(AdminAuditService),
    );

    const actor = await createMember(knex);
    const target = await createMember(knex);
    actorId = actor.id;
    targetId = target.id;

    // Authorization is proved in admin.controller.authorization.spec.ts; these tests are
    // about what the database does after the gate opens.
    jest.spyOn(memberService, 'decryptSession').mockReturnValue({ id: actorId } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const rows = await knex('admin_audit_event').select('id').where('actor_member_id', actorId);
    createdAuditIds.push(...rows.map((row: { id: number }) => row.id));
    if (createdAuditIds.length) {
      await knex('admin_audit_event').whereIn('id', createdAuditIds).del();
    }
    await knex('ban').whereIn('ban_member_id', [actorId, targetId]).del();
    await cleanUpFixtures(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('commits the ban and its audit event together', async () => {
    const response = mockResponse();

    await controller.addBan(
      request({
        ban_member_id: targetId, time_frame: 7, type: 'full', reason: 'spamming the plaza',
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    const bans = await knex('ban').select('*').where('ban_member_id', targetId);
    expect(bans).toHaveLength(1);

    const events = await auditRows('admin.ban.add');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].actor_member_id).toBe(actorId);
    expect(events[0].target_member_id).toBe(targetId);
    expect(events[0].reason).toBe('spamming the plaza');
    expect(events[0].source).toBe('203.0.113.7');
    expect(JSON.parse(events[0].metadata)).toMatchObject({ ban_type: 'full' });
  });

  it('stores occurred_at as a UTC wall clock', async () => {
    await controller.addBan(
      request({ ban_member_id: targetId, time_frame: 1, type: 'jail', reason: 'cooling off' }),
      mockResponse() as Response,
    );

    // Read as a raw string, so the driver's own date handling cannot launder a wrong value
    // into a right-looking one.
    const [row] = await knex
      .select(knex.raw('DATE_FORMAT(occurred_at, \'%Y-%m-%dT%H:%i:%sZ\') AS stamped'))
      .from('admin_audit_event')
      .where('actor_member_id', actorId);
    expect(Math.abs(Date.parse(row.stamped) - Date.now())).toBeLessThan(120_000);
  });

  it('rolls the ban back when the audit insert fails', async () => {
    // The hard gate. A sanction that could not be recorded must not exist.
    jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
      .mockImplementation(async (_row: unknown, trx: unknown) => {
        if (trx) throw new Error('audit store unavailable');
      });
    const response = mockResponse();

    await controller.addBan(
      request({ ban_member_id: targetId, time_frame: 7, type: 'full', reason: 'spamming' }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    expect(await knex('ban').select('id').where('ban_member_id', targetId)).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('writes no allowed event when the ban insert fails', async () => {
    jest.spyOn(asSpyTarget(Container.get(BanRepository)), 'addBan')
      .mockImplementation(async () => { throw new Error('ban table unavailable'); });
    const response = mockResponse();

    await controller.addBan(
      request({ ban_member_id: targetId, time_frame: 7, type: 'full', reason: 'spamming' }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    expect(await knex('ban').select('id').where('ban_member_id', targetId)).toHaveLength(0);
    const events = await auditRows();
    // The attempt is on the record; the change is not.
    expect(events.map((row: { result: string }) => row.result)).toEqual(['failed']);
  });

  it('withdraws a ban and records the state the update destroyed', async () => {
    await controller.addBan(
      request({ ban_member_id: targetId, time_frame: 7, type: 'jail', reason: 'first' }),
      mockResponse() as Response,
    );
    const [ban] = await knex('ban').select('id').where('ban_member_id', targetId);
    jest.spyOn(memberService, 'getMemberInfoPublic')
      .mockResolvedValue({ id: actorId, username: 'the-operator' } as never);

    const response = mockResponse();
    await controller.deleteBan(
      request({ banId: ban.id, banReason: 'appeal upheld' }), response as Response,
    );

    expect(response.statusCode).toBe(200);
    const [row] = await knex('ban').select('status').where('id', ban.id);
    expect(row.status).toBe(0);
    const events = await auditRows('admin.ban.remove');
    expect(events).toHaveLength(1);
    expect(events[0].target_member_id).toBe(targetId);
    expect(JSON.parse(events[0].metadata))
      .toMatchObject({ ban_type: 'jail', old_status: 1, new_status: 0 });
  });

  it('keeps the account-removal event after the account is gone', async () => {
    // The reason the table carries no foreign key to `member`: this row names a member id
    // that no longer exists, and it has to survive anyway.
    const response = mockResponse();

    await controller.removeAccount(
      // CTBL-0025 Phase C: removal is refused without an operator reason.
      request({ id: targetId, reason: 'account removal requested' }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    expect(await knex('member').select('id').where('id', targetId)).toHaveLength(0);

    const events = await auditRows('admin.account.remove');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].actor_member_id).toBe(actorId);
    expect(events[0].target_member_id).toBe(targetId);
    // The username is kept because after the delete the id alone identifies nobody.
    expect(JSON.parse(events[0].metadata).username).toEqual(expect.any(String));
  });

  it('rolls the account removal back when its audit insert fails', async () => {
    jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
      .mockImplementation(async (_row: unknown, trx: unknown) => {
        if (trx) throw new Error('audit store unavailable');
      });
    const response = mockResponse();

    await controller.removeAccount(
      // CTBL-0025 Phase C: removal is refused without an operator reason.
      request({ id: targetId, reason: 'account removal requested' }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    // SEC-V's atomicity is intact: the account is whole, not half removed.
    expect(await knex('member').select('id').where('id', targetId)).toHaveLength(1);
    expect(await auditRows()).toHaveLength(0);
  });
});
