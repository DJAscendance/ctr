/**
 * OUTLANDS-1j guard for the legacy Cybertown `Browser.loadURL` policy.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite does not load X_ITE 4.7.0. What it does
 * instead is reproduce the two lines of X_ITE 4.7.0 that actually decide the
 * historical failure, taken from the shipped `x_ite.min.js`:
 *
 *   FileLoader.getTarget(p)   -> the value of the first "target=..." entry
 *   loadDocumentAsync(url)    -> this.target.length && "_self" !== this.target
 *                                  ? this.foreign(url, this.target) : ...
 *   Browser.loadURL's foreign -> function (t, e) { e ? window.open(t, e)
 *                                                    : location = t; }
 *
 * That is why a dead address does not fail harmlessly: it is a top-level
 * navigation, not a world load. Part 8 below drives that stand-in with and
 * without the policy, so the suite states the old behaviour as well as the new.
 *
 * The suite is in nine parts:
 *
 *   1. OUTLANDS       - the proven call at `ne_game.wrl:1159`.
 *   2. LEGACY HOSTS   - both historical spellings, both schemes, port,
 *                       userinfo, case and protocol-relative forms.
 *   3. HOST BOUNDARY  - lookalike hosts must not match. This is the clause that
 *                       a substring rewrite would get wrong.
 *   4. PATH BOUNDARY  - ordinary CTR paths and near-miss CGI paths pass through.
 *   5. SCHEMES        - `javascript:` and `data:` keep their present behaviour.
 *   6. URL LISTS      - MFString fallback lists, including a mixed list.
 *   7. TARGETS        - `_top`, `place`, `CCpro`, absent and multi-parameter.
 *   8. X_ITE FLOW     - the old-code proof described above.
 *   9. SHIPPED WORLDS - the real addresses read out of the shipped `.wrl` files
 *                       (gunzipped), plus source assertions that no world string
 *                       can reach CTR routing.
 */
import assert from "assert";
import {
  LEGACY_HOSTS,
  LEGACY_RELATIVE_PREFIX,
  PASS_THROUGH,
  SUPPRESS_LEGACY,
  classifyLegacyLoadUrl,
  isLegacyCybertownUrl,
  readHost,
  readScheme,
  readTarget,
} from "../src/helpers/legacy-url.helper";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const HELPER = path.join(SPA_SRC, "helpers/legacy-url.helper.ts");
const BINDING = path.join(SPA_SRC, "libs/x_ite_mods/bxx_url.js");
const APP = path.join(SPA_SRC, "App.vue");
const WORLDS = path.join(SPA, "assets/worlds");

const OUTLANDS_URL = "http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game";

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

/**
 * Strip comments so the safety gates below assert about executable code, not
 * about the prose that describes the historical defect. The documentation has
 * to name `window.open` and `router.push` to explain what is being prevented.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map(line => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** Read a shipped world file, transparently gunzipping the compressed ones. */
function readWorld(relative: string): string {
  const bytes = fs.readFileSync(path.join(WORLDS, relative));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return zlib.gunzipSync(bytes).toString("latin1");
  }
  return bytes.toString("latin1");
}

/* ------------------------------------------------------------------ *
 * 1. OUTLANDS - the proven historical call.
 * ------------------------------------------------------------------ */
console.log("\n1. Outlands");

test("the ne_game.wrl:1159 address is recognised as legacy", () => {
  assert.strictEqual(isLegacyCybertownUrl(OUTLANDS_URL), true);
});

test("the Outlands call is suppressed and leaves nothing to load", () => {
  const decision = classifyLegacyLoadUrl([OUTLANDS_URL], ["target=_top"]);
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.deepStrictEqual(decision.keptUrls, []);
  assert.deepStrictEqual(decision.legacyUrls, [OUTLANDS_URL]);
  assert.strictEqual(decision.target, "_top");
});

test("the Outlands game-master beam page is also legacy", () => {
  assert.strictEqual(
    isLegacyCybertownUrl("http://www.cybertown.com/places/ne_game/html/gmbeam.html"),
    true,
  );
});

