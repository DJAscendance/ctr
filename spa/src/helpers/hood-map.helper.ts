/**
 * Authoritative neighborhood block-map geometry.
 *
 * The neighborhood counterpart of block-map.helper.ts. Like those, these are the
 * original Cybertown coordinates rather than arbitrary layout numbers, and every
 * consumer MUST import them instead of restating them - the ordinary
 * neighborhood map and the background-chooser preview have to agree about where a
 * block sits, or the preview is worthless for judging a candidate background.
 *
 *   install-4.0/csbin/community/templates/neighbor/wizard/image.tmpl
 *     -> the chooser's own thumbnails are declared `width=180 height=100`.
 *
 *   Measured from the shipped map-theme assets (spa/assets/img/map_themes):
 *     neighborhood background Pimg2D*.gif  -> 540 x 300
 *     block (mini-city) icon  Picon2D*.gif -> 83 x 52
 *
 * The inset below is the original frame padding carried over verbatim from the
 * neighborhood map page: it is asymmetric because the artwork's usable area is,
 * and 6 x 5 = 30 addressable block positions fit inside it.
 */

/** Background image width in CSS pixels. */
export const HOOD_MAP_WIDTH = 540;

/** Background image height in CSS pixels. */
export const HOOD_MAP_HEIGHT = 300;

/** Block positions per row. */
export const HOOD_MAP_COLUMNS = 6;

/** Rows of block positions. */
export const HOOD_MAP_ROWS = 5;

/** Height of one block cell, in CSS pixels. */
export const HOOD_MAP_CELL_HEIGHT = 53;

/** Total addressable block positions. Locations are 1..HOOD_MAP_BLOCK_COUNT. */
export const HOOD_MAP_BLOCK_COUNT = HOOD_MAP_COLUMNS * HOOD_MAP_ROWS;

/**
 * Padding that insets the block grid into the background artwork's usable area.
 * Asymmetric because the artwork is; do not "tidy" it into a single value.
 */
export const HOOD_MAP_INSET = "16px 19px 13px 10px";

/** Filename of the theme default background (index 0). */
export const HOOD_MAP_DEFAULT_BACKGROUND = "Pimg2D000.gif";

/** Filename of the block mini-city icon drawn in an occupied cell. */
export const HOOD_MAP_BLOCK_ICON = "Picon2D000.gif";

/** Root directory for a map theme's neighborhood art. */
export function hoodThemeRoot(theme: string): string {
  return `/assets/img/map_themes/${theme}/hood`;
}

/**
 * Filename for a background index. Anything that is not a positive integer is
 * the theme default, matching the server's own notion of "no selection".
 */
export function hoodBackgroundFilename(
  index: number | null | undefined,
): string {
  if (!Number.isInteger(index) || (index as number) <= 0) {
    return HOOD_MAP_DEFAULT_BACKGROUND;
  }
  return `Pimg2D${(index as number).toString().padStart(3, "0")}.gif`;
}

/**
 * CSS `background-image` value for a neighborhood, layered so a missing or
 * failed selected file falls back to the theme default underneath it.
 */
export function hoodBackgroundStyle(
  theme: string,
  index: number | null | undefined,
): string {
  const root = hoodThemeRoot(theme);
  const defaultUrl = `${root}/${HOOD_MAP_DEFAULT_BACKGROUND}`;
  const filename = hoodBackgroundFilename(index);
  if (filename === HOOD_MAP_DEFAULT_BACKGROUND) {
    return `url('${defaultUrl}')`;
  }
  return `url('${root}/${filename}'), url('${defaultUrl}')`;
}

/** CSS `background-image` value for a block's mini-city icon in a theme. */
export function hoodBlockIconStyle(theme: string): string {
  return `url('${hoodThemeRoot(theme)}/${HOOD_MAP_BLOCK_ICON}')`;
}
