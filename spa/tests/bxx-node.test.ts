/**
 * OUTLANDS-1f guard for blaxxun `SFNode.getName()` Script-view compatibility.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite does not stand up an X_ITE browser. Instead
 * it re-implements the exact objects on X_ITE 4.7.0's node path, in the shape
 * the tagged source has them:
 *
 *   * `Base/X3DObject.js`       - `getName()` returns `this._name`.
 *   * `Basic/X3DField.js`       - `_value`, `getValue()`.
 *   * `Fields/SFNode.js`        - the `Proxy` handler, `valueOf()` returning
 *                                 `SFNodeCache.get(value)`, `getNodeName()`.
 *   * `Fields/SFNodeCache.js`   - the `WeakMap`, `add()` and `get()`.
 *   * `Basic/X3DObjectArrayField.js` - the index trap, `array[i].valueOf()`.
 *   * `Components/Scripting/Script.js` - `getGlobal()` binding each user field
 *                                 under `field.getName()`.
 *   * `Execution/X3DExecutionContext.js` - `addRoute()`, including the exact
 *                                 "Bad ROUTE specification: Unkown field ..."
 *                                 message (X_ITE's own misspelling).
 *
 * Everything is then proved through those objects, so a pass here is a
 * statement about X_ITE's real node path and not about a convenient stub.
 *
 * The suite is in six parts:
 *
 *   1. RULE - `blaxxunNodeName` against `bxx-node.helper`.
 *   2. NODE PATH - MFNode elements, direct SFNode fields, sandbox binding, and
 *      the SFNode methods that must not move.
 *   3. GLOBAL SAFETY - the hard gate. `SFNode.prototype.getName` is untouched,
 *      field objects still answer with their own names, and the sandbox still
 *      binds `field SFNode shared` as `shared`.
 *   4. HISTORICAL LOOKUP - the generic `events[i].getName() == name` shape, run
 *      over a real twenty-four-node shared-event set, then the seven routes.
 *   5. CORPUS - the same shape found in the shipped worlds, proving the rule is
 *      general and needs no per-world exception.
 *   6. WIRING - asserted against the source of `libs/x_ite_mods/bxx_node.js`
 *      and `App.vue`: still loaded, still free of a prototype patch, still free
 *      of any world knowledge.
 */
import assert from "assert";
import {
  BLAXXUN_NODE_VIEW,
  applyBlaxxunNodeView,
  blaxxunNodeName,
  installBlaxxunNodeView,
} from "../src/helpers/bxx-node.helper";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const NODE_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_node.js");
const NODE_HELPER = path.join(SPA_SRC, "helpers/bxx-node.helper.ts");
const APP = path.join(SPA_SRC, "App.vue");
const WORLDS = path.join(SPA, "assets/worlds");

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
 * X_ITE 4.7.0's node path, re-implemented in the shape of the source.
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `Base/X3DObject.js`: the one `getName()` X_ITE has. */
class X3DObject {
  public _name = "";
  public getName(): string { return this._name; }
  public setName(value: string): void { this._name = value; }
}

/** A live scene-graph node. Its name is the DEF name. */
class BaseNode extends X3DObject {
  private readonly fields = new Map<string, any>();
  private readonly type: string;
  public constructor(typeName: string, defName = "") {
    super();
    this.type = typeName;
    this.setName(defName);
  }
  public getTypeName(): string { return this.type; }
  public addField(name: string, field: any): void {
    field.setName(name);
    this.fields.set(name, field);
  }
  public getField(name: string): any {
    const field = this.fields.get(name);
    if (!field) {
      throw new Error(
        `Bad ROUTE specification: Unkown field '${name}' in node class ${this.type}.`,
      );
    }
    return field;
  }
  public getFieldNames(): string[] { return Array.from(this.fields.keys()); }
}

/** `Basic/X3DField.js`. */
class X3DField extends X3DObject {
  public _value: any;
  public constructor(value: any = null) { super(); this._value = value; }
  public getValue(): any { return this._value; }
  public valueOf(): any { return this._value; }
  public setValue(value: any): void { this._value = value; }
}

class SFString extends X3DField {
  public constructor(value = "") { super(value); }
  public getTypeName(): string { return "SFString"; }
}

class SFRotation extends X3DField {
  public getTypeName(): string { return "SFRotation"; }
}

