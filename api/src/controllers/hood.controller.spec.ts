import { createSpyObj } from 'jest-createspyobj';

import { HoodController } from './hood.controller';
import { HoodService, MemberService } from '../services';

function mockResponse() {
  const response: any = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

describe('HoodController - map background endpoints', () => {
  let hoodService: jest.Mocked<HoodService>;
  let memberService: jest.Mocked<MemberService>;
  let controller: HoodController;

  beforeEach(() => {
    hoodService = createSpyObj(HoodService);
    memberService = createSpyObj(MemberService);
    controller = new HoodController(hoodService, memberService);
  });

  describe('getMapBackgroundOptions', () => {
    it('returns 200 with the resolved options, including a large index pool', async () => {
      const request: any = { params: { id: '60' } };
      const response = mockResponse();
      const payload = {
        selectedIndex: 26,
        effectiveIndex: 26,
        effectiveUrl: '/assets/img/map_themes/grass/hood/Pimg2D026.gif',
        options: Array.from({ length: 27 }, (_, index) => ({
          index,
          url: `/assets/img/map_themes/grass/hood/Pimg2D${index.toString().padStart(3, '0')}.gif`,
        })),
      };
      hoodService.getMapBackgroundOptions.mockResolvedValue(payload as any);

      await controller.getMapBackgroundOptions(request, response);

      expect(hoodService.getMapBackgroundOptions).toHaveBeenCalledWith(60);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith(payload);
    });

    it('returns 404 when the hood or its colony cannot be resolved', async () => {
      const request: any = { params: { id: '60' } };
      const response = mockResponse();
      hoodService.getMapBackgroundOptions.mockResolvedValue(null);

      await controller.getMapBackgroundOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for a non-numeric hood id', async () => {
      const request: any = { params: { id: 'nope' } };
      const response = mockResponse();

      await controller.getMapBackgroundOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(hoodService.getMapBackgroundOptions).not.toHaveBeenCalled();
    });
  });

  describe('putMapBackgroundSelection', () => {
    it('returns 401 when no token is present', async () => {
      const request: any = { params: { id: '60' }, headers: {}, body: { index: 1 } };
      const response = mockResponse();
      memberService.decodeMemberToken.mockImplementation(() => {
        throw new Error('jwt must be provided');
      });

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(401);
      expect(hoodService.canAdmin).not.toHaveBeenCalled();
    });

    it('returns 403 when the member is authenticated but not authorized for this hood', async () => {
      const request: any = {
        params: { id: '60' },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      hoodService.canAdmin.mockResolvedValue(false);

      await controller.putMapBackgroundSelection(request, response);

      expect(hoodService.canAdmin).toHaveBeenCalledWith(60, 42);
      expect(response.status).toHaveBeenCalledWith(403);
      expect(hoodService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });

    it('rejects an index that is out of range for a small pool (e.g. cyberhood/hood)', async () => {
      const request: any = {
        params: { id: '60' },
        headers: { apitoken: 'token' },
        body: { index: 5 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      hoodService.canAdmin.mockResolvedValue(true);
      hoodService.updateMapBackgroundSelection.mockResolvedValue({ status: 'invalid' } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
    });

    it('returns 200 and stores a valid high index for a large pool (e.g. grass/hood)', async () => {
      const request: any = {
        params: { id: '60' },
        headers: { apitoken: 'token' },
        body: { index: 26 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      hoodService.canAdmin.mockResolvedValue(true);
      hoodService.updateMapBackgroundSelection.mockResolvedValue({
        status: 'success', selectedIndex: 26,
      } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(hoodService.updateMapBackgroundSelection).toHaveBeenCalledWith(60, 26);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ selectedIndex: 26 });
    });

    it('resets to default by storing null', async () => {
      const request: any = {
        params: { id: '60' },
        headers: { apitoken: 'token' },
        body: { index: null },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      hoodService.canAdmin.mockResolvedValue(true);
      hoodService.updateMapBackgroundSelection.mockResolvedValue({
        status: 'success', selectedIndex: null,
      } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(hoodService.updateMapBackgroundSelection).toHaveBeenCalledWith(60, null);
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 when the index is missing from the body', async () => {
      const request: any = {
        params: { id: '60' },
        headers: { apitoken: 'token' },
        body: {},
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      hoodService.canAdmin.mockResolvedValue(true);

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(hoodService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });
  });
});
