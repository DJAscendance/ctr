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
  AvatarRepository,
  MemberRepository,
  ObjectRepository,
  PlaceRepository,
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
import { AdminController } from './admin.controller';

/**
 * CTBL-0025 Phase B: the five admin writes that used to float.
 *
 * Phase A audited four of the nine mutation actions atomically and left these five
 * recording refusals only, for one reason stated in `docs/ADMIN_AUDIT_TRAIL.md`: each
 * answered 200 before its write resolved, so there was no committed mutation for an
 * `allowed` row to commit WITH, and a rejected write could not even reach the handler's
 * catch block. This spec is the enforcement of the repair.
 *
 * Four properties, in order of how badly each would hurt if it broke:
 *
 *   1. No 200 leaves the handler while its write is still pending, and none leaves at all
 *      when the write rejects. This is the floating-promise defect itself.
 *   2. The business mutation and its `allowed` row share one transaction, both ways round:
 *      a failed audit insert takes the mutation down, and a failed mutation leaves no
 *      `allowed` row.
 *   3. The actor is the session's member id, whatever the body claims, and for role hire
 *      the recorded authority is the gate that actually granted it.
 *   4. An `allowed` row never claims a change the database did not make.
 */

/** Stands in for a knex transaction; identity is the only thing asserted about it. */
const TRANSACTION = { id: 'the-one-transaction' } as unknown as Knex.Transaction;

/** The authenticated operator. Every stored actor id must be this and nothing else. */
const ACTOR_ID = 4242;

/** A different member, used as every spoof attempt's claimed actor. */
const SPOOFED_ID = 9999;

const TARGET_MEMBER_ID = 777;
const ROLE_ID = 33;
const ASSIGNMENT_ID = 4711;
const AVATAR_ID = 12;
const PLACE_ID = 88;
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
    query: { actor: String(SPOOFED_ID) },
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

/** A promise a test decides the fate of, so "did the handler wait" is observable. */
function deferred<T>() {
  let settle: (value: T) => void;
  let fail: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle: (v: T) => settle(v), fail: (e: Error) => fail(e) };
}

