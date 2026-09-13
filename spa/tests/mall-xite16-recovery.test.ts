/**
 * The Mall under X_ITE 16.2.0: the three defects this lane closed, each held by
 * the behaviour that failed, and each with a negative control so the suite is
 * known to see the fault it guards against.
 *
 * The SPA harness is dependency-free - plain node, no DOM, no WebGL - so X_ITE
 * is not stood up. Instead the parts of 16.2.0 that these patches touch are
 * re-implemented in the shape the engine actually has them, read out of a live
 * 16.2.0 browser while this work was done:
 *
 *   * FieldDefinitionArray.add(key, value) is a MAP insert. Its guard is
 *       if (!(t instanceof this[ValueClass])) throw
 *         `Couldn't add value to ${type}, value for key '${e}' has wrong type.`
 *     so a ONE-argument call lands the definition in the key slot and leaves
 *     the value undefined. That is exactly what the shipped viewpoint_bind.js
 *     did, and why it always reported
 *       value for key '[object X3DFieldDefinition]' has wrong type
 *     and gave up.
 *   * Node instance fields are named with a LEADING underscore (`_position`,
 *     `_positionOffset`, `_isBound`), not X_ITE 4's trailing one.
 *   * A Viewpoint reports the citizen at `position + positionOffset`, and
 *     WALK-mode gravity accumulates into positionOffset.
 *
 * Four parts:
 *
 *   1. VIEWPOINT.BIND  - the alias the Mall's PROTO TransformView needs.
 *   2. VIEWPOINT DRIVE - a world that drives a BOUND viewpoint moves the
 *                        citizen. The Mall elevator is the proven case.
 *   3. CITY TIME       - the answer the Mall's two clock Scripts parse, and the
 *                        round trip through the arithmetic they authored.
 *   4. WORLD CONTRACT  - shopping.wrl asks CTR for the time, not a dead host.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SPA = path.resolve(__dirname, "../../..");
const MODS = path.join(SPA, "src/libs/x_ite_mods");
const APP = path.join(SPA, "src/App.vue");
const SHOPPING = path.join(SPA, "assets/worlds/shopping/vrml/shopping.wrl");
const { cityTime, authoredHour, cityTimeVrml, WORLD_HOUR_OFFSET } =
  require(path.join(SPA, "city-time"));

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void { tests.push({ name, run }); }

const read = (file: string): string => fs.readFileSync(file, "utf8");

/* ------------------------------------------------------------------ */
/* A stand-in for the parts of X_ITE 16.2.0 the patches reach into.    */
/* ------------------------------------------------------------------ */

/** X_ITE's FieldDefinitionArray: a map insert, keyed by name, type-guarded. */
class FieldDefinitionArray {
  private byName = new Map<string, any>();
  private list: any[] = [];
  constructor(private ValueClass: any) {}
  get length(): number { return this.list.length; }
  getTypeName(): string { return "FieldDefinitionArray"; }
  add(key: any, value: any): void {
    if (this.byName.has(key)) {
      throw new Error(`Couldn't add value to ${this.getTypeName()}, key '${key
      }' already exists.`);
    }
    if (!(value instanceof this.ValueClass)) {
      throw new Error(`Couldn't add value to ${this.getTypeName()}, value for key '${key
      }' has wrong type.`);
    }
    this.list.push(value);
    this.byName.set(key, value);
  }
  at(i: number): any { return this.list[i]; }
  [Symbol.iterator](): Iterator<any> { return this.list[Symbol.iterator](); }
}

class X3DFieldDefinition {
  constructor(public accessType: number, public name: string, public value: any) {}
}
class SFBool {
  constructor(public value = false) {}
  getValue(): boolean { return this.value; }
}
class SFVec3f {
  constructor(public x = 0, public y = 0, public z = 0) {}
}

/** A field that can carry an interest and a callback, as X_ITE's do. */
class Field {
  private interests: any[] = [];
  private callbacks = new Map<string, () => void>();
  constructor(public value: any) {}
  getValue(): any { return this.value; }
  setValue(v: any): void {
    this.value = v;
    if (v instanceof SFVec3f) { this.x = v.x; this.y = v.y; this.z = v.z; }
    this.fire();
  }
  addFieldInterest(target: Field): void { this.interests.push(target); }
  addFieldCallback(key: string, cb: () => void): void { this.callbacks.set(key, cb); }
  fire(): void {
    for (const t of this.interests) t.setValue(this.value);
    for (const cb of this.callbacks.values()) cb();
  }
  /* SFVec3f fields answer x/y/z directly. */
  public x = 0;
  public y = 0;
  public z = 0;
}

