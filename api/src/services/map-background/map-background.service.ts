import { promises as fs } from 'fs';
import path from 'path';
import { Service } from 'typedi';

import { MapLevel, MapTheme } from '../../libs';

const INDEX_FILENAME_PATTERN = /^Pimg2D(\d{3})\.gif$/;

export interface MapBackgroundOption {
  index: number;
  url: string;
}

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

  private getAssetsRoot(): string {
    return process.env.ASSETS_DIR || '';
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
      return [];
    }

    const indexes = new Set<number>();
    for (const entry of entries) {
      const match = INDEX_FILENAME_PATTERN.exec(entry);
      if (!match) {
        continue;
      }
      const stats = await fs.stat(path.join(dir, entry));
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

  /** Resolves the URL that should actually render, given a stored selection. */
  public async getEffectiveUrl(
    theme: MapTheme,
    level: MapLevel,
    selectedIndex: number | null,
  ): Promise<string> {
    return this.buildUrl(theme, level, selectedIndex ?? 0);
  }
}