/** `Fields/SFNodeCache.js`, verbatim in shape. */
const cacheStore = new WeakMap<BaseNode, any>();
const SFNodeCache: Record<string, any> = {
  add(baseNode: BaseNode, node?: any): any {
    const created = node || makeSFNode(baseNode);
    cacheStore.set(baseNode, created);
    return created;
  },
  get(baseNode: BaseNode): any {
    const held = cacheStore.get(baseNode);
    if (held) return held;
    const created = makeSFNode(baseNode);
    cacheStore.set(baseNode, created);
    return created;
  },
};

/**
 * The cache exactly as X_ITE ships it, captured before any test installs the
 * compatibility layer. The "before the fix" assertions read through this, so
 * they prove the historical failure no matter what order the suite runs in.
 */
const PRISTINE_GET = SFNodeCache.get.bind(SFNodeCache);

/** `Fields/SFNode.js`'s proxy handler, in the shape the tagged source has it. */
const sfnodeHandler: ProxyHandler<any> = {
  get(target: any, key: any): any {
    try {
      const value = target[key];
      if (value !== undefined) return value;
      return target.getValue().getField(key).valueOf();
    } catch (error) {
      return undefined;
    }
  },
  set(target: any, key: any, value: any): boolean {
    if (key in target) { target[key] = value; return true; }
    try {
      target.getValue().getField(key).setValue(value);
      return true;
    } catch (error) {
      return false;
    }
  },
  has(target: any, key: any): boolean {
    try { return Boolean(target.getValue().getField(key)); } catch (error) { return key in target; }
  },
};

class SFNode extends X3DField {
  public constructor(value: BaseNode | null = null) { super(value); }
  public getTypeName(): string { return "SFNode"; }
  public getType(): string { return "SFNode-constant"; }
  public getNodeName(): string {
    const value = this.getValue();
    if (value) return value.getName();
    throw new Error("SFNode.getNodeName: node is null.");
  }
  public getNodeTypeName(): string {
    const value = this.getValue();
    if (value) return value.getTypeName();
    throw new Error("SFNode.getNodeTypeName: node is null.");
  }
  /** `SFNode.prototype.valueOf` - the whole reason `SFNodeCache` is the seam. */
  public valueOf(): any {
    const value = this.getValue();
    if (value) return SFNodeCache.get(value);
    return null;
  }
  public toString(): string {
    const value = this.getValue();
    return `SFNode(${value ? value.getName() : "NULL"})`;
  }
}

function makeSFNode(value: BaseNode | null): any {
  return new Proxy(new SFNode(value), sfnodeHandler);
}

/** `Basic/X3DObjectArrayField.js`: index reads answer `array[i].valueOf()`. */
const arrayHandler: ProxyHandler<any> = {
  get(target: any, key: any): any {
    const index = typeof key === "string" ? Number(key) : NaN;
    if (Number.isInteger(index) && index >= 0) {
      const element = target.array[index];
      return element ? element.valueOf() : undefined;
    }
    return target[key];
  },
};

class MFNode extends X3DField {
  public array: SFNode[] = [];
  public constructor(nodes: BaseNode[] = []) {
    super(null);
    this.array = nodes.map((node) => new SFNode(node));
  }
  public get length(): number { return this.array.length; }
  public getTypeName(): string { return "MFNode"; }
  public valueOf(): any { return makeMFNode(this); }
}

function makeMFNode(field: MFNode): any {
  return new Proxy(field, arrayHandler);
}

/**
 * `Components/Scripting/Script.js` `getGlobal()`: every user-defined field is
 * bound under `field.getName()`, and reads go through `field.valueOf()`.
 */
function getGlobal(userDefinedFields: Map<string, X3DField>): any {
  const descriptors: PropertyDescriptorMap = {};
  userDefinedFields.forEach((field) => {
    const name = field.getName();
    descriptors[name] = { get: field.valueOf.bind(field), configurable: true };
  });
  return Object.create(Object.prototype, descriptors);
}

