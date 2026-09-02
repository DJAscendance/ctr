/**
 * OUTLANDS-1d guard for blaxxun VrmlScript "uninitialized function-local"
 * compatibility.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite does not stand up an X_ITE browser. It is
 * split in four:
 *
 *   1. RULE, exercised against `bxx-script.helper`, which owns the static gate:
 *      which names a script read as uninitialized locals, and which it did not.
 *
 *   2. SEMANTICS, run against a faithful re-implementation of X_ITE 4.7.0's own
 *      script scoping - `with (global) { eval (text) }` from
 *      `x_ite/Browser/Scripting/evaluate.js`, `initialize()` called with no
 *      arguments, and `callback (value, timestamp)` from
 *      `Script.prototype.set_field__`. This is where the four behaviours the
 *      lane promises are actually proved: `t` reads `undefined`, `v` reads
 *      `undefined`, declared parameters still win, and an unrelated missing
 *      name still throws.
 *
 *   3. HISTORICAL SOURCE, checked against the five Outlands worlds exactly as
 *      they ship - gzip, unmodified. The rule must name `t` and `v` in all five
 *      and nothing else, and it must name nothing at all in any other world in
 *      the repository. That is the narrowness proof.
 *
 *   4. WIRING, asserted against the source of `libs/x_ite_mods/bxx_script.js`
 *      and `App.vue`. These catch the drifts this lane exists to prevent: a shim
 *      that stops being loaded, a global free-name trap, a swallowed
 *      `ReferenceError`, and Outlands knowledge creeping into a generic
 *      compatibility layer.
 */
import assert from "assert";
import {
  blaxxunUninitializedLocals,
  maskLiterals,
} from "../src/helpers/bxx-script.helper";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const SCRIPT_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_script.js");
const APP = path.join(SPA_SRC, "App.vue");

const WORLDS = path.join(SPA, "assets/worlds");
const OUTLANDS = path.join(WORLDS, "ne_game/vrml");
const OUTLANDS_VARIANTS = [
  "ne_game.wrl",
  "ne_game_gm.wrl",
  "_ne_game_gm.wrl",
  "ne_game_pass.wrl",
  "_ne_game_pass.wrl",
];

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
 * X_ITE 4.7.0 script semantics, re-implemented exactly.
 * ------------------------------------------------------------------ */

/**
 * `x_ite/Browser/Scripting/evaluate.js`, tag 4.7.0, verbatim in shape:
 * `function (g, text) { with (g) { return eval (text); } }`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const evaluate = new Function(
  "return function () { with (arguments[0]) { return eval (arguments[1]); } };",
)();

/**
 * `Script.prototype.getGlobal` builds the sandbox from a property descriptor
 * map and returns `Object.create (Object.prototype, map)`. Only the entries a
 * compatibility test can observe are modelled.
 */
function sandbox(fields: Record<string, unknown>): Record<string, unknown> {
  const map: PropertyDescriptorMap = {
    NULL: { value: null },
    FALSE: { value: false },
    TRUE: { value: true },
    Browser: { value: { getWorldStartTime: () => 0 } },
  };
  for (const name of Object.keys(fields)) {
    map[name] = { value: fields[name], writable: true, enumerable: false };
  }
  return Object.create(Object.prototype, map) as Record<string, unknown>;
}

