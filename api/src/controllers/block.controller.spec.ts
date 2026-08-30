/*
 * Importing the repository barrel eagerly constructs a real knex instance, and
 * this project ships no knex configuration for the test environment. These
 * specs only ever exercise mocked repositories and services, so the db module
 * is stubbed out before anything can pull the real one in.
 */
jest.mock('../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

import type { Request, Response } from 'express';
import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { MemberService, BlockService, HoodService } from '../services';
import type {
  MapBackgroundOptionsResult,
  MapBackgroundSelectionResult,
} from '../services/map-background/map-background.service';
import { Db } from '../db/db.class';
import { mockDb } from '@spec/mocks';
import type { SessionInfo } from '../types';
import type { BlockController as BlockControllerType } from './block.controller';

/*
 * The controller module resolves its singleton from the DI container at import
 * time, which reaches the Db service. Register the shared db mock first, then
 * require the module so that resolution succeeds without a real database.
 */
Container.set(Db, {
  ...mockDb,
  // RoleRepository reads every role in its constructor; an empty set is enough
  // here because these specs assert on the controller, never on role data.
  role: { where: jest.fn().mockResolvedValue([]) },
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { BlockController } = require('./block.controller') as typeof import('./block.controller');

/** Only the request fields these endpoints read. */
interface MockRequest {
  params: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function mockResponse(): MockResponse {
  const response = {} as MockResponse;
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  return response;
}

const session = { id: 42 } as SessionInfo;

describe('BlockController - map background endpoints', () => {
  let memberService: jest.Mocked<MemberService>;
  let blockService: jest.Mocked<BlockService>;
  let hoodService: jest.Mocked<HoodService>;
  let controller: BlockControllerType;

  /* Keeps the express casts in one place instead of at every call site. */
  const getOptions = (request: MockRequest, response: MockResponse) =>
    controller.getMapBackgroundOptions(
      request as unknown as Request,
      response as unknown as Response,
    );
  const putSelection = (request: MockRequest, response: MockResponse) =>
    controller.putMapBackgroundSelection(
      request as unknown as Request,
      response as unknown as Response,
    );

  beforeEach(() => {
    memberService = createSpyObj(MemberService);
    blockService = createSpyObj(BlockService);
    hoodService = createSpyObj(HoodService);
    controller = new BlockController(memberService, blockService, hoodService);
  });

  describe('getMapBackgroundOptions', () => {
    it('returns 200 with the resolved options for a valid block', async () => {
      const request: MockRequest = { params: { id: '500' } };
      const response = mockResponse();
      const payload: MapBackgroundOptionsResult = {
        selectedIndex: null,
        effectiveIndex: 0,
        effectiveUrl: '/assets/img/map_themes/grass/block/Pimg2D000.gif',
        options: [{ index: 0, url: '/assets/img/map_themes/grass/block/Pimg2D000.gif' }],
      };
      blockService.getMapBackgroundOptions.mockResolvedValue(payload);

      await getOptions(request, response);

      expect(blockService.getMapBackgroundOptions).toHaveBeenCalledWith(500);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith(payload);
    });

    it('returns 404 when the block or its colony cannot be resolved', async () => {
      const request: MockRequest = { params: { id: '500' } };
      const response = mockResponse();
      blockService.getMapBackgroundOptions.mockResolvedValue(null);

      await getOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for a non-numeric block id', async () => {
      const request: MockRequest = { params: { id: 'not-a-number' } };
      const response = mockResponse();

      await getOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(blockService.getMapBackgroundOptions).not.toHaveBeenCalled();
    });

    /*
     * Number.parseInt would accept each of these and quietly read a different
     * real block instead of rejecting the request.
     */
    it.each([
      ['500x', 'a numeric prefix'],
      ['1.5', 'a fraction'],
      ['1e2', 'exponent notation'],
      ['0', 'zero, which no block uses'],
      ['-500', 'a negative id'],
      ['', 'an empty id'],
    ])('returns 400 for the malformed id %s (%s)', async raw => {
      const request: MockRequest = { params: { id: raw } };
      const response = mockResponse();

      await getOptions(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(blockService.getMapBackgroundOptions).not.toHaveBeenCalled();
    });

    it('returns 500 when the service fails to read the asset directory', async () => {
      const request: MockRequest = { params: { id: '500' } };
      const response = mockResponse();
      const failure: NodeJS.ErrnoException = new Error('EACCES');
      failure.code = 'EACCES';
      blockService.getMapBackgroundOptions.mockRejectedValue(failure);

      await getOptions(request, response);

      // A server-side filesystem fault is not the caller's fault.
      expect(response.status).toHaveBeenCalledWith(500);
    });

    it('does not leak the failing filesystem path in the error response', async () => {
      const request: MockRequest = { params: { id: '500' } };
      const response = mockResponse();
      blockService.getMapBackgroundOptions
        .mockRejectedValue(new Error('EACCES: permission denied, scandir /srv/secret/assets'));

      await getOptions(request, response);

      expect(JSON.stringify(response.json.mock.calls)).not.toContain('/srv/secret/assets');
    });

    it('does not require authentication to read options', async () => {
      const request: MockRequest = { params: { id: '500' } };
      const response = mockResponse();
      blockService.getMapBackgroundOptions.mockResolvedValue({
        selectedIndex: null, effectiveIndex: 0, effectiveUrl: '', options: [],
      });

      await getOptions(request, response);

      expect(memberService.decodeMemberToken).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(200);
    });
  });

  describe('putMapBackgroundSelection', () => {
    it('returns 401 when no token is present', async () => {
      const request: MockRequest = { params: { id: '500' }, headers: {}, body: { index: 1 } };
      const response = mockResponse();
      memberService.decodeMemberToken.mockImplementation(() => {
        throw new Error('jwt must be provided');
      });

      await putSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(401);
      expect(blockService.canAdmin).not.toHaveBeenCalled();
    });

    it('returns 403 when the member is authenticated but not authorized', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(false);

      await putSelection(request, response);

      expect(blockService.canAdmin).toHaveBeenCalledWith(500, 42);
      expect(response.status).toHaveBeenCalledWith(403);
      expect(blockService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });

    /*
     * A malformed id must be refused before the write path resolves any
     * block, so a truncated id can never be authorized or written.
     */
    it.each([
      ['500x', 'a numeric prefix'],
      ['1.5', 'a fraction'],
      ['0', 'zero, which no block uses'],
    ])('returns 400 for the malformed id %s (%s) without authorizing', async raw => {
      const request: MockRequest = {
        params: { id: raw },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();

      await putSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(memberService.decodeMemberToken).not.toHaveBeenCalled();
      expect(blockService.canAdmin).not.toHaveBeenCalled();
      expect(blockService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });

    it('returns 400 for a malformed body', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 'two' },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(true);

      await putSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(blockService.updateMapBackgroundSelection).not.toHaveBeenCalled();
    });

    it('returns 400 when the service reports the index is invalid for this pool', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 99 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection
        .mockResolvedValue({ status: 'invalid' } as MapBackgroundSelectionResult);

      await putSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when the write path hits a filesystem fault', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(true);
      const failure: NodeJS.ErrnoException = new Error('EACCES');
      failure.code = 'EACCES';
      blockService.updateMapBackgroundSelection.mockRejectedValue(failure);

      await putSelection(request, response);

      // Not a 400: the client's index was well-formed, the server failed.
      expect(response.status).toHaveBeenCalledWith(500);
    });

    it('returns 404 when the service cannot resolve the block/colony', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 1 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection
        .mockResolvedValue({ status: 'not_found' } as MapBackgroundSelectionResult);

      await putSelection(request, response);

      expect(response.status).toHaveBeenCalledWith(404);
    });

    it('returns 200 with the normalized selection on success', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: 2 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection.mockResolvedValue({
        status: 'success', selectedIndex: 2,
      } as MapBackgroundSelectionResult);

      await putSelection(request, response);

      expect(blockService.updateMapBackgroundSelection).toHaveBeenCalledWith(500, 2);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ selectedIndex: 2 });
    });

    it('accepts a null index as a reset request', async () => {
      const request: MockRequest = {
        params: { id: '500' },
        headers: { apitoken: 'token' },
        body: { index: null },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(true);
      blockService.updateMapBackgroundSelection.mockResolvedValue({
        status: 'success', selectedIndex: null,
      } as MapBackgroundSelectionResult);

      await putSelection(request, response);

      expect(blockService.updateMapBackgroundSelection).toHaveBeenCalledWith(500, null);
      expect(response.status).toHaveBeenCalledWith(200);
    });

    it('validates authorization against the URL block id, not any client-supplied id', async () => {
      const request: MockRequest = {
        params: { id: '501' },
        headers: { apitoken: 'token' },
        body: { index: 1, id: 999 },
      };
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(session);
      blockService.canAdmin.mockResolvedValue(false);

      await putSelection(request, response);

      expect(blockService.canAdmin).toHaveBeenCalledWith(501, 42);
      expect(response.status).toHaveBeenCalledWith(403);
    });
  });
});
