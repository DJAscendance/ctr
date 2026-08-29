import { Request, Response } from 'express';
import { createSpyObj } from 'jest-createspyobj';

// See admin.controller.authorization.spec.ts - importing a controller reaches the
// services barrel, which builds every repository against a real connection.
jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { PlaceController } from './place.controller';
import { HomeService, MemberService, PlaceService } from '../services';

type MockResponse = jest.Mocked<Response>;

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

const PLACE_ID = 42;

/** A behaviour row shaped like the ones `place.service.addVirtualPet` seeds. */
function behaviour(input: string, output: string, id = 0): unknown {
  return { id, match: 'exact', directly: false, whisper: false, beam: false, input, output };
}

function mockRequest(behaviours: unknown, overrides: Record<string, unknown> = {}): Request {
  return {
    params: { place_id: String(PLACE_ID) },
    body: {
      name: 'Rex',
      avatar: '/assets/pets/dog/dog.wrl',
      active: true,
      voice: 0,
      behaviours: JSON.stringify(behaviours),
      ...overrides,
    },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

/**
 * `updateVirtualPet` used to run validation, the authorization test, the write and
 * the response all inside its behaviour loop, so the number of writes and the
 * number of responses tracked the number of behaviours rather than the number of
 * requests. Every case here asserts both counts explicitly.
 */
describe('PlaceController.updateVirtualPet', () => {
  let placeService: jest.Mocked<PlaceService>;
  let memberService: jest.Mocked<MemberService>;
  let homeService: jest.Mocked<HomeService>;
  let controller: PlaceController;

  beforeEach(() => {
    placeService = createSpyObj(PlaceService);
    memberService = createSpyObj(MemberService);
    homeService = createSpyObj(HomeService);
    controller = new PlaceController(placeService, memberService, homeService);

    memberService.decryptSession.mockReturnValue({ id: 7 } as never);
    // The default actor is the home's owner and holds no staff capability.
    memberService.getAccessLevel.mockResolvedValue([]);
    homeService.getHome.mockResolvedValue({ id: PLACE_ID } as never);
    placeService.updateVirtualPet.mockResolvedValue(undefined as never);
  });

  describe('behaviour handling', () => {
    it('writes and answers exactly once for an empty behaviour list', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([]), response);

      expect(placeService.updateVirtualPet).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith({ success: 'success' });
    });

    it('writes and answers exactly once for one valid behaviour', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(
        mockRequest([behaviour('hello', 'woof')]), response);

      expect(placeService.updateVirtualPet).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith({ success: 'success' });
    });

    it('writes and answers exactly once for several valid behaviours', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([
        behaviour('hello', 'woof', 0),
        behaviour('sit', 'sits down', 1),
        behaviour('fetch', 'fetches', 2),
      ]), response);

      expect(placeService.updateVirtualPet).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith({ success: 'success' });
    });

    it('persists the behaviours exactly as sent', async () => {
      const behaviours = [behaviour('hello', 'woof')];
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest(behaviours), response);

      expect(placeService.updateVirtualPet).toHaveBeenCalledWith(
        PLACE_ID, 'Rex', '/assets/pets/dog/dog.wrl', true, 0, JSON.stringify(behaviours));
    });
  });

  describe('banned words', () => {
    const bannedError = { error: 'Pet input/output cannot contain a banned word.' };

    it('rejects the whole request when a later behaviour is banned', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([
        behaviour('hello', 'woof', 0),
        behaviour('ass', 'nope', 1),
      ]), response);

      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith(bannedError);
    });

    it('rejects the whole request when an earlier behaviour is banned', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([
        behaviour('ass', 'nope', 0),
        behaviour('hello', 'woof', 1),
      ]), response);

      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith(bannedError);
    });

    it('rejects a banned output as well as a banned input', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(
        mockRequest([behaviour('hello', 'ass')]), response);

      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledWith(bannedError);
    });

    it('rejects a banned pet name without writing', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(
        mockRequest([behaviour('hello', 'woof')], { name: 'ass' }), response);

      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith(
        { error: 'Pet name cannot contain a banned word.' });
    });
  });

  describe('malformed input', () => {
    it('answers 400 for behaviours that are not JSON, without throwing', async () => {
      const response = mockResponse();
      const request = mockRequest([], { behaviours: '{not json' });

      await expect(controller.updateVirtualPet(request, response)).resolves.toBeUndefined();

      expect(response.status).toHaveBeenCalledWith(400);
      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledTimes(1);
    });

    it('answers 400 for behaviours that are valid JSON but not a list', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest({ input: 'hello' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
    });

    it.each(['name', 'avatar', 'voice', 'behaviours'])(
      'answers 400 when %s is missing', async field => {
        const response = mockResponse();

        await controller.updateVirtualPet(
          mockRequest([], { [field]: undefined }), response);

        expect(response.status).toHaveBeenCalledWith(400);
        expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      });
  });

  describe('authorization', () => {
    it('allows the home owner holding no staff capability', async () => {
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([]), response);

      expect(placeService.updateVirtualPet).toHaveBeenCalledTimes(1);
    });

    it('allows a security member who does not own the home', async () => {
      memberService.getAccessLevel.mockResolvedValue(['security']);
      homeService.getHome.mockResolvedValue({ id: PLACE_ID + 1 } as never);
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([]), response);

      expect(placeService.updateVirtualPet).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no capability', []],
      ['only admin', ['admin']],
      ['only leader', ['leader']],
      ['a null access level', null],
      ['an undefined access level', undefined],
      ['a non-array access level', 'security'],
    ])('denies a non-owner with %s', async (_label, accessLevel) => {
      memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
      homeService.getHome.mockResolvedValue({ id: PLACE_ID + 1 } as never);
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([]), response);

      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith(
        { error: 'You do not have access to update this.' });
    });

    it('denies a member who has not settled a home, without throwing', async () => {
      // findHomeByMemberId resolves to undefined for a member with no home.
      homeService.getHome.mockResolvedValue(undefined as never);
      const response = mockResponse();

      await expect(controller.updateVirtualPet(mockRequest([]), response))
        .resolves.toBeUndefined();

      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(response.json).toHaveBeenCalledWith(
        { error: 'You do not have access to update this.' });
    });

    it('does no work for a visitor with no session', async () => {
      memberService.decryptSession.mockReturnValue(undefined as never);
      const response = mockResponse();

      await controller.updateVirtualPet(mockRequest([]), response);

      expect(memberService.getAccessLevel).not.toHaveBeenCalled();
      expect(placeService.updateVirtualPet).not.toHaveBeenCalled();
    });
  });
});
