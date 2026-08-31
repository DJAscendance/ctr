/**
 * MAP-3 guard for the classic NEIGHBORHOOD map background selector.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner,
 * no @vue/test-utils, no DOM), so this suite does not mount components. Like
 * MAP-2's it is split in two:
 *
 *   1. BEHAVIOUR, exercised directly against `map-background.helper` with the
 *      "hood" place type, so the hood paths, the hood payload and the hood
 *      thumbnail size are tested rather than assumed to follow the block ones.
 *
 *   2. WIRING, asserted against the source of the page, the tools panel, the
 *      neighborhood map and the router. These catch the drifts this lane exists
 *      to prevent: a selector that saves to the wrong place kind, an
 *      authorization check keyed on anything but the route id, and a saved
 *      index that never reaches the rendered map.
 *
 * HISTORICAL ANCHORS. MAP-3 is a historically verified restoration, not an
 * extrapolation from MAP-2, and every constant asserted below is traceable:
 *
 *   - `colonycity/templates/neighbor/wizard/image.tmpl` - the form itself: the
 *     `IM2` radio group, `<b>Multimedia Wizard - <$ENM></b>`, "Choose a
 *     background image", `width=180 height=100`, "No images available!", and
 *     the `Ok` / `Cancel` submits.
 *   - `colonycity/templates/neighbor/wizard/info.tmpl` - the "background image"
 *     link that reaches it.
 *   - `colonycity/templates/neighbor/action_standard.tmpl:45` - the "Update"
 *     button that reaches THAT, inside `<!-- #ifdef variable="owneraccess" -->`.
 *   - the `neighbor` CGI binary - the `neigh_wizardimage` and
 *     `neigh_wizardimagesubmit` handlers, and the `Pimg2D` asset prefix.
 *   - the production `:80` access logs (10,800,831 requests, Oct-Nov 2008) -
 *     82 real hits on `neighbor?ac=wizardimage`, and one complete write on
 *     28/Oct/2008 in which hood `0105050100000000` rendered `Pimg2D002.gif` at
 *     12:08:43, its leader browsed indexes 000-026 at 12:09, POSTed at 12:17:39,
 *     and the map came back as `Pimg2D026.gif` at 12:17:41.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const SELECTOR = path.join(SPA_SRC, "components/PlaceMapBackgroundSelector.vue");
const HOOD_BACKGROUND_PAGE = path.join(
  SPA_SRC,
  "pages/neighborhood/NeighborhoodMapBackgroundPage.vue",
);
const HOOD_MAP_PAGE = path.join(SPA_SRC, "pages/neighborhood/NeighborhoodMapPage.vue");
const HOOD_TOOLS = path.join(SPA_SRC, "pages/neighborhood/NeighborhoodTools.vue");
const BLOCK_BACKGROUND_PAGE = path.join(
  SPA_SRC,
  "pages/block/BlockMapBackgroundPage.vue",
);
const ROUTES = path.join(SPA_SRC, "routes.ts");

import {
  HOOD_MAP_BACKGROUND_THUMBNAIL_HEIGHT,
  HOOD_MAP_BACKGROUND_THUMBNAIL_WIDTH,
  MAP_BACKGROUND_EMPTY_MESSAGE,
  MAP_BACKGROUND_FORBIDDEN_MESSAGE,
  MAP_BACKGROUND_PROMPT,
  MAP_BACKGROUND_READ_FAILED_MESSAGE,
  MAP_BACKGROUND_SAVED_MESSAGE,
  MAP_BACKGROUND_SAVE_FAILED_MESSAGE,
  MAP_BACKGROUND_SUBMIT_LABEL,
  MAP_BACKGROUND_THUMBNAIL_HEIGHT,
  MAP_BACKGROUND_THUMBNAIL_WIDTH,
  MapBackgroundOptionsResponse,
  MapBackgroundState,
  applyEditAuthority,
  applyLoaded,
  applyReadFailure,
  applySaveFailure,
  applySaveSuccess,
  beginSave,
  canSaveMapBackground,
  chooseIndex,
  hasNoMapBackgroundOptions,
  initialMapBackgroundState,
  mapBackgroundControlsDisabled,
  mapBackgroundOptionsPath,
  mapBackgroundSelectionPath,
  mapBackgroundSelectionPayload,
  mapBackgroundThumbnailSize,
} from "../src/helpers/map-background.helper";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

/**
 * The offset of `token`, having first PROVED that the token is present.
 *
 * `String.indexOf` returns -1 for a token that is not there, and -1 is smaller
 * than every real offset. A bare `a.indexOf(x) < a.indexOf(y)` therefore passes
 * when `x` has been deleted, which is the exact regression these ordering tests
 * exist to catch. Every position below goes through here instead.
 */
function at(haystack: string, token: string): number {
  const offset = haystack.indexOf(token);
  assert.notStrictEqual(offset, -1, `expected to find: ${token}`);
  return offset;
}

/** The text between two markers, proving both markers exist and are in order. */
function between(source: string, start: string, end: string): string {
  const from = at(source, start);
  const to = at(source, end);
  assert.ok(from < to, `expected ${start} before ${end}`);
  return source.slice(from, to);
}

const GRASS_HOOD = "/assets/img/map_themes/grass/hood/";

/**
 * Hood A. Modelled on the real 28/Oct/2008 neighborhood: stored index 2, and a
 * pool that reaches index 26.
 */
function hoodAResponse(
  overrides: Partial<MapBackgroundOptionsResponse> = {},
): MapBackgroundOptionsResponse {
  return {
    selectedIndex: 2,
    effectiveIndex: 2,
    effectiveUrl: `${GRASS_HOOD}Pimg2D002.gif`,
    options: [
      { index: 0, url: `${GRASS_HOOD}Pimg2D000.gif` },
      { index: 2, url: `${GRASS_HOOD}Pimg2D002.gif` },
      { index: 26, url: `${GRASS_HOOD}Pimg2D026.gif` },
    ],
    ...overrides,
  };
}

/**
 * Hood B, sharing no index with hood A, so "hood A's choice is gone" can be
 * asserted rather than assumed.
 */
