/**
 * LEGACY-LINKS-1 guard for the proven fixed-route restoration.
 *
 * The SPA test harness is deliberately dependency-free - plain Node, no runner,
 * no DOM, no WebGL - so this suite does not load X_ITE 4.7.0. Where X_ITE's own
 * behaviour matters, the exact lines that decide it are reproduced from the
 * shipped `x_ite.min.js`, and the real binding files are then checked by shape
 * so the reproduction cannot drift away from them:
 *
 *   FileLoader.getTarget(p)        -> the value of the first "target=..." entry
 *   FileLoader.createX3DFromURL    -> sets this.foreign from its 5th argument
 *   FileLoader.loadDocumentAsync   -> this.target.length && "_self" !== target
 *                                       && this.foreign
 *                                       ? this.foreign(url, target) : fetch
 *   Anchor.requestAsyncLoad        -> createX3DFromURL(url, parameter, cb,
 *                                       bindViewpoint, foreign)
 *   Inline / createVrmlFromURL     -> createX3DFromURL(url, null, cb)
 *
 * The last line is the whole safety argument for the second seam: only a call
 * that carries a `foreign` callback can navigate, and only `Anchor` and
 * `Browser.loadURL` pass one.
 *
 * The suite is in twelve parts:
 *
 *    1. TABLES        - the fixed tables are frozen, literal and self-consistent.
 *    2. PARSING       - the parameter and query readers, including the shapes
 *                       the real worlds actually contain.
 *    3. PLACE DOORS   - the 13 `plc` mappings.
 *    4. MALL DOORS    - the 9 store mappings, and the 2 that must not map.
 *    5. COLONIES      - the 6 kiosks and the Adventure Anchor.
 *    6. ONE-OFFS      - Flea Market booth, Cafe Plaza door, Plaza map sign,
 *                       Fun Park pool sign, Bank exit door.
 *    7. SUPPRESSED    - every link that must produce no route.
 *   7b. OLD TOWN      - the flat-page door that must open no window.
 *    8. BOUNDARIES    - unknown legacy signatures, unrelated URLs, lookalike
 *                       hosts, prototype-pollution keys.
 *    9. X_ITE FLOW    - the Anchor stand-in, and the non-navigation regression.
 *   10. SHIPPED WORLDS- the real addresses read out of the shipped `.wrl` files.
 *   11. SAFETY GATES  - source assertions about the three binding files.
 *   12. WIRING        - `App.vue` registration order.
 */
import assert from "assert";
import {
  LEGACY_COLONY_ROUTES,
  LEGACY_DESTINATION_ACTIONS,
  LEGACY_EXACT_ROUTES,
  LEGACY_FRAME_CALL_PREFIX,
  LEGACY_PLACE_ROUTES,
  LEGACY_ROUTES,
  LEGACY_STORE_ROUTES,
  LEGACY_SUPPRESSED_ADDRESSES,
  LEGACY_UNTARGETED_ROUTES,
  MAP_TO_CTR_ROUTE,
  PASS_THROUGH,
  SUPPRESS_LEGACY,
  classifyLegacyDestination,
  classifyLegacyNavigation,
  classifyLegacyScene,
  readFieldStrings,
  readLegacyParameter,
  readLegacyProgram,
  readLegacyQuery,
} from "../src/helpers/legacy-destination.helper";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const HELPER = path.join(SPA_SRC, "helpers/legacy-destination.helper.ts");
const URL_BINDING = path.join(SPA_SRC, "libs/x_ite_mods/bxx_url.js");
const ANCHOR_BINDING = path.join(SPA_SRC, "libs/x_ite_mods/bxx_anchor.js");
const NAVIGATOR = path.join(SPA_SRC, "libs/x_ite_mods/bxx_route.js");
const APP = path.join(SPA_SRC, "App.vue");
const WORLDS = path.join(SPA, "assets/worlds");
const EXTERNPROTOS = path.join(SPA, "assets/externprotos");

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
 * Strip comments so the safety gates assert about executable code, not about
 * the prose that describes what is being prevented.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map(line => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** Read a shipped world file, transparently gunzipping the compressed ones. */
function readAsset(root: string, relative: string): string {
  const bytes = fs.readFileSync(path.join(root, relative));
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return zlib.gunzipSync(bytes).toString("latin1");
  }
  return bytes.toString("latin1");
}

function routeOf(url: string, target?: string): string | null {
  return classifyLegacyDestination(url, target).route;
}

/** Assert that an address produces this exact fixed route. */
function mapsTo(url: string, route: string, target?: string): void {
  const decision = classifyLegacyDestination(url, target);
  assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE, `not mapped: ${url}`);
  assert.strictEqual(decision.route, route, `wrong route for ${url}`);
}

/** Assert that an address reaches no CTR route at all, by any path. */
function reachesNoRoute(url: string, target?: string): void {
  const single = classifyLegacyDestination(url, target);
  assert.notStrictEqual(single.action, MAP_TO_CTR_ROUTE, `must not map: ${url}`);
  assert.strictEqual(single.route, null, `must carry no route: ${url}`);
  const whole = classifyLegacyNavigation([url], target ? [`target=${target}`] : []);
  assert.notStrictEqual(whole.action, MAP_TO_CTR_ROUTE, `call must not map: ${url}`);
  assert.strictEqual(whole.route, null, `call must carry no route: ${url}`);
}

/* ------------------------------------------------------------------ *
 * 1. TABLES
 * ------------------------------------------------------------------ */
console.log("\n1. Tables");

const ALL_TABLES: Array<[string, Readonly<Record<string, string>>]> = [
  ["place", LEGACY_PLACE_ROUTES],
  ["store", LEGACY_STORE_ROUTES],
  ["colony", LEGACY_COLONY_ROUTES],
  ["exact", LEGACY_EXACT_ROUTES],
  ["untargeted", LEGACY_UNTARGETED_ROUTES],
];

ALL_TABLES.forEach(([name, table]) => {
  test(`the ${name} table is frozen`, () => {
    assert.strictEqual(Object.isFrozen(table), true);
  });

  test(`every ${name} route is an absolute literal CTR path`, () => {
    Object.keys(table).forEach(key => {
      assert.ok(/^\/[a-z0-9_/]+$/.test(table[key]), `${key} -> ${table[key]}`);
    });
  });

  test(`every ${name} route is listed in LEGACY_ROUTES`, () => {
    Object.keys(table).forEach(key => {
      assert.ok(LEGACY_ROUTES.indexOf(table[key]) !== -1, `${table[key]} is unlisted`);
    });
  });
});

test("the place table holds exactly the 14 approved slugs", () => {
  // `ne_game` joined the table in OUTLANDS-2A, which built the team-avatar
  // picker this entry was waiting for. Every other slug is unchanged, and the
  // two Outlands destinations that stay blocked are asserted in part 7.
  assert.deepStrictEqual(Object.keys(LEGACY_PLACE_ROUTES).sort(), [
    "blackmarket", "cafe", "cityhall", "cyberhood", "employment", "enter",
    "fleamarket", "funpark", "ne_game", "pool", "post", "shopping", "stadium",
    "theatre",
  ]);
});

