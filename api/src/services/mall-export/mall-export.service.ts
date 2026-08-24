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

export const EXPORT_SCHEMA_VERSION = '2.0.0';
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

/** Everything global the document needs, gathered before the body opens. */
export interface ExportPreflight {
  stores: any[];
  viewRows: any[];
  allCounts: { [objectId: string]: number };
  allStores: { [objectId: string]: any };
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
/**
 * Raised when the client goes away mid-export.
 *
 * Distinct from a server fault: it carries a stable public code and tells the
 * export loop to stop rather than keep reading files for a socket nobody is
 * listening to.
 */
export class ExportAborted extends Error {
  public readonly code: string;

  constructor(code = 'export_aborted') {
    super(code);
    this.name = 'ExportAborted';
    this.code = code;
  }
}

/**
 * Client-visible failure codes.
 *
 * Export payloads get downloaded and passed around, so they carry a stable code
 * rather than an exception message: raw messages here have been observed to
 * contain absolute filesystem paths.
 */
export const EXPORT_ERROR_CODES = {
  aborted: 'export_aborted',
  preflightFailed: 'export_preflight_failed',
  budgetExceeded: 'export_budget_exceeded',
  sourceUnreadable: 'source_unreadable',
  failed: 'export_failed',
};

/** Maps any thrown value onto a code that is safe to put in the document. */
export function publicErrorCode(error: unknown): string {
  if (error instanceof ExportAborted) {
    return error.code;
  }
  return EXPORT_ERROR_CODES.failed;
}

export function createResponseWriter(response: any): ExportWriter {
  const isClosed = (): boolean => !!(response.writableEnded || response.destroyed);

  return {
    write(chunk: string): Promise<void> {
      if (isClosed()) {
        return Promise.reject(new ExportAborted());
      }
      if (response.write(chunk)) {
        return Promise.resolve();
      }
      // A destroyed or ended response never emits `drain`, so waiting on that
      // alone leaks this promise -- and with it the whole export handler -- for
      // every client that disconnects while the buffer is full.
      return new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          response.removeListener('drain', onDrain);
          response.removeListener('close', onTerminate);
          response.removeListener('error', onTerminate);
        };
        const onDrain = (): void => {
          cleanup();
          resolve();
        };
        const onTerminate = (): void => {
          cleanup();
          reject(new ExportAborted());
        };
        response.once('drain', onDrain);
        response.once('close', onTerminate);
        response.once('error', onTerminate);
      });
    },
    isClosed,
  };
}

/**
 * Download name for one export.
 *
 * Colons are legal in a URL but not in a Windows filename, so the ISO time is
 * emitted without them. UTC throughout -- this stamps when the download was
 * made, which is a separate question from how the database's own timestamps
 * should be read.
 */
export function exportFilename(at: Date): string {
  const stamp = at.toISOString().split('.')[0].replace(/:/g, '');
  return `ctr-mall-export-${stamp}Z.json`;
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

  /**
   * Every global query the document depends on, run before a byte is written.
   *
   * Keeping these ahead of the body is what lets a failure here surface as an
   * ordinary HTTP error. Once the response has started, the only options left
   * are a document that records its own failure or a truncated stream.
   */
  public async preflight(): Promise<ExportPreflight> {
    const stores = await this.placeRepository.findAllStores('name');
    const viewRows = await this.objectRepository.findViewRows();
    const allCounts = await this.objectInstanceRepository.countAllByObjectId();
    const allStores = await this.mallRepository.getAllStoresByObjectId();
    return { stores, viewRows, allCounts, allStores };
  }

  public async export(
    writer: ExportWriter,
    options: ExportOptions,
    preflight: ExportPreflight,
  ): Promise<ExportStatus> {
    const now = options.now || (() => Date.now());
    const startedAt = now();
    const startedIso = new Date(startedAt).toISOString();

    const { stores, viewRows, allCounts, allStores } = preflight;

    let status: ExportStatus = 'complete';
    let truncation: any = null;
    let objectsWritten = 0;
    let bodyStarted = false;
    let objectsOpened = false;
    const derivedTally = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      failuresByReason: {} as { [reason: string]: number },
    };

    try {
      await writer.write(`{"schema":${JSON.stringify(this.buildSchema(startedIso, options))}`);
      bodyStarted = true;

      await writer.write(`,"stores":${JSON.stringify(stores.map((store: any) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
      })))}`);

      await writer.write(`,"ctrViews":${JSON.stringify(this.buildViews(viewRows, allCounts))}`);

      await writer.write(',"objects":[');
      objectsOpened = true;

      let offset = 0;
      let first = true;
      let lastObjectId: number | null = null;

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
        const page = await this.objectRepository.findPageForExport(PAGE_SIZE, offset);
        if (!page.length) {
          break;
        }

        // Checked only once a further page has actually been read, so a
        // catalogue of exactly MAX_OBJECTS reports complete: nothing was left
        // out, and the cap is a limit on what is omitted, not on what is sent.
        if (objectsWritten >= MAX_OBJECTS) {
          status = 'truncated';
          truncation = { reason: 'object_cap', limit: MAX_OBJECTS, lastObjectId: null };
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
          lastObjectId = row.id;
        }

        offset += PAGE_SIZE;
      }

      // Recorded once, here. Every branch that sets `truncation` above breaks
      // out of the loop immediately, so the same assignment written inside the
      // loop could never run -- it reported the object count instead of an id.
      if (truncation) {
        truncation.lastObjectId = lastObjectId;
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
      status = 'failed';

      if (!bodyStarted) {
        // Nothing reached the client, so there is no partial document to close
        // and no way to make one parse. Let the controller answer instead.
        throw error;
      }

      // The document is already partially written, so the only honest thing left
      // is to close it with a failed result rather than pretend it succeeded.
      // `objects` may not have been opened yet, in which case an empty array is
      // what keeps the document parseable.
      try {
        const tail = objectsOpened ? ']' : ',"objects":[]';
        await writer.write(`${tail},"result":${JSON.stringify({
          status: 'failed',
          reason: publicErrorCode(error),
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
      scope: {
        objects: 'pending',
        note: 'Objects awaiting Mall review (CTR status 2) only. Stocked, warehoused, '
          + 'sold-out and removed objects are deliberately absent: this document is the '
          + 'submission queue the Mall Checker publishes, not the CTR catalogue. '
          + '`stores` remains the full Mall store list, as reference data a consumer '
          + 'needs to render a store name it may meet later.',
      },
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
      _note: 'Current CTR staff-panel view memberships, derived rather than stored. '
        + 'Scoped to the objects in this document, which is pending-only -- so `pending` '
        + 'lists every exported object and the other five views are empty by '
        + 'construction rather than by accident. They are kept so a consumer never has '
        + 'to infer membership from `status`, and so the shape does not change if the '
        + 'export scope is ever widened again.',
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
      // `position`/`rotation` are columns of `mall_object`, not `object`, so they
      // arrive with the store rather than on the object row.
      placement: context.store
        ? {
          position: this.parseJson(context.store.mall_position),
          rotation: this.parseJson(context.store.mall_rotation),
        }
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
      derived.parseError = EXPORT_ERROR_CODES.sourceUnreadable;
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