/** What `bxx_script.js` does to a sandbox, expressed once for the tests. */
function applyCompat(global: Record<string, unknown>, source: string): string[] {
  const names = blaxxunUninitializedLocals(source);
  for (const name of names) {
    if (name in global) continue;
    Object.defineProperty(global, name, {
      value: undefined,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return names;
}

/**
 * `Script.prototype.getContext`: append X_ITE's own `var` declaration and array
 * literal, evaluate in the sandbox, and pull the callbacks back out.
 */
function context(
  source: string,
  global: Record<string, unknown>,
  callbacks: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  const names = ["initialize", "prepareEvents", "eventsProcessed", "shutdown"]
    .concat(callbacks);
  const text = `${source}\n;var ${names.join(",")};\n[${names.join(",")}];`;
  const result = evaluate(global, text);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  for (let i = 0; i < names.length; i += 1) {
    out[names[i]] = typeof result[i] === "function" ? result[i] : null;
  }
  return out;
}

function readWorld(file: string): string {
  const raw = fs.readFileSync(file);
  return raw[0] === 0x1f && raw[1] === 0x8b
    ? zlib.gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
}

/** Every `url "javascript: ..."` payload in a VRML file. */
function scriptSources(world: string): string[] {
  const out: string[] = [];
  const opener = /url\s*(?:\[)?\s*"javascript:/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(world)) !== null) {
    let i = match.index + match[0].length;
    let body = "";
    while (i < world.length) {
      if (world[i] === "\\") { body += world[i] + world[i + 1]; i += 2; continue; }
      if (world[i] === "\"") break;
      body += world[i];
      i += 1;
    }
    out.push(body);
  }
  return out;
}

function allWorldFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allWorldFiles(full, found);
    else if (entry.isFile() && entry.name.endsWith(".wrl")) found.push(full);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * 1. RULE
 * ------------------------------------------------------------------ */

console.log("\nblaxxun script compatibility - static rule");

test("names a free read whose twin is a parameter elsewhere", () => {
  const source = `
    function set_position(v,t){ lastMove = t; }
    function initialize(){ set_weapon(1,t); }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), ["t"]);
});

test("names a free boolean guard the same way", () => {
  const source = `
    function set_active(v,t){ if(v){return;} }
    function set_team(){ if(v){return;} }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), ["v"]);
});

test("ignores a name no function ever declares as a parameter", () => {
  const source = `
    function initialize(){ totallyMissingName.doSomething(); }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), []);
});

test("ignores a name that is freely assigned - X_ITE already makes it a global", () => {
  const source = `
    function set_mask(m,t){ oldMask = m; }
    function initialize(){ m = Browser.eventMask; use(m,t); }
  `;
  // `t` still qualifies; `m` is freely assigned in initialize, so it must not.
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), ["t"]);
});

test("a write to a parameter is not a free assignment", () => {
  const source = `
    function receive_aapd(v,t){ v = new SFVec3f(v[0],v[1],v[2]); send(v); }
    function set_team(){ if(v){return;} }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), ["v"]);
});

test("ignores a name declared with var in the same function", () => {
  const source = `
    function helper(t){ return t; }
    function initialize(){ var t; use(t); }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), []);
});

test("ignores a top-level function name used as a parameter elsewhere", () => {
  const source = `
    function fire(){ return 1; }
    function arm(fire,t){ return fire; }
    function initialize(){ fire(); }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), []);
});

test("never names an X_ITE sandbox binding or a callback", () => {
  const source = `
    function shot(Browser,initialize,t){ return Browser; }
    function fire(){ Browser.print(initialize); use(t); }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), ["t"]);
});

test("an enclosing function's parameter is in scope for a nested one", () => {
  const source = `
    function outer(v,t){ function inner(){ return v; } return inner(); }
    function other(){ use(t); }
  `;
  // `v` resolves through the scope chain; only the free `t` in `other` counts.
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), ["t"]);
});

test("a name that only appears in a comment or string is not a read", () => {
  const source = `
    function set_position(v,t){ return v; }
    function initialize(){ /* t is dead here */ Browser.print('t'); }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), []);
});

test("a property access is not a free read", () => {
  const source = `
    function set_position(v,t){ return v; }
    function initialize(){ Browser.t; obj.v = 1; }
  `;
  assert.deepStrictEqual(blaxxunUninitializedLocals(source), []);
});

test("maskLiterals blanks comments and strings without moving offsets", () => {
  const source = "a; // t\nb; /* v */ c; 'd'; \"e\";";
  const masked = maskLiterals(source);
  assert.strictEqual(masked.length, source.length);
  assert.ok(!/[tvde]/.test(masked), `masked source still carries literals: ${masked}`);
  assert.ok(/a;/.test(masked) && /b;/.test(masked) && /c;/.test(masked));
});

/* ------------------------------------------------------------------ *
 * 2. SEMANTICS, under real X_ITE 4.7.0 scoping
 * ------------------------------------------------------------------ */

console.log("\nblaxxun script compatibility - runtime semantics");

test("without the shim, a free read throws ReferenceError", () => {
  const source = `
    var seen = null;
    function set_weapon(v,t){ seen = v; }
    function initialize(){ set_weapon(1,t); }
  `;
  const global = sandbox({});
  const ctx = context(source, global, ["set_weapon"]);
  assert.throws(() => ctx.initialize(), /ReferenceError/);
});