test("the store table holds exactly the 9 approved store ids", () => {
  assert.strictEqual(Object.keys(LEGACY_STORE_ROUTES).length, 9);
});

test("the colony table holds exactly the 6 approved colony ids", () => {
  assert.strictEqual(Object.keys(LEGACY_COLONY_ROUTES).length, 6);
});

test("LEGACY_ROUTES is frozen, sorted and free of duplicates", () => {
  assert.strictEqual(Object.isFrozen(LEGACY_ROUTES), true);
  const copy = LEGACY_ROUTES.slice().sort();
  assert.deepStrictEqual(LEGACY_ROUTES.slice(), copy);
  assert.strictEqual(new Set(LEGACY_ROUTES).size, LEGACY_ROUTES.length);
});

test("only three destination actions are accepted", () => {
  assert.deepStrictEqual(LEGACY_DESTINATION_ACTIONS.slice(), ["3d", "place", "index3d"]);
});

/* ------------------------------------------------------------------ *
 * 2. PARSING
 * ------------------------------------------------------------------ */
console.log("\n2. Parsing");

test("the CGI program is the last path segment inside /cgi-bin/", () => {
  assert.strictEqual(readLegacyProgram("/cgi-bin/cybertown/place?plc=cafe"), "place");
  assert.strictEqual(readLegacyProgram("/cgi-bin/colonycity/place?plc=cafe"), "place");
  assert.strictEqual(readLegacyProgram("/cgi-bin/cybertown/community?ID=1"), "community");
  assert.strictEqual(readLegacyProgram("/cgi-bin/cybertown/neighbor?ID=1"), "neighbor");
});

test("a path outside /cgi-bin/ names no program", () => {
  assert.strictEqual(readLegacyProgram("/avatars/avlib_1.html"), "");
  assert.strictEqual(readLegacyProgram("/places/ne_game/html/gmbeam.html"), "");
  assert.strictEqual(readLegacyProgram("/index2.html"), "");
  assert.strictEqual(readLegacyProgram("/place/funpark"), "");
});

test("the query reader decodes pairs and skips empty ones", () => {
  const query = readLegacyQuery("/cgi-bin/cybertown/place?plc=cafe&&ID=0006&ac=3D");
  assert.strictEqual(query.plc, "cafe");
  assert.strictEqual(query.ID, "0006");
  assert.strictEqual(query.ac, "3D");
});

test("a repeated key keeps its FIRST value, as the historical CGI did", () => {
  const flea = "/cgi-bin/cybertown/place?plc=blackmarket&ac=place&ID=34&ac=3D";
  assert.strictEqual(readLegacyQuery(flea).ac, "place");
});

test("the query reader inherits nothing from Object.prototype", () => {
  const query = readLegacyQuery("/cgi-bin/cybertown/place?plc=x");
  assert.strictEqual(query.constructor as unknown, undefined);
  assert.strictEqual(query.toString as unknown, undefined);
});

test("a malformed percent escape is kept verbatim instead of throwing", () => {
  assert.strictEqual(readLegacyQuery("/cgi-bin/cybertown/place?plc=%E0%A4%A").plc, "%E0%A4%A");
});

test("the parameter reader splits at the FIRST equals only", () => {
  const parameters = ["target=_self", "scene=/cgi-bin/colonycity/place?plc=enter&ac=3D"];
  assert.strictEqual(readLegacyParameter(parameters, "target"), "_self");
  assert.strictEqual(
    readLegacyParameter(parameters, "scene"),
    "/cgi-bin/colonycity/place?plc=enter&ac=3D",
  );
});

test("an absent parameter reads as an empty string", () => {
  assert.strictEqual(readLegacyParameter(["target=_top"], "scene"), "");
  assert.strictEqual(readLegacyParameter([], "target"), "");
});

test("readFieldStrings accepts MFString-like, string and empty inputs", () => {
  assert.deepStrictEqual(readFieldStrings({ length: 2, 0: "a", 1: "b" }), ["a", "b"]);
  assert.deepStrictEqual(readFieldStrings("a"), ["a"]);
  assert.deepStrictEqual(readFieldStrings(""), []);
  assert.deepStrictEqual(readFieldStrings(null), []);
  assert.deepStrictEqual(readFieldStrings(undefined), []);
});

/* ------------------------------------------------------------------ *
 * 3. PLACE DOORS
 * ------------------------------------------------------------------ */
console.log("\n3. Place doors");

const PLACE_DOORS: Array<[string, string, string]> = [
  ["funpark", "000000000000000a", "/place/funpark"],
  ["fleamarket", "0000000000000016", "/place/fleamarket"],
  ["cafe", "0000000000000006", "/place/cafe"],
  ["stadium", "000000000000000d", "/place/stadium"],
  ["post", "0000000000000010", "/place/postoffice"],
  ["theatre", "0000000000000008", "/place/theatre"],
  ["shopping", "000000000000009a", "/place/mall"],
  ["employment", "000000000000000c", "/place/employment"],
  ["cityhall", "0000000000000002", "/place/cityhall"],
  ["pool", "000000000000000b", "/place/pool"],
  ["blackmarket", "0000000000000034", "/place/blackmarket"],
  ["cyberhood", "0108000000000000", "/place/cyberhood"],
  ["enter", "0000000000000001", "/place/enter"],
];

PLACE_DOORS.forEach(([slug, id, route]) => {
  test(`plc=${slug} maps to ${route}`, () => {
    mapsTo(
      `/cgi-bin/cybertown/place?plc=${slug}&ID=${id}&ac=3D&T_refresh=false&IE=x.bxx`,
      route,
    );
  });

  test(`plc=${slug} maps the same on the absolute historical host`, () => {
    mapsTo(
      `http://www.cybertown.com/cgi-bin/cybertown/place?plc=${slug}&ID=${id}&ac=3D`,
      route,
    );
  });
});

test("ac=place is a destination action too", () => {
  mapsTo("/cgi-bin/cybertown/place?plc=post&ID=0000000000000010&ac=place", "/place/postoffice");
});

test("a whole loadURL call carries the route and drops the address list", () => {
  const decision = classifyLegacyNavigation(
    ["/cgi-bin/cybertown/place?plc=funpark&ID=000000000000000a&ac=3D"],
    ["target=CCpro"],
  );
  assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE);
  assert.strictEqual(decision.route, "/place/funpark");
  assert.deepStrictEqual(decision.keptUrls, []);
  assert.strictEqual(decision.target, "CCpro");
});

/* ------------------------------------------------------------------ *
 * 4. MALL DOORS
 * ------------------------------------------------------------------ */
console.log("\n4. Mall doors");