/** `Execution/X3DExecutionContext.js` `addRoute()`, reduced to what it checks. */
function addRoute(
  sourceNode: any, sourceField: string, destinationNode: any, destinationField: string,
): string {
  if (!(sourceNode instanceof SFNode)) {
    throw new Error("Bad ROUTE specification: source node must be of type SFNode.");
  }
  if (!(destinationNode instanceof SFNode)) {
    throw new Error("Bad ROUTE specification: destination node must be of type SFNode.");
  }
  const source = sourceNode.getValue();
  const destination = destinationNode.getValue();
  if (!source) throw new Error("Bad ROUTE specification: source node is NULL.");
  if (!destination) throw new Error("Bad ROUTE specification: destination node is NULL.");
  source.getField(sourceField);
  destination.getField(destinationField);
  return `${source.getName()}.${sourceField} -> ${destination.getName()}.${destinationField}`;
}

/* ------------------------------------------------------------------ *
 * The scene the historical worlds actually present.
 * ------------------------------------------------------------------ */

/** The eventIn/eventOut set the historical `SharedEvent` PROTO declares. */
function sharedEvent(defName: string): BaseNode {
  const node = new BaseNode("SharedEvent", defName);
  for (const name of ["set_string", "string_changed", "set_rotation", "rotation_changed"]) {
    node.addField(name, name.indexOf("rotation") === -1 ? new SFString() : new SFRotation());
  }
  return node;
}

/** A `Group`, which is what an unresolved `field SFNode lock Group{}` stays. */
function group(defName = ""): BaseNode {
  return new BaseNode("Group", defName);
}

const TURRETS = 10;

function buildZone(): { zone: BaseNode; events: MFNode } {
  const nodes: BaseNode[] = [
    sharedEvent("beamer_event"),
    sharedEvent("repulsor_event"),
    sharedEvent("aapd_event"),
    sharedEvent("beamOut_event"),
  ];
  for (let i = 0; i < TURRETS; i += 1) {
    nodes.push(sharedEvent(`turret_lock_${i}`));
    nodes.push(sharedEvent(`turret_motion_${i}`));
  }
  const zone = new BaseNode("BlaxxunZone", "SharedZone");
  const events = new MFNode(nodes);
  zone.addField("events", events);
  return { zone, events };
}

/**
 * The historical lookup, character for character in shape. No world name and no
 * node type: an index walk, `getName()`, and `==` against a built string.
 */
function getRefs(shared: any, id: number): { lock: any; motion: any } {
  const lockName = new SFString(`turret_lock_${id}`);
  const motionName = new SFString(`turret_motion_${id}`);
  let lock: any = makeSFNode(group());
  let motion: any = makeSFNode(group());
  for (let i = 0; i < shared.events.length; i += 1) {
    // `==` is the historical operator, kept verbatim. OUTLANDS-1e proved it
    // coerces correctly; the left operand was the only thing ever wrong.
    /* eslint-disable eqeqeq */
    if (shared.events[i].getName() == lockName.valueOf()) lock = shared.events[i];
    if (shared.events[i].getName() == motionName.valueOf()) motion = shared.events[i];
    /* eslint-enable eqeqeq */
  }
  return { lock, motion };
}

/** A fresh, isolated copy of the whole world plus the compatibility layer. */
function scene(withCompat: boolean): { shared: any; battle: any; self: any } {
  if (withCompat) installBlaxxunNodeView(SFNodeCache);

  const { zone } = buildZone();

  const battleNode = new BaseNode("Battle", "battle");
  for (const name of ["set_turret", "exit_turret", "release_turret"]) {
    battleNode.addField(name, new SFString());
  }

  const selfNode = new BaseNode("Script", "self");
  for (const name of [
    "lock_turret", "got_turret", "rotation_changed", "set_motion",
    "set_turret", "exit_turret", "release_turret",
  ]) {
    selfNode.addField(name, new SFString());
  }

  // `field SFNode shared` on the Script node, exactly as the world declares it.
  const sharedField = new SFNode(zone);
  sharedField.setName("shared");
  const battleField = new SFNode(battleNode);
  battleField.setName("battle");
  const selfField = new SFNode(selfNode);
  selfField.setName("self");

  const fields = new Map<string, X3DField>([
    ["shared", sharedField], ["battle", battleField], ["self", selfField],
  ]);
  const global = getGlobal(fields);

  return { shared: global.shared, battle: global.battle, self: global.self };
}

/* ------------------------------------------------------------------ *
 * 1. RULE
 * ------------------------------------------------------------------ */

console.log("\n-- rule --");

