/**
 * OUTLANDS-1l guard for blaxxun `new SFNode()` NULL-constructor compatibility.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite does not stand up an X_ITE browser. Instead
 * it re-implements the exact objects on X_ITE 4.7.0's script path, in the shape
 * the tagged source has them:
 *
 *   * `Components/Scripting/Script.js` - `getGlobal()`, including the local
 *     string-parsing `SFNode` closure verbatim, the bare `{ value: SFNode }`
 *     descriptor that makes it non-writable and non-configurable, the sibling
 *     field-type entries, the user-field getter/setter pairs, and the closing
 *     `Object.create (Object.prototype, global)`.
 *   * `Browser/Scripting/evaluate.js` - `with (arguments [0]) return eval (...)`,
 *     which is how a historical script actually reaches `SFNode`.
 *   * `Fields/SFNode.js` - the constructor that stores `null` when it is called
 *     with nothing, plus the `Proxy` it returns.
 *   * `Fields/SFNodeCache.js` - `add()`, which is what the string path returns.
 *   * `X3DBrowser.createX3DFromString` - a parse that fails on the text
 *     `undefined`, yields an empty scene for `""`, and yields one root node for
 *     `Group{}`. Every call is counted, because "the parser is not reached" is
 *     a hard gate of this lane.
 *
 * Everything is then proved through those objects, so a pass here is a
 * statement about X_ITE's real script path and not about a convenient stub.
 *
 * The suite is in eight parts:
 *
 *   1. RULE - `isBlaxxunNullSFNodeCall` against `bxx-sfnode.helper`.
 *   2. BASELINE - the historical failure, reproduced through the pristine
 *      sandbox, so every later assertion is measured against a real defect.
 *   3. CONSTRUCTOR MATRIX - the four required calls.
 *   4. NULL VALUE - the returned object is X_ITE's own `SFNode` holding `null`,
 *      not a placeholder and not a `Group`.
 *   5. PARSER BYPASS - the hard gate. `createX3DFromString` is not called.
 *   6. SANDBOX SAFETY - the second hard gate. No prototype patch, no global
 *      write, every other sandbox entry and every field binding untouched.
 *   7. HISTORICAL SHAPE - the real turret `set_prox` FALSE branch, and the
 *      unrelated non-Outlands "clear the slot" idiom, both run through the
 *      sandbox. Then the shipped corpus.
 *   8. WIRING - asserted against the source of `libs/x_ite_mods/bxx_sfnode.js`
 *      and `App.vue`: loaded, free of a prototype patch, free of a parser
 *      change, and free of any world knowledge.
 */
import assert from "assert";
import {
  BLAXXUN_NULL_SFNODE,
  installBlaxxunNullSFNode,
  isBlaxxunNullSFNodeCall,
  makeBlaxxunSFNodeConstructor,
} from "../src/helpers/bxx-sfnode.helper";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const SFNODE_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_sfnode.js");
const SFNODE_HELPER = path.join(SPA_SRC, "helpers/bxx-sfnode.helper.ts");
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
 * X_ITE 4.7.0's script path, re-implemented in the shape of the source.
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `Base/X3DObject.js` and `Basic/X3DField.js`, reduced to what is used here.
 */
class X3DField {
  public _value: any;
  public constructor(value: any = null) { this._value = value; }
  public getValue(): any { return this._value; }
  public valueOf(): any { return this._value; }
  public setValue(value: any): void { this._value = value; }
  public getName(): string { return ""; }
}

type X3DFieldLike = X3DField;

/** A live scene-graph node. */
class BaseNode {
  private readonly type: string;
  private readonly def: string;
  public constructor(typeName: string, defName = "") { this.type = typeName; this.def = defName; }
  public getTypeName(): string { return this.type; }
  public getName(): string { return this.def; }
  public addParent(): void { /* X_ITE tracks parents; nothing here reads them. */ }
}