const STORE_DOORS: Array<[string, string, string]> = [
  ["0000000000000905", "Carpet Shop", "/place/carpetshop"],
  ["0000000000000906", "Garden Store", "/place/gardenstore"],
  ["0000000000000902", "Gift Shop", "/place/giftshop"],
  ["0000000000000908", "Novelty Store", "/place/noveltystore"],
  ["0000000000000904", "Furniture Shop", "/place/furniturestore"],
  ["0000000000000911", "Antique Shop", "/place/antiqueshop"],
  ["0000000000000903", "Appliance Shop", "/place/applianceshop"],
  ["0000000000000909", "Toy Store", "/place/toystore"],
  ["0000000000000907", "Electronics Store", "/place/electronicsstore"],
];

STORE_DOORS.forEach(([id, name, route]) => {
  test(`the ${name} door maps to ${route}`, () => {
    mapsTo(`/cgi-bin/cybertown/place?ID=${id}&plc=shop&ac=index3d`, route);
    mapsTo(`http://www.cybertown.com/cgi-bin/cybertown/place?ID=${id}&plc=shop&ac=index3d`, route);
  });
});

test("the Gallery door reaches no route", () => {
  reachesNoRoute("/cgi-bin/cybertown/place?ID=0000000000000901&plc=shop&ac=index3d");
});

test("the Grocery Store door reaches no route", () => {
  reachesNoRoute(
    "http://www.cybertown.com/cgi-bin/cybertown/place?ID=0000000000000916&plc=shop&ac=index3d",
  );
});

test("an unknown store id reaches no route", () => {
  reachesNoRoute("/cgi-bin/cybertown/place?ID=0000000000000999&plc=shop&ac=index3d");
});

/* ------------------------------------------------------------------ *
 * 5. COLONIES
 * ------------------------------------------------------------------ */
console.log("\n5. Colonies");

const COLONY_KIOSKS: Array<[string, string]> = [
  ["0101000000000000", "/place/games_col"],
  ["0102000000000000", "/place/scifi_col"],
  ["0103000000000000", "/place/vrtwrlds_col"],
  ["0104000000000000", "/place/ent_col"],
  ["0105000000000000", "/place/inrlms_col"],
  ["0108000000000000", "/place/cyberhood"],
];

COLONY_KIOSKS.forEach(([id, route]) => {
  test(`the colony kiosk for ${id} maps to ${route}`, () => {
    mapsTo(`/cgi-bin/cybertown/community?ac=place&ID=${id}&force=s`, route, "place");
  });
});

test("the Adventure colony Anchor maps to Inner Realms", () => {
  mapsTo(
    "http://www.cybertown.com/cgi-bin/cybertown/community?ID=0105000000000000",
    "/place/inrlms_col",
  );
});

test("an unknown colony id reaches no route", () => {
  reachesNoRoute("/cgi-bin/cybertown/community?ac=place&ID=0110000000000000&force=s");
});

test("the hex id is never handed on as a destination", () => {
  const decision = classifyLegacyDestination(
    "/cgi-bin/cybertown/community?ac=place&ID=0101000000000000",
  );
  assert.strictEqual(decision.route, "/place/games_col");
  assert.strictEqual((decision.route as string).indexOf("0101"), -1);
});

/* ------------------------------------------------------------------ *
 * 6. ONE-OFFS
 * ------------------------------------------------------------------ */
console.log("\n6. One-offs");

test("the Flea Market hidden booth maps to the Black Market", () => {
  mapsTo(
    "/cgi-bin/cybertown/place?plc=blackmarket&ac=place&ID=0000000000000034&ac=3D&&" +
    "T_refresh=false&T_refresh=false&IE=x.bxx",
    "/place/blackmarket",
  );
});

test("the Cafe Plaza door maps to the Plaza through its scene parameter", () => {
  const decision = classifyLegacyNavigation(
    ["../../enter/vrml/enter.wrl"],
    ["target=_self", "scene=/cgi-bin/colonycity/place?plc=enter&ac=3D&IE=x.bxx"],
  );
  assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE);
  assert.strictEqual(decision.route, "/place/enter");
});

test("the old scene= frame parameter is not preserved anywhere", () => {
  const decision = classifyLegacyScene([
    "scene=/cgi-bin/colonycity/place?plc=enter&ac=3D&IE=x.bxx",
  ]);
  assert.strictEqual(decision.route, "/place/enter");
});

test("a scene parameter with no proven mapping leaves the call alone", () => {
  const decision = classifyLegacyNavigation(
    ["../../library/vrml/library.wrl"],
    ["target=_self", "scene=/cgi-bin/colonycity/place?plc=library&ac=3D"],
  );
  assert.notStrictEqual(decision.action, MAP_TO_CTR_ROUTE);
  assert.deepStrictEqual(decision.keptUrls, ["../../library/vrml/library.wrl"]);
});

