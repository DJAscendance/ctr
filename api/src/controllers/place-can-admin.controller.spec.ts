import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceController } from './place.controller';
import { PlaceService } from '../services/place/place.service';
import { MemberService } from '../services/member/member.service';
import { HomeService } from '../services/home/home.service';
import { PlaceInformationService } from '../services/place/place-information.service';

/**
 * Contract coverage for GET place canAdmin.
 *
 * The behaviours pinned here are the ones that were wrong or dangerous before:
 *  - an authentication problem answered 400, which tells a client "your request was
 *    malformed" when the correct signal is "re-authenticate";
 *  - the invalid-slug branch responded WITHOUT returning, so execution continued into
 *    findBySlug and a second response was attempted on the same request;
 *  - findBySlug ran outside the try, so a database failure there was an unhandled
 *    rejection rather than a 500, and an unknown slug threw on `place.id`;
 *  - the catch put the raw caught error in the body, which for a knex failure can carry
 *    SQL and connection details.
 *
 * Authorization itself is NOT under test here - PlaceService.canAdmin is mocked, because
 * this change must not alter who counts as an admin for any scope.
 */
describe('PlaceController canAdmin contract', () => {
  let placeService: jest.Mocked<PlaceService>;
  let memberService: jest.Mocked<MemberService>;
  let homeService: jest.Mocked<HomeService>;
  let placeInformationService: jest.Mocked<PlaceInformationService>;
  let controller: PlaceController;

  const TOKEN = 'a.valid.token';
  const SESSION = { id: 5 };

  beforeEach(() => {
    placeService = createSpyObj(PlaceService);
    memberService = createSpyObj(MemberService);
    homeService = createSpyObj(HomeService);
    placeInformationService = createSpyObj(PlaceInformationService);

    Container.reset();
    Container.set(PlaceService, placeService);
    Container.set(MemberService, memberService);
    Container.set(HomeService, homeService);
    Container.set(PlaceInformationService, placeInformationService);

    // Constructed directly with the mocks, the way home.controller.spec does - the
    // module-level `placeController` singleton resolves real services at import time.
    controller = new PlaceController(
      placeService, memberService, homeService, placeInformationService);

    memberService.decodeMemberToken.mockReturnValue(SESSION as any);
    placeService.findBySlug.mockResolvedValue({ id: 7 } as any);
    placeService.canAdmin.mockResolvedValue(false);
  });

  function mockResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
  }

  function call(params: any, headers: any = { apitoken: TOKEN }) {
    const response = mockResponse();
    return controller.canAdmin({ params, headers } as any, response)
      .then(() => response);
  }

  describe('authentication', () => {
    it('answers 401 when the token header is absent', async () => {
      const response = await call({ slug: 'mall' }, {});

      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith({ error: 'Authentication required.' });
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });

    it('answers 401 when the token is not a string', async () => {
      const response = await call({ slug: 'mall' }, { apitoken: ['a', 'b'] });

      expect(response.status).toHaveBeenCalledWith(401);
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });

    it('answers 401 when the token is malformed or expired', async () => {
      memberService.decodeMemberToken.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const response = await call({ slug: 'mall' });

      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith({ error: 'Invalid or expired token.' });
    });

    it('never echoes the token or the underlying jwt error', async () => {
      memberService.decodeMemberToken.mockImplementation(() => {
        throw new Error('jwt malformed: a.valid.token');
      });

      const response = await call({ slug: 'mall' });

      const body = JSON.stringify(response.json.mock.calls[0][0]);
      expect(body).not.toContain(TOKEN);
      expect(body).not.toContain('jwt malformed');
    });
  });

  describe('request validation', () => {
    it('answers 400 for a missing slug and does NOT continue', async () => {
      const response = await call({});

      expect(response.status).toHaveBeenCalledWith(400);
      // The old code answered and then fell through into findBySlug, attempting a second
      // response on the same request.
      expect(response.status).toHaveBeenCalledTimes(1);
      expect(placeService.findBySlug).not.toHaveBeenCalled();
    });

    it('answers 400 for a non-numeric explicit place id', async () => {
      const response = await call({ slug: 'mall', id: 'not-a-number' });

      expect(response.status).toHaveBeenCalledWith(400);
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });

    it('answers 404 when the slug matches no place', async () => {
      placeService.findBySlug.mockResolvedValue(undefined as any);

      const response = await call({ slug: 'nosuchplace' });

      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({ error: 'Place not found.' });
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });
  });

  describe('authorization results', () => {
    it('answers 200 false for an authenticated ordinary member', async () => {
      placeService.canAdmin.mockResolvedValue(false);

      const response = await call({ slug: 'mall' });

      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ result: false });
    });

    it('answers 200 true for an authenticated administrator', async () => {
      placeService.canAdmin.mockResolvedValue(true);

      const response = await call({ slug: 'mall' });

      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ result: true });
    });

    it('passes the session member id, the slug and the resolved place id through', async () => {
      await call({ slug: 'mall' });

      expect(placeService.canAdmin).toHaveBeenCalledWith('mall', 7, SESSION.id);
    });

    it('uses an explicit place id when given, so shops resolve against the mall', async () => {
      await call({ slug: 'mall', id: '99' });

      expect(placeService.findBySlug).not.toHaveBeenCalled();
      expect(placeService.canAdmin).toHaveBeenCalledWith('mall', 99, SESSION.id);
    });
  });

  describe('failure handling', () => {
    it('answers 500 when the authorization lookup fails', async () => {
      placeService.canAdmin.mockRejectedValue(new Error('ER_LOCK_DEADLOCK'));

      const response = await call({ slug: 'mall' });

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({
        error: 'Unable to determine admin status.',
      });
    });

    it('answers 500 when the place lookup fails, rather than rejecting unhandled', async () => {
      placeService.findBySlug.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const response = await call({ slug: 'mall' });

      expect(response.status).toHaveBeenCalledWith(500);
    });

    it('never reports an internal failure as "not an admin"', async () => {
      // Collapsing an outage into result:false would hide it and silently strip admins of
      // their tools.
      placeService.canAdmin.mockRejectedValue(new Error('boom'));

      const response = await call({ slug: 'mall' });

      expect(response.json).not.toHaveBeenCalledWith({ result: false });
    });

    it('never leaks the caught error, its message or a stack into the body', async () => {
      const leaky: any = new Error('select * from place where slug = ? -- ER_NO_SUCH_TABLE');
      leaky.sql = 'select * from place';
      placeService.canAdmin.mockRejectedValue(leaky);

      const response = await call({ slug: 'mall' });

      const body = JSON.stringify(response.json.mock.calls[0][0]);
      expect(body).not.toContain('select *');
      expect(body).not.toContain('ER_NO_SUCH_TABLE');
      expect(body).not.toContain('stack');
      expect(response.json).toHaveBeenCalledWith({
        error: 'Unable to determine admin status.',
      });
    });
  });
});
