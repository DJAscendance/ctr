/**
 * LEGACY-LINKS-1 - proven fixed-route restoration for historical Cybertown links.
 *
 * WHAT THIS SOLVES. OUTLANDS-1j taught the SPA to recognise a dead historical
 * address and refuse to navigate to it. That kept the session alive but left
 * every restored world's own doors inert: walking into the Plaza Fun Park door,
 * clicking a Mall store front or clicking a colony hood-map kiosk did nothing
 * useful. LEGACY-LINKS-0 recovered what each of those links meant, proved the
 * modern CTR destination for the uncontested ones, and left the contested ones
 * out. This module turns that evidence into a decision.
 *
 * THE EVIDENCE. Every table entry below comes from
 * `.reports/functional-restoration/2026-09-03-legacy-world-links/REPORT.md`,
 * which read the shipped worlds and the recovered 2001 CGI templates in
 * `Cybertown Backups/IVN11/136/services/http/80/`. No entry is a guess. A link
 * whose historical destination is known but whose CTR destination is not
 * proven is deliberately absent, and absence means suppression.
 *
 * THE SECURITY RULE, UNCHANGED FROM OUTLANDS-1j.
 *
 *   World-authored text may be MATCHED. It must never BE the destination.
 *
 * Every route this module can return is a literal string written in this file.
 * The lookups are `hasOwnProperty` guarded, so a world that says `plc=constructor`
 * or `plc=__proto__` gets no route rather than an inherited object member. No
 * route is ever built by concatenating world text. `LEGACY_ROUTES` lists every
 * value the tables can produce, so the navigation binding can refuse anything
 * else as a second, independent gate.
 *
 * THE THREE ACTIONS.
 *
 *   PASS_THROUGH      not a legacy Cybertown navigation - behave exactly as
 *                     X_ITE always did. This is the default and it is what
 *                     protects every ordinary asset, scene and external link.
 *   SUPPRESS_LEGACY   a proven-dead legacy destination with no approved CTR
 *                     equivalent - make no call at all.
 *   MAP_TO_CTR_ROUTE  a proven historical signature with a proven CTR
 *                     destination - perform a fixed SPA route action.
 *
 * WHAT IS DELIBERATELY NOT MAPPED, AND WHY.
 *
 *   Library            `place?plc=library` has a CTR place row, but
 *                      `assets/worlds/library/vrml/library.wrl` is not shipped.
 *                      Mapping it would route a resident into a world that
 *                      cannot load. Suppressed until the asset is restored.
 *   9th Dimension and  the `neighbor?ID=...` doors resolve to CTR hoods whose
 *   Hi-Tek hood doors  names disagree with the labels painted on the world art
 *                      ("Wild West" resolves to Medieval Times). The two data
 *                      generations must be reconciled first. Owner's decision.
 *   Outlands           `place?plc=ne_game` is MAPPED as of OUTLANDS-2A, which
 *                      built the team-avatar picker it was waiting for - see
 *                      `LEGACY_PLACE_ROUTES`. The game-master beam page
 *                      (`/places/ne_game/html/gmbeam.html`) is still not mapped:
 *                      it names a flat page outside `/cgi-bin/`, so it keeps
 *                      being suppressed, and its DMZ destination is OUTLANDS-2C.
 *   Avatar Boutique    CTR has an avatar chooser modal but no route to it.
 *   Old Town, E-Plex,  no CTR destination of any kind exists. Old Town is the
 *   Visitor Center     one of these that names a flat page rather than a CGI
 *                      signature, so it is suppressed by exact address - see
 *                      `LEGACY_SUPPRESSED_ADDRESSES`.
 *   Gallery, Grocery   the two Mall store doors whose places CTR never seeded.
 *
 * THE `ac` PARAMETER IS THE CHROME GATE. The historical CGI used one address
 * shape for two very different things: `ac=3D`, `ac=place` and `ac=index3d`
 * asked for a destination, while `ac=menu` and `ac=action` asked for a frame of
 * the 1999 frameset. CTR owns its own chrome, so only the three destination
 * actions may map; every other action is suppressed. This is why the Cafe's
 * `initialize()` call to `place?plc=cafe&ac=action` stays suppressed even
 * though `plc=cafe` is in the table.
 *
 * FRAME NAMES ARE NOT DESTINATIONS. `target=CCpro`, `target=place`,
 * `target=action` and `target=_top` all described where the 1999 frameset put
 * the reply. They are read for diagnostics only and never influence the route,
 * with one narrow documented exception: the Fun Park pool sign, whose modern
 * CTR link lost its `target` and so is fetched as a scene instead of followed.
 *
 * THIS MODULE IS PURE. No DOM, no X_ITE, no router, no side effects. The two
 * bindings that act on its decisions are `libs/x_ite_mods/bxx_url.js` (the
 * `Browser.loadURL` seam) and `libs/x_ite_mods/bxx_anchor.js` (the `FileLoader`
 * seam that `Anchor` reaches), and both perform the route action through the
 * single navigator in `libs/x_ite_mods/bxx_route.js`.
 */
