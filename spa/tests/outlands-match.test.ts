/**
 * OUTLANDS-2B guard for scheduled Outlands match mode.
 *
 * Like the OUTLANDS-2A suite beside it this is plain Node - no runner, no DOM,
 * no WebGL - and like it, wherever real behaviour is claimed the real artefact is
 * executed rather than described:
 *
 *   the match team    `set_team()` is EXTRACTED FROM THE SHIPPED, GZIPPED
 *                     `assets/worlds/ne_game/vrml/ne_game_pass.wrl` and RUN in a
 *                     `vm` sandbox against the identity the real session
 *                     registers. The world decides the team, not this file.
 *   the password tail the same run records the world's own
 *                     `createVrmlFromURL('...?ac=check&pass=' + pass)` call, so
 *                     the `?pass=` value the world reads back is compared with
 *                     the password that went in.
 *   the entry flow    `enterOutlands()`, `enterOutlandsFreePlay()`,
 *                     `enterOutlandsMatch()`, `releaseOutlands()`, `worldUrl`
 *                     and `sessionRoom` are CUT OUT OF `WorldBrowserPage.vue`
 *                     and EXECUTED against a stand-in page with a fake `$http`.
 *   the isolation     the `SE` relay is CUT OUT OF the real `server.js` and
 *                     EXECUTED, so the claim that two session keys are two zones
 *                     is checked against the code that actually routes them.
 *
 * Nine parts:
 *
 *   1. CONTRACT   - the four match avatars, the world, the scene, the keys.
 *   2. IDENTITY   - the exact `?pass=` string, and free play's bare one.
 *   3. REAL WORLD - the shipped match `set_team()`, executed, all four ways.
 *   4. SESSION    - selection, mode, cleanup, forged inputs.
 *   5. PAGE       - free play unchanged; match mounts the match world; a wrong
 *                   password mounts nothing and registers nothing.
 *   6. ISOLATION  - the real `SE` relay keeps free play and the match apart.
 *   7. 3D ONLY    - a 2D-preferring member still enters a match in 3D.
 *   8. SECURITY   - no storage, no logging, no read-back, generic refusal.
 *   9. SCOPE      - no Game Master, no scoring, no second transport.
 */
import assert from "assert";
import {
  OUTLANDS_AVATARS,
  OUTLANDS_FREE_SCENE_NAME,
  OUTLANDS_FREE_WORLD_FILENAME,
  OUTLANDS_IDENTITY_BASE,
  OUTLANDS_MATCH_AVATAR_KEYS,
  OUTLANDS_MATCH_PROMPT,
  OUTLANDS_MATCH_REFUSED,
  OUTLANDS_MATCH_SCENE_NAME,
  OUTLANDS_MATCH_STYLE,
  OUTLANDS_MATCH_TEAM_NUMBER,
  OUTLANDS_MATCH_WORLD_FILENAME,
  OUTLANDS_SLUG,
  OutlandsIdentity,
  OutlandsMatchTeam,
  OutlandsSex,
  buildOutlandsMatchIdentityUrl,
  createOutlandsIdentitySession,
  findOutlandsAvatar,
  findOutlandsMatchAvatar,
  isOutlandsMatchTeam,
  isOutlandsPlace,
  isOutlandsSex,
  outlandsFreeSessionKey,
  outlandsMatchSessionKey,
} from "../src/helpers/outlands.helper";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const REPO = path.resolve(SPA, "..");
const WORLD_PAGE = path.join(SPA_SRC, "pages/world-browser/WorldBrowserPage.vue");
const ENTRANCE = path.join(SPA_SRC, "components/place/outlands/OutlandsEntrance.vue");
const ADMIN = path.join(SPA_SRC, "components/place/outlands/OutlandsMatchAdmin.vue");
const HELPER = path.join(SPA_SRC, "helpers/outlands.helper.ts");
const SOCKET_SERVER = path.join(SPA, "server.js");
const NE_GAME = path.join(SPA, "assets/worlds/ne_game");
const API_SERVICE = path.join(
  REPO, "api/src/services/outlands/outlands-match.service.ts");
const API_CONTROLLER = path.join(REPO, "api/src/controllers/outlands.controller.ts");
const API_REPOSITORY = path.join(
  REPO, "api/src/repositories/outlands/outlands-match.repository.ts");

/*
 * Obvious dummies. These are test fixtures and are not secrets: nothing in CTR
 * ships them, no migration seeds them, and the server stores only bcrypt hashes
 * of whatever an Outlands Chief actually types.
 */
const BLUE_TEST_ONLY = "BLUE_TEST_ONLY";
const RED_TEST_ONLY = "RED_TEST_ONLY";
const WRONG_TEST_ONLY = "WRONG_TEST_ONLY";

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

const WORLD_PAGE_SOURCE: string = fs.readFileSync(WORLD_PAGE, "utf8");
const WORLD_PAGE_CODE = code(WORLD_PAGE_SOURCE);

/* ------------------------------------------------------------------ */
console.log("\n1. Match contract");

test("the match world is ne_game_pass.wrl and free play keeps ne_game.wrl", () => {
  assert.strictEqual(OUTLANDS_MATCH_WORLD_FILENAME, "vrml/ne_game_pass.wrl");
  assert.strictEqual(OUTLANDS_FREE_WORLD_FILENAME, "vrml/ne_game.wrl");
  assert.notStrictEqual(OUTLANDS_MATCH_WORLD_FILENAME, OUTLANDS_FREE_WORLD_FILENAME);
  // Both worlds are shipped, so the override can never point at a missing file.
  ["vrml/ne_game.wrl", "vrml/ne_game_pass.wrl"].forEach(file => {
    assert.ok(fs.existsSync(path.join(NE_GAME, file)), `missing world: ${file}`);
  });
});

test("the historical scene names are the two zones, and they differ", () => {
  assert.strictEqual(OUTLANDS_FREE_SCENE_NAME, "Outlands");
  assert.strictEqual(OUTLANDS_MATCH_SCENE_NAME, "Outlands Match 1");
  assert.notStrictEqual(OUTLANDS_MATCH_SCENE_NAME, OUTLANDS_FREE_SCENE_NAME);
});

