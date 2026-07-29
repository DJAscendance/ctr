import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HomeController } from './home.controller';
import { MemberService } from '../services/member/member.service';
import { HomeService } from '../services/home/home.service';

/**
 * Coverage for the Home Information controller contract.
 *
 * The authorization property is structural rather than a check to assert on: the request
 * body carries ONLY the text, so there is no member id, home id or username in it for a
 * caller to substitute. These tests pin that shape down - if someone later adds an
 * ownership identifier to the body, "passes only the session id to the service" fails.
 *
 * Validation is server-side and independent of the SPA's textarea maxlength.
 */
describe('HomeController home information', () => {
  let memberService: jest.Mocked<MemberService>;
  let homeService: jest.Mocked<HomeService>;
  let controller: HomeController;

  const session = { id: 5 };

  beforeEach(() => {
    memberService = createSpyObj(MemberService);
    homeService = createSpyObj(HomeService);

    Container.reset();
    Container.set(MemberService, memberService);
    Container.set(HomeService, homeService);
    controller = new HomeController(memberService, homeService);
  });

  function mockResponse() {
    return {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      sendFile: jest.fn(),
    } as any;
  }

  describe('getHomeInformation', () => {
    it('returns the description for a valid place id', async () => {
      memberService.decryptSession.mockReturnValue(session as any);
      homeService.getHomeInformation.mockResolvedValue('Welcome!');

      const response = mockResponse();
      await controller.getHomeInformation({ params: { placeId: '42' } } as any, response);

      expect(homeService.getHomeInformation).toHaveBeenCalledWith(42);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ description: 'Welcome!' });
    });

    it('rejects a non-numeric place id without hitting the service', async () => {
      memberService.decryptSession.mockReturnValue(session as any);

      const response = mockResponse();
      await controller.getHomeInformation(
        { params: { placeId: '1 OR 1=1' } } as any,
        response,
      );

      expect(homeService.getHomeInformation).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
    });

    it('answers nothing when there is no session', async () => {
      // decryptSession answers the request itself when authentication fails.
      memberService.decryptSession.mockReturnValue(undefined as any);

      const response = mockResponse();
      await controller.getHomeInformation({ params: { placeId: '42' } } as any, response);

      expect(homeService.getHomeInformation).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
    });
  });

  describe('updateHomeInformation', () => {
    beforeEach(() => {
      memberService.decryptSession.mockReturnValue(session as any);
      homeService.updateHomeInformation.mockResolvedValue(undefined);
    });

    async function callUpdate(body: any) {
      const response = mockResponse();
      await controller.updateHomeInformation({ body } as any, response);
      return response;
    }

    it('updates using the session id only', async () => {
      const response = await callUpdate({ houseDescription: 'Hello there' });

      expect(homeService.updateHomeInformation).toHaveBeenCalledWith(5, 'Hello there');
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ status: 'success' });
    });

    it('ignores an ownership identifier smuggled into the body', async () => {
      // A caller adding memberId/placeId/username must not be able to redirect the write.
      await callUpdate({
        houseDescription: 'Hijacked',
        memberId: 999,
        placeId: 999,
        username: 'someone-else',
      });

      expect(homeService.updateHomeInformation).toHaveBeenCalledWith(5, 'Hijacked');
      expect(homeService.updateHomeInformation).toHaveBeenCalledTimes(1);
    });

    it('rejects an unauthenticated caller without writing', async () => {
      memberService.decryptSession.mockReturnValue(undefined as any);

      const response = await callUpdate({ houseDescription: 'text' });

      expect(homeService.updateHomeInformation).not.toHaveBeenCalled();
      expect(response.status).not.toHaveBeenCalled();
    });

    it('propagates the no-home rejection as a 400', async () => {
      homeService.updateHomeInformation.mockRejectedValue(
        new Error('You don\'t have a home yet.'),
      );

      const response = await callUpdate({ houseDescription: 'text' });

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'You don\'t have a home yet.',
      });
    });

    it('accepts an empty description', async () => {
      const response = await callUpdate({ houseDescription: '' });

      expect(homeService.updateHomeInformation).toHaveBeenCalledWith(5, '');
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('accepts an omitted description as empty', async () => {
      const response = await callUpdate({});

      expect(homeService.updateHomeInformation).toHaveBeenCalledWith(5, '');
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('accepts a description exactly at the maximum length', async () => {
      const atLimit = 'x'.repeat(HomeService.INFORMATION_MAX_LENGTH);

      const response = await callUpdate({ houseDescription: atLimit });

      expect(homeService.updateHomeInformation).toHaveBeenCalledWith(5, atLimit);
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('rejects a description one character over the maximum length', async () => {
      const overLimit = 'x'.repeat(HomeService.INFORMATION_MAX_LENGTH + 1);

      const response = await callUpdate({ houseDescription: overLimit });

      expect(homeService.updateHomeInformation).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json.mock.calls[0][0].error).toContain('3500 characters or fewer');
    });

    it('rejects a non-string description rather than passing it through', async () => {
      // An array would otherwise skip the length check (arrays have no .length in
      // characters) and reach .match()/the database as a non-string.
      for (const bad of [['a', 'b'], { text: 'x' }, 42, true]) {
        homeService.updateHomeInformation.mockClear();
        const response = await callUpdate({ houseDescription: bad });

        expect(homeService.updateHomeInformation).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalledWith({ error: 'Description must be text.' });
      }
    });

    it('rejects banned language', async () => {
      const response = await callUpdate({ houseDescription: 'you are a shit' });

      expect(homeService.updateHomeInformation).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'This language can not be used on CTR!',
      });
    });

    it('stores markup verbatim - escaping is the renderer\'s job', async () => {
      // Information.vue renders through Vue text interpolation (never v-html), so the
      // stored text is displayed literally. The server must therefore neither execute nor
      // mangle it; the rendering test lives in spa/tests/information-render.test.ts.
      const payload = '<script>alert(1)</script>';

      const response = await callUpdate({ houseDescription: payload });

      expect(homeService.updateHomeInformation).toHaveBeenCalledWith(5, payload);
      expect(response.status).toHaveBeenCalledWith(200);
    });
  });
});