function hoodBResponse(): MapBackgroundOptionsResponse {
  return {
    selectedIndex: null,
    effectiveIndex: 7,
    effectiveUrl: `${GRASS_HOOD}Pimg2D007.gif`,
    options: [
      { index: 7, url: `${GRASS_HOOD}Pimg2D007.gif` },
      { index: 8, url: `${GRASS_HOOD}Pimg2D008.gif` },
    ],
  };
}

/** A ready, authorized hood-A state. */
function readyHoodA(): MapBackgroundState {
  return applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), true),
    hoodAResponse(),
  );
}

// ------------------------------------------------------------ hood endpoints

test("the selector calls the MAP-1 hood endpoints", () => {
  assert.strictEqual(
    mapBackgroundOptionsPath("hood", 12),
    "/hood/12/map-background-options",
  );
  assert.strictEqual(
    mapBackgroundSelectionPath("hood", 12),
    "/hood/12/map-background-selection",
  );
});

test("the hood paths are never the block paths", () => {
  assert.notStrictEqual(
    mapBackgroundOptionsPath("hood", 12),
    mapBackgroundOptionsPath("block", 12),
  );
  assert.notStrictEqual(
    mapBackgroundSelectionPath("hood", 12),
    mapBackgroundSelectionPath("block", 12),
  );
});

test("a hood route id arriving as a string is used unchanged", () => {
  assert.strictEqual(
    mapBackgroundSelectionPath("hood", "0105"),
    "/hood/0105/map-background-selection",
  );
});

// ------------------------------------------------------------- read behaviour

test("the hood's stored selection is adopted from the server", () => {
  const state = readyHoodA();
  assert.strictEqual(state.status, "ready");
  assert.strictEqual(state.selectedIndex, 2);
  assert.strictEqual(state.effectiveIndex, 2);
  assert.strictEqual(state.effectiveUrl, `${GRASS_HOOD}Pimg2D002.gif`);
});

test("the hood's current choice starts highlighted", () => {
  assert.strictEqual(readyHoodA().pendingIndex, 2);
});

test("the hood option list is exactly what the server returned", () => {
  assert.deepStrictEqual(
    readyHoodA().options.map(option => option.index),
    [0, 2, 26],
  );
});

test("a sparse hood pool is not filled in by the client", () => {
  // The server offered 0, 2 and 26 with gaps. Nothing invents 1, or 3..25.
  const indexes = readyHoodA().options.map(option => option.index);
  assert.ok(indexes.indexOf(1) === -1);
  assert.ok(indexes.indexOf(25) === -1);
});

test("a hood that never chose a background uses the effective default", () => {
  const state = applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), true),
    hoodBResponse(),
  );
  assert.strictEqual(state.selectedIndex, null);
  assert.strictEqual(state.effectiveIndex, 7);
  assert.strictEqual(state.pendingIndex, 7);
});

test("a hood read failure gives a safe state with no options", () => {
  const state = applyReadFailure(readyHoodA());
  assert.strictEqual(state.status, "readFailed");
  assert.deepStrictEqual(state.options, []);
  assert.strictEqual(state.messageKind, "error");
  assert.strictEqual(canSaveMapBackground(state), false);
});

test("an empty hood option set gives the historical empty state", () => {
  const state = applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), true),
    hoodAResponse({ options: [] }),
  );
  assert.strictEqual(hasNoMapBackgroundOptions(state), true);
  assert.strictEqual(canSaveMapBackground(state), false);
});

// ------------------------------------------------------------ write behaviour

test("only an index the hood was offered can be chosen", () => {
  const state = readyHoodA();
  assert.strictEqual(chooseIndex(state, 25).pendingIndex, 2, "25 was not offered");
  assert.strictEqual(chooseIndex(state, 26).pendingIndex, 26);
});

test("choosing the hood's already-rendered index leaves nothing to save", () => {
  assert.strictEqual(canSaveMapBackground(chooseIndex(readyHoodA(), 2)), false);
});

test("the recorded 2 -> 26 change is savable and sends the integer index", () => {
  const chosen = chooseIndex(readyHoodA(), 26);
  assert.strictEqual(canSaveMapBackground(chosen), true);
  assert.deepStrictEqual(mapBackgroundSelectionPayload(chosen.pendingIndex), {
    index: 26,
  });
});

test("a hood save in flight disables every control", () => {
  const saving = beginSave(chooseIndex(readyHoodA(), 26));
  assert.strictEqual(saving.status, "saving");
  assert.strictEqual(mapBackgroundControlsDisabled(saving), true);
});

test("a hood save that is not allowed never enters the saving state", () => {
  const state = readyHoodA();
  assert.strictEqual(beginSave(state), state);
});

test("a successful hood save reports success and adopts the stored index", () => {
  const saved = applySaveSuccess(beginSave(chooseIndex(readyHoodA(), 26)), 26);
  assert.strictEqual(saved.status, "ready");
  assert.strictEqual(saved.selectedIndex, 26);
  assert.strictEqual(saved.message, MAP_BACKGROUND_SAVED_MESSAGE);
  assert.strictEqual(saved.messageKind, "success");
});

test("a failed hood save never reports success", () => {
  const failed = applySaveFailure(beginSave(chooseIndex(readyHoodA(), 26)), 500);
  assert.strictEqual(failed.status, "ready");
  assert.strictEqual(failed.messageKind, "error");
  assert.strictEqual(failed.selectedIndex, 2, "the stored value is untouched");
});

test("a refused hood save withdraws the editing control", () => {
  for (const status of [401, 403]) {
    const refused = applySaveFailure(beginSave(chooseIndex(readyHoodA(), 26)), status);
    assert.strictEqual(refused.status, "forbidden");
    assert.strictEqual(refused.canEdit, false);
    assert.strictEqual(refused.message, MAP_BACKGROUND_FORBIDDEN_MESSAGE);
    assert.strictEqual(canSaveMapBackground(refused), false);
  }
});

test("an ordinary member gets no active hood control", () => {
  const state = applyLoaded(initialMapBackgroundState(), hoodAResponse());
  assert.strictEqual(state.canEdit, false);
  assert.strictEqual(mapBackgroundControlsDisabled(state), true);
  assert.strictEqual(canSaveMapBackground(state), false);
  assert.strictEqual(chooseIndex(state, 26).pendingIndex, 2, "nothing can be chosen");
});

