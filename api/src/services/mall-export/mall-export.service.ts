import { Service } from 'typedi';

import {
  MallRepository,
  MemberRepository,
  ObjectInstanceRepository,
  ObjectRepository,
  PlaceRepository,
} from '../../repositories';
import {
  compareWorldInfo,
  CTR_VIEW_DEFINITIONS,
  ctrViewsFor,
  externalReferences,
  scanVrml,
  statusName,
  summariseNodeCounts,
  textureReferences,
} from '../../libs';
import { ObjectSourceService } from '../object-source/object-source.service';

/**
 * Streams CTR's authoritative Mall dataset as one deterministic JSON document.
 *
 * Two shape decisions are load-bearing:
 *
 * 1. The completion record is written LAST. Counts, per-object failures and the
 *    overall outcome are not known until the work is done, so putting them in a
 *    header streamed first would mean either guessing or lying. A consumer must
 *    check `result.status === 'complete'`; a stream that was cut off has no
 *    `result` at all and will not even parse, so a partial file can never be
 *    mistaken for a dataset.
 *
 * 2. `derived=0` touches the filesystem zero times. It is pure SQL, so a missing
 *    or corrupt upload cannot affect it and it stays fast over the whole
 *    catalogue.
 */

export const EXPORT_SCHEMA_VERSION = '1.0.0';
export const EXPORT_GENERATOR = 'ctr-mall-export/1.0.0';

/** Objects read per page while streaming. Bounds peak memory, not total output. */
const PAGE_SIZE = 200;

/** Wall-clock budget for one export. Exceeding it truncates rather than hangs. */
export const MAX_DURATION_MS = 120000;

/** Backstop against an unbounded catalogue. Exceeding it truncates. */
export const MAX_OBJECTS = 50000;

export type ExportStatus = 'complete' | 'truncated' | 'failed';

export interface ExportWriter {
  write(chunk: string): Promise<void>;
  isClosed(): boolean;
}

export interface ExportOptions {
  includeDerived: boolean;
  /** Injected so specs can drive the clock rather than wait on it. */
  now?: () => number;
}

/**
 * Wraps an Express response so writes respect Node's backpressure signal.
 *
 * `response.write` returning false means the outbound buffer is full; ignoring
 * it lets a slow client drive the process's memory up while the export keeps
 * reading files as fast as it can.
 */
export function createResponseWriter(response: any): ExportWriter {
  return {
    write(chunk: string): Promise<void> {
      if (response.write(chunk)) {
        return Promise.resolve();
      }
      return new Promise<void>(resolve => response.once('drain', resolve));
    },
    isClosed(): boolean {
      return !!(response.writableEnded || response.destroyed);
    },
  };
}

function assetUrl(directory: string | null, filename: string | null): string | null {
  if (!directory || !filename) {
    return null;
  }
  return `/assets/object/${directory}/${filename}`;
}

@Service()
export class MallExportService {
  constructor(
    private objectRepository: ObjectRepository,
    private objectInstanceRepository: ObjectInstanceRepository,
    private mallRepository: MallRepository,
    private memberRepository: MemberRepository,
    private placeRepository: PlaceRepository,
    private objectSourceService: ObjectSourceService,
  ) {}

  public async export(writer: ExportWriter, options: ExportOptions): Promise<ExportStatus> {
    const now = options.now || (() => Date.now());
    const startedAt = now();
    const startedIso = new Date(startedAt).toISOString();

    let status: ExportStatus = 'complete';
    let truncation: any = null;
    let objectsWritten = 0;
    const derivedTally = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      failuresByReason: {} as { [reason: string]: number },
    };

