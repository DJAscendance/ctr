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
import { AUDIT_EVENT_NAMES } from '../libs/audit-event';
import { AdminController } from './admin.controller';

/**
 * CTBL-0025: what the operator audit store records, and what it refuses to.
 *
 * `docs/ADMIN_SECURITY_BASELINE.md` section 11 says every administrative action that
 * changes state owes an audit event, and that refusals owe one too. Section 12 says what
 * may never appear in one. This spec is the enforcement of both against the real wiring:
 * the services and repositories are the real objects, and only the statements that would
 * reach a database are replaced.
 *
 * The properties under test, in order of how badly each one would hurt if it broke:
 *
 *   1. The actor is the authenticated session's member id, and a client cannot change it.
 *   2. An `allowed` row and its business mutation share one transaction, both ways round:
 *      a failed audit insert takes the mutation down with it, and a failed mutation leaves
 *      no `allowed` row behind.
 *   3. No credential, token or message body reaches a row.
 *   4. A refusal is recorded, and recording it cannot turn the refusal into anything else.
 */

/** Stands in for a knex transaction; identity is the only thing asserted about it. */
const TRANSACTION = { id: 'the-one-transaction' } as unknown as Knex.Transaction;

/** The authenticated operator. Every stored actor id must be this and nothing else. */
const ACTOR_ID = 4242;

/** A different member, used as every spoof attempt's claimed actor. */
const SPOOFED_ID = 9999;

const TARGET_MEMBER_ID = 777;
const BAN_ID = 55;
const ROLE_ID = 33;
const PLACE_ID = 88;
const AVATAR_ID = 12;
const OBJECT_ID = 21;

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

/**
 * A request whose body claims, in six different ways, to be somebody else.
 *
 * Every field an implementation might plausibly reach for instead of the session is
 * present and points at `SPOOFED_ID`. `ip` is the one field the audit path is allowed to
 * read off the request, and only as a source address.
 */
function spoofingRequest(body: Record<string, unknown> = {}): Request {
  return {
    ip: '203.0.113.7',
    headers: {
      apitoken: 'eyJhbGciOiJIUzI1NiJ9.spoofed.signature',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.spoofed.signature',
      cookie: 'connect.sid=s%3Aspoofed',
    },
    query: { actor: String(SPOOFED_ID), actor_id: String(SPOOFED_ID) },
    body: {
      actor: SPOOFED_ID,
      actor_id: SPOOFED_ID,
      actorMemberId: SPOOFED_ID,
      admin_id: SPOOFED_ID,
      session_id: SPOOFED_ID,
      username: 'not-the-operator',
      password: 'hunter2',
      ...body,
    },
  } as unknown as Request;
}