test("no hood user message leaks a path or a raw error", () => {
  const messages = [
    MAP_BACKGROUND_READ_FAILED_MESSAGE,
    MAP_BACKGROUND_SAVE_FAILED_MESSAGE,
    MAP_BACKGROUND_SAVED_MESSAGE,
    MAP_BACKGROUND_FORBIDDEN_MESSAGE,
  ];
  for (const message of messages) {
    assert.ok(message.indexOf("/hood/") === -1, message);
    assert.ok(message.indexOf("map-background") === -1, message);
  }
});

// --------------------------------------------------- route change (two hoods)

test("a hood route change starts the selector from a clean state", () => {
  const fresh = applyEditAuthority(initialMapBackgroundState(), true);
  assert.strictEqual(fresh.status, "loading");
  assert.deepStrictEqual(fresh.options, []);
  assert.strictEqual(fresh.message, "");
  assert.strictEqual(canSaveMapBackground(fresh), false);
});

test("after a hood route change only the new hood's options are offered", () => {
  const hoodB = applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), true),
    hoodBResponse(),
  );
  assert.deepStrictEqual(
    hoodB.options.map(option => option.index),
    [7, 8],
  );
  assert.strictEqual(hoodB.pendingIndex, 7);
});

test("a pending choice from the previous hood cannot be re-applied", () => {
  // Hood A's leader highlighted 26, then moved to hood B, which has no 26.
  const hoodB = applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), true),
    hoodBResponse(),
  );
  const attempted = chooseIndex(hoodB, 26);
  assert.strictEqual(attempted.pendingIndex, 7, "hood A's 26 is refused by hood B");
  assert.strictEqual(canSaveMapBackground(attempted), false);
});

test("a save after a hood route change targets the new hood and its own choice", () => {
  const hoodB = applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), true),
    hoodBResponse(),
  );
  const chosen = chooseIndex(hoodB, 8);
  assert.strictEqual(
    mapBackgroundSelectionPath("hood", "B"),
    "/hood/B/map-background-selection",
  );
  assert.deepStrictEqual(mapBackgroundSelectionPayload(chosen.pendingIndex), {
    index: 8,
  });
});

test("an unauthorized new hood offers no active control", () => {
  const hoodB = applyLoaded(
    applyEditAuthority(initialMapBackgroundState(), false),
    hoodBResponse(),
  );
  assert.strictEqual(mapBackgroundControlsDisabled(hoodB), true);
  assert.strictEqual(canSaveMapBackground(chooseIndex(hoodB, 8)), false);
});

// ------------------------------------------------------- classic fidelity

test("the historical hood thumbnail size is 180x100, not the block 160x80", () => {
  assert.strictEqual(HOOD_MAP_BACKGROUND_THUMBNAIL_WIDTH, 180);
  assert.strictEqual(HOOD_MAP_BACKGROUND_THUMBNAIL_HEIGHT, 100);
  assert.deepStrictEqual(mapBackgroundThumbnailSize("hood"), {
    width: 180,
    height: 100,
  });
});

test("the block thumbnail size is unchanged by MAP-3", () => {
  assert.strictEqual(MAP_BACKGROUND_THUMBNAIL_WIDTH, 160);
  assert.strictEqual(MAP_BACKGROUND_THUMBNAIL_HEIGHT, 80);
  assert.deepStrictEqual(mapBackgroundThumbnailSize("block"), {
    width: 160,
    height: 80,
  });
});

test("the labels shared with the neighbor template are preserved", () => {
  // neighbor/wizard/image.tmpl carries these verbatim.
  assert.strictEqual(MAP_BACKGROUND_PROMPT, "Choose a background image");
  assert.strictEqual(MAP_BACKGROUND_EMPTY_MESSAGE, "No images available!");
  assert.strictEqual(MAP_BACKGROUND_SUBMIT_LABEL, "Ok");
});

// -------------------------------------------------------------------- wiring

test("the selector sizes its thumbnails per place type", () => {
  const source = read(SELECTOR);
  assert.ok(
    source.includes("mapBackgroundThumbnailSize(this.placeKind)"),
    "the size follows the place type",
  );
  assert.ok(
    !source.includes("MAP_BACKGROUND_THUMBNAIL_WIDTH"),
    "no place type keeps a hard-coded size",
  );
});

test("the hood page passes the hood place type and route id to the selector", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(source.includes("place-type=\"hood\""), "it edits a hood");
  assert.ok(source.includes(":place-id=\"hoodId\""), "it edits the route's hood");
  assert.ok(source.includes(":key=\"hoodId\""), "the selector is keyed on the id");
  assert.ok(source.includes(":can-edit=\"canEdit\""));
});

test("the hood page checks authority against the route id", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(
    source.includes("return this.$route.params.id;"),
    "the id comes from the URL",
  );
  assert.ok(
    source.includes("`/hood/${hoodId}/can_admin`"),
    "authority is asked for that id",
  );
  assert.ok(
    !source.includes("$store.data.place"),
    "no store place is trusted for authority",
  );
  assert.ok(
    !source.includes("props:"),
    "no parent prop is trusted for authority",
  );
});

test("the hood page re-authorizes when the route hood id changes", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(source.includes("hoodId(): void"), "the id is watched");
  assert.ok(source.includes("this.authorize();"), "the watcher re-authorizes");
});

test("the hood page drops the previous hood's state before it asks again", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  const body = source.slice(at(source, "async authorize()"));
  const asked = at(body, "await this.checkAdmin(hoodId)");
  assert.ok(
    at(body, "this.hoodName = \"\";") < asked,
    "the old name is cleared before the new read",
  );
  assert.ok(
    at(body, "this.checked = false;") < asked,
    "the old choice is cleared before the new read",
  );
  assert.ok(
    at(body, "this.canEdit = false;") < asked,
    "the old authority is dropped before the new read",
  );
});

test("a stale hood reply cannot change the newer hood", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  const guards = source.split("if (this.hoodId !== hoodId) {").length - 1;
  assert.strictEqual(guards, 2, "both the authority and the name reply are guarded");
});

