/**
 * OUTLANDS-2A guard for the free-play Outlands entrance.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite mounts nothing. Where real behaviour matters
 * it is taken from the real artefact instead of from a copy of it:
 *
 *   the team rule   `set_team()` is EXTRACTED FROM THE SHIPPED, GZIPPED
 *                   `assets/worlds/ne_game/vrml/ne_game.wrl` and EXECUTED in a
 *                   `vm` sandbox against the identity the real session
 *                   registers. Nothing here reimplements it, so the suite fails
 *                   if the world and the picker ever disagree.
 *   the gate        asserted against the source of `WorldBrowserPage.vue`, so
 *                   the ordering claim - entrance before `startX3D()` - is
 *                   checked where it is actually made.
 *   the citizen rule asserted against `main.ts`'s public-route list.
 *
 * Eight parts:
 *
 *   1. CONTRACT      - the four avatars, their exact identity strings, order.
 *   2. REAL WORLD    - the shipped `set_team()`, executed.
 *   3. SESSION       - registration order, cleanup, forged keys, nickname.
 *   4. LEGACY ROUTE  - `plc=ne_game` maps; nothing else Outlands does.
 *   5. WORLD GATE    - the entrance holds back the mount, and only for Outlands.
 *   6. CITIZEN GATE  - the modern stand-in for `isVisitor`.
 *   7. ASSETS        - the historical world files are untouched and the
 *                      entrance art it needs is already shipped.
 *   8. SCOPE         - no match mode, no game master, no scoring, no schema.
 */
import assert from "assert";
import {
  MAP_TO_CTR_ROUTE,
  SUPPRESS_LEGACY,
  LEGACY_PLACE_ROUTES,
  LEGACY_ROUTES,
  classifyLegacyDestination,
  classifyLegacyNavigation,
} from "../src/helpers/legacy-destination.helper";
import {
  OUTLANDS_ART_BASE,
  OUTLANDS_AVATARS,
  OUTLANDS_HEADER_IMAGE,
  OUTLANDS_IDENTITY_BASE,
  OUTLANDS_IDENTITY_URLS,
  OUTLANDS_ROUTE,
  OUTLANDS_SLUG,
  OutlandsIdentity,
  createOutlandsIdentitySession,
  findOutlandsAvatar,
  isOutlandsPlace,
} from "../src/helpers/outlands.helper";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const WORLD_PAGE = path.join(SPA_SRC, "pages/world-browser/WorldBrowserPage.vue");
const ENTRANCE = path.join(SPA_SRC, "components/place/outlands/OutlandsEntrance.vue");
const BINDER = path.join(SPA_SRC, "libs/outlands-identity.ts");
const HELPER = path.join(SPA_SRC, "helpers/outlands.helper.ts");
const IDENTITY_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_identity.js");
const MAIN = path.join(SPA_SRC, "main.ts");
const NE_GAME = path.join(SPA, "assets/worlds/ne_game");

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

/** Strip comments so a source gate asserts about code, not about prose. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split("\n")
    .map(line => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** Read a shipped world file, transparently gunzipping the compressed ones. */
function readWorld(relative: string): string {
  const bytes = fs.readFileSync(path.join(NE_GAME, relative));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return zlib.gunzipSync(bytes).toString("latin1");
  }
  return bytes.toString("latin1");
}

/** A stand-in for the `X3D` global that `bxx_identity.js` creates. */
interface FakeHost {
  bxx: {
    identityProvider: (() => OutlandsIdentity) | null;
    setIdentityProvider: (provider: (() => OutlandsIdentity) | null) => void;
    calls: number;
  };
}

function fakeHost(): FakeHost {
  const host: FakeHost = {
    bxx: {
      identityProvider: null,
      calls: 0,
      setIdentityProvider(provider) {
        host.bxx.identityProvider = provider;
        host.bxx.calls += 1;
      },
    },
  };
  return host;
}

/* ------------------------------------------------------------------ */
console.log("\n1. Contract");

test("there are exactly four free-play avatars, in historical T_style order", () => {
  assert.strictEqual(OUTLANDS_AVATARS.length, 4);
  assert.deepStrictEqual(
    OUTLANDS_AVATARS.map(a => a.key),
    ["redm", "redf", "bluem", "bluef"],
  );
  assert.deepStrictEqual(OUTLANDS_AVATARS.map(a => a.style), [1, 2, 3, 4]);
});

test("colour picks the team and sex is cosmetic", () => {
  const byKey: Record<string, number> = {};
  OUTLANDS_AVATARS.forEach(a => { byKey[a.key] = a.team; });
  assert.strictEqual(byKey.redm, 1);
  assert.strictEqual(byKey.redf, 1);
  assert.strictEqual(byKey.bluem, 2);
  assert.strictEqual(byKey.bluef, 2);
});

