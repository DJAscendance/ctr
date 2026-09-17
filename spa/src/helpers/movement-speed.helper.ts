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
/**
 * THE ONE PLACE AN INMATE'S WALKING PACE IS SET.
 *
 * A raw X_ITE speed factor on the same scale as every other entry in
 * {@link WORLD_SPEED_OVERRIDES}, where `1` is the pace the rest of the Jail
 * is pinned to. `0.4` therefore means "two fifths the speed of everybody
 * else standing in the Jail", and the ratio is what the real-GPU gate
 * (qa/jail/tools/check-jail-speed.js) measures.
 *
 * To try a different pace, change THIS NUMBER AND NOTHING ELSE - e.g. `0.25`
 * for a quarter of the normal Jail pace. No other file carries the value.
 *
 * WHY A WORLD OVERRIDE AND NOT A FLAG. The Jail serves three physically
 * different world files and the server alone decides which one a citizen
 * gets: `JailService.applyWorldForMember` reads their live `jail` ban row
 * and their role assignments, and answers `vrml/jailinmate.wrl` only for a
 * citizen actually serving a sentence. So keying the pace off the world file
 * inherits that authority exactly - a client cannot ask for a world, cannot
 * be told the other two exist, and its own dial is short-circuited by an
 * override. Release or expiry is handled by the same route with nothing
 * extra: the next place fetch answers `vrml/jailvisit.wrl`, which is pinned
 * at the normal `1`.
 *
 * A jailed guard is served the inmate world too (a sentence outranks an
 * office - see JailService), so staff authority cannot buy a faster escape.
 */
export const JAIL_INMATE_WALK_SPEED = 0.4;

/**
 * The world file the server hands a citizen who is serving a sentence, by
 * basename. Named once so the pace below and
 * {@link mayChooseWalkSpeed} cannot drift apart; it must stay equal to
 * `JailService.WORLD_INMATE`, which is what
 * tests/jail-inmate-speed.test.ts checks against the API's own source.
 */
export const JAIL_INMATE_WORLD = "jailinmate.wrl";

/* Note: these are RAW X_ITE speed factors, deliberately exempt from the
 * cross-world normalisation - see movementSpeedFactor. */