    try {
      await writer.write(`{"schema":${JSON.stringify(this.buildSchema(startedIso, options))}`);

      const stores = await this.placeRepository.findAllStores('name');
      await writer.write(`,"stores":${JSON.stringify(stores.map((store: any) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
      })))}`);

      const viewRows = await this.objectRepository.findViewRows();
      const allCounts = await this.objectInstanceRepository.countAllByObjectId();
      await writer.write(`,"ctrViews":${JSON.stringify(this.buildViews(viewRows, allCounts))}`);

      const allStores = await this.mallRepository.getAllStoresByObjectId();

      await writer.write(',"objects":[');
      let offset = 0;
      let first = true;

      for (;;) {
        if (writer.isClosed()) {
          status = 'failed';
          truncation = { reason: 'client_disconnected', lastObjectId: null };
          break;
        }
        if (now() - startedAt > MAX_DURATION_MS) {
          status = 'truncated';
          truncation = {
            reason: 'time_budget',
            limitMs: MAX_DURATION_MS,
            lastObjectId: null,
          };
          break;
        }
        if (objectsWritten >= MAX_OBJECTS) {
          status = 'truncated';
          truncation = { reason: 'object_cap', limit: MAX_OBJECTS, lastObjectId: null };
          break;
        }

        const page = await this.objectRepository.findPageForExport(PAGE_SIZE, offset);
        if (!page.length) {
          break;
        }

        const members = await this.memberRepository.findByIds(
          page.map((row: any) => row.member_id).filter((id: any) => !!id),
        );

        for (const row of page) {
          const entry = await this.buildObject(row, {
            sold: allCounts[row.id] || 0,
            store: allStores[row.id] || null,
            member: row.member_id ? members[row.member_id] : null,
            includeDerived: options.includeDerived,
            derivedTally,
          });
          await writer.write(`${first ? '' : ','}\n${JSON.stringify(entry)}`);
          first = false;
          objectsWritten += 1;
          if (truncation) {
            truncation.lastObjectId = row.id;
          }
        }

        if (truncation) {
          truncation.lastObjectId = page[page.length - 1].id;
        }
        offset += PAGE_SIZE;
      }

      if (truncation && truncation.lastObjectId === null && objectsWritten > 0) {
        truncation.lastObjectId = objectsWritten;
      }

      await writer.write(']');
      await writer.write(`,"result":${JSON.stringify(this.buildResult({
        status,
        truncation,
        startedIso,
        startedAt,
        now,
        objectsWritten,
        storesCount: stores.length,
        viewRows,
        allCounts,
        includeDerived: options.includeDerived,
        derivedTally,
      }))}}`);
    } catch (error) {
      // The document is already partially written, so the only honest thing left
      // is to close it with a failed result rather than pretend it succeeded.
      status = 'failed';
      try {
        await writer.write(`],"result":${JSON.stringify({
          status: 'failed',
          reason: String((error as Error).message || error),
          finishedAt: new Date(now()).toISOString(),
          objectsWritten,
        })}}`);
      } catch (writeError) {
        // Nothing further can be reported to a broken stream.
      }
    }