describe('CTBL-0025 admin audit trail', () => {
  let controller: AdminController;
  let memberService: MemberService;
  let written: AdminAuditEventInsert[];
  /** The transaction each audit insert was handed, in write order. */
  let writtenTrx: Array<Knex.Transaction | undefined>;
  /** Set when the work passed to runInTransaction threw, i.e. the unit rolled back. */
  let rolledBack: boolean;
  /** Repository writes the ban and role paths make, with the transaction each got. */
  let businessWrites: Array<{ method: string; trx: unknown }>;

  beforeEach(() => {
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

    written = [];
    writtenTrx = [];
    rolledBack = false;
    businessWrites = [];

    jest.spyOn(memberService, 'decryptSession')
      .mockReturnValue({ id: ACTOR_ID } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['admin'] as never);
    jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(false as never);
    jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(false as never);
    jest.spyOn(memberService, 'getMemberInfoPublic')
      .mockResolvedValue({ id: ACTOR_ID, username: 'the-operator' } as never);

    // One transaction for the whole unit, and a record of whether it survived.
    jest.spyOn(asSpyTarget(Container.get(MemberRepository)), 'runInTransaction')
      .mockImplementation(async (work: unknown) => {
        try {
          return await (work as (trx: Knex.Transaction) => Promise<unknown>)(TRANSACTION);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      });

    // The audit store's only write path, recorded rather than executed.
    jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
      .mockImplementation(async (row: unknown, trx: unknown) => {
        written.push(row as AdminAuditEventInsert);
        writtenTrx.push(trx as Knex.Transaction | undefined);
      });

    const record = (repository: unknown, method: string, result: unknown = undefined) => {
      jest.spyOn(asSpyTarget(Container.get(repository as never)), method)
        .mockImplementation(async (...args: unknown[]) => {
          businessWrites.push({ method, trx: args[args.length - 1] });
          return result;
        });
    };
    record(BanRepository, 'addBan', [BAN_ID]);
    record(BanRepository, 'deleteBan');
    record(RoleAssignmentRepository, 'removeIdFromAssignment', 1);
    jest.spyOn(asSpyTarget(Container.get(BanRepository)), 'findById')
      .mockImplementation(async () => ({
        id: BAN_ID,
        ban_member_id: TARGET_MEMBER_ID,
        type: 'jail',
        status: 1,
      }));
    jest.spyOn(Container.get(RoleAssignmentService), 'reconcilePrimaryRole')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------- the recorded events

  describe('a successful ban is recorded with the ban', () => {
    beforeEach(async () => {
      await controller.addBan(
        spoofingRequest({
          ban_member_id: TARGET_MEMBER_ID,
          time_frame: 7,
          type: 'full',
          reason: 'spamming the plaza',
        }),
        mockResponse(),
      );
    });

    it('writes exactly one event, named for the action', () => {
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.ban.add');
      expect(written[0].result).toBe('allowed');
    });

    it('names the authenticated operator as the actor', () => {
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
    });

    it('names the banned member as the target', () => {
      expect(written[0].target_type).toBe('member');
      expect(written[0].target_id).toBe(TARGET_MEMBER_ID);
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
    });

    it('records the operator reason', () => {
      expect(written[0].reason).toBe('spamming the plaza');
    });

    it('carries a UTC timestamp', () => {
      expect(written[0].occurred_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      const stamped = Date.parse(`${written[0].occurred_at.replace(' ', 'T')}Z`);
      expect(Math.abs(stamped - Date.now())).toBeLessThan(60_000);
    });

    it('records which authority layer allowed it', () => {
      expect(written[0].authority).toBe('global-role');
    });

    it('records the request origin and nothing else from the request', () => {
      expect(written[0].source).toBe('203.0.113.7');
    });

    it('keeps the ban type, so full and jail stay distinguishable afterwards', () => {
      expect(JSON.parse(written[0].metadata)).toMatchObject({
        ban_type: 'full',
        time_frame_days: 7,
      });
    });

    it('commits inside the same transaction as the ban row', () => {
      expect(writtenTrx[0]).toBe(TRANSACTION);
      expect(businessWrites).toEqual([{ method: 'addBan', trx: TRANSACTION }]);
    });
  });

  it('keeps a jail ban distinguishable from a full ban', async () => {
    await controller.addBan(
      spoofingRequest({
        ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'jail', reason: 'cooling off',
      }),
      mockResponse(),
    );
    expect(JSON.parse(written[0].metadata).ban_type).toBe('jail');
  });

  describe('a ban withdrawal is recorded with the withdrawal', () => {
    beforeEach(async () => {
      await controller.deleteBan(
        spoofingRequest({ banId: BAN_ID, banReason: 'appeal upheld' }),
        mockResponse(),
      );
    });

    it('is named for the action and names the ban as the target', () => {
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.ban.remove');
      expect(written[0].result).toBe('allowed');
      expect(written[0].target_type).toBe('ban');
      expect(written[0].target_id).toBe(BAN_ID);
    });

    it('resolves the member behind the ban, so the row is findable by them', () => {
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
    });

    it('records the before state that the update destroyed', () => {
      expect(JSON.parse(written[0].metadata))
        .toMatchObject({ ban_type: 'jail', old_status: 1, new_status: 0 });
    });

    it('commits inside the same transaction as the update', () => {
      expect(writtenTrx[0]).toBe(TRANSACTION);
      expect(businessWrites).toEqual([{ method: 'deleteBan', trx: TRANSACTION }]);
    });
  });

  describe('a role removal is recorded with the removal', () => {
    it('names the role and the member, and joins the same transaction', async () => {
      await controller.fireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: PLACE_ID }),
        mockResponse(),
      );
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe('admin.role.fire');
      expect(written[0].result).toBe('allowed');
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].target_type).toBe('role');
      expect(written[0].target_id).toBe(ROLE_ID);
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
      expect(writtenTrx[0]).toBe(TRANSACTION);
      expect(businessWrites)
        .toEqual([{ method: 'removeIdFromAssignment', trx: TRANSACTION }]);
    });

    it('records the scoped right when a security-role manager fired the role', async () => {
      // Baseline section 4 keeps the two grant paths apart. A global Admin and a
      // security-role manager both reach the same handler, and the row has to say which.
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
      jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(true as never);
      jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(true as never);

      await controller.fireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: null }),
        mockResponse(),
      );
      expect(written[0].authority).toBe('resource-scoped-right');
    });
  });

  // --------------------------------------------------------------------- actor authority

  describe('actor authority', () => {
    /** Every audited path that writes an `allowed` row, with a request that spoofs. */
    const SPOOF_CASES = [
      {
        name: 'addBan',
        run: (c: AdminController) => c.addBan(
          spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }),
          mockResponse(),
        ),
      },
      {
        name: 'deleteBan',
        run: (c: AdminController) => c.deleteBan(
          spoofingRequest({ banId: BAN_ID, banReason: 'x' }), mockResponse(),
        ),
      },
      {
        name: 'fireRole',
        run: (c: AdminController) => c.fireRole(
          spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: null }),
          mockResponse(),
        ),
      },
    ];

    it.each(SPOOF_CASES)('$name ignores a client-supplied actor', async ({ run }) => {
      await run(controller);
      expect(written).toHaveLength(1);
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].actor_member_id).not.toBe(SPOOFED_ID);
      // Not smuggled in as a target or a metadata field either.
      expect(JSON.stringify(written[0])).not.toContain(String(SPOOFED_ID));
    });

    it('does not reuse the target id as the actor', async () => {
      await controller.addBan(
        spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }),
        mockResponse(),
      );
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
      expect(written[0].actor_member_id).not.toBe(written[0].target_member_id);
    });

    it('names the real operator on a refusal too', async () => {
      jest.spyOn(memberService, 'canAdmin').mockResolvedValue(false as never);
      await controller.addBan(
        spoofingRequest({ ban_member_id: TARGET_MEMBER_ID }), mockResponse(),
      );
      expect(written[0].result).toBe('denied');
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
    });
  });

  // ------------------------------------------------------------------ secret exclusion

  describe('secret exclusion', () => {
    /** Section 12's list, as it would arrive: in the body, the headers and the query. */
    const SECRETS = [
      'hunter2',
      'eyJhbGciOiJIUzI1NiJ9.spoofed.signature',
      'connect.sid=s%3Aspoofed',
      'Bearer',
      '$2b$10$notarealhash',
      'reset-token-abc',
    ];

    it('writes no credential from a request that is full of them', async () => {
      await controller.addBan(
        spoofingRequest({
          ban_member_id: TARGET_MEMBER_ID,
          time_frame: 1,
          type: 'full',
          reason: 'spamming',
          password: 'hunter2',
          password_hash: '$2b$10$notarealhash',
          reset_token: 'reset-token-abc',
          apitoken: 'eyJhbGciOiJIUzI1NiJ9.spoofed.signature',
        }),
        mockResponse(),
      );
      const serialised = JSON.stringify(written);
      for (const secret of SECRETS) {
        expect(serialised).not.toContain(secret);
      }
    });

    it('writes no chat or message content', async () => {
      await controller.addBan(
        spoofingRequest({
          ban_member_id: TARGET_MEMBER_ID,
          time_frame: 1,
          type: 'full',
          body: 'the words of a private message',
          message: 'the words of a private message',
          chat_line: 'the words of a chat line',
          email: 'someone@example.invalid',
        }),
        mockResponse(),
      );
      const serialised = JSON.stringify(written);
      expect(serialised).not.toContain('the words of');
      expect(serialised).not.toContain('example.invalid');
    });

    it('stores only the named facts, never the whole body', async () => {
      await controller.addBan(
        spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }),
        mockResponse(),
      );
      expect(Object.keys(JSON.parse(written[0].metadata)).sort())
        .toEqual(['ban_id', 'ban_type', 'end_date_utc', 'time_frame_days']);
    });
  });

  // -------------------------------------------------------------- the transaction gates

  describe('a failed audit insert rolls the business mutation back', () => {
    beforeEach(() => {
      jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
        .mockImplementation(async (row: unknown, trx: unknown) => {
          // Only the atomic path is broken. The denial and failure paths write through the
          // same method with no transaction, and those must stay best-effort.
          if (trx) throw new Error('audit store unavailable');
          written.push(row as AdminAuditEventInsert);
          writtenTrx.push(undefined);
        });
    });

    const ATOMIC_CASES = [
      {
        name: 'addBan',
        run: (c: AdminController, r: MockResponse) => c.addBan(
          spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }), r,
        ),
        expected: 400,
      },
      {
        name: 'deleteBan',
        run: (c: AdminController, r: MockResponse) => c.deleteBan(
          spoofingRequest({ banId: BAN_ID, banReason: 'x' }), r,
        ),
        expected: 400,
      },
      {
        name: 'fireRole',
        run: (c: AdminController, r: MockResponse) => c.fireRole(
          spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: null }), r,
        ),
        expected: 500,
      },
    ];

    it.each(ATOMIC_CASES)(
      '$name unwinds and refuses when the event cannot be written',
      async ({ run, expected }) => {
        const response = mockResponse();
        await run(controller, response);
        expect(rolledBack).toBe(true);
        expect(response.statusCode).toBe(expected);
        // Nothing claiming the change succeeded survived.
        expect(written.some(row => row.result === 'allowed')).toBe(false);
      },
    );

    it('records the attempt as failed, never as allowed', async () => {
      await controller.addBan(
        spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }),
        mockResponse(),
      );
      expect(written).toHaveLength(1);
      expect(written[0].result).toBe('failed');
      expect(written[0].event).toBe('admin.ban.add');
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
    });
  });

  describe('a failed business mutation leaves no false success', () => {
    it('writes no allowed event when the ban insert throws', async () => {
      jest.spyOn(asSpyTarget(Container.get(BanRepository)), 'addBan')
        .mockImplementation(async () => { throw new Error('ban table unavailable'); });
      const response = mockResponse();

      await controller.addBan(
        spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }),
        response,
      );

      expect(rolledBack).toBe(true);
      expect(response.statusCode).toBe(400);
      expect(written.some(row => row.result === 'allowed')).toBe(false);
      expect(written.map(row => row.result)).toEqual(['failed']);
    });

    it('writes no allowed event when the role removal throws', async () => {
      jest
        .spyOn(asSpyTarget(Container.get(RoleAssignmentRepository)), 'removeIdFromAssignment')
        .mockImplementation(async () => { throw new Error('role_assignment unavailable'); });
      const response = mockResponse();

      await controller.fireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: null }),
        response,
      );

      expect(rolledBack).toBe(true);
      expect(response.statusCode).toBe(500);
      expect(written.some(row => row.result === 'allowed')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------- refusals

  describe('refusals are recorded', () => {
    beforeEach(() => {
      jest.spyOn(memberService, 'canAdmin').mockResolvedValue(false as never);
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);
      jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(false as never);
      jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(false as never);
    });

    /** Every admin mutation route, and the event a refusal on it must produce. */
    const DENIAL_CASES = [
      {
        event: 'admin.ban.add',
        run: (c: AdminController, r: MockResponse) =>
          c.addBan(spoofingRequest({ ban_member_id: TARGET_MEMBER_ID }), r),
        status: 403,
      },
      {
        event: 'admin.ban.remove',
        run: (c: AdminController, r: MockResponse) =>
          c.deleteBan(spoofingRequest({ banId: BAN_ID }), r),
        status: 403,
      },
      {
        event: 'admin.role.hire',
        run: (c: AdminController, r: MockResponse) =>
          c.hireRole(spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID }), r),
        status: 403,
      },
      {
        event: 'admin.role.fire',
        run: (c: AdminController, r: MockResponse) => c.fireRole(
          spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID, place_id: null }), r,
        ),
        status: 403,
      },
      {
        event: 'admin.avatar.approve',
        run: (c: AdminController, r: MockResponse) =>
          c.avatarApprove(spoofingRequest({ id: AVATAR_ID }), r),
        status: 403,
      },
      {
        event: 'admin.avatar.reject',
        run: (c: AdminController, r: MockResponse) =>
          c.avatarReject(spoofingRequest({ id: AVATAR_ID }), r),
        status: 403,
      },
      {
        event: 'admin.place.update',
        run: (c: AdminController, r: MockResponse) =>
          c.placesUpdate(spoofingRequest({ id: PLACE_ID, name: 'A Place', type: 'club' }), r),
        status: 403,
      },
      {
        event: 'admin.object.update',
        run: (c: AdminController, r: MockResponse) =>
          c.objectssUpdate(spoofingRequest({ id: OBJECT_ID }), r),
        status: 403,
      },
      {
        event: 'admin.account.remove',
        run: (c: AdminController, r: MockResponse) =>
          c.removeAccount(spoofingRequest({ id: TARGET_MEMBER_ID }), r),
        status: 403,
      },
    ];

    it.each(DENIAL_CASES)('$event records a denied event', async ({ event, run, status }) => {
      const response = mockResponse();
      await run(controller, response);
      expect(response.statusCode).toBe(status);
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe(event);
      expect(written[0].result).toBe('denied');
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].occurred_at)
        .toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // A refusal never joins a transaction: it did not open one, and acquiring one would
      // let an audit outage change the response.
      expect(writtenTrx[0]).toBeUndefined();
    });

    it('covers every registered event name', () => {
      expect(DENIAL_CASES.map(testCase => testCase.event).sort())
        .toEqual([...AUDIT_EVENT_NAMES].sort());
    });

    it('still refuses when the audit store is unreachable', async () => {
      // The hard rule for this path: recording a refusal may never change the refusal.
      jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
        .mockImplementation(async () => { throw new Error('audit store unavailable'); });
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = mockResponse();

      await controller.addBan(spoofingRequest({ ban_member_id: TARGET_MEMBER_ID }), response);

      expect(response.statusCode).toBe(403);
      expect(response.body).toEqual({ message: 'Access Denied' });
    });
  });

  // ------------------------------------------------------------------------ append only

  describe('the store is append-only to application code', () => {
    it('offers no way to change or remove a written event', () => {
      const repository = Container.get(AdminAuditEventRepository);
      const surface = [
        ...Object.getOwnPropertyNames(Object.getPrototypeOf(repository)),
        ...Object.getOwnPropertyNames(repository),
      ];
      expect(surface).toContain('insert');
      for (const forbidden of ['update', 'delete', 'del', 'remove', 'truncate', 'upsert']) {
        expect(surface).not.toContain(forbidden);
      }
    });

    it('offers no mutation entry point on the service either', () => {
      const service = Container.get(AdminAuditService);
      const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      expect(surface.sort()).toEqual(['constructor', 'recordChange', 'recordOutcome', 'toRow']);
    });
  });

  // --------------------------------------------------------- authorization is unchanged

  describe('authorization is unchanged by this lane', () => {
    it('still allows an admin through', async () => {
      const response = mockResponse();
      await controller.addBan(
        spoofingRequest({ ban_member_id: TARGET_MEMBER_ID, time_frame: 1, type: 'full' }),
        response,
      );
      expect(response.statusCode).toBe(200);
    });

    it('still refuses a non-admin on every mutation route', async () => {
      jest.spyOn(memberService, 'canAdmin').mockResolvedValue(false as never);
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['citizen'] as never);
      const response = mockResponse();
      await controller.removeAccount(spoofingRequest({ id: TARGET_MEMBER_ID }), response);
      expect(response.statusCode).toBe(403);
    });

    it('never reaches the audit store without a session', async () => {
      jest.spyOn(memberService, 'decryptSession').mockReturnValue(undefined as never);
      await controller.addBan(spoofingRequest({ ban_member_id: TARGET_MEMBER_ID }),
        mockResponse());
      expect(written).toHaveLength(0);
    });
  });
});