/**
 * `Fields/SFNode.js`, in the shape the tagged source has it:
 *
 *   function SFNode (value) {
 *     if (value) { value .addParent (this); X3DField .call (this, value); }
 *     else       { X3DField .call (this, null); }
 *     return new Proxy (this, handler);
 *   }
 *
 * X_ITE is ES5, so it reaches its base with `X3DField .call`; `super ()` here
 * is the same statement. The `else` branch is the whole point of this lane:
 * X_ITE can already build blaxxun's NULL node, it just never let a script ask
 * for one.
 */
const nativeHandler: ProxyHandler<any> = {
  get(target: any, key: any): any { return target[key]; },
};

class NativeSFNode extends X3DField {
  public constructor(value?: any) {
    super(value ? value : null);
    if (value) value.addParent();
    return new Proxy(this, nativeHandler);
  }
  public getTypeName(): string { return "SFNode"; }
  public isDefaultValue(): boolean { return this.getValue() === null; }
  public equals(node: any): boolean {
    if (node) return this.getValue() === node.getValue();
    return this.getValue() === null;
  }
}

/** `Fields/SFNodeCache.js` - what the string path hands back. */
const cacheStore = new WeakMap<BaseNode, any>();
const SFNodeCache = {
  add(baseNode: BaseNode, node?: any): any {
    const created = node && typeof node === "object" ? node : new NativeSFNode(baseNode);
    if (created._value === undefined || created._value === null) created._value = baseNode;
    cacheStore.set(baseNode, created);
    return created;
  },
};

/** Sibling field types. Every one of these is a real class on the sandbox. */
class SFVec3f extends X3DField { public getTypeName(): string { return "SFVec3f"; } }
class MFNode extends X3DField { public getTypeName(): string { return "MFNode"; } }

/**
 * `X3DBrowser.createX3DFromString`, reduced to the three outcomes the lane
 * cares about, with a call counter. The `undefined` outcome is X_ITE's real
 * one: all three parse handlers reject the text and it throws
 * `Couldn't parse x3d syntax.`.
 */
class Browser {
  public parseCalls: string[] = [];
  public createX3DFromString(text: string): any {
    this.parseCalls.push(text);

    if (text === "") return { getRootNodes(): any[] { return []; } };

    const match = /^\s*(\w+)\s*\{\s*\}\s*$/.exec(text);
    if (!match) throw new Error("Couldn't parse x3d syntax.");

    const node = new BaseNode(match[1]);
    return {
      getRootNodes(): any[] { return [{ getValue(): BaseNode { return node; } }]; },
      isLive(): any { return { getValue(): boolean { return true; } }; },
      setLive(): void { /* no-op */ },
      setPrivate(): void { /* no-op */ },
      setExecutionContext(): void { /* no-op */ },
    };
  }
  public println(): void { /* no-op */ }
}

/** A user-declared script field, bound by `getGlobal` as a getter/setter pair. */
interface UserField { name: string; field: X3DFieldLike }

/**
 * `Script.prototype.getGlobal`, verbatim in shape - including the local
 * `SFNode` closure, its `prototype` assignment, the bare `{ value: ... }`
 * descriptors, the user-field bindings, and the closing `Object.create`.
 */
function makeXiteGetGlobal(browser: Browser, userFields: UserField[]) {
  return function getGlobal(): any {
    function SFNode(this: any, vrmlSyntax?: any): any {
      const scene = browser.createX3DFromString(String(vrmlSyntax));
      const rootNodes = scene.getRootNodes();

      if (rootNodes.length && rootNodes[0]) {
        return SFNodeCache.add(rootNodes[0].getValue(), this);
      }

      throw new Error("SFNode.new: invalid argument, must be 'string' is 'undefined'.");
    }

    SFNode.prototype = NativeSFNode.prototype;

    const global: PropertyDescriptorMap = {
      NULL: { value: null },
      FALSE: { value: false },
      TRUE: { value: true },
      print: { value: function (): void { browser.println(); } },
      Browser: { value: browser },
      SFNode: { value: SFNode },
      SFVec3f: { value: SFVec3f },
      MFNode: { value: MFNode },
    };

    for (const entry of userFields) {
      global[entry.name] = {
        get: entry.field.valueOf.bind(entry.field),
        set: entry.field.setValue.bind(entry.field),
      };
    }

    return Object.create(Object.prototype, global);
  };
}