/* ------------------------------------------------------------------ *
 * 2. LEGACY HOSTS - the forms that must match.
 * ------------------------------------------------------------------ */
console.log("\n2. Legacy hosts");

test("both historical host spellings are the only ones configured", () => {
  assert.deepStrictEqual(LEGACY_HOSTS.slice(), ["www.cybertown.com", "cybertown.com"]);
});

test("www host, cgi-bin path", () => {
  assert.strictEqual(
    isLegacyCybertownUrl("http://www.cybertown.com/cgi-bin/cybertown/place?plc=club"),
    true,
  );
});

test("www host, non cgi-bin path", () => {
  assert.strictEqual(isLegacyCybertownUrl("http://www.cybertown.com/avatars/avlib_1.html"), true);
});

test("bare cybertown.com host", () => {
  assert.strictEqual(
    isLegacyCybertownUrl("http://cybertown.com/cgi-bin/cybertown/neighbor?ID=0104050600000000"),
    true,
  );
});

test("https on the legacy host", () => {
  assert.strictEqual(isLegacyCybertownUrl("https://www.cybertown.com/anything"), true);
});

test("uppercase scheme and host", () => {
  assert.strictEqual(isLegacyCybertownUrl("HTTP://WWW.CYBERTOWN.COM/cgi-bin/x"), true);
});

test("explicit port is ignored", () => {
  assert.strictEqual(isLegacyCybertownUrl("http://www.cybertown.com:80/cgi-bin/x"), true);
});

test("userinfo before the legacy host still matches", () => {
  assert.strictEqual(isLegacyCybertownUrl("http://someone@www.cybertown.com/cgi-bin/x"), true);
});

test("protocol-relative legacy address matches", () => {
  assert.strictEqual(isLegacyCybertownUrl("//www.cybertown.com/cgi-bin/x"), true);
});

test("root-relative legacy CGI address matches", () => {
  assert.strictEqual(isLegacyCybertownUrl("/cgi-bin/cybertown/place?plc=shop"), true);
  assert.strictEqual(LEGACY_RELATIVE_PREFIX, "/cgi-bin/");
});

/* ------------------------------------------------------------------ *
 * 3. HOST BOUNDARY - lookalikes must not match.
 * ------------------------------------------------------------------ */
console.log("\n3. Host boundaries");

const NEGATIVE_HOSTS = [
  "http://notcybertown.com/cgi-bin/cybertown/place",
  "http://cybertown.com.example.org/cgi-bin/cybertown/place",
  "http://www.cybertown.com.evil.com/cgi-bin/cybertown/place",
  "http://example.com/cgi-bin/cybertown/place",
  "http://xcybertown.com/",
  "http://cybertown.company/",
];

NEGATIVE_HOSTS.forEach(url => {
  test(`not legacy: ${url}`, () => {
    assert.strictEqual(isLegacyCybertownUrl(url), false);
  });
});

test("a legacy address inside a query string does not match", () => {
  assert.strictEqual(
    isLegacyCybertownUrl("http://example.com/go?next=http://www.cybertown.com/cgi-bin/x"),
    false,
  );
});

test("the legacy host used as userinfo does not match", () => {
  assert.strictEqual(isLegacyCybertownUrl("http://www.cybertown.com@example.com/"), false);
  assert.strictEqual(readHost("http://www.cybertown.com@example.com/"), "example.com");
});

test("a legacy address in a fragment does not match", () => {
  assert.strictEqual(isLegacyCybertownUrl("http://example.com/#http://www.cybertown.com/"), false);
});

/* ------------------------------------------------------------------ *
 * 4. PATH BOUNDARY - ordinary CTR paths pass through.
 * ------------------------------------------------------------------ */
console.log("\n4. Path boundaries");

const NEGATIVE_PATHS = [
  "/assets/worlds/ne_game/vrml/ne_game.wrl",
  "/api/place/10",
  "/#/place/outlands",
  "#/place/outlands",
  "vrml/pool.wrl",
  "../../pool/vrml/pool.wrl",
  "/cgi-binary/cybertown/place",
  "cgi-bin/cybertown/place",
  "/",
  "",
];

