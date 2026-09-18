import { Request, Response } from 'express';
import { Knex } from 'knex';
import { Container } from 'typedi';

// Importing a controller pulls in the services barrel, which instantiates every
// repository -- and RoleRepository queries on construction. Without this the spec would
// try to open a real MySQL connection.
jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import {
  AdminAuditEventRepository,
  AdminAuditEventInsert,
  BanRepository,
  MemberRepository,
  RoleAssignmentRepository,
} from '../repositories';
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
 * CTBL-0025 Phase C: required operator reasons, and private-content read access.
 *
 * Two obligations from `docs/ADMIN_SECURITY_BASELINE.md` section 11, neither of which
 * Phase A or Phase B delivered:
 *
 *   1. `reason` is "required for bans, role changes and account removal". A requirement
 *      the server does not enforce is a suggestion, so the property under test is that an
 *      invalid reason produces NO state change, NO audit row and a 400 -- and that a valid
 *      one reaches the row exactly as the operator wrote it, trimmed and nothing else.
 *
 *   2. "reads of another member's private content -- chat history above all -- owe an
 *      access event". The properties under test are the ones that make such a row worth
 *      having: it names the real operator and the real subject, it is written only after a
 *      read that actually succeeded, it never contains a word of what was read, and the
 *      content is not disclosed at all when the row cannot be written.
 */

const TRANSACTION = { id: 'the-one-transaction' } as unknown as Knex.Transaction;

const ACTOR_ID = 4242;
const TARGET_MEMBER_ID = 777;
const BAN_ID = 55;
const ROLE_ID = 33;
const PLACE_ID = 88;
const WALLET_ID = 91;

/** A repository or service seen as a bag of async methods, so a test can replace one. */
function asSpyTarget(target: unknown): Record<string, (...args: unknown[]) => unknown> {
  return target as Record<string, (...args: unknown[]) => unknown>;
}

type MockResponse = Response & { statusCode?: number; body?: unknown };

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
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

function bodyRequest(body: Record<string, unknown> = {}): Request {
  return {
    ip: '203.0.113.7',
    headers: { apitoken: 'eyJhbGciOiJIUzI1NiJ9.token.signature' },
    query: {},
    params: {},
    body,
  } as unknown as Request;
}

function readRequest(
  query: Record<string, string> = {},
  params: Record<string, string> = {},
): Request {
  return {
    ip: '203.0.113.7',
    headers: { apitoken: 'eyJhbGciOiJIUzI1NiJ9.token.signature' },
    query: { limit: '10', offset: '0', search: '', ...query },
    params,
    body: {},
  } as unknown as Request;
}

/**
 * Every value that is not an operator reason, and why each one is in the list.
 *
 * `undefined` is a client that forgot the field, `null` is one that sent it empty, the two
 * string cases are a form submitted blank, the numbers and the object are a client sending
 * the wrong shape, and the last is a reason too long for the column to hold truthfully.
 */
const INVALID_REASONS: Array<{ name: string; value: unknown }> = [
  { name: 'missing', value: undefined },
  { name: 'null', value: null },
  { name: 'empty string', value: '' },
  { name: 'whitespace only', value: '   ' },
  { name: 'tabs and newlines only', value: '\t\n  \r' },
  { name: 'a number', value: 0 },
  { name: 'an object', value: { reason: 'a reason' } },
  { name: 'over the column limit', value: 'r'.repeat(AUDIT_REASON_MAX + 1) },
];

const LONGEST_REASON = 'r'.repeat(AUDIT_REASON_MAX);