test("every identity string is the exact historical absolute URL", () => {
  assert.deepStrictEqual(OUTLANDS_IDENTITY_URLS.slice(), [
    "http://www.cybertown.com/places/ne_game/vrml/avatars/redm.wrl",
    "http://www.cybertown.com/places/ne_game/vrml/avatars/redf.wrl",
    "http://www.cybertown.com/places/ne_game/vrml/avatars/bluem.wrl",
    "http://www.cybertown.com/places/ne_game/vrml/avatars/bluef.wrl",
  ]);
});

test("no identity string is rewritten to CTR, to HTTPS or to a query", () => {
  OUTLANDS_IDENTITY_URLS.forEach(url => {
    assert.ok(url.indexOf("http://www.cybertown.com/") === 0, `not historical: ${url}`);
    assert.ok(url.indexOf("https") !== 0, `must not be HTTPS: ${url}`);
    assert.strictEqual(url.indexOf("?"), -1, `must carry no query: ${url}`);
    assert.strictEqual(url.indexOf("#"), -1, `must carry no fragment: ${url}`);
  });
  assert.strictEqual(
    OUTLANDS_IDENTITY_BASE,
    "http://www.cybertown.com/places/ne_game/vrml/avatars/",
  );
});

test("the game master avatar is absent - that is OUTLANDS-2C", () => {
  OUTLANDS_IDENTITY_URLS.forEach(url => {
    assert.strictEqual(url.indexOf("gm.wrl"), -1, "gm.wrl must not be selectable");
  });
  assert.strictEqual(findOutlandsAvatar("gm"), null);
  OUTLANDS_AVATARS.forEach(a => assert.notStrictEqual(a.team, 3));
});

test("the tables are frozen and a forged key finds nothing", () => {
  assert.ok(Object.isFrozen(OUTLANDS_AVATARS));
  OUTLANDS_AVATARS.forEach(a => assert.ok(Object.isFrozen(a)));
  ["constructor", "__proto__", "toString", "", "REDM", "redm.wrl"].forEach(key => {
    assert.strictEqual(findOutlandsAvatar(key), null, `forged key resolved: ${key}`);
  });
  assert.strictEqual(findOutlandsAvatar(null), null);
  assert.strictEqual(findOutlandsAvatar(undefined), null);
});

test("the modern route is /place/outlands and the slug is outlands", () => {
  assert.strictEqual(OUTLANDS_ROUTE, "/place/outlands");
  assert.strictEqual(OUTLANDS_SLUG, "outlands");
  assert.strictEqual(OUTLANDS_ROUTE.indexOf("/places/"), -1);
});

/* ------------------------------------------------------------------ */
console.log("\n2. Real world logic");

/**
 * Pull `set_team()` out of the shipped world by brace matching, so the suite
 * runs the historical function itself rather than a description of it.
 */
function extractSetTeam(source: string): string {
  const start = source.indexOf("function set_team()");
  assert.notStrictEqual(start, -1, "set_team() is missing from the shipped world");
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") { depth += 1; seen = true; }
    if (source[i] === "}") {
      depth -= 1;
      if (seen && depth === 0) { return source.slice(start, i + 1); }
    }
  }
  throw new Error("set_team() is not brace balanced");
}

const NE_GAME_SOURCE = readWorld("vrml/ne_game.wrl");
const SET_TEAM = extractSetTeam(NE_GAME_SOURCE);

interface WorldResult {
  team: number;
  loadURLCalls: string[][];
  viewpointSet: boolean;
}

