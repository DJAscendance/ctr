import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceController } from './place.controller';
import { PlaceService } from '../services/place/place.service';
import { MemberService } from '../services/member/member.service';
import { HomeService } from '../services/home/home.service';
import { PlaceInformationService } from '../services/place/place-information.service';
import { PlaceUpdateHubService } from '../services/place/place-update-hub.service';

/**
 * HTTP contract for GET /place/:placeId/update-hub.
 *
 * The property that matters most: "this place type has no hub" and "you hold no
 * capability here" must be indistinguishable to the caller. If they answered
 * differently, an unauthorized member could enumerate which places have scoped
 * administration by probing ids.
 *
 * Authorization itself is NOT under test here - PlaceUpdateHubService is mocked.
 * Who gets what is pinned in place-update-hub.service.spec.ts.
 */
describe('PlaceController getUpdateHub contract', () => {
  let placeService: jest.Mocked<PlaceService>;
  let memberService: jest.Mocked<MemberService>;
  let homeService: jest.Mocked<HomeService>;
  let placeInformationService: jest.Mocked<PlaceInformationService>;
  let placeUpdateHubService: jest.Mocked<PlaceUpdateHubService>;
  let controller: PlaceController;

  const TOKEN = 'a.valid.token';
  const SESSION = { id: 5 };

  beforeEach(() => {
    placeService = createSpyObj(PlaceService);
    memberService = createSpyObj(MemberService);
    homeService = createSpyObj(HomeService);
    placeInformationService = createSpyObj(PlaceInformationService);
    placeUpdateHubService = createSpyObj(PlaceUpdateHubService);

    Container.reset();
    Container.set(PlaceService, placeService);
    Container.set(MemberService, memberService);
    Container.set(HomeService, homeService);
    Container.set(PlaceInformationService, placeInformationService);
    Container.set(PlaceUpdateHubService, placeUpdateHubService);

    controller = new PlaceController(
      placeService,
      memberService,
      homeService,
      placeInformationService,
      placeUpdateHubService);

    memberService.decodeMemberToken.mockReturnValue(SESSION as any);
  });

  function mockResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
  }

  function call(params: any, headers: any = { apitoken: TOKEN }) {
    const response = mockResponse();
    return controller.getUpdateHub({ params, headers } as any, response)
      .then(() => response);
  }

  it('answers 401 when no token is supplied', async () => {
    const response = await call({ placeId: '7' }, {});
    expect(response.status).toHaveBeenCalledWith(401);
    expect(placeUpdateHubService.getHub).not.toHaveBeenCalled();
  });

  it('answers 401 when the token is invalid', async () => {
    memberService.decodeMemberToken.mockImplementation(() => {
      throw new Error('bad token');
    });
    const response = await call({ placeId: '7' });
    expect(response.status).toHaveBeenCalledWith(401);
    expect(placeUpdateHubService.getHub).not.toHaveBeenCalled();
  });

  it('answers 400 for a non-numeric place id without authenticating', async () => {
    const response = await call({ placeId: 'not-a-number' });
    expect(response.status).toHaveBeenCalledWith(400);
    expect(placeUpdateHubService.getHub).not.toHaveBeenCalled();
  });

  it('answers 404 for a place that does not exist', async () => {
    placeUpdateHubService.getHub.mockResolvedValue({ status: 'not_found' } as any);
    const response = await call({ placeId: '999999' });
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('answers an identical 403 for "unsupported type" and "no capability"',
    async () => {
      placeUpdateHubService.getHub.mockResolvedValue({ status: 'unsupported' } as any);
      const unsupported = await call({ placeId: '7' });

      placeUpdateHubService.getHub.mockResolvedValue({ status: 'forbidden' } as any);
      const forbidden = await call({ placeId: '7' });

      expect(unsupported.status).toHaveBeenCalledWith(403);
      expect(forbidden.status).toHaveBeenCalledWith(403);
      // Same body, so the two cases cannot be told apart by probing.
      expect(unsupported.json.mock.calls[0][0])
        .toEqual(forbidden.json.mock.calls[0][0]);
    });

  it('returns the hub on success', async () => {
    const hub = {
      placeId: 7,
      name: 'Cedar',
      type: 'block',
      slug: null,
      canOpen: true,
      capabilities: ['manage_lots'],
    };
    placeUpdateHubService.getHub.mockResolvedValue({ status: 'success', hub } as any);

    const response = await call({ placeId: '7' });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ hub });
  });

  it('passes the parsed place id and the SESSION member id to the service',
    async () => {
      placeUpdateHubService.getHub.mockResolvedValue({ status: 'forbidden' } as any);
      // A member id in the body or params must be ignored - the actor is the
      // authenticated session, never something the caller supplies.
      await call({ placeId: '31', memberId: '999', type: 'colony', slug: 'mall' });
      expect(placeUpdateHubService.getHub).toHaveBeenCalledWith(31, SESSION.id);
    });

  it('answers 500 without leaking the error when the service throws', async () => {
    placeUpdateHubService.getHub.mockRejectedValue(
      new Error('select * from place where secret = 1'),
    );
    const response = await call({ placeId: '7' });
    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain('select *');
  });
});