import {
  PASS_THROUGH,
  SUPPRESS_LEGACY,
  isLegacyCybertownUrl,
  readScheme,
  readTarget,
} from "./legacy-url.helper";

export { PASS_THROUGH, SUPPRESS_LEGACY };

/** A proven historical signature with a proven fixed CTR destination. */
export const MAP_TO_CTR_ROUTE = "MAP_TO_CTR_ROUTE";

export type LegacyDestinationAction =
  typeof PASS_THROUGH | typeof SUPPRESS_LEGACY | typeof MAP_TO_CTR_ROUTE;

/** A read-only lookup table of historical key to fixed literal CTR route. */
export type LegacyRouteTable = Readonly<Record<string, string>>;

/**
 * The historical CGI namespace. A root-relative address is only ever legacy
 * inside it, and a legacy-host address is only ever a mapped program inside it.
 */
export const LEGACY_CGI_NAMESPACE = "/cgi-bin/";

/** The two historical CGI programs that carried a destination. */
export const LEGACY_PLACE_PROGRAM = "place";
export const LEGACY_COMMUNITY_PROGRAM = "community";

/**
 * The only `ac` values that asked the historical server for a destination,
 * lower case. `menu`, `action`, `actionfs`, `print` and `sound` are frame
 * chrome or a template render, and never map.
 */
export const LEGACY_DESTINATION_ACTIONS: readonly string[] =
  Object.freeze(["3d", "place", "index3d"]);

/**
 * Plaza `Transporter` doors, the Black Market and Cyberhood doors, and the Cafe
 * Plaza door, keyed by the historical `plc` slug.
 *
 * `enter` is here for the Cafe: its Plaza door names the destination in a
 * `scene=` parameter rather than in the address (see `readLegacyScene`).
 * `library` is deliberately absent - see the file header.
 *
 * `ne_game` is the Outlands, added by OUTLANDS-2A. Three separate historical
 * controls name it and all three now land on the entrance: the Plaza Jump Gate
 * option, the control-panel event button, and `ne_game.wrl:1159` - the world's
 * own "you have no valid team avatar, go back and pick one" branch. The route
 * is the same fixed literal string every other entry is, and the entrance is
 * what the resident meets there, not the world.
 */
export const LEGACY_PLACE_ROUTES: LegacyRouteTable = Object.freeze({
  blackmarket: "/place/blackmarket",
  cafe: "/place/cafe",
  cityhall: "/place/cityhall",
  cyberhood: "/place/cyberhood",
  employment: "/place/employment",
  enter: "/place/enter",
  fleamarket: "/place/fleamarket",
  funpark: "/place/funpark",
  ne_game: "/place/outlands",
  pool: "/place/pool",
  post: "/place/postoffice",
  shopping: "/place/mall",
  stadium: "/place/stadium",
  theatre: "/place/theatre",
});

/**
 * Mall `StoreFront` doors, keyed by the historical 16-hex store id used with
 * `plc=shop`. Gallery (`...0901`) and Grocery Store (`...0916`) are absent
 * because CTR seeds no place for either.
 */
export const LEGACY_STORE_ROUTES: LegacyRouteTable = Object.freeze({
  "0000000000000902": "/place/giftshop",
  "0000000000000903": "/place/applianceshop",
  "0000000000000904": "/place/furniturestore",
  "0000000000000905": "/place/carpetshop",
  "0000000000000906": "/place/gardenstore",
  "0000000000000907": "/place/electronicsstore",
  "0000000000000908": "/place/noveltystore",
  "0000000000000909": "/place/toystore",
  "0000000000000911": "/place/antiqueshop",
});