test("t reads as undefined, and initialize completes", () => {
  const source = `
    function set_weapon(v,t){ chosen = v; stamp = t; }
    function initialize(){ set_weapon(1,t); }
  `;
  const global = sandbox({ chosen: -1, stamp: -1 });
  assert.deepStrictEqual(applyCompat(global, source), ["t"]);

  const ctx = context(source, global, ["set_weapon"]);
  ctx.initialize();
  assert.strictEqual(global.chosen, 1, "the declared parameter still took the real argument");
  assert.strictEqual(global.stamp, undefined, "t was an uninitialized local");
});

test("v reads as undefined, so the guard falls through", () => {
  const source = `
    function set_active(v,t){ if(v){return;} }
    function set_team(){ if(v){return;} haveSet = true; }
  `;
  const global = sandbox({ haveSet: false });
  assert.deepStrictEqual(applyCompat(global, source), ["v"]);

  const ctx = context(source, global, ["set_team"]);
  ctx.set_team();
  assert.strictEqual(global.haveSet, true, "continueWork must run - v was falsy");
});

test("a declared parameter shadows the compatibility binding", () => {
  const source = `
    function set_team(){ if(v){return;} }
    function handler(v,t){ gotValue = v; gotTime = t; }
  `;
  const global = sandbox({ gotValue: null, gotTime: null });
  applyCompat(global, source);

  const ctx = context(source, global, ["handler"]);
  // Exactly what Script.prototype.set_field__ does:
  // callback (field.valueOf (), browser.getCurrentTime ()).
  ctx.handler(true, 1234.5);
  assert.strictEqual(global.gotValue, true, "the real event value must survive");
  assert.strictEqual(global.gotTime, 1234.5, "the real timestamp must survive");
});

test("an unrelated missing identifier still throws ReferenceError", () => {
  const source = `
    function set_position(v,t){ return v; }
    function initialize(){ totallyMissingName.doSomething(); }
  `;
  const global = sandbox({});
  applyCompat(global, source);

  const ctx = context(source, global, []);
  assert.throws(() => ctx.initialize(), /ReferenceError/);
  assert.throws(() => ctx.initialize(), /totallyMissingName/);
});

test("free assignment still creates a global, unchanged", () => {
  const source = `
    function set_mask(m,t){ return m; }
    function initialize(){ m = 7; use(t); }
    function use(x){ used = x; }
  `;
  const global = sandbox({ used: null });
  assert.deepStrictEqual(applyCompat(global, source), ["t"]);
  assert.ok(!("m" in global), "a freely assigned name must not be put on the sandbox");

  const ctx = context(source, global, []);
  ctx.initialize();
  // Sloppy-mode write to an unresolved name: it landed outside the sandbox,
  // exactly as it did before this shim existed.
  assert.strictEqual(global.used, undefined, "t was still an uninitialized local");
});

test("a field of the same name is never shadowed", () => {
  const source = `
    function set_position(v,t){ return v; }
    function initialize(){ seen = t; }
  `;
  const global = sandbox({ t: 42, seen: null });
  applyCompat(global, source);

  const ctx = context(source, global, []);
  ctx.initialize();
  assert.strictEqual(global.seen, 42, "the script's own field must win");
});

test("the compatibility binding does not break X_ITE callback extraction", () => {
  const source = `
    function set_team(){ if(v){return;} ran = true; }
    function initialize(){ }
  `;
  const global = sandbox({ ran: false });
  applyCompat(global, source);

  const ctx = context(source, global, ["set_team"]);
  assert.strictEqual(typeof ctx.initialize, "function");
  assert.strictEqual(typeof ctx.set_team, "function", "a Proxy trap would return null here");
});

/* ------------------------------------------------------------------ *
 * 3. HISTORICAL SOURCE
 * ------------------------------------------------------------------ */

console.log("\nblaxxun script compatibility - historical Outlands source");

for (const variant of OUTLANDS_VARIANTS) {
  test(`${variant} needs exactly t and v`, () => {
    const world = readWorld(path.join(OUTLANDS, variant));
    const names = new Set<string>();
    for (const source of scriptSources(world)) {
      for (const name of blaxxunUninitializedLocals(source)) names.add(name);
    }
    assert.deepStrictEqual(Array.from(names).sort(), ["t", "v"]);
  });
}