test("the Cafe start-up chrome call stays suppressed", () => {
  const decision = classifyLegacyNavigation(
    ["/cgi-bin/colonycity/place?plc=cafe&ac=action"],
    ["target=action", ""],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
});

test("the Cafe jukebox pop-up still passes through", () => {
  const decision = classifyLegacyNavigation(["audio/audio.htm"], ["target=audio", ""]);
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.deepStrictEqual(decision.keptUrls, ["audio/audio.htm"]);
});

test("the Plaza map sign maps to /citymap", () => {
  mapsTo("javascript:loadCustom('/places/enter/html/map.html',525,400)", "/citymap", "action");
});

test("the Plaza map sign is matched whole, not parsed", () => {
  reachesNoRoute("javascript:loadCustom('/places/enter/html/map.html',525,401)");
  reachesNoRoute("javascript:loadCustom('/places/other/html/map.html',525,400)");
});

test("no other javascript address becomes a route", () => {
  reachesNoRoute("javascript:loadInfo('/places/news/magazine/dailynews/index.html')");
  reachesNoRoute("javascript:getInfo(\"PI_1\")");
  reachesNoRoute("javascript:alert(1)");
});

test("the changeFrames companion call is suppressed", () => {
  const call = "javascript:changeFrames(\"/cgi-bin/cybertown/place?ac=menu&plc=funpark\"," +
    "\"/cgi-bin/cybertown/place?ac=action&plc=funpark\")";
  const decision = classifyLegacyNavigation([call], ["target=action"]);
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
  assert.deepStrictEqual(decision.keptUrls, []);
  assert.deepStrictEqual(decision.legacyUrls, [call]);
});

test("the empty changeFrames call from the unused doors is suppressed too", () => {
  const decision = classifyLegacyNavigation(
    ["javascript:changeFrames(\"\",\"\")"],
    ["target=action"],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.deepStrictEqual(decision.keptUrls, []);
});

test("the changeFrames prefix is matched at the start only", () => {
  assert.strictEqual(LEGACY_FRAME_CALL_PREFIX, "javascript:changeFrames(");
  const decision = classifyLegacyDestination("javascript:x=changeFrames(\"a\",\"b\")");
  assert.strictEqual(decision.action, PASS_THROUGH);
});

test("the Fun Park pool sign is repaired only when its target is empty", () => {
  mapsTo("/#/place/pool", "/place/pool", "");
  mapsTo("/#/place/pool", "/place/pool");
  assert.strictEqual(routeOf("/#/place/pool", "_top"), null);
  assert.strictEqual(classifyLegacyDestination("/#/place/pool", "_top").action, PASS_THROUGH);
});

test("every other already-modernised world link keeps its exact behaviour", () => {
  ["/#/place/mall", "/#/place/carpetshop", "/#/place/enter", "/#/place/833"].forEach(url => {
    ["", "_top", "_self"].forEach(target => {
      const decision = classifyLegacyDestination(url, target);
      assert.strictEqual(decision.action, PASS_THROUGH, `${url} target=${target}`);
    });
  });
});

test("the Bank exit door reaches the Plaza without leaving the host", () => {
  mapsTo("https://www.cybertownrevival.com/#/place/enter", "/place/enter", "_top");
});

test("the Bank match is exact, so no other production address is caught", () => {
  const decision = classifyLegacyDestination(
    "https://www.cybertownrevival.com/#/place/mall",
    "_top",
  );
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.strictEqual(decision.route, null);
});

/* ------------------------------------------------------------------ *
 * 7. SUPPRESSED
 * ------------------------------------------------------------------ */
console.log("\n7. Kept suppressed");

const KEEP_SUPPRESSED: Array<[string, string]> = [
  // The Outlands team entrance itself left this list in OUTLANDS-2A - see the
  // Outlands block below. The game-master beam page did NOT: its DMZ
  // destination is OUTLANDS-2C and nothing approves it yet.
  ["Outlands GM beam page", "http://www.cybertown.com/places/ne_game/html/gmbeam.html"],
  ["Avatar Boutique", "http://www.cybertown.com/avatars/avlib_1.html"],
  ["Old Town", "/index2.html"],
  [
    "Entertainment Complex",
    "/cgi-bin/cybertown/place?plc=ent_complex&ID=0000000000000017&ac=place",
  ],
  ["Visitor Center", "/cgi-bin/cybertown/place?plc=club&DTY=CL&ID=CL00000000001b9b&ac=3D"],
  ["Library", "/cgi-bin/cybertown/place?plc=library&ID=0000000000000005&ac=place"],
  ["Grocery Store", "/cgi-bin/cybertown/place?ID=0000000000000916&plc=shop&ac=index3d"],
  ["Gallery", "/cgi-bin/cybertown/place?ID=0000000000000901&plc=shop&ac=index3d"],
  ["9th Dimension hood door", "/cgi-bin/cybertown/neighbor?ID=0107050100000000"],
  ["Hi-Tek hood door", "http://cybertown.com/cgi-bin/cybertown/neighbor?ID=0104050600000000"],
  ["Daily News billboard", "javascript:loadInfo('/places/news/magazine/dailynews/index.html')"],
];

KEEP_SUPPRESSED.forEach(([name, url]) => {
  test(`${name} reaches no internal route`, () => {
    reachesNoRoute(url);
    reachesNoRoute(url, "_top");
    reachesNoRoute(url, "place");
  });
});

test("no suppressed address ever produces a route through a whole call", () => {
  KEEP_SUPPRESSED.forEach(([name, url]) => {
    const decision = classifyLegacyNavigation([url], ["target=_top"]);
    assert.strictEqual(decision.route, null, name);
  });
});

/**
 * OUTLANDS-2A moved one entry out of the list above. These four tests are what
 * replaced it: the entrance maps, and nothing else Outlands does.
 */
test("the Outlands team entrance now maps to the CTR entrance page", () => {
  ["http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game",
    "/cgi-bin/cybertown/place?plc=ne_game&ac=3D",
  ].forEach(url => {
    const decision = classifyLegacyDestination(url, "_top");
    assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE, url);
    assert.strictEqual(decision.route, "/place/outlands", url);
  });
});

test("the Outlands entrance route is a literal in the allow-list", () => {
  assert.ok(LEGACY_ROUTES.indexOf("/place/outlands") !== -1);
  const source = fs.readFileSync(HELPER, "utf8");
  assert.ok(source.indexOf("\"/place/outlands\"") !== -1, "the route must be a literal");
});

test("the game master beam page is still blocked - that is OUTLANDS-2C", () => {
  reachesNoRoute("http://www.cybertown.com/places/ne_game/html/gmbeam.html", "_top");
  reachesNoRoute("/places/ne_game/html/gmbeam.html", "_top");
  assert.strictEqual(LEGACY_ROUTES.indexOf("/place/club"), -1);
});

test("Outlands frame chrome still never maps", () => {
  ["menu", "action", "actionfs", "print", "sound"].forEach(ac => {
    reachesNoRoute(`/cgi-bin/cybertown/place?plc=ne_game&ac=${ac}`);
  });
});

test("every mismatched neighbourhood id in the shipped worlds is suppressed", () => {
  [
    "0107050100000000", "0107050300000000", "0107030700000000", "0107040500000000",
    "0107050500000000", "0107050700000000", "0107010100000000", "0107010300000000",
    "0107010700000000", "0107020500000000", "0107030100000000", "0107030300000000",
    "0104050600000000",
  ].forEach(id => {
    reachesNoRoute(`/cgi-bin/cybertown/neighbor?ID=${id}`);
  });
});

test("frame chrome actions never map, even for a mapped place", () => {
  ["menu", "action", "actionfs", "print", "sound"].forEach(ac => {
    reachesNoRoute(`/cgi-bin/cybertown/place?plc=funpark&ID=000000000000000a&ac=${ac}`);
  });
});

test("a frame chrome action on a colony never maps either", () => {
  reachesNoRoute("/cgi-bin/cybertown/community?ac=menu&ID=0101000000000000");
});

/* ------------------------------------------------------------------ *
 * 7b. OLD TOWN
 * ------------------------------------------------------------------ *
 * The Plaza Old Town door names a flat 1999 page, not a CGI signature, so the
 * signature rule cannot see it. Left alone it fell to PASS_THROUGH, and X_ITE
 * read its `target=place` and opened a second browser tab on an address the
 * modern site does not serve. It must be SUPPRESS_LEGACY: no route, no kept
 * address, therefore no call and no window.
 */
console.log("\n7b. Old Town");

test("the Old Town address is suppressed, not passed through", () => {
  const decision = classifyLegacyDestination("/index2.html");
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
});

test("the Old Town door is suppressed with its own historical target", () => {
  ["place", "_top", "_self", "CCpro", ""].forEach(target => {
    const decision = classifyLegacyDestination("/index2.html", target);
    assert.strictEqual(decision.action, SUPPRESS_LEGACY, `target=${target}`);
    assert.strictEqual(decision.route, null, `target=${target}`);
  });
});

test("the whole Old Town call keeps no address, so no window can open", () => {
  const decision = classifyLegacyNavigation(["/index2.html"], ["target=place"]);
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
  assert.deepStrictEqual(decision.keptUrls, []);
  assert.deepStrictEqual(decision.legacyUrls, ["/index2.html"]);
});

test("the Old Town suppression is exact, so near misses pass through", () => {
  [
    "/index2.htm",
    "/index2.html.bak",
    "/places/enter/html/index2.html",
    "index2.html",
    "/index2.html?x=1",
    "http://www.example.com/index2.html",
  ].forEach(url => {
    const decision = classifyLegacyDestination(url, "place");
    assert.strictEqual(decision.action, PASS_THROUGH, url);
  });
});

test("unrelated relative HTML and assets keep their present behaviour", () => {
  [
    "/index.html",
    "index.html",
    "../html/map.html",
    "/places/enter/html/map.html",
    "help.html",
    "../../enter/vrml/enter.wrl",
    "wallvista.png",
    "/assets/worlds/enter/vrml/enter.wrl",
    "textures/base.jpg",
  ].forEach(url => {
    const single = classifyLegacyDestination(url, "place");
    assert.strictEqual(single.action, PASS_THROUGH, url);
    assert.strictEqual(single.route, null, url);
    const whole = classifyLegacyNavigation([url], ["target=place"]);
    assert.strictEqual(whole.action, PASS_THROUGH, url);
    assert.deepStrictEqual(whole.keptUrls, [url], url);
  });
});

test("the exact-suppression table is narrow, frozen and produces no route", () => {
  assert.ok(Object.isFrozen(LEGACY_SUPPRESSED_ADDRESSES));
  const keys = Object.keys(LEGACY_SUPPRESSED_ADDRESSES);
  assert.deepStrictEqual(keys, ["/index2.html"], "only proven-dead flat pages belong here");
  keys.forEach(key => {
    assert.strictEqual(
      LEGACY_ROUTES.indexOf(LEGACY_SUPPRESSED_ADDRESSES[key]), -1,
      "a suppression reason must never be a route",
    );
  });
});

test("a prototype key cannot reach the exact-suppression table", () => {
  ["__proto__", "constructor", "toString", "hasOwnProperty"].forEach(key => {
    assert.strictEqual(classifyLegacyDestination(key, "place").action, PASS_THROUGH, key);
  });
});

test("the shipped Plaza world still carries the exact suppressed Old Town address", () => {
  ["enter/vrml/enter.wrl", "enter/vrml/enter_pre.wrl"].forEach(file => {
    const source = readAsset(WORLDS, file);
    assert.ok(
      source.indexOf("bxx_url_string \"/index2.html\"") !== -1,
      `${file} no longer holds the Old Town address the table matches`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 8. BOUNDARIES
 * ------------------------------------------------------------------ */
console.log("\n8. Boundaries");

test("an unknown legacy signature is suppressed, never guessed", () => {
  const decision = classifyLegacyNavigation(
    ["http://www.cybertown.com/cgi-bin/cybertown/place?plc=mothership&ac=3D"],
    ["target=_top"],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
  assert.deepStrictEqual(decision.keptUrls, []);
});

test("an unknown legacy CGI program is suppressed", () => {
  ["home", "club", "block", "edit", "print"].forEach(program => {
    reachesNoRoute(`/cgi-bin/cybertown/${program}?plc=funpark&ac=3D`);
  });
});

test("an unrelated URL passes through", () => {
  const decision = classifyLegacyNavigation(["https://example.com/"], []);
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.strictEqual(decision.route, null);
  assert.deepStrictEqual(decision.keptUrls, ["https://example.com/"]);
});

test("the 3Dfx sponsor banner still passes through", () => {
  const decision = classifyLegacyNavigation(["http://www.3dfx.com"], ["target=external"]);
  assert.strictEqual(decision.action, PASS_THROUGH);
});

test("a lookalike host never becomes an internal route", () => {
  [
    "http://notcybertown.com/cgi-bin/cybertown/place?plc=funpark&ac=3D",
    "http://cybertown.com.example.org/cgi-bin/cybertown/place?plc=funpark&ac=3D",
    "http://example.com/cgi-bin/cybertown/place?plc=funpark&ac=3D",
    "http://example.com/?next=http://www.cybertown.com/cgi-bin/cybertown/place?plc=cafe",
  ].forEach(url => {
    const decision = classifyLegacyDestination(url);
    assert.strictEqual(decision.action, PASS_THROUGH, url);
    assert.strictEqual(decision.route, null, url);
  });
});

test("userinfo cannot smuggle a legacy host past the boundary", () => {
  const decision = classifyLegacyDestination(
    "http://www.cybertown.com@example.com/cgi-bin/cybertown/place?plc=cafe&ac=3D",
  );
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.strictEqual(decision.route, null);
});

test("a prototype key in plc or ID yields no route", () => {
  [
    "/cgi-bin/cybertown/place?plc=constructor&ac=3D",
    "/cgi-bin/cybertown/place?plc=__proto__&ac=3D",
    "/cgi-bin/cybertown/place?plc=toString&ac=3D",
    "/cgi-bin/cybertown/place?plc=shop&ID=constructor&ac=index3d",
    "/cgi-bin/cybertown/community?ID=__proto__&ac=place",
  ].forEach(url => {
    const decision = classifyLegacyDestination(url);
    assert.strictEqual(decision.action, SUPPRESS_LEGACY, url);
    assert.strictEqual(decision.route, null, url);
  });
});

test("an empty or missing address changes nothing", () => {
  assert.strictEqual(classifyLegacyDestination("").action, PASS_THROUGH);
  assert.strictEqual(classifyLegacyDestination(null as unknown as string).action, PASS_THROUGH);
  const decision = classifyLegacyNavigation([], []);
  assert.strictEqual(decision.action, PASS_THROUGH);
  assert.deepStrictEqual(decision.keptUrls, []);
});

test("a mixed address list keeps its fallback entries and its route-free result", () => {
  const decision = classifyLegacyNavigation(
    ["http://www.cybertown.com/cgi-bin/cybertown/place?plc=library&ac=place", "backup.wrl"],
    ["target=_top"],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
  assert.deepStrictEqual(decision.keptUrls, ["backup.wrl"]);
});

test("the first mapped address in a list decides the whole call", () => {
  const decision = classifyLegacyNavigation(
    [
      "/cgi-bin/cybertown/place?plc=cafe&ac=3D",
      "/cgi-bin/cybertown/place?plc=pool&ac=3D",
    ],
    ["target=CCpro"],
  );
  assert.strictEqual(decision.route, "/place/cafe");
});

/* ------------------------------------------------------------------ *
 * 9. X_ITE FLOW
 * ------------------------------------------------------------------ *
 * A faithful stand-in for the three X_ITE 4.7.0 pieces that decide what a
 * FileLoader request does, plus the wrapper this lane installs on top. The
 * source-shape gates in part 11 keep the reproduction honest.
 */
console.log("\n9. X_ITE flow");

interface Trace {
  fetched: string[];
  windowOpened: Array<{ url: string; target: string }>;
  routed: string[];
  refused: string[];
}

function makeFileLoader(trace: Trace, withPolicy: boolean) {
  function getTarget(parameter: readonly string[]): string {
    for (let i = 0; i < parameter.length; i += 1) {
      const pair = String(parameter[i]).split("=");
      if (pair.length === 2 && pair[0] === "target") { return pair[1]; }
    }
    return "";
  }

  const loader = {
    target: "",
    foreign: null as null | Function,

    // X_ITE 4.7.0 FileLoader.createX3DFromURL
    original(
      url: readonly string[],
      parameter: readonly string[] | null,
      callback: Function,
      bindViewpoint?: unknown,
      foreign?: Function,
    ) {
      loader.foreign = foreign || null;
      loader.target = getTarget(parameter || []);
      const first = url.length ? String(url[0]) : "";
      // X_ITE 4.7.0 FileLoader.loadDocumentAsync, target branch
      if (loader.target.length && loader.target !== "_self" && loader.foreign) {
        loader.foreign(first, loader.target);
        return;
      }
      trace.fetched.push(first);
      callback(null);
    },

    // The LEGACY-LINKS-1 wrapper
    createX3DFromURL(
      url: readonly string[],
      parameter: readonly string[] | null,
      callback: Function,
      bindViewpoint?: unknown,
      foreign?: Function,
    ) {
      if (!withPolicy || typeof foreign !== "function") {
        return loader.original(url, parameter, callback, bindViewpoint, foreign);
      }
      const decision = classifyLegacyNavigation(
        readFieldStrings(url),
        readFieldStrings(parameter),
      );
      if (decision.action === PASS_THROUGH) {
        return loader.original(url, parameter, callback, bindViewpoint, foreign);
      }
      if (decision.action === MAP_TO_CTR_ROUTE) {
        // The navigator's own gate, reproduced.
        if (LEGACY_ROUTES.indexOf(decision.route as string) === -1) {
          trace.refused.push(String(decision.route));
        } else {
          trace.routed.push(decision.route as string);
        }
        return undefined;
      }
      if (decision.keptUrls.length === 0) { return undefined; }
      return loader.original(decision.keptUrls, parameter, callback, bindViewpoint, foreign);
    },
  };

  return loader;
}

function newTrace(): Trace {
  return { fetched: [], windowOpened: [], routed: [], refused: [] };
}

/** X_ITE's Anchor foreign callback: `target ? window.open : location = url`. */
function anchorForeign(trace: Trace) {
  return function (url: string, target: string) {
    trace.windowOpened.push({ url, target });
  };
}

test("OLD CODE: the Adventure Anchor fetches a dead address as a scene", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, false);
  loader.createX3DFromURL(
    ["http://www.cybertown.com/cgi-bin/cybertown/community?ID=0105000000000000"],
    [],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.strictEqual(trace.fetched.length, 1);
  assert.strictEqual(trace.routed.length, 0);
});

test("the Adventure Anchor now performs the CTR route action", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  loader.createX3DFromURL(
    ["http://www.cybertown.com/cgi-bin/cybertown/community?ID=0105000000000000"],
    [],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.deepStrictEqual(trace.routed, ["/place/inrlms_col"]);
  assert.deepStrictEqual(trace.fetched, []);
  assert.deepStrictEqual(trace.windowOpened, []);
  assert.deepStrictEqual(trace.refused, []);
});

test("the Flea Market booth Anchor routes and fetches nothing", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  loader.createX3DFromURL(
    ["/cgi-bin/cybertown/place?plc=blackmarket&ac=place&ID=0000000000000034&ac=3D&&IE=x.bxx"],
    [],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.deepStrictEqual(trace.routed, ["/place/blackmarket"]);
  assert.deepStrictEqual(trace.fetched, []);
});

test("the Plaza map sign Anchor routes instead of opening a pop-up", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  loader.createX3DFromURL(
    ["javascript:loadCustom('/places/enter/html/map.html',525,400)"],
    ["target=action"],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.deepStrictEqual(trace.routed, ["/citymap"]);
  assert.deepStrictEqual(trace.windowOpened, []);
});

test("a suppressed Anchor makes no request and opens no window", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  loader.createX3DFromURL(
    ["/cgi-bin/cybertown/neighbor?ID=0107050100000000"],
    [],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.deepStrictEqual(trace.routed, []);
  assert.deepStrictEqual(trace.fetched, []);
  assert.deepStrictEqual(trace.windowOpened, []);
});

test("the Bank exit Anchor no longer leaves the running host", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  loader.createX3DFromURL(
    ["https://www.cybertownrevival.com/#/place/enter"],
    ["target=_top"],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.deepStrictEqual(trace.routed, ["/place/enter"]);
  assert.deepStrictEqual(trace.windowOpened, []);
});

/* --- non-navigation regression: the hard gate ---------------------- */

const NON_NAVIGATION: Array<[string, string]> = [
  ["Theatre stage set", "/cgi-bin/cybertown/admin2/theatre/set.pl"],
  ["Theatre 3D banner", "/places/banners/3d/theatre_ban1.wrl"],
  ["City Hall dynamic content", "http://www.cybertown.com/cgi-bin/cybertown/testing/nchload.pl"],
  [
    "Entertainment colony map Inline",
    "/cgi-bin/colonycity/place?plc=ent_col&DTY=C&ID=0104000000000000&ac=print" +
      "&tpl=community/map_vrml",
  ],
  ["relative world asset", "../../enter/vrml/enter.wrl"],
  ["relative texture", "door.jpg"],
  ["local externproto", "/externprotos/hoodmap/hoodmap.wrl"],
  ["Plaza jump directory", "enter_dat.wrl"],
];

NON_NAVIGATION.forEach(([name, url]) => {
  test(`${name} still loads normally through FileLoader`, () => {
    const trace = newTrace();
    const loader = makeFileLoader(trace, true);
    // Inline and createVrmlFromURL: no parameter list and no foreign callback.
    loader.createX3DFromURL([url], null, () => undefined);
    assert.deepStrictEqual(trace.fetched, [url], name);
    assert.deepStrictEqual(trace.routed, [], name);
  });
});

test("a scene load is never even classified, whatever its address", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  [
    "http://www.cybertown.com/cgi-bin/cybertown/place?plc=funpark&ac=3D",
    "/cgi-bin/cybertown/community?ac=place&ID=0101000000000000",
  ].forEach(url => {
    loader.createX3DFromURL([url], null, () => undefined);
  });
  assert.strictEqual(trace.fetched.length, 2);
  assert.deepStrictEqual(trace.routed, []);
});

test("a pass-through navigation still reaches the original loader", () => {
  const trace = newTrace();
  const loader = makeFileLoader(trace, true);
  loader.createX3DFromURL(
    ["shared.wrl#SharedObject"],
    [],
    () => undefined,
    undefined,
    anchorForeign(trace),
  );
  assert.deepStrictEqual(trace.fetched, ["shared.wrl#SharedObject"]);
});

/* ------------------------------------------------------------------ *
 * 10. SHIPPED WORLDS
 * ------------------------------------------------------------------ */
console.log("\n10. Shipped worlds");

test("every Plaza Transporter destination classifies as the report proved", () => {
  const source = readAsset(WORLDS, "enter/vrml/enter.wrl");
  const expected: Record<string, string | null> = {
    funpark: "/place/funpark",
    fleamarket: "/place/fleamarket",
    cafe: "/place/cafe",
    stadium: "/place/stadium",
    post: "/place/postoffice",
    theatre: "/place/theatre",
    shopping: "/place/mall",
    employment: "/place/employment",
    cityhall: "/place/cityhall",
    pool: "/place/pool",
    library: null,
    ent_complex: null,
    club: null,
  };
  const found: Record<string, boolean> = {};
  // Anchored at the start of a line, so the three commented-out `UnusedA/B/C`
  // doors and the PROTO's documentation comment are not read as instances.
  const rx = /^bxx_url_string\s+"(\/cgi-bin\/cybertown\/place\?[^"]+)"/gm;
  let match = rx.exec(source);
  while (match) {
    const url = match[1];
    const slug = readLegacyQuery(url).plc;
    assert.ok(slug in expected, `unexpected Plaza door slug: ${slug}`);
    assert.strictEqual(routeOf(url), expected[slug], url);
    found[slug] = true;
    match = rx.exec(source);
  }
  Object.keys(expected).forEach(slug => {
    assert.ok(found[slug], `Plaza door not found in the world: ${slug}`);
  });
});

test("the three unused Plaza doors still have no destination at all", () => {
  const source = readAsset(WORLDS, "enter/vrml/enter.wrl");
  const commented = source.split("\n").filter(line => /^#bxx_url_string/.test(line));
  assert.strictEqual(commented.length, 3, "the unused doors are no longer commented out");
  // With no url the PROTO default is "", and the door fires only the
  // changeFrames companion call, which this lane suppresses.
  const decision = classifyLegacyNavigation(
    ["javascript:changeFrames(\"\",\"\")"],
    ["target=action"],
  );
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.strictEqual(decision.route, null);
});

test("the Plaza Old Town door is in the world and is suppressed", () => {
  const source = readAsset(WORLDS, "enter/vrml/enter.wrl");
  assert.ok(source.indexOf("bxx_url_string \"/index2.html\"") !== -1);
  assert.ok(source.indexOf("bxx_param_string \"target=place\"") !== -1);
  reachesNoRoute("/index2.html", "place");
  const decision = classifyLegacyNavigation(["/index2.html"], ["target=place"]);
  assert.strictEqual(decision.action, SUPPRESS_LEGACY);
  assert.deepStrictEqual(decision.keptUrls, []);
});

test("both Mall store door lists classify exactly as approved", () => {
  const source = readAsset(WORLDS, "shopping/vrml/shopping.wrl");
  const rx = /linkUrl\s*\[?\s*"([^"]*place\?ID=[^"]+)"/g;
  const seen: string[] = [];
  let match = rx.exec(source);
  while (match) {
    seen.push(match[1]);
    match = rx.exec(source);
  }
  assert.strictEqual(seen.length, 11, "expected 11 store doors in the Mall");
  let mapped = 0;
  seen.forEach(url => {
    const id = readLegacyQuery(url).ID;
    const route = routeOf(url);
    if (id === "0000000000000901" || id === "0000000000000916") {
      assert.strictEqual(route, null, `${id} must not map`);
    } else {
      assert.strictEqual(route, LEGACY_STORE_ROUTES[id], url);
      mapped += 1;
    }
  });
  assert.strictEqual(mapped, 9);
});

test("every colony hood-map kiosk address classifies as approved", () => {
  const kiosks: Array<[string, string, string]> = [
    ["games_col/vrml/games_col.wrl", "0101000000000000", "/place/games_col"],
    ["scifi_col/vrml/scifi_col.wrl", "0102000000000000", "/place/scifi_col"],
    ["vrtwrlds_col/vrml/vrtwrlds_col.wrl", "0103000000000000", "/place/vrtwrlds_col"],
    ["ent_col/vrml/ent_col.wrl", "0104000000000000", "/place/ent_col"],
    ["inrlms_col/vrml/inrlms_col.wrl", "0105000000000000", "/place/inrlms_col"],
    ["cyberhood/vrml/cyberhood.wrl", "0108000000000000", "/place/cyberhood"],
  ];
  kiosks.forEach(([file, id, route]) => {
    const source = readAsset(WORLDS, file);
    const rx = new RegExp(`"([^"]*community\\?ac=place&ID=${id}[^"]*)"`);
    const match = rx.exec(source);
    assert.ok(match, `kiosk address not found in ${file}`);
    assert.strictEqual(routeOf((match as RegExpExecArray)[1], "place"), route);
  });
});

test("the hood-map PROTO still targets the frame this lane ignores", () => {
  const source = readAsset(EXTERNPROTOS, "hoodmap/hoodmap.wrl");
  assert.ok(source.indexOf("new MFString('target=place')") !== -1);
});

test("the Adventure and Flea Market Anchor addresses are still in the worlds", () => {
  const adventure = readAsset(WORLDS, "ad_col/vrml/ad_col.wrl");
  const flea = readAsset(WORLDS, "fleamarket/vrml/fleamarket.wrl");
  const adventureRx = /"([^"]*community\?ID=0105000000000000[^"]*)"/.exec(adventure);
  const fleaRx = /"([^"]*place\?plc=blackmarket[^"]*)"/.exec(flea);
  assert.ok(adventureRx, "the Adventure Anchor address moved");
  assert.ok(fleaRx, "the Flea Market booth address moved");
  assert.strictEqual(routeOf((adventureRx as RegExpExecArray)[1]), "/place/inrlms_col");
  assert.strictEqual(routeOf((fleaRx as RegExpExecArray)[1]), "/place/blackmarket");
});

test("the Black Market and Cyberhood exit doors classify as approved", () => {
  const blackmarket = readAsset(WORLDS, "blackmarket/vrml/blackmarket.wrl");
  const cyberhood = readAsset(WORLDS, "cyberhood/vrml/cyberhood.wrl");
  const up = /^bxx_url_string\s+"([^"]*plc=cyberhood[^"]*)"/m.exec(blackmarket);
  const down = /^bxx_url_string\s+"([^"]*plc=blackmarket[^"]*)"/m.exec(cyberhood);
  assert.ok(up && down, "the Black Market exit doors moved");
  assert.strictEqual(routeOf((up as RegExpExecArray)[1]), "/place/cyberhood");
  assert.strictEqual(routeOf((down as RegExpExecArray)[1]), "/place/blackmarket");
});

test("the Cafe Plaza door parameters are still the ones this lane matches", () => {
  const source = readAsset(WORLDS, "cafe/vrml/cafe.wrl");
  assert.ok(source.indexOf("'../../enter/vrml/enter.wrl'") !== -1);
  assert.ok(
    source.indexOf("'scene=/cgi-bin/colonycity/place?plc=enter&ac=3D&IE=x.bxx'") !== -1,
    "the Cafe scene parameter moved",
  );
});

test("the Fun Park pool sign still has an empty parameter list", () => {
  const source = readAsset(WORLDS, "funpark/vrml/funpark.wrl");
  assert.ok(source.indexOf("loadUrl [ \"/#/place/pool\" ]") !== -1);
  assert.ok(source.indexOf("loadParam [ \"\" ]") !== -1);
});

test("the Bank exit door still hard-codes the production host", () => {
  const source = readAsset(WORLDS, "bank/vrml/bank.wrl");
  assert.ok(source.indexOf("https://www.cybertownrevival.com/#/place/enter") !== -1);
});

test("the Outlands team entrance in the shipped world reaches the entrance page", () => {
  // `ne_game.wrl:1159` is the world's own "you have no valid team avatar, go
  // back and pick one" branch. OUTLANDS-2A is what gave it somewhere to go.
  const source = readAsset(WORLDS, "ne_game/vrml/ne_game.wrl");
  const match = /'(http:\/\/www\.cybertown\.com[^']*place\?plc=ne_game)'/.exec(source);
  assert.ok(match, "the Outlands entrance address moved");
  const decision = classifyLegacyDestination((match as RegExpExecArray)[1], "_top");
  assert.strictEqual(decision.action, MAP_TO_CTR_ROUTE);
  assert.strictEqual(decision.route, "/place/outlands");
});

test("every neighbour Anchor in the shipped worlds reaches no route", () => {
  const worlds = ["9thdimension/vrml/9thdimension.wrl", "hitek_col/vrml/hi-tek.wrl"];
  let count = 0;
  worlds.forEach(file => {
    const source = readAsset(WORLDS, file);
    const rx = /"([^"]*neighbor\?ID=[0-9a-fA-F]{16}[^"]*)"/g;
    let match = rx.exec(source);
    while (match) {
      reachesNoRoute(match[1]);
      count += 1;
      match = rx.exec(source);
    }
  });
  assert.ok(count >= 13, `expected at least 13 neighbour Anchors, found ${count}`);
});

/* ------------------------------------------------------------------ *
 * 11. SAFETY GATES
 * ------------------------------------------------------------------ */
console.log("\n11. Safety gates");

test("SAFETY GATE: the destination helper reaches no browser or router API", () => {
  const source = code(fs.readFileSync(HELPER, "utf8"));
  ["window", "document", "location", "router", "$router", "X3D"].forEach(name => {
    assert.strictEqual(
      new RegExp(`\\b${name.replace("$", "\\$")}\\s*\\.`).test(source),
      false,
      `the pure helper must not touch ${name}`,
    );
  });
});

[["bxx_url.js", URL_BINDING], ["bxx_anchor.js", ANCHOR_BINDING]].forEach(([name, file]) => {
  test(`SAFETY GATE: ${name} never routes a world-supplied address`, () => {
    const source = code(fs.readFileSync(file, "utf8"));
    [/router\s*\.\s*push/, /\$router/, /location\s*\.\s*href\s*=/, /location\s*=/, /window\.open/]
      .forEach(pattern => {
        assert.strictEqual(pattern.test(source), false, `${name} must not use ${pattern}`);
      });
  });

  test(`SAFETY GATE: ${name} hands the navigator only the table's own route`, () => {
    const source = code(fs.readFileSync(file, "utf8"));
    assert.ok(
      /goToLegacyRoute\(decision\.route\)/.test(source),
      `${name} must pass the classifier's route and nothing else`,
    );
    assert.strictEqual(
      /goToLegacyRoute\((?!decision\.route\))/.test(source),
      false,
      `${name} must never call the navigator with anything else`,
    );
  });
});

test("SAFETY GATE: the anchor seam only acts on a navigation-capable request", () => {
  const source = code(fs.readFileSync(ANCHOR_BINDING, "utf8"));
  assert.ok(
    /typeof foreign !== "function"[\s\S]{0,200}originalCreateX3DFromURL\.apply\(this,\s*arguments\)/
      .test(source),
    "a request with no foreign callback must be forwarded before anything is classified",
  );
});

test("SAFETY GATE: both seams forward a pass-through call verbatim", () => {
  const url = fs.readFileSync(URL_BINDING, "utf8");
  const anchor = fs.readFileSync(ANCHOR_BINDING, "utf8");
  assert.ok(/PASS_THROUGH[\s\S]{0,200}originalLoadURL\.apply\(this,\s*arguments\)/.test(url));
  assert.ok(
    /PASS_THROUGH[\s\S]{0,200}originalCreateX3DFromURL\.apply\(this,\s*arguments\)/.test(anchor),
  );
});

test("SAFETY GATE: both seams stop dead when nothing survives suppression", () => {
  [URL_BINDING, ANCHOR_BINDING].forEach(file => {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(/keptUrls\.length === 0[\s\S]{0,300}return undefined;/.test(source), file);
  });
});

test("SAFETY GATE: the navigator refuses a route that is not in the table", () => {
  const source = code(fs.readFileSync(NAVIGATOR, "utf8"));
  assert.ok(
    /LEGACY_ROUTES\.indexOf\(route\) === -1/.test(source),
    "the navigator must check its argument against the fixed table",
  );
  assert.ok(/return false;/.test(source), "the navigator must refuse, not fall through");
});

test("SAFETY GATE: only the navigator holds a navigation API", () => {
  const dir = path.join(SPA_SRC, "libs/x_ite_mods");
  const navigating = fs.readdirSync(dir).filter((name: string) => {
    const source = code(fs.readFileSync(path.join(dir, name), "utf8"));
    return /router\s*\.\s*push/.test(source) || /location\s*\.\s*hash\s*=/.test(source);
  });
  assert.deepStrictEqual(navigating, ["bxx_route.js"]);
});

test("SAFETY GATE: no binding carries a copy of the mapping table", () => {
  const dir = path.join(SPA_SRC, "libs/x_ite_mods");
  fs.readdirSync(dir).forEach((name: string) => {
    const source = fs.readFileSync(path.join(dir, name), "utf8");
    assert.strictEqual(
      source.indexOf("/place/funpark"),
      -1,
      `${name} must not carry a second copy of the mapping table`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 12. WIRING
 * ------------------------------------------------------------------ */
console.log("\n12. Wiring");

test("both seams and the navigator are registered in App.vue", () => {
  const source = fs.readFileSync(APP, "utf8");
  const route = source.indexOf("x_ite_mods/bxx_route.js");
  const url = source.indexOf("x_ite_mods/bxx_url.js");
  const anchor = source.indexOf("x_ite_mods/bxx_anchor.js");
  const auth = source.indexOf("x_ite_mods/bxx_auth.js");
  const events = source.indexOf("x_ite_mods/bxx_events.js");
  assert.ok(route !== -1 && url !== -1 && anchor !== -1, "a module is not registered");
  assert.ok(route < url && route < anchor, "the navigator must be registered first");
  assert.ok(url > auth && url > events, "bxx_url.js must stay the outermost loadURL wrapper");
});

test("App.vue hands the live router to the navigator", () => {
  const source = fs.readFileSync(APP, "utf8");
  assert.ok(
    /bxx_route\.js"\)\.setRouter\(this\.\$router\)/.test(source),
    "the navigator must be given the real router instance",
  );
});

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