test("PASS1 is Blue and PASS2 is Red - the (team, sex) table", () => {
  assert.deepStrictEqual(OUTLANDS_MATCH_AVATAR_KEYS.blue, { male: "bluem", female: "bluef" });
  assert.deepStrictEqual(OUTLANDS_MATCH_AVATAR_KEYS.red, { male: "redm", female: "redf" });
});

test("setStyle() collapsed the tiles to male 1 and female 2", () => {
  assert.deepStrictEqual(OUTLANDS_MATCH_STYLE, { male: 1, female: 2 });
  // The historical free-play styles were 1..4; a match only ever sent 1 or 2.
  assert.deepStrictEqual(OUTLANDS_AVATARS.map(a => a.style), [1, 2, 3, 4]);
});

test("the match world resolves red to team 1 and blue to team 2", () => {
  assert.deepStrictEqual(OUTLANDS_MATCH_TEAM_NUMBER, { red: 1, blue: 2 });
});

test("the tables are frozen and forged team or sex values find nothing", () => {
  assert.ok(Object.isFrozen(OUTLANDS_MATCH_AVATAR_KEYS));
  assert.ok(Object.isFrozen(OUTLANDS_MATCH_AVATAR_KEYS.blue));
  assert.ok(Object.isFrozen(OUTLANDS_MATCH_TEAM_NUMBER));
  ["green", "BLUE", "constructor", "__proto__", "", null, undefined, 1].forEach(value => {
    assert.strictEqual(isOutlandsMatchTeam(value), false, `forged team: ${String(value)}`);
    assert.strictEqual(findOutlandsMatchAvatar(value, "male"), null);
    assert.strictEqual(isOutlandsSex(value), false, `forged sex: ${String(value)}`);
    assert.strictEqual(findOutlandsMatchAvatar("blue", value), null);
  });
});

test("the historical T_pass prompt is reproduced word for word", () => {
  assert.strictEqual(
    OUTLANDS_MATCH_PROMPT,
    "If you have a scheduled match, enter your password here and select an avatar to enter",
  );
  const entrance = fs.readFileSync(ENTRANCE, "utf8");
  assert.ok(
    entrance.indexOf("OUTLANDS_MATCH_PROMPT") !== -1,
    "the entrance must render the recovered prompt, not a paraphrase",
  );
});

/* ------------------------------------------------------------------ */
console.log("\n2. Match identity");

const MATCH_CASES: Array<{ team: OutlandsMatchTeam; sex: OutlandsSex; key: string }> = [
  { team: "blue", sex: "male", key: "bluem" },
  { team: "blue", sex: "female", key: "bluef" },
  { team: "red", sex: "male", key: "redm" },
  { team: "red", sex: "female", key: "redf" },
];

MATCH_CASES.forEach(entry => {
  test(`${entry.team} + ${entry.sex} selects ${entry.key}`, () => {
    const avatar = findOutlandsMatchAvatar(entry.team, entry.sex);
    assert.notStrictEqual(avatar, null, "the pair must select an avatar");
    assert.strictEqual((avatar as { key: string }).key, entry.key);
  });
});

test("a match identity is the bare historical URL plus ?pass=, unencoded", () => {
  const url = buildOutlandsMatchIdentityUrl("blue", "male", BLUE_TEST_ONLY);
  assert.strictEqual(
    url,
    `${OUTLANDS_IDENTITY_BASE}bluem.wrl?pass=${BLUE_TEST_ONLY}`,
  );
  assert.strictEqual(
    url,
    `http://www.cybertown.com/places/ne_game/vrml/avatars/bluem.wrl?pass=${BLUE_TEST_ONLY}`,
  );
});

test("the password tail is copied byte for byte and never percent-encoded", () => {
  // `ne_game_pass.wrl` reads everything after `pass=` to the end of the string,
  // so encoding here would hand the world a different password.
  const awkward = "a b+c%d/e?f=g";
  const url = buildOutlandsMatchIdentityUrl("red", "female", awkward);
  assert.strictEqual(url, `${OUTLANDS_IDENTITY_BASE}redf.wrl?pass=${awkward}`);
  assert.ok((url as string).endsWith(`?pass=${awkward}`));
});

test("an unusable team, sex or password builds no identity at all", () => {
  assert.strictEqual(buildOutlandsMatchIdentityUrl("green", "male", BLUE_TEST_ONLY), null);
  assert.strictEqual(buildOutlandsMatchIdentityUrl("blue", "other", BLUE_TEST_ONLY), null);
  assert.strictEqual(buildOutlandsMatchIdentityUrl("blue", "male", ""), null);
  assert.strictEqual(buildOutlandsMatchIdentityUrl("blue", "male", null), null);
  assert.strictEqual(buildOutlandsMatchIdentityUrl(null, null, null), null);
});

test("no free-play identity carries a query string", () => {
  OUTLANDS_AVATARS.forEach(entry => {
    assert.strictEqual(entry.identityUrl.indexOf("?"), -1, `query in free identity: ${entry.key}`);
    assert.strictEqual(entry.identityUrl.indexOf("pass="), -1, entry.key);
    assert.ok(entry.identityUrl.endsWith(".wrl"));
  });
});

/* ------------------------------------------------------------------ */
console.log("\n3. Real match-world logic");

/** Pull `set_team()` out of a shipped world by brace matching. */
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

const PASS_WORLD_SOURCE = readWorld("vrml/ne_game_pass.wrl");
const PASS_SET_TEAM = extractSetTeam(PASS_WORLD_SOURCE);

interface PassWorldResult {
  team: number;
  pass: string;
  bare: string;
  checkUrls: string[];
  loadURLCalls: string[][];
  viewpointSet: boolean;
}

