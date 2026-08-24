import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createSpyObj } from 'jest-createspyobj';

import {
  createResponseWriter,
  ExportAborted,
  exportFilename,
  ExportWriter,
  MallExportService,
  MAX_DURATION_MS,
  MAX_OBJECTS,
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
 * Objects chosen so the fixture exercises every branch that matters: a placed
 * object with a store and sales, an object with no creator, and one whose file
 * is missing from disk.
 *
 * All pending, because pending is all the export ever sees now.
 */
/** CTR status 2. Mirrors `PENDING_STATUS` in ObjectRepository. */
const PENDING_STATUS = 2;

const OBJECTS = [
  {
    id: 10, directory: 'uuid-a', filename: 'a.wrl', image: 'a.jpg', texture: null,
    member_id: 100, name: 'Pocket Moon Playset', quantity: 25, limit: null, price: 75,
    status: 2, created_at: '2026-08-20T08:02:43.000Z', updated_at: '2026-08-20T08:02:43.000Z',
    mall_expiration: null, description: null,
  },
  {
    id: 11, directory: 'uuid-b', filename: 'b.wrl', image: 'b.jpg', texture: null,
    member_id: null, name: 'Orphan', quantity: 5, limit: null, price: 20,
    status: 2, created_at: '2026-08-21T09:00:00.000Z', updated_at: '2026-08-21T09:00:00.000Z',
    mall_expiration: null, description: null,
  },
  {
    id: 12, directory: 'uuid-c', filename: 'gone.wrl', image: 'c.jpg', texture: null,
    member_id: 100, name: 'Broken', quantity: 10, limit: null, price: 30,
    status: 2, created_at: '2026-08-22T09:00:00.000Z', updated_at: '2026-08-22T09:00:00.000Z',
    mall_expiration: null, description: null,
  },
];

const VIEW_ROWS = OBJECTS.map(object => ({
  id: object.id,
  status: object.status,
  quantity: object.quantity,
  limit: object.limit,
}));

/** Part-sold; a pending object is in the `pending` view whatever its sales. */
const COUNTS = { 10: 5, 12: 3 };

// Shaped exactly as `getAllStoresByObjectId` returns it: `place.*` plus the
// object id and the aliased placement columns from `mall_object`. Putting
// position/rotation on an `object.*` row instead would test a query that does
// not exist.
const STORES = {
  10: {
    id: 1205,
    name: 'Toy Store',
    object_id: 10,
    mall_position: '{"x":0,"y":1.75,"z":0}',
    mall_rotation: '{"x":0,"y":0,"z":0,"angle":0}',
  },
};

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
    const preflight = await service.preflight();
    const status = await service.export(writer, { includeDerived, now }, preflight);
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

    // Both queries filter to pending in SQL, so the mocks filter too: a mock that
    // returned stocked rows would let a scope regression pass unnoticed.
    objectRepository.findViewRows.mockResolvedValue(
      VIEW_ROWS.filter(row => row.status === PENDING_STATUS) as never,
    );
    objectRepository.findPageForExport.mockImplementation(
      (limit: number, offset: number) =>
        Promise.resolve(
          OBJECTS.filter(object => object.status === PENDING_STATUS)
            .slice(offset, offset + limit),
        ) as never,
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

      expect(document.schema.schemaVersion).toBe('2.0.0');
      expect(document.schema.generator).toMatch(/^ctr-mall-export\//);
    });
  });

  describe('ctrViews', () => {
    it('declares its pending-only scope in the schema', async () => {
      const { document } = await runExport();

      expect(document.schema.scope.objects).toBe('pending');
      expect(document.schema.scope.note).toMatch(/status 2/);
      // A consumer reading `stores` must not conclude the catalogue is here.
      expect(document.schema.scope.note).toMatch(/stores/);
    });

    it('lists every exported object under pending and nothing under the rest',
      async () => {
        const { document } = await runExport();

        expect(document.ctrViews.pending).toEqual([10, 11, 12]);
        // Empty by construction, not by accident: a pending object cannot be
        // stocked, warehoused or sold out. Keeping the keys means a consumer
        // never has to special-case their absence.
        ['stocked', 'warehouse', 'outOfStock', 'removed', 'inactive'].forEach(view => {
          expect(document.ctrViews[view]).toEqual([]);
        });
      });

    it('publishes the predicate behind every view', async () => {
      const { document } = await runExport();

      expect(document.ctrViews._definitions.outOfStock).toContain('object.status = 1');
      expect(document.ctrViews._note).toContain('pending-only');
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

      expect(document.result.counts.byStatus).toEqual({ '2': 3 });
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

      const preflight = await service.preflight();
      const status = await service.export(writer, { includeDerived: false }, preflight);

      expect(status).toBe('failed');
      expect(objectRepository.findPageForExport).not.toHaveBeenCalled();
    });
  });

  describe('MallExportService - placement is a mall_object fact', () => {
    it('emits the stored placement for a placed object', async () => {
      const { document } = await runExport();
      const placed = document.objects.find((entry: any) => entry.id === 10);

      expect(placed.store).toEqual({ id: 1205, name: 'Toy Store' });
      expect(placed.placement).toEqual({
        position: { x: 0, y: 1.75, z: 0 },
        rotation: { x: 0, y: 0, z: 0, angle: 0 },
      });
    });

    it('emits null placement for an object that is in no store', async () => {
      const { document } = await runExport();
      const unplaced = document.objects.find((entry: any) => entry.id === 11);

      expect(unplaced.store).toBeNull();
      expect(unplaced.placement).toBeNull();
    });

    it('emits exactly one row per object', async () => {
      // Placement is read from the keyed store map rather than joined onto the
      // page query, so a second mall_object row for one object cannot duplicate
      // an export entry.
      const { document } = await runExport();
      const ids = document.objects.map((entry: any) => entry.id);

      expect(ids).toEqual(OBJECTS.map(object => object.id));
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  /**
   * The cap is the one place an export can quietly become a partial dataset, so
   * all three sides of the boundary are pinned. A catalogue of exactly
   * MAX_OBJECTS is complete -- nothing was left behind -- and reporting it as
   * truncated would send staff hunting for objects that do not exist.
   */
  describe('the MAX_OBJECTS boundary', () => {
    function catalogueOf(count: number): any[] {
      const template = OBJECTS[1]; // no stores, no counts: the cheapest row to build
      const rows = new Array(count);
      for (let index = 0; index < count; index += 1) {
        rows[index] = { ...template, id: 1000 + index, name: `Object ${index}` };
      }
      return rows;
    }

    async function exportCatalogue(count: number): Promise<any> {
      const rows = catalogueOf(count);
      objectRepository.findPageForExport.mockImplementation(
        (limit: number, offset: number) =>
          Promise.resolve(rows.slice(offset, offset + limit)) as never,
      );
      objectRepository.findViewRows.mockResolvedValue([] as never);
      return runExport();
    }

    it('reports complete one object below the cap', async () => {
      const { document } = await exportCatalogue(MAX_OBJECTS - 1);
      expect(document.result.status).toBe('complete');
      expect(document.result.truncation).toBeNull();
      expect(document.objects.length).toBe(MAX_OBJECTS - 1);
    });

    it('reports complete at exactly the cap', async () => {
      const { document } = await exportCatalogue(MAX_OBJECTS);
      expect(document.result.status).toBe('complete');
      expect(document.result.truncation).toBeNull();
      expect(document.objects.length).toBe(MAX_OBJECTS);
    });

    it('reports truncated one object above the cap, with a usable cursor', async () => {
      const { document } = await exportCatalogue(MAX_OBJECTS + 1);
      expect(document.result.status).toBe('truncated');
      expect(document.result.truncation.reason).toBe('object_cap');
      expect(document.result.truncation.limit).toBe(MAX_OBJECTS);
      expect(document.objects.length).toBe(MAX_OBJECTS);
      // The id of the last object actually emitted, not a count of them.
      expect(document.result.truncation.lastObjectId)
        .toBe(document.objects[document.objects.length - 1].id);
    });
  });
});

describe('createResponseWriter', () => {
  /**
   * A real EventEmitter, because the bug this guards against is precisely that
   * the writer waited on an event a dead socket never emits. A hand-rolled stub
   * that only records `drain` handlers cannot express that.
   */
  class FakeResponse extends EventEmitter {
    public written: string[] = [];
    public writableEnded = false;
    public destroyed = false;
    private results: boolean[];

    constructor(writeResults: boolean[] = []) {
      super();
      this.results = writeResults;
    }

    public write(chunk: string): boolean {
      this.written.push(chunk);
      return this.results.length ? (this.results.shift() as boolean) : true;
    }

    /** Every listener the writer could have left behind. */
    public waiters(): number {
      return this.listenerCount('drain')
        + this.listenerCount('close')
        + this.listenerCount('error');
    }
  }

  it('resolves immediately when the socket accepts the write', async () => {
    const response = new FakeResponse([true]);

    await createResponseWriter(response).write('chunk');

    expect(response.written).toEqual(['chunk']);
    expect(response.waiters()).toBe(0);
  });

  it('continues once the socket drains', async () => {
    const response = new FakeResponse([false]);
    let settled = false;

    const pending = createResponseWriter(response).write('big chunk').then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(response.waiters()).toBe(3);

    response.emit('drain');
    await pending;

    expect(settled).toBe(true);
    expect(response.waiters()).toBe(0);
  });

  it('aborts when the client disconnects instead of draining', async () => {
    const response = new FakeResponse([false]);

    const pending = createResponseWriter(response).write('big chunk');
    await Promise.resolve();
    expect(response.waiters()).toBe(3);

    response.emit('close');

    await expect(pending).rejects.toBeInstanceOf(ExportAborted);
    expect(response.waiters()).toBe(0);
  });

  it('aborts when the socket errors instead of draining', async () => {
    const response = new FakeResponse([false]);

    const pending = createResponseWriter(response).write('big chunk');
    await Promise.resolve();

    response.emit('error', new Error('ECONNRESET'));

    await expect(pending).rejects.toBeInstanceOf(ExportAborted);
    expect(response.waiters()).toBe(0);
  });

  it('never leaves a write pending on a socket that will not drain', async () => {
    const response = new FakeResponse([false]);
    let settled = false;

    createResponseWriter(response).write('big chunk')
      .then(() => { settled = true; }, () => { settled = true; });

    response.emit('close');
    await new Promise(resolve => setImmediate(resolve));

    expect(settled).toBe(true);
  });

  it('refuses to write to an already destroyed response', async () => {
    const response = new FakeResponse([]);
    response.destroyed = true;

    await expect(createResponseWriter(response).write('chunk'))
      .rejects.toBeInstanceOf(ExportAborted);
    expect(response.written).toEqual([]);
  });

  it('reports a finished or destroyed response as closed', () => {
    const response = new FakeResponse([]);
    expect(createResponseWriter(response).isClosed()).toBe(false);

    response.destroyed = true;
    expect(createResponseWriter(response).isClosed()).toBe(true);
  });
});

describe('exportFilename', () => {
  it('stamps the download in UTC with no character illegal in a filename', () => {
    const name = exportFilename(new Date(Date.UTC(2026, 7, 23, 12, 19, 22, 500)));

    expect(name).toBe('ctr-mall-export-2026-08-23T121922Z.json');
    expect(name).not.toMatch(/[:\\/]/);
  });

});
