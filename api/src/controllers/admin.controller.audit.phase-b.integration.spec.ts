import { Request, Response } from 'express';
import { Container } from 'typedi';

import { cleanUpFixtures, createMember, describeWithDb, fixtureName } from '@spec/integration-db';
import { Db } from '../db/db.class';
import {
  AdminAuditEventRepository,
  AvatarRepository,
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
 * CTBL-0025 Phase B atomicity, against a real MySQL.
 *
 * `admin.controller.audit.phase-b.spec.ts` proves the SHAPE of the five repaired events
 * with mocks, and that no 200 leaves before the write resolves. It cannot prove that an
 * audit insert and a business write actually commit as one unit, because that is a
 * property of the database and not of the call order -- a mocked transaction rolls back
 * because the test says so.
 *
 * This spec asks the database instead, once per repaired action, in both directions:
 *
 *   1. The mutation and its `allowed` event are visible together.
 *   2. An audit insert that fails takes the mutation with it -- nothing half-done, and no
 *      change nobody logged.
 *
 * Skipped, loudly, unless CTR_INTEGRATION_TEST_DB names the configured schema: these tests
 * write and delete rows and must never be able to do so against a shared database.
 */

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

/** Breaks the atomic audit write only; the fail-soft denial path must keep working. */
function breakAtomicAudit(): void {
  jest.spyOn(asSpyTarget(Container.get(AdminAuditEventRepository)), 'insert')
    .mockImplementation(async (_row: unknown, trx: unknown) => {
      if (trx) throw new Error('audit store unavailable');
    });
}

describeWithDb('CTBL-0025 Phase B atomicity against a real database', () => {
  const knex = Container.get(Db).knex;
  let controller: AdminController;
  let memberService: MemberService;
  let actorId: number;
  let targetId: number;
  let roleId: number;
  let avatarId: number;
  let placeId: number;
  let objectId: number;

  async function auditRows(event?: string) {
    const query = knex('admin_audit_event')
      .select('*')
      .where('actor_member_id', actorId)
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
        .insert({ id: 1, name: fixtureName('avatar'), filename: 'ctbl25b.wrl', status: 1 });
    }
  });

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
      Container.get(AdminAuditService),
    );

    const actor = await createMember(knex);
    const target = await createMember(knex);
    actorId = actor.id;
    targetId = target.id;

    [roleId] = await knex('role').insert({ name: fixtureName('role') });
    [avatarId] = await knex('avatar').insert({
      name: fixtureName('avatar'),
      filename: 'pending.wrl',
      status: AvatarService.STATUS_PENDING,
    });
    [placeId] = await knex('place')
      .insert({ type: 'club', name: fixtureName('place'), status: 1 });
    [objectId] = await knex('object').insert({
      name: fixtureName('object'),
      directory: 'furniture',
      filename: 'before.wrl',
      image: 'before.gif',
      price: 10,
      status: 1,
    });

    // Authorization is proved in admin.controller.authorization.spec.ts; these tests are
    // about what the database does after the gate opens.
    jest.spyOn(memberService, 'decryptSession').mockReturnValue({ id: actorId } as never);
    jest.spyOn(memberService, 'canAdmin').mockResolvedValue(true as never);
    jest.spyOn(memberService, 'getAccessLevel').mockResolvedValue(['admin'] as never);
    jest.spyOn(memberService, 'canManageSecurityRoles').mockResolvedValue(false as never);
    jest.spyOn(memberService, 'canSecurityManageRole').mockResolvedValue(false as never);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await knex('admin_audit_event').where('actor_member_id', actorId).del();
    await knex('role_assignment').whereIn('member_id', [actorId, targetId]).del();
    await knex('object').where('id', objectId).del();
    await knex('avatar').where('id', avatarId).del();
    await knex('role').where('id', roleId).del();
    await cleanUpFixtures(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  // ------------------------------------------------------------------------- role hire

  it('commits the role assignment and its audit event together', async () => {
    const response = mockResponse();

    await controller.hireRole(
      // CTBL-0025 Phase C: a role change is refused without an operator reason.
      request({ member_id: targetId, role_id: roleId, reason: 'promoted' }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    const assignments = await knex('role_assignment')
      .select('*').where({ member_id: targetId, role_id: roleId });
    expect(assignments).toHaveLength(1);

    const events = await auditRows('admin.role.hire');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].authority).toBe('global-role');
    expect(events[0].actor_member_id).toBe(actorId);
    expect(events[0].target_id).toBe(roleId);
    expect(events[0].target_member_id).toBe(targetId);
    // Phase B recorded a NULL here and named it as the gap. Phase C closed it: the route
    // now refuses a role change with no operator reason, so a committed row always
    // carries the sentence the operator actually wrote.
    expect(events[0].reason).toBe('promoted');
    expect(JSON.parse(events[0].metadata).assignment_id).toBe(assignments[0].id);
  });

  it('rolls the role assignment back when its audit insert fails', async () => {
    breakAtomicAudit();
    const response = mockResponse();

    await controller.hireRole(
      // CTBL-0025 Phase C: a role change is refused without an operator reason.
      request({ member_id: targetId, role_id: roleId, reason: 'promoted' }),
      response as Response,
    );

    expect(response.statusCode).toBe(500);
    expect(await knex('role_assignment')
      .select('id').where({ member_id: targetId, role_id: roleId })).toHaveLength(0);
    expect(await auditRows()).toHaveLength(0);
  });

  it('writes no allowed event when the role assignment insert fails', async () => {
    jest.spyOn(asSpyTarget(Container.get(RoleAssignmentRepository)), 'addIdToAssignment')
      .mockImplementation(async () => { throw new Error('role_assignment unavailable'); });
    const response = mockResponse();

    await controller.hireRole(
      // CTBL-0025 Phase C: a role change is refused without an operator reason.
      request({ member_id: targetId, role_id: roleId, reason: 'promoted' }),
      response as Response,
    );

    expect(response.statusCode).toBe(500);
    expect(await knex('role_assignment')
      .select('id').where({ member_id: targetId, role_id: roleId })).toHaveLength(0);
    const events = await auditRows();
    expect(events.map((row: { result: string }) => row.result)).toEqual(['failed']);
  });

  // --------------------------------------------------------------------- avatar approve

  it('commits the avatar approval and its audit event together', async () => {
    const response = mockResponse();

    await controller.avatarApprove(request({ id: avatarId }), response as Response);

    expect(response.statusCode).toBe(200);
    const [avatar] = await knex('avatar').select('status').where('id', avatarId);
    expect(avatar.status).toBe(AvatarService.STATUS_ACTIVE);

    const events = await auditRows('admin.avatar.approve');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].target_type).toBe('avatar');
    expect(events[0].target_id).toBe(avatarId);
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      old_status: AvatarService.STATUS_PENDING,
      new_status: AvatarService.STATUS_ACTIVE,
      rows_updated: 1,
    });
  });

  it('rolls the avatar approval back when its audit insert fails', async () => {
    breakAtomicAudit();
    const response = mockResponse();

    await controller.avatarApprove(request({ id: avatarId }), response as Response);

    expect(response.statusCode).toBe(400);
    const [avatar] = await knex('avatar').select('status').where('id', avatarId);
    expect(avatar.status).toBe(AvatarService.STATUS_PENDING);
    expect(await auditRows()).toHaveLength(0);
  });

  // ---------------------------------------------------------------------- avatar reject

  it('commits the avatar rejection and its audit event together', async () => {
    const response = mockResponse();

    await controller.avatarReject(request({ id: avatarId }), response as Response);

    expect(response.statusCode).toBe(200);
    const [avatar] = await knex('avatar').select('status').where('id', avatarId);
    expect(avatar.status).toBe(AvatarService.STATUS_DELETED);

    const events = await auditRows('admin.avatar.reject');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    // The two decisions stay separate names, so a reviewer can query them apart.
    expect(await auditRows('admin.avatar.approve')).toHaveLength(0);
  });

  it('rolls the avatar rejection back when its audit insert fails', async () => {
    breakAtomicAudit();
    const response = mockResponse();

    await controller.avatarReject(request({ id: avatarId }), response as Response);

    expect(response.statusCode).toBe(400);
    const [avatar] = await knex('avatar').select('status').where('id', avatarId);
    expect(avatar.status).toBe(AvatarService.STATUS_PENDING);
    expect(await auditRows()).toHaveLength(0);
  });

  it('writes no allowed event when the avatar update fails', async () => {
    jest.spyOn(asSpyTarget(Container.get(AvatarRepository)), 'updateStatus')
      .mockImplementation(async () => { throw new Error('avatar table unavailable'); });
    const response = mockResponse();

    await controller.avatarApprove(request({ id: avatarId }), response as Response);

    expect(response.statusCode).toBe(400);
    const [avatar] = await knex('avatar').select('status').where('id', avatarId);
    expect(avatar.status).toBe(AvatarService.STATUS_PENDING);
    const events = await auditRows();
    expect(events.map((row: { result: string }) => row.result)).toEqual(['failed']);
  });

  // ----------------------------------------------------------------------- place update

  it('commits the place edit and its audit event together', async () => {
    const response = mockResponse();

    await controller.placesUpdate(
      request({
        id: placeId, name: fixtureName('place'), type: 'club', description: 'a description',
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    const [place] = await knex('place').select('description').where('id', placeId);
    expect(place.description).toBe('a description');

    const events = await auditRows('admin.place.update');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].target_id).toBe(placeId);
    expect(JSON.parse(events[0].metadata))
      .toMatchObject({ rows_updated: 1, place_type: 'club' });
  });

  it('rolls the place edit back when its audit insert fails', async () => {
    breakAtomicAudit();
    const response = mockResponse();

    await controller.placesUpdate(
      request({
        id: placeId, name: fixtureName('place'), type: 'club', description: 'rolled back',
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    const [place] = await knex('place').select('description').where('id', placeId);
    expect(place.description).toBeNull();
    expect(await auditRows()).toHaveLength(0);
  });

  it('writes no allowed event when the place update fails', async () => {
    jest.spyOn(asSpyTarget(Container.get(PlaceRepository)), 'updatePlaces')
      .mockImplementation(async () => { throw new Error('place table unavailable'); });
    const response = mockResponse();

    await controller.placesUpdate(
      request({
        id: placeId, name: fixtureName('place'), type: 'club', description: 'never written',
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    const [place] = await knex('place').select('description').where('id', placeId);
    expect(place.description).toBeNull();
    const events = await auditRows();
    expect(events.map((row: { result: string }) => row.result)).toEqual(['failed']);
  });

  // ---------------------------------------------------------------------- object update

  it('commits the object edit and its audit event together', async () => {
    const response = mockResponse();

    await controller.objectssUpdate(
      request({
        id: objectId, name: 'After', directory: 'furniture', filename: 'after.wrl',
        thumbnail: 'after.gif', price: 55, limit: 0, quantity: 3, status: 1,
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(200);
    const [object] = await knex('object').select('filename', 'price').where('id', objectId);
    expect(object.filename).toBe('after.wrl');

    const events = await auditRows('admin.object.update');
    expect(events).toHaveLength(1);
    expect(events[0].result).toBe('allowed');
    expect(events[0].target_id).toBe(objectId);
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      rows_updated: 1,
      directory: 'furniture',
      filename: 'after.wrl',
    });
  });

  it('rolls the object edit back when its audit insert fails', async () => {
    breakAtomicAudit();
    const response = mockResponse();

    await controller.objectssUpdate(
      request({
        id: objectId, name: 'After', directory: 'furniture', filename: 'after.wrl',
        thumbnail: 'after.gif', price: 55, limit: 0, quantity: 3, status: 1,
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    const [object] = await knex('object').select('filename').where('id', objectId);
    expect(object.filename).toBe('before.wrl');
    expect(await auditRows()).toHaveLength(0);
  });

  it('writes no allowed event when the object update fails', async () => {
    jest.spyOn(asSpyTarget(Container.get(ObjectRepository)), 'update')
      .mockImplementation(async () => { throw new Error('object table unavailable'); });
    const response = mockResponse();

    await controller.objectssUpdate(
      request({
        id: objectId, name: 'After', directory: 'furniture', filename: 'after.wrl',
        thumbnail: 'after.gif', price: 55, limit: 0, quantity: 3, status: 1,
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    const [object] = await knex('object').select('filename').where('id', objectId);
    expect(object.filename).toBe('before.wrl');
    const events = await auditRows();
    expect(events.map((row: { result: string }) => row.result)).toEqual(['failed']);
  });

  // --------------------------------------------------------- CTBL-0032 before any write

  it('refuses a path-shaped asset identifier before touching the object row', async () => {
    const response = mockResponse();

    await controller.objectssUpdate(
      request({
        id: objectId, name: 'After', directory: '../etc', filename: 'after.wrl',
        thumbnail: 'after.gif', price: 55, limit: 0, quantity: 3, status: 1,
      }),
      response as Response,
    );

    expect(response.statusCode).toBe(400);
    const [object] = await knex('object').select('filename').where('id', objectId);
    expect(object.filename).toBe('before.wrl');
    expect(await auditRows()).toHaveLength(0);
  });
});