NEGATIVE_PATHS.forEach(url => {
  test(`not legacy: ${JSON.stringify(url)}`, () => {
    assert.strictEqual(isLegacyCybertownUrl(url), false);
  });
});

test("null and undefined are not legacy", () => {
  assert.strictEqual(isLegacyCybertownUrl(null as unknown as string), false);
  assert.strictEqual(isLegacyCybertownUrl(undefined as unknown as string), false);
});

/* ------------------------------------------------------------------ *
 * 5. SCHEMES - anything this module does not navigate over is untouched.
 * ------------------------------------------------------------------ */
console.log("\n5. Schemes");

test("a javascript: address is never reclassified", () => {
  const js = "javascript:changeFrames(\"http://www.cybertown.com/a\",\"b\")";
  assert.strictEqual(isLegacyCybertownUrl(js), false);
  assert.strictEqual(classifyLegacyLoadUrl([js], ["target=action"]).action, PASS_THROUGH);
});

test("a data: address is never reclassified", () => {
  assert.strictEqual(isLegacyCybertownUrl("data:text/plain,www.cybertown.com"), false);
});

test("readScheme reports the scheme it used", () => {
  assert.strictEqual(readScheme("HTTP://www.cybertown.com/"), "http");
  assert.strictEqual(readScheme("javascript:void(0)"), "javascript");
  assert.strictEqual(readScheme("/cgi-bin/x"), "");
});

/* ------------------------------------------------------------------ *
 * 6. URL LISTS - MFString fallback behaviour.
 * ------------------------------------------------------------------ */
console.log("\n6. URL lists");

