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
    );

    services = {
      adminService: adminService as unknown as Record<string, jest.Mock>,
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
});