export const WORLD_SPEED_OVERRIDES: Record<string, number> = {
  "jail.wrl": 1,
  /*
   * The three wrappers JailService serves in jail.wrl's place. They Inline
   * the very same geometry, so the cell that is too small for the dial is
   * still too small here - without these three the Jail's pin would have
   * been silently lost the moment the server started answering with a
   * wrapper name instead of `jail.wrl`.
   */
  "jailvisit.wrl": 1,
  "jailstaff.wrl": 1,
  [JAIL_INMATE_WORLD]: JAIL_INMATE_WALK_SPEED,
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

/**
 * Canonical text for a speed control's number box.
 *
 * `String()` rather than `toFixed()` on purpose: the box is something a
 * citizen types into, so `1` must read back as `"1"`, not `"1.0"`. The
 * adjacent read-only label keeps its one-decimal form - that one is a
 * display, not an input.
 *
 * Also used as the write-back value when a commit leaves the multiplier
 * unchanged (typing "abc" into a box already holding the default clamps
 * straight back to that default, so nothing re-renders on its own) - without
 * the write-back the box would sit empty while the real speed was fine.
 */
export function formatSpeedInput(value: number): string {
  return String(clampMovementSpeed(value));
}

/**
 * The world whose pace the dial is calibrated against: `shop.wrl`, which
 * authors `NavigationInfo.speed 2.25`. Chosen by the owner from real play as
 * the reference for what the 2.5 default should feel like, and measured on the
 * real GPU at 3.93 units/s there (qa/movement/tools/check-movement-speed.js).
 *
 * It is the AUTHORED speed rather than the measured one because that is the
 * number X_ITE actually multiplies by; the measured figure is what it works
 * out to once X_ITE's own SPEED_FACTOR and the frame delta are applied, and is
 * recorded here only so the calibration can be re-checked.
 */
export const REFERENCE_WORLD_SPEED = 2.25;

/**
 * Turns the citizen's dial reading into the factor X_ITE's
 * `Viewpoint.getSpeedFactor()` should return, so that one dial setting means
 * the same pace in every world.
 *
 * WHY THIS EXISTS. X_ITE steps the avatar by
 * `NavigationInfo.speed * getSpeedFactor() * SPEED_FACTOR * dt`
 * (`WalkViewer.js`, `fly()`/`pan()`), and `NavigationInfo.speed` is authored
 * per world with no consistency at all: `shop.wrl` says 2.25, `shopping.wrl`
 * says 1, `enter.wrl` and `carshowcase.wrl` say 10, and `largeitems.wrl`
 * omits the field entirely (so X3D's default 1 applies). Handing that term a
 * bare multiplier therefore multiplied a tenfold discrepancy rather than
 * removing it - measured on the real GPU, the Plaza at dial 0.5 (3.48 units/s)
 * outran the Mall at dial 6 (4.18 units/s), and the same 2.5 default ran at
 * 17.48 units/s in the Car Showcase against 1.75 in the Large Item Shop.
 *
 * Dividing the authored speed back out cancels that term exactly: the product
 * `authoredWorldSpeed * factor` is always `REFERENCE_WORLD_SPEED * multiplier`,
 * whatever the world says. The reference world is left untouched by
 * construction, because there the correction is 2.25/2.25 = 1.
 *
 * Worlds are NOT edited to achieve this - the authored value is read from the
 * bound NavigationInfo at call time, so a world CTR has never inspected is
 * normalised on the same terms as one it has.
 *
 * @param authoredWorldSpeed the bound `NavigationInfo.speed`. When it cannot be
 *   read - no NavigationInfo bound yet, or a nonsensical value - the dial is
 *   passed through unchanged, which is exactly the pre-normalisation behaviour
 *   rather than a guess.
 * @param multiplier the already-resolved dial reading (world override, else
 *   citizen preference, else default - see {@link effectiveMovementSpeed}).
 */
export function normalisedSpeedFactor(
  authoredWorldSpeed: unknown,
  multiplier: number,
): number {
  const dial = clampMovementSpeed(multiplier);
  const authored = typeof authoredWorldSpeed === "number"
    ? authoredWorldSpeed
    : parseFloat(String(authoredWorldSpeed));
  if (!Number.isFinite(authored) || authored <= 0) return dial;
  return dial * (REFERENCE_WORLD_SPEED / authored);
}

/**
 * The single value handed to X_ITE's `Viewpoint.getSpeedFactor()`: the whole
 * decision, from place row to engine term, in one testable call.
 *
 * A world in {@link WORLD_SPEED_OVERRIDES} is pinned and NOT normalised. Those
 * entries exist because a world is physically unable to use the dial at all -
 * `jail.wrl` is a cell the avatar crosses in under 2.5s - and they are written
 * in X_ITE's own units, where 1 means "the engine default, untouched". Putting
 * them through normalisation would redefine that 1 as the reference world's
 * pace and speed the cell up, which is the opposite of why the entry is there.
 * So an override short-circuits: what it says is what the engine gets.
 *
 * Everything else is normalised, so one dial setting is one pace citywide.
 */
export function movementSpeedFactor(
  worldFilename: string | undefined | null,
  userMultiplier: number,
  authoredWorldSpeed: unknown,
): number {
  const basename = worldFilename ? worldFilename.split("/").pop() : undefined;
  if (basename && Object.prototype.hasOwnProperty.call(WORLD_SPEED_OVERRIDES, basename)) {
    return WORLD_SPEED_OVERRIDES[basename];
  }
  return normalisedSpeedFactor(authoredWorldSpeed, userMultiplier);
}

/**
 * Whether the citizen standing in this world may open the Walk Speed control
 * at all.
 *
 * An inmate may not. Their pace is a restriction, so offering them a dial
 * that silently does nothing is worse than offering nothing: the control
 * would move, the number would change, and the avatar would keep walking at
 * {@link JAIL_INMATE_WALK_SPEED}. `WorldBrowserPage` therefore leaves the
 * "Walk Speed" entry out of the world's right-click menu entirely while the
 * inmate world is loaded.
 *
 * This is presentation, not enforcement - {@link movementSpeedFactor} already
 * ignores the dial for an overridden world, so a citizen who reaches the
 * panel some other way still cannot walk any faster. And it inherits the
 * server's authority for free: the menu is decided from `world_filename`,
 * which only `JailService.applyWorldForMember` ever sets to the inmate world.
 *
 * Staff and visitors in the Jail keep the entry. Their pace is pinned too,
 * but that pin is the historical one on a cramped world rather than a penalty,
 * and hiding the control there would be a behaviour change outside this lane.
 */
export function mayChooseWalkSpeed(worldFilename: string | undefined | null): boolean {
  const basename = worldFilename ? worldFilename.split("/").pop() : undefined;
  return basename !== JAIL_INMATE_WORLD;
}
