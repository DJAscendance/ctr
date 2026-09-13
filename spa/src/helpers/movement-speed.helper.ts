/**
 * Movement speed precedence and validation.
 *
 * WHAT THIS SOLVES. X_ITE 16.2.0's WalkViewer computes every keyboard/mouse
 * step as `NavigationInfo.speed * Viewpoint.getSpeedFactor() * SPEED_FACTOR
 * * dt` (see `x_ite/Browser/Navigation/WalkViewer.js`, `fly()`/`pan()`).
 * `NavigationInfo.speed` is authored per VRML world and CTR must not touch
 * it - editing thousands of .wrl files is out of scope, and a world that
 * tunes its own pace (a cramped shop, a wide plaza) is doing so on purpose.
 * `Viewpoint.getSpeedFactor()` is the one seam X_ITE exposes with no
 * VRML-authored meaning at all (it defaults to a bare `return 1`), so it is
 * the multiplier CTR's application code owns. `movement_speed.js` patches
 * that seam; this module is the pure precedence/validation logic behind it,
 * kept separate so it is testable without a browser.
 *
 * PRECEDENCE. A world's entry in {@link WORLD_SPEED_OVERRIDES} - keyed by
 * `world_filename`, the physical VRML file a Place row points to, because
 * several Mall shops share one file - wins outright when present. Otherwise
 * the citizen's own saved multiplier applies. Guests, and citizens with no
 * saved value yet, get {@link DEFAULT_MOVEMENT_SPEED_MULTIPLIER}: nothing
 * here depends on an account existing.
 */

export const MIN_MOVEMENT_SPEED_MULTIPLIER = 0.5;
export const MAX_MOVEMENT_SPEED_MULTIPLIER = 6;

/**
 * Multiplier applied on top of X_ITE's own default (1x = engine default,
 * matching the current live pace of roughly 0.70 units/s measured in the
 * Mall). Chosen from real-world timed walks; see qa/movement/README.md.
 */
export const DEFAULT_MOVEMENT_SPEED_MULTIPLIER = 2.5;

export const MOVEMENT_SPEED_STORAGE_KEY = "movementSpeedMultiplier";

/**
 * Per-world hard override, keyed by `world_filename` (e.g. "shopping.wrl").
 * Left empty except where real GPU QA showed the tuned default was
 * uncomfortable there - see CORE DESIGN RULE: no override may be populated
 * speculatively.
 *
 * `jail.wrl`: real-GPU measurement (qa/movement/tools/check-movement-speed.js)
 * showed the avatar crossing the entire cell and hitting the far wall in
 * under 2.5s at the application default (2.5x - ~13 units covered), with x4
 * and x6 producing an IDENTICAL distance and dy to one another (18.010 /
 * 0.540), the signature of hitting a wall rather than continuing to move.
 * Collision correctly stopped the avatar rather than tunnelling, but a cell
 * this small has no room to use the higher settings at all, so it is pinned
 * at 1x - X_ITE's own untouched default - regardless of the citizen's own
 * preference.
 */
export const WORLD_SPEED_OVERRIDES: Record<string, number> = {
  'jail.wrl': 1,
};

/**
 * True only for a finite number inside the supported range. Used to decide
 * whether a saved or incoming value may be trusted as-is.
 */
export function isValidMovementSpeed(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_MOVEMENT_SPEED_MULTIPLIER
    && value <= MAX_MOVEMENT_SPEED_MULTIPLIER;
}

/**
 * Coerces and clamps an arbitrary value (a `localStorage` read, a slider
 * event, NaN, Infinity, a stray string) into the supported range. Anything
 * that cannot be read as a finite number falls back to the application
 * default rather than reaching the viewer at all.
 */
export function clampMovementSpeed(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return DEFAULT_MOVEMENT_SPEED_MULTIPLIER;
  if (num < MIN_MOVEMENT_SPEED_MULTIPLIER) return MIN_MOVEMENT_SPEED_MULTIPLIER;
  if (num > MAX_MOVEMENT_SPEED_MULTIPLIER) return MAX_MOVEMENT_SPEED_MULTIPLIER;
  return num;
}

/**
 * The precedence rule: world hard override, when one is explicitly
 * configured for this `world_filename`, otherwise the citizen's own
 * (already-clamped) preference, otherwise the application default.
 *
 * `userMultiplier` is passed in already resolved (guest or citizen, saved
 * or not) rather than read from storage here, so this stays a pure function
 * the X_ITE patch and the test suite can both call identically.
 *
 * `worldFilename` is matched on its basename, not the raw Place row value:
 * real-GPU QA (qa/movement/tools/check-movement-speed.js) caught that
 * `world_filename` is stored inconsistently across places - `"jail.wrl"` for
 * some, `"vrml/jail.wrl"` for others carrying their own `vrml/` subfolder -
 * so keying {@link WORLD_SPEED_OVERRIDES} on the raw value silently missed
 * every place whose row carries a prefix.
 */
export function effectiveMovementSpeed(
  worldFilename: string | undefined | null,
  userMultiplier: number,
): number {
  const basename = worldFilename ? worldFilename.split('/').pop() : undefined;
  if (basename && Object.prototype.hasOwnProperty.call(WORLD_SPEED_OVERRIDES, basename)) {
    return WORLD_SPEED_OVERRIDES[basename];
  }
  return clampMovementSpeed(userMultiplier);
}