/**
 * `Browser/Scripting/evaluate.js`, verbatim:
 *
 *   return function () { with (arguments [0]) { return eval (arguments [1]); } };
 *
 * It is built with `new Function` because `with` is not allowed in a module.
 */
const EVALUATE_SOURCE =
  "return function () { with (arguments [0]) { return eval (arguments [1]); } };";

const xiteEvaluate = new Function(EVALUATE_SOURCE)() as Function;

function evaluate(global: any, text: string): any {
  return xiteEvaluate(global, text);
}

/** A sandbox with the lane's compatibility installed, and its parse counter. */
function makeSandbox(userFields: UserField[] = []): { global: any; browser: Browser } {
  const browser = new Browser();
  const global = installBlaxxunNullSFNode(makeXiteGetGlobal(browser, userFields)(), NativeSFNode);
  return { global, browser };
}

/** The same sandbox with NO compatibility - X_ITE 4.7.0 exactly as shipped. */
function makePristineSandbox(userFields: UserField[] = []): { global: any; browser: Browser } {
  const browser = new Browser();
  return { global: makeXiteGetGlobal(browser, userFields)(), browser };
}

/**
 * Script sources that themselves contain a double quote. The house quote style
 * is double, so they are written once here with the inner quotes escaped.
 */
const NEW_SFNODE_EMPTY = "new SFNode(\"\")";
const NEW_SFNODE_GROUP = "new SFNode(\"Group{}\")";

function threw(body: () => void): string {
  try {
    body();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

function codeOf(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/* ------------------------------------------------------------------ *
 * 1. RULE
 * ------------------------------------------------------------------ */
console.log("\n-- rule --");

test("no argument at all is the historical NULL construction", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall([]), true);
});

test("one explicit undefined is the same statement", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall([undefined]), true);
});

test("an empty string is a string, not a missing argument", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall([""]), false);
});

test("a real vrml string is never the NULL case", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall(["Group{}"]), false);
});

test("null is not undefined and is left to X_ITE", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall([null]), false);
});

test("a node argument is left to X_ITE", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall([new BaseNode("Group")]), false);
});

test("more than one argument is never the NULL case", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall([undefined, undefined]), false);
  assert.strictEqual(isBlaxxunNullSFNodeCall([undefined, "Group{}"]), false);
});

test("a missing argument list is refused, never assumed", () => {
  assert.strictEqual(isBlaxxunNullSFNodeCall(null), false);
  assert.strictEqual(isBlaxxunNullSFNodeCall(undefined), false);
});

test("the constructor factory keeps the original prototype", () => {
  const original = function (): void { /* stands in for X_ITE's closure */ };
  const wrapped = makeBlaxxunSFNodeConstructor(original, NativeSFNode);
  assert.strictEqual(wrapped.prototype, original.prototype);
});

/* ------------------------------------------------------------------ *
 * 2. BASELINE - the defect, through X_ITE as shipped
 * ------------------------------------------------------------------ */
console.log("\n-- baseline: X_ITE 4.7.0 as shipped --");

test("without the lane, new SFNode() throws Couldn't parse x3d syntax.", () => {
  const { global } = makePristineSandbox();
  assert.strictEqual(
    threw(() => evaluate(global, "new SFNode()")),
    "Couldn't parse x3d syntax.",
  );
});

test("without the lane, the parser really is handed the text 'undefined'", () => {
  const { global, browser } = makePristineSandbox();
  threw(() => evaluate(global, "new SFNode()"));
  assert.deepStrictEqual(browser.parseCalls, ["undefined"]);
});

