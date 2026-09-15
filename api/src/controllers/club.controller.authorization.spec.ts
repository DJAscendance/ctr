import { Request, Response } from 'express';
import { createSpyObj } from 'jest-createspyobj';

jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { ClubController } from './club.controller';
import { ClubService, MemberService, PlaceService } from '../services';

type MockResponse = jest.Mocked<Response>;

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

const OWNER_ID = 7;
const NON_OWNER_ID = 99;
const CLUB_ID = 5;

function changeStatusRequest(): Request {
  return {
    body: { clubId: String(CLUB_ID), username: 'target-member', status: 'member' },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

function updateRequest(): Request {
  return {
    body: { id: CLUB_ID, description: 'A club', private: 0 },
    headers: { apitoken: 'token' },
  } as unknown as Request;
}

/**
 * D1 (CTBL-NEW-C3): changeMemberStatus checked only that a session existed, so any
 * signed-in non-owner could change any club member's status.
 */
describe('ClubController.changeMemberStatus', () => {
  let clubService: jest.Mocked<ClubService>;
  let memberService: jest.Mocked<MemberService>;
  let placeService: jest.Mocked<PlaceService>;
  let controller: ClubController;

  beforeEach(() => {
    clubService = createSpyObj(ClubService);
    memberService = createSpyObj(MemberService);
    placeService = createSpyObj(PlaceService);
    controller = new ClubController(clubService, memberService, placeService);

    memberService.decryptSession.mockReturnValue({ id: NON_OWNER_ID } as never);
    memberService.getMemberId.mockResolvedValue([{ id: 42 }] as never);
    clubService.isOwner.mockResolvedValue(false);
  });

  it('refuses a signed-in non-owner and does not mutate the member', async () => {
    const response = mockResponse();

    await controller.changeMemberStatus(changeStatusRequest(), response);

    expect(clubService.isOwner).toHaveBeenCalledWith(CLUB_ID, NON_OWNER_ID);
    expect(clubService.changeMemberStatus).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('refuses when there is no session', async () => {
    memberService.decryptSession.mockReturnValue(undefined as never);
    const response = mockResponse();

    await controller.changeMemberStatus(changeStatusRequest(), response);

    expect(clubService.isOwner).not.toHaveBeenCalled();
    expect(clubService.changeMemberStatus).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('refuses when the ownership check itself fails', async () => {
    clubService.isOwner.mockRejectedValue(new Error('db down'));
    const response = mockResponse();

    await controller.changeMemberStatus(changeStatusRequest(), response);

    expect(clubService.changeMemberStatus).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('refuses when the target member cannot be resolved', async () => {
    clubService.isOwner.mockResolvedValue(true);
    memberService.getMemberId.mockResolvedValue([] as never);
    const response = mockResponse();

    await controller.changeMemberStatus(changeStatusRequest(), response);

    expect(clubService.changeMemberStatus).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('allows the club owner to change a member status', async () => {
    memberService.decryptSession.mockReturnValue({ id: OWNER_ID } as never);
    clubService.isOwner.mockResolvedValue(true);
    const response = mockResponse();

    await controller.changeMemberStatus(changeStatusRequest(), response);

    expect(clubService.isOwner).toHaveBeenCalledWith(CLUB_ID, OWNER_ID);
    expect(clubService.changeMemberStatus).toHaveBeenCalledWith(CLUB_ID, 42, 'member');
    expect(response.status).toHaveBeenCalledWith(200);
  });
});

/**
 * D2 (CTBL-NEW-C5): a denied updateClub request sent its 403/400 response but fell
 * through into the write anyway because the catch block never returned.
 */
describe('ClubController.updateClub', () => {
  let clubService: jest.Mocked<ClubService>;
  let memberService: jest.Mocked<MemberService>;
  let placeService: jest.Mocked<PlaceService>;
  let controller: ClubController;

  beforeEach(() => {
    clubService = createSpyObj(ClubService);
    memberService = createSpyObj(MemberService);
    placeService = createSpyObj(PlaceService);
    controller = new ClubController(clubService, memberService, placeService);

    memberService.decryptSession.mockReturnValue({ id: NON_OWNER_ID } as never);
    clubService.isOwner.mockResolvedValue(false);
  });

  it('refuses a signed-in non-owner and does not write the update', async () => {
    const response = mockResponse();

    await controller.updateClub(updateRequest(), response);

    expect(placeService.updatePlaces).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('refuses and does not write when the ownership check throws', async () => {
    clubService.isOwner.mockRejectedValue(new Error('db down'));
    const response = mockResponse();

    await controller.updateClub(updateRequest(), response);

    expect(placeService.updatePlaces).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('allows the club owner to update the club', async () => {
    memberService.decryptSession.mockReturnValue({ id: OWNER_ID } as never);
    clubService.isOwner.mockResolvedValue(true);
    const response = mockResponse();

    await controller.updateClub(updateRequest(), response);

    expect(clubService.isOwner).toHaveBeenCalledWith(CLUB_ID, OWNER_ID);
    expect(placeService.updatePlaces).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