test("an unauthorized viewer is sent away rather than shown the step", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(source.includes("this.$router.push(\"/restricted\");"));
  assert.ok(source.includes("v-if=\"checked\""), "nothing renders before the check");
});

test("the hood heading is the historical wizard title", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(source.includes("const WIZARD_TITLE = \"Multimedia Wizard\";"));
  assert.ok(
    source.includes("`${WIZARD_TITLE} - ${this.hoodName}`"),
    "the name follows the title, as `Multimedia Wizard - <$ENM>` did",
  );
});

test("the hood name is read from the route hood, or omitted", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(source.includes("`/hood/${hoodId}`"));
  assert.ok(source.includes("response.data.hood.name"));
  assert.ok(source.includes("return \"\";"), "a failed name read shows no name");
});

test("the document title also follows the route, not a parent prop", () => {
  const source = read(HOOD_BACKGROUND_PAGE);
  assert.ok(source.includes("${hoodName} Background - Cybertown"));
  const body = source.slice(at(source, "async authorize()"));
  assert.ok(
    at(body, "document.title = \"Background - Cybertown\";") <
      at(body, "await this.checkAdmin(hoodId)"),
    "the previous hood's title is dropped before the new read",
  );
});

test("the neighborhood route exists and renders the neighborhood page", () => {
  const source = read(ROUTES);
  assert.ok(source.includes("name: \"neighborhoodmapbackground\""));
  assert.ok(source.includes("component: NeighborhoodMapBackgroundPage"));
  assert.ok(
    source.includes("NeighborhoodMapBackgroundPage from \"./pages/neighborhood/"),
    "the component is imported from the neighborhood pages",
  );
});

test("the neighborhood route lives under the neighborhood path", () => {
  const source = read(ROUTES);
  const hoodBlock = between(source, "path: \"/neighborhood/:id\"", "path: \"/block/:id\"");
  assert.ok(
    hoodBlock.includes("name: \"neighborhoodmapbackground\""),
    "the route is a child of /neighborhood/:id",
  );
  assert.ok(hoodBlock.includes("path: \"wizard/background\""));
});

test("the Update control reaches the restored step from the route id", () => {
  const source = read(HOOD_TOOLS);
  assert.ok(
    source.includes("name: 'neighborhoodmapbackground'"),
    "the link targets the named route, like its siblings in this panel",
  );
  assert.ok(
    source.includes("params: { id: $route.params.id }"),
    "the hood it opens is the id in the URL, not a parent-supplied prop",
  );
  assert.ok(
    !source.includes("'/wizard/background'"),
    "the hard-coded path string is gone, so a route path change cannot orphan it",
  );
  assert.ok(
    !source.includes("<span href=\"\" class=\"btn-ui\">Update</span>"),
    "the dead Update control is gone",
  );
  assert.ok(source.includes("canAdmin"), "it stays behind the admin check");
});

test("the named Update route is the one the router actually registers", () => {
  const tools = read(HOOD_TOOLS);
  const routes = read(ROUTES);
  const name = "neighborhoodmapbackground";
  assert.ok(tools.includes(`name: '${name}'`), "the panel names this route");
  assert.ok(routes.includes(`name: "${name}"`), "the router defines that same name");
  const hoodBlock = between(routes, "path: \"/neighborhood/:id\"", "path: \"/block/:id\"");
  assert.ok(hoodBlock.includes(`name: "${name}"`), "and it lives under /neighborhood/:id");
});

test("every touched neighborhood template line fits the lint limit", () => {
  const limit = 100;
  const tooLong = read(HOOD_TOOLS)
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(entry => entry.line.length > limit);
  assert.deepStrictEqual(
    tooLong.map(entry => `${entry.number}:${entry.line.length}`),
    [],
    "max-len is an error at 100 in spa/package.json, and this file is touched",
  );
});

test("the neighborhood map renders the server-resolved background", () => {
  const source = read(HOOD_MAP_PAGE);
  assert.ok(
    source.includes("mapBackgroundOptionsPath(\"hood\", hoodId)"),
    "the map asks MAP-1 for the hood's background",
  );
  assert.ok(
    source.includes("url('${this.effectiveUrl}')"),
    "it renders what the server resolved",
  );
});

test("the neighborhood map clears and reloads EVERYTHING on a route change", () => {
  const source = read(HOOD_MAP_PAGE);
  const watcher = source.slice(at(source, "\"$route.params.id\"()"));
  assert.ok(
    watcher.indexOf("this.loadRouteHood();") !== -1,
    "the watcher runs the one route-safe load, not a background-only reload",
  );

  const flow = between(source, "async loadRouteHood()", "async unloadPlace()");
  const dropped = at(flow, "this.clearRouteState();");
  assert.ok(
    dropped < at(flow, "this.getMapBackground(hoodId, loadId)"),
    "the old hood is dropped before the new background read",
  );
  assert.ok(
    dropped < at(flow, "await this.getPlace(hoodId, loadId)"),
    "the old hood is dropped before the new hood read",
  );

  const clear = between(
    source,
    "clearRouteState(): void",
    "getPlace(hoodId: string, loadId: number)",
  );
  for (const dropped of [
    "this.loaded = false;",
    "this.hood = undefined;",
    "this.colony = undefined;",
    "this.blocks = [];",
    "this.effectiveUrl = \"\";",
    "document.title = \"Cybertown\";",
  ]) {
    assert.ok(clear.includes(dropped), `the route change drops: ${dropped}`);
  }
});

test("a stale neighborhood map read cannot overwrite the newer hood", () => {
  const source = read(HOOD_MAP_PAGE);
  const guard = "if (!this.isCurrentLoad(hoodId, loadId)) {";

  const background = between(
    source,
    "getMapBackground(hoodId: string, loadId: number): void",
    "async joinPlace()",
  );
  assert.strictEqual(
    background.split(guard).length - 1,
    2,
    "the background read guards both its success and its failure path",
  );

  const place = between(
    source,
    "getPlace(hoodId: string, loadId: number)",
    "async loadRouteHood()",
  );
  assert.strictEqual(
    place.split(guard).length - 1,
    2,
    "the hood read guards both its success and its failure path",
  );

  const flow = between(source, "async loadRouteHood()", "async unloadPlace()");
  assert.ok(
    flow.includes("if (!this.isCurrentLoad(hoodId, loadId) || !this.hood || !this.colony) {"),
    "the map is only drawn when the route is still on the hood that answered",
  );
});