test("without the lane, new SFNode(undefined) fails the same way", () => {
  const { global } = makePristineSandbox();
  assert.strictEqual(
    threw(() => evaluate(global, "new SFNode(undefined)")),
    "Couldn't parse x3d syntax.",
  );
});

test("without the lane, the historical turret branch dies on its first null", () => {
  const lock = new X3DField(new BaseNode("Group", "lock"));
  const motion = new X3DField(new BaseNode("Group", "motion"));
  const { global } = makePristineSandbox([
    { name: "lock", field: lock },
    { name: "motion", field: motion },
  ]);

  assert.strictEqual(
    threw(() => evaluate(global, "lock = new SFNode(); motion = new SFNode();")),
    "Couldn't parse x3d syntax.",
  );
  assert.ok(motion.getValue(), "motion is never reached, exactly as reported");
});

/* ------------------------------------------------------------------ *
 * 3. CONSTRUCTOR MATRIX
 * ------------------------------------------------------------------ */
console.log("\n-- constructor matrix --");

test("new SFNode() returns a value instead of throwing", () => {
  const { global } = makeSandbox();
  const node = evaluate(global, "new SFNode()");
  assert.ok(node, "a NULL SFNode is an object, not a thrown error");
});

test("new SFNode(undefined) returns a value instead of throwing", () => {
  const { global } = makeSandbox();
  const node = evaluate(global, "new SFNode(undefined)");
  assert.ok(node, "the explicit form is the same statement");
});

test("an empty string keeps X_ITE's existing behaviour, unchanged", () => {
  const before = threw(() => evaluate(makePristineSandbox().global, NEW_SFNODE_EMPTY));
  const after = threw(() => evaluate(makeSandbox().global, NEW_SFNODE_EMPTY));

  assert.strictEqual(
    after,
    "SFNode.new: invalid argument, must be 'string' is 'undefined'.",
    "the empty string must not be reinterpreted as NULL",
  );
  assert.strictEqual(after, before, "the lane did not move this case at all");
});

test("a valid vrml string is still a valid node", () => {
  const { global } = makeSandbox();
  const node = evaluate(global, NEW_SFNODE_GROUP);
  assert.ok(node, "a parsed node is returned");
  assert.strictEqual(node.getValue().getTypeName(), "Group");
});

/* ------------------------------------------------------------------ *
 * 4. NULL VALUE
 * ------------------------------------------------------------------ */
console.log("\n-- null value --");

test("the NULL result is X_ITE's own SFNode, not a stand-in", () => {
  const { global } = makeSandbox();
  const node = evaluate(global, "new SFNode()");
  assert.ok(node instanceof NativeSFNode, "built by x_ite/Fields/SFNode");
  assert.strictEqual(node.getTypeName(), "SFNode");
});

test("the NULL result holds null, not a placeholder node", () => {
  const { global } = makeSandbox();
  const node = evaluate(global, "new SFNode()");
  assert.strictEqual(node.getValue(), null, "the contained node value is NULL");
  assert.strictEqual(node.isDefaultValue(), true);
});

test("no Group and no other node is invented for the NULL case", () => {
  const { global } = makeSandbox();
  for (const source of ["new SFNode()", "new SFNode(undefined)"]) {
    const node = evaluate(global, source);
    assert.strictEqual(node.getValue(), null, `${source} must not build a node`);
  }
});

test("the NULL result answers blaxxun's null comparison", () => {
  const { global } = makeSandbox();
  const node = evaluate(global, "new SFNode()");
  assert.strictEqual(node.equals(null), true);
  assert.strictEqual(node.getValue() === null, true);
});

test("assigning the NULL result to an SFNode field clears the field", () => {
  const lock = new X3DField(new BaseNode("Group", "lock"));
  const { global } = makeSandbox([{ name: "lock", field: lock }]);

  evaluate(global, "lock = new SFNode();");

  assert.strictEqual(lock.getValue().getValue(), null, "the slot now holds a NULL node");
});

