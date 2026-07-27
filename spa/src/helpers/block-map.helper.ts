/**
 * Authoritative block lot-map geometry.
 *
 * These are not arbitrary layout numbers - they are the original Cybertown lot
 * coordinates, recovered from the reverse-engineered blaxxun Community Server 4.0
 * templates and confirmed against archived production art. See
 * docs/research/classic-place-admin-re-evidence.md §3.2.
 *
 *   install-4.0/csbin/community/templates/block/wizard/present.tmpl
 *     -> <body background="...Pimg2D<NNN>.gif"> with a transparent <table> of
 *        6 rows x 12 columns laid over it; positions named oRRCC (row 01-06,
 *        column 01-12), i.e. ROW-MAJOR.
 *
 *   Measured from archived Cybertown assets in wb-ct-scrape:
 *     block background Pimg2D*.gif -> 480 x 240
 *     house icon       Picon2D*.gif -> 40 x 40
 *     free-lot icon    Ficon2D000.gif -> 40 x 40
 *
 *   480 / 40 = 12 columns, 240 / 40 = 6 rows = 72 lots.
 *
 * The 4.0 template declares `width=37 height=37` cells inside a `width=480
 * height=240` table, which is internally inconsistent (12 x 37 = 444). HTML 4
 * stretched those cells to fill the table, landing on exactly 40 x 40 - the icon
 * size. The 37 is vestigial; 40 is the real coordinate.
 *
 * Every consumer of the lot map MUST import these rather than restating them, so
 * the ordinary block map, the update wizard and the background preview cannot
 * drift apart.
 */

/** Background image width in CSS pixels. */
export const BLOCK_MAP_WIDTH = 480;

/** Background image height in CSS pixels. */
export const BLOCK_MAP_HEIGHT = 240;

/** Lots per row. */
export const BLOCK_MAP_COLUMNS = 12;

/** Rows of lots. */
export const BLOCK_MAP_ROWS = 6;

/** Edge length of one lot cell, in CSS pixels. Also the icon size. */
export const BLOCK_MAP_CELL_SIZE = 40;

/** Total addressable lots on a block. Locations are 1..BLOCK_MAP_LOT_COUNT. */
export const BLOCK_MAP_LOT_COUNT = BLOCK_MAP_COLUMNS * BLOCK_MAP_ROWS;

/** Filename of the theme default background (index 0). */
export const BLOCK_MAP_DEFAULT_BACKGROUND = "Pimg2D000.gif";

/**
 * Converts a 1-based row-major location to its {row, column}, both 1-based.
 * Mirrors the original oRRCC naming: location = (row - 1) * 12 + column.
 */
export function locationToRowColumn(
  location: number,
): { row: number; column: number } {
  const zeroBased = location - 1;
  return {
    row: Math.floor(zeroBased / BLOCK_MAP_COLUMNS) + 1,
    column: (zeroBased % BLOCK_MAP_COLUMNS) + 1,
  };
}

/** Root directory for a map theme's block art. */
export function blockThemeRoot(theme: string): string {
  return `/assets/img/map_themes/${theme}/block`;
}

/**
 * Filename for a background index. Anything that is not a positive integer is
 * the theme default, matching the server's own notion of "no selection".
 */
export function blockBackgroundFilename(
  index: number | null | undefined,
): string {
  if (!Number.isInteger(index) || (index as number) <= 0) {
    return BLOCK_MAP_DEFAULT_BACKGROUND;
  }
  return `Pimg2D${(index as number).toString().padStart(3, "0")}.gif`;
}

/**
 * CSS `background-image` value for a block, layered so a missing or failed
 * selected file falls back to the theme default underneath it.
 */
export function blockBackgroundStyle(
  theme: string,
  index: number | null | undefined,
): string {
  const root = blockThemeRoot(theme);
  const defaultUrl = `${root}/${BLOCK_MAP_DEFAULT_BACKGROUND}`;
  const filename = blockBackgroundFilename(index);
  if (filename === BLOCK_MAP_DEFAULT_BACKGROUND) {
    return `url('${defaultUrl}')`;
  }
  return `url('${root}/${filename}'), url('${defaultUrl}')`;
}

/** URL of the "Free" lot marker for a theme. */
export function blockFreeIconUrl(theme: string): string {
  return `${blockThemeRoot(theme)}/Ficon2D000.gif`;
}

/**
 * URL of a house icon for a theme. `mapIconIndex` is 1-based as stored on the
 * place row; the asset filenames are 0-based. Themes carry a limited number of
 * house icons, so an out-of-range index falls back to icon 000 rather than
 * requesting a file that does not exist.
 */
export function blockHouseIconUrl(theme: string, mapIconIndex: number): string {
  const root = blockThemeRoot(theme);
  const maxIndex = theme === "cyberhood" ? 5 : theme === "desert" ? 7 : Infinity;
  if (!Number.isInteger(mapIconIndex) || mapIconIndex > maxIndex) {
    return `${root}/Picon2D000.gif`;
  }
  return `${root}/Picon2D${(mapIconIndex - 1).toString().padStart(3, "0")}.gif`;
}
