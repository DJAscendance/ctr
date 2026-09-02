/**
 * OUTLANDS-1 guard for the Blaxxun keyboard bridge - `Browser.eventMask` and
 * the `event_changed` eventOut.
 *
 * Same split as the ray suite: behaviour against `bxx-key.helper`, wiring
 * against the source of `libs/x_ite_mods/bxx_events.js` and `App.vue`. The
 * harness has no DOM, so the helper takes a plain object shaped like a DOM
 * event and the binding stays a one-liner over it.
 *
 * Historical anchors, all read off the decompressed
 * `places/ne_game/vrml/ne_game.wrl` `function onEvent(e, t)`:
 *
 *   e.type == 'keydown' / 'keyup' / 'mouseup'
 *   e.keyCode == 68 (D, fire) 87 (W, cycle weapon) 65 (A, pan / stabiliser)
 *   e.button == 2 / == 3        (right-click menu suppression)
 *   e.shiftKey == 1, e.ctrlKey == 1
 *   e.returnValue = 0           (script-side suppression of a default action)
 *
 * The mask bit assignment is NOT an anchor. The world only ever writes bits
 * 4, 5 and 6 together, so nothing surviving separates them - see the note at
 * the top of the helper.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const EVENTS_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_events.js");
const IDENTITY_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_identity.js");
const APP = path.join(SPA_SRC, "App.vue");

import {
  BXX_EVENT_MASK_BIT_4,
  BXX_EVENT_MASK_BIT_5,
  BXX_EVENT_MASK_BIT_6,
  BXX_INPUT_MASK_BITS,
  isDeliverableType,
  isEditableTarget,
  maskAllows,
  shouldDeliver,
  shouldPreventDefault,
  toBxxEvent,
} from "../src/helpers/bxx-key.helper";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

/**
 * The source with comments removed. The "no Outlands identity in this lane"
 * guards below are about executable code: the files legitimately DISCUSS the
 * historical world in prose, and a guard that tripped on a comment would push
 * the next author to delete the explanation rather than the leak.
 */