/**
 * Loads one x_ite_mods file with a fake global X3D, and returns the Viewpoint
 * class the patch has finished with. The compat shim's contract is reproduced:
 * X3D.require([ids], cb), X3D.fieldDefs(Klass), X3D.fieldDef(Klass, name).
 */
function loadPatch(file: string, Viewpoint: any, defs: FieldDefinitionArray): any[] {
  const warnings: any[] = [];
  const X3D: any = {
    X3DFieldDefinition,
    SFBool,
    SFVec3f,
    X3DConstants: { inputOnly: 2, inputOutput: 7 },
    require(ids: any, cb: any) {
      const modules = (Array.isArray(ids) ? ids : [ids]).map((id: string) =>
        (id.endsWith("Viewpoint") ? Viewpoint : id.endsWith("SFBool") ? SFBool : undefined));
      return cb ? cb(...modules) : modules[0];
    },
    fieldDefs: () => defs,
    fieldDef: (_k: any, name: string) => {
      for (const d of defs) { if (d.name === name) return d; }
      return undefined;
    },
  };
  const sandbox: any = {
    X3D,
    console: { warn: (...a: any[]) => warnings.push(a.join(" ")), error: () => undefined },
  };
  vm.runInNewContext(read(path.join(MODS, file)), sandbox);
  return warnings;
}

/** A Viewpoint class whose instances look like X_ITE 16's. */
function makeViewpointClass(): any {
  function Viewpoint(this: any) {
    this._bind = new Field(false);
    this._set_bind = new Field(false);
    this._isBound = new Field(false);
    this._position = new Field(new SFVec3f(0, 0, 0));
    this._positionOffset = new Field(new SFVec3f(0, 0, 0));
    this.initialised = false;
  }
  (Viewpoint as any).prototype.initialize = function () { this.initialised = true; };
  return Viewpoint;
}

/** The citizen is wherever position + positionOffset says they are. */
function userY(vp: any): number {
  return vp._position.value.y + vp._positionOffset.value.y;
}

/* ------------------------------------------------------------------ */
/* 1. VIEWPOINT.BIND                                                   */
/* ------------------------------------------------------------------ */

test("viewpoint_bind registers the 'bind' alias on X_ITE 16's field array", () => {
  const Viewpoint = makeViewpointClass();
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  const warnings = loadPatch("viewpoint_bind.js", Viewpoint, defs);
  assert.deepStrictEqual(warnings, [],
    `the patch gave up instead of registering the field: ${warnings.join(" | ")}`);
  assert.strictEqual(defs.length, 1, "no field definition was added");
  assert.strictEqual(defs.at(0).name, "bind");
  assert.strictEqual(defs.at(0).accessType, 2, "'bind' must be an eventIn");
});

test("viewpoint_bind wires bind into set_bind on a live Viewpoint", () => {
  const Viewpoint = makeViewpointClass();
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  loadPatch("viewpoint_bind.js", Viewpoint, defs);
  const vp: any = new (Viewpoint as any)();
  vp.initialize();
  assert.strictEqual(vp.initialised, true, "the original initialize() no longer runs");
  vp._bind.setValue(true);
  assert.strictEqual(vp._set_bind.getValue(), true,
    "writing Viewpoint.bind did not reach set_bind");
});

test("control: the one-argument add() X_ITE 16 rejects is the shipped failure", () => {
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  const def = new X3DFieldDefinition(2, "bind", new SFBool());
  assert.throws(
    () => (defs as any).add(def),
    /value for key '\[object Object\]' has wrong type|has wrong type/,
    "the control no longer reproduces the rejected add, so this suite proves nothing");
  assert.strictEqual(defs.length, 0);
});

/* ------------------------------------------------------------------ */
/* 2. VIEWPOINT DRIVE (the Mall elevator)                              */
/* ------------------------------------------------------------------ */

/**
 * One elevator ride, as the Mall authors it: the car writes absolute world
 * positions into a BOUND viewpoint while WALK gravity pulls on the citizen
 * crossing the open shaft. Measured on 16.2.0: one floor of fall, -6 on Y.
 */