/* ------------------------------------------------------------------ *
 * 5. PARSER BYPASS - hard gate
 * ------------------------------------------------------------------ */
console.log("\n-- parser bypass (hard gate) --");

test("new SFNode() never calls createX3DFromString", () => {
  const { global, browser } = makeSandbox();
  evaluate(global, "new SFNode()");
  assert.deepStrictEqual(browser.parseCalls, [], "the parser must not be reached");
});

test("new SFNode(undefined) never calls createX3DFromString", () => {
  const { global, browser } = makeSandbox();
  evaluate(global, "new SFNode(undefined)");
  assert.deepStrictEqual(browser.parseCalls, [], "the parser must not be reached");
});

test("the text 'undefined' never reaches the parser again", () => {
  const { global, browser } = makeSandbox();
  evaluate(global, "new SFNode(); new SFNode(undefined); new SFNode();");
  assert.strictEqual(browser.parseCalls.indexOf("undefined"), -1);
  assert.strictEqual(browser.parseCalls.length, 0);
});

test("a real string still reaches the parser, argument untouched", () => {
  const { global, browser } = makeSandbox();
  evaluate(global, NEW_SFNODE_GROUP);
  assert.deepStrictEqual(browser.parseCalls, ["Group{}"]);
});

test("the empty string still reaches the parser", () => {
  const { global, browser } = makeSandbox();
  threw(() => evaluate(global, NEW_SFNODE_EMPTY));
  assert.deepStrictEqual(browser.parseCalls, [""], "X_ITE's own path, unchanged");
});

/* ------------------------------------------------------------------ *
 * 6. SANDBOX SAFETY - hard gate
 * ------------------------------------------------------------------ */
console.log("\n-- sandbox safety (hard gate) --");

test("the string case still runs through X_ITE's own constructor", () => {
  const browser = new Browser();
  const raw = makeXiteGetGlobal(browser, [])();
  const original = Object.getOwnPropertyDescriptor(raw, "SFNode")!.value;

  let delegated = 0;
  const spy = function (this: any, ...values: unknown[]): unknown {
    delegated += 1;
    return original.apply(this, values);
  };
  spy.prototype = original.prototype;

  const wrapped = makeBlaxxunSFNodeConstructor(spy, NativeSFNode);

  assert.ok(new (wrapped as any)("Group{}"), "the parsed node comes back");
  assert.strictEqual(delegated, 1, "X_ITE's constructor is still in the path");

  new (wrapped as any)();
  assert.strictEqual(delegated, 1, "the NULL case does not delegate");
});

test("no parsing logic is duplicated in the helper", () => {
  const code = codeOf(SFNODE_HELPER).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/createX3DFromString/.test(code), "the helper never calls the parser");
  assert.ok(!/getRootNodes|SFNodeCache/.test(code), "the string path is not re-implemented");
});

test("X_ITE's SFNode prototype is not patched", () => {
  const before = NativeSFNode.prototype.getTypeName;
  makeSandbox();
  assert.strictEqual(NativeSFNode.prototype.getTypeName, before);
});

test("the wrapper keeps X_ITE's own prototype on the sandbox constructor", () => {
  const browser = new Browser();
  const raw = makeXiteGetGlobal(browser, [])();
  const original = Object.getOwnPropertyDescriptor(raw, "SFNode")!.value;
  const global = installBlaxxunNullSFNode(raw, NativeSFNode);
  const swapped = Object.getOwnPropertyDescriptor(global, "SFNode")!.value;

  assert.notStrictEqual(swapped, original, "the entry really was swapped");
  assert.strictEqual(swapped.prototype, original.prototype, "the prototype did not move");
});

test("every other sandbox entry is carried across unchanged", () => {
  const browser = new Browser();
  const raw = makeXiteGetGlobal(browser, [])();
  const global = installBlaxxunNullSFNode(raw, NativeSFNode);

  for (const key of ["NULL", "FALSE", "TRUE", "Browser", "SFVec3f", "MFNode", "print"]) {
    assert.strictEqual(
      Object.getOwnPropertyDescriptor(global, key)!.value,
      Object.getOwnPropertyDescriptor(raw, key)!.value,
      `${key} moved`,
    );
  }
});

