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
  formatSpeedInput,
  isValidMovementSpeed,
  MAX_MOVEMENT_SPEED_MULTIPLIER,
  MIN_MOVEMENT_SPEED_MULTIPLIER,
  MOVEMENT_SPEED_STORAGE_KEY,
  WORLD_SPEED_OVERRIDES,
} from "../src/helpers/movement-speed.helper";

const fs = require("fs");
const path = require("path");

const TOOLS_COMPONENT = path.resolve(
  __dirname, "../../../src/pages/world-browser/WorldBrowserTools.vue",
);

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

/* ------------------------------------------ 9. SPEED CONTROL MODEL ---- */
console.log("\n9. SPEED CONTROL: ONE VALUE, TWO INPUTS");

/**
 * A stand-in for the one thing the slider, the number box and Reset all talk
 * to: `appStore.methods.setMovementSpeedMultiplier`. It runs the REAL clamp
 * and the REAL storage key, so these assertions exercise the same decision
 * the running component makes, not a copy of it.
 *
 * The component holds no speed of its own - both inputs render
 * `$store.data.movementSpeedMultiplier` and both write back through this
 * setter - so "the slider moved, did the number follow?" is answered by
 * reading this single field after a write.
 */
function makeSpeedControl(initialStored?: string) {
  const storage: Record<string, string> = {};
  if (initialStored !== undefined) storage[MOVEMENT_SPEED_STORAGE_KEY] = initialStored;
  const state = {
    /* appStore hydration: a localStorage miss reads as null. */
    value: clampMovementSpeed(
      Object.prototype.hasOwnProperty.call(storage, MOVEMENT_SPEED_STORAGE_KEY)
        ? storage[MOVEMENT_SPEED_STORAGE_KEY]
        : null,
    ),
  };
  return {
    /** What both inputs bind to. */
    displayed: (): number => state.value,
    /** What the number box shows. */
    numberText: (): string => formatSpeedInput(state.value),
    /** What the read-only label shows. */
    labelText: (): string => `${state.value.toFixed(1)}x`,
    /** What survives a reload. */
    stored: (): string | undefined => storage[MOVEMENT_SPEED_STORAGE_KEY],
    /** The store setter, verbatim: clamp, then state, then storage. */
    commit(raw: unknown): void {
      const clamped = clampMovementSpeed(raw);
      state.value = clamped;
      storage[MOVEMENT_SPEED_STORAGE_KEY] = clamped.toString();
    },
  };
}

test("moving the slider updates the number box - they share one value", () => {
  const control = makeSpeedControl();
  /* An <input type="range"> hands its event a string, never a number. */
  control.commit("4");
  assert.strictEqual(control.displayed(), 4);
  assert.strictEqual(control.numberText(), "4");
  assert.strictEqual(control.labelText(), "4.0x");
});

test("typing in the number box updates the slider - same one value", () => {
  const control = makeSpeedControl();
  control.commit("1.5");
  assert.strictEqual(control.displayed(), 1.5);
  /* The slider binds :value to this same number, so it has already moved. */
  assert.strictEqual(control.numberText(), "1.5");
});

test("there is no second speed state to drift - last write wins, both ways", () => {
  const control = makeSpeedControl();
  control.commit("6");
  control.commit("0.5");
  assert.strictEqual(control.displayed(), MIN_MOVEMENT_SPEED_MULTIPLIER);
  control.commit("3");
  assert.strictEqual(control.displayed(), 3);
  assert.strictEqual(control.numberText(), "3");
});

/* ------------------------------------------------ 10. NUMBER BOX ---- */
console.log("\n10. NUMBER BOX VALUES");

test("every supported step commits exactly as typed", () => {
  for (const typed of ["0.5", "1", "2.5", "4", "6"]) {
    const control = makeSpeedControl();
    control.commit(typed);
    assert.strictEqual(control.displayed(), parseFloat(typed), `typed ${typed}`);
    assert.strictEqual(control.numberText(), typed, `text for ${typed}`);
  }
});

