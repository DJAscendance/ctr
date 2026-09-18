import { Request, Response } from 'express';
import { Container } from 'typedi';

import { cleanUpFixtures, createMember, describeWithDb, fixtureName } from '@spec/integration-db';
import { Db } from '../db/db.class';
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
import { AUDIT_REASON_MAX } from '../libs/audit-event';
import { AdminController } from './admin.controller';

/**
 * CTBL-0025 Phase C against a real MySQL 5.7.
 *
 * The unit spec proves the SHAPE of an access event and of a required reason. It cannot
 * prove that either survives the columns they are stored in, because a mocked repository
 * accepts anything: `event` is varchar(64), `reason` is varchar(255), `authority` is
 * varchar(32), and `target_member_id` is a nullable unsigned int. A name or a reason that
 * does not fit is a truncation or a thrown query in production and a green test here.
 *
 * Three claims, and all three are about the database rather than the call order:
 *
 *   1. The two new access event names insert and read back intact, `admin.chat.read` with
 *      the member it names and `admin.transaction.read` with no member at all.
 *   2. A reason exactly as long as the contract allows survives the round trip unchanged.
 *   3. No migration is needed for any of it -- the Phase A table already holds it.
 */

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

function readRequest(
  query: Record<string, string> = {},
  params: Record<string, string> = {},
): Request {
  return {
    ip: '203.0.113.7',
    headers: { apitoken: 'not-read-by-the-audit-path' },
    query: { limit: '10', offset: '0', search: '', ...query },
    params,
    body: {},
  } as unknown as Request;
}

function bodyRequest(body: Record<string, unknown>): Request {
  return {
    ip: '203.0.113.7',
    headers: { apitoken: 'not-read-by-the-audit-path' },
    query: {},
    params: {},
    body,
  } as unknown as Request;
}

describeWithDb('CTBL-0025 Phase C against a real database', () => {
  const knex = Container.get(Db).knex;
  let controller: AdminController;
  let memberService: MemberService;
  let adminService: AdminService;
  let targetId: number;

  async function auditRows(event?: string) {
    const query = knex('admin_audit_event')
      .select('*')
      .where('actor_member_id', actorId)
      .orderBy('id');
    if (event) query.where('event', event);
    return query;
  }

  beforeAll(async () => {
    const existing = await knex('avatar').select('id').where('id', 1).first();
    if (!existing) {
      await knex('avatar')
        .insert({ id: 1, name: fixtureName('avatar'), filename: 'ctbl25c.wrl', status: 1 });
    }
  });

  beforeEach(async () => {
    memberService = Container.get(MemberService);
    adminService = Container.get(AdminService);
    controller = new AdminController(
      adminService,
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
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await knex('admin_audit_event').where('actor_member_id', actorId).del();
    await knex('ban').whereIn('ban_member_id', [actorId, targetId]).del();
    await cleanUpFixtures(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('stores a chat access event, naming the member whose chat was read', async () => {
    jest.spyOn(adminService, 'searchUserChat').mockResolvedValue({
      messages: [{ id: 1, body: 'a private line', created_at: '2026-01-01', name: 'Plaza' }],
      total: [{ count: 1 }],
    } as never);
    const response = mockResponse();

    await controller.searchUserChat(
      readRequest({ user: String(targetId), search: 'Plaza', limit: '25', offset: '50' }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    const events = await auditRows('admin.chat.read');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].authority).toBe('global-role');
    expect(events[0].actor_member_id).toBe(actorId);
    expect(events[0].target_type).toBe('member');
    expect(events[0].target_member_id).toBe(targetId);
    expect(events[0].reason).toBeNull();
    expect(events[0].source).toBe('203.0.113.7');
    expect(JSON.parse(events[0].metadata))
      .toEqual({ capability: 'security', rows_returned: 1, limit: 25, offset: 50 });
  });

  it('keeps every word of the chat and the search string out of the stored row', async () => {
    jest.spyOn(adminService, 'searchUserChat').mockResolvedValue({
      messages: [{ id: 1, body: 'the-private-words', created_at: '2026-01-01', name: 'x' }],
      total: [{ count: 1 }],
    } as never);

    await controller.searchUserChat(
      readRequest({ user: String(targetId), search: 'the-private-search' }),
      mockResponse() as Response,
    );

    const [row] = await auditRows('admin.chat.read');
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('the-private-words');
    expect(stored).not.toContain('the-private-search');
  });

  it('stores a community ledger read with no member named', async () => {
    jest.spyOn(adminService, 'getTransactions')
      .mockResolvedValue({ transactions: [], total: [{ count: 0 }] } as never);
    const response = mockResponse();

    await controller.getTransactions(
      readRequest({ type: 'purchase' }), response as Response,
    );

    expect(response.statusCode).toBe(200);
    const events = await auditRows('admin.transaction.read');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].target_type).toBeNull();
    expect(events[0].target_member_id).toBeNull();
    expect(JSON.parse(events[0].metadata).scope).toBe('community');
  });

  it('stores a member ledger read against that member', async () => {
    jest.spyOn(adminService, 'getTransactionsByWalletId')
      .mockResolvedValue({ transactions: [], total: [{ count: 0 }] } as never);
    const response = mockResponse();

    await controller.getTransactionsByWalletId(
      readRequest({}, { id: String(targetId) }), response as Response,
    );

    expect(response.statusCode).toBe(200);
    const events = await auditRows('admin.transaction.read');
    expect(events).toHaveLength(1);
    expect(events[0].target_member_id).toBe(targetId);
    expect(JSON.parse(events[0].metadata).scope).toBe('member');
  });

  it('records a refused private read without disclosing anything', async () => {
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);
    const response = mockResponse();

    await controller.searchUserChat(
      readRequest({ user: String(targetId) }), response as Response,
    );

    expect(response.statusCode).toBe(403);
    const events = await auditRows('admin.chat.read');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('denied');
    expect(events[0].actor_member_id).toBe(actorId);
  });

  it('stores a reason exactly as long as the column allows, unchanged', async () => {
    // The contract caps an operator reason at the column width. This is the case where an
    // off-by-one between the two shows up as a silent truncation in the store.
    const longest = 'r'.repeat(AUDIT_REASON_MAX);
    const response = mockResponse();

    await controller.addBan(
      bodyRequest({
        ban_member_id: targetId, time_frame: 7, type: 'full', reason: longest,
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    const [row] = await auditRows('admin.ban.add');
    expect(row.reason).toBe(longest);
    expect(row.reason.length).toBe(AUDIT_REASON_MAX);
  });

  it('refuses a ban with no reason and leaves neither a ban nor a row behind', async () => {
    const response = mockResponse();

    await controller.addBan(
      bodyRequest({ ban_member_id: targetId, time_frame: 7, type: 'full', reason: '   ' }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    expect(await knex('ban').where('ban_member_id', targetId)).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('needed no schema change: the Phase A table already holds all of it', async () => {
    // The migration ledger is the claim. Phase C adds no migration, so the newest applied
    // one is still the Phase A table -- and every assertion above wrote into it unchanged.
    const applied = await knex('migrations').select('name').orderBy('id', 'desc').limit(1);
    expect(applied[0].name).toContain('create_admin_audit_event');
  });
});