/**
 * Colony hood-map kiosks and the Adventure colony's cross-colony Anchor, keyed
 * by the historical 16-hex colony id used with the `community` program. The hex
 * ids match `api/db/seed/04-places.hoods.seed.ts` exactly.
 */
export const LEGACY_COLONY_ROUTES: LegacyRouteTable = Object.freeze({
  "0101000000000000": "/place/games_col",
  "0102000000000000": "/place/scifi_col",
  "0103000000000000": "/place/vrtwrlds_col",
  "0104000000000000": "/place/ent_col",
  "0105000000000000": "/place/inrlms_col",
  "0108000000000000": "/place/cyberhood",
});

/**
 * Addresses matched whole, because they are single proven actions rather than a
 * family of signatures.
 *
 *   1. The Plaza map sign. `enter/vrml/enter.wrl:7174` is an `Anchor` whose
 *      address is a 1999 pop-up call; `templates/common/loadinfo.tmpl` proves
 *      `loadCustom(u,w,h)` is `window.open(u,"info",...)`. The historical user
 *      action is "View a Map of the Plaza", and CTR's map is `/citymap`. This
 *      is the only `javascript:` address in the whole lane that maps. Nothing
 *      parses or executes the historical JavaScript - the string is compared
 *      for equality and then discarded.
 *
 *   2. The Bank exit door. `bank/vrml/bank.wrl:245` is CTR's own modernised
 *      link, but it hard-codes the production host, so on a local or beta host
 *      it leaves the site. Matched whole and turned into the same destination
 *      it already names, reached without leaving the running SPA.
 */
export const LEGACY_EXACT_ROUTES: LegacyRouteTable = Object.freeze({
  "https://www.cybertownrevival.com/#/place/enter": "/place/enter",
  "javascript:loadCustom('/places/enter/html/map.html',525,400)": "/citymap",
});

/**
 * The one modern CTR link whose parameter list lost its `target`.
 * `funpark/vrml/funpark.wrl:1830` is `loadParam [ "" ]`, so X_ITE's
 * `loadDocumentAsync` never reaches its foreign-navigation branch and instead
 * fetches `/#/place/pool` as a scene, receives `index.html` and fails to parse
 * it. Matched whole AND only when the target really is empty, so every other
 * already-working `/#/place/...` link in the shipped worlds - the Mall
 * Directory kiosk, the store exit doors, the Plaza jump gate - keeps its exact
 * present behaviour.
 */
export const LEGACY_UNTARGETED_ROUTES: LegacyRouteTable = Object.freeze({
  "/#/place/pool": "/place/pool",
});

/**
 * Proven-dead historical destinations that live OUTSIDE the `/cgi-bin/`
 * namespace, matched as whole addresses and nothing else.
 *
 * Everything else in this module recognises a legacy destination by its CGI
 * signature. A handful of historical doors did not use the CGI at all - they
 * named a flat page in the 1999 document root - so the signature rule cannot
 * see them and they fall through to `PASS_THROUGH`. That is wrong for a page
 * the modern site does not serve: X_ITE reads the door's `target=place`,
 * hands the address to `window.open(url, "place")` and the resident gets a
 * stray tab showing a 404 or the SPA shell.
 *
 * This table is deliberately a list of exact proven addresses, not a rule
 * about relative HTML. Ordinary relative pages, relative world files, textures
 * and every other local resource must keep their present behaviour, so nothing
 * is suppressed here unless LEGACY-LINKS-0 proved the destination dead.
 *
 *   `/index2.html`  the Plaza Old Town door, `enter/vrml/enter.wrl:794-812`
 *                   (`DEF OldTown Transporter`, `isPlace FALSE`,
 *                   `target=place`). LEGACY-LINKS-0 row 119 records it PROVEN
 *                   as the pre-2000 "Old Town" 2D site index, with no CTR
 *                   equivalent of any kind: the page is not served, and
 *                   `CityMapPage` paints "OLD TOWN" as a label only. The only
 *                   two occurrences in the whole shipped asset set are this
 *                   door and its `enter_pre.wrl` twin, so an exact match is
 *                   both narrow and complete.
 *
 * The values are reasons, not routes. Nothing here can produce a route, which
 * is why this table is absent from `LEGACY_ROUTES`.
 */