test("the guard weighs the load token as well as the hood id", () => {
  const source = read(HOOD_MAP_PAGE);
  const check = between(source, "isCurrentLoad(hoodId: string, loadId: number)", "clearRouteState");
  assert.ok(
    check.includes("this.$route.params.id === hoodId"),
    "it still rejects an answer for a hood the viewer has left",
  );
  assert.ok(
    check.includes("this.routeLoadId === loadId"),
    "and it also rejects an answer from a superseded load of the SAME hood",
  );

  const flow = between(source, "async loadRouteHood()", "async unloadPlace()");
  const minted = at(flow, "this.routeLoadId = loadId;");
  assert.ok(minted < at(flow, "await this.unloadPlace();"), "the token is minted before any await");
  assert.ok(minted < at(flow, "this.getMapBackground(hoodId, loadId)"));
  assert.ok(minted < at(flow, "await this.getPlace(hoodId, loadId)"));
});

test("MAP-3 leaves the block page alone", () => {
  const source = read(BLOCK_BACKGROUND_PAGE);
  assert.ok(source.includes("place-type=\"block\""));
  assert.ok(source.includes(":place-id=\"blockId\""));
  assert.ok(
    source.indexOf("hood") === -1 || source.includes("props: [\"block\", \"hood\", \"colony\"]"),
    "the block page gained no neighborhood behaviour",
  );
});

// ------------------------------------------- the public map, driven for real
//
// Everything above this point is either pure helper behaviour or an assertion
// about source text. The public neighborhood map's route handling cannot be
// checked either way: the defect it exists to prevent is a LIVE one, in which
// `mounted()` does not run again and one neighborhood's blocks survive into
// another's map.
//
// The SPA harness has no vue-loader and no DOM, so the page is not mounted.
// Its `<script>` block is instead compiled with the same TypeScript that builds
// this suite and evaluated with stubs in place of its imports. The methods and
// the watcher exercised below are therefore the shipped ones, not a copy.

const ts = require("typescript");

/** Compiled `<script>` bodies, keyed by file. Compiling once is enough. */
const compiled = new Map<string, string>();

function componentSource(file: string): string {
  const cached = compiled.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const source = read(file);
  const body = source.slice(
    source.indexOf(">", source.indexOf("<script")) + 1,
    source.indexOf("</script>"),
  );
  const stripped = body
    .replace(/^\s*import .*$/gm, "")
    .replace("export default Vue.extend(", "const __options = (");
  const js = ts.transpileModule(stripped, {
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS },
  }).outputText;
  compiled.set(file, js);
  return js;
}

/** The real component options, with its imports replaced by inert stubs. */
function componentOptions(file: string, doc: { title: string }): any {
  // eslint-disable-next-line no-new-func
  const make = new Function(
    "Chat",
    "colonyDataHelper",
    "mapBackgroundOptionsPath",
    "document",
    `${componentSource(file)}\nreturn __options;`,
  );
  return make(
    {},
    { games_col: { map_theme: "grass" } },
    (placeType: string, placeId: string) => `/${placeType}/${placeId}/map-background-options`,
    doc,
  );
}

/**
 * A promise whose settlement one test controls, so a reply can be held back
 * until after a route change and then delivered late.
 */
function deferred(): any {
  const slot: any = {};
  slot.promise = new Promise((resolve, reject) => {
    slot.resolve = resolve;
    slot.reject = reject;
  });
  // A late rejection is asserted on deliberately; nothing must crash the run.
  slot.promise.catch(() => undefined);
  return slot;
}

/** Lets pending promise callbacks run before the next assertion. */
const flush = (): Promise<void> =>
  new Promise(resolve => setImmediate(() => resolve()));

const HOOD_A_ID = "34";
const HOOD_B_ID = "35";

function hoodPayload(id: string, name: string): any {
  return {
    data: {
      hood: { id, name, slug: name.toLowerCase(), assets_dir: "", world_filename: "" },
      colony: { id: "1", name: "Games", slug: "games_col", assets_dir: "", world_filename: "" },
    },
  };
}

function blocksPayload(blocks: any[]): any {
  return { data: { blocks } };
}

const HOOD_A_BLOCKS = [{ id: "a1", name: "Alpha", location: 1 }];
const HOOD_B_BLOCKS = [{ id: "b1", name: "Bravo", location: 5 }];
const HOOD_A_BACKGROUND = `${GRASS_HOOD}Pimg2D002.gif`;
const HOOD_B_BACKGROUND = `${GRASS_HOOD}Pimg2D007.gif`;

/**
 * A `$http` double whose every reply is a promise the test controls.
 *
 * Requests are queued PER URL rather than kept one-deep. The same-hood race
 * needs two live requests for the identical URL - one from the superseded load
 * of hood A and one from the newer load of hood A - and a one-deep map would
 * silently drop the first, which is the very thing under test.
 */
function routeHttp() {
  const pending = new Map<string, any[]>();
  const queue = (url: string): any[] => {
    const existing = pending.get(url);
    if (existing) {
      return existing;
    }
    const fresh: any[] = [];
    pending.set(url, fresh);
    return fresh;
  };
  return {
    calls: [] as string[],
    get(url: string): Promise<any> {
      this.calls.push(url);
      const slot = deferred();
      queue(url).push(slot);
      return slot.promise;
    },
    /** How many requests for this url have not been answered yet. */
    outstanding(url: string): number {
      return queue(url).filter((slot: any) => !slot.answered).length;
    },
    /** The oldest or newest unanswered request for one url. */
    take(url: string, which: "oldest" | "newest"): any {
      const open = queue(url).filter((slot: any) => !slot.answered);
      assert.ok(open.length > 0, `nothing outstanding for ${url}`);
      const slot = which === "oldest" ? open[0] : open[open.length - 1];
      slot.answered = true;
      return slot;
    },
    settle(url: string, value: any): void {
      this.take(url, "oldest").resolve(value);
    },
    fail(url: string, error: unknown): void {
      this.take(url, "oldest").reject(error);
    },
    /** Answers the most recent request, leaving an older one still in flight. */
    settleNewest(url: string, value: any): void {
      this.take(url, "newest").resolve(value);
    },
    failNewest(url: string, error: unknown): void {
      this.take(url, "newest").reject(error);
    },
    asked(url: string): boolean {
      return this.calls.indexOf(url) !== -1;
    },
  };
}