test("blaxxunNodeName reports a node's DEF name", () => {
  assert.strictEqual(blaxxunNodeName(new SFNode(group("turret_lock_0"))), "turret_lock_0");
});

test("blaxxunNodeName invents no name for an un-DEF'd node", () => {
  assert.strictEqual(blaxxunNodeName(new SFNode(group())), "");
});

test("blaxxunNodeName reports empty for a NULL node", () => {
  assert.strictEqual(blaxxunNodeName(new SFNode(null)), "");
});

test("blaxxunNodeName never throws on a foreign object", () => {
  assert.strictEqual(blaxxunNodeName(null), "");
  assert.strictEqual(blaxxunNodeName(undefined), "");
  assert.strictEqual(blaxxunNodeName({} as any), "");
  assert.strictEqual(blaxxunNodeName({ getValue: () => { throw new Error("boom"); } }), "");
});

test("applyBlaxxunNodeView is idempotent", () => {
  const node = makeSFNode(group("twice"));
  applyBlaxxunNodeView(node);
  const first = node.getName;
  applyBlaxxunNodeView(node);
  assert.strictEqual(node.getName, first);
  assert.strictEqual(node.getName(), "twice");
});

test("applyBlaxxunNodeView marks the instance non-enumerably", () => {
  const node = makeSFNode(group("marked"));
  applyBlaxxunNodeView(node);
  const descriptor = Object.getOwnPropertyDescriptor(node, BLAXXUN_NODE_VIEW);
  assert.ok(descriptor, "the marker must be an own property");
  assert.strictEqual(descriptor!.enumerable, false);
  assert.strictEqual(
    Object.getOwnPropertyDescriptor(node, "getName")!.enumerable, false,
  );
});

test("installBlaxxunNodeView refuses to wrap a cache twice", () => {
  const fake: Record<string, any> = { add: () => ({}), get: () => ({}) };
  assert.strictEqual(installBlaxxunNodeView(fake), true);
  assert.strictEqual(installBlaxxunNodeView(fake), false);
});

/* ------------------------------------------------------------------ *
 * 2. NODE PATH
 * ------------------------------------------------------------------ */

console.log("\n-- node path --");

test("without the layer, an MFNode element answers getName() with ''", () => {
  const { events } = buildZone();
  // `shared.events[4]` resolves to `array[4].valueOf()`, i.e. the cache entry
  // for that base node. Read it through the pristine cache to see exactly what
  // a 2026 X_ITE hands a 1999 script.
  const element = PRISTINE_GET(events.array[4].getValue());
  assert.strictEqual(element.getName(), "", "this is the historical failure");
  assert.strictEqual(element.getNodeName(), "turret_lock_0");
});

test("an MFNode element answers getName() with the DEF name", () => {
  installBlaxxunNodeView(SFNodeCache);
  const { events } = buildZone();
  const list = makeMFNode(events);
  assert.strictEqual(list[0].getName(), "beamer_event");
  assert.strictEqual(list[4].getName(), "turret_lock_0");
  assert.strictEqual(list[5].getName(), "turret_motion_0");
  assert.strictEqual(list[22].getName(), "turret_lock_9");
});

test("a direct SFNode script field answers getName() with the DEF name", () => {
  const { shared } = scene(true);
  assert.strictEqual(shared.getName(), "SharedZone");
});

test("a direct SFNode script field still binds under the FIELD name", () => {
  const { shared, battle, self } = scene(true);
  assert.ok(shared, "`field SFNode shared` must bind as `shared`");
  assert.ok(battle, "`field SFNode battle` must bind as `battle`");
  assert.ok(self, "`field SFNode self` must bind as `self`");
  assert.strictEqual(shared.getNodeName(), "SharedZone");
});

test("getNodeName still works everywhere", () => {
  installBlaxxunNodeView(SFNodeCache);
  const { events } = buildZone();
  const list = makeMFNode(events);
  for (let i = 0; i < 24; i += 1) {
    assert.strictEqual(list[i].getName(), list[i].getNodeName());
  }
});

test("an un-DEF'd node still gets no fake name", () => {
  installBlaxxunNodeView(SFNodeCache);
  const anonymous = new SFNode(group()).valueOf();
  assert.strictEqual(anonymous.getName(), "");
});