export const LEGACY_SUPPRESSED_ADDRESSES: LegacyRouteTable = Object.freeze({
  "/index2.html": "proven-dead historical page with no CTR equivalent",
});

/**
 * The obsolete frameset repaint that every historical `Transporter` door fires
 * beside its real destination. `templates/common/loadinfo.tmpl` proves it is
 * `parent.frames[0].location.href = menu; self.location.href = action;`. CTR
 * owns its chrome, so the call has no modern purpose - and because X_ITE hands
 * a `javascript:` address with a target straight to `window.open`, leaving it
 * alone opens a stray blank pop-up on every working door. It is dropped.
 */
export const LEGACY_FRAME_CALL_PREFIX = "javascript:changeFrames(";

/**
 * The parameter that carries a destination inside another address. Only the
 * Cafe's Plaza door uses it: `cafe/vrml/cafe.wrl:969-976` calls
 * `Browser.loadURL(["../../enter/vrml/enter.wrl"], ["target=_self",
 * "scene=/cgi-bin/colonycity/place?plc=enter&ac=3D&IE=x.bxx"])`. The historical
 * description on the same door is "Go to Plaza".
 */
export const LEGACY_SCENE_PARAMETER = "scene";

function ownValue(table: LegacyRouteTable, key: string): string | null {
  if (key === "") { return null; }
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

function tableValues(table: LegacyRouteTable): string[] {
  const keys = Object.keys(table);
  const values: string[] = [];
  for (let i = 0; i < keys.length; i += 1) { values.push(table[keys[i]]); }
  return values;
}

/**
 * Every route any table above can produce, sorted and de-duplicated. The
 * navigation binding checks a route against this list before acting, so a
 * future bug that leaked world text into a decision still cannot reach the
 * router. This is a second gate, not the first one.
 */
export const LEGACY_ROUTES: readonly string[] = Object.freeze(
  tableValues(LEGACY_PLACE_ROUTES)
    .concat(tableValues(LEGACY_STORE_ROUTES))
    .concat(tableValues(LEGACY_COLONY_ROUTES))
    .concat(tableValues(LEGACY_EXACT_ROUTES))
    .concat(tableValues(LEGACY_UNTARGETED_ROUTES))
    .filter((route, index, all) => all.indexOf(route) === index)
    .sort(),
);

/**
 * Read an MFString-like field, a plain string or nothing as a string array,
 * without changing the caller's object. `Browser.loadURL` is specified to take
 * MFStrings, but CTR's own callers pass a plain string parameter
 * (`WorldBrowserPage.vue` calls `loadURL(mfstring, "")`).
 */
export function readFieldStrings(value: unknown): string[] {
  if (value === null || value === undefined) { return []; }
  if (typeof value === "string") { return value === "" ? [] : [value]; }
  const indexed = value as { length?: number };
  if (typeof indexed.length === "number") {
    const out: string[] = [];
    for (let i = 0; i < indexed.length; i += 1) {
      out.push(String((value as Record<number, unknown>)[i]));
    }
    return out;
  }
  return [String(value)];
}

/**
 * The CGI program an address names: the last path segment, but only when the
 * path is inside the historical `/cgi-bin/` namespace. Returns an empty string
 * for anything else, which is what keeps `/avatars/avlib_1.html` and
 * `/places/ne_game/html/gmbeam.html` out of the mapping entirely.
 */
export function readLegacyProgram(url: string): string {
  const address = String(url).trim();
  const withoutFragment = address.split("#")[0];
  const path = withoutFragment.split("?")[0];
  if (path.indexOf(LEGACY_CGI_NAMESPACE) === -1) { return ""; }
  const segments = path.split("/");
  return segments[segments.length - 1];
}

/**
 * The query of an address as a null-prototype map. Keys and values are
 * percent-decoded when they can be; a malformed escape is kept verbatim rather
 * than throwing. Empty pairs are skipped, which matters because the Flea Market
 * booth address contains a stray `&&`. When a key repeats - that same address
 * carries `ac` twice - the first value wins, which is what the historical CGI
 * did.
 */
export function readLegacyQuery(url: string): Record<string, string> {
  const query: Record<string, string> = Object.create(null);
  const address = String(url).trim();
  const mark = address.indexOf("?");
  if (mark === -1) { return query; }

  const pairs = address.slice(mark + 1).split("#")[0].split("&");
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (pair === "") { continue; }
    const equals = pair.indexOf("=");
    const rawKey = equals === -1 ? pair : pair.slice(0, equals);
    const rawValue = equals === -1 ? "" : pair.slice(equals + 1);
    const key = decodeOrKeep(rawKey);
    if (key === "" || Object.prototype.hasOwnProperty.call(query, key)) { continue; }
    query[key] = decodeOrKeep(rawValue);
  }
  return query;
}

