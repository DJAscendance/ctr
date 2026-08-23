import { createSpyObj } from 'jest-createspyobj';

// Importing a controller pulls in the services barrel, which instantiates every
// repository - and RoleRepository queries on construction. Without this the spec
// would try to open a real MySQL connection.
jest.mock('../db/db.class', () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@spec/mocks/db-module.mock').mockDbModule());

import { MallController } from './mall.controller';
import {
  MallExportService,
  MallInspectionService,
  MallService,
  MemberService,
  ObjectInstanceService,
  ObjectService,
  WalletService,
} from '../services';

function mockResponse() {
  const response: any = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  response.send = jest.fn().mockReturnValue(response);
  response.headers = {};
  response.setHeader = jest.fn((name: string, value: string) => {
    response.headers[name] = value;
  });
  return response;
}

function request(params: any = {}, query: any = {}, apitoken = 'staff-token'): any {
  return { params, query, headers: { apitoken } };
}

const INSPECTION = {
  object: { id: 3339, name: 'Pocket Moon Playset' },
  source: { encoding: 'gzip', storedBytes: 23002, decodedBytes: 108310 },
  vrml: { header: '#VRML V2.0 utf8' },
  findings: [],
};

describe('MallController - staff-only inspection endpoints', () => {
  let memberService: jest.Mocked<MemberService>;
  let mallService: jest.Mocked<MallService>;
  let objectService: jest.Mocked<ObjectService>;
  let walletService: jest.Mocked<WalletService>;
  let objectInstanceService: jest.Mocked<ObjectInstanceService>;
  let mallInspectionService: jest.Mocked<MallInspectionService>;
  let mallExportService: jest.Mocked<MallExportService>;
  let controller: MallController;

  beforeEach(() => {
    memberService = createSpyObj(MemberService);
    mallService = createSpyObj(MallService);
    objectService = createSpyObj(ObjectService);
    walletService = createSpyObj(WalletService);
    objectInstanceService = createSpyObj(ObjectInstanceService);
    mallInspectionService = createSpyObj(MallInspectionService);
    mallExportService = createSpyObj(MallExportService);
    controller = new MallController(
      memberService,
      mallService,
      objectService,
      walletService,
      objectInstanceService,
      mallInspectionService,
      mallExportService,
    );

    memberService.decodeMemberToken.mockReturnValue({ id: 7 } as never);
    mallService.canAdmin.mockResolvedValue(true);
  });

  describe('the staff guard', () => {
    /**
     * decodeMemberToken THROWS on a missing or malformed token, it does not
     * return null. A guard that only handles the null case lets the rejection
     * escape the async handler, and Express then never responds - the request
     * hangs rather than being denied. Every staff endpoint is checked, because
     * the failure is invisible unless the mock throws the way the real service
     * does.
     */
    beforeEach(() => {
      memberService.decodeMemberToken.mockImplementation(() => {
        throw new Error('jwt must be provided');
      });
    });

    it('denies rather than hangs when the token decode throws', async () => {
      const response = mockResponse();

      await controller.getObjectInspection(request({ id: '3339' }, {}, undefined), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'Invalid or missing token or access denied.',
      });
      expect(mallInspectionService.inspect).not.toHaveBeenCalled();
    });

    it('denies rather than hangs on the source endpoint', async () => {
      const response = mockResponse();

      await controller.getObjectSource(request({ id: '3339' }, {}, undefined), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallInspectionService.readSourceText).not.toHaveBeenCalled();
    });

    it('denies rather than hangs on the export endpoint', async () => {
      const response = mockResponse();
      response.end = jest.fn();
      response.write = jest.fn().mockReturnValue(true);

      await controller.exportMallData(request({}, {}, undefined), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallExportService.export).not.toHaveBeenCalled();
      expect(response.write).not.toHaveBeenCalled();
    });

    it('answers every staff endpoint rather than leaving any unanswered', async () => {
      const responses = [mockResponse(), mockResponse(), mockResponse()];
      responses[2].end = jest.fn();
      responses[2].write = jest.fn().mockReturnValue(true);

      await controller.getObjectInspection(request({ id: '1' }, {}, undefined), responses[0]);
      await controller.getObjectSource(request({ id: '1' }, {}, undefined), responses[1]);
      await controller.exportMallData(request({}, {}, undefined), responses[2]);

      responses.forEach(response => {
        expect(response.status).toHaveBeenCalledWith(400);
        expect(response.json).toHaveBeenCalled();
      });
    });
  });

  describe('getObjectInspection', () => {
    it('returns 200 with the inspection for a Mall staff member', async () => {
      const response = mockResponse();
      mallInspectionService.inspect.mockResolvedValue(INSPECTION as never);

      await controller.getObjectInspection(request({ id: '3339' }), response);

      expect(mallInspectionService.inspect).toHaveBeenCalledWith(3339);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({ status: 'success', inspection: INSPECTION });
    });

    it('denies an ordinary member and never reaches the service', async () => {
      const response = mockResponse();
      mallService.canAdmin.mockResolvedValue(false);

      await controller.getObjectInspection(request({ id: '3339' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        error: 'Invalid or missing token or access denied.',
      });
      expect(mallInspectionService.inspect).not.toHaveBeenCalled();
    });

    it('denies a request with no valid token and never reaches the service', async () => {
      const response = mockResponse();
      memberService.decodeMemberToken.mockReturnValue(null as never);

      await controller.getObjectInspection(request({ id: '3339' }, {}, undefined), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallService.canAdmin).not.toHaveBeenCalled();
      expect(mallInspectionService.inspect).not.toHaveBeenCalled();
    });

    it('returns 404 for an object that does not exist', async () => {
      const response = mockResponse();
      mallInspectionService.inspect.mockResolvedValue(null as never);

      await controller.getObjectInspection(request({ id: '999999' }), response);

      expect(response.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for a non-numeric id without touching the service', async () => {
      const response = mockResponse();

      await controller.getObjectInspection(request({ id: 'not-a-number' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallInspectionService.inspect).not.toHaveBeenCalled();
    });
  });

  describe('getObjectSource', () => {
    beforeEach(() => {
      mallInspectionService.readSourceText.mockResolvedValue({
        text: '#VRML V2.0 utf8\n',
        error: null,
      } as never);
    });

    it('returns the decoded VRML as UTF-8 plain text with nosniff', async () => {
      const response = mockResponse();

      await controller.getObjectSource(request({ id: '3339' }), response);

      expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
      expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.send).toHaveBeenCalledWith('#VRML V2.0 utf8\n');
    });

    it('does not offer a download unless asked', async () => {
      const response = mockResponse();

      await controller.getObjectSource(request({ id: '3339' }), response);

      expect(response.headers['Content-Disposition']).toBeUndefined();
    });

    it('names the download from the object id, never from member-supplied data',
      async () => {
        const response = mockResponse();

        await controller.getObjectSource(request({ id: '3339' }, { download: '1' }), response);

        expect(response.headers['Content-Disposition'])
          .toBe('attachment; filename="object-3339.wrl"');
      });

    it('cannot be made to emit a header containing quotes, CRLF or path characters',
      async () => {
        // The object's own name is member-supplied and is never consulted here, so
        // a hostile name cannot reach the header at all.
        const response = mockResponse();

        await controller.getObjectSource(
          request({ id: '42' }, { download: '1' }),
          response,
        );

        const disposition: string = response.headers['Content-Disposition'];
        expect(disposition).toBe('attachment; filename="object-42.wrl"');
        expect(disposition).not.toMatch(/[\r\n]/);
        expect(disposition.match(/"/g)).toHaveLength(2);
      });

    it('denies an ordinary member and never reads the file', async () => {
      const response = mockResponse();
      mallService.canAdmin.mockResolvedValue(false);

      await controller.getObjectSource(request({ id: '3339' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallInspectionService.readSourceText).not.toHaveBeenCalled();
      expect(response.send).not.toHaveBeenCalled();
    });

    it('returns 404 when the object or its file is gone', async () => {
      const response = mockResponse();
      mallInspectionService.readSourceText.mockResolvedValue({
        text: null,
        error: 'not_found',
      } as never);

      await controller.getObjectSource(request({ id: '3339' }), response);

      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.send).not.toHaveBeenCalled();
    });

    it('returns 422 with the reason when the file cannot be decoded', async () => {
      const response = mockResponse();
      mallInspectionService.readSourceText.mockResolvedValue({
        text: null,
        error: 'gzip_corrupt',
      } as never);

      await controller.getObjectSource(request({ id: '3339' }), response);

      expect(response.status).toHaveBeenCalledWith(422);
      expect(response.json).toHaveBeenCalledWith({ error: 'gzip_corrupt' });
    });

    it('returns 400 for a non-numeric id without reading anything', async () => {
      const response = mockResponse();

      await controller.getObjectSource(request({ id: 'nope' }), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallInspectionService.readSourceText).not.toHaveBeenCalled();
    });
  });

  describe('exportMallData', () => {
    function streamingResponse() {
      const response = mockResponse();
      response.end = jest.fn();
      response.write = jest.fn().mockReturnValue(true);
      response.once = jest.fn();
      return response;
    }

    it('streams for a Mall staff member and closes the response', async () => {
      const response = streamingResponse();
      mallExportService.export.mockResolvedValue('complete' as never);

      await controller.exportMallData(request({}, {}), response);

      expect(mallExportService.export).toHaveBeenCalledTimes(1);
      expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
      expect(response.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.end).toHaveBeenCalled();
    });

    it('defaults to the cheap mode, with no WRL reads', async () => {
      const response = streamingResponse();
      mallExportService.export.mockResolvedValue('complete' as never);

      await controller.exportMallData(request({}, {}), response);

      expect(mallExportService.export.mock.calls[0][1])
        .toEqual(expect.objectContaining({ includeDerived: false }));
    });

    it('opts into derived metadata only when explicitly asked', async () => {
      const response = streamingResponse();
      mallExportService.export.mockResolvedValue('complete' as never);

      await controller.exportMallData(request({}, { derived: '1' }), response);

      expect(mallExportService.export.mock.calls[0][1])
        .toEqual(expect.objectContaining({ includeDerived: true }));
    });

    it('denies an ordinary member before a single byte is written', async () => {
      const response = streamingResponse();
      mallService.canAdmin.mockResolvedValue(false);

      await controller.exportMallData(request({}, {}), response);

      expect(response.status).toHaveBeenCalledWith(400);
      expect(mallExportService.export).not.toHaveBeenCalled();
      expect(response.write).not.toHaveBeenCalled();
      expect(response.end).not.toHaveBeenCalled();
    });

    it('still closes the response when the export throws', async () => {
      const response = streamingResponse();
      mallExportService.export.mockRejectedValue(new Error('boom') as never);

      await controller.exportMallData(request({}, {}), response);

      expect(response.end).toHaveBeenCalled();
    });
  });
});