test("every other SFNode method is untouched", () => {
  installBlaxxunNodeView(SFNodeCache);
  const node = new SFNode(sharedEvent("turret_lock_3")).valueOf();
  assert.strictEqual(node.getTypeName(), "SFNode");
  assert.strictEqual(node.getType(), "SFNode-constant");
  assert.strictEqual(node.getNodeName(), "turret_lock_3");
  assert.strictEqual(node.getNodeTypeName(), "SharedEvent");
  assert.strictEqual(node.getValue().getName(), "turret_lock_3");
  assert.strictEqual(node.toString(), "SFNode(turret_lock_3)");
  assert.ok(node.valueOf());
});

test("field access through the SFNode proxy still resolves", () => {
  installBlaxxunNodeView(SFNodeCache);
  const { zone } = buildZone();
  const view = new SFNode(zone).valueOf();
  assert.strictEqual(view.events.length, 24, "`shared.events` must still read");
});

test("event routing still resolves through a viewed node", () => {
  installBlaxxunNodeView(SFNodeCache);
  const node = new SFNode(sharedEvent("turret_lock_1")).valueOf();
  assert.strictEqual(
    addRoute(node, "string_changed", node, "set_string"),
    "turret_lock_1.string_changed -> turret_lock_1.set_string",
  );
});

test("two scripts keep their own field names", () => {
  installBlaxxunNodeView(SFNodeCache);
  const { zone } = buildZone();

  const a = new SFNode(zone); a.setName("shared");
  const b = new SFNode(zone); b.setName("theZone");

  const globalA = getGlobal(new Map([["shared", a]]));
  const globalB = getGlobal(new Map([["theZone", b]]));

  assert.ok(globalA.shared, "script A binds `shared`");
  assert.strictEqual(globalA.theZone, undefined, "script A must not see script B's name");
  assert.ok(globalB.theZone, "script B binds `theZone`");
  assert.strictEqual(globalB.shared, undefined, "script B must not see script A's name");
  // Both still reach the same node, and both read the same DEF name.
  assert.strictEqual(globalA.shared.getName(), "SharedZone");
  assert.strictEqual(globalB.theZone.getName(), "SharedZone");
});

/* ------------------------------------------------------------------ *
 * 3. GLOBAL SAFETY - the hard gate
 * ------------------------------------------------------------------ */

console.log("\n-- global safety --");

test("SFNode.prototype gains no getName of its own", () => {
  installBlaxxunNodeView(SFNodeCache);
  new SFNode(group("anything")).valueOf();
  assert.ok(
    !Object.prototype.hasOwnProperty.call(SFNode.prototype, "getName"),
    "a prototype getName is the failure OUTLANDS-1e measured",
  );
});

test("an X_ITE FIELD object still answers with its own field name", () => {
  installBlaxxunNodeView(SFNodeCache);
  const field = new SFNode(group("SharedZone"));
  field.setName("shared");
  // This is the negative test for a global prototype patch: with one installed,
  // the field would answer "SharedZone" and every script sandbox would break.
  assert.strictEqual(
    field.getName(), "shared",
    "a global SFNode.prototype.getName patch would make this the DEF name",
  );
});

test("the script sandbox still binds field SFNode shared as 'shared'", () => {
  installBlaxxunNodeView(SFNodeCache);
  const field = new SFNode(buildZone().zone);
  field.setName("shared");
  const global = getGlobal(new Map([["shared", field]]));
  assert.ok(
    Object.prototype.hasOwnProperty.call(global, "shared"),
    "X_ITE binds by field.getName(); a prototype patch binds by DEF name instead",
  );
  assert.ok(!Object.prototype.hasOwnProperty.call(global, "SharedZone"));
});

test("a non-SFNode field object is not touched at all", () => {
  installBlaxxunNodeView(SFNodeCache);
  const text = new SFString("turret_lock_0");
  text.setName("lockName");
  assert.strictEqual(text.getName(), "lockName");
  assert.strictEqual(
    Object.getOwnPropertyDescriptor(text, BLAXXUN_NODE_VIEW), undefined,
  );
});

test("base nodes keep the name X_ITE's own machinery reads", () => {
  installBlaxxunNodeView(SFNodeCache);
  const base = group("SharedZone");
  new SFNode(base).valueOf();
  assert.strictEqual(base.getName(), "SharedZone");
  assert.ok(!Object.prototype.hasOwnProperty.call(base, "getName"));
});