test("no other world in the repository asks for any binding", () => {
  const offenders: string[] = [];

  for (const file of allWorldFiles(WORLDS)) {
    if (OUTLANDS_VARIANTS.indexOf(path.basename(file)) !== -1) continue;

    const world = readWorld(file);
    for (const source of scriptSources(world)) {
      const names = blaxxunUninitializedLocals(source);
      if (names.length) offenders.push(`${path.relative(WORLDS, file)} -> ${names.join(",")}`);
    }
  }

  assert.deepStrictEqual(offenders, [], "the shim must stay Outlands-only in effect");
});

test("the Outlands worlds are still the shipped gzip bytes", () => {
  for (const variant of OUTLANDS_VARIANTS) {
    const raw = fs.readFileSync(path.join(OUTLANDS, variant));
    assert.strictEqual(raw[0], 0x1f, `${variant} is no longer gzip`);
    assert.strictEqual(raw[1], 0x8b, `${variant} is no longer gzip`);

    const text = zlib.gunzipSync(raw).toString("utf8");
    assert.ok(
      /function set_team\(\)\s*\{/.test(text),
      `${variant} had its parameter list "fixed" - the defect must stay in the source`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * 4. WIRING
 * ------------------------------------------------------------------ */

console.log("\nblaxxun script compatibility - wiring");

/**
 * A file with its comment lines removed. Both shim files cite the evidence in
 * prose - `ne_game.wrl`, `set_team`, `ReferenceError` - and prose is exactly
 * what these assertions must not read.
 */
function codeOf(file: string): string {
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter((line: string) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
}

test("App.vue loads the shim", () => {
  const app = fs.readFileSync(APP, "utf8");
  assert.ok(
    /require\("\.\/libs\/x_ite_mods\/bxx_script\.js"\);/.test(app),
    "bxx_script.js must be required alongside the other X_ITE mods",
  );
});

test("the shim wraps the Script sandbox, not the window", () => {
  const code = codeOf(SCRIPT_MOD);
  assert.ok(/getGlobal/.test(code), "the sandbox object is the only thing extended");
  assert.ok(/getContext/.test(code), "the source text decides, so getContext must be seen");
  assert.ok(
    !/window\.(t|v)\s*=/.test(code),
    "no compatibility name may be installed on window",
  );
});

test("the shim asks for no X_ITE module the CDN bundle lacks", () => {
  const code = codeOf(SCRIPT_MOD);
  // `x_ite/Components/Scripting/Script` lives in the lazily fetched Scripting
  // component, not in the single-file bundle `public/index.html` loads.
  // Requiring it makes requirejs fail on a file that does not exist, and X_ITE
  // then cannot load the component itself - every world with a Script dies.
  assert.ok(
    !/Components\/Scripting\/Script/.test(code),
    "requiring the lazily loaded Scripting component breaks every world",
  );
  assert.ok(
    /Configuration\/SupportedNodes/.test(code),
    "the Script class must be taken where the component registers it",
  );
  assert.ok(/addType/.test(code));
});

test("the shim uses no global free-name trap", () => {
  const mod = fs.readFileSync(SCRIPT_MOD, "utf8");
  assert.ok(!/new Proxy/.test(mod), "a Proxy has-trap breaks X_ITE callback extraction");
  assert.ok(!/has\s*:/.test(mod));
});

test("the shim never swallows a ReferenceError", () => {
  assert.ok(
    !/ReferenceError/.test(codeOf(SCRIPT_MOD)),
    "catching ReferenceError would hide real defects",
  );
});

test("neither the shim nor the rule knows anything about Outlands", () => {
  const files = [SCRIPT_MOD, path.join(SPA_SRC, "helpers/bxx-script.helper.ts")];
  for (const file of files) {
    const code = codeOf(file);
    assert.ok(!/ne_game/.test(code), `${path.basename(file)} hard-codes a world name`);
    assert.ok(!/set_team/.test(code), `${path.basename(file)} hard-codes a function name`);
    assert.ok(!/\bOutlands\b/.test(code), `${path.basename(file)} hard-codes the game`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
