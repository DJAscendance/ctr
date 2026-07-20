import { createSpyObj } from 'jest-createspyobj';

import { BlockController } from './block.controller';
import { BlockService, HoodService, MemberService } from '../services';

function mockResponse() {
  const response: any = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

describe('BlockController - map background endpoints', () => {
  let memberService: jest.Mocked<MemberService>;
  let blockService: jest.Mocked<BlockService>;
  let hoodService: jest.Mocked<HoodService>;
  let controller: BlockController;

  beforeEach(() => {
    memberService = createSpyObj(MemberService);
    blockService = createSpyObj(BlockService);
    hoodService = createSpyObj(HoodService);
    controller = new BlockController(memberService, blockService, hoodService);
  });

  describe('getMapBackgroundOptions', () => {
    it('returns 200 with the resolved options for a valid block', async () => {
      const request: any = { params: { id: '500' } };
      const response = mockResponse();
      const payload = {
        selectedIndex: null,
        effectiveIndex: 0,
        effectiveUrl: '/assets/img/map_themes/grass/block/Pimg2D000.gif',
        options: [{ index: 0, url: '/assets/img/map_themes/grass/block/Pimg2D000.gif' }],
      };
      blockService.getMapBackgroundOptions.mockResolvedValue(payload as any);

      await controller.getMapBackgroundOptions(request, response);

      expect(blockService.getMapBackgroundOptions).toHaveBeenCalledWith(500);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith(payload);
    });

    it('returns 404 when the block or its colony cannot be resolved', async () => {
      const request: any = { params: { id: '500' } };
      const response = mockResponse();
      blockService.getMapBackgroundOptions.mockResolvedValue(null);

      await controller.getMapBackgroundOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for a non-numeric block id', async () => {
      const request: any = { params: { id: 'not-a-number' } };
      const response = mockResponse();

      await controller.getMapBackgroundOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(blockService.getMapBackgroundOptions).not.toHaveBeenCalled();
    });

    it('does not require authentication to read options', async () => {
      const request: any = { params: { id: '500' } };
      const response = mockResponse();
      blockService.getMapBackgroundOptions.mockResolvedValue({
        selectedIndex: null, effectiveIndex: 0, effectiveUrl: '', options: [],
      } as any);

      await controller.getMapBackgroundOptions(request, response);

      expect(memberService.decodeMemberToken).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(200);
    });
  });

  describe('putMapBackgroundSelection', () => {
    it('returns 401 when no token is present', async () => {
      const request: any = { params: { id: '500' }, headers: {}, body: { index: 1 } };
      const response = mockResponse();
      memberService.decodeMemberToken.mockImplementation(() => {
        throw new Error('jwt must be provided');
      });

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(401);
      expect(blockService.canAdmin).not.toHaveBeenCalled();
    });

    it('returns 403 when the member is authenticated but not authorized for this block', async () => {
      const request: any = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(false);

      await controller.putMapBackgroundSelection(request, response);

      expect(blockService.canAdmin).toHaveBeenCalledWith(500, 42);
      expect(response.status).toHaveBeenCalledWith(403);
      expect(blockService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });

    it('returns 400 for a malformed body', async () => {
      const request: any = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 'two' },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(true);

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(blockService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });

    it('returns 400 when the service reports the index is invalid for this pool', async () => {
      const request: any = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 99 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection.mockResolvedValue({ status: 'invalid' } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when the service cannot resolve the block/colony', async () => {
      const request: any = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection.mockResolvedValue({ status: 'not_found' } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(404);
    });

    it('returns 200 with the normalized selection on success', async () => {
      const request: any = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 2 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection.mockResolvedValue({
        status: 'success', selectedIndex: 2,
      } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(blockService.updateMapBackgroundSelection).toHaveBeenCalledWith(500, 2);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ selectedIndex: 2 });
    });

    it('accepts a null index as a reset request', async () => {
      const request: any = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: null },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection.mockResolvedValue({
        status: 'success', selectedIndex: null,
      } as any);

      await controller.putMapBackgroundSelection(request, response);

      expect(blockService.updateMapBackgroundSelection).toHaveBeenCalledWith(500, null);
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('validates authorization against the block id in the URL, not any client-supplied id', async () => {
      const request: any = {
        params: { id: '501' },
        headers: { apitoken: 'token' },
        body: { index: 1, id: 999 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue({ id: 42 } as any);
      blockService.canAdmin.mockResolvedValue(false);

      await controller.putMapBackgroundSelection(request, response);

      expect(blockService.canAdmin).toHaveBeenCalledWith(501, 42);
      expect(response.status).toHaveBeenCalledWith(403);
    });
  });
});
