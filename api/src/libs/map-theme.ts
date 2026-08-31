/** The shared visual themes CTR currently bundles map-background assets under. */
export type MapTheme = 'grass' | 'desert' | 'cyberhood';

/** The two place levels that have a selectable map background. */
export type MapLevel = 'block' | 'hood';

/**
 * Maps each seeded colony slug to the theme whose bundled `Pimg2D` pool
 * that colony's blocks/hoods draw their map background options from.
 *
 * This is theme-wide (not per-colony) because CTR's current asset layout
 * groups colonies into three shared pools rather than giving each colony
 * its own directory - see docs/plans/place-map-backgrounds.md for the
 * research establishing this as the closest supportable restoration.
 */
export const COLONY_THEME_MAP: Record<string, MapTheme> = {
  games_col: 'grass',
  vrtwrlds_col: 'grass',
  ent_col: 'grass',
  inrlms_col: 'grass',
  teen_col: 'grass',
  campus: 'grass',
  ad_col: 'grass',
  hitek_col: 'grass',
  scifi_col: 'desert',
  morningstar: 'desert',
  '9thdimension': 'desert',
  cyberhood: 'cyberhood',
};

/**
 * Resolves a colony slug to its map theme, or null if the slug is unrecognized.
 *
 * The lookup is restricted to the map's own keys. A plain index lookup would
 * also reach inherited `Object.prototype` members, so a colony slug of
 * `toString` or `constructor` would resolve to a function rather than to null.
 */
export function resolveMapTheme(colonySlug: string | undefined | null): MapTheme | null {
  if (!colonySlug) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(COLONY_THEME_MAP, colonySlug)) {
    return null;
  }
  return COLONY_THEME_MAP[colonySlug];
}