function rideOneFloor(vp: any): void {
  vp._isBound.setValue(true);
  vp._position.setValue(new SFVec3f(-13.125, 1.75, -8));       // step in
  vp._positionOffset.setValue(new SFVec3f(0, -6, 0));          // gravity, open shaft
  vp._position.setValue(new SFVec3f(-11.625, 7.75, -11.625));  // arrive on floor 1
}

test("viewpoint_drive: a bound viewpoint driven by the world moves the citizen", () => {
  const Viewpoint = makeViewpointClass();
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  loadPatch("viewpoint_drive.js", Viewpoint, defs);
  const vp: any = new (Viewpoint as any)();
  vp.initialize();
  rideOneFloor(vp);
  assert.strictEqual(userY(vp), 7.75,
    `the citizen did not arrive on floor 1: y=${userY(vp)}`);
});

test("control: without the rule the citizen watches the ride from the ground", () => {
  const Viewpoint = makeViewpointClass();
  const vp: any = new (Viewpoint as any)();
  vp.initialize();
  rideOneFloor(vp);
  assert.strictEqual(userY(vp), 1.75,
    "the control no longer reproduces the cancelled ride, so this suite proves nothing");
});

test("viewpoint_drive leaves an UNBOUND viewpoint's offsets alone", () => {
  // The Plaza sets its entry viewpoint's position before binding it
  // (enter/vrml/enter.wrl:529); nothing may be cleared on the way past.
  const Viewpoint = makeViewpointClass();
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  loadPatch("viewpoint_drive.js", Viewpoint, defs);
  const vp: any = new (Viewpoint as any)();
  vp.initialize();
  vp._positionOffset.setValue(new SFVec3f(3, 0, 4));
  vp._position.setValue(new SFVec3f(10, 1.75, 28));
  assert.deepStrictEqual(
    [vp._positionOffset.value.x, vp._positionOffset.value.y, vp._positionOffset.value.z],
    [3, 0, 4],
    "an unbound viewpoint had its navigation offset cleared");
});

test("viewpoint_drive does not touch ordinary walking", () => {
  // Walking writes positionOffset and never position, so nothing fires.
  const Viewpoint = makeViewpointClass();
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  loadPatch("viewpoint_drive.js", Viewpoint, defs);
  const vp: any = new (Viewpoint as any)();
  vp.initialize();
  vp._isBound.setValue(true);
  vp._position.setValue(new SFVec3f(10, 1.75, 28));
  for (let step = 1; step <= 5; step += 1) {
    vp._positionOffset.setValue(new SFVec3f(0, 0, -step));
  }
  assert.strictEqual(vp._positionOffset.value.z, -5,
    "walking had its accumulated offset cleared");
});

test("viewpoint_drive still runs the original initialize", () => {
  const Viewpoint = makeViewpointClass();
  const defs = new FieldDefinitionArray(X3DFieldDefinition);
  loadPatch("viewpoint_drive.js", Viewpoint, defs);
  const vp: any = new (Viewpoint as any)();
  vp.initialize();
  assert.strictEqual(vp.initialised, true);
});

test("viewpoint_drive is loaded by App.vue, after viewpoint_bind", () => {
  const app = read(APP);
  const bind = app.indexOf("\"viewpoint_bind.js\"");
  const drive = app.indexOf("\"viewpoint_drive.js\"");
  assert.ok(drive > -1, "viewpoint_drive.js is not in the patch list");
  assert.ok(bind > -1 && drive > bind, "viewpoint_drive.js must follow viewpoint_bind.js");
});

/* ------------------------------------------------------------------ */
/* 3. CITY TIME                                                        */
/* ------------------------------------------------------------------ */

/**
 * The Mall's two Scripts, as authored, reading one answer. DayNight drives the
 * sky over 24 hours; AnalogClock drives a 12-hour dial.
 */
function dayNightHour(served: number): number {
  let hour = served + WORLD_HOUR_OFFSET;
  if (hour >= 24) { hour -= 24; }
  return hour;
}
function analogClockHour(served: number): number {
  let hour = served + WORLD_HOUR_OFFSET;
  if (hour >= 24) { hour -= 24; }
  if (hour >= 12) { hour -= 12; }
  return hour;
}

test("every City Time hour survives the world's own +2", () => {
  for (let cityHour = 0; cityHour < 24; cityHour += 1) {
    const served = authoredHour(cityHour);
    assert.ok(served >= 0 && served < 24, `served hour out of range: ${served}`);
    assert.strictEqual(dayNightHour(served), cityHour,
      `the sky would show ${dayNightHour(served)} at ${cityHour}:00`);
  }
});

