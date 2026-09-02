/**
 * OUTLANDS-1h guard for the blaxxun `SharedEvent` wire codecs.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite does not load X_ITE 4.7.0. Instead it
 * re-implements the field classes the codecs construct, in the shape the tagged
 * X_ITE source has them:
 *
 *   * `Basic/X3DField.js` - `getTypeName()`, `getValue()`.
 *   * `Fields/SFVec2.js`  - a two-component field. Its constructor takes
 *                           `(x, y)` and throws `Invalid arguments.` on any
 *                           other arity. That throw is what the historical
 *                           defect actually produced in the browser, so the
 *                           stand-in reproduces it rather than being lenient.
 *   * `Fields/SFVec3.js`  - a three-component field, `(x, y, z)`.
 *   * `Fields/SFColor.js`, `Fields/SFRotation.js` - the other compound fields
 *                           the table builds.
 *
 * `createSharedEventCodecs()` takes the X_ITE namespace as an argument, so the
 * production table under test here is the same table the page builds; only the
 * namespace differs. A pass is therefore a statement about the real codecs.
 *
 * The suite is in six parts:
 *
 *   1. TYPE GATE - the hard gate. `vec3f.fromJSON` must return an `SFVec3f`,
 *      never an `SFVec2f`. This part fails against the old code.
 *   2. COMPONENTS - x, y and z each survive, proved with three distinct values
 *      and a non-zero negative component so no pair can pass by accident.
 *   3. ROUND TRIP - SFVec3f -> toJSON -> fromJSON -> SFVec3f.
 *   4. OTHER CODECS - bool, color, float, int32, rotation, string, time and
 *      vec2f still return their own types and values.
 *   5. OUTLANDS FLOW - the historical `beamOut_event` route read straight out
 *      of the shipped `ne_game.wrl`, proving the codec under test is the one
 *      that feeds `vec3fFromServer`.
 *   6. WIRING - asserted against the source of `WorldBrowserPage.vue` and the
 *      helper: the page builds its table from the helper, and no `vec3f` path
 *      constructs an `SFVec2f` anywhere.
 */
import assert from "assert";
import { createSharedEventCodecs } from "../src/helpers/shared-event.helper";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const HELPER = path.join(SPA_SRC, "helpers/shared-event.helper.ts");
const PAGE = path.join(SPA_SRC, "pages/world-browser/WorldBrowserPage.vue");
const OUTLANDS = path.join(SPA, "assets/worlds/ne_game/vrml/ne_game.wrl");

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}

/* ------------------------------------------------------------------ *
 * X_ITE 4.7.0's field classes, re-implemented in the shape of the source.
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `Basic/X3DField.js`: every field answers with its own type name. */
class X3DField {
  public getTypeName(): string { return this.constructor.name; }
}

/**
 * `Fields/SFVec2.js`. Two components.
 *
 * X_ITE 4.7.0 dispatches on `arguments.length` and throws for any count it
 * does not know. Handing it three numbers therefore raises
 * `Error: Invalid arguments.` - proved live in the browser against the
 * uncorrected bundle, where every `vec3f` SharedEvent receive threw inside
 * `onSharedEvent` and never reached the world at all.
 */
class SFVec2f extends X3DField {
  public x: number;
  public y: number;
  public constructor(x = 0, y = 0) {
    super();
    if (arguments.length > 2) { throw new Error("Invalid arguments."); }
    this.x = x;
    this.y = y;
  }
  public getValue(): number[] { return [this.x, this.y]; }
}

/** `Fields/SFVec3.js`. Three components. */
class SFVec3f extends X3DField {
  public x: number;
  public y: number;
  public z: number;
  public constructor(x = 0, y = 0, z = 0) {
    super();
    this.x = x;
    this.y = y;
    this.z = z;
  }
  public getValue(): number[] { return [this.x, this.y, this.z]; }
}

/** `Fields/SFColor.js`. */
class SFColor extends X3DField {
  public r: number;
  public g: number;
  public b: number;
  public constructor(r = 0, g = 0, b = 0) {
    super();
    this.r = r;
    this.g = g;
    this.b = b;
  }
}

/** `Fields/SFRotation.js`. An axis and an angle. */
class SFRotation extends X3DField {
  public x: number;
  public y: number;
  public z: number;
  public angle: number;
  public constructor(x = 0, y = 0, z = 1, angle = 0) {
    super();
    this.x = x;
    this.y = y;
    this.z = z;
    this.angle = angle;
  }
}

const X3D = { SFVec2f, SFVec3f, SFColor, SFRotation };
const TYPES = createSharedEventCodecs(X3D);