/* ------------------------------------------------------------------ *
 * 4. HISTORICAL LOOKUP
 * ------------------------------------------------------------------ */

console.log("\n-- historical lookup --");

test("without the layer the historical lookup matches nothing", () => {
  const { events } = buildZone();
  let matches = 0;
  for (let i = 0; i < events.array.length; i += 1) {
    const element = PRISTINE_GET(events.array[i].getValue());
    /* eslint-disable eqeqeq */
    if (element.getName() == "turret_lock_0") matches += 1;
    if (element.getName() == "turret_motion_0") matches += 1;
    /* eslint-enable eqeqeq */
  }
  assert.strictEqual(matches, 0, "getRefs matched 0 of 24 - the reported failure");
});

test("all ten turret pairs resolve to their SharedEvent", () => {
  const { shared } = scene(true);
  for (let id = 0; id < TURRETS; id += 1) {
    const { lock, motion } = getRefs(shared, id);
    assert.strictEqual(lock.getName(), `turret_lock_${id}`, `turret ${id} lock`);
    assert.strictEqual(motion.getName(), `turret_motion_${id}`, `turret ${id} motion`);
    assert.strictEqual(lock.getNodeTypeName(), "SharedEvent", `turret ${id} lock type`);
    assert.strictEqual(motion.getNodeTypeName(), "SharedEvent", `turret ${id} motion type`);
  }
});

test("the seven turret routes construct for every turret", () => {
  const { shared, battle, self } = scene(true);
  for (let id = 0; id < TURRETS; id += 1) {
    const { lock, motion } = getRefs(shared, id);
    const routes = [
      () => addRoute(self, "lock_turret", lock, "set_string"),
      () => addRoute(lock, "string_changed", self, "got_turret"),
      () => addRoute(self, "rotation_changed", motion, "set_rotation"),
      () => addRoute(motion, "rotation_changed", self, "set_motion"),
      () => addRoute(self, "set_turret", battle, "set_turret"),
      () => addRoute(self, "exit_turret", battle, "exit_turret"),
      () => addRoute(battle, "release_turret", self, "release_turret"),
    ];
    assert.strictEqual(routes.length, 7);
    for (const route of routes) route();
  }
});

test("the old set_string Group error is what an unresolved lock still gives", () => {
  // The layer must not hide a genuinely missing node: an unresolved lock is
  // still a Group, and still fails exactly as X_ITE reports it.
  const { self } = scene(true);
  const unresolved = makeSFNode(group());
  assert.throws(
    () => addRoute(self, "lock_turret", unresolved, "set_string"),
    /Bad ROUTE specification: Unkown field 'set_string' in node class Group\./,
  );
});

test("SFString comparison behaviour is not changed", () => {
  // OUTLANDS-1e proved `==` already coerces an SFString. Nothing here may alter
  // that, and nothing here may rely on String(), which adds VRML quotes.
  const text = new SFString("turret_lock_0");
  // eslint-disable-next-line eqeqeq
  assert.ok(text.valueOf() == "turret_lock_0");
  assert.strictEqual(text.valueOf(), "turret_lock_0");
});

/* ------------------------------------------------------------------ *
 * 5. CORPUS
 * ------------------------------------------------------------------ */

console.log("\n-- corpus --");

function worldFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.wrl$/i.test(entry.name)) out.push(full);
    }
  };
  walk(WORLDS);
  return out.sort();
}

function sourceOf(file: string): string {
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return zlib.gunzipSync(bytes).toString("latin1");
  return bytes.toString("latin1");
}

test("the shipped worlds do call node.getName()", () => {
  const callers = worldFiles().filter((file: string) => /\.getName\s*\(\s*\)/.test(sourceOf(file)));
  assert.ok(
    callers.length >= 15,
    `expected the shipped corpus to keep its getName() callers, found ${callers.length}`,
  );
});

test("a non-Outlands world uses the same MFNode-element shape", () => {
  // `008/home.wrl` is the bottle game. It is a different world, a different
  // author and a different PROTO set, and it depends on exactly the lookup this
  // lane restores. It is not modified here, only read.
  const bottle = sourceOf(path.join(WORLDS, "008/home.wrl"));
  assert.ok(
    /sharedZone\.events\[i\]\.getName\s*\(\s*\)\s*==/.test(bottle),
    "the bottle game's shared-event lookup must still be present",
  );
  assert.ok(
    /children\[i\]\.getName\s*\(\s*\)\s*==/.test(bottle),
    "the bottle game's children lookup must still be present",
  );
});