/** The real methods and watcher, bound to a minimal stand-in instance. */
function mapPageVm(routeId: string) {
  const doc = { title: "" };
  const options = componentOptions(HOOD_MAP_PAGE, doc);
  const http = routeHttp();
  const vm: any = {
    ...options.data(),
    doc,
    http,
    joinedRooms: [] as string[],
    leftRooms: [] as string[],
    storePlace: undefined as any,
    $route: { params: { id: routeId } },
    $http: http,
    $store: {
      methods: {
        setPlace(place: any): void {
          vm.storePlace = place;
        },
      },
      data: { user: { token: "token" } },
    },
    $socket: {
      joinRoom(id: string): Promise<void> {
        vm.joinedRooms.push(id);
        return Promise.resolve();
      },
      leaveRoom(id: string): void {
        vm.leftRooms.push(id);
      },
    },
  };
  for (const key of Object.keys(options.methods)) {
    vm[key] = options.methods[key].bind(vm);
  }
  vm.mapBackground = options.computed.mapBackground.bind(vm);
  vm.routeChanged = options.watch["$route.params.id"].bind(vm);
  vm.goTo = (id: string): void => {
    vm.$route.params.id = id;
    vm.routeChanged();
  };
  return vm;
}

/** Answers every read one hood's load asks for, oldest request first. */
function settleHood(
  vm: any,
  id: string,
  name: string,
  blocks: any[],
  background: string,
): void {
  vm.http.settle(`/hood/${id}`, hoodPayload(id, name));
  vm.http.settle(`/hood/${id}/blocks`, blocksPayload(blocks));
  vm.http.settle(`/hood/${id}/map-background-options`, { data: { effectiveUrl: background } });
}

/** Answers the NEWEST load of one hood, leaving an older one still in flight. */
function settleNewestHood(
  vm: any,
  id: string,
  name: string,
  blocks: any[],
  background: string,
): void {
  vm.http.settleNewest(`/hood/${id}`, hoodPayload(id, name));
  vm.http.settleNewest(`/hood/${id}/blocks`, blocksPayload(blocks));
  vm.http.settleNewest(
    `/hood/${id}/map-background-options`,
    { data: { effectiveUrl: background } },
  );
}

/** Two distinguishable snapshots of the SAME hood, an older and a newer one. */
const HOOD_A_OLD_BLOCKS = [{ id: "a1", name: "Alpha", location: 1 }];
const HOOD_A_NEW_BLOCKS = [
  { id: "a2", name: "Alpha renamed", location: 1 },
  { id: "a3", name: "Annex", location: 4 },
];
const HOOD_A_OLD_BACKGROUND = `${GRASS_HOOD}Pimg2D002.gif`;
const HOOD_A_NEW_BACKGROUND = `${GRASS_HOOD}Pimg2D026.gif`;

/**
 * Drives A -> B -> A and leaves BOTH hood-A loads in flight, with the newer one
 * already answered. Hood B is deliberately left unanswered: the token must hold
 * even when the intermediate hood never arrives.
 */
async function racedBackToHoodA(): Promise<any> {
  const vm = mapPageVm(HOOD_A_ID);
  vm.loadRouteHood();
  await flush();
  assert.strictEqual(vm.http.outstanding(`/hood/${HOOD_A_ID}`), 1, "the first A load is out");

  vm.goTo(HOOD_B_ID);
  await flush();
  vm.goTo(HOOD_A_ID);
  await flush();
  assert.strictEqual(
    vm.http.outstanding(`/hood/${HOOD_A_ID}`),
    2,
    "both A loads are in flight at once",
  );

  settleNewestHood(vm, HOOD_A_ID, "Shadows now", HOOD_A_NEW_BLOCKS, HOOD_A_NEW_BACKGROUND);
  await flush();
  assert.strictEqual(vm.loaded, true, "the newer A load drew the map");
  assert.deepStrictEqual(vm.blocks, HOOD_A_NEW_BLOCKS);
  return vm;
}

/** A page sitting on a fully loaded hood A. */
async function loadedOnHoodA(): Promise<any> {
  const vm = mapPageVm(HOOD_A_ID);
  vm.loadRouteHood();
  await flush();
  settleHood(vm, HOOD_A_ID, "Shadows", HOOD_A_BLOCKS, HOOD_A_BACKGROUND);
  await flush();
  assert.strictEqual(vm.loaded, true, "hood A finished loading");
  return vm;
}

test("the public map loads the routed hood, its blocks, title and background", async () => {
  const vm = await loadedOnHoodA();
  assert.strictEqual(vm.hood.id, HOOD_A_ID);
  assert.strictEqual(vm.colony.slug, "games_col");
  assert.deepStrictEqual(vm.blocks, HOOD_A_BLOCKS);
  assert.strictEqual(vm.doc.title, "Shadows - Cybertown");
  assert.strictEqual(vm.effectiveUrl, HOOD_A_BACKGROUND);
  assert.strictEqual(vm.mapBackground(), `url('${HOOD_A_BACKGROUND}')`);
});

test("a hood route change replaces the previous hood's blocks", async () => {
  const vm = await loadedOnHoodA();
  vm.goTo(HOOD_B_ID);
  await flush();
  settleHood(vm, HOOD_B_ID, "Springs", HOOD_B_BLOCKS, HOOD_B_BACKGROUND);
  await flush();
  assert.strictEqual(vm.hood.id, HOOD_B_ID, "the hood is the routed one");
  assert.deepStrictEqual(vm.blocks, HOOD_B_BLOCKS, "only hood B's blocks remain");
  assert.strictEqual(
    vm.blocks.some((block: any) => block.id === "a1"),
    false,
    "no hood A block survived",
  );
  assert.strictEqual(vm.doc.title, "Springs - Cybertown", "the title names hood B");
  assert.strictEqual(vm.effectiveUrl, HOOD_B_BACKGROUND, "the background is hood B's");
});