describe('CTBL-0025 Phase B: the five formerly floating admin writes', () => {
  let controller: AdminController;
  let memberService: MemberService;
  let written: AdminAuditEventInsert[];
  /** The transaction each audit insert was handed, in write order. */
  let writtenTrx: Array<Knex.Transaction | undefined>;
  /** Set when the work passed to runInTransaction threw, i.e. the unit rolled back. */
  let rolledBack: boolean;
  /** Business repository writes, with the transaction each one got. */
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

    jest.spyOn(memberService, 'decryptSession').mockReturnValue({ id: ACTOR_ID } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['admin'] as never);
    jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(false as never);
    jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(false as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

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
    record(RoleAssignmentRepository, 'addIdToAssignment', [ASSIGNMENT_ID]);
    record(AvatarRepository, 'updateStatus', 1);
    record(PlaceRepository, 'updatePlaces', 1);
    record(ObjectRepository, 'update', 1);
    jest.spyOn(asSpyTarget(Container.get(AvatarRepository)), 'findById')
      .mockImplementation(async () => ({ id: AVATAR_ID, status: 2 }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** The five actions, each with the repository write it must wait for. */
  const CASES = [
    {
      name: 'role hire',
      event: 'admin.role.hire',
      repository: RoleAssignmentRepository,
      method: 'addIdToAssignment',
      resolved: [ASSIGNMENT_ID],
      failureStatus: 500,
      run: (c: AdminController, r: MockResponse) => c.hireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID }), r,
      ),
    },
    {
      name: 'avatar approve',
      event: 'admin.avatar.approve',
      repository: AvatarRepository,
      method: 'updateStatus',
      resolved: 1,
      failureStatus: 400,
      run: (c: AdminController, r: MockResponse) =>
        c.avatarApprove(spoofingRequest({ id: AVATAR_ID }), r),
    },
    {
      name: 'avatar reject',
      event: 'admin.avatar.reject',
      repository: AvatarRepository,
      method: 'updateStatus',
      resolved: 1,
      failureStatus: 400,
      run: (c: AdminController, r: MockResponse) =>
        c.avatarReject(spoofingRequest({ id: AVATAR_ID }), r),
    },
    {
      name: 'place update',
      event: 'admin.place.update',
      repository: PlaceRepository,
      method: 'updatePlaces',
      resolved: 1,
      failureStatus: 400,
      run: (c: AdminController, r: MockResponse) => c.placesUpdate(
        spoofingRequest({
          id: PLACE_ID, name: 'A Place', type: 'club', description: 'a description',
        }),
        r,
      ),
    },
    {
      name: 'object update',
      event: 'admin.object.update',
      repository: ObjectRepository,
      method: 'update',
      resolved: 1,
      failureStatus: 400,
      run: (c: AdminController, r: MockResponse) => c.objectssUpdate(
        spoofingRequest({
          id: OBJECT_ID,
          name: 'A Thing',
          directory: 'furniture',
          filename: 'thing.wrl',
          thumbnail: 'thing.gif',
          price: 50,
          limit: 0,
          quantity: 3,
          status: 1,
        }),
        r,
      ),
    },
  ];

  // ------------------------------------------------------------------ the response order

  describe('no success answer leaves before the write has finished', () => {
    it.each(CASES)(
      '$name has not answered while its write is still pending',
      async ({ repository, method, resolved, run }) => {
        const gate = deferred<unknown>();
        jest.spyOn(asSpyTarget(Container.get(repository as never)), method)
          .mockImplementation(() => gate.promise as never);
        const response = mockResponse();

        const handled = run(controller, response);
        // Several microtask turns: enough for any handler that was going to answer
        // without waiting to have done so.
        await new Promise(resolve => setImmediate(resolve));
        expect(response.statusCode).toBeUndefined();
        expect(response.status).not.toHaveBeenCalled();

        gate.settle(resolved);
        await handled;
        expect(response.statusCode).toBe(200);
      },
    );

    it.each(CASES)(
      '$name never answers success when its write rejects',
      async ({ repository, method, failureStatus, run }) => {
        const gate = deferred<unknown>();
        jest.spyOn(asSpyTarget(Container.get(repository as never)), method)
          .mockImplementation(() => gate.promise as never);
        const response = mockResponse();

        const handled = run(controller, response);
        await new Promise(resolve => setImmediate(resolve));
        gate.fail(new Error('database unavailable'));
        await handled;

        expect(response.statusCode).toBe(failureStatus);
        expect(rolledBack).toBe(true);
        expect(written.some(row => row.result === 'allowed')).toBe(false);
      },
    );
  });

  // ------------------------------------------------------------------- the success rows

  describe('each success is recorded atomically', () => {
    it.each(CASES)('$name writes one allowed event named $event', async ({ event, run }) => {
      await run(controller, mockResponse());
      expect(written).toHaveLength(1);
      expect(written[0].event).toBe(event);
      expect(written[0].result).toBe('allowed');
    });

    it.each(CASES)('$name commits its event in the business transaction', async ({ run }) => {
      const response = mockResponse();
      await run(controller, response);
      expect(response.statusCode).toBe(200);
      expect(writtenTrx).toEqual([TRANSACTION]);
      expect(businessWrites.every(write => write.trx === TRANSACTION)).toBe(true);
      expect(businessWrites.length).toBeGreaterThan(0);
    });

    it.each(CASES)('$name carries a UTC timestamp and the request origin', async ({ run }) => {
      await run(controller, mockResponse());
      expect(written[0].occurred_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(written[0].source).toBe('203.0.113.7');
    });

    it('role hire names the role and the member it was granted to', async () => {
      await controller.hireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID }), mockResponse(),
      );
      expect(written[0].target_type).toBe('role');
      expect(written[0].target_id).toBe(ROLE_ID);
      expect(written[0].target_member_id).toBe(TARGET_MEMBER_ID);
      expect(JSON.parse(written[0].metadata)).toEqual({
        role_id: ROLE_ID,
        place_id: null,
        assignment_id: ASSIGNMENT_ID,
      });
    });

    it('avatar approve names the avatar and the status it replaced', async () => {
      await controller.avatarApprove(spoofingRequest({ id: AVATAR_ID }), mockResponse());
      expect(written[0].target_type).toBe('avatar');
      expect(written[0].target_id).toBe(AVATAR_ID);
      expect(JSON.parse(written[0].metadata))
        .toEqual({ old_status: 2, new_status: 1, rows_updated: 1 });
    });

    it('avatar reject is a separate event, not a flag on approve', async () => {
      await controller.avatarReject(spoofingRequest({ id: AVATAR_ID }), mockResponse());
      expect(written[0].event).toBe('admin.avatar.reject');
      expect(JSON.parse(written[0].metadata))
        .toEqual({ old_status: 2, new_status: 0, rows_updated: 1 });
    });

    it('place update names the place and the type it was given', async () => {
      await controller.placesUpdate(
        spoofingRequest({ id: PLACE_ID, name: 'A Place', type: 'club', description: 'd' }),
        mockResponse(),
      );
      expect(written[0].target_type).toBe('place');
      expect(written[0].target_id).toBe(PLACE_ID);
      expect(JSON.parse(written[0].metadata))
        .toEqual({ rows_updated: 1, place_type: 'club' });
    });

    it('object update names the object and the asset it now points at', async () => {
      await controller.objectssUpdate(
        spoofingRequest({
          id: OBJECT_ID, name: 'A Thing', directory: 'furniture', filename: 'thing.wrl',
          thumbnail: 'thing.gif', price: 50, limit: 0, quantity: 3, status: 1,
        }),
        mockResponse(),
      );
      expect(written[0].target_type).toBe('object');
      expect(written[0].target_id).toBe(OBJECT_ID);
      expect(JSON.parse(written[0].metadata)).toEqual({
        rows_updated: 1,
        object_status: 1,
        price: 50,
        directory: 'furniture',
        filename: 'thing.wrl',
      });
    });
  });

  // ------------------------------------------------------------- what a row may not claim

  describe('an allowed row never claims a change the database did not make', () => {
    it('records zero rows updated when the avatar id named nothing', async () => {
      jest.spyOn(asSpyTarget(Container.get(AvatarRepository)), 'findById')
        .mockImplementation(async () => undefined);
      jest.spyOn(asSpyTarget(Container.get(AvatarRepository)), 'updateStatus')
        .mockImplementation(async () => 0);

      const response = mockResponse();
      await controller.avatarApprove(spoofingRequest({ id: AVATAR_ID }), response);

      // The route's answer is unchanged -- it has always accepted a raw id and answered
      // 200 -- but the row says plainly that nothing moved.
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(written[0].metadata))
        .toMatchObject({ old_status: null, rows_updated: 0 });
    });

    it('records zero rows updated when the place id named nothing', async () => {
      jest.spyOn(asSpyTarget(Container.get(PlaceRepository)), 'updatePlaces')
        .mockImplementation(async () => 0);

      await controller.placesUpdate(
        spoofingRequest({ id: PLACE_ID, name: 'A Place', type: 'club', description: 'd' }),
        mockResponse(),
      );
      expect(JSON.parse(written[0].metadata).rows_updated).toBe(0);
    });

    it('records zero rows updated when the object id named nothing', async () => {
      jest.spyOn(asSpyTarget(Container.get(ObjectRepository)), 'update')
        .mockImplementation(async () => 0);

      await controller.objectssUpdate(
        spoofingRequest({
          id: OBJECT_ID, name: 'A Thing', directory: 'furniture', filename: 'thing.wrl',
          thumbnail: 'thing.gif', price: 50, limit: 0, quantity: 3, status: 1,
        }),
        mockResponse(),
      );
      expect(JSON.parse(written[0].metadata).rows_updated).toBe(0);
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

    it.each(CASES)(
      '$name unwinds and refuses when the event cannot be written',
      async ({ failureStatus, run }) => {
        const response = mockResponse();
        await run(controller, response);

        expect(rolledBack).toBe(true);
        expect(response.statusCode).toBe(failureStatus);
        expect(written.some(row => row.result === 'allowed')).toBe(false);
      },
    );

    it.each(CASES)('$name records the attempt as failed, never as allowed', async ({
      event, run,
    }) => {
      await run(controller, mockResponse());
      expect(written).toHaveLength(1);
      expect(written[0].result).toBe('failed');
      expect(written[0].event).toBe(event);
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      // A failure has no transaction to join: its own has already rolled back.
      expect(writtenTrx[0]).toBeUndefined();
    });
  });

  describe('a failed business mutation leaves no false success', () => {
    it.each(CASES)('$name writes no allowed event when its write throws', async ({
      repository, method, event, failureStatus, run,
    }) => {
      jest.spyOn(asSpyTarget(Container.get(repository as never)), method)
        .mockImplementation(async () => { throw new Error('database unavailable'); });
      const response = mockResponse();

      await run(controller, response);

      expect(rolledBack).toBe(true);
      expect(response.statusCode).toBe(failureStatus);
      expect(written.some(row => row.result === 'allowed')).toBe(false);
      expect(written.map(row => row.result)).toEqual(['failed']);
      expect(written[0].event).toBe(event);
    });
  });

  // --------------------------------------------------------------------- actor authority

  describe('actor authority', () => {
    it.each(CASES)('$name ignores a client-supplied actor', async ({ run }) => {
      await run(controller, mockResponse());
      expect(written).toHaveLength(1);
      expect(written[0].actor_member_id).toBe(ACTOR_ID);
      expect(written[0].actor_member_id).not.toBe(SPOOFED_ID);
      // Not smuggled in as a target or a metadata field either.
      expect(JSON.stringify(written[0])).not.toContain(String(SPOOFED_ID));
    });

    it.each(CASES)('$name records the global role that granted it', async ({ run }) => {
      await run(controller, mockResponse());
      expect(written[0].authority).toBe('global-role');
    });

    it('role hire records the scoped right when a security-role manager granted it', async () => {
      // Baseline section 4 keeps the two grant paths apart, exactly as `fireRole` does.
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
      jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(true as never);
      jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(true as never);

      const response = mockResponse();
      await controller.hireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID }), response,
      );

      expect(response.statusCode).toBe(200);
      expect(written[0].authority).toBe('resource-scoped-right');
    });

    it('role hire still refuses a security-role manager who may not manage this role', async () => {
      jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['security'] as never);
      jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(true as never);
      jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(false as never);
      const response = mockResponse();

      await controller.hireRole(
        spoofingRequest({ member_id: TARGET_MEMBER_ID, role_id: ROLE_ID }), response,
      );

      expect(response.statusCode).toBe(403);
      expect(written[0].result).toBe('denied');
      expect(businessWrites).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------ secret exclusion

  describe('secret exclusion', () => {
    const SECRETS = [
      'hunter2',
      'eyJhbGciOiJIUzI1NiJ9.spoofed.signature',
      'connect.sid=s%3Aspoofed',
      '$2b$10$notarealhash',
      'reset-token-abc',
      'the words of a private message',
    ];

    it.each(CASES)('$name writes no credential and no message content', async ({ run }) => {
      await run(controller, mockResponse());
      const serialised = JSON.stringify(written);
      for (const secret of SECRETS) {
        expect(serialised).not.toContain(secret);
      }
    });

    it.each(CASES)('$name stores only named scalar facts, never the body', async ({ run }) => {
      await run(controller, mockResponse());
      const metadata = JSON.parse(written[0].metadata ?? '{}');
      expect(Object.keys(metadata).length).toBeLessThanOrEqual(6);
      for (const value of Object.values(metadata)) {
        expect(['string', 'number', 'boolean', 'object']).toContain(typeof value);
        if (typeof value === 'object') expect(value).toBeNull();
      }
    });
  });

  // ---------------------------------------------------- the routes still accept raw ids

  describe('a malformed request is answered, not crashed', () => {
    it('avatar approve answers 400 when the body carries no id', async () => {
      const response = mockResponse();
      await controller.avatarApprove(spoofingRequest({}), response);

      expect(response.statusCode).toBe(400);
      // The target is unusable, so the row says "no usable target" rather than inventing one.
      expect(written.map(row => row.result)).toEqual(['failed']);
      expect(written[0].target_id).toBeNull();
      expect(businessWrites).toHaveLength(0);
    });

    it('avatar reject answers 400 when the body carries no id', async () => {
      const response = mockResponse();
      await controller.avatarReject(spoofingRequest({}), response);

      expect(response.statusCode).toBe(400);
      expect(written.map(row => row.result)).toEqual(['failed']);
      expect(businessWrites).toHaveLength(0);
    });
  });

  // ------------------------------------------------------- CTBL-0032 is not weakened here

  describe('CTBL-0032 asset identifiers still refuse before any write', () => {
    const BAD = [
      { directory: '../etc', filename: 'thing.wrl' },
      { directory: 'furniture', filename: '../../passwd' },
      { directory: 'furniture', filename: 'sub/dir.wrl' },
    ];

    it.each(BAD)('refuses directory $directory filename $filename', async identifiers => {
      const response = mockResponse();
      await controller.objectssUpdate(
        spoofingRequest({
          id: OBJECT_ID, name: 'A Thing', thumbnail: 'thing.gif',
          price: 50, limit: 0, quantity: 3, status: 1, ...identifiers,
        }),
        response,
      );

      expect(response.statusCode).toBe(400);
      expect(businessWrites).toHaveLength(0);
      expect(written).toHaveLength(0);
    });
  });
});