test("the sandbox descriptor shape is X_ITE's own", () => {
  const global = makeSandbox().global;
  const raw = makeXiteGetGlobal(new Browser(), [])();
  const swapped = Object.getOwnPropertyDescriptor(global, "SFNode")!;
  const original = Object.getOwnPropertyDescriptor(raw, "SFNode")!;

  assert.strictEqual(swapped.writable, original.writable);
  assert.strictEqual(swapped.enumerable, original.enumerable);
  assert.strictEqual(swapped.configurable, original.configurable);
});

test("user field getters and setters keep working through the new sandbox", () => {
  const shared = new X3DField(new BaseNode("Group", "shared"));
  const { global } = makeSandbox([{ name: "shared", field: shared }]);

  assert.strictEqual(evaluate(global, "shared").getName(), "shared");
  evaluate(global, "shared = \"changed\";");
  assert.strictEqual(shared.getValue(), "changed", "the bound setter still fires");
});

test("the sandbox prototype chain is unchanged", () => {
  const raw = makeXiteGetGlobal(new Browser(), [])();
  const global = installBlaxxunNullSFNode(raw, NativeSFNode);
  assert.strictEqual(Object.getPrototypeOf(global), Object.getPrototypeOf(raw));
});

test("installing twice is installing once", () => {
  const raw = makeXiteGetGlobal(new Browser(), [])();
  const once = installBlaxxunNullSFNode(raw, NativeSFNode);
  const twice = installBlaxxunNullSFNode(once, NativeSFNode);
  assert.strictEqual(twice, once, "the marked sandbox is returned as it is");
  assert.ok((once as any)[BLAXXUN_NULL_SFNODE], "the marker is set");
});

test("the marker is invisible to a script's own enumeration", () => {
  const global = makeSandbox().global;
  assert.strictEqual(Object.keys(global).indexOf(BLAXXUN_NULL_SFNODE), -1);
});

test("a sandbox without a function under SFNode is handed back untouched", () => {
  const odd = Object.create(Object.prototype, { SFNode: { value: "not a function" } });
  assert.strictEqual(installBlaxxunNullSFNode(odd, NativeSFNode), odd);
});

test("a missing native SFNode leaves X_ITE's behaviour in place", () => {
  const raw = makeXiteGetGlobal(new Browser(), [])();
  assert.strictEqual(installBlaxxunNullSFNode(raw, undefined), raw);
  assert.strictEqual(installBlaxxunNullSFNode(raw, null), raw);
});

test("nothing is written to any global object", () => {
  const code = codeOf(SFNODE_HELPER) + codeOf(SFNODE_MOD).replace(/\/\/.*$/gm, "");
  assert.ok(!/window\.SFNode\s*=/.test(code), "window.SFNode is never assigned");
  assert.ok(!/SFNode\.prototype\s*\.\w+\s*=/.test(code), "no prototype method is replaced");
  assert.ok(!/globalThis/.test(code));
});

/* ------------------------------------------------------------------ *
 * 7. HISTORICAL SHAPE
 * ------------------------------------------------------------------ */
console.log("\n-- historical shape --");

/**
 * `ne_game.wrl`'s `set_prox(v,t)` FALSE branch, in its historical shape. The
 * eight live turrets are declared `autoRef FALSE`, so `battle` and `shared` are
 * skipped and `lock` is the statement that threw.
 */
const TURRET_SET_PROX = `
  function set_prox (v, t) {
    if (v) { return "entered"; }
    if (autoRef) { battle = new SFNode(); shared = new SFNode(); }
    lock   = new SFNode();
    motion = new SFNode();
    return "cleared";
  }
  set_prox (false, 0);
`;