test("the previous hood's data is dropped before the new hood answers", async () => {
  const vm = await loadedOnHoodA();
  vm.goTo(HOOD_B_ID);
  await flush();
  assert.strictEqual(vm.loaded, false, "the map is not drawn from mixed data");
  assert.deepStrictEqual(vm.blocks, [], "hood A's blocks are gone at once");
  assert.strictEqual(vm.hood, undefined, "hood A is gone at once");
  assert.strictEqual(vm.colony, undefined, "hood A's colony is gone at once");
  assert.strictEqual(vm.effectiveUrl, "", "hood A's background is gone at once");
  assert.strictEqual(vm.doc.title, "Cybertown", "the title no longer names hood A");
  assert.ok(vm.http.asked(`/hood/${HOOD_B_ID}/blocks`), "hood B's blocks were asked for");
});

test("the route change works in the other direction too", async () => {
  const vm = await loadedOnHoodA();
  vm.goTo(HOOD_B_ID);
  await flush();
  settleHood(vm, HOOD_B_ID, "Springs", HOOD_B_BLOCKS, HOOD_B_BACKGROUND);
  await flush();

  vm.goTo(HOOD_A_ID);
  await flush();
  assert.deepStrictEqual(vm.blocks, [], "hood B's blocks are dropped on the way back");
  settleHood(vm, HOOD_A_ID, "Shadows", HOOD_A_BLOCKS, HOOD_A_BACKGROUND);
  await flush();
  assert.strictEqual(vm.hood.id, HOOD_A_ID);
  assert.deepStrictEqual(vm.blocks, HOOD_A_BLOCKS);
  assert.strictEqual(vm.doc.title, "Shadows - Cybertown");
  assert.strictEqual(vm.effectiveUrl, HOOD_A_BACKGROUND);
});

test("a late reply for the previous hood cannot overwrite the current one", async () => {
  const vm = mapPageVm(HOOD_A_ID);
  vm.loadRouteHood();
  await flush();

  // The viewer leaves before hood A has answered anything.
  vm.goTo(HOOD_B_ID);
  await flush();
  settleHood(vm, HOOD_B_ID, "Springs", HOOD_B_BLOCKS, HOOD_B_BACKGROUND);
  await flush();
  assert.strictEqual(vm.hood.id, HOOD_B_ID, "hood B is on screen");

  // Hood A's answers arrive last. They belong to a route nobody is on.
  settleHood(vm, HOOD_A_ID, "Shadows", HOOD_A_BLOCKS, HOOD_A_BACKGROUND);
  await flush();
  assert.strictEqual(vm.hood.id, HOOD_B_ID, "the stale reply did not replace the hood");
  assert.deepStrictEqual(vm.blocks, HOOD_B_BLOCKS, "the stale reply did not replace the blocks");
  assert.strictEqual(vm.doc.title, "Springs - Cybertown", "the stale reply did not retitle");
  assert.strictEqual(vm.effectiveUrl, HOOD_B_BACKGROUND, "the stale reply did not repaint");
});

test("a late failure for the previous hood cannot clear the current one", async () => {
  const vm = mapPageVm(HOOD_A_ID);
  vm.loadRouteHood();
  await flush();

  vm.goTo(HOOD_B_ID);
  await flush();
  settleHood(vm, HOOD_B_ID, "Springs", HOOD_B_BLOCKS, HOOD_B_BACKGROUND);
  await flush();

  vm.http.fail(`/hood/${HOOD_A_ID}`, new Error("too late"));
  vm.http.fail(`/hood/${HOOD_A_ID}/map-background-options`, new Error("too late"));
  await flush();
  assert.strictEqual(vm.loaded, true, "hood B is still drawn");
  assert.strictEqual(vm.hood.id, HOOD_B_ID, "hood B survived the stale failure");
  assert.deepStrictEqual(vm.blocks, HOOD_B_BLOCKS, "hood B's blocks survived");
  assert.strictEqual(vm.doc.title, "Springs - Cybertown", "hood B's title survived");
  assert.strictEqual(vm.effectiveUrl, HOOD_B_BACKGROUND, "hood B's background survived");
});

test("a failed hood read never shows the previous hood's blocks as the new one's", async () => {
  const vm = await loadedOnHoodA();
  vm.goTo(HOOD_B_ID);
  await flush();
  vm.http.fail(`/hood/${HOOD_B_ID}`, new Error("read failed"));
  vm.http.settle(`/hood/${HOOD_B_ID}/blocks`, blocksPayload(HOOD_B_BLOCKS));
  await flush();
  assert.strictEqual(vm.loaded, false, "the map is not drawn at all");
  assert.deepStrictEqual(vm.blocks, [], "hood A's blocks are not reused");
  assert.strictEqual(vm.hood, undefined, "no hood is claimed");
  assert.strictEqual(vm.doc.title, "Cybertown", "the title names no hood");
});

test("a failed background read falls back instead of keeping the old image", async () => {
  const vm = await loadedOnHoodA();
  vm.goTo(HOOD_B_ID);
  await flush();
  vm.http.fail(`/hood/${HOOD_B_ID}/map-background-options`, new Error("read failed"));
  vm.http.settle(`/hood/${HOOD_B_ID}`, hoodPayload(HOOD_B_ID, "Springs"));
  vm.http.settle(`/hood/${HOOD_B_ID}/blocks`, blocksPayload(HOOD_B_BLOCKS));
  await flush();
  assert.strictEqual(vm.effectiveUrl, "", "hood A's resolved image is not kept");
  assert.strictEqual(
    vm.mapBackground(),
    `url('${GRASS_HOOD}Pimg2D000.gif')`,
    "the colony default covers the failed read",
  );
});

test("a hood route change leaves the old socket room and joins the new one", async () => {
  const vm = await loadedOnHoodA();
  assert.deepStrictEqual(vm.joinedRooms, [HOOD_A_ID]);
  vm.goTo(HOOD_B_ID);
  await flush();
  assert.deepStrictEqual(vm.leftRooms, [HOOD_A_ID], "hood A's room is left");
  settleHood(vm, HOOD_B_ID, "Springs", HOOD_B_BLOCKS, HOOD_B_BACKGROUND);
  await flush();
  assert.deepStrictEqual(vm.joinedRooms, [HOOD_A_ID, HOOD_B_ID], "hood B's room is joined");
});

