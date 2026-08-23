import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createSpyObj } from 'jest-createspyobj';

import {
  createResponseWriter,
  ExportWriter,
  MallExportService,
  MAX_DURATION_MS,
} from './mall-export.service';
import { ObjectSourceService } from '../object-source/object-source.service';
import {
  MallRepository,
  MemberRepository,
  ObjectInstanceRepository,
  ObjectRepository,
  PlaceRepository,
} from '../../repositories';

const VRML = `#VRML V2.0 utf8
WorldInfo {
  title "Pocket Moon Playset"
  info [ "Made By: BassMekanik" "Mall Price: 75 CC" "Limited To: UNLIMITED" ]
}
Shape { appearance Appearance { texture ImageTexture { url "moon.jpg" } } }
`;

/**
 * Objects chosen so the fixture exercises every branch that matters: a sold-out
 * object that must appear in two views at once, an object with no creator, and
 * one whose file is missing from disk.
 */
const OBJECTS = [
  {
    id: 10, directory: 'uuid-a', filename: 'a.wrl', image: 'a.jpg', texture: null,
    member_id: 100, name: 'Pocket Moon Playset', quantity: 25, limit: null, price: 75,
    status: 1, created_at: '2026-08-20T08:02:43.000Z', updated_at: '2026-08-20T08:02:43.000Z',
    mall_expiration: null, description: null, position: '{"x":0,"y":1.75,"z":0}',
    rotation: '{"x":0,"y":0,"z":0,"angle":0}',
  },
  {
    id: 11, directory: 'uuid-b', filename: 'b.wrl', image: 'b.jpg', texture: null,
    member_id: null, name: 'Orphan', quantity: 5, limit: null, price: 20,
    status: 2, created_at: '2026-08-21T09:00:00.000Z', updated_at: '2026-08-21T09:00:00.000Z',
    mall_expiration: null, description: null, position: null, rotation: null,
  },
  {
    id: 12, directory: 'uuid-c', filename: 'gone.wrl', image: 'c.jpg', texture: null,
    member_id: 100, name: 'Broken', quantity: 10, limit: null, price: 30,
    status: 1, created_at: '2026-08-22T09:00:00.000Z', updated_at: '2026-08-22T09:00:00.000Z',
    mall_expiration: null, description: null, position: null, rotation: null,
  },
];

const VIEW_ROWS = OBJECTS.map(object => ({
  id: object.id,
  status: object.status,
  quantity: object.quantity,
  limit: object.limit,
}));

/** Object 10 is fully sold, so it belongs to stocked AND outOfStock. */
const COUNTS = { 10: 25, 12: 3 };

const STORES = { 10: { id: 1205, name: 'Toy Store', object_id: 10 } };

function collectingWriter(): ExportWriter & { body(): string } {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return Promise.resolve();
    },
    isClosed() {
      return false;
    },
    body() {
      return chunks.join('');
    },
  };
}