/** Run the real `set_team()` with one avatar identity in force. */
function runSetTeam(avatarURL: string): WorldResult {
  const loadURLCalls: string[][] = [];
  const sandbox = {
    v: false,
    haveSet: false,
    team: -1,
    avatar: "",
    viewpointSet: false,
    MFString: function MFString(this: { value: string }, value: string) {
      this.value = value;
    },
    Browser: {
      myAvatarURL: avatarURL,
      loadURL(url: { value: string }, parameter: { value: string }) {
        loadURLCalls.push([url.value, parameter.value]);
      },
    },
    set_viewpoint() { (sandbox as { viewpointSet: boolean }).viewpointSet = true; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${SET_TEAM}\nset_team();`, sandbox);
  return {
    team: sandbox.team,
    loadURLCalls,
    viewpointSet: sandbox.viewpointSet,
  };
}

test("the extracted function really is the shipped one", () => {
  assert.ok(SET_TEAM.indexOf("Browser.myAvatarURL") !== -1);
  assert.ok(SET_TEAM.indexOf("team = 1") !== -1 && SET_TEAM.indexOf("team = 2") !== -1);
  assert.ok(SET_TEAM.indexOf("plc=ne_game") !== -1, "the no-team fallback must be present");
});

OUTLANDS_AVATARS.forEach(entry => {
  test(`the shipped set_team() gives ${entry.key} team ${entry.team}`, () => {
    const host = fakeHost();
    const session = createOutlandsIdentitySession(() => host);
    session.select(entry.key, "QaMember");
    const provided = host.bxx.identityProvider as () => OutlandsIdentity;
    const result = runSetTeam(provided().avatarURL);
    assert.strictEqual(result.team, entry.team, `wrong team for ${entry.key}`);
    assert.strictEqual(
      result.loadURLCalls.length,
      0,
      "ne_game.wrl:1159 must not fire after a valid selection",
    );
    assert.ok(result.viewpointSet, "a valid team must reach set_viewpoint()");
  });
});

test("with no selection the world takes its no-team branch", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  assert.strictEqual(session.identity(), null);
  const result = runSetTeam("");
  assert.strictEqual(result.team, -1);
  assert.strictEqual(result.loadURLCalls.length, 1, "the fallback must fire with no avatar");
  assert.strictEqual(
    result.loadURLCalls[0][0],
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game",
  );
});

test("a rewritten identity would lose the team - so the exact string matters", () => {
  ["/assets/worlds/ne_game/vrml/avatars/redm.wrl",
    "https://www.cybertown.com/places/ne_game/vrml/avatars/redm.wrl",
    "http://www.cybertown.com/places/ne_game/vrml/avatars/redm.wrl?pass=x",
  ].forEach(url => {
    const result = runSetTeam(url);
    assert.strictEqual(result.team, -1, `must not resolve a team: ${url}`);
  });
});

/* ------------------------------------------------------------------ */
console.log("\n3. Identity session");

test("select registers the provider synchronously, before anything mounts", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  assert.strictEqual(host.bxx.identityProvider, null, "nothing registered before a pick");
  assert.strictEqual(host.bxx.calls, 0);
  const avatar = session.select("bluef", "QaMember");
  assert.ok(avatar !== null);
  assert.strictEqual(host.bxx.calls, 1, "registration must happen inside select()");
  assert.ok(typeof host.bxx.identityProvider === "function");
});

test("the provider never reports the empty default after a pick", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  session.select("redf", "QaMember");
  const provided = (host.bxx.identityProvider as () => OutlandsIdentity)();
  assert.strictEqual(
    provided.avatarURL,
    "http://www.cybertown.com/places/ne_game/vrml/avatars/redf.wrl",
  );
  assert.notStrictEqual(provided.avatarURL, "");
});

test("myAvatarName carries the CTR nickname, not the avatar file", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  session.select("redm", "QaMember");
  const provided = (host.bxx.identityProvider as () => OutlandsIdentity)();
  assert.strictEqual(provided.avatarName, "QaMember");
  assert.strictEqual(provided.avatarName.indexOf("redm"), -1);
});

test("an unknown key selects nothing and registers nothing", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  ["gm", "CKSM.", "__proto__", "", "redm.wrl"].forEach(key => {
    assert.strictEqual(session.select(key, "QaMember"), null, `accepted ${key}`);
  });
  assert.strictEqual(host.bxx.calls, 0);
  assert.strictEqual(session.selected(), null);
});

test("release unregisters, so no Outlands avatar leaks into another world", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  session.select("bluem", "QaMember");
  session.release();
  assert.strictEqual(host.bxx.identityProvider, null, "the provider must be cleared");
  assert.strictEqual(session.selected(), null);
  assert.strictEqual(session.identity(), null);
});

test("release with nothing selected touches the seam not at all", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  session.release();
  assert.strictEqual(host.bxx.calls, 0);
});

test("changing the pick re-registers rather than silently keeping the old one", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  session.select("redm", "QaMember");
  session.select("bluef", "QaMember");
  const provided = (host.bxx.identityProvider as () => OutlandsIdentity)();
  assert.strictEqual(provided.avatarURL, OUTLANDS_AVATARS[3].identityUrl);
  assert.strictEqual(host.bxx.calls, 2);
  assert.strictEqual(runSetTeam(provided.avatarURL).team, 2);
});

test("a missing or half-built host never throws", () => {
  const empty = createOutlandsIdentitySession(() => null);
  assert.ok(empty.select("redm", "QaMember") !== null);
  empty.release();
  const partial = createOutlandsIdentitySession(() => ({ bxx: null }));
  assert.ok(partial.select("redm", "QaMember") !== null);
  partial.release();
});

/* ------------------------------------------------------------------ */
console.log("\n4. Legacy route");

test("plc=ne_game now maps to the entrance", () => {
  assert.strictEqual(LEGACY_PLACE_ROUTES.ne_game, "/place/outlands");
  const decision = classifyLegacyDestination(
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game",
  );
  assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE);
  assert.strictEqual(decision.route, "/place/outlands");
});

test("the world's own no-team fallback call reaches the entrance", () => {
  const decision = classifyLegacyNavigation(
    ["http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game"],
    ["target=_top"],
  );
  assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE);
  assert.strictEqual(decision.route, "/place/outlands");
});

test("the route is in the navigator allow-list", () => {
  assert.ok(LEGACY_ROUTES.indexOf("/place/outlands") !== -1);
});

test("frame chrome and forged Outlands addresses stay blocked", () => {
  [
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game&ac=action",
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game&ac=menu",
    "http://www.cybertown.com/cgi-bin/cybertown/edit?tpl=ne_game/enter",
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game2",
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=NE_GAME",
  ].forEach(url => {
    assert.strictEqual(
      classifyLegacyDestination(url).action,
      SUPPRESS_LEGACY,
      `must not map: ${url}`,
    );
  });
});

test("no other Outlands destination was enabled", () => {
  [
    "http://www.cybertown.com/places/ne_game/html/gmbeam.html",
    "http://www.cybertown.com/places/ne_game/html/score.html",
    "http://www.cybertown.com/cgi-bin/games/neogame/score.pl",
  ].forEach(url => {
    const decision = classifyLegacyDestination(url);
    assert.notStrictEqual(decision.action, MAP_TO_CTR_ROUTE, `must not map: ${url}`);
  });
  assert.strictEqual(LEGACY_ROUTES.indexOf("/place/ne_game"), -1);
});

test("every mapped route is still a literal written in the helper", () => {
  const source = fs.readFileSync(
    path.join(SPA_SRC, "helpers/legacy-destination.helper.ts"),
    "utf8",
  );
  LEGACY_ROUTES.forEach(route => {
    assert.ok(source.indexOf(`"${route}"`) !== -1, `not a literal: ${route}`);
  });
});

/* ------------------------------------------------------------------ */
console.log("\n5. World mount gate");

const WORLD_PAGE_SOURCE = fs.readFileSync(WORLD_PAGE, "utf8");
const WORLD_PAGE_CODE = code(WORLD_PAGE_SOURCE);

test("the gate sits between getPlace() and startX3D()", () => {
  const gate = WORLD_PAGE_CODE.indexOf("showOutlandsEntrance = true");
  const getPlace = WORLD_PAGE_CODE.indexOf("await this.getPlace()");
  const start = WORLD_PAGE_CODE.indexOf("await this.startX3D()");
  assert.ok(gate !== -1, "the entrance gate is missing");
  assert.ok(getPlace !== -1 && start !== -1);
  assert.ok(getPlace < gate, "the gate must run after the place row is known");
  assert.ok(gate < start, "the gate must run before the world mounts");
});

test("the gate returns, so startX3D() is not reached without a pick", () => {
  const gate = WORLD_PAGE_CODE.indexOf("showOutlandsEntrance = true");
  const tail = WORLD_PAGE_CODE.slice(gate, WORLD_PAGE_CODE.indexOf("await this.startX3D()"));
  assert.ok(/\breturn;/.test(tail), "the entrance branch must return before the mount");
});

test("the gate is scoped to Outlands and to nothing else", () => {
  assert.ok(
    /if\s*\(\s*!isOutlandsPlace\(/.test(WORLD_PAGE_CODE),
    "the gate must be keyed on isOutlandsPlace()",
  );
  assert.ok(
    WORLD_PAGE_CODE.indexOf("isOutlandsPlace") !== -1,
    "WorldBrowserPage must import the scoped predicate",
  );
  // No place slug other than the Outlands may reach the entrance.
  const entranceUses = WORLD_PAGE_CODE.split("showOutlandsEntrance = true").length - 1;
  assert.strictEqual(entranceUses, 1, "there must be exactly one way into the entrance");
});

test("only the Outlands place is an Outlands place", () => {
  assert.ok(isOutlandsPlace({ slug: "outlands" }));
  ["enter", "funpark", "mall", "home", "ne_game", "Outlands", ""].forEach(slug => {
    assert.ok(!isOutlandsPlace({ slug }), `must not be Outlands: ${slug}`);
  });
  assert.ok(!isOutlandsPlace({ slug: null }));
  assert.ok(!isOutlandsPlace({}));
  assert.ok(!isOutlandsPlace(null));
  assert.ok(!isOutlandsPlace(undefined));
});

test("entering registers the identity before it reloads the place", () => {
  const enter = WORLD_PAGE_CODE.indexOf("async enterOutlands(");
  assert.notStrictEqual(enter, -1, "enterOutlands is missing");
  const body = WORLD_PAGE_CODE.slice(enter, enter + 900);
  const select = body.indexOf("outlandsIdentity.select(");
  const reload = body.indexOf("this.loadAndJoinPlace()");
  assert.ok(select !== -1 && reload !== -1);
  assert.ok(select < reload, "the provider must be registered before the world reloads");
  assert.ok(/canEnterOutlands/.test(body), "entry must respect the citizen gate");
});

test("leaving the world-browser route releases the identity", () => {
  const unload = WORLD_PAGE_CODE.indexOf("async unloadPlace(");
  assert.notStrictEqual(unload, -1);
  const body = WORLD_PAGE_CODE.slice(unload, unload + 500);
  assert.ok(/releaseOutlands\(\)/.test(body), "unloadPlace must release the selection");
  assert.ok(
    /outlandsIdentity\.release\(\)/.test(WORLD_PAGE_CODE),
    "the seam must actually be unregistered",
  );
});

test("moving to a non-Outlands place also releases the identity", () => {
  const gate = WORLD_PAGE_CODE.indexOf("if (!isOutlandsPlace(");
  const body = WORLD_PAGE_CODE.slice(gate, gate + 400);
  assert.ok(/releaseOutlands\(\)/.test(body), "the non-Outlands branch must release");
});

test("the entrance component exists and offers exactly the four labels", () => {
  const source = fs.readFileSync(ENTRANCE, "utf8");
  ["Red male", "Red female", "Blue male", "Blue female"].forEach(label => {
    const parts = label.split(" ");
    assert.ok(
      source.indexOf("OUTLANDS_AVATARS") !== -1,
      "the entrance must render the shared table",
    );
    assert.ok(parts.length === 2, label);
  });
  assert.deepStrictEqual(
    OUTLANDS_AVATARS.map(a => a.label),
    ["Red male", "Red female", "Blue male", "Blue female"],
  );
  assert.ok(source.indexOf("$emit(\"select\"") !== -1, "the entrance must emit its pick");
});

test("the binder uses the reserved seam and does not replace it", () => {
  const binder = code(fs.readFileSync(BINDER, "utf8"));
  const mod = fs.readFileSync(IDENTITY_MOD, "utf8");
  assert.ok(
    mod.indexOf("X3D.bxx.setIdentityProvider = function") !== -1,
    "bxx_identity.js must still own the seam",
  );
  assert.strictEqual(
    binder.indexOf("Object.defineProperty"),
    -1,
    "the binder must not redefine Browser properties",
  );
  assert.strictEqual(
    binder.indexOf("myAvatarURL"),
    -1,
    "the binder must not touch myAvatarURL directly",
  );
  const helper = code(fs.readFileSync(HELPER, "utf8"));
  assert.ok(
    helper.indexOf("setIdentityProvider") !== -1,
    "the session must register through the seam",
  );
});

/* ------------------------------------------------------------------ */
console.log("\n6. Citizen gate");

test("a place route is already members only in the router", () => {
  const main = code(fs.readFileSync(MAIN, "utf8"));
  const list = main.slice(main.indexOf("[\"login\", \"logout\""));
  const publicNames = list.slice(0, list.indexOf("]"));
  ["world-browser", "place", "outlands"].forEach(name => {
    assert.strictEqual(
      publicNames.indexOf(`"${name}"`),
      -1,
      `${name} must not be a public route`,
    );
  });
  assert.ok(
    /appStore\.data\.isUser = true/.test(main),
    "isUser must be set from the member session",
  );
  assert.ok(
    /destroySession\(\)/.test(main),
    "a failed session must be destroyed rather than passed through",
  );
});

test("the entrance refuses to act without a member session", () => {
  assert.ok(
    /canEnterOutlands\(\):\s*boolean\s*\{\s*return this\.\$store\.data\.isUser === true;/
      .test(WORLD_PAGE_CODE.replace(/\s+/g, " ").replace(/ \{ /g, "{ ")) ||
    /this\.\$store\.data\.isUser === true/.test(WORLD_PAGE_CODE),
    "the gate must be the live member session",
  );
  const entrance = fs.readFileSync(ENTRANCE, "utf8");
  assert.ok(
    entrance.indexOf("only Cybertown Citizens can enter Outlands") !== -1,
    "the historical refusal must be shown",
  );
  assert.ok(
    /if\s*\(!this\.canEnter\)\s*\{\s*return;\s*\}/.test(code(entrance)),
    "the picker must refuse rather than only warn",
  );
});

/* ------------------------------------------------------------------ */
console.log("\n7. Historical assets");

test("the historical worlds are byte-identical to fork master", () => {
  const { execFileSync } = require("child_process");
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "origin/master", "--", "spa/assets/worlds/ne_game"],
    { cwd: path.resolve(SPA, ".."), encoding: "utf8" },
  ).trim();
  assert.strictEqual(changed, "", `historical assets changed: ${changed}`);
});

test("the entrance art it needs is already shipped inside CTR", () => {
  assert.strictEqual(OUTLANDS_ART_BASE, "/assets/worlds/ne_game/html/");
  const files = ["outlands.jpg", "redm.jpg", "redf.jpg", "bluem.jpg", "bluef.jpg"];
  files.forEach(name => {
    assert.ok(
      fs.existsSync(path.join(NE_GAME, "html", name)),
      `missing shipped entrance art: ${name}`,
    );
  });
  assert.strictEqual(OUTLANDS_HEADER_IMAGE, "/assets/worlds/ne_game/html/outlands.jpg");
  OUTLANDS_AVATARS.forEach(a => {
    assert.strictEqual(a.thumbnailUrl, `/assets/worlds/ne_game/html/${a.key}.jpg`);
  });
});

test("the five historical avatar worlds are all still present", () => {
  ["redm", "redf", "bluem", "bluef", "gm"].forEach(name => {
    assert.ok(
      fs.existsSync(path.join(NE_GAME, "vrml/avatars", `${name}.wrl`)),
      `missing avatar world: ${name}.wrl`,
    );
  });
});

/* ------------------------------------------------------------------ */
console.log("\n8. Scope");

test("no match mode, no game master and no scoring were added", () => {
  const sources = [WORLD_PAGE_CODE, code(fs.readFileSync(ENTRANCE, "utf8")),
    code(fs.readFileSync(HELPER, "utf8")), code(fs.readFileSync(BINDER, "utf8"))];
  ["T_pass", "PASS1", "PASS2", "CKSM.", "ne_game_pass", "ne_game_gm", "boot.wrl",
    "score.pl", "score1.pl"].forEach(token => {
    sources.forEach(source => {
      assert.strictEqual(source.indexOf(token), -1, `out of scope token in code: ${token}`);
    });
  });
});

test("no database, migration or role change belongs to this lane", () => {
  const { execFileSync } = require("child_process");
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "origin/master"],
    { cwd: path.resolve(SPA, ".."), encoding: "utf8" },
  ).trim().split("\n").filter((line: string) => line !== "");
  changed.forEach((file: string) => {
    assert.strictEqual(file.indexOf("api/db/migrations"), -1, `migration touched: ${file}`);
    assert.strictEqual(file.indexOf("api/db/seed"), -1, `seed touched: ${file}`);
  });
});

/* ------------------------------------------------------------------ */
console.log("\n9. Rendering path under a 2D preference");

/** The awaiting twin of `test()`, for the executed-method checks below. */
async function atest(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}

/*
 * OUTLANDS-2A QA correction. A member may store `view3d = false` ("Default
 * Chat: 2D"). The render branch used to read that preference directly, so
 * Outlands fell into the 2D arm and asked for
 * `@/components/place/outlands/main2d.vue`, a file that does not exist and
 * never did - historical Outlands was 3D only.
 *
 * These tests do not restate the branch. They EXTRACT the real
 * `loadAndJoinPlace()`, `releaseOutlands()` and `effective3d` out of the
 * shipped `WorldBrowserPage.vue` and EXECUTE them against a stand-in
 * component, recording every module specifier the method asks for. The suite
 * therefore fails if the page ever asks for an Outlands 2D component again.
 */

/** Cut one brace-balanced member out of the page source, by its opening line. */
function member(header: string): string {
  const at = WORLD_PAGE_SOURCE.indexOf(header);
  assert.notStrictEqual(at, -1, `member not found: ${header}`);
  let depth = 0;
  let i = WORLD_PAGE_SOURCE.indexOf("{", at);
  const open = i;
  for (; i < WORLD_PAGE_SOURCE.length; i += 1) {
    const c = WORLD_PAGE_SOURCE[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return WORLD_PAGE_SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced member: ${header}`);
}

interface FakePage {
  loaded: boolean;
  force2d: boolean;
  force3d: boolean;
  showOutlandsEntrance: boolean;
  outlandsAvatarKey: string | null;
  mainComponent: any;
  browser: any;
  imports: string[];
  mounted: number;
  released: number;
  [key: string]: any;
}

/* The real bodies, compiled once. `import(` is rewired so the specifier is
   recorded instead of resolved - the point is which file would be asked for. */
const LOAD_BODY = member("async loadAndJoinPlace(): Promise<void> {")
  .replace(/\bimport\(/g, "__import(");
const RELEASE_BODY = member("releaseOutlands(): void {");
const EFFECTIVE_BODY = member("effective3d(): boolean {");

const buildLoad = new Function(
  "isOutlandsPlace", "X3D", "__import",
  `return async function () ${LOAD_BODY};`,
);
const buildRelease = new Function("outlandsIdentity", `return function () ${RELEASE_BODY};`);
const buildEffective = new Function(`return function () ${EFFECTIVE_BODY};`);

function fakePage(place: any, view3d: boolean, avatarKey: string | null): FakePage {
  const page = {
    loaded: false,
    force2d: false,
    force3d: false,
    showOutlandsEntrance: false,
    outlandsAvatarKey: avatarKey,
    mainComponent: null,
    browser: "world",
    imports: [] as string[],
    mounted: 0,
    released: 0,
    $store: { data: { place, view3d, user: { username: "qa", token: "t" }, isUser: true } },
    $socket: { leaveRoom() { /* no room in the harness */ }, async joinRoom() { /* idem */ } },
    $route: { params: {}, name: "world-browser" },
    async getPlace() { /* the place row is already set by the test */ },
    async startX3D() { page.mounted += 1; return { id: "browser" }; },
    startX3DListeners() { /* listeners are out of this test's scope */ },
    async joinPlace() { /* the socket join is out of this test's scope */ },
  } as unknown as FakePage;

  Object.defineProperty(page, "effective3d", { get: buildEffective(), configurable: true });
  page.releaseOutlands = buildRelease({ release() { page.released += 1; } }).bind(page);
  const X3D = { getBrowser: () => ({ replaceWorld() { /* nothing is mounted here */ } }) };
  page.load = buildLoad(isOutlandsPlace, X3D, (spec: string) => {
    page.imports.push(spec);
    return Promise.resolve({});
  }).bind(page);
  return page;
}

const OUTLANDS_PLACE = { id: 9, slug: OUTLANDS_SLUG, type: "place", assets_dir: "ne_game/" };
const PLAZA = { id: 1, slug: "plaza", type: "place", assets_dir: "plaza/" };
const SHOP = { id: 2, slug: "someshop", type: "shop", assets_dir: "shop/" };

/** Ask a fake page to render, then say what it did. */
async function render(place: any, view3d: boolean, avatarKey: string | null): Promise<FakePage> {
  const page = fakePage(place, view3d, avatarKey);
  await page.load();
  if (page.mainComponent) await page.mainComponent();
  return page;
}

async function section9(): Promise<void> {
  await atest("2D preference: a direct Outlands route still shows the entrance", async () => {
    const page = await render(OUTLANDS_PLACE, false, null);
    assert.strictEqual(page.showOutlandsEntrance, true, "the entrance must be shown");
    assert.strictEqual(page.mounted, 0, "no world may mount before a pick");
    assert.deepStrictEqual(page.imports, [], "no 2D component may be requested");
  });

  await atest("2D preference: a red pick takes the 3D Outlands path", async () => {
    const page = await render(OUTLANDS_PLACE, false, "redm");
    assert.strictEqual(page.force3d, true, "Outlands must raise its local 3D override");
    assert.strictEqual(page.effective3d, true);
    assert.strictEqual(page.mounted, 1, "ne_game.wrl must mount through startX3D()");
    assert.strictEqual(page.mainComponent, null, "no 2D component may be selected");
    assert.deepStrictEqual(page.imports, []);
  });

  await atest("2D preference: a blue pick takes the 3D Outlands path", async () => {
    const page = await render(OUTLANDS_PLACE, false, "bluef");
    assert.strictEqual(page.force3d, true);
    assert.strictEqual(page.mounted, 1);
    assert.deepStrictEqual(page.imports, []);
  });

  await atest("Outlands never requests a main2d.vue, at either preference", async () => {
    for (const view3d of [false, true]) {
      for (const key of [null, "redm", "redf", "bluem", "bluef"]) {
        const page = await render(OUTLANDS_PLACE, view3d, key);
        page.imports.forEach(spec => {
          assert.strictEqual(
            spec.indexOf("main2d"), -1,
            `Outlands asked for a 2D component: ${spec}`,
          );
        });
      }
    }
  });

  test("the missing component is never named, so no import can reject", () => {
    assert.strictEqual(
      WORLD_PAGE_SOURCE.indexOf("place/outlands/main2d"), -1,
      "the page must not name a file that does not exist",
    );
    const dir = path.join(SPA_SRC, "components/place/outlands");
    const files = fs.readdirSync(dir);
    assert.strictEqual(
      files.indexOf("main2d.vue"), -1,
      "no fake Outlands 2D component may be added - Outlands was 3D only",
    );
  });

  await atest("Outlands does not write the stored preference", async () => {
    const page = await render(OUTLANDS_PLACE, false, "redm");
    assert.strictEqual(page.$store.data.view3d, false, "the member's own setting must survive");
    const load = code(LOAD_BODY);
    assert.strictEqual(
      /\$store\.data\.view3d\s*=/.test(load), false,
      "the render path must never assign to view3d",
    );
    assert.strictEqual(
      /chatdefault/.test(code(WORLD_PAGE_SOURCE)), false,
      "the lane must not touch the chat default preference",
    );
  });

  await atest("leaving Outlands drops the override and restores 2D behaviour", async () => {
    const page = await render(OUTLANDS_PLACE, false, "redm");
    assert.strictEqual(page.force3d, true);
    page.$store.data.place = SHOP;
    page.imports = [];
    page.mounted = 0;
    await page.load();
    if (page.mainComponent) await page.mainComponent();
    assert.strictEqual(page.force3d, false, "the override must not follow the member out");
    assert.strictEqual(page.released, 1, "the identity must be released");
    assert.strictEqual(page.mounted, 0, "a 2D member must not be forced into 3D");
    assert.deepStrictEqual(page.imports, ["@/components/place/mall/main2d.vue"]);
  });

  await atest("a normal place keeps the member's stored 2D behaviour", async () => {
    const plaza = await render(PLAZA, false, null);
    assert.strictEqual(plaza.force3d, false);
    assert.strictEqual(plaza.mounted, 0);
    assert.deepStrictEqual(plaza.imports, ["@/components/place/plaza/main2d.vue"]);
    const shop = await render(SHOP, false, null);
    assert.deepStrictEqual(shop.imports, ["@/components/place/mall/main2d.vue"]);
  });

  await atest("returning to Outlands shows the entrance again", async () => {
    const page = await render(OUTLANDS_PLACE, false, "redm");
    page.$store.data.place = PLAZA;
    await page.load();
    assert.strictEqual(page.outlandsAvatarKey, null, "the pick must not survive the trip out");
    page.$store.data.place = OUTLANDS_PLACE;
    page.mounted = 0;
    await page.load();
    assert.strictEqual(page.showOutlandsEntrance, true, "the entrance must be shown again");
    assert.strictEqual(page.mounted, 0, "no world may mount before the second pick");
  });

  await atest("the 3D preference behaves exactly as before", async () => {
    const plaza = await render(PLAZA, true, null);
    assert.strictEqual(plaza.mounted, 1);
    assert.deepStrictEqual(plaza.imports, []);
    const entrance = await render(OUTLANDS_PLACE, true, null);
    assert.strictEqual(entrance.showOutlandsEntrance, true);
    assert.strictEqual(entrance.mounted, 0);
    const world = await render(OUTLANDS_PLACE, true, "redm");
    assert.strictEqual(world.mounted, 1);
  });

  test("effective3d is the stored preference for every place but Outlands", () => {
    const effective3d = buildEffective();
    const at = (force3d: boolean, view3d: boolean): boolean =>
      effective3d.call({ force3d, $store: { data: { view3d } } });
    assert.strictEqual(at(false, false), false, "2D preference, normal place");
    assert.strictEqual(at(false, true), true, "3D preference, normal place");
    assert.strictEqual(at(true, false), true, "2D preference, Outlands");
    assert.ok(
      /this\.force3d = isOutlandsPlace\(/.test(code(LOAD_BODY)),
      "the override must be keyed on isOutlandsPlace(), not on a slug string",
    );
  });

  await atest("a force2d place still wins over the 3D preference", async () => {
    const page = await render({ id: 3, slug: "clubdir", type: "place" }, true, null);
    assert.strictEqual(page.force2d, true);
    assert.strictEqual(page.mounted, 0, "clubdir must stay 2D");
    assert.deepStrictEqual(page.imports, ["@/components/place/clubdir/main2d.vue"]);
  });
}

/* ------------------------------------------------------------------ */
section9().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