function codeOf(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function at(haystack: string, token: string): number {
  const index = haystack.indexOf(token);
  assert.notStrictEqual(index, -1, `expected to find: ${token}`);
  return index;
}

// ------------------------------------------------------------------ behaviour

test("the mask the world actually writes enables delivery", () => {
  // ne_game.wrl initialize(): m = m | (1<<5) | (1<<6) | (1<<4)
  const written = 0 | BXX_EVENT_MASK_BIT_5 | BXX_EVENT_MASK_BIT_6 | BXX_EVENT_MASK_BIT_4;
  assert.strictEqual(written, BXX_INPUT_MASK_BITS, "the constant matches the historical OR");
  assert.strictEqual(maskAllows(written), true);
});

test("the mask the world saves and restores on shutdown disables delivery", () => {
  // shutdown(): Browser.eventMask = oldMask, which is 0 on a fresh browser.
  assert.strictEqual(maskAllows(0), false, "a restored mask stops the bridge");
});

test("an unrelated mask bit does not enable delivery on its own", () => {
  assert.strictEqual(maskAllows(1 << 1), false);
  assert.strictEqual(maskAllows(1 << 7), false);
});

test("a junk mask is treated as off rather than crashing the bridge", () => {
  assert.strictEqual(maskAllows(Number.NaN), false);
  assert.strictEqual(maskAllows(Number.POSITIVE_INFINITY), false);
});

test("only the three historical event types are deliverable", () => {
  assert.strictEqual(isDeliverableType("keydown"), true);
  assert.strictEqual(isDeliverableType("keyup"), true);
  assert.strictEqual(isDeliverableType("mouseup"), true);
  assert.strictEqual(isDeliverableType("mousedown"), false, "the world never reads mousedown");
  assert.strictEqual(isDeliverableType("keypress"), false);
});

test("the fire key arrives in the shape the historical script compares", () => {
  // if (e.type == 'keydown' && e.keyCode == 68) { fire(0,t); }
  const event = toBxxEvent({ type: "keydown", keyCode: 68, shiftKey: false, ctrlKey: false });
  assert.strictEqual(event.type, "keydown");
  assert.strictEqual(event.keyCode, 68);
  assert.ok(event.type === "keydown" && event.keyCode === 68, "the D-to-fire test passes");
});

test("the weapon and pan keys survive the conversion", () => {
  assert.strictEqual(toBxxEvent({ type: "keydown", keyCode: 87 }).keyCode, 87, "W cycles weapon");
  assert.strictEqual(toBxxEvent({ type: "keydown", keyCode: 65 }).keyCode, 65, "A pans");
  assert.strictEqual(toBxxEvent({ type: "keyup", keyCode: 65 }).type, "keyup", "A releases pan");
});

test("keyCode falls back to which when the event only carries which", () => {
  assert.strictEqual(toBxxEvent({ type: "keydown", which: 68 }).keyCode, 68);
  assert.strictEqual(toBxxEvent({ type: "keydown" }).keyCode, 0, "never undefined");
});

test("modifiers are numbers because the script compares them with == 1", () => {
  // if (... e.shiftKey == 1 && e.ctrlKey == 1) { e.returnValue = 0; }
  const event = toBxxEvent({ type: "keydown", keyCode: 70, shiftKey: true, ctrlKey: true });
  assert.strictEqual(event.shiftKey, 1);
  assert.strictEqual(event.ctrlKey, 1);
  assert.ok(event.shiftKey === 1 && event.ctrlKey === 1, "the fly-disable test passes");
  const plain = toBxxEvent({ type: "keydown", keyCode: 70 });
  assert.strictEqual(plain.shiftKey, 0);
  assert.strictEqual(plain.ctrlKey, 0);
});

test("the right mouse button keeps the value the script suppresses on", () => {
  // if (e.type == 'mouseup' && e.button == 2) { e.returnValue = 0; }
  const event = toBxxEvent({ type: "mouseup", button: 2 });
  assert.strictEqual(event.button, 2, "the DOM value already satisfies the historical check");
  assert.ok(event.button === 2 || event.button === 3, "the suppression branch is reachable");
});

test("a missing button reads as -1 rather than undefined", () => {
  assert.strictEqual(toBxxEvent({ type: "keydown", keyCode: 68 }).button, -1);
});

test("returnValue starts at 1 and the script writing 0 asks for preventDefault", () => {
  const event = toBxxEvent({ type: "keydown", keyCode: 88 });
  assert.strictEqual(event.returnValue, 1, "default is not suppressed");
  assert.strictEqual(shouldPreventDefault(event), false);
  event.returnValue = 0;
  assert.strictEqual(shouldPreventDefault(event), true, "X and Z are disabled this way");
});

test("keys typed into a text field never reach the game", () => {
  assert.strictEqual(isEditableTarget({ tagName: "INPUT" }), true);
  assert.strictEqual(isEditableTarget({ tagName: "textarea" }), true, "tag case does not matter");
  assert.strictEqual(isEditableTarget({ tagName: "SELECT" }), true);
  assert.strictEqual(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.strictEqual(isEditableTarget({ tagName: "CANVAS" }), false);
  assert.strictEqual(isEditableTarget(null), false);
  assert.strictEqual(isEditableTarget(undefined), false);
});

test("chat input is protected from the world's W, A and D grabs", () => {
  const chat = { tagName: "INPUT" };
  for (const keyCode of [65, 68, 87, 32]) {
    assert.strictEqual(
      shouldDeliver(BXX_INPUT_MASK_BITS, { type: "keydown", keyCode }, chat),
      false,
      `keyCode ${keyCode} must not reach the world while typing`,
    );
  }
});

test("shouldDeliver combines all three reasons to drop an event", () => {
  const canvas = { tagName: "CANVAS" };
  assert.strictEqual(
    shouldDeliver(BXX_INPUT_MASK_BITS, { type: "keydown", keyCode: 68 }, canvas),
    true,
    "the ordinary fire case is delivered",
  );
  assert.strictEqual(
    shouldDeliver(0, { type: "keydown", keyCode: 68 }, canvas),
    false,
    "mask off",
  );
  assert.strictEqual(
    shouldDeliver(BXX_INPUT_MASK_BITS, { type: "keypress", keyCode: 68 }, canvas),
    false,
    "type not handled",
  );
});

// --------------------------------------------------------------------- wiring

test("the keyboard and identity shims are loaded by App.vue", () => {
  const app = read(APP);
  assert.ok(
    at(app, "libs/x_ite_mods/bxx_auth.js") < at(app, "libs/x_ite_mods/bxx_events.js"),
    "bxx_events wraps addRoute defined against the same prototype",
  );
  assert.ok(app.includes("libs/x_ite_mods/bxx_identity.js"), "the identity surface is loaded");
});

test("only the Browser event_changed route is intercepted", () => {
  const source = read(EVENTS_MOD);
  assert.ok(source.includes("isBrowserEventRoute"), "the special case is named");
  assert.ok(
    source.includes("originalAddRoute.call") && source.includes("originalDeleteRoute.call"),
    "every other route still reaches X_ITE, so other worlds are unaffected",
  );
});

test("listeners are scoped to the X_ITE element, never to window or document", () => {
  const source = read(EVENTS_MOD);
  assert.strictEqual(
    /window\s*\.\s*addEventListener|document\s*\.\s*addEventListener/.test(source),
    false,
    "a global listener would outlive the world and eat CTR's own input",
  );
  assert.ok(source.includes("elementOf"), "the element is resolved from the browser");
});

test("listeners are removed again, and cannot be attached twice", () => {
  const source = read(EVENTS_MOD);
  assert.ok(source.includes("removeEventListener"), "cleanup exists");
  assert.ok(
    source.includes("if (wanted && !s.listeners)"),
    "a second attach is refused while one is already bound",
  );
  assert.ok(
    at(source, "b.loadURL = function") < at(source, "originalLoadURL.apply"),
    "a world reload detaches before loading the next world",
  );
});

test("the identity shim supplies the surface but not an Outlands team", () => {
  const source = read(IDENTITY_MOD);
  assert.ok(source.includes("myAvatarURL") && source.includes("myAvatarName"), "surface present");
  assert.ok(source.includes("setIdentityProvider"), "OUTLANDS-2 has somewhere to register");
  assert.strictEqual(
    /redm\.wrl|redf\.wrl|bluem\.wrl|bluef\.wrl|gm\.wrl/.test(codeOf(IDENTITY_MOD)),
    false,
    "no game avatar may be hard-coded as the citizen's identity in this lane",
  );
  assert.strictEqual(
    /\bteam\b/i.test(codeOf(IDENTITY_MOD)),
    false,
    "team selection belongs to a later lane",
  );
});

// --------------------------------------------------------------------- runner

void (async (): Promise<void> => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.run();
      console.log(`  ok  ${item.name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL  ${item.name}`);
      console.error(`        ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
})();