test("the bottle game's lookup resolves under the same layer", () => {
  // Same code shape, different names, no Outlands types anywhere.
  installBlaxxunNodeView(SFNodeCache);
  const zone = new BaseNode("BlaxxunZone", "SharedZone");
  zone.addField("events", new MFNode([
    new BaseNode("SharedEvent", "bottle_make3"),
    new BaseNode("SharedEvent", "bottle_destroy3"),
  ]));
  const shared = makeSFNode(zone);

  let make: any = null;
  const bottleID = 3;
  for (let i = 0; i < shared.events.length; i += 1) {
    // The bottle game's own line, operator and concatenation kept as written.
    /* eslint-disable eqeqeq, prefer-template */
    if (shared.events[i].getName() == ("bottle_make" + bottleID)) make = shared.events[i];
    /* eslint-enable eqeqeq, prefer-template */
  }
  assert.ok(make, "the bottle game's own lookup must match");
  assert.strictEqual(make.getNodeName(), "bottle_make3");
});

test("Browser.getName() is a different call and is left alone", () => {
  // `jail/vrml/avatar/jailbird.wrl` and the Outlands avatars call
  // `Browser.getName()`. That is the browser's name, not a node's, and this
  // lane must not be anywhere near it.
  const jailbird = sourceOf(path.join(WORLDS, "jail/vrml/avatar/jailbird.wrl"));
  assert.ok(/Browser\.getName\s*\(\s*\)/.test(jailbird));
  assert.ok(
    !/Browser/.test(codeOf(NODE_MOD).replace(/X3D\.require|window\.X3D|X3D = /g, "")),
    "the mod must not touch the Browser object",
  );
});

/* ------------------------------------------------------------------ *
 * 6. WIRING
 * ------------------------------------------------------------------ */

console.log("\n-- wiring --");

/** Drops comment lines, so these assertions read code and never prose. */
function codeOf(file: string): string {
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line: string) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
}

test("App.vue loads the shim", () => {
  const app = fs.readFileSync(APP, "utf8");
  assert.ok(
    /require\("\.\/libs\/x_ite_mods\/bxx_node\.js"\);/.test(app),
    "bxx_node.js must be required alongside the other X_ITE mods",
  );
});

test("the shim never patches SFNode.prototype", () => {
  for (const file of [NODE_MOD, NODE_HELPER]) {
    const code = codeOf(file);
    assert.ok(
      !/SFNode\s*\.\s*prototype/.test(code),
      `${path.basename(file)} must not reach for SFNode.prototype`,
    );
    assert.ok(
      !/prototype\s*\.\s*getName/.test(code),
      `${path.basename(file)} must not replace a prototype getName`,
    );
  }
});

test("the shim hooks the cache and nothing wider", () => {
  const code = codeOf(NODE_MOD);
  assert.ok(/SFNodeCache/.test(code), "the cache is the seam");
  assert.ok(!/new Proxy/.test(code), "no new proxy layer belongs here");
  assert.ok(!/getNodeName/.test(codeOf(NODE_HELPER)), "the DEF name comes from the base node");
});

test("the shim does not touch the OUTLANDS-1b or 1d surfaces", () => {
  const code = codeOf(NODE_MOD) + codeOf(NODE_HELPER);
  assert.ok(!/bxx_hud|bxx_ray|bxx_script/.test(code), "no cross-mod reach");
  assert.ok(!/computeRayHit/.test(code));
});

test("neither the shim nor the rule knows anything about Outlands", () => {
  for (const file of [NODE_MOD, NODE_HELPER]) {
    const code = codeOf(file);
    assert.ok(!/ne_game/.test(code), `${path.basename(file)} hard-codes a world name`);
    const where = path.basename(file);
    assert.ok(!/turret_lock|turret_motion/.test(code), `${where} hard-codes a DEF name`);
    assert.ok(!/SharedEvent|BlaxxunZone/.test(code), `${where} hard-codes a node type`);
    assert.ok(!/\bOutlands\b/.test(code), `${path.basename(file)} hard-codes the game`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