/** Run the real match `set_team()` with one identity in force. */
function runMatchSetTeam(avatarURL: string): PassWorldResult {
  const loadURLCalls: string[][] = [];
  const checkUrls: string[] = [];
  const sandbox = {
    v: false,
    haveSet: false,
    team: -1,
    avatar: "",
    pass: "",
    a: "",
    viewpointSet: false,
    self: {},
    // The Script node's own field, `ne_game_pass.wrl:597`.
    loadURL: "/cgi-bin/games/neogame/score1.pl",
    MFString: function MFString(this: { value: string }, value: string) {
      this.value = value;
    },
    Browser: {
      myAvatarURL: avatarURL,
      loadURL(url: { value: string }, parameter: { value: string }) {
        loadURLCalls.push([url.value, parameter.value]);
      },
      createVrmlFromURL(url: { value: string }) {
        checkUrls.push(url.value);
      },
    },
    set_viewpoint() { (sandbox as { viewpointSet: boolean }).viewpointSet = true; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${PASS_SET_TEAM}\nset_team();`, sandbox);
  return {
    team: sandbox.team,
    pass: sandbox.pass,
    bare: sandbox.a,
    checkUrls,
    loadURLCalls,
    viewpointSet: sandbox.viewpointSet,
  };
}

test("the extracted function really is the shipped match one", () => {
  assert.ok(PASS_SET_TEAM.indexOf("Browser.myAvatarURL") !== -1);
  assert.ok(
    PASS_SET_TEAM.indexOf("lastIndexOf('pass=')") !== -1,
    "the match world must be the one that splits the identity on pass=",
  );
  // The free-play world has no such split, which is why the two must not be swapped.
  const free = extractSetTeam(readWorld("vrml/ne_game.wrl"));
  assert.strictEqual(free.indexOf("lastIndexOf('pass=')"), -1);
});

MATCH_CASES.forEach(entry => {
  const password = entry.team === "blue" ? BLUE_TEST_ONLY : RED_TEST_ONLY;
  const expected = OUTLANDS_MATCH_TEAM_NUMBER[entry.team];

  test(`the shipped match set_team() gives ${entry.key} team ${expected}`, () => {
    const host = fakeHost();
    const session = createOutlandsIdentitySession(() => host);
    const selection = session.selectMatch(entry.team, entry.sex, password, "QaMember");
    assert.notStrictEqual(selection, null, "the match selection must succeed");

    const provided = host.bxx.identityProvider as () => OutlandsIdentity;
    const result = runMatchSetTeam(provided().avatarURL);

    assert.strictEqual(result.team, expected, `wrong team for ${entry.key}`);
    assert.strictEqual(
      result.loadURLCalls.length,
      0,
      "the no-team fallback must not fire after a valid match selection",
    );
    assert.strictEqual(result.viewpointSet, true, "the team viewpoint must be bound");
    // The world strips the query back off before comparing, so what it compares
    // is the bare historical URL - proof the query is a payload, not an address.
    assert.strictEqual(
      result.bare,
      `${OUTLANDS_IDENTITY_BASE}${entry.key}.wrl`,
    );
  });

  test(`the match world reads back exactly the ${entry.team} password`, () => {
    const url = buildOutlandsMatchIdentityUrl(entry.team, entry.sex, password) as string;
    const result = runMatchSetTeam(url);
    assert.strictEqual(result.pass, password, "the world must recover the password intact");
    assert.strictEqual(result.checkUrls.length, 1, "the world checks the password once");
    assert.ok(
      result.checkUrls[0].endsWith(`?ac=check&pass=${password}`),
      `unexpected check URL: ${result.checkUrls[0]}`,
    );
  });
});

test("a free-play identity resolves no team in the MATCH world", () => {
  // Belt and braces on the isolation of the two contracts: the bare URL leaves
  // `a` holding a truncated string, so the match world refuses it.
  OUTLANDS_AVATARS.forEach(entry => {
    const result = runMatchSetTeam(entry.identityUrl);
    assert.strictEqual(
      result.team, -1, `a bare URL must not resolve in the match world: ${entry.key}`,
    );
  });
});

/* ------------------------------------------------------------------ */
console.log("\n4. Match identity session");

interface FakeHost {
  bxx: {
    identityProvider: (() => OutlandsIdentity) | null;
    /* eslint-disable-next-line no-unused-vars */
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

test("selectMatch registers the query-bearing identity synchronously", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  assert.strictEqual(host.bxx.calls, 0, "nothing is registered before a selection");

  const selection = session.selectMatch("blue", "female", BLUE_TEST_ONLY, "QaMember");
  assert.notStrictEqual(selection, null);
  assert.strictEqual(host.bxx.calls, 1, "registration must happen once, before returning");
  const provided = (host.bxx.identityProvider as () => OutlandsIdentity)();
  assert.strictEqual(
    provided.avatarURL,
    `${OUTLANDS_IDENTITY_BASE}bluef.wrl?pass=${BLUE_TEST_ONLY}`,
  );
  assert.strictEqual(provided.avatarName, "QaMember", "the nickname is the member, not the avatar");
  assert.strictEqual(session.mode(), "match");
});

test("a refused team registers nothing and leaves the session empty", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  [null, undefined, "", "green", "BLUE", 2].forEach(team => {
    assert.strictEqual(session.selectMatch(team, "male", BLUE_TEST_ONLY), null);
  });
  assert.strictEqual(
    session.selectMatch("blue", "male", ""), null, "a blank password is not a match",
  );
  assert.strictEqual(host.bxx.calls, 0, "nothing may be registered after a refusal");
  assert.strictEqual(host.bxx.identityProvider, null);
  assert.strictEqual(session.mode(), null);
  assert.strictEqual(session.matchSelection(), null);
  assert.strictEqual(session.identity(), null);
});

test("free play and match never hold at once, in either order", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);

  session.select("redm", "QaMember");
  assert.strictEqual(session.mode(), "free");
  assert.strictEqual(session.matchSelection(), null);
  assert.strictEqual(
    (session.identity() as OutlandsIdentity).avatarURL.indexOf("?pass="),
    -1,
    "free play must never carry a query",
  );

  session.selectMatch("red", "male", RED_TEST_ONLY, "QaMember");
  assert.strictEqual(session.mode(), "match");
  assert.ok((session.identity() as OutlandsIdentity).avatarURL.indexOf("?pass=") !== -1);

  session.select("bluef", "QaMember");
  assert.strictEqual(session.mode(), "free");
  assert.strictEqual(session.matchSelection(), null, "the match must be dropped");
  assert.strictEqual(
    (session.identity() as OutlandsIdentity).avatarURL,
    `${OUTLANDS_IDENTITY_BASE}bluef.wrl`,
    "no stale ?pass= tail may survive into free play",
  );
});

test("release() clears the match, the password and the provider", () => {
  const host = fakeHost();
  const session = createOutlandsIdentitySession(() => host);
  session.selectMatch("blue", "male", BLUE_TEST_ONLY, "QaMember");
  session.release();

  assert.strictEqual(host.bxx.identityProvider, null, "the provider must be unregistered");
  assert.strictEqual(session.selected(), null);
  assert.strictEqual(session.matchSelection(), null);
  assert.strictEqual(session.mode(), null);
  assert.strictEqual(session.identity(), null);

  // Nothing anywhere in the released session still holds the password.
  assert.strictEqual(
    JSON.stringify(session.matchSelection()).indexOf(BLUE_TEST_ONLY),
    -1,
  );
});

test("the selection reports the team number the match world will resolve", () => {
  const session = createOutlandsIdentitySession(() => fakeHost());
  MATCH_CASES.forEach(entry => {
    const password = entry.team === "blue" ? BLUE_TEST_ONLY : RED_TEST_ONLY;
    const selection = session.selectMatch(entry.team, entry.sex, password);
    assert.notStrictEqual(selection, null);
    const chosen = selection as { avatar: { key: string }; teamNumber: number; sex: string };
    assert.strictEqual(chosen.avatar.key, entry.key);
    assert.strictEqual(chosen.teamNumber, OUTLANDS_MATCH_TEAM_NUMBER[entry.team]);
    assert.strictEqual(chosen.sex, entry.sex);
    assert.strictEqual(runMatchSetTeam(session.identity()!.avatarURL).team, chosen.teamNumber);
  });
});

/* ------------------------------------------------------------------ */
console.log("\n5. The page");

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

/* The real bodies, compiled once, with `import(` rewired so the specifier is
   recorded rather than resolved. */
const LOAD_BODY = member("async loadAndJoinPlace(): Promise<void> {")
  .replace(/\bimport\(/g, "__import(");
const ENTER_BODY = member("async enterOutlands(selection: any): Promise<void> {");
const FREE_BODY = member("async enterOutlandsFreePlay(key: string): Promise<void> {");
const MATCH_BODY = member(
  "async enterOutlandsMatch(key: string, password: string): Promise<void> {");
const RELEASE_BODY = member("releaseOutlands(): void {");
const EFFECTIVE_BODY = member("effective3d(): boolean {");
const WORLD_URL_BODY = member("worldUrl(): string {");
const ROOM_BODY = member("sessionRoom(): string | number | null {");

const buildLoad = new Function(
  "isOutlandsPlace", "X3D", "__import",
  `return async function () ${LOAD_BODY};`,
);
const buildEnter = new Function(`return async function (selection) ${ENTER_BODY};`);
const buildFree = new Function(
  "outlandsIdentity",
  `return async function (key) ${FREE_BODY};`,
);
const buildMatch = new Function(
  "outlandsIdentity", "findOutlandsAvatar", "OUTLANDS_MATCH_REFUSED",
  `return async function (key, password) ${MATCH_BODY};`,
);
const buildRelease = new Function("outlandsIdentity", `return function () ${RELEASE_BODY};`);
const buildEffective = new Function(`return function () ${EFFECTIVE_BODY};`);
const buildWorldUrl = new Function(
  "OUTLANDS_MATCH_WORLD_FILENAME",
  `return function () ${WORLD_URL_BODY};`,
);
const buildRoom = new Function(
  "outlandsMatchSessionKey", "outlandsFreeSessionKey",
  `return function () ${ROOM_BODY};`,
);

const OUTLANDS_PLACE = {
  id: 9,
  slug: OUTLANDS_SLUG,
  type: "place",
  assets_dir: "ne_game/",
  world_filename: OUTLANDS_FREE_WORLD_FILENAME,
};
const PLAZA = {
  id: 1, slug: "plaza", type: "place", assets_dir: "plaza/", world_filename: "vrml/plaza.wrl",
};

interface FakePage {
  [key: string]: any;
}

/**
 * A stand-in page carrying the REAL methods. `matchTeam` is what the fake API
 * answers with; `null` stands for every kind of refusal - wrong password, no
 * match scheduled, a 403, or the network being down.
 */
function fakePage(place: any, view3d: boolean, matchTeam: string | null): FakePage {
  const host = fakeHost();
  const identity = createOutlandsIdentitySession(() => host);
  const page = {
    loaded: false,
    force2d: false,
    force3d: false,
    showOutlandsEntrance: false,
    outlandsAvatarKey: null,
    outlandsMode: null,
    outlandsMatchError: "",
    outlandsMatchBusy: false,
    mainComponent: null,
    browser: "world",
    imports: [] as string[],
    mounted: 0,
    joins: [] as any[],
    leaves: [] as any[],
    posts: [] as any[],
    host,
    identity,
    $store: {
      data: { place, view3d, user: { username: "qa", token: "t" }, isUser: true },
    },
    $socket: {
      leaveRoom(room: any) { page.leaves.push(room); },
      async joinRoom(room: any) { page.joins.push(room); },
    },
    $route: { params: {}, name: "world-browser" },
    $http: {
      async post(url: string, body: any) {
        page.posts.push({ url, body });
        if (matchTeam === null) {
          throw new Error("refused");
        }
        return { data: { team: matchTeam } };
      },
    },
    canEnterOutlands: true,
    debugMsg() { /* quiet */ },
    async getPlace() { /* the place row is already set by the test */ },
    async startX3D() { page.mounted += 1; return { id: "browser" }; },
    startX3DListeners() { /* out of scope here */ },
  } as unknown as FakePage;

  Object.defineProperty(page, "effective3d", { get: buildEffective(), configurable: true });
  Object.defineProperty(page, "worldUrl", {
    get: buildWorldUrl(OUTLANDS_MATCH_WORLD_FILENAME), configurable: true,
  });
  Object.defineProperty(page, "sessionRoom", {
    get: buildRoom(outlandsMatchSessionKey, outlandsFreeSessionKey), configurable: true,
  });

  page.releaseOutlands = buildRelease(identity).bind(page);
  page.enterOutlands = buildEnter().bind(page);
  page.enterOutlandsFreePlay = buildFree(identity).bind(page);
  page.enterOutlandsMatch = buildMatch(
    identity, findOutlandsAvatar, OUTLANDS_MATCH_REFUSED,
  ).bind(page);

  const X3D = { getBrowser: () => ({ replaceWorld() { /* nothing mounts here */ } }) };
  page.loadAndJoinPlace = buildLoad(isOutlandsPlace, X3D, (spec: string) => {
    page.imports.push(spec);
    return Promise.resolve({});
  }).bind(page);
  // The real `joinPlace()` does much more than this test needs; the room it
  // would join is the thing under test, so only that is reproduced.
  page.joinPlace = async function joinPlace() {
    await page.$socket.joinRoom(page.sessionRoom, page.$store.data.user.token);
  };
  return page;
}

/** Land on Outlands, then click one tile with the given password. */
async function enter(
  password: string,
  key: string,
  matchTeam: string | null,
  view3d = true,
): Promise<FakePage> {
  const page = fakePage(OUTLANDS_PLACE, view3d, matchTeam);
  await page.loadAndJoinPlace();
  await page.enterOutlands({ key, password });
  return page;
}

async function section5(): Promise<void> {
  await atest("a blank password is free play - OUTLANDS-2A, unchanged", async () => {
    const page = await enter("", "redm", null);
    assert.strictEqual(page.outlandsMode, "free");
    assert.strictEqual(page.outlandsAvatarKey, "redm");
    assert.strictEqual(page.showOutlandsEntrance, false);
    assert.strictEqual(page.mounted, 1, "the world must mount after the pick");
    assert.strictEqual(page.worldUrl, `/assets/worlds/ne_game/${OUTLANDS_FREE_WORLD_FILENAME}`);
    assert.strictEqual(page.sessionRoom, OUTLANDS_PLACE.id, "free play keeps the place id");
    assert.deepStrictEqual(page.posts, [], "free play must not call the match endpoint");
    const registered = (page.host.bxx.identityProvider as () => OutlandsIdentity)();
    assert.strictEqual(registered.avatarURL, `${OUTLANDS_IDENTITY_BASE}redm.wrl`);
    assert.strictEqual(registered.avatarURL.indexOf("?pass="), -1);
  });

  await atest("every free-play tile still resolves its historical team", async () => {
    for (const entry of OUTLANDS_AVATARS) {
      const page = await enter("", entry.key, null);
      const registered = (page.host.bxx.identityProvider as () => OutlandsIdentity)();
      const result = runMatchSetTeam(registered.avatarURL);
      // The FREE world is the authority for free play; the 2A suite runs it.
      // Here it is enough that no query crept in and the mode stayed free.
      assert.strictEqual(page.outlandsMode, "free");
      assert.strictEqual(registered.avatarURL.indexOf("?"), -1);
      assert.strictEqual(result.team, -1, "a bare URL is not a match identity");
    }
  });

  for (const entry of MATCH_CASES) {
    const password = entry.team === "blue" ? BLUE_TEST_ONLY : RED_TEST_ONLY;
    // The tile clicked is deliberately the WRONG colour half the time, to prove
    // the password overrides it - `setStyle()` threw the colour away.
    const tile = entry.sex === "male" ? "redm" : "bluef";

    await atest(
      `a valid ${entry.team} password with the ${entry.sex} tile enters as ${entry.key}`,
      async () => {
        const page = await enter(password, tile, entry.team);

        assert.strictEqual(page.outlandsMode, "match");
        assert.strictEqual(page.outlandsAvatarKey, entry.key, "the password owns the colour");
        assert.strictEqual(page.showOutlandsEntrance, false);
        assert.strictEqual(page.outlandsMatchError, "");
        assert.strictEqual(page.mounted, 1);

        // The match world, not the free one.
        assert.strictEqual(
          page.worldUrl,
          `/assets/worlds/ne_game/${OUTLANDS_MATCH_WORLD_FILENAME}`,
        );
        assert.ok(page.worldUrl.indexOf("ne_game_pass.wrl") !== -1);

        // The match session, not the place id.
        assert.strictEqual(page.sessionRoom, outlandsMatchSessionKey(OUTLANDS_PLACE.id));
        assert.notStrictEqual(page.sessionRoom, OUTLANDS_PLACE.id);
        assert.deepStrictEqual(page.joins, [page.sessionRoom]);

        // The identity, and the team the shipped match world derives from it.
        const registered = (page.host.bxx.identityProvider as () => OutlandsIdentity)();
        assert.strictEqual(
          registered.avatarURL,
          `${OUTLANDS_IDENTITY_BASE}${entry.key}.wrl?pass=${password}`,
        );
        assert.strictEqual(
          runMatchSetTeam(registered.avatarURL).team,
          OUTLANDS_MATCH_TEAM_NUMBER[entry.team],
        );

        // The password went to the server, and only as a POST body.
        assert.strictEqual(page.posts.length, 1);
        assert.strictEqual(page.posts[0].url, "/outlands/match/enter");
        assert.deepStrictEqual(page.posts[0].body, { password });
      },
    );
  }

  await atest("a wrong password mounts nothing and registers nothing", async () => {
    const page = await enter(WRONG_TEST_ONLY, "redm", null);

    assert.strictEqual(page.outlandsMatchError, OUTLANDS_MATCH_REFUSED, "the refusal must show");
    assert.strictEqual(page.showOutlandsEntrance, true, "the member stays at the entrance");
    assert.strictEqual(page.mounted, 0, "no world may mount");
    assert.strictEqual(page.outlandsMode, null, "no mode may be taken");
    assert.strictEqual(page.outlandsAvatarKey, null, "no avatar may be taken");
    assert.strictEqual(page.host.bxx.calls, 0, "no identity may be registered");
    assert.strictEqual(page.host.bxx.identityProvider, null);
    assert.strictEqual(page.identity.mode(), null);
    assert.deepStrictEqual(page.joins, [], "no session may be joined");
    assert.strictEqual(page.outlandsMatchBusy, false, "the entrance must be usable again");
  });

  await atest("the refusal says nothing about which password it was", async () => {
    const page = await enter(WRONG_TEST_ONLY, "bluem", null);
    const message = page.outlandsMatchError.toLowerCase();
    ["blue", "red", "team", "close", "almost", "correct password"].forEach(word => {
      assert.strictEqual(message.indexOf(word), -1, `the refusal leaks "${word}"`);
    });
    assert.strictEqual(
      message.indexOf(WRONG_TEST_ONLY.toLowerCase()), -1, "it echoes the password",
    );
  });

  await atest("a refused match can be retried, and a good password then works", async () => {
    const page = fakePage(OUTLANDS_PLACE, true, null);
    await page.loadAndJoinPlace();
    await page.enterOutlands({ key: "redm", password: WRONG_TEST_ONLY });
    assert.strictEqual(page.showOutlandsEntrance, true);

    // Same page, the server now accepts.
    page.$http.post = async (url: string, body: any) => {
      page.posts.push({ url, body });
      return { data: { team: "blue" } };
    };
    await page.enterOutlands({ key: "redm", password: BLUE_TEST_ONLY });
    assert.strictEqual(page.outlandsMode, "match");
    assert.strictEqual(page.outlandsAvatarKey, "bluem", "male tile, blue password");
    assert.strictEqual(page.outlandsMatchError, "", "the old refusal must be cleared");
  });

  await atest("a team the server never grants is refused by the browser too", async () => {
    for (const forged of ["green", "gm", "", "3", null]) {
      const page = await enter(BLUE_TEST_ONLY, "redm", forged as any);
      assert.strictEqual(page.outlandsMode, null, `forged team accepted: ${String(forged)}`);
      assert.strictEqual(page.mounted, 0);
      assert.strictEqual(page.host.bxx.calls, 0);
      assert.strictEqual(page.outlandsMatchError, OUTLANDS_MATCH_REFUSED);
    }
  });

  await atest("leaving Outlands releases the match and shows the entrance again", async () => {
    const page = await enter(BLUE_TEST_ONLY, "redm", "blue");
    assert.strictEqual(page.outlandsMode, "match");

    // Walk to another place: the non-Outlands branch releases.
    page.$store.data.place = PLAZA;
    await page.loadAndJoinPlace();
    assert.strictEqual(page.outlandsMode, null);
    assert.strictEqual(page.outlandsAvatarKey, null);
    assert.strictEqual(page.host.bxx.identityProvider, null, "the provider must be unregistered");
    assert.strictEqual(page.identity.matchSelection(), null);

    // Walk back: the entrance, with no automatic re-entry and no world mount.
    const mountedBefore = page.mounted;
    page.$store.data.place = OUTLANDS_PLACE;
    await page.loadAndJoinPlace();
    assert.strictEqual(page.showOutlandsEntrance, true, "the entrance must be shown again");
    assert.strictEqual(page.outlandsMode, null, "a past match must not grant re-entry");
    assert.strictEqual(page.mounted, mountedBefore, "returning must mount no world");
    assert.strictEqual(page.host.bxx.identityProvider, null, "and register no identity");
  });

  await atest("an Outlands match avatar never survives into another world", async () => {
    const page = await enter(RED_TEST_ONLY, "bluef", "red");
    page.$store.data.place = PLAZA;
    await page.loadAndJoinPlace();
    assert.strictEqual(page.host.bxx.identityProvider, null);
    assert.strictEqual(page.worldUrl, "/assets/worlds/plaza/vrml/plaza.wrl");
    assert.strictEqual(page.sessionRoom, PLAZA.id, "another place keeps its own room");
  });
}

/* ------------------------------------------------------------------ */
console.log("\n6. Session isolation");

/**
 * The REAL `SE` relay, cut out of `server.js`. The claim under test - that two
 * session keys are two zones - is a claim about this code, so this code is what
 * runs.
 */
const SERVER_SOURCE: string = fs.readFileSync(SOCKET_SERVER, "utf8");

function extractHandler(event: string): string {
  const marker = `socket.on("${event}", function(msg) {`;
  const at = SERVER_SOURCE.indexOf(marker);
  assert.notStrictEqual(at, -1, `handler not found: ${event}`);
  const open = SERVER_SOURCE.indexOf("{", at + marker.length - 1);
  let depth = 0;
  for (let i = open; i < SERVER_SOURCE.length; i += 1) {
    if (SERVER_SOURCE[i] === "{") depth += 1;
    else if (SERVER_SOURCE[i] === "}") {
      depth -= 1;
      if (depth === 0) return SERVER_SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced handler: ${event}`);
}

const SE_HANDLER = extractHandler("SE");

/** A minimal stand-in for the socket.io room fan-out `server.js` relies on. */
function fakeIo(delivered: Array<{ room: string; msg: any }>) {
  return {
    to(room: string) {
      return { emit(_event: string, msg: any) { delivered.push({ room, msg }); } };
    },
  };
}

test("the extracted relay really is the shipped one", () => {
  assert.ok(SE_HANDLER.indexOf("io.to(") !== -1, "the relay must be room scoped");
  assert.ok(SE_HANDLER.indexOf("USERS.get(socket).room") !== -1);
});

test("a match SharedEvent is delivered only to the match session", () => {
  const delivered: Array<{ room: string; msg: any }> = [];
  const freeSocket = { id: "free" };
  const matchSocket = { id: "match" };
  const USERS = new Map<any, any>([
    [freeSocket, { room: outlandsFreeSessionKey(9) }],
    [matchSocket, { room: outlandsMatchSessionKey(9) }],
  ]);
  const relay = new Function(
    "io", "USERS", "socket", "console", `return function (msg) ${SE_HANDLER};`,
  );
  const quiet = { log() { /* the shipped relay logs; the test does not */ } };

  relay(fakeIo(delivered), USERS, matchSocket, quiet)({ name: "shot" });
  relay(fakeIo(delivered), USERS, freeSocket, quiet)({ name: "shot" });

  assert.strictEqual(delivered.length, 2);
  assert.strictEqual(delivered[0].room, outlandsMatchSessionKey(9));
  assert.strictEqual(delivered[1].room, outlandsFreeSessionKey(9));
  assert.notStrictEqual(delivered[0].room, delivered[1].room, "the two zones must differ");
});

test("the match session key can never collide with any place id", () => {
  for (const id of [1, 9, 42, 1000, 999999]) {
    const free = outlandsFreeSessionKey(id);
    const match = outlandsMatchSessionKey(id);
    assert.notStrictEqual(String(free), String(match));
    assert.strictEqual(/^\d+$/.test(String(match)), false, "a match key is never a bare id");
    assert.strictEqual(match, `${id}:outlands-match-1`);
    // No other place's id can produce this string either.
    for (const other of [1, 9, 42, 1000, 999999]) {
      assert.notStrictEqual(String(outlandsFreeSessionKey(other)), match);
    }
  }
});

test("no second transport was introduced", () => {
  const page = WORLD_PAGE_CODE;
  ["new WebSocket", "io(", "socket.io-client", "EventSource", "new SocketManager"]
    .forEach(token => {
      assert.strictEqual(page.indexOf(token), -1, `a second transport appeared: ${token}`);
    });
  assert.ok(page.indexOf("this.$socket.joinRoom(this.sessionRoom") !== -1,
    "the existing socket must be the one that joins the match session");
});

test("the socket server does not ask a named room about chat access", () => {
  // A match room is not a home and has no chat-access row; asking would 400 on
  // every join and every message.
  assert.ok(
    SERVER_SOURCE.indexOf("outlands-match-1") !== -1,
    "the guard must say what it is for",
  );
  assert.ok(/\/\^\\d\+\$\/\.test\(String\(room\)\)/.test(SERVER_SOURCE.replace(/\s/g, "")) ||
    SERVER_SOURCE.indexOf("^\\d+$") !== -1, "the guard must be a numeric-room test");
});

/* ------------------------------------------------------------------ */
console.log("\n7. 3D only");

async function section7(): Promise<void> {
  await atest("a 2D-preferring member still enters a scheduled match in 3D", async () => {
    const page = await enter(BLUE_TEST_ONLY, "redm", "blue", false);
    assert.strictEqual(page.$store.data.view3d, false, "the stored preference must not change");
    assert.strictEqual(page.force3d, true, "Outlands raises its own local override");
    assert.strictEqual(page.effective3d, true);
    assert.strictEqual(page.mounted, 1, "the match world must mount through startX3D()");
    assert.strictEqual(page.mainComponent, null, "no 2D component may be selected");
    assert.deepStrictEqual(page.imports, [], "no main2d.vue may be requested");
    assert.strictEqual(
      page.worldUrl,
      `/assets/worlds/ne_game/${OUTLANDS_MATCH_WORLD_FILENAME}`,
    );
  });

  await atest("the 2D preference survives leaving the match", async () => {
    const page = await enter(RED_TEST_ONLY, "bluef", "red", false);
    page.$store.data.place = PLAZA;
    await page.loadAndJoinPlace();
    assert.strictEqual(page.$store.data.view3d, false, "the member's own setting is untouched");
    assert.strictEqual(page.force3d, false, "the local override must be dropped");
    assert.strictEqual(page.effective3d, false);
  });
}

/* ------------------------------------------------------------------ */
console.log("\n8. Security");

const ENTRANCE_SOURCE: string = fs.readFileSync(ENTRANCE, "utf8");
const ADMIN_SOURCE: string = fs.readFileSync(ADMIN, "utf8");
const HELPER_SOURCE: string = fs.readFileSync(HELPER, "utf8");
const SERVICE_SOURCE: string = fs.readFileSync(API_SERVICE, "utf8");
const CONTROLLER_SOURCE: string = fs.readFileSync(API_CONTROLLER, "utf8");
const REPOSITORY_SOURCE: string = fs.readFileSync(API_REPOSITORY, "utf8");

const CLIENT_SOURCES: Array<[string, string]> = [
  ["WorldBrowserPage.vue", WORLD_PAGE_SOURCE],
  ["OutlandsEntrance.vue", ENTRANCE_SOURCE],
  ["OutlandsMatchAdmin.vue", ADMIN_SOURCE],
  ["outlands.helper.ts", HELPER_SOURCE],
];

test("no match password is ever put in browser storage", () => {
  CLIENT_SOURCES.forEach(([name, source]) => {
    ["localStorage", "sessionStorage", "document.cookie", "indexedDB"].forEach(token => {
      assert.strictEqual(
        code(source).indexOf(token), -1,
        `${name} reaches for ${token}`,
      );
    });
  });
});

test("no match password is logged, anywhere", () => {
  const all: Array<[string, string]> = CLIENT_SOURCES.concat([
    ["outlands-match.service.ts", SERVICE_SOURCE],
    ["outlands.controller.ts", CONTROLLER_SOURCE],
    ["outlands-match.repository.ts", REPOSITORY_SOURCE],
  ]);
  all.forEach(([name, source]) => {
    const body = code(source);
    // Any logging call at all in these files must not be handed a password,
    // a hash or the request body.
    const logs = body.match(/console\.(log|error|warn|info)\(([^\n]*)/g) || [];
    logs.forEach(line => {
      // A fixed message may contain the WORD "password"; what must never appear
      // is a VALUE. String literals are removed first, so only the identifiers
      // and expressions actually handed to the logger are examined.
      const args = line.replace(/'[^']*'/g, "  ").replace(/"[^"]*"/g, "  ");
      ["password", "pass", "hash", "request.body", "req.body", "T_pass"].forEach(token => {
        assert.strictEqual(
          args.toLowerCase().indexOf(token.toLowerCase()), -1,
          `${name} logs ${token}: ${line}`,
        );
      });
    });
  });
});

test("the admin API can only ever return booleans", () => {
  // The status route's response is built from `getStatus`, and `getStatus`
  // returns two booleans derived from the hashes - never a hash.
  assert.ok(SERVICE_SOURCE.indexOf("blueSet: typeof hashes.blue === 'string'") !== -1);
  assert.ok(SERVICE_SOURCE.indexOf("redSet: typeof hashes.red === 'string'") !== -1);
  // Nothing anywhere returns a stored value to a caller.
  ["json(hashes", "json({ blue:", "json({ red:", "blue_password_hash }", "password_hash)"]
    .forEach(token => {
      assert.strictEqual(
        CONTROLLER_SOURCE.indexOf(token), -1, `the controller may return ${token}`,
      );
    });
});

test("the client never learns a stored password or hash", () => {
  CLIENT_SOURCES.forEach(([name, source]) => {
    ["_hash", "bcrypt", "PASS1", "PASS2"].forEach(token => {
      assert.strictEqual(code(source).indexOf(token), -1, `${name} mentions ${token} in code`);
    });
  });
  // The admin panel reads booleans and nothing else.
  assert.ok(ADMIN_SOURCE.indexOf("data.blueSet === true") !== -1);
  assert.ok(ADMIN_SOURCE.indexOf("data.redSet === true") !== -1);
});

test("no live password is committed as a fixture", () => {
  // Every password in this suite is an obvious dummy, and none of them appears
  // in a shipped source file.
  [BLUE_TEST_ONLY, RED_TEST_ONLY, WRONG_TEST_ONLY].forEach(value => {
    CLIENT_SOURCES.concat([
      ["outlands-match.service.ts", SERVICE_SOURCE],
      ["outlands.controller.ts", CONTROLLER_SOURCE],
    ]).forEach(([name, source]) => {
      assert.strictEqual(source.indexOf(value), -1, `${name} ships the fixture ${value}`);
    });
  });
});

test("validation is on the server and the browser only carries the answer", () => {
  const body = WORLD_PAGE_CODE;
  assert.ok(
    body.indexOf("this.$http.post(\"/outlands/match/enter\"") !== -1,
    "the page must ask the server",
  );
  /*
   * The page must never compare a password against a value itself. The two
   * comparisons it IS allowed are the historical empty-vs-not test that
   * `setStyle()` made, and an ordinary `typeof` guard; both are removed before
   * the check, so anything left is a real judgement.
   */
  const judged = body
    .replace(/typeof\s+[A-Za-z0-9_.$[\]]+\s*===\s*"[a-z]+"/g, " ")
    .replace(/password\s*===\s*""/g, " ");
  [/password\s*===\s*["'][^"']*["']/, /PASS1/, /PASS2/, /bcrypt/].forEach(pattern => {
    assert.strictEqual(pattern.test(judged), false, "the browser must not judge the password");
  });
  // The server-side check is a bcrypt comparison, not string equality.
  assert.ok(SERVICE_SOURCE.indexOf("bcrypt.compare") !== -1);
  assert.strictEqual(
    /password\s*===\s*hash/.test(SERVICE_SOURCE), false,
    "stored comparison must not be string equality",
  );
});

test("administration is Outlands Chief or Admin, and never the Deputy", () => {
  assert.ok(SERVICE_SOURCE.indexOf("'Outlands Chief'") !== -1);
  assert.ok(SERVICE_SOURCE.indexOf("'Admin'") !== -1);
  assert.strictEqual(
    SERVICE_SOURCE.indexOf("'Outlands Deputy'"), -1,
    "OUTLANDS-2B defines no Deputy powers",
  );
  // The Chief's grant is scoped to the place, the Admin's is not.
  assert.ok(
    SERVICE_SOURCE.indexOf("Number(assignment.place_id) === placeId") !== -1,
    "the Chief must be checked at the place",
  );
  // Both write and read are gated by the same one check.
  const gates = (CONTROLLER_SOURCE.match(/canAdministerMatch/g) || []).length;
  assert.strictEqual(gates, 2, "both password routes must be gated, and only those");
});

/* ------------------------------------------------------------------ */
console.log("\n9. Scope");

test("no Game Master and no scoring were added", () => {
  const sources: Array<[string, string]> = CLIENT_SOURCES.concat([
    ["outlands-match.service.ts", SERVICE_SOURCE],
    ["outlands.controller.ts", CONTROLLER_SOURCE],
    ["outlands-match.repository.ts", REPOSITORY_SOURCE],
  ]);
  ["CKSM.", "ne_game_gm", "gm.wrl", "gmbeam", "score.pl", "score1.pl", "DMZ"]
    .forEach(token => {
      sources.forEach(([name, source]) => {
        assert.strictEqual(
          code(source).indexOf(token), -1, `${name} carries out-of-scope token ${token}`,
        );
      });
    });
});

test("no historical world, avatar or template was changed", () => {
  const { execFileSync } = require("child_process");
  const changed = execFileSync(
    "git", ["diff", "--name-only", "origin/master"], { cwd: REPO, encoding: "utf8" },
  ).trim().split("\n").filter((line: string) => line !== "");
  changed.forEach((file: string) => {
    assert.strictEqual(file.indexOf("spa/assets/"), -1, `a shipped asset changed: ${file}`);
    assert.strictEqual(file.indexOf(".wrl"), -1, `a world changed: ${file}`);
    assert.strictEqual(file.indexOf(".tmpl"), -1, `a template changed: ${file}`);
  });
});

test("the entrance still refuses a non-citizen, with or without a password", () => {
  assert.ok(
    ENTRANCE_SOURCE.indexOf("only Cybertown Citizens can enter Outlands") !== -1,
    "the historical refusal must still be shown",
  );
  const body = code(ENTRANCE_SOURCE);
  assert.ok(
    /if\s*\(!this\.canEnter\)\s*\{\s*return;\s*\}/.test(body),
    "the picker must still refuse rather than only warn",
  );
  assert.ok(
    /:disabled="!canEnter \|\| busy"/.test(ENTRANCE_SOURCE),
    "the password box must be closed to a non-citizen too",
  );
});

/* ------------------------------------------------------------------ */
async function main(): Promise<void> {
  await section5();
  await section7();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
