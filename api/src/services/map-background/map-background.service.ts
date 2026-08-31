import { promises as fs } from 'fs';
import path from 'path';
import { Service } from 'typedi';

import { MapLevel, MapTheme } from '../../libs';

const INDEX_FILENAME_PATTERN = /^Pimg2D(\d{3})\.gif$/;

/** The index every shipped pool provides, used whenever a selection cannot be honoured. */
export const DEFAULT_MAP_BACKGROUND_INDEX = 0;

/**
 * Raised when the server cannot look up map backgrounds at all because
 * `ASSETS_DIR` is unset. This is a deployment fault, never a client fault, so
 * callers must surface it as a server error rather than as an empty pool.
 */
export class MapBackgroundConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapBackgroundConfigurationError';
  }
}

export interface MapBackgroundOption {
  index: number;
  url: string;
}

/** What the read API reports for one place's map background. */
export interface MapBackgroundOptionsResult {
  /** The index stored on the place, or null when it has never been set. */
  selectedIndex: number | null;
  /**
   * The index that actually renders: the stored one when the current pool
   * still offers it, otherwise the default index 0.
   */
  effectiveIndex: number;
  /** The asset URL for the effective index. */
  effectiveUrl: string;
  /** Every index this place's theme and level actually offer. */
  options: MapBackgroundOption[];
}

/** Outcome of attempting to persist a map background selection. */
export type MapBackgroundSelectionResult =
  | { status: 'success'; selectedIndex: number | null }
  | { status: 'not_found' }
  | { status: 'invalid' };

/**
 * Server-authoritative discovery and validation of the map background
 * options CTR currently ships as static files under
 * `<ASSETS_DIR>/img/map_themes/<theme>/<level>/Pimg2D<index>.gif`.
 *
 * The browser never decides which theme or index is valid - every
 * option list and every submitted index is resolved/validated here
 * against the real filesystem contents.
 */
@Service()
export class MapBackgroundService {

  /**
   * @returns the configured asset root
   * @throws MapBackgroundConfigurationError when ASSETS_DIR is unset, rather
   *   than falling back to an empty string and reading a relative path
   */
  private getAssetsRoot(): string {
    const root = process.env.ASSETS_DIR;
    if (!root) {
      throw new MapBackgroundConfigurationError(
        'ASSETS_DIR is not configured, so map background options cannot be resolved.',
      );
    }
    return root;
  }

  private getPoolDirectory(theme: MapTheme, level: MapLevel): string {
    return path.join(this.getAssetsRoot(), 'img', 'map_themes', theme, level);
  }

  private buildUrl(theme: MapTheme, level: MapLevel, index: number): string {
    const filename = `Pimg2D${index.toString().padStart(3, '0')}.gif`;
    return `/assets/img/map_themes/${theme}/${level}/${filename}`;
  }

  /**
   * Enumerates every valid, numbered Pimg2D background file for the given
   * theme/level by reading the actual asset directory - never trusts
   * client input for path construction, and only ever reads paths built
   * from the server-controlled theme/level enum values plus a filename
   * this function itself derives from a validated on-disk match.
   */
  public async listOptions(theme: MapTheme, level: MapLevel): Promise<MapBackgroundOption[]> {
    const dir = this.getPoolDirectory(theme, level);

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      // A pool a theme simply does not ship is an empty option list. Anything
      // else - a permission fault, a broken mount - is a real server failure
      // and must not be reported to the caller as "no options available".
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const indexes = new Set<number>();
    for (const entry of entries) {
      const match = INDEX_FILENAME_PATTERN.exec(entry);
      if (!match) {
        continue;
      }
      let stats;
      try {
        stats = await fs.stat(path.join(dir, entry));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      if (!stats.isFile()) {
        continue;
      }
      indexes.add(Number.parseInt(match[1], 10));
    }

    return Array.from(indexes)
      .sort((a, b) => a - b)
      .map(index => ({ index, url: this.buildUrl(theme, level, index) }));
  }

  public async isValidIndex(theme: MapTheme, level: MapLevel, index: number): Promise<boolean> {
    const options = await this.listOptions(theme, level);
    return options.some(option => option.index === index);
  }

  /**
   * Builds the full read report for one place's map background.
   *
   * `selectedIndex` reports the raw stored value untouched, so a stale row
   * stays visible to callers. `effectiveIndex` is what actually renders, and
   * is only ever an index the current pool really offers - a stored index that
   * the shipped assets no longer contain falls back to the default rather than
   * naming a file that would 404. Reads never write the stale value back.
   *
   * @param theme the place's theme
   * @param level whether the place is a block or a hood
   * @param selectedIndex the index stored on the place, or null if never set
   */
  public async resolveOptions(
    theme: MapTheme,
    level: MapLevel,
    selectedIndex: number | null,
  ): Promise<MapBackgroundOptionsResult> {
    const options = await this.listOptions(theme, level);
    const stillAvailable =
      selectedIndex !== null && options.some(option => option.index === selectedIndex);
    const effectiveIndex = stillAvailable
      ? (selectedIndex as number)
      : DEFAULT_MAP_BACKGROUND_INDEX;

    return {
      selectedIndex,
      effectiveIndex,
      effectiveUrl: this.buildUrl(theme, level, effectiveIndex),
      options,
    };
  }
}
