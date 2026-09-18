import { Request, Response } from 'express';
import { createSpyObj } from 'jest-createspyobj';

// Importing a controller pulls in the services barrel, which instantiates every
// repository - and RoleRepository queries on construction. Without this the spec
// would try to open a real MySQL connection.
jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { AdminController } from './admin.controller';
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

/**
 * A response double, typed as an Express `Response` so the real handlers accept it
 * and intersected with the jest mocks the assertions read back.
 */
type MockResponse = jest.Mocked<Response>;

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  response.send = jest.fn().mockReturnValue(response);
  return response;
}

/** A request double carrying every field the guarded handlers read before their gate. */
function mockRequest(): Request {
  return {
    params: { id: '1' },
    query: {
      ban_member_id: '1',
      search: 'x',
      limit: '10',
      offset: '0',
      type: 'club',
      user: '1',
      compare: '=',
      id: '1',
    },
    body: { name: 'A Place', slug: 'a-place', type: 'club' },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

/**
 * The authorization contract for every admin endpoint that reads
 * `MemberService.getAccessLevel()`.
 *
 * `allow` lists the capability tags that must reach the endpoint's work and
 * `deny` the staff capabilities that must not - so a member who holds *a* role
 * is not thereby granted every other role's data. Each rule mirrors the admin
 * UI; the mapping is documented on `AdminController` itself.
 *
 * Note that the pairing is not as narrow as it looks in practice: the Admin role
 * is a member of `canAdmin`'s and `canLeader`'s role sets, so a real Admin
 * resolves to `['admin', 'security', 'leader']`. A bare `['admin']` is a
 * synthetic vector, and denying it is what keeps, say, the Mall-object admin
 * screens from also opening private chat logs.
 *
 * `service`/`method` name the collaborator the handler calls once past its gate,
 * so a denial is asserted as "the work never happened", not merely as a status.
 */
const STAFF = ['admin', 'security', 'leader', 'live-event'];

const GUARDED = [
  {
    name: 'getBanHistory', service: 'adminService', method: 'getBanHistory',
    allow: ['admin', 'security', 'leader'],
  },
  {
    name: 'searchUsers', service: 'adminService', method: 'searchUsers',
    allow: ['admin', 'security', 'leader'],
  },
  {
    name: 'getTransactions', service: 'adminService', method: 'getTransactions',
    allow: ['security'],
  },
  {
    name: 'getTransactionsByWalletId', service: 'adminService',
    method: 'getTransactionsByWalletId', allow: ['security'],
  },
  {
    name: 'searchUserChat', service: 'adminService', method: 'searchUserChat',
    allow: ['security'],
  },
  {
    name: 'places', service: 'adminService', method: 'searchPlaces',
    allow: ['admin', 'security', 'leader'],
  },
  {
    name: 'searchAllPlaces', service: 'placeService', method: 'searchAllPlaces',
    allow: ['admin', 'security', 'leader'],
  },
  {
    name: 'findUserPlaces', service: 'placeService', method: 'findUserPlaces',
    allow: ['security'],
  },
  {
    name: 'getObjectInstances', service: 'objectInstanceService',
    method: 'findAllObjectInstances', allow: ['security'],
  },
  {
    name: 'getOwnedObjects', service: 'objectInstanceService',
    method: 'getOwnedObjects', allow: ['admin'],
  },
  {
    name: 'getCommunityData', service: 'adminService', method: 'getCommunityData',
    allow: ['security'],
  },
].map(endpoint => ({
  ...endpoint,
  deny: STAFF.filter(capability => !endpoint.allow.includes(capability)),
})) as ReadonlyArray<{
  name: string;
  service: string;
  method: string;
  allow: string[];
  deny: string[];
}>;

/**
 * A request double carrying every field the `canAdmin`-guarded and role-guarded
 * handlers read past their gate. Kept separate from `mockRequest()` so nothing
 * here can change what the existing `GUARDED` table sees.
 *
 * The object values are real ones, read from `spa/assets/object/`.
 */
function mockAdminRequest(): Request {
  return {
    params: { id: '1' },
    query: { status: '0', limit: '10', offset: '0', memberId: '1' },
    body: {
      ban_member_id: '1', time_frame: '1', type: 'chat', reason: 'spam',
      banId: '1', banReason: 'spam',
      member_id: '1', role_id: '5', place_id: null, level: '1',
      id: '1', name: 'An Object', directory: '1', filename: 'Cryo2000.wrl',
      thumbnail: '19.jpg', price: 10, limit: 0, quantity: 1, status: 1,
    },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

/** An access level that is not the `string[]` the gates are declared to receive. */
const MALFORMED_ACCESS_LEVEL = [
  ['an empty access level', []],
  ['a null access level', null],
  ['an undefined access level', undefined],
  ['a non-array access level', 'admin'],
] as ReadonlyArray<[string, unknown]>;

/** An authority result `canAdmin` can resolve to that must not open the gate. */
const FALSY_ADMIN = [
  ['a false authority result', false],
  ['a null authority result', null],
  ['an undefined authority result', undefined],
] as ReadonlyArray<[string, unknown]>;

/**
 * Handlers gated by `MemberService.canAdmin()`, which resolves a real boolean.
 *
 * `service`/`method` name the collaborator that does the protected work, so a
 * denial is asserted as "the work never happened", not merely as a status.
 * `removeAccount` is proved with mocks only - no test deletes an account.
 */
const CAN_ADMIN_GUARDED = [
  { name: 'addBan', service: 'adminService', method: 'addBan' },
  { name: 'deleteBan', service: 'adminService', method: 'deleteBan' },
  { name: 'avatars', service: 'adminService', method: 'searchAvatars' },
  { name: 'avatarApprove', service: 'avatarService', method: 'approve' },
  { name: 'avatarReject', service: 'avatarService', method: 'reject' },
  { name: 'objectssUpdate', service: 'adminService', method: 'updateObjects' },
  { name: 'removeAccount', service: 'memberService', method: 'removeAccount' },
] as ReadonlyArray<{ name: string; service: string; method: string }>;

/**
 * The two role-granting handlers. Both accept either global admin authority or
 * the scoped security-role-manager path, exactly as `getRoleList` does. Who may
 * manage which role is unchanged by CTBL-0032; only the global check moved to
 * the fail-closed helper.
 */
const ROLE_GUARDED = [
  { name: 'hireRole', service: 'adminService', method: 'hireRole' },
  { name: 'fireRole', service: 'adminService', method: 'fireRole' },
] as ReadonlyArray<{ name: string; service: string; method: string }>;

/**
 * `addDonor` and `getDonor` compare a `string[]` to the string 'admin', so the
 * branch has never been true for any member at any authority level. They are
 * DEAD_CONFIRMED: deliberately not repaired and not enabled by CTBL-0032.
 *
 * This table is a regression guard, not a feature test. It fails if either
 * handler is ever quietly made reachable.
 */
const INERT = [
  { name: 'addDonor', service: 'adminService', method: 'addDonor' },
  { name: 'getDonor', service: 'adminService', method: 'getDonor' },
] as ReadonlyArray<{ name: string; service: string; method: string }>;

describe('AdminController authorization', () => {
  let adminService: jest.Mocked<AdminService>;
  let memberService: jest.Mocked<MemberService>;
  let avatarService: jest.Mocked<AvatarService>;
  let placeService: jest.Mocked<PlaceService>;
  let roleAssignmentService: jest.Mocked<RoleAssignmentService>;
  let objectInstanceService: jest.Mocked<ObjectInstanceService>;
  let objectService: jest.Mocked<ObjectService>;
  let messageService: jest.Mocked<MessageService>;
  let inboxService: jest.Mocked<InboxService>;
  let messageboardService: jest.Mocked<MessageboardService>;
  let clubService: jest.Mocked<ClubService>;
  let adminAuditService: jest.Mocked<AdminAuditService>;
  let controller: AdminController;
  let services: Record<string, Record<string, jest.Mock>>;

  beforeEach(() => {
    adminService = createSpyObj(AdminService);
    memberService = createSpyObj(MemberService);
    avatarService = createSpyObj(AvatarService);
    placeService = createSpyObj(PlaceService);
    roleAssignmentService = createSpyObj(RoleAssignmentService);
    objectInstanceService = createSpyObj(ObjectInstanceService);
    objectService = createSpyObj(ObjectService);
    messageService = createSpyObj(MessageService);
    inboxService = createSpyObj(InboxService);
    messageboardService = createSpyObj(MessageboardService);
    clubService = createSpyObj(ClubService);
    // A spy, not the real service: this spec is about the gate, and a real audit write
    // would reach for a database. That the refusals ARE recorded is proved separately, in
    // admin.controller.audit.spec.ts.
    adminAuditService = createSpyObj(AdminAuditService);
    controller = new AdminController(
      adminService,
      memberService,
      avatarService,
      placeService,
      roleAssignmentService,
      objectInstanceService,
      objectService,
      messageService,
      inboxService,
      messageboardService,
      clubService,
      adminAuditService,
    );

    services = {
      adminService: adminService as unknown as Record<string, jest.Mock>,
      avatarService: avatarService as unknown as Record<string, jest.Mock>,
      memberService: memberService as unknown as Record<string, jest.Mock>,
      placeService: placeService as unknown as Record<string, jest.Mock>,
      objectInstanceService:
        objectInstanceService as unknown as Record<string, jest.Mock>,
    };

    memberService.decryptSession.mockReturnValue({ id: 7 } as never);
    memberService.canManageSecurityRoles.mockResolvedValue(false);
    // Enough of a result for the handlers that iterate their service's return value.
    adminService.getRoleList.mockResolvedValue([] as never);
    adminService.getTransactions.mockResolvedValue([] as never);
    adminService.getTransactionsByWalletId.mockResolvedValue([] as never);
    objectInstanceService.findAllObjectInstances.mockResolvedValue([] as never);
    memberService.find.mockResolvedValue({ id: 1, username: 'someone' } as never);
    memberService.getMemberInfoPublic
      .mockResolvedValue({ id: 1, username: 'someone' } as never);
    memberService.canAdmin.mockResolvedValue(true as never);
    memberService.canSecurityManageRole.mockResolvedValue(false as never);
    adminService.searchAvatars.mockResolvedValue([] as never);
    placeService.getOwnedPlaces.mockResolvedValue([] as never);
    // `removeAccount` runs its whole sequence inside one transaction, so the double has to
    // actually run the callback - otherwise the protected work could never happen and the
    // allow case would look identical to a denial.
    memberService.runInTransaction
      .mockImplementation(work => (work as (trx: never) => Promise<unknown>)(null as never));
    memberService.lockForRemoval.mockResolvedValue({ id: 1 } as never);
  });

  describe.each(GUARDED)('$name', ({ name, service, method, allow, deny }) => {
    it.each(allow)('allows a member holding %s', async capability => {
      memberService.getAccessLevel.mockResolvedValue([capability]);
      const response = mockResponse();

      await controller[name](mockRequest(), response);

      expect(response.status).not.toHaveBeenCalledWith(403);
      expect(services[service][method]).toHaveBeenCalled();
    });

    it.each(deny)('denies a member holding only %s', async capability => {
      memberService.getAccessLevel.mockResolvedValue([capability]);
      const response = mockResponse();

      await controller[name](mockRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({ message: 'Access Denied' });
      expect(services[service][method]).not.toHaveBeenCalled();
    });

    // The array itself is the historical bypass: `[]` is truthy, so the original
    // `if (admin)` gate was unconditionally true. `null`/`undefined`/a non-array
    // cover the declared-but-not-guaranteed shape of `LegacyAccessLevel`; all of
    // them must deny rather than throw.
    it.each([
      ['an empty access level', []],
      ['a null access level', null],
      ['an undefined access level', undefined],
      ['a non-array access level', 'admin'],
    ])('denies %s', async (_label, accessLevel) => {
      memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
      const response = mockResponse();

      await controller[name](mockRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({ message: 'Access Denied' });
      expect(services[service][method]).not.toHaveBeenCalled();
    });

    it('denies a visitor with no session', async () => {
      // decryptSession answers the request itself and returns undefined.
      memberService.decryptSession.mockReturnValue(undefined as never);
      const response = mockResponse();

      await controller[name](mockRequest(), response);

      expect(memberService.getAccessLevel).not.toHaveBeenCalled();
      expect(services[service][method]).not.toHaveBeenCalled();
    });
  });

  /**
   * `getRoleList` feeds both the Roles screen (admin) and the HIRE/TERMINATE
   * pickers, which `user/SubMenu.vue` also shows to a security-role manager. Its
   * gate therefore mirrors `hireRole`/`fireRole`: admin, or a member whose own
   * role lets them manage security roles.
   */
  describe('getRoleList', () => {
    it('allows an admin', async () => {
      memberService.getAccessLevel.mockResolvedValue(['admin']);
      const response = mockResponse();

      await controller.getRoleList(mockRequest(), response);

      expect(response.status).not.toHaveBeenCalledWith(403);
      expect(adminService.getRoleList).toHaveBeenCalled();
    });

    it('allows a security-role manager who is not an admin', async () => {
      memberService.getAccessLevel.mockResolvedValue(['security']);
      memberService.canManageSecurityRoles.mockResolvedValue(true);
      const response = mockResponse();

      await controller.getRoleList(mockRequest(), response);

      expect(response.status).not.toHaveBeenCalledWith(403);
      expect(adminService.getRoleList).toHaveBeenCalled();
    });

    it.each(['security', 'leader', 'live-event'])(
      'denies a member holding only %s who cannot manage security roles',
      async capability => {
        memberService.getAccessLevel.mockResolvedValue([capability]);
        const response = mockResponse();

        await controller.getRoleList(mockRequest(), response);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(adminService.getRoleList).not.toHaveBeenCalled();
      });

    it.each([
      ['an empty access level', []],
      ['a null access level', null],
      ['an undefined access level', undefined],
      ['a non-array access level', 'admin'],
    ])('denies %s', async (_label, accessLevel) => {
      memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
      const response = mockResponse();

      await controller.getRoleList(mockRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(adminService.getRoleList).not.toHaveBeenCalled();
    });

    it('denies a visitor with no session', async () => {
      memberService.decryptSession.mockReturnValue(undefined as never);
      const response = mockResponse();

      await controller.getRoleList(mockRequest(), response);

      expect(memberService.getAccessLevel).not.toHaveBeenCalled();
      expect(adminService.getRoleList).not.toHaveBeenCalled();
    });
  });

  /**
   * `placesUpdate` writes, and guards the other way round (deny when the
   * capability is absent). It is checked separately because past its gate it runs
   * field validation rather than calling one collaborator. `place/search.vue`
   * offers the Edit action to admin and security only - not to leader, who can
   * see the Places screen but not change what is on it.
   */
  describe('placesUpdate', () => {
    it.each(['admin', 'security'])(
      'lets a member holding %s past the gate', async capability => {
        memberService.getAccessLevel.mockResolvedValue([capability]);
        const response = mockResponse();

        await controller.placesUpdate(mockRequest(), response);

        expect(response.status).not.toHaveBeenCalledWith(403);
      });

    it.each([
      ['only leader', ['leader']],
      ['only live-event', ['live-event']],
      ['no access level', []],
      ['a null access level', null],
      ['an undefined access level', undefined],
      ['a non-array access level', 'admin'],
    ])('denies a member with %s', async (_label, accessLevel) => {
      memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
      const response = mockResponse();

      await controller.placesUpdate(mockRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({ message: 'Access Denied' });
      expect(placeService.updatePlaces).not.toHaveBeenCalled();
    });

    it('denies a visitor with no session', async () => {
      memberService.decryptSession.mockReturnValue(undefined as never);
      const response = mockResponse();

      await controller.placesUpdate(mockRequest(), response);

      expect(memberService.getAccessLevel).not.toHaveBeenCalled();
      expect(placeService.updatePlaces).not.toHaveBeenCalled();
    });
  });
  /**
   * CTBL-0032, acceptance clause D1/D2: every `canAdmin`-gated handler denies
   * rather than errors, the denial is explicit, and the protected work never
   * runs. `canAdmin` returns `!!...`, so it always resolves a real boolean; the
   * falsy set below is what an unexpected authority result can actually be.
   */
  describe.each(CAN_ADMIN_GUARDED)('$name', ({ name, service, method }) => {
    it('allows an entitled administrator', async () => {
      memberService.canAdmin.mockResolvedValue(true as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(response.status).not.toHaveBeenCalledWith(403);
      expect(services[service][method]).toHaveBeenCalled();
    });

    it.each(FALSY_ADMIN)('denies %s', async (_label, admin) => {
      memberService.canAdmin.mockResolvedValue(admin as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.status).not.toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ message: 'Access Denied' });
      expect(services[service][method]).not.toHaveBeenCalled();
    });

    it('denies a visitor with no session', async () => {
      memberService.decryptSession.mockReturnValue(undefined as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(memberService.canAdmin).not.toHaveBeenCalled();
      expect(services[service][method]).not.toHaveBeenCalled();
    });
  });

  /**
   * CTBL-0032: `hireRole` and `fireRole` used `accessLevel.includes('admin')`,
   * which throws on a null, undefined or non-array access level - so the gate
   * produced a 500 instead of a refusal. They now use the same fail-closed
   * helper as every other gate. The scoped path is unchanged.
   */
  describe.each(ROLE_GUARDED)('$name', ({ name, service, method }) => {
    it('allows a global admin', async () => {
      memberService.getAccessLevel.mockResolvedValue(['admin']);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(response.status).not.toHaveBeenCalledWith(403);
      expect(services[service][method]).toHaveBeenCalled();
    });

    it('allows a security-role manager acting within their scope', async () => {
      memberService.getAccessLevel.mockResolvedValue(['security']);
      memberService.canManageSecurityRoles.mockResolvedValue(true as never);
      memberService.canSecurityManageRole.mockResolvedValue(true as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(response.status).not.toHaveBeenCalledWith(403);
      expect(services[service][method]).toHaveBeenCalled();
    });

    it('denies a security-role manager acting outside their scope', async () => {
      memberService.getAccessLevel.mockResolvedValue(['security']);
      memberService.canManageSecurityRoles.mockResolvedValue(true as never);
      memberService.canSecurityManageRole.mockResolvedValue(false as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(services[service][method]).not.toHaveBeenCalled();
    });

    it.each(['security', 'leader', 'live-event'])(
      'denies a member holding only %s', async capability => {
        memberService.getAccessLevel.mockResolvedValue([capability]);
        const response = mockResponse();

        await controller[name](mockAdminRequest(), response);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.json).toHaveBeenCalledWith({ error: 'Access Denied' });
        expect(services[service][method]).not.toHaveBeenCalled();
      });

    // The regression this item exists for: before the repair, `null.includes`
    // threw and the handler answered 500 rather than refusing.
    it.each(MALFORMED_ACCESS_LEVEL)('denies %s without erroring',
      async (_label, accessLevel) => {
        memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
        const response = mockResponse();

        await controller[name](mockAdminRequest(), response);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(response.status).not.toHaveBeenCalledWith(500);
        expect(response.json).toHaveBeenCalledWith({ error: 'Access Denied' });
        expect(services[service][method]).not.toHaveBeenCalled();
      });

    it('denies a visitor with no session', async () => {
      memberService.decryptSession.mockReturnValue(undefined as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(memberService.getAccessLevel).not.toHaveBeenCalled();
      expect(services[service][method]).not.toHaveBeenCalled();
    });
  });

  /**
   * DEAD_CONFIRMED regression guard. These handlers are NOT repaired by
   * CTBL-0032. Enabling donor administration is a separate backlog item; until
   * it is taken, the service branch must stay unreachable for every caller,
   * including a full administrator.
   */
  describe.each(INERT)('$name (DEAD_CONFIRMED)', ({ name, service, method }) => {
    it.each([
      ['a full administrator', ['admin', 'security', 'leader']],
      ['a bare admin capability', ['admin']],
      ['a security officer', ['security']],
    ])('stays unreachable for %s', async (_label, accessLevel) => {
      memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
      const response = mockResponse();

      await controller[name](mockAdminRequest(), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({ error: 'Access Denied' });
      expect(services[service][method]).not.toHaveBeenCalled();
    });
  });

  /**
   * CTBL-0032 prohibition 4: `objectssUpdate` takes a bounded asset identifier,
   * never a filesystem path. The rejection happens at the controller boundary -
   * before the service resolves a path and before any row is written - so the
   * assertion is both "400" and "the update never ran".
   *
   * `libs/asset-identifier.spec.ts` proves the grammar itself. This block proves
   * the controller actually applies it.
   */
  describe('objectssUpdate asset identifiers', () => {
    function requestWith(overrides: Record<string, unknown>): Request {
      const request = mockAdminRequest();
      Object.assign(request.body, overrides);
      return request;
    }

    beforeEach(() => {
      memberService.canAdmin.mockResolvedValue(true as never);
    });

    it('accepts a real directory and filename', async () => {
      const response = mockResponse();

      await controller.objectssUpdate(
        requestWith({ directory: '2', filename: '5000exp_inline.wrl' }), response);

      expect(response.status).toHaveBeenCalledWith(200);
      expect(adminService.updateObjects).toHaveBeenCalled();
    });

    it.each([
      ['a traversal directory', '../x'],
      ['a nested directory', 'a/b'],
      ['a backslash directory', 'a\\b'],
      ['an absolute directory', '/absolute'],
      ['a drive-path directory', 'C:\\path'],
      ['a URI directory', 'file://x'],
      ['an empty directory', ''],
      ['a whitespace directory', '   '],
      ['a dot directory', '.'],
      ['a dotfile directory', '.hidden'],
      ['a NUL directory', 'a\u0000b'],
      ['a non-string directory', 7],
      ['a null directory', null],
      ['an over-long directory', 'a'.repeat(65)],
    ])('rejects %s with 400 and never updates', async (_label, directory) => {
      const response = mockResponse();

      await controller.objectssUpdate(requestWith({ directory }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(adminService.updateObjects).not.toHaveBeenCalled();
    });

    it.each([
      ['a traversal filename', '../x'],
      ['a nested filename', 'a/b.wrl'],
      ['a backslash filename', 'a\\b.wrl'],
      ['an absolute filename', '/absolute.wrl'],
      ['a drive-path filename', 'C:\\file.wrl'],
      ['a URI filename', 'file://x.wrl'],
      ['an empty filename', ''],
      ['a whitespace filename', '   '],
      ['a dotfile filename', '.hidden'],
      ['a NUL filename', 'a\u0000b.wrl'],
      ['a non-string filename', 7],
      ['a null filename', null],
      ['an over-long filename', 'a'.repeat(129)],
    ])('rejects %s with 400 and never updates', async (_label, filename) => {
      const response = mockResponse();

      await controller.objectssUpdate(requestWith({ filename }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(adminService.updateObjects).not.toHaveBeenCalled();
    });

    it('rejects before the authorization gate is bypassed', async () => {
      memberService.canAdmin.mockResolvedValue(false as never);
      const response = mockResponse();

      await controller.objectssUpdate(requestWith({ directory: '../x' }), response);

      expect(response.status).toHaveBeenCalledWith(403);
      expect(adminService.updateObjects).not.toHaveBeenCalled();
    });
  });
});
