import { Request, Response } from 'express';
import { createSpyObj } from 'jest-createspyobj';

// See admin.controller.authorization.spec.ts - importing a controller reaches the services
// barrel, which builds every repository against a real connection.
jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { PlaceController } from './place.controller';
import { HomeService, JailService, MemberService, PlaceService } from '../services';

type MockResponse = jest.Mocked<Response>;

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

const JAIL_PLACE_ID = 77;
const SEEDED = { id: JAIL_PLACE_ID, slug: 'jail', world_filename: 'vrml/jail.wrl' };

function request(slug: string, token?: string): Request {
  return {
    params: { slug },
    headers: token ? { apitoken: token } : {},
  } as unknown as Request;
}

/**
 * Which Jail world a caller is served, and by whom that is decided.
 *
 * The world file is the cell-access mechanism, so "the server chose it" is the security
 * property under test -- not "the client asked nicely".
 */
describe('PlaceController.getPlace - the Jail world', () => {
  let placeService: jest.Mocked<PlaceService>;
  let memberService: jest.Mocked<MemberService>;
  let homeService: jest.Mocked<HomeService>;
  let jailService: jest.Mocked<JailService>;
  let controller: PlaceController;

  beforeEach(() => {
    placeService = createSpyObj(PlaceService);
    memberService = createSpyObj(MemberService);
    homeService = createSpyObj(HomeService);
    jailService = createSpyObj(JailService);
    controller = new PlaceController(placeService, memberService, homeService, jailService);

    placeService.findBySlug.mockResolvedValue(SEEDED as never);
    memberService.decodeMemberToken.mockReturnValue({ id: 5 } as never);
    jailService.applyWorldForMember.mockImplementation(
      async (place: any) => ({ ...place, world_filename: 'vrml/jailvisit.wrl' }),
    );
  });

  it('routes the answer through the Jail service, with the token holder id', async () => {
    await controller.getPlace(request('jail', 'token'), mockResponse());
    expect(jailService.applyWorldForMember).toHaveBeenCalledWith(SEEDED, 5);
  });

  it('serves whatever the Jail service decided, not the seeded row', async () => {
    const response = mockResponse();
    await controller.getPlace(request('jail', 'token'), response);
    expect(response.json).toHaveBeenCalledWith({
      place: { ...SEEDED, world_filename: 'vrml/jailvisit.wrl' },
    });
  });

  it('treats an unauthenticated caller as unidentified rather than refusing them', async () => {
    // This endpoint is public for every other place and has to stay that way.
    const response = mockResponse();
    await controller.getPlace(request('jail'), response);
    expect(jailService.applyWorldForMember).toHaveBeenCalledWith(SEEDED, undefined);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('does not let a client name the world it wants', async () => {
    const forged = request('jail', 'token');
    (forged as any).query = { world_filename: 'vrml/jailstaff.wrl' };
    (forged as any).params.world_filename = 'vrml/jailstaff.wrl';

    await controller.getPlace(forged, mockResponse());

    // The only inputs that reached the decision are the row and the token holder's id.
    expect(jailService.applyWorldForMember).toHaveBeenCalledWith(SEEDED, 5);
  });

  it('applies the same rule to the by-id lookup, so it is not a way around', async () => {
    placeService.findById.mockResolvedValue(SEEDED as never);
    memberService.decryptSession.mockReturnValue({ id: 5 } as never);
    const response = mockResponse();

    await controller.getPlaceById(
      { params: { id: String(JAIL_PLACE_ID) }, headers: {} } as unknown as Request,
      response,
    );

    expect(jailService.applyWorldForMember).toHaveBeenCalledWith(SEEDED, 5);
    expect(response.json).toHaveBeenCalledWith({
      place: { ...SEEDED, world_filename: 'vrml/jailvisit.wrl' },
    });
  });
});