function sourceOf(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/* ------------------------------------------------------------------ *
 * 1. TYPE GATE
 * ------------------------------------------------------------------ */

test("vec3f fromJSON returns an SFVec3f", () => {
  const received = TYPES.vec3f.fromJSON({ x: 1, y: 2, z: 3 });
  assert.strictEqual(received.getTypeName(), "SFVec3f");
  assert.ok(received instanceof SFVec3f, "not an SFVec3f instance");
});

test("vec3f fromJSON never returns an SFVec2f", () => {
  const received = TYPES.vec3f.fromJSON({ x: 1, y: 2, z: 3 });
  assert.notStrictEqual(received.getTypeName(), "SFVec2f");
  assert.ok(!(received instanceof SFVec2f), "the two-component field came back");
});

test("the received field carries three components, not two", () => {
  const received = TYPES.vec3f.fromJSON({ x: 1, y: 2, z: 3 });
  assert.deepStrictEqual(received.getValue(), [1, 2, 3]);
});

/* ------------------------------------------------------------------ *
 * 2. COMPONENTS
 * ------------------------------------------------------------------ */

test("x, y and z all survive the receive codec", () => {
  const received = TYPES.vec3f.fromJSON({ x: 1, y: 2, z: 3 });
  assert.strictEqual(received.x, 1, "x lost");
  assert.strictEqual(received.y, 2, "y lost");
  assert.strictEqual(received.z, 3, "z lost");
});

test("a non-zero negative z survives", () => {
  const received = TYPES.vec3f.fromJSON({ x: 1.25, y: -2.5, z: 7.75 });
  assert.strictEqual(received.x, 1.25);
  assert.strictEqual(received.y, -2.5);
  assert.strictEqual(received.z, 7.75);
});

test("three distinct components cannot pass by coincidence", () => {
  const value = { x: -11.5, y: 0.25, z: -943.125 };
  const received = TYPES.vec3f.fromJSON(value);
  assert.ok(value.x !== value.y && value.y !== value.z && value.x !== value.z);
  assert.strictEqual(received.x, value.x);
  assert.strictEqual(received.y, value.y);
  assert.strictEqual(received.z, value.z);
});

test("vec3f toJSON keeps all three components", () => {
  const sent = TYPES.vec3f.toJSON(new SFVec3f(1.25, -2.5, 7.75));
  assert.deepStrictEqual(sent, { x: 1.25, y: -2.5, z: 7.75 });
});

/* ------------------------------------------------------------------ *
 * 3. ROUND TRIP
 * ------------------------------------------------------------------ */

test("SFVec3f survives toJSON then fromJSON unchanged", () => {
  const before = new SFVec3f(1.25, -2.5, 7.75);
  const wire = JSON.parse(JSON.stringify(TYPES.vec3f.toJSON(before)));
  const after = TYPES.vec3f.fromJSON(wire);
  assert.strictEqual(after.getTypeName(), "SFVec3f");
  assert.deepStrictEqual(after.getValue(), before.getValue());
});

test("a viewpoint-shaped position survives the round trip", () => {
  // The shape `Browser.viewpointPosition` hands to `beamOut_sent`.
  const before = new SFVec3f(-64.5, 1.75, 128.25);
  const after = TYPES.vec3f.fromJSON(TYPES.vec3f.toJSON(before));
  assert.deepStrictEqual(after.getValue(), [-64.5, 1.75, 128.25]);
});

/* ------------------------------------------------------------------ *
 * 4. OTHER CODECS
 * ------------------------------------------------------------------ */

test("the table still holds exactly the nine blaxxun types", () => {
  assert.deepStrictEqual(Object.keys(TYPES).sort(), [
    "bool", "color", "float", "int32", "rotation",
    "string", "time", "vec2f", "vec3f",
  ]);
});

test("the pass-through codecs still pass values through", () => {
  assert.strictEqual(TYPES.bool.fromJSON(true), true);
  assert.strictEqual(TYPES.bool.toJSON(false), false);
  assert.strictEqual(TYPES.float.fromJSON(-0.5), -0.5);
  assert.strictEqual(TYPES.float.toJSON(2.25), 2.25);
  assert.strictEqual(TYPES.int32.fromJSON(-7), -7);
  assert.strictEqual(TYPES.int32.toJSON(9), 9);
  assert.strictEqual(TYPES.string.fromJSON("Ryan"), "Ryan");
  assert.strictEqual(TYPES.string.toJSON("Ryan"), "Ryan");
  assert.strictEqual(TYPES.time.fromJSON(1234.5), 1234.5);
  assert.strictEqual(TYPES.time.toJSON(1234.5), 1234.5);
});

test("color still returns an SFColor with its own components", () => {
  const received = TYPES.color.fromJSON({ r: 0.1, g: 0.5, b: 0.9 });
  assert.strictEqual(received.getTypeName(), "SFColor");
  assert.strictEqual(received.r, 0.1);
  assert.strictEqual(received.g, 0.5);
  assert.strictEqual(received.b, 0.9);
  assert.deepStrictEqual(TYPES.color.toJSON(new SFColor(0.1, 0.5, 0.9)),
    { r: 0.1, g: 0.5, b: 0.9 });
});

test("rotation still returns an SFRotation with its axis and angle", () => {
  const received = TYPES.rotation.fromJSON({ x: 0, y: 1, z: 0, angle: 1.5 });
  assert.strictEqual(received.getTypeName(), "SFRotation");
  assert.deepStrictEqual(
    [received.x, received.y, received.z, received.angle], [0, 1, 0, 1.5]);
  assert.deepStrictEqual(TYPES.rotation.toJSON(new SFRotation(0, 1, 0, 1.5)),
    { x: 0, y: 1, z: 0, angle: 1.5 });
});

test("vec2f still returns a two-component SFVec2f", () => {
  const received = TYPES.vec2f.fromJSON({ x: 3.5, y: -4.5 });
  assert.strictEqual(received.getTypeName(), "SFVec2f");
  assert.deepStrictEqual(received.getValue(), [3.5, -4.5]);
  assert.deepStrictEqual(TYPES.vec2f.toJSON(new SFVec2f(3.5, -4.5)),
    { x: 3.5, y: -4.5 });
});

test("vec2f and vec3f are not the same codec", () => {
  const wire = { x: 1, y: 2, z: 3 };
  assert.strictEqual(TYPES.vec2f.fromJSON(wire).getTypeName(), "SFVec2f");
  assert.strictEqual(TYPES.vec3f.fromJSON(wire).getTypeName(), "SFVec3f");
});

test("the old constructor would have thrown, so nothing reached the world", () => {
  // The exact call the uncorrected page made, and X_ITE 4.7.0's answer to it.
  // The cast is needed only because TypeScript now rejects the arity that the
  // untyped `X3D` global happily allowed.
  const TwoComponent = SFVec2f as any;
  assert.throws(() => new TwoComponent(1.25, -2.5, 7.75), /Invalid arguments\./);
});

/* ------------------------------------------------------------------ *
 * 5. OUTLANDS FLOW - read from the shipped world, not from memory.
 * ------------------------------------------------------------------ */

const outlands = zlib.gunzipSync(fs.readFileSync(OUTLANDS)).toString("latin1");

test("Outlands declares a SharedEvent that carries an SFVec3f", () => {
  assert.ok(/DEF\s+beamOut_event\s+SharedEvent\s*\{\s*name\s+"BeamOutEvent"\s*\}/
    .test(outlands), "beamOut_event is not in the shipped world");
  assert.ok(/eventIn\s+SFVec3f\s+vec3fFromServer/.test(outlands));
  assert.ok(/eventOut\s+SFVec3f\s+vec3f_changed/.test(outlands));
});

test("the beamOut route runs through the vec3f side of the PROTO", () => {
  assert.ok(/ROUTE\s+battle\.beamOut_sent\s+TO\s+beamOut_event\.set_vec3f/
    .test(outlands), "the send route is not the one traced");
  assert.ok(/ROUTE\s+beamOut_event\.vec3f_changed\s+TO\s+battle\.receive_beamOut/
    .test(outlands), "the receive route is not the one traced");
});

test("the world's own script declares beamOut as SFVec3f on both sides", () => {
  assert.ok(/eventIn\s+SFVec3f\s+receive_beamOut/.test(outlands));
  assert.ok(/eventOut\s+SFVec3f\s+beamOut_sent/.test(outlands));
});

/* ------------------------------------------------------------------ *
 * 6. WIRING
 * ------------------------------------------------------------------ */

test("the page builds its codec table from the helper", () => {
  const page = sourceOf(PAGE);
  assert.ok(/createSharedEventCodecs/.test(page), "the page does not call the helper");
  assert.ok(!/this\.TYPES\s*=\s*\{/.test(page), "the page still holds an inline table");
});

test("no vec3f path anywhere constructs an SFVec2f", () => {
  const helper = sourceOf(HELPER);
  const vec3f = helper.slice(helper.indexOf("vec3f: {"));
  assert.ok(!/SFVec2f/.test(vec3f), "the vec3f codec still builds an SFVec2f");
  assert.ok(/new x3d\.SFVec3f\(/.test(vec3f), "the vec3f codec does not build an SFVec3f");
});

test("the helper knows nothing about Outlands, Vue or the socket", () => {
  const helper = sourceOf(HELPER).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/ne_game|beamOut_event|turret_/.test(helper), "a world name is hard-coded");
  assert.ok(!/Vue|\$socket|emit\(/.test(helper), "the helper reaches outside itself");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