    return status;
  }

  private buildSchema(startedIso: string, options: ExportOptions): any {
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generator: EXPORT_GENERATOR,
      startedAt: startedIso,
      includesDerived: options.includeDerived,
      timestamps: {
        source: 'MySQL TIMESTAMP columns via the mysql driver',
        connectionTimezoneOption: 'unset (driver default "local")',
        normalized: false,
        note: 'Emitted exactly as the CTR API already emits them, and NOT relabelled as '
          + 'UTC. The value depends on the API process timezone, which CTR does not '
          + 'currently pin. See the timezone follow-up.',
      },
      fieldClassification: {
        db: [
          'id', 'assetDirectory', 'name', 'creator.memberId', 'price', 'quantity', 'limit',
          'status', 'store', 'placement', 'createdAt', 'updatedAt', 'mallExpiration',
          'description', 'assets.*.filename',
        ],
        count: ['sold'],
        asset: ['derived.wrl.storedBytes', 'derived.wrl.decodedBytes', 'derived.*.sha256'],
        derived: [
          'statusName', 'ctrViews', 'derived.vrmlHeader', 'derived.worldInfo',
          'derived.interpreted', 'derived.comparisons', 'derived.nodeCounts',
          'derived.textureReferences', 'derived.externalReferences', 'derived.viewpoints',
          'derived.warnings',
        ],
        absent: [
          'Mall Object Excellence / awards', 'reviewer or checked-by attribution',
          'category or object type', 'rejection reason', 'editorial catalog copy',
        ],
      },
    };
  }

  /**
   * The staff panel's six views as independent id lists.
   *
   * They overlap on purpose - a sold-out object is in both `stocked` and
   * `outOfStock` - so they are never collapsed into a single status label.
   */
  private buildViews(viewRows: any[], counts: { [id: number]: number }): any {
    const views: any = {
      _definitions: CTR_VIEW_DEFINITIONS,
      _note: 'Current CTR staff-panel view memberships, derived rather than stored. They '
        + 'overlap by design. outOfStock reproduces the Out of Stock page exactly, '
        + 'including its treatment of a zero limit.',
      pending: [],
      warehouse: [],
      stocked: [],
      outOfStock: [],
      removed: [],
      inactive: [],
    };

    viewRows.forEach(row => {
      const membership = ctrViewsFor({
        status: row.status,
        sold: counts[row.id] || 0,
        quantity: row.quantity,
        limit: row.limit === undefined ? null : row.limit,
      });
      Object.keys(membership).forEach(view => {
        if ((membership as any)[view]) {
          views[view].push(row.id);
        }
      });
    });

    return views;
  }

  private async buildObject(row: any, context: any): Promise<any> {
    const limit = row.limit === undefined ? null : row.limit;
    const entry: any = {
      id: row.id,
      assetDirectory: row.directory ?? null,
      name: row.name ?? null,
      creator: {
        memberId: row.member_id ?? null,
        username: context.member ? context.member.username : null,
      },
      price: row.price ?? null,
      quantity: row.quantity ?? null,
      limit,
      sold: context.sold,
      status: row.status,
      statusName: statusName(row.status),
      store: context.store ? { id: context.store.id, name: context.store.name } : null,
      placement: context.store
        ? { position: this.parseJson(row.position), rotation: this.parseJson(row.rotation) }
        : null,
      ctrViews: ctrViewsFor({
        status: row.status,
        sold: context.sold,
        quantity: row.quantity,
        limit,
      }),
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      mallExpiration: row.mall_expiration ?? null,
      description: row.description ?? null,
      assets: {
        thumbnail: {
          filename: row.image ?? null,
          url: assetUrl(row.directory, row.image),
        },
        wrl: {
          filename: row.filename ?? null,
          url: assetUrl(row.directory, row.filename),
        },
        texture: row.texture
          ? { filename: row.texture, url: assetUrl(row.directory, row.texture) }
          : null,
      },
    };

    if (context.includeDerived) {
      entry.derived = await this.buildDerived(row, context.derivedTally, entry);
    }

    return entry;
  }

  private async buildDerived(row: any, tally: any, entry: any): Promise<any> {
    tally.attempted += 1;

    const source = await this.objectSourceService.readSource({
      directory: row.directory,
      filename: row.filename,
    });

    const derived: any = {
      wrl: {
        storedBytes: source.storedBytes,
        encoding: source.encoding,
        decodedBytes: source.decodedBytes,
        sha256: source.sha256,
      },
      thumbnail: null,
      texture: null,
      vrmlHeader: null,
      worldInfo: null,
      interpreted: null,
      comparisons: null,
      nodeCounts: null,
      textureReferences: null,
      externalReferences: null,
      viewpoints: null,
      warnings: [],
      sourceError: source.error,
      parseError: null,
    };

    if (row.image) {
      const thumbnail = await this.objectSourceService.readAssetMetadata({
        directory: row.directory,
        filename: row.image,
      });
      derived.thumbnail = { bytes: thumbnail.bytes, sha256: thumbnail.sha256,
        error: thumbnail.error };
    }
    if (row.texture) {
      const texture = await this.objectSourceService.readAssetMetadata({
        directory: row.directory,
        filename: row.texture,
      });
      derived.texture = { bytes: texture.bytes, sha256: texture.sha256, error: texture.error };
    }

    if (source.error !== null || source.text === null) {
      tally.failed += 1;
      const reason = source.error || 'unreadable';
      tally.failuresByReason[reason] = (tally.failuresByReason[reason] || 0) + 1;
      return derived;
    }

    try {
      const scan = scanVrml(source.text);
      const comparison = compareWorldInfo(scan, {
        name: entry.name,
        creatorUsername: entry.creator.username,
        price: entry.price,
        limit: entry.limit,
        storeName: entry.store ? entry.store.name : null,
      });

      derived.vrmlHeader = scan.header;
      derived.worldInfo = scan.worldInfo;
      derived.interpreted = comparison.interpreted;
      derived.comparisons = comparison.comparisons;
      derived.nodeCounts = summariseNodeCounts(scan);
      derived.textureReferences = textureReferences(scan);
      derived.externalReferences = externalReferences(scan);
      derived.viewpoints = scan.viewpoints;
      derived.warnings = scan.warnings;
      tally.succeeded += 1;
    } catch (error) {
      derived.parseError = String((error as Error).message || error);
      tally.failed += 1;
      tally.failuresByReason.parse_error = (tally.failuresByReason.parse_error || 0) + 1;
    }

    return derived;
  }

  /** Written last, so every number in it is measured rather than predicted. */
  private buildResult(context: any): any {
    const byStatus: { [status: string]: number } = {};
    const viewSizes: { [view: string]: number } = {
      pending: 0, warehouse: 0, stocked: 0, outOfStock: 0, removed: 0, inactive: 0,
    };

    context.viewRows.forEach((row: any) => {
      byStatus[String(row.status)] = (byStatus[String(row.status)] || 0) + 1;
      const membership = ctrViewsFor({
        status: row.status,
        sold: context.allCounts[row.id] || 0,
        quantity: row.quantity,
        limit: row.limit === undefined ? null : row.limit,
      });
      Object.keys(viewSizes).forEach(view => {
        if ((membership as any)[view]) {
          viewSizes[view] += 1;
        }
      });
    });

    const result: any = {
      status: context.status,
      finishedAt: new Date(context.now()).toISOString(),
      durationMs: context.now() - context.startedAt,
      objectsWritten: context.objectsWritten,
      counts: {
        _takenAt: context.startedIso,
        _definitions: {
          stores: 'place WHERE type = \'shop\' AND status = 1',
          objects: 'COUNT(object)',
          byStatus: 'COUNT(object) GROUP BY object.status',
          ctrViewSizes: 'length of each ctrViews list; predicates in ctrViews._definitions',
        },
        stores: context.storesCount,
        objects: context.viewRows.length,
        byStatus,
        ctrViewSizes: viewSizes,
      },
      truncation: context.truncation,
    };

    if (context.includeDerived) {
      result.derived = context.derivedTally;
    }

    return result;
  }

  private parseJson(value: any): any {
    if (typeof value !== 'string' || value === '') {
      return null;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
}