test("the store never holds one hood beside another hood's map", async () => {
  const vm = await loadedOnHoodA();
  assert.strictEqual(vm.storePlace.id, HOOD_A_ID);
  vm.goTo(HOOD_B_ID);
  await flush();
  settleHood(vm, HOOD_B_ID, "Springs", HOOD_B_BLOCKS, HOOD_B_BACKGROUND);
  await flush();
  assert.strictEqual(vm.storePlace.id, HOOD_B_ID, "the store follows the route");
  assert.strictEqual(vm.storePlace.hood.id, vm.hood.id, "the store and the map agree");
});

// --------------------------------------------- superseded loads of ONE hood
//
// The hood id alone cannot separate two loads of the SAME hood. On A -> B -> A
// the first A request finds "A" in the URL again when it finally answers, so an
// id-only guard adopts it over the newer A load, or - on its failure path -
// clears what that newer load already drew. The load token is what makes the
// older load inert.

test("a superseded load of the same hood cannot overwrite the newer one", async () => {
  const vm = await racedBackToHoodA();

  // The FIRST hood-A load now answers, last, with an older snapshot.
  settleHood(vm, HOOD_A_ID, "Shadows then", HOOD_A_OLD_BLOCKS, HOOD_A_OLD_BACKGROUND);
  await flush();

  assert.strictEqual(vm.loaded, true, "the map is still drawn");
  assert.strictEqual(vm.hood.name, "Shadows now", "the newer name survived");
  assert.deepStrictEqual(vm.blocks, HOOD_A_NEW_BLOCKS, "the newer blocks survived");
  assert.strictEqual(
    vm.blocks.some((block: any) => block.id === "a1"),
    false,
    "no block from the superseded load appeared",
  );
  assert.strictEqual(vm.doc.title, "Shadows now - Cybertown", "the newer title survived");
  assert.strictEqual(vm.effectiveUrl, HOOD_A_NEW_BACKGROUND, "the newer background survived");
});

test("a superseded load of the same hood cannot clear the newer one when it fails", async () => {
  const vm = await racedBackToHoodA();

  // The FIRST hood-A load now FAILS, last. Its failure path clears the page,
  // so without the token it would empty a correctly loaded hood A.
  vm.http.fail(`/hood/${HOOD_A_ID}`, new Error("too late"));
  vm.http.fail(`/hood/${HOOD_A_ID}/map-background-options`, new Error("too late"));
  await flush();

  assert.strictEqual(vm.loaded, true, "the map stayed drawn");
  assert.strictEqual(vm.hood.name, "Shadows now", "the hood was not cleared");
  assert.ok(vm.colony, "the colony was not cleared");
  assert.deepStrictEqual(vm.blocks, HOOD_A_NEW_BLOCKS, "the blocks were not cleared");
  assert.strictEqual(vm.doc.title, "Shadows now - Cybertown", "the title was not cleared");
  assert.strictEqual(vm.effectiveUrl, HOOD_A_NEW_BACKGROUND, "the background was not cleared");
});

test("a superseded background reply cannot repaint the newer load", async () => {
  const vm = await racedBackToHoodA();
  vm.http.settle(
    `/hood/${HOOD_A_ID}/map-background-options`,
    { data: { effectiveUrl: HOOD_A_OLD_BACKGROUND } },
  );
  await flush();
  assert.strictEqual(vm.effectiveUrl, HOOD_A_NEW_BACKGROUND, "the newer background held");
  assert.strictEqual(
    vm.mapBackground(),
    `url('${HOOD_A_NEW_BACKGROUND}')`,
    "and it is what the map draws",
  );
});

test("a superseded background failure cannot blank the newer load", async () => {
  const vm = await racedBackToHoodA();
  vm.http.fail(`/hood/${HOOD_A_ID}/map-background-options`, new Error("too late"));
  await flush();
  assert.strictEqual(vm.effectiveUrl, HOOD_A_NEW_BACKGROUND, "it was not reset to the default");
});

test("a superseded load never joins a socket room behind the newer one", async () => {
  const vm = await racedBackToHoodA();
  assert.deepStrictEqual(
    vm.joinedRooms,
    [HOOD_A_ID],
    "only the load that owns the page joined",
  );
  settleHood(vm, HOOD_A_ID, "Shadows then", HOOD_A_OLD_BLOCKS, HOOD_A_OLD_BACKGROUND);
  await flush();
  assert.deepStrictEqual(
    vm.joinedRooms,
    [HOOD_A_ID],
    "the superseded load answering last joined nothing",
  );
});

// ------------------------------------------------- the guards guard themselves
//
// `at` and `between` exist so that a deleted token fails an ordering test
// instead of quietly satisfying it. That is only true if they really throw, so
// they are exercised directly here.

test("a missing token fails instead of reporting offset -1", () => {
  assert.throws(() => at("alpha beta", "gamma"), /expected to find: gamma/);
  assert.strictEqual(at("alpha beta", "beta"), 6, "a present token still reports its offset");
});

test("an order assertion cannot pass because the first token vanished", () => {
  const good = "clear();\nread();";
  const dropped = "read();";
  assert.ok(at(good, "clear();") < at(good, "read();"), "the real order still passes");
  assert.throws(() => at(dropped, "clear();") < at(dropped, "read();"), /expected to find/);
  assert.ok(
    dropped.indexOf("clear();") < dropped.indexOf("read();"),
    "the OLD bare-indexOf form would have passed on this same input",
  );
});

test("a region cannot be sliced from a marker that is not there", () => {
  const source = "start\nmiddle\nend";
  assert.strictEqual(between(source, "start", "end"), "start\nmiddle\n");
  assert.throws(() => between(source, "start", "nowhere"), /expected to find: nowhere/);
  assert.throws(() => between(source, "nowhere", "end"), /expected to find: nowhere/);
  assert.throws(() => between(source, "end", "start"), /expected end before start/);
});

// --------------------------------------------------------------------- runner

void (async (): Promise<void> => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.run();
      console.log(`  ok  ${item.name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL  ${item.name}`);
      console.error(`        ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
})();
