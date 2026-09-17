import { Request, Response } from 'express';
import { createSpyObj } from 'jest-createspyobj';

// See admin.controller.authorization.spec.ts - importing a controller reaches the services
// barrel, which builds every repository against a real connection.
jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { HomeService, JailService, MemberService, MessageService } from '../services';
import { MessageController } from './message.controller';

type MockResponse = jest.Mocked<Response>;

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

const JAIL_PLACE_ID = 77;
const OTHER_PLACE_ID = 100;
const EVER_JAILED = [11, 15];

const INMATE = { id: 11, username: 'jailqa-inmate' };
const VISITOR = { id: 12, username: 'jailqa-visitor' };
const STAFF = { id: 13, username: 'jailqa-guard' };

function readRequest(placeId: number, token?: string): Request {
  return {
    params: { placeId: String(placeId) },
    query: { limit: '10', order: 'id', orderDirection: 'desc' },
    headers: token ? { apitoken: token } : {},
  } as unknown as Request;
}

function writeRequest(placeId: number, body: string): Request {
  return {
    params: { placeId: String(placeId) },
    body: { body },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

/**
 * The Jail's chat privacy, at the HTTP boundary.
 *
 * Two independent rules are proved here, and the pair is what makes the guarantee hold:
 * inmate speech is never written down, and Jail history that WAS written down before that
 * rule existed is never handed to an ordinary visitor.
 */
describe('MessageController - Jail chat privacy', () => {
  let memberService: jest.Mocked<MemberService>;
  let messageService: jest.Mocked<MessageService>;
  let homeService: jest.Mocked<HomeService>;
  let jailService: jest.Mocked<JailService>;
  let controller: MessageController;

  beforeEach(() => {
    memberService = createSpyObj(MemberService);
    messageService = createSpyObj(MessageService);
    homeService = createSpyObj(HomeService);
    jailService = createSpyObj(JailService);
    controller = new MessageController(memberService, messageService, homeService, jailService);

    jailService.isJailPlace.mockImplementation(
      async (placeId: number) => placeId === JAIL_PLACE_ID,
    );
    jailService.isInmate.mockResolvedValue(false as never);
    jailService.getStanding.mockResolvedValue(
      { inmate: false, staff: false, jailPlaceId: JAIL_PLACE_ID } as never,
    );
    jailService.findEverJailedMemberIds.mockResolvedValue(EVER_JAILED as never);
    messageService.getResults.mockResolvedValue([] as never);
    messageService.create.mockResolvedValue(1 as never);
    homeService.getChatAccessStatusByPlaceId.mockResolvedValue(
      { restricted: false, allowedUsernames: [] } as never,
    );
    memberService.decodeMemberToken.mockReturnValue(
      { id: VISITOR.id, username: VISITOR.username } as never,
    );
  });

  describe('the write path', () => {
    it('does not store an inmate message spoken in the Jail', async () => {
      memberService.decodeMemberToken.mockReturnValue({ id: INMATE.id } as never);
      jailService.isInmate.mockResolvedValue(true as never);
      const response = mockResponse();

      await controller.addMessage(writeRequest(JAIL_PLACE_ID, 'a private word'), response);

      expect(messageService.create).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ messageId: null });
    });

    it('still stores an ordinary visitor speaking in the Jail', async () => {
      const response = mockResponse();
      await controller.addMessage(writeRequest(JAIL_PLACE_ID, 'hello in there'), response);
      expect(messageService.create).toHaveBeenCalledWith(
        VISITOR.id, JAIL_PLACE_ID, 'hello in there', 1,
      );
    });

    it('still stores an inmate speaking somewhere that is not the Jail', async () => {
      // Belt and braces: an inmate cannot reach another room, but if that ever changes the
      // privacy rule must stay attached to the Jail rather than following the person.
      memberService.decodeMemberToken.mockReturnValue({ id: INMATE.id } as never);
      jailService.isInmate.mockResolvedValue(true as never);
      const response = mockResponse();

      await controller.addMessage(writeRequest(OTHER_PLACE_ID, 'elsewhere'), response);

      expect(messageService.create).toHaveBeenCalledWith(
        INMATE.id, OTHER_PLACE_ID, 'elsewhere', 1,
      );
    });
  });

  describe('the read path', () => {
    const exclusionsFor = () => messageService.getResults.mock.calls[0][4];

    it('withholds ever-jailed authors from an ordinary visitor', async () => {
      await controller.getResults(readRequest(JAIL_PLACE_ID, 'token'), mockResponse());
      expect(exclusionsFor()).toEqual(EVER_JAILED);
    });

    it('withholds them from an unauthenticated caller too', async () => {
      await controller.getResults(readRequest(JAIL_PLACE_ID), mockResponse());
      expect(exclusionsFor()).toEqual(EVER_JAILED);
      expect(memberService.decodeMemberToken).not.toHaveBeenCalled();
    });

    it('withholds them from a caller whose token cannot be read', async () => {
      memberService.decodeMemberToken.mockReturnValue(null as never);
      await controller.getResults(readRequest(JAIL_PLACE_ID, 'forged'), mockResponse());
      expect(exclusionsFor()).toEqual(EVER_JAILED);
    });

    it('gives Jail staff the unfiltered history', async () => {
      memberService.decodeMemberToken.mockReturnValue({ id: STAFF.id } as never);
      jailService.getStanding.mockResolvedValue(
        { inmate: false, staff: true, jailPlaceId: JAIL_PLACE_ID } as never,
      );
      await controller.getResults(readRequest(JAIL_PLACE_ID, 'token'), mockResponse());
      expect(exclusionsFor()).toEqual([]);
    });

    it('gives an inmate the unfiltered history', async () => {
      memberService.decodeMemberToken.mockReturnValue({ id: INMATE.id } as never);
      jailService.getStanding.mockResolvedValue(
        { inmate: true, staff: false, jailPlaceId: JAIL_PLACE_ID } as never,
      );
      await controller.getResults(readRequest(JAIL_PLACE_ID, 'token'), mockResponse());
      expect(exclusionsFor()).toEqual([]);
    });

    it('does not filter, or even look up bans, in any other place', async () => {
      await controller.getResults(readRequest(OTHER_PLACE_ID, 'token'), mockResponse());
      expect(exclusionsFor()).toEqual([]);
      expect(jailService.findEverJailedMemberIds).not.toHaveBeenCalled();
    });

    it('ignores a username or member id supplied by the caller', async () => {
      // Standing comes from the token's own id. Anything else in the request is ignored.
      const request = readRequest(JAIL_PLACE_ID, 'token');
      (request as any).query.memberId = String(STAFF.id);
      (request as any).query.username = STAFF.username;
      (request as any).headers.role = 'Security Chief';

      await controller.getResults(request, mockResponse());

      expect(jailService.getStanding).toHaveBeenCalledWith(VISITOR.id);
      expect(exclusionsFor()).toEqual(EVER_JAILED);
    });
  });
});