function decodeOrKeep(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch (error) {
    return text;
  }
}

/**
 * The value of one X_ITE parameter entry. X_ITE's own `getTarget` splits on
 * every `=` and skips anything that is not exactly two parts, which would drop
 * the Cafe's `scene=` entry because its value is itself a query string. This
 * reader splits at the FIRST `=` only, so it can see values that contain more.
 */
export function readLegacyParameter(parameters: readonly string[], name: string): string {
  for (let i = 0; i < parameters.length; i += 1) {
    const entry = String(parameters[i]);
    const equals = entry.indexOf("=");
    if (equals === -1) { continue; }
    if (entry.slice(0, equals) === name) { return entry.slice(equals + 1); }
  }
  return "";
}

export interface LegacyDestination {
  /** What the caller should do. */
  action: LegacyDestinationAction;
  /** The fixed literal CTR route, or `null` for every non-mapping action. */
  route: string | null;
  /** Why, for the console notice and for the tests. Never user input. */
  reason: string;
}

function decide(
  action: LegacyDestinationAction,
  route: string | null,
  reason: string,
): LegacyDestination {
  return { action, route, reason };
}

/**
 * Classify ONE address.
 *
 * `target` is only consulted for the single documented Fun Park case. Pass the
 * value X_ITE would have used, or leave it out.
 */
export function classifyLegacyDestination(url: string, target?: string): LegacyDestination {
  const address = url === null || url === undefined ? "" : String(url).trim();
  if (address === "") { return decide(PASS_THROUGH, null, "empty address"); }

  const exact = ownValue(LEGACY_EXACT_ROUTES, address);
  if (exact !== null) { return decide(MAP_TO_CTR_ROUTE, exact, "proven whole-address action"); }

  const dead = ownValue(LEGACY_SUPPRESSED_ADDRESSES, address);
  if (dead !== null) { return decide(SUPPRESS_LEGACY, null, dead); }

  if ((target === undefined || target === null ? "" : String(target)) === "") {
    const untargeted = ownValue(LEGACY_UNTARGETED_ROUTES, address);
    if (untargeted !== null) {
      return decide(MAP_TO_CTR_ROUTE, untargeted, "modern CTR link with no target");
    }
  }

  if (readScheme(address) === "javascript") {
    if (address.slice(0, LEGACY_FRAME_CALL_PREFIX.length) === LEGACY_FRAME_CALL_PREFIX) {
      return decide(SUPPRESS_LEGACY, null, "obsolete frameset repaint");
    }
    // Every other `javascript:` address keeps exactly its present behaviour.
    return decide(PASS_THROUGH, null, "javascript address with no proven mapping");
  }

  if (!isLegacyCybertownUrl(address)) {
    return decide(PASS_THROUGH, null, "not a legacy address");
  }

  const program = readLegacyProgram(address);
  if (program !== LEGACY_PLACE_PROGRAM && program !== LEGACY_COMMUNITY_PROGRAM) {
    return decide(SUPPRESS_LEGACY, null, "legacy address outside the mapped CGI programs");
  }

  const query = readLegacyQuery(address);
  const action = String(query.ac === undefined ? "" : query.ac).toLowerCase();
  if (action !== "" && LEGACY_DESTINATION_ACTIONS.indexOf(action) === -1) {
    return decide(SUPPRESS_LEGACY, null, "legacy frame chrome, not a destination");
  }

  const id = query.ID === undefined ? "" : query.ID;

  if (program === LEGACY_COMMUNITY_PROGRAM) {
    const colony = ownValue(LEGACY_COLONY_ROUTES, id);
    if (colony !== null) { return decide(MAP_TO_CTR_ROUTE, colony, "colony destination"); }
    return decide(SUPPRESS_LEGACY, null, "legacy colony with no approved CTR destination");
  }

  const slug = query.plc === undefined ? "" : query.plc;
  if (slug === "shop") {
    const store = ownValue(LEGACY_STORE_ROUTES, id);
    if (store !== null) { return decide(MAP_TO_CTR_ROUTE, store, "mall store door"); }
    return decide(SUPPRESS_LEGACY, null, "mall store with no approved CTR destination");
  }

  const place = ownValue(LEGACY_PLACE_ROUTES, slug);
  if (place !== null) { return decide(MAP_TO_CTR_ROUTE, place, "city place destination"); }
  return decide(SUPPRESS_LEGACY, null, "legacy place with no approved CTR destination");
}

