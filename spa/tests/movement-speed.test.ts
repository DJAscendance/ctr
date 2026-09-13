/**
 * Movement speed precedence and validation - the logic behind
 * `libs/x_ite_mods/movement_speed.js`'s getSpeedFactor() patch.
 *
 * All behavioural: every assertion calls the exported functions and checks a
 * real return value, never a source-string match.
 */
import assert from "assert";

import {
  clampMovementSpeed,
  DEFAULT_MOVEMENT_SPEED_MULTIPLIER,
  effectiveMovementSpeed,
  isValidMovementSpeed,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  MIN_MOVEMENT_SPEED_MULTIPLIER,
  WORLD_SPEED_OVERRIDES,
} from "../src/helpers/movement-speed.helper";

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(error as Error).message}`);
  }
}

/* ---------------------------------------------- 1. DEFAULT SPEED ---- */
console.log("\n1. DEFAULT SPEED");

test("the default sits inside the supported range", () => {
  assert.ok(isValidMovementSpeed(DEFAULT_MOVEMENT_SPEED_MULTIPLIER));
});

test("a guest / no saved preference resolves to the default", () => {
  // clampMovementSpeed(undefined) is what appStore hydration does for a
  // localStorage.getItem() miss (null coerces the same way).
  assert.strictEqual(clampMovementSpeed(undefined), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(clampMovementSpeed(null), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
});

/* --------------------------------------------- 2. USER PREFERENCE ---- */
console.log("\n2. USER PREFERENCE");

test("a valid saved preference passes through unchanged", () => {
  assert.strictEqual(clampMovementSpeed(3.2), 3.2);
});

test("a world with no override uses the user's preference", () => {
  assert.strictEqual(effectiveMovementSpeed("not-a-real-world.wrl", 4), 4);
  assert.strictEqual(effectiveMovementSpeed(undefined, 4), 4);
  assert.strictEqual(effectiveMovementSpeed(null, 4), 4);
});

/* --------------------------------------- 3. INVALID PREFERENCE FALLBACK ---- */
console.log("\n3. INVALID PREFERENCE FALLBACK");

test("NaN falls back to the default", () => {
  assert.strictEqual(clampMovementSpeed(NaN), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
});

test("Infinity and -Infinity fall back to the default", () => {
  assert.strictEqual(clampMovementSpeed(Infinity), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(clampMovementSpeed(-Infinity), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
});

test("a non-numeric string falls back to the default", () => {
  assert.strictEqual(clampMovementSpeed("fast please"), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
});

test("a numeric string still parses (the shape a localStorage read is in)", () => {
  assert.strictEqual(clampMovementSpeed("2.5"), 2.5);
});

test("isValidMovementSpeed rejects everything the clamp would rewrite", () => {
  assert.strictEqual(isValidMovementSpeed(NaN), false);
  assert.strictEqual(isValidMovementSpeed(Infinity), false);
  assert.strictEqual(isValidMovementSpeed("2" as unknown as number), false);
  assert.strictEqual(isValidMovementSpeed(undefined as unknown as number), false);
});

/* ------------------------------------------------- 4. WORLD OVERRIDE ---- */
console.log("\n4. WORLD OVERRIDE");

test("an explicit world override wins over the user's own preference", () => {
  const key = "__test_only_world__.wrl";
  WORLD_SPEED_OVERRIDES[key] = 0.75;
  try {
    assert.strictEqual(effectiveMovementSpeed(key, 5), 0.75);
  } finally {
    delete WORLD_SPEED_OVERRIDES[key];
  }
});

test("a world with no configured override falls through to the user preference", () => {
  assert.ok(!Object.prototype.hasOwnProperty.call(WORLD_SPEED_OVERRIDES, "shopping.wrl"));
  assert.strictEqual(effectiveMovementSpeed("shopping.wrl", 3), 3);
});

test("jail.wrl is pinned to X_ITE's own default, evidenced by real-GPU QA", () => {
  // qa/movement/tools/check-movement-speed.js measured the avatar hitting
  // the far wall well within the hold window at the application default.
  assert.strictEqual(WORLD_SPEED_OVERRIDES["jail.wrl"], 1);
  assert.strictEqual(effectiveMovementSpeed("jail.wrl", 6), 1);
});

test("an override still applies when the Place row's world_filename carries a subfolder", () => {
  // Real-GPU QA caught this: api/db seeds jail's row as "vrml/jail.wrl", not
  // "jail.wrl" - keying the lookup on the raw field silently missed it and
  // let the citizen's own 6x preference override the wall-collision fix.
  assert.strictEqual(effectiveMovementSpeed("vrml/jail.wrl", 6), 1);
  assert.strictEqual(effectiveMovementSpeed("/jail/vrml/jail.wrl", 6), 1);
});

/* ----------------------------------------------------- 5. PRECEDENCE ---- */
console.log("\n5. PRECEDENCE");

test("precedence is world override, then user preference, then default", () => {
  const key = "__precedence_test__.wrl";
  WORLD_SPEED_OVERRIDES[key] = 1.25;
  try {
    // World override beats a user preference that would otherwise apply.
    assert.strictEqual(effectiveMovementSpeed(key, 4), 1.25);
  } finally {
    delete WORLD_SPEED_OVERRIDES[key];
  }
  // With the override gone, the same call now yields the user preference.
  assert.strictEqual(effectiveMovementSpeed(key, 4), 4);
  // And an invalid preference under that falls through to the default.
  assert.strictEqual(effectiveMovementSpeed(key, NaN), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
});

/* ---------------------------------------------------- 6. MIN CLAMP ---- */
console.log("\n6. MINIMUM CLAMP");

test("a value below the minimum is clamped up to it", () => {
  assert.strictEqual(clampMovementSpeed(MIN_MOVEMENT_SPEED_MULTIPLIER - 1), MIN_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(clampMovementSpeed(0), MIN_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(clampMovementSpeed(-5), MIN_MOVEMENT_SPEED_MULTIPLIER);
});

test("zero and negative speed are never returned - no stall, no reverse", () => {
  assert.ok(clampMovementSpeed(0) > 0);
  assert.ok(clampMovementSpeed(-100) > 0);
});

/* ---------------------------------------------------- 7. MAX CLAMP ---- */
console.log("\n7. MAXIMUM CLAMP");

test("a value above the maximum is clamped down to it", () => {
  assert.strictEqual(clampMovementSpeed(MAX_MOVEMENT_SPEED_MULTIPLIER + 1), MAX_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(clampMovementSpeed(1000), MAX_MOVEMENT_SPEED_MULTIPLIER);
});

test("the boundary values themselves are accepted as-is", () => {
  assert.strictEqual(clampMovementSpeed(MIN_MOVEMENT_SPEED_MULTIPLIER), MIN_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(clampMovementSpeed(MAX_MOVEMENT_SPEED_MULTIPLIER), MAX_MOVEMENT_SPEED_MULTIPLIER);
});

/* ------------------------------------------------- 8. TRANSITION / CLEANUP ---- */
console.log("\n8. TRANSITION BEHAVIOUR");

test("moving from an overridden world to a plain one drops the override immediately", () => {
  // Simulates applyMovementSpeed() being called again on the next
  // INITIALIZED_EVENT with a different world_filename - nothing is carried
  // over because effectiveMovementSpeed() takes no state of its own.
  const overriddenWorld = "__transition_test__.wrl";
  WORLD_SPEED_OVERRIDES[overriddenWorld] = 0.5;
  try {
    assert.strictEqual(effectiveMovementSpeed(overriddenWorld, 3), 0.5);
  } finally {
    delete WORLD_SPEED_OVERRIDES[overriddenWorld];
  }
  assert.strictEqual(effectiveMovementSpeed("plain-world.wrl", 3), 3);
});

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