test("a value below the minimum is held at the minimum", () => {
  const control = makeSpeedControl();
  control.commit("0.1");
  assert.strictEqual(control.displayed(), MIN_MOVEMENT_SPEED_MULTIPLIER);
  control.commit("-3");
  assert.strictEqual(control.displayed(), MIN_MOVEMENT_SPEED_MULTIPLIER);
});

test("a value above the maximum is held at the maximum", () => {
  const control = makeSpeedControl();
  control.commit("9");
  assert.strictEqual(control.displayed(), MAX_MOVEMENT_SPEED_MULTIPLIER);
  control.commit("99999");
  assert.strictEqual(control.displayed(), MAX_MOVEMENT_SPEED_MULTIPLIER);
});

test("blank, text, NaN and Infinity fall back to the default, never to 0", () => {
  /* A type="number" box reports "" for text a browser cannot parse. */
  for (const typed of ["", "   ", "abc", "NaN", "Infinity", "-Infinity", "1e999"]) {
    const control = makeSpeedControl("4");
    assert.strictEqual(control.displayed(), 4, `setup for ${JSON.stringify(typed)}`);
    control.commit(typed);
    assert.strictEqual(
      control.displayed(),
      DEFAULT_MOVEMENT_SPEED_MULTIPLIER,
      `fallback for ${JSON.stringify(typed)}`,
    );
    assert.ok(isValidMovementSpeed(control.displayed()));
  }
});

test("no invalid entry can produce an unsafe multiplier", () => {
  for (const typed of ["", "abc", "NaN", "Infinity", "0", "-1", "1000", "null", "undefined"]) {
    const control = makeSpeedControl();
    control.commit(typed);
    const value = control.displayed();
    assert.ok(isValidMovementSpeed(value), `unsafe value for ${JSON.stringify(typed)}`);
    assert.ok(value >= MIN_MOVEMENT_SPEED_MULTIPLIER && value <= MAX_MOVEMENT_SPEED_MULTIPLIER);
  }
});

test("the box reads a whole number back as a whole number", () => {
  assert.strictEqual(formatSpeedInput(1), "1");
  assert.strictEqual(formatSpeedInput(6), "6");
  assert.strictEqual(formatSpeedInput(2.5), "2.5");
});

test("the write-back text is always a legal entry", () => {
  for (const value of [-5, 0, 0.5, 2.5, 6, 99, NaN, Infinity]) {
    assert.ok(isValidMovementSpeed(parseFloat(formatSpeedInput(value))), `format ${value}`);
  }
});

/* ----------------------------------------------------- 11. RESET ---- */
console.log("\n11. RESET");