/**
 * Classify the destination a `scene=` parameter carries, if any. Only a mapping
 * is reported; anything else leaves the outer call to be judged on its own
 * address, because the outer address is a perfectly ordinary relative world
 * file and must keep working when the inner one means nothing.
 */
export function classifyLegacyScene(parameters: readonly string[]): LegacyDestination {
  const scene = readLegacyParameter(parameters, LEGACY_SCENE_PARAMETER);
  if (scene === "") { return decide(PASS_THROUGH, null, "no scene parameter"); }
  const inner = classifyLegacyDestination(scene);
  if (inner.action === MAP_TO_CTR_ROUTE) {
    return decide(MAP_TO_CTR_ROUTE, inner.route, "scene parameter destination");
  }
  return decide(PASS_THROUGH, null, "scene parameter with no proven mapping");
}

export interface LegacyNavigationDecision {
  action: LegacyDestinationAction;
  /** The fixed literal CTR route for `MAP_TO_CTR_ROUTE`, otherwise `null`. */
  route: string | null;
  /** The addresses that survive suppression, in their original order. */
  keptUrls: string[];
  /** The addresses recognised as dead legacy destinations. */
  legacyUrls: string[];
  /** The `target=` value X_ITE would have used. Diagnostics only. */
  target: string;
  reason: string;
}

/**
 * Classify one whole navigation-capable call - `Browser.loadURL(url, parameter)`
 * or an `Anchor`'s `url` and `parameter`.
 *
 * A `Browser.loadURL` address list is a fallback list: X_ITE tries the first
 * address and moves to the next only on failure. So the first address that
 * carries a proven destination decides the whole call, and a mixed list that
 * carries no destination keeps its documented fallback behaviour minus the dead
 * entries.
 */
export function classifyLegacyNavigation(
  urls: readonly string[],
  parameters: readonly string[],
): LegacyNavigationDecision {
  const target = readTarget(parameters);

  for (let i = 0; i < urls.length; i += 1) {
    const single = classifyLegacyDestination(String(urls[i]), target);
    if (single.action === MAP_TO_CTR_ROUTE) {
      return {
        action: MAP_TO_CTR_ROUTE,
        route: single.route,
        keptUrls: [],
        legacyUrls: [],
        target,
        reason: single.reason,
      };
    }
  }

  const scene = classifyLegacyScene(parameters);
  if (scene.action === MAP_TO_CTR_ROUTE) {
    return {
      action: MAP_TO_CTR_ROUTE,
      route: scene.route,
      keptUrls: [],
      legacyUrls: [],
      target,
      reason: scene.reason,
    };
  }

  const keptUrls: string[] = [];
  const legacyUrls: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const address = String(urls[i]);
    const single = classifyLegacyDestination(address, target);
    if (single.action === SUPPRESS_LEGACY) {
      legacyUrls.push(address);
    } else {
      keptUrls.push(address);
    }
  }

  return {
    action: legacyUrls.length === 0 ? PASS_THROUGH : SUPPRESS_LEGACY,
    route: null,
    keptUrls,
    legacyUrls,
    target,
    reason: legacyUrls.length === 0 ? "no legacy destination" : "no approved CTR destination",
  };
}