test("a list of only legacy addresses leaves nothing to load", () => {
  const decision = classifyLegacyLoadUrl(
    [OUTLANDS_URL, "/cgi-bin/cybertown/place?plc=shop"],
    ["target=_top"],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.deepStrictEqual(decision.keptUrls, []);
  assert.strictEqual(decision.legacyUrls.length, 2);
});

test("a mixed list keeps its non-legacy entries in order", () => {
  const decision = classifyLegacyLoadUrl(
    [
      OUTLANDS_URL,
      "vrml/fallback.wrl",
      "/cgi-bin/cybertown/x",
      "/assets/worlds/pool/vrml/pool.wrl",
    ],
    ["target=_top"],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.deepStrictEqual(decision.keptUrls, [
    "vrml/fallback.wrl",
    "/assets/worlds/pool/vrml/pool.wrl",
  ]);
  assert.deepStrictEqual(decision.legacyUrls, [OUTLANDS_URL, "/cgi-bin/cybertown/x"]);
});

test("a list with no legacy entry passes through unchanged", () => {
  const urls = ["vrml/a.wrl", "vrml/b.wrl", "http://example.com/c.wrl"];
  const decision = classifyLegacyLoadUrl(urls, ["target=_top"]);
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.deepStrictEqual(decision.keptUrls, urls);
  assert.deepStrictEqual(decision.legacyUrls, []);
});

test("an empty list passes through", () => {
  const decision = classifyLegacyLoadUrl([], []);
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.deepStrictEqual(decision.keptUrls, []);
});

/* ------------------------------------------------------------------ *
 * 7. TARGETS - X_ITE's own reading of the parameter list.
 * ------------------------------------------------------------------ */
console.log("\n7. Targets");

test("target=_top", () => {
  assert.strictEqual(readTarget(["target=_top"]), "_top");
});

test("target=place", () => {
  assert.strictEqual(readTarget(["target=place"]), "place");
});

test("target=CCpro", () => {
  assert.strictEqual(readTarget(["target=CCpro"]), "CCpro");
});

test("no target parameter", () => {
  assert.strictEqual(readTarget([]), "");
  assert.strictEqual(readTarget([""]), "");
});

test("the first target wins, other parameters are ignored", () => {
  assert.strictEqual(readTarget(["cache=false", "target=place", "target=_top"]), "place");
});

test("the parameter list never changes the decision", () => {
  ["target=_top", "target=place", "target=CCpro", ""].forEach(parameter => {
    assert.strictEqual(classifyLegacyLoadUrl([OUTLANDS_URL], [parameter]).action, SUPPRESS_LEGACY);
    assert.strictEqual(classifyLegacyLoadUrl(["vrml/a.wrl"], [parameter]).action, PASS_THROUGH);
  });
});

/* ------------------------------------------------------------------ *
 * 8. X_ITE FLOW - the old-code proof.
 *
 * `xiteLoadURL` is X_ITE 4.7.0's decision path, reduced to the branch that
 * matters. `withPolicy` is the wrapper `bxx_url.js` installs. The first test
 * states the historical defect; the second states the fix.
 * ------------------------------------------------------------------ */
console.log("\n8. X_ITE flow");

interface Opened { url: string; target: string }

function xiteLoadURL(urls: string[], parameters: string[], opened: Opened[]): void {
  const target = readTarget(parameters);           // FileLoader.getTarget
  const url = urls.length ? urls[0] : "";          // loadDocument -> url.shift()
  if (target.length && target !== "_self") {       // loadDocumentAsync
    opened.push({ url, target });                  // foreign -> window.open(t, e)
  }
}

function withPolicy(urls: string[], parameters: string[], opened: Opened[]): void {
  const decision = classifyLegacyLoadUrl(urls, parameters);
  if (decision.action === PASS_THROUGH) {
    xiteLoadURL(urls, parameters, opened);
    return;
  }
  if (decision.keptUrls.length === 0) { return; }
  xiteLoadURL(decision.keptUrls, parameters, opened);
}

test("OLD CODE: the Outlands call reaches window.open(url, \"_top\")", () => {
  const opened: Opened[] = [];
  xiteLoadURL([OUTLANDS_URL], ["target=_top"], opened);
  assert.deepStrictEqual(opened, [{ url: OUTLANDS_URL, target: "_top" }]);
});

test("NEW CODE: the Outlands call opens nothing", () => {
  const opened: Opened[] = [];
  withPolicy([OUTLANDS_URL], ["target=_top"], opened);
  assert.deepStrictEqual(opened, []);
});

test("NEW CODE: a non-legacy call still reaches the browser unchanged", () => {
  const opened: Opened[] = [];
  withPolicy(["http://example.com/help.html"], ["target=place"], opened);
  assert.deepStrictEqual(opened, [{ url: "http://example.com/help.html", target: "place" }]);
});

test("NEW CODE: a mixed list falls back to its first surviving address", () => {
  const opened: Opened[] = [];
  withPolicy([OUTLANDS_URL, "http://example.com/b.html"], ["target=CCpro"], opened);
  assert.deepStrictEqual(opened, [{ url: "http://example.com/b.html", target: "CCpro" }]);
});

/* ------------------------------------------------------------------ *
 * 9. SHIPPED WORLDS - the real addresses, and the safety gates.
 * ------------------------------------------------------------------ */
console.log("\n9. Shipped worlds and safety gates");

test("ne_game.wrl still contains the call this lane contains", () => {
  const source = readWorld("ne_game/vrml/ne_game.wrl");
  const line = source.split("\n").find(text => text.indexOf("if(team < 0)") !== -1);
  assert.ok(line, "the team<0 branch is missing from the shipped world");
  assert.ok(
    (line as string).indexOf(OUTLANDS_URL) !== -1,
    "the team<0 branch no longer carries the address this policy is built for",
  );
  assert.strictEqual(isLegacyCybertownUrl(OUTLANDS_URL), true);
});

test("every Mall store-door address is recognised, absolute and relative", () => {
  const source = readWorld("shopping/vrml/shopping.wrl");
  const doors = source.match(/linkUrl\s*"([^"]+)"/g) || [];
  assert.ok(doors.length >= 8, `expected at least 8 store doors, found ${doors.length}`);
  const urls = doors.map(text => (text.match(/"([^"]+)"/) as RegExpMatchArray)[1]);
  const absolute = urls.filter(url => url.indexOf("http://") === 0);
  const relative = urls.filter(url => url.indexOf("/cgi-bin/") === 0);
  assert.ok(absolute.length > 0, "no absolute store-door address found");
  assert.ok(relative.length > 0, "no relative store-door address found");
  urls.forEach(url => {
    assert.strictEqual(isLegacyCybertownUrl(url), true, `not recognised: ${url}`);
  });
});

test("the Plaza Avatar Boutique address is recognised", () => {
  const source = readWorld("enter/vrml/enter.wrl");
  const match = source.match(/bxx_url_string\s+"(http:\/\/www\.cybertown\.com[^"]*)"/);
  assert.ok(match, "the Avatar Boutique address is missing from the shipped world");
  assert.strictEqual(isLegacyCybertownUrl((match as RegExpMatchArray)[1]), true);
});

test("the Black Market door addresses are recognised", () => {
  const source = readWorld("blackmarket/vrml/blackmarket.wrl");
  const urls = (source.match(/"http:\/\/www\.cybertown\.com[^"]*"/g) || [])
    .map(text => text.slice(1, -1));
  assert.ok(urls.length >= 3, `expected at least 3 addresses, found ${urls.length}`);
  urls.forEach(url => {
    assert.strictEqual(isLegacyCybertownUrl(url), true, `not recognised: ${url}`);
  });
});

test("the already-rewritten CTR world links are left alone", () => {
  assert.strictEqual(isLegacyCybertownUrl("/#/place/mall"), false);
  assert.strictEqual(isLegacyCybertownUrl("/#/place/pool"), false);
});

test("SAFETY GATE: the policy helper reaches no browser or router API", () => {
  const source = code(fs.readFileSync(HELPER, "utf8"));
  ["window", "document", "location", "router", "$router", "X3D"].forEach(name => {
    assert.strictEqual(
      new RegExp(`\\b${name.replace("$", "\\$")}\\s*\\.`).test(source),
      false,
      `the pure helper must not touch ${name}`,
    );
  });
});

test("SAFETY GATE: the binding never routes a world-supplied address", () => {
  const source = code(fs.readFileSync(BINDING, "utf8"));
  [/router\s*\.\s*push/, /\$router/, /location\s*\.\s*href\s*=/, /location\s*=/, /window\.open/]
    .forEach(pattern => {
      assert.strictEqual(pattern.test(source), false, `the binding must not use ${pattern}`);
    });
});

test("SAFETY GATE: a pass-through call forwards the original arguments", () => {
  const source = fs.readFileSync(BINDING, "utf8");
  assert.ok(
    /PASS_THROUGH[\s\S]{0,200}originalLoadURL\.apply\(this,\s*arguments\)/.test(source),
    "the pass-through branch must forward the caller's own url and parameter objects",
  );
});

test("SAFETY GATE: a suppressed call never reaches the original loadURL", () => {
  const source = fs.readFileSync(BINDING, "utf8");
  assert.ok(
    /keptUrls\.length === 0[\s\S]{0,300}return undefined;/.test(source),
    "an all-legacy call must return without calling through",
  );
});

test("the binding is required after every other loadURL wrapper", () => {
  const source = fs.readFileSync(APP, "utf8");
  const url = source.indexOf("x_ite_mods/bxx_url.js");
  const auth = source.indexOf("x_ite_mods/bxx_auth.js");
  const events = source.indexOf("x_ite_mods/bxx_events.js");
  assert.ok(url !== -1, "bxx_url.js is not registered in App.vue");
  assert.ok(url > auth, "bxx_url.js must be required after bxx_auth.js");
  assert.ok(url > events, "bxx_url.js must be required after bxx_events.js");
});

test("no other module carries a copy of the host policy", () => {
  const dir = path.join(SPA_SRC, "libs/x_ite_mods");
  fs.readdirSync(dir).forEach((name: string) => {
    if (name === "bxx_url.js") { return; }
    const source = fs.readFileSync(path.join(dir, name), "utf8");
    assert.strictEqual(
      source.indexOf("cybertown.com"),
      -1,
      `${name} must not carry a second copy of the legacy URL policy`,
    );
  });
});

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
