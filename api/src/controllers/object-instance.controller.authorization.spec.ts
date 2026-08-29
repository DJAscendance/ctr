import { Request, Response } from 'express';
import { createSpyObj } from 'jest-createspyobj';

jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { ObjectInstanceController } from './object-instance.controller';
import {
  BlackMarketService,
  FleaMarketService,
  MemberService,
  ObjectInstanceService,
  PlaceService,
} from '../services';

type MockResponse = jest.Mocked<Response>;

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

const MEMBER_ID = 7;
const SOMEONE_ELSE = 99;

function mockRequest(): Request {
  return {
    params: { id: '1' },
    body: {
      placeId: '5',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 1, z: 0, angle: 0 },
    },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

/**
 * The place check in `dropObjectInstance` read `!admin` against an access level
 * that is always an array, so it never fired and any member could drop an object
 * into any member's place. It now takes the same capability as editing a place.
 */
describe('ObjectInstanceController.dropObjectInstance', () => {
  let objectInstanceService: jest.Mocked<ObjectInstanceService>;
  let placeService: jest.Mocked<PlaceService>;
  let memberService: jest.Mocked<MemberService>;
  let fleaMarketService: jest.Mocked<FleaMarketService>;
  let blackMarketService: jest.Mocked<BlackMarketService>;
  let controller: ObjectInstanceController;

  beforeEach(() => {
    objectInstanceService = createSpyObj(ObjectInstanceService);
    placeService = createSpyObj(PlaceService);
    memberService = createSpyObj(MemberService);
    fleaMarketService = createSpyObj(FleaMarketService);
    blackMarketService = createSpyObj(BlackMarketService);
    controller = new ObjectInstanceController(
      objectInstanceService,
      placeService,
      memberService,
      fleaMarketService,
      blackMarketService,
    );

    memberService.decryptSession.mockReturnValue({ id: MEMBER_ID } as never);
    memberService.getAccessLevel.mockResolvedValue([]);
    // The actor owns the object throughout; only the place ownership varies.
    objectInstanceService.find.mockResolvedValue({ member_id: MEMBER_ID } as never);
    objectInstanceService.getObjectInstanceWithObject
      .mockResolvedValue([{ id: 1 }] as never);
    placeService.findById.mockResolvedValue(
      { slug: 'someones-home', member_id: SOMEONE_ELSE } as never);
  });

  it('denies an ordinary member dropping into someone else\'s place', async () => {
    const response = mockResponse();

    await controller.dropObjectInstance(mockRequest(), response);

    expect(objectInstanceService.updateObjectPlaceId).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'Not the owner of this place' });
  });

  it.each([
    ['only leader', ['leader']],
    ['only live-event', ['live-event']],
    ['a null access level', null],
    ['an undefined access level', undefined],
    ['a non-array access level', 'admin'],
  ])('denies a member with %s', async (_label, accessLevel) => {
    memberService.getAccessLevel.mockResolvedValue(accessLevel as never);
    const response = mockResponse();

    await controller.dropObjectInstance(mockRequest(), response);

    expect(objectInstanceService.updateObjectPlaceId).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it.each(['admin', 'security'])('allows a member holding %s', async capability => {
    memberService.getAccessLevel.mockResolvedValue([capability]);
    const response = mockResponse();

    await controller.dropObjectInstance(mockRequest(), response);

    expect(objectInstanceService.updateObjectPlaceId).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('allows the owner of the place', async () => {
    placeService.findById.mockResolvedValue(
      { slug: 'my-home', member_id: MEMBER_ID } as never);
    const response = mockResponse();

    await controller.dropObjectInstance(mockRequest(), response);

    expect(objectInstanceService.updateObjectPlaceId).toHaveBeenCalledTimes(1);
  });

  it.each(['fleamarket', 'blackmarket'])(
    'allows any member in the open %s', async slug => {
      placeService.findById.mockResolvedValue(
        { slug, member_id: SOMEONE_ELSE } as never);
      const response = mockResponse();

      await controller.dropObjectInstance(mockRequest(), response);

      expect(objectInstanceService.updateObjectPlaceId).toHaveBeenCalledTimes(1);
    });

  it('still refuses an object the member does not own', async () => {
    memberService.getAccessLevel.mockResolvedValue(['admin']);
    objectInstanceService.find.mockResolvedValue({ member_id: SOMEONE_ELSE } as never);
    const response = mockResponse();

    await controller.dropObjectInstance(mockRequest(), response);

    expect(objectInstanceService.updateObjectPlaceId).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ error: 'Not the owner of this object' });
  });
});