test("the atrium dial reads the right 12-hour position at every hour", () => {
  for (let cityHour = 0; cityHour < 24; cityHour += 1) {
    const served = authoredHour(cityHour);
    assert.strictEqual(analogClockHour(served), cityHour % 12,
      `the dial would show ${analogClockHour(served)} at ${cityHour}:00`);
  }
});

test("the answer is VRML whose first root node carries min and hour", () => {
  const body = cityTimeVrml(new Date());
  assert.ok(body.startsWith("#VRML V2.0 utf8"), "the answer is not VRML");
  assert.ok(/exposedField SFFloat hour/.test(body), "no readable hour field");
  assert.ok(/exposedField SFFloat min/.test(body), "no readable min field");
  const instance = /CityTime \{ hour (\d+(?:\.\d+)?) min (\d+(?:\.\d+)?) \}/.exec(body);
  assert.ok(instance, `no CityTime instance in the answer:\n${body}`);
  const now = cityTime(new Date());
  assert.strictEqual(Number(instance![1]), authoredHour(now.hour));
  assert.strictEqual(Number(instance![2]), now.minute);
});

test("the answer changes with the clock, so a later visit gets a later time", () => {
  const at = (iso: string): string => cityTimeVrml(new Date(iso));
  // 15:04 and 15:05 UTC are 11:04 and 11:05 in New York on this date.
  assert.notStrictEqual(at("2026-06-01T15:04:00Z"), at("2026-06-01T15:05:00Z"));
  const parsed = /CityTime \{ hour (\d+) min (\d+) \}/.exec(at("2026-06-01T15:04:00Z"));
  assert.ok(parsed);
  assert.strictEqual(dayNightHour(Number(parsed![1])), 11, "not New York time");
  assert.strictEqual(Number(parsed![2]), 4);
});

test("midnight City Time is served as 22, not as a negative hour", () => {
  assert.strictEqual(authoredHour(0), 22);
  assert.strictEqual(dayNightHour(22), 0);
  assert.strictEqual(analogClockHour(22), 0, "midnight must sit on 12 o'clock");
});

/* ------------------------------------------------------------------ */
/* 4. WORLD CONTRACT                                                   */
/* ------------------------------------------------------------------ */

test("shopping.wrl asks CTR for the time, not the dead cybertown.com host", () => {
  const world = read(SHOPPING);
  // Only the two PROTO interface declarations carry a URL; the IS bindings and
  // the two Script call sites carry the name.
  const declared = world.split("\n").filter(line => /exposedField MFString scriptUrl/.test(line));
  assert.strictEqual(declared.length, 2,
    `expected two scriptUrl declarations, got ${declared.length}`);
  for (const line of declared) {
    const value = /scriptUrl\s*\[?"([^"]*)"/.exec(line);
    assert.ok(value, `no scriptUrl value in: ${line}`);
    assert.strictEqual(value![1], "/citytime.wrl",
      `a Mall clock still points at ${value![1]}`);
  }
  assert.ok(!/"http:\/\/www\.cybertown\.com\/cgi-bin\/games\/vrmltime\.pl"/.test(world),
    "the dead vrmltime.pl address is still a live value in shopping.wrl");
});

test("both Mall clock Scripts still fetch their time on load", () => {
  const world = read(SHOPPING);
  const calls = world.match(/Browser\.createVrmlFromURL\(scriptUrl,self,'receive'\)/g) || [];
  assert.ok(calls.length >= 4,
    `the clocks no longer fetch the time: ${calls.length} call sites`);
});

test("the 12-hour dial subtracts 24 then 12", () => {
  // shopping.wrl is a CRLF file, so the two lines are compared after
  // normalising the line endings rather than by matching a bare \n.
  const world = read(SHOPPING).replace(/\r\n/g, "\n");
  assert.ok(/if\(hour >= 24\)\{hour -= 24;\}\n if\(hour >= 12\)\{hour -= 12;\}/.test(world),
    "the AnalogClock hour arithmetic is not the corrected one");
  assert.ok(!/hour -= 23;/.test(world), "the off-by-one hour subtraction is back");
  assert.ok(!/hour -= 11;/.test(world), "the off-by-one 12-hour subtraction is back");
});

/* ------------------------------------------------------------------ */

for (const { name, run } of tests) {
  try {
    run();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : err);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