describe('MallExportService', () => {
  let assetsDir: string;
  let objectRoot: string;
  let originalAssetsDir: string | undefined;
  let objectRepository: jest.Mocked<ObjectRepository>;
  let objectInstanceRepository: jest.Mocked<ObjectInstanceRepository>;
  let mallRepository: jest.Mocked<MallRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let sourceService: ObjectSourceService;
  let service: MallExportService;

  function writeAsset(directory: string, filename: string, contents: Buffer | string): void {
    const target = path.join(objectRoot, directory);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, filename), contents);
  }

  async function runExport(includeDerived = false, now?: () => number): Promise<any> {
    const writer = collectingWriter();
    const status = await service.export(writer, { includeDerived, now });
    return { status, raw: writer.body(), document: JSON.parse(writer.body()) };
  }

  beforeEach(() => {
    originalAssetsDir = process.env.ASSETS_DIR;
    assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctr-export-'));
    objectRoot = path.join(assetsDir, 'object');
    fs.mkdirSync(objectRoot, { recursive: true });
    process.env.ASSETS_DIR = assetsDir;

    writeAsset('uuid-a', 'a.wrl', zlib.gzipSync(Buffer.from(VRML)));
    writeAsset('uuid-a', 'a.jpg', Buffer.alloc(16));
    writeAsset('uuid-a', 'moon.jpg', Buffer.alloc(16));
    writeAsset('uuid-b', 'b.wrl', VRML);
    writeAsset('uuid-b', 'b.jpg', Buffer.alloc(16));

    objectRepository = createSpyObj(ObjectRepository);
    objectInstanceRepository = createSpyObj(ObjectInstanceRepository);
    mallRepository = createSpyObj(MallRepository);
    memberRepository = createSpyObj(MemberRepository);
    placeRepository = createSpyObj(PlaceRepository);
    sourceService = new ObjectSourceService();

    objectRepository.findViewRows.mockResolvedValue(VIEW_ROWS as never);
    objectRepository.findPageForExport.mockImplementation(
      (limit: number, offset: number) =>
        Promise.resolve(OBJECTS.slice(offset, offset + limit)) as never,
    );
    objectInstanceRepository.countAllByObjectId.mockResolvedValue(COUNTS as never);
    mallRepository.getAllStoresByObjectId.mockResolvedValue(STORES as never);
    memberRepository.findByIds.mockResolvedValue(
      { 100: { id: 100, username: 'BassMekanik' } } as never,
    );
    placeRepository.findAllStores.mockResolvedValue([
      { id: 1205, name: 'Toy Store', slug: 'toystore', status: 1, assets_dir: '/srv/secret' },
    ] as never);

    service = new MallExportService(
      objectRepository,
      objectInstanceRepository,
      mallRepository,
      memberRepository,
      placeRepository,
      sourceService,
    );
  });

  afterEach(() => {
    process.env.ASSETS_DIR = originalAssetsDir;
    fs.rmSync(assetsDir, { recursive: true, force: true });
  });

  describe('document shape', () => {
    it('is valid JSON with result written last', async () => {
      const { raw, document } = await runExport();
      const keys = Object.keys(document);

      expect(keys[keys.length - 1]).toBe('result');
      expect(raw.trimEnd().endsWith('}')).toBe(true);
      expect(raw.indexOf('"result"')).toBeGreaterThan(raw.indexOf('"objects"'));
    });

    it('reports complete only after the work is done', async () => {
      const { status, document } = await runExport();

      expect(status).toBe('complete');
      expect(document.result.status).toBe('complete');
      expect(document.result.objectsWritten).toBe(3);
    });

    it('cannot be mistaken for complete if the stream is cut short', async () => {
      const { raw } = await runExport();
      const truncated = raw.slice(0, Math.floor(raw.length * 0.8));

      expect(() => JSON.parse(truncated)).toThrow();
    });

    it('emits objects in ascending id order', async () => {
      const { document } = await runExport();

      expect(document.objects.map((object: any) => object.id)).toEqual([10, 11, 12]);
    });

    it('names the schema version and generator', async () => {
      const { document } = await runExport();

      expect(document.schema.schemaVersion).toBe('1.0.0');
      expect(document.schema.generator).toMatch(/^ctr-mall-export\//);
    });
  });

  describe('ctrViews', () => {
    it('keeps stocked and outOfStock as independent, overlapping memberships',
      async () => {
        const { document } = await runExport();

        expect(document.ctrViews.stocked).toContain(10);
        expect(document.ctrViews.outOfStock).toContain(10);
        expect(document.ctrViews.pending).toEqual([11]);
      });

    it('publishes the predicate behind every view', async () => {
      const { document } = await runExport();

      expect(document.ctrViews._definitions.outOfStock).toContain('object.status = 1');
      expect(document.ctrViews._note).toContain('overlap');
    });

    it('matches the sizes reported in the trailing result', async () => {
      const { document } = await runExport();
      const sizes = document.result.counts.ctrViewSizes;

      Object.keys(sizes).forEach(view => {
        expect(document.ctrViews[view].length).toBe(sizes[view]);
      });
    });

    it('reports byStatus counts that match the repository rows', async () => {
      const { document } = await runExport();

      expect(document.result.counts.byStatus).toEqual({ '1': 2, '2': 1 });
      expect(document.result.counts.objects).toBe(3);
    });

    it('defines every aggregate it reports', async () => {
      const { document } = await runExport();

      expect(Object.keys(document.result.counts._definitions).sort())
        .toEqual(['byStatus', 'ctrViewSizes', 'objects', 'stores']);
    });
  });

  describe('field discipline', () => {
    it('preserves a null creator instead of inventing "Deleted User"', async () => {
      const { document, raw } = await runExport();
      const orphan = document.objects.find((object: any) => object.id === 11);

      expect(orphan.creator).toEqual({ memberId: null, username: null });
      expect(raw).not.toContain('Deleted User');
    });

    it('exports the raw limit and derives no unlimited flag', async () => {
      const { document } = await runExport();
      const object = document.objects[0];

      expect(object.limit).toBeNull();
      expect(object).not.toHaveProperty('unlimited');
    });

    it('does not synthesize a remaining count', async () => {
      const { document } = await runExport();

      expect(document.objects[0]).not.toHaveProperty('remaining');
    });

    it('calls the asset directory what it is, not a uuid', async () => {
      const { document } = await runExport();

      expect(document.objects[0].assetDirectory).toBe('uuid-a');
      expect(document.objects[0]).not.toHaveProperty('uuid');
    });

    it('does not attach an ambiguous object count to stores', async () => {
      const { document } = await runExport();

      expect(document.stores[0]).not.toHaveProperty('objectCount');
      expect(Object.keys(document.stores[0]).sort())
        .toEqual(['id', 'name', 'slug', 'status']);
    });

    it('states that timestamps are not normalized', async () => {
      const { document } = await runExport();

      expect(document.schema.timestamps.normalized).toBe(false);
      expect(document.schema.timestamps.note).toContain('NOT relabelled');
    });
  });

  describe('privacy', () => {
    it('leaks no filesystem paths or server internals', async () => {
      const { raw } = await runExport(true);

      expect(raw).not.toContain(assetsDir);
      expect(raw).not.toContain(os.tmpdir());
      expect(raw).not.toContain('/srv/secret');
      expect(raw).not.toMatch(/"password"|"email"|"token"|"wallet"/);
    });

    it('references assets by public url only', async () => {
      const { document } = await runExport();

      expect(document.objects[0].assets.wrl.url).toBe('/assets/object/uuid-a/a.wrl');
    });
  });

  describe('derived=0 is genuinely cheap', () => {
    it('omits every derived block', async () => {
      const { document } = await runExport(false);

      document.objects.forEach((object: any) => {
        expect(object).not.toHaveProperty('derived');
      });
      expect(document.schema.includesDerived).toBe(false);
      expect(document.result).not.toHaveProperty('derived');
    });

    it('performs no filesystem access at all', async () => {
      const readSource = jest.spyOn(sourceService, 'readSource');
      const readAsset = jest.spyOn(sourceService, 'readAssetMetadata');

      await runExport(false);

      expect(readSource).not.toHaveBeenCalled();
      expect(readAsset).not.toHaveBeenCalled();
    });
  });

  describe('derived=1', () => {
    it('reports stored and decoded bytes separately, plus the encoding', async () => {
      const { document } = await runExport(true);
      const object = document.objects.find((entry: any) => entry.id === 10);

      expect(object.derived.wrl.encoding).toBe('gzip');
      expect(object.derived.wrl.storedBytes).toBeLessThan(object.derived.wrl.decodedBytes);
      expect(object.derived.wrl.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('carries WorldInfo, node counts and comparisons', async () => {
      const { document } = await runExport(true);
      const object = document.objects.find((entry: any) => entry.id === 10);

      expect(object.derived.worldInfo[0].title).toBe('Pocket Moon Playset');
      expect(object.derived.nodeCounts.ImageTexture).toBe(1);
      expect(object.derived.comparisons.find((c: any) => c.field === 'price').verdict)
        .toBe('MATCH');
    });

    it('keeps a broken object in the export and records why it failed', async () => {
      const { document } = await runExport(true);
      const broken = document.objects.find((entry: any) => entry.id === 12);

      expect(broken).toBeDefined();
      expect(broken.derived.sourceError).toBe('missing');
      expect(broken.derived.worldInfo).toBeNull();
      expect(document.result.derived.failed).toBe(1);
      expect(document.result.derived.failuresByReason.missing).toBe(1);
      expect(document.result.status).toBe('complete');
    });

    it('tallies attempts, successes and failures', async () => {
      const { document } = await runExport(true);

      expect(document.result.derived.attempted).toBe(3);
      expect(document.result.derived.succeeded).toBe(2);
      expect(document.result.derived.failed).toBe(1);
    });
  });

  describe('budgets', () => {
    it('reports truncation rather than silently returning a short dataset',
      async () => {
        // A clock that jumps past the budget as soon as the first page is done.
        let calls = 0;
        const now = () => {
          calls += 1;
          return calls > 2 ? MAX_DURATION_MS + 1000 : 0;
        };

        const { status, document } = await runExport(false, now);

        expect(status).toBe('truncated');
        expect(document.result.status).toBe('truncated');
        expect(document.result.truncation.reason).toBe('time_budget');
        expect(document.result.truncation.limitMs).toBe(MAX_DURATION_MS);
      });

    it('stops reading when the client goes away', async () => {
      const writer: ExportWriter = {
        write: () => Promise.resolve(),
        isClosed: () => true,
      };

      const status = await service.export(writer, { includeDerived: false });

      expect(status).toBe('failed');
      expect(objectRepository.findPageForExport).not.toHaveBeenCalled();
    });
  });
});

describe('createResponseWriter', () => {
  function fakeResponse(writeResults: boolean[]) {
    const drains: (() => void)[] = [];
    return {
      written: [] as string[],
      writableEnded: false,
      destroyed: false,
      write(chunk: string) {
        this.written.push(chunk);
        return writeResults.length ? writeResults.shift() : true;
      },
      once(event: string, handler: () => void) {
        if (event === 'drain') {
          drains.push(handler);
        }
      },
      flush() {
        drains.splice(0).forEach(handler => handler());
      },
      pendingDrains: () => drains.length,
    };
  }

  it('resolves immediately when the socket accepts the write', async () => {
    const response = fakeResponse([true]);

    await createResponseWriter(response).write('chunk');

    expect(response.written).toEqual(['chunk']);
  });

  it('waits for drain when the socket signals backpressure', async () => {
    const response = fakeResponse([false]);
    const writer = createResponseWriter(response);
    let settled = false;

    const pending = writer.write('big chunk').then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(response.pendingDrains()).toBe(1);

    response.flush();
    await pending;

    expect(settled).toBe(true);
  });

  it('reports a finished or destroyed response as closed', () => {
    const response = fakeResponse([]);
    expect(createResponseWriter(response).isClosed()).toBe(false);

    response.destroyed = true;
    expect(createResponseWriter(response).isClosed()).toBe(true);
  });
});