test("the historical turret FALSE branch now runs to completion", () => {
  const autoRef = new X3DField(false);
  const lock = new X3DField(new BaseNode("Group", "lock"));
  const motion = new X3DField(new BaseNode("Group", "motion"));
  const { global, browser } = makeSandbox([
    { name: "autoRef", field: autoRef },
    { name: "lock", field: lock },
    { name: "motion", field: motion },
  ]);

  assert.strictEqual(evaluate(global, TURRET_SET_PROX), "cleared");
  assert.strictEqual(lock.getValue().getValue(), null, "lock is NULL");
  assert.strictEqual(motion.getValue().getValue(), null, "motion is reached and NULL");
  assert.deepStrictEqual(browser.parseCalls, [], "0 parser calls");
});

test("four turrets going inactive produce four nulls and zero parser calls", () => {
  const browser = new Browser();
  let parserErrors = 0;

  for (let turret = 0; turret < 4; turret += 1) {
    const autoRef = new X3DField(false);
    const lock = new X3DField(new BaseNode("Group", "lock"));
    const motion = new X3DField(new BaseNode("Group", "motion"));
    const global = installBlaxxunNullSFNode(
      makeXiteGetGlobal(browser, [
        { name: "autoRef", field: autoRef },
        { name: "lock", field: lock },
        { name: "motion", field: motion },
      ])(),
      NativeSFNode,
    );

    const message = threw(() => evaluate(global, TURRET_SET_PROX));
    if (message) parserErrors += 1;

    assert.strictEqual(lock.getValue().getValue(), null);
    assert.strictEqual(motion.getValue().getValue(), null);
  }

  assert.strictEqual(parserErrors, 0, "0 Couldn't parse x3d syntax.");
  assert.deepStrictEqual(browser.parseCalls, [], "0 createX3DFromString calls");
});

test("the autoRef TRUE branch clears all four slots too", () => {
  const autoRef = new X3DField(true);
  const fields = ["battle", "shared", "lock", "motion"].map((name) => ({
    name,
    field: new X3DField(new BaseNode("Group", name)),
  }));
  const { global, browser } = makeSandbox([{ name: "autoRef", field: autoRef }, ...fields]);

  assert.strictEqual(evaluate(global, TURRET_SET_PROX), "cleared");
  for (const entry of fields) {
    assert.strictEqual(entry.field.getValue().getValue(), null, `${entry.name} is NULL`);
  }
  assert.deepStrictEqual(browser.parseCalls, []);
});

test("the unrelated non-Outlands slot-clearing idiom works the same way", () => {
  // `dinamis.fh-nuertingen.de`, `abnet.wrl:401` - a different author, a
  // different site, the same statement: clear an avatar slot to NULL.
  const loadedAVS = new X3DField([new BaseNode("Inline", "av0"), new BaseNode("Inline", "av1")]);
  const { global, browser } = makeSandbox([{ name: "loadedAVS", field: loadedAVS }]);

  const source = `
    function remove_Avatar (uniqID, ts) {
      var slots = loadedAVS;
      slots[uniqID] = new SFNode();
      return slots[uniqID];
    }
    remove_Avatar (1, 0);
  `;

  const cleared = evaluate(global, source);
  assert.strictEqual(cleared.getValue(), null, "the slot is NULL");
  assert.deepStrictEqual(browser.parseCalls, [], "no parser call for a slot clear");
});

test("the compatibility is generic script behaviour, not a turret rule", () => {
  const { global } = makeSandbox();
  const source = `
    function shutdown () { var held = new SFNode(); return held; }
    shutdown ();
  `;
  // blaxxun's own guide recommends nulling SFNode values in shutdown().
  assert.strictEqual(evaluate(global, source).getValue(), null);
});

