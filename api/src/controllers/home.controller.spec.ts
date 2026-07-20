import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HomeController } from './home.controller';
import { MemberService } from '../services/member/member.service';
import { HomeService } from '../services/home/home.service';

/**
 * Focused coverage for two CodeRabbit-flagged findings on HomeController:
 *  1. getHome() must never leak internal moderation metadata (image_revision,
 *     image_checked_by, image_checked_at, raw image_status) into the public response.
 *  2. previewImage()'s response.sendFile() error callback must answer once, correctly, and
 *     never attempt a second response once headers have already been sent.
 */
describe('HomeController', () => {
  let memberService: jest.Mocked<MemberService>;
  let homeService: jest.Mocked<HomeService>;
  let controller: HomeController;

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

  describe('getHome public response shape', () => {
    const session = { id: 1 };
    const homeData = { id: 42 };

    beforeEach(() => {
      memberService.decryptSession.mockReturnValue(session as any);
      homeService.getHome.mockResolvedValue(homeData as any);
      homeService.getHomeBlock.mockResolvedValue({ id: 7 } as any);
      homeService.getPlaceHomeDesign.mockResolvedValue({} as any);
    });

    async function callGetHome() {
      const request = { params: {} } as any;
      const response = mockResponse();
      await controller.getHome(request, response);
      return response.json.mock.calls[0][0];
    }

    it('exposes the approved image and hides moderation metadata', async () => {
      homeService.getHomeRecord.mockResolvedValue({
        place_id: 42,
        home_design_id: 'design-1',
        image: 'approved.webp',
        image_status: 'approved',
        image_revision: 'secret-revision-token',
        image_checked_by: 99,
        image_checked_at: new Date(),
      } as any);

      const body = await callGetHome();

      expect(body.homeRecord).toEqual({ image: 'approved.webp', imagePending: false });
      expect(body.homeRecord).not.toHaveProperty('image_revision');
      expect(body.homeRecord).not.toHaveProperty('image_checked_by');
      expect(body.homeRecord).not.toHaveProperty('image_checked_at');
      expect(body.homeRecord).not.toHaveProperty('image_status');
      expect(body.homeRecord).not.toHaveProperty('place_id');
      expect(body.homeRecord).not.toHaveProperty('home_design_id');
    });

    it('hides the pending image filename but flags it as pending', async () => {
      homeService.getHomeRecord.mockResolvedValue({
        place_id: 42,
        home_design_id: 'design-1',
        image: 'unchecked.webp',
        image_status: 'pending',
        image_revision: 'secret-revision-token',
      } as any);

      const body = await callGetHome();

      expect(body.homeRecord).toEqual({ image: null, imagePending: true });
    });

    it('hides the image and reports not-pending when there is no image', async () => {
      homeService.getHomeRecord.mockResolvedValue({
        place_id: 42,
        home_design_id: 'design-1',
        image: null,
        image_status: 'none',
      } as any);

      const body = await callGetHome();

      expect(body.homeRecord).toEqual({ image: null, imagePending: false });
    });

    it('hides the image and reports not-pending when the image was rejected', async () => {
      homeService.getHomeRecord.mockResolvedValue({
        place_id: 42,
        home_design_id: 'design-1',
        image: 'rejected.webp',
        image_status: 'rejected',
      } as any);

      const body = await callGetHome();

      expect(body.homeRecord).toEqual({ image: null, imagePending: false });
    });
  });

  describe('uploadImage file normalization', () => {
    const session = { id: 1 };

    beforeEach(() => {
      memberService.decryptSession.mockReturnValue(session as any);
      homeService.uploadHomeImage.mockResolvedValue(undefined);
    });

    async function callUploadImage(files: any) {
      const request = { files } as any;
      const response = mockResponse();
      await controller.uploadImage(request, response);
      return response;
    }

    it('accepts a single valid image file', async () => {
      const imageFile = {
        name: 'photo.png',
        mimetype: 'image/png',
        size: 1024,
        data: Buffer.from('x'),
      };

      const response = await callUploadImage({ imageFile });

      expect(homeService.uploadHomeImage).toHaveBeenCalledWith(session.id, imageFile);
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('rejects when no file is provided', async () => {
      const response = await callUploadImage({});

      expect(homeService.uploadHomeImage).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({ error: 'Image file is required.' });
    });

    it('rejects multiple files uploaded under the same field instead of throwing', async () => {
      const imageFile = [
        { name: 'a.png', mimetype: 'image/png', size: 10, data: Buffer.from('a') },
        { name: 'b.png', mimetype: 'image/png', size: 10, data: Buffer.from('b') },
      ];

      const response = await callUploadImage({ imageFile });

      expect(homeService.uploadHomeImage).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'Only one image file may be uploaded at a time.',
      });
    });
  });

  describe('previewImage sendFile error handling', () => {
    const session = { id: 1 };

    beforeEach(() => {
      memberService.decodeMemberToken.mockReturnValue(session as any);
      homeService.canModerateHome.mockResolvedValue(true);
      homeService.getPendingImagePath
        .mockResolvedValue('/private-uploads/homes-pending/1-abc.webp');
    });

    function callPreviewImage(response: any, next = jest.fn()) {
      const request = {
        headers: { apitoken: 'token' },
        params: { placeId: '1' },
      } as any;
      return controller.previewImage(request, response, next).then(() => next);
    }

    it('answers 404 when the file disappears before it can be sent (ENOENT)', async () => {
      const response = mockResponse();
      response.sendFile.mockImplementation((_path, _opts, callback) => {
        callback(Object.assign(new Error('missing'), { code: 'ENOENT' }));
      });
      const next = jest.fn();

      await callPreviewImage(response, next);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it('answers 500 on a generic send failure before headers are sent', async () => {
      const response = mockResponse();
      response.sendFile.mockImplementation((_path, _opts, callback) => {
        callback(new Error('disk read failed'));
      });
      const next = jest.fn();

      await callPreviewImage(response, next);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
    });

    it('delegates to next() without a second response once headers were already sent', async () => {
      const response = mockResponse();
      const streamError = new Error('stream aborted mid-transfer');
      response.sendFile.mockImplementation((_path, _opts, callback) => {
        response.headersSent = true;
        callback(streamError);
      });
      const next = jest.fn();

      await callPreviewImage(response, next);

      expect(next).toHaveBeenCalledWith(streamError);
      expect(response.json).not.toHaveBeenCalled();
    });

    it('sends the file once and calls neither next() nor a JSON response on success', async () => {
      const response = mockResponse();
      response.sendFile.mockImplementation((_path, _opts, callback) => {
        callback();
      });
      const next = jest.fn();

      await callPreviewImage(response, next);

      expect(response.sendFile).toHaveBeenCalledTimes(1);
      expect(response.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });
  });
});