describe('CTBL-0025 Phase C: required reasons and private-content reads', () => {
  let controller: AdminController;
  let memberService: MemberService;
  let adminService: AdminService;
  let written: AdminAuditEventInsert[];
  let writtenTrx: Array<Knex.Transaction | undefined>;
  /** Every business write attempted, so "no reason means no mutation" is observable. */
  let businessWrites: string[];

  beforeEach(() => {
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

    written = [];
    writtenTrx = [];
    businessWrites = [];

    jest.spyOn(memberService, 'decryptSession')
      .mockReturnValue({ id: ACTOR_ID } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['admin'] as never);
    jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(false as never);
    jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(false as never);
    jest.spyOn(memberService, 'getMemberInfoPublic')
      .mockResolvedValue({ id: ACTOR_ID, username: 'the-operator' } as never);

    jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'runInTransaction')
      .mockImplementation(async (work: unknown) =>
        (work as (trx: Knex.Transaction) => Promise<unknown>)(TRANSACTION));

    jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
      .mockImplementation(async (row: unknown, trx: unknown) => {
        written.push(row as AdminAuditEventInsert);
        writtenTrx.push(trx as Knex.Transaction | undefined);
      });

    const record = (repository: unknown, method: string, result: unknown = undefined) => {
      jest.spyOn(asSpyTarget(Container.get(repository as never)), method)
        .mockImplementation(async () => {
          businessWrites.push(method);
          return result;
        });
    };
    record(BanRepository, 'addBan', [BAN_ID]);
    record(BanRepository, 'deleteBan');
    record(RoleAssignmentRepository, 'addIdToAssignment', [12]);
    record(RoleAssignmentRepository, 'removeIdFromAssignment', 1);
    jest.spyOn(asSpyTarget(Container.get(BanRepository)), 'findById')
      .mockImplementation(async () => ({
        id: BAN_ID, ban_member_id: TARGET_MEMBER_ID, type: 'jail', status: 1,
      }));
    jest.spyOn(Container.get(RoleAssignmentService), 'reconcilePrimaryRole')
      .mockResolvedValue(undefined as never);
    jest.spyOn(memberService, 'lockForRemoval')
      .mockResolvedValue({ id: TARGET_MEMBER_ID, username: 'removed-one' } as never);
    jest.spyOn(memberService, 'removeAccount').mockImplementation(async () => {
      businessWrites.push('removeAccount');
      return undefined as never;
    });
    for (const [service, method] of [
      [ObjectInstanceService, 'moveAllObjects'],
      [ObjectService, 'removeAccount'],
      [MessageService, 'removeAllMessages'],
      [InboxService, 'removeAllMessages'],
      [MessageboardService, 'removeAllMessages'],
      [AvatarService, 'removeAllAvatars'],
      [ClubService, 'removeAccount'],
    ] as Array<[unknown, string]>) {
      jest.spyOn(asSpyTarget(Container.get(service as never)), method)
        .mockResolvedValue(undefined as never);
    }
    jest.spyOn(Container.get(PlaceService), 'getOwnedPlaces')
      .mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================== required reasons

  /**
   * The five actions baseline section 11 names, each with the body field its route reads
   * the reason from, and a minimal otherwise-valid request.
   */
  const REASON_ACTIONS: Array<{
    name: string;
    event: string;
    field: string;
    body: Record<string, unknown>;
    run: (c: AdminController, r: Request, s: MockResponse) => Promise<void>;
  }> = [
    {
      name: 'ban add',
      event: 'admin.ban.add',
      field: 'reason',
      body: { ban_member_id: TARGET_MEMBER_ID, time_frame: 7, type: 'full' },
      run: (c, r, s) => c.addBan(r, s),
    },
    {
      name: 'ban delete',
      event: 'admin.ban.remove',
      field: 'banReason',
      body: { banId: BAN_ID },
      run: (c, r, s) => c.deleteBan(r, s),
    },
    {
      name: 'role hire',
      event: 'admin.role.hire',
      field: 'reason',
      body: { member_id: TARGET_MEMBER_ID, role_id: ROLE_ID },
      run: (c, r, s) => c.hireRole(r, s),
    },
    {
      name: 'role fire',
      event: 'admin.role.fire',
      field: 'reason',
      body: { member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: PLACE_ID },
      run: (c, r, s) => c.fireRole(r, s),
    },
    {
      name: 'account removal',
      event: 'admin.account.remove',
      field: 'reason',
      body: { id: TARGET_MEMBER_ID },
      run: (c, r, s) => c.removeAccount(r, s),
    },
  ];

  describe.each(REASON_ACTIONS)('$name requires an operator reason', (action) => {
    it.each(INVALID_REASONS)('refuses a $name reason with 400', async ({ value }) => {
      const response = mockResponse();
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: value }),
        response,
      );
      expect(response.statusCode).toBe(400);
    });

    it.each(INVALID_REASONS)('makes no state change for a $name reason', async ({ value }) => {
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: value }),
        mockResponse(),
      );
      expect(businessWrites).toEqual([]);
    });

    it.each(INVALID_REASONS)('writes no audit row for a $name reason', async ({ value }) => {
      // Not even a denied one. A refusal row means an authority question answered no; an
      // authorised operator who mistyped a form has attempted no administrative action.
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: value }),
        mockResponse(),
      );
      expect(written).toEqual([]);
    });

    it('accepts the shortest real reason there is', async () => {
      const response = mockResponse();
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: 'x' }),
        response,
      );
      expect(response.statusCode).toBe(200);
      expect(written).toHaveLength(1);
      expect(written[0].reason).toBe('x');
    });

    it('accepts an ordinary reason and records it trimmed', async () => {
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: '  repeated harassment  ' }),
        mockResponse(),
      );
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe(action.event);
      expect(written[0].result).toBe('allowed');
      expect(written[0].reason).toBe('repeated harassment');
    });

    it('accepts a reason exactly as long as the column allows', async () => {
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: LONGEST_REASON }),
        mockResponse(),
      );
      expect(written).toHaveLength(1);
      expect(written[0].reason).toBe(LONGEST_REASON);
      expect(written[0].reason.length).toBe(AUDIT_REASON_MAX);
    });

    it('records the operator reason and never a placeholder', async () => {
      await action.run(
        controller,
        bodyRequest({ ...action.body, [action.field]: 'a specific stated reason' }),
        mockResponse(),
      );
      expect(written[0].reason).toBe('a specific stated reason');
      for (const placeholder of ['N/A', 'none', 'unknown', 'admin action', '']) {
        expect(written[0].reason).not.toBe(placeholder);
      }
    });

    it('checks authority before the reason, so a refusal stays a refusal', async () => {
      // Order matters twice over: the caller is told the true cause of the refusal, and
      // the denial row baseline section 11 owes is still written.
      jest.spyOn(memberService, 'canAdmin').mockResolvedValue(false as never);
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);
      const response = mockResponse();

      await action.run(controller, bodyRequest(action.body), response);

      expect(response.statusCode).toBe(403);
      expect(written).toHaveLength(1);
      expect(written[0].result).toBe('denied');
    });
  });

  it('keeps the ban history suffix out of the operator reason it audits', async () => {
    // The ban row keeps "(Deleted by <username>)" so the members screen reads as it always
    // has. That suffix is CTR's sentence, not the operator's, and section 11's `reason`
    // field means what the operator wrote -- the actor already has its own column.
    let storedBanReason: unknown;
    jest.spyOn(asSpyTarget(Container.get(BanRepository)), 'deleteBan')
      .mockImplementation(async (...args: unknown[]) => {
        businessWrites.push('deleteBan');
        storedBanReason = args[1];
        return undefined;
      });

    await controller.deleteBan(
      bodyRequest({ banId: BAN_ID, banReason: '  appeal upheld  ' }),
      mockResponse(),
    );

    expect(storedBanReason).toBe('appeal upheld (Deleted by the-operator)');
    expect(written[0].reason).toBe('appeal upheld');
    expect(written[0].reason).not.toContain('Deleted by');
  });

  it('records the reason a security-role manager gave, with their scoped authority', async () => {
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
    jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(true as never);
    jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(true as never);

    await controller.hireRole(
      bodyRequest({
        member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, reason: 'promoted to Jail Guard',
      }),
      mockResponse(),
    );

    expect(written[0].authority).toBe('resource-scoped-right');
    expect(written[0].reason).toBe('promoted to Jail Guard');
  });

  it('commits the reason inside the mutation transaction, not beside it', async () => {
    await controller.addBan(
      bodyRequest({
        ban_member_id: TARGET_MEMBER_ID, time_frame: 7, type: 'full', reason: 'spamming',
      }),
      mockResponse(),
    );
    expect(writtenTrx[0]).toBe(TRANSACTION);
  });

  // ========================================================= private-content reads

  describe('reading a member\'s chat history', () => {
    const CHAT_ROWS = [
      { id: 1, body: 'a private thing they said', created_at: '2026-01-01', name: 'Plaza' },
      { id: 2, body: 'another private thing', created_at: '2026-01-02', name: 'Plaza' },
    ];

    beforeEach(() => {
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
      jest.spyOn(adminService, 'searchUserChat')
        .mockResolvedValue({ messages: CHAT_ROWS, total: [{ count: 2 }] } as never);
    });

    const chatRequest = () => readRequest({
      user: String(TARGET_MEMBER_ID),
      search: 'a search string that is itself private',
      limit: '25',
      offset: '50',
    });

    it('records one access event and returns the chat', async () => {
      const response = mockResponse();
      await controller.searchUserChat(chatRequest(), response);
      expect(response.statusCode).toBe(200);
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.chat.read');
      expect(written[0].result).toBe('allowed');
    });

    it('names the authenticated operator, never a client-supplied id', async () => {
      await controller.searchUserChat(chatRequest(), mockResponse());
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
    });

    it('names the member whose chat was read as the target', async () => {
      await controller.searchUserChat(chatRequest(), mockResponse());
      expect(written[0].target_type).toBe('member');
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
    });

    it('records the authority that actually granted the read', async () => {
      await controller.searchUserChat(chatRequest(), mockResponse());
      expect(written[0].authority).toBe('global-role');
      expect(JSON.parse(written[0].metadata).capability).toBe('security');
    });

    it('carries a UTC timestamp and the request origin', async () => {
      await controller.searchUserChat(chatRequest(), mockResponse());
      expect(written[0].occurred_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(written[0].source).toBe('203.0.113.7');
    });

    it('records the page read and how much came back, and nothing else', async () => {
      await controller.searchUserChat(chatRequest(), mockResponse());
      expect(JSON.parse(written[0].metadata)).toEqual({
        capability: 'security',
        rows_returned: 2,
        limit: 25,
        offset: 50,
      });
    });

    it('never writes a chat line, a search string or a reason into the row', async () => {
      // The hard rule of baseline section 12 for this event: log that it was read and its
      // identifier, never its content. The search string is included because it is
      // operator input that can itself name private content.
      await controller.searchUserChat(chatRequest(), mockResponse());
      const serialised = JSON.stringify(written[0]);
      for (const secret of [
        'a private thing they said',
        'another private thing',
        'a search string that is itself private',
        'eyJhbGciOiJIUzI1NiJ9',
      ]) {
        expect(serialised).not.toContain(secret);
      }
      expect(written[0].reason).toBeNull();
    });

    it('writes the access event only after the read has succeeded', async () => {
      const order: string[] = [];
      jest.spyOn(adminService, 'searchUserChat').mockImplementation(async () => {
        order.push('read');
        return { messages: CHAT_ROWS, total: [{ count: 2 }] } as never;
      });
      jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
        .mockImplementation(async (row: unknown) => {
          order.push('audit');
          written.push(row as AdminAuditEventInsert);
        });

      await controller.searchUserChat(chatRequest(), mockResponse());

      expect(order).toEqual(['read', 'audit']);
    });

    it('withholds the chat entirely when the access event cannot be written', async () => {
      // The one place the audit store is allowed to change the response, and the direction
      // is deliberate: an unrecorded refusal still refused, but private content handed
      // over unrecorded is exactly the disclosure the event exists to make answerable.
      jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
        .mockImplementation(async () => { throw new Error('audit store unavailable'); });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = mockResponse();

      await controller.searchUserChat(chatRequest(), response);

      expect(response.statusCode).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('a private thing they said');
    });

    it('writes no allowed event when the read itself failed', async () => {
      jest.spyOn(adminService, 'searchUserChat')
        .mockRejectedValue(new Error('message table unavailable') as never);
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const response = mockResponse();

      await controller.searchUserChat(chatRequest(), response);

      expect(response.statusCode).toBe(400);
      expect(written.some(row => row.result === 'allowed')).toBe(false);
      expect(written.map(row => row.result)).toEqual(['failed']);
      expect(written[0].event).toBe('admin.chat.read');
    });

    it('refuses an operator without the capability, and records the refusal', async () => {
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);
      const response = mockResponse();

      await controller.searchUserChat(chatRequest(), response);

      expect(response.statusCode).toBe(403);
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.chat.read');
      expect(written[0].result).toBe('denied');
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
    });

    it('still refuses when the audit store is unreachable', async () => {
      // A denial may never become anything else because of an audit outage.
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);
      jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
        .mockImplementation(async () => { throw new Error('audit store unavailable'); });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = mockResponse();

      await controller.searchUserChat(chatRequest(), response);

      expect(response.statusCode).toBe(403);
      expect(response.body).toEqual({ message: 'Access Denied' });
    });

    it('reaches neither the read nor the store without a session', async () => {
      jest.spyOn(memberService, 'decryptSession').mockReturnValue(undefined as never);
      await controller.searchUserChat(chatRequest(), mockResponse());
      expect(written).toHaveLength(0);
    });
  });

  describe('reading a member\'s financial history', () => {
    const LEDGER = [
      { id: 9, amount: 5000, reason: 'purchase', sender_wallet_id: 1, recipient_wallet_id: 2 },
    ];

    beforeEach(() => {
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
      jest.spyOn(memberService, 'find')
        .mockResolvedValue({ id: TARGET_MEMBER_ID, wallet_id: WALLET_ID } as never);
      jest.spyOn(memberService, 'getMemberByWalletId')
        .mockResolvedValue([{ username: 'someone' }] as never);
      jest.spyOn(adminService, 'getTransactionsByWalletId')
        .mockResolvedValue({ transactions: [...LEDGER], total: [{ count: 1 }] } as never);
      jest.spyOn(adminService, 'getTransactions')
        .mockResolvedValue({ transactions: [...LEDGER], total: [{ count: 1 }] } as never);
    });

    const walletRequest = () =>
      readRequest({ limit: '10', offset: '0' }, { id: String(TARGET_MEMBER_ID) });

    it('records one access event naming the member whose ledger was opened', async () => {
      const response = mockResponse();
      await controller.getTransactionsByWalletId(walletRequest(), response);
      expect(response.statusCode).toBe(200);
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.transaction.read');
      expect(written[0].result).toBe('allowed');
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].target_type).toBe('member');
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
      expect(JSON.parse(written[0].metadata))
        .toEqual({ capability: 'security', scope: 'member', rows_returned: 1,
          limit: 10, offset: 0 });
    });

    it('records the community-wide read with no member named', async () => {
      const response = mockResponse();
      await controller.getTransactions(readRequest({ type: 'purchase' }), response);
      expect(response.statusCode).toBe(200);
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.transaction.read');
      expect(written[0].target_member_id).toBeNull();
      expect(written[0].target_type).toBeNull();
      expect(JSON.parse(written[0].metadata).scope).toBe('community');
    });

    it('never writes an amount or a counterparty into the row', async () => {
      await controller.getTransactionsByWalletId(walletRequest(), mockResponse());
      const serialised = JSON.stringify(written[0]);
      for (const value of ['5000', 'someone', 'eyJhbGciOiJIUzI1NiJ9']) {
        expect(serialised).not.toContain(value);
      }
    });

    it('withholds the ledger when the access event cannot be written', async () => {
      jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
        .mockImplementation(async () => { throw new Error('audit store unavailable'); });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = mockResponse();

      await controller.getTransactionsByWalletId(walletRequest(), response);

      expect(response.statusCode).toBe(500);
      expect(JSON.stringify(response.body)).not.toContain('5000');
    });

    it('writes no allowed event when the read itself failed', async () => {
      jest.spyOn(adminService, 'getTransactions')
        .mockRejectedValue(new Error('transaction table unavailable') as never);
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const response = mockResponse();

      await controller.getTransactions(readRequest({ type: 'purchase' }), response);

      expect(response.statusCode).toBe(400);
      expect(written.map(row => row.result)).toEqual(['failed']);
    });

    it('refuses an operator without the capability on both routes', async () => {
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);

      const first = mockResponse();
      await controller.getTransactionsByWalletId(walletRequest(), first);
      expect(first.statusCode).toBe(403);
      expect(written[0].result).toBe('denied');
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);

      const second = mockResponse();
      await controller.getTransactions(readRequest({ type: 'purchase' }), second);
      expect(second.statusCode).toBe(403);
      expect(written[1].result).toBe('denied');
      expect(written[1].event).toBe('admin.transaction.read');
    });
  });

  // ================================================== reads that owe nothing

  describe('ordinary administrative reads stay unaudited', () => {
    /**
     * The surfaces classified ORDINARY_ADMIN_READ, asserted as a rule rather than left
     * implicit. Baseline section 11 exempts read-only administrative reads, and auditing
     * one anyway would assert an obligation the baseline does not state -- and would bury
     * the events that matter under ones that do not. The evidence for each classification
     * is section 9 of `docs/ADMIN_AUDIT_TRAIL.md`.
     */
    beforeEach(() => {
      jest.spyOn(memberService, 'getAccessLevel')
        .mockResolvedValue(['admin', 'security'] as never);
      jest.spyOn(Container.get(PlaceService), 'findUserPlaces')
        .mockResolvedValue([] as never);
      jest.spyOn(Container.get(ObjectInstanceService), 'findAllObjectInstances')
        .mockResolvedValue([] as never);
      jest.spyOn(Container.get(ObjectInstanceService), 'getOwnedObjects')
        .mockResolvedValue([] as never);
      jest.spyOn(adminService, 'searchUsers')
        .mockResolvedValue({ users: [], total: [{ count: 0 }] } as never);
      jest.spyOn(adminService, 'getCommunityData').mockResolvedValue({} as never);
      jest.spyOn(adminService, 'getBanHistory').mockResolvedValue([] as never);
    });

    const CASES: Array<{
      name: string;
      run: (c: AdminController, r: MockResponse) => Promise<void>;
    }> = [
      {
        name: 'findUserPlaces',
        run: (c, r) => c.findUserPlaces(
          readRequest({ type: 'club', id: String(TARGET_MEMBER_ID) }), r),
      },
      {
        name: 'getObjectInstances',
        run: (c, r) => c.getObjectInstances(readRequest(), r),
      },
      {
        name: 'getOwnedObjects',
        run: (c, r) => c.getOwnedObjects(
          readRequest({}, { id: String(TARGET_MEMBER_ID) }), r),
      },
      {
        name: 'searchUsers',
        run: (c, r) => c.searchUsers(readRequest({ search: 'a' }), r),
      },
      {
        name: 'getCommunityData',
        run: (c, r) => c.getCommunityData(readRequest(), r),
      },
      {
        name: 'getBanHistory',
        run: (c, r) => c.getBanHistory(
          readRequest({ ban_member_id: String(TARGET_MEMBER_ID) }), r),
      },
    ];

    it.each(CASES)('$name answers the operator and writes no audit row', async ({ run }) => {
      // The 200 assertion is not decoration: without it a route that threw on its way in
      // would also leave `written` empty, and this case would pass for the wrong reason.
      const response = mockResponse();
      await run(controller, response);
      expect(response.statusCode).toBe(200);
      expect(written).toEqual([]);
    });
  });
});