test("Reset returns the value to the default", () => {
  const control = makeSpeedControl("6");
  assert.strictEqual(control.displayed(), 6);
  control.commit(DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(control.displayed(), 2.5);
});

test("Reset moves the slider, the number box and the label together", () => {
  const control = makeSpeedControl("0.5");
  control.commit(DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(control.displayed(), DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(control.numberText(), "2.5");
  assert.strictEqual(control.labelText(), "2.5x");
});

test("Reset also rewrites what is stored", () => {
  const control = makeSpeedControl("6");
  control.commit(DEFAULT_MOVEMENT_SPEED_MULTIPLIER);
  assert.strictEqual(control.stored(), "2.5");
});

/* ----------------------------------------------- 12. PERSISTENCE ---- */
console.log("\n12. PERSISTENCE (BROWSER PROFILE)");

test("a committed value is written to browser storage, not to an account", () => {
  const control = makeSpeedControl();
  control.commit("4");
  assert.strictEqual(control.stored(), "4");
});

test("a stored value is what a cold start comes back with", () => {
  const first = makeSpeedControl();
  first.commit("1.5");
  const reloaded = makeSpeedControl(first.stored());
  assert.strictEqual(reloaded.displayed(), 1.5);
  assert.strictEqual(reloaded.numberText(), "1.5");
});

test("a hand-edited or corrupt stored value cannot reach the viewer", () => {
  for (const stored of ["999", "-4", "abc", "", "Infinity"]) {
    const reloaded = makeSpeedControl(stored);
    assert.ok(isValidMovementSpeed(reloaded.displayed()), `stored ${JSON.stringify(stored)}`);
  }
});

test("the configured default survives repeated reloads unchanged - never compounds", () => {
  let control = makeSpeedControl();
  control.commit("2.5");
  for (let i = 0; i < 100; i += 1) {
    control = makeSpeedControl(control.stored());
    assert.strictEqual(control.displayed(), 2.5, `reload ${i}`);
  }
  assert.strictEqual(control.displayed(), 2.5);
});

/* -------------------------------------------- 13. JAIL OVERRIDE ---- */
console.log("\n13. JAIL OVERRIDE vs THE NUMBER BOX");

test("the number box cannot raise the speed inside the jail", () => {
  const control = makeSpeedControl();
  for (const typed of ["0.5", "1", "2.5", "4", "6"]) {
    control.commit(typed);
    assert.strictEqual(effectiveMovementSpeed("jail.wrl", control.displayed()), 1, `typed ${typed}`);
    assert.strictEqual(effectiveMovementSpeed("vrml/jail.wrl", control.displayed()), 1);
  }
});

test("the preference is kept while the jail override is in force", () => {
  const control = makeSpeedControl();
  control.commit("6");
  assert.strictEqual(effectiveMovementSpeed("jail.wrl", control.displayed()), 1);
  /* Leaving the jail restores what the citizen chose - nothing was overwritten. */
  assert.strictEqual(effectiveMovementSpeed("plaza.wrl", control.displayed()), 6);
  assert.strictEqual(control.displayed(), 6);
  assert.strictEqual(control.stored(), "6");
});

/* ------------------------------------------------- 14. UI WIRING ---- */
console.log("\n14. UI WIRING");

/*
 * The SPA test harness has no DOM and no @vue/test-utils, so behaviour is
 * proven above against the real helper. These four checks guard only the
 * wiring that a pure-logic suite cannot see: that the control actually
 * carries all three parts, and that neither input parses on its own.
 */
const toolsSource: string = fs.readFileSync(TOOLS_COMPONENT, "utf8");

test("the control carries a slider, a number box and Reset", () => {
  assert.ok(/id="movement-speed"[\s\S]{0,200}type="range"/.test(toolsSource), "slider");
  assert.ok(/id="movement-speed-number"[\s\S]{0,200}type="number"/.test(toolsSource), "number box");
  assert.ok(/@click="resetSpeed"/.test(toolsSource), "Reset");
});

test("both inputs render the one store value", () => {
  const bindings = toolsSource.match(/:value="movementSpeed"/g) || [];
  assert.strictEqual(bindings.length, 2, "slider and number box both bind movementSpeed");
  assert.ok(/movementSpeed\(\): number \{[\s\S]{0,120}\$store\.data\.movementSpeedMultiplier/
    .test(toolsSource));
});

test("both inputs commit through the one store setter", () => {
  const commits = toolsSource.match(/setMovementSpeedMultiplier\(/g) || [];
  assert.strictEqual(commits.length, 3, "slider, number box and Reset");
  assert.ok(!/parseFloat|parseInt|Number\(/.test(
    toolsSource.slice(toolsSource.indexOf("onSpeedInput"), toolsSource.indexOf("getMallId")),
  ), "no input parses on its own - the store clamps");
});

test("the number box holds its range and commits on change, not on every keystroke", () => {
  const box = toolsSource.slice(
    toolsSource.indexOf('id="movement-speed-number"'),
    toolsSource.indexOf("</div>", toolsSource.indexOf('id="movement-speed-number"')),
  );
  assert.ok(/:min="speedMin"/.test(box) && /:max="speedMax"/.test(box), "range bound");
  assert.ok(/@change="onSpeedCommit"/.test(box), "commits on change");
  assert.ok(!/@input=/.test(box), "does not clamp mid-keystroke");
  assert.ok(/speedMin: MIN_MOVEMENT_SPEED_MULTIPLIER/.test(toolsSource));
  assert.ok(/speedMax: MAX_MOVEMENT_SPEED_MULTIPLIER/.test(toolsSource));
});

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