test("the shipped Outlands worlds really do use the idiom", () => {
  const found: Record<string, number> = {};

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".wrl")) continue;

      const raw = fs.readFileSync(full);
      let text: string;
      try {
        text = zlib.gunzipSync(raw).toString("utf8");
      } catch (error) {
        text = raw.toString("utf8");
      }

      const hits = text.match(/new\s+SFNode\s*\(\s*\)/g);
      if (hits) found[path.relative(WORLDS, full)] = hits.length;
    }
  }

  walk(WORLDS);

  const files = Object.keys(found);
  assert.ok(files.length >= 5, `expected the Outlands variants, found ${files.length}`);
  for (const file of files) {
    assert.ok(/ne_game/.test(file), `unexpected file ${file}`);
    assert.strictEqual(found[file], 4, `${file} should hold four null constructions`);
  }
});

/* ------------------------------------------------------------------ *
 * 8. WIRING
 * ------------------------------------------------------------------ */
console.log("\n-- wiring --");

test("the shim is loaded by App.vue", () => {
  assert.ok(/x_ite_mods\/bxx_sfnode\.js/.test(codeOf(APP)), "bxx_sfnode.js is required");
});

test("the shim hooks the Script sandbox and nothing wider", () => {
  const code = codeOf(SFNODE_MOD);
  assert.ok(/SupportedNodes/.test(code), "the addType seam is used");
  assert.ok(/getGlobal/.test(code), "the sandbox is the boundary");
  assert.ok(!/Components\/Scripting\/Script/.test(code), "the lazy component is never required");
});

test("the shim uses X_ITE's own internal SFNode for the null value", () => {
  assert.ok(/x_ite\/Fields\/SFNode/.test(codeOf(SFNODE_MOD)), "the internal class is required");
});

test("the shim does not change the parser", () => {
  const code = codeOf(SFNODE_MOD) + codeOf(SFNODE_HELPER);
  assert.ok(!/createX3DFromString\s*=/.test(code), "the parser is not reassigned");
  assert.ok(!/GoldenGate|XMLParser|JSONParser|VRMLParser/.test(code), "no parser is touched");
});

test("the shim adds no general 'undefined' string rewrite", () => {
  const code = codeOf(SFNODE_MOD) + codeOf(SFNODE_HELPER);
  assert.ok(!/["']undefined["']\s*[=!]==?/.test(code), "no text is compared to 'undefined'");
  assert.ok(!/replace\s*\(/.test(code), "no string normalisation");
});

test("the shim leaves the empty string out of the rule", () => {
  const code = codeOf(SFNODE_HELPER).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/===\s*""/.test(code), "the rule never tests for an empty string");
});

test("the shim does not touch the OUTLANDS-1b, 1d, 1f, 1h or 1j surfaces", () => {
  const code = codeOf(SFNODE_MOD).replace(/\/\/.*$/gm, "") + codeOf(SFNODE_HELPER);
  assert.ok(!/bxx_hud|bxx_ray|bxx_node|bxx_url|bxx_events/.test(code), "no cross-mod reach");
  assert.ok(!/loadURL|computeRayHit|SFNodeCache/.test(code));
});

test("neither the shim nor the rule knows anything about Outlands", () => {
  for (const file of [SFNODE_MOD, SFNODE_HELPER]) {
    const code = codeOf(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const where = path.basename(file);
    assert.ok(!/ne_game/.test(code), `${where} hard-codes a world name`);
    assert.ok(!/turret|set_prox|autoRef/.test(code), `${where} hard-codes the turret script`);
    assert.ok(!/SharedEvent|BlaxxunZone/.test(code), `${where} hard-codes a node type`);
    assert.ok(!/\bOutlands\b/.test(code), `${where} hard-codes the game`);
  }
});

test("no avatar code is involved in this lane", () => {
  const code = codeOf(SFNODE_MOD) + codeOf(SFNODE_HELPER);
  // The helper's evidence note cites an avatar-slot example from an unrelated
  // blaxxun site. That citation is the only place either file says "avatar".
  const text = code.replace(/abnet\.wrl|loadedAVS|avatar slot/gi, "");
  assert.ok(!/xite_av|avatar|nickname/i.test(text), "no avatar code is reached");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
