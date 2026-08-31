/**
 * MAP-2 guard for the classic block map background selector.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner,
 * no @vue/test-utils, no DOM), so this suite does not mount components. It is
 * split in two:
 *
 *   1. BEHAVIOUR, exercised directly against `map-background.helper`. The
 *      selector's component is a thin view over that module, so the real
 *      decisions - what may be chosen, what may be saved, what a failure does -
 *      are tested here rather than approximated through rendered markup.
 *
 *   2. WIRING, asserted against the source of the component, the page and the
 *      router. These catch the two drifts this lane exists to prevent: a
 *      client-side option list that stops matching the server, and an
 *      authorization check keyed on a stale parent prop.
 *
 * Historical anchors checked here come from
 * `colonycity/templates/block/wizard/image.tmpl` (the 160x80 thumbnail, the
 * "Choose a background image" prompt, the "No images available!" empty state,
 * the `IM2` radio group and the "Ok" submit) and from
 * `admin/templates/admin/block_map.tmpl` (the `Map Index: <n>` label).
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const SELECTOR = path.join(SPA_SRC, "components/PlaceMapBackgroundSelector.vue");
const BACKGROUND_PAGE = path.join(SPA_SRC, "pages/block/BlockMapBackgroundPage.vue");
const BLOCK_MAP_PAGE = path.join(SPA_SRC, "pages/block/BlockMapPage.vue");
const BLOCK_WIZARD_PAGE = path.join(SPA_SRC, "pages/block/BlockWizardPage.vue");
const ROUTES = path.join(SPA_SRC, "routes.ts");
const API_CLIENT = path.join(SPA_SRC, "api.ts");

import {
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
  mapBackgroundAltText,
  mapBackgroundControlsDisabled,
  mapBackgroundOptionsPath,
  mapBackgroundSelectionPath,
  mapBackgroundSelectionPayload,
} from "../src/helpers/map-background.helper";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

const GRASS = "/assets/img/map_themes/grass/block/";

/** A stored selection of 3, with a four-image pool. */
function serverResponse(
  overrides: Partial<MapBackgroundOptionsResponse> = {},
): MapBackgroundOptionsResponse {
  return {
    selectedIndex: 3,
    effectiveIndex: 3,
    effectiveUrl: `${GRASS}Pimg2D003.gif`,
    options: [
      { index: 0, url: `${GRASS}Pimg2D000.gif` },
      { index: 1, url: `${GRASS}Pimg2D001.gif` },
      { index: 2, url: `${GRASS}Pimg2D002.gif` },
      { index: 3, url: `${GRASS}Pimg2D003.gif` },
    ],
    ...overrides,
  };
}

/** An authorized viewer whose read has already completed. */
function readyState(
  overrides: Partial<MapBackgroundOptionsResponse> = {},
): MapBackgroundState {
  const authorized = applyEditAuthority(initialMapBackgroundState(), true);
  return applyLoaded(authorized, serverResponse(overrides));
}

// ------------------------------------------------------------------ paths

test("the selector calls the MAP-1 block endpoints", () => {
  assert.strictEqual(
    mapBackgroundOptionsPath("block", 12),
    "/block/12/map-background-options",
  );
  assert.strictEqual(
    mapBackgroundSelectionPath("block", 12),
    "/block/12/map-background-selection",
  );
});

test("a route id arriving as a string is used unchanged", () => {
  assert.strictEqual(
    mapBackgroundOptionsPath("block", "12"),
    "/block/12/map-background-options",
  );
});

// ------------------------------------------------------------------- load

test("the current effective background is adopted from the server", () => {
  const state = readyState();
  assert.strictEqual(state.status, "ready");
  assert.strictEqual(state.selectedIndex, 3);
  assert.strictEqual(state.effectiveIndex, 3);
  assert.strictEqual(state.effectiveUrl, `${GRASS}Pimg2D003.gif`);
});

test("the current choice starts highlighted", () => {
  const state = readyState();
  assert.strictEqual(
    state.pendingIndex,
    state.effectiveIndex,
    "the radio matching the rendered background must start selected",
  );
});

test("the option list is exactly what the server returned", () => {
  const response = serverResponse();
  const state = readyState();
  assert.deepStrictEqual(state.options, response.options);
  assert.strictEqual(state.options.length, 4, "no option is added or dropped");
});

test("a stored index the pool no longer offers is not pre-selected", () => {
  // MAP-1 already falls back to the default; the client must follow the
  // effective value, not the stale stored one.
  const state = readyState({ selectedIndex: 99, effectiveIndex: 0 });
  assert.strictEqual(state.selectedIndex, 99, "the stored value stays visible");
  assert.strictEqual(state.pendingIndex, 0, "the highlighted radio is the real one");
});

test("a null stored index uses the effective default", () => {
  const state = readyState({
    selectedIndex: null,
    effectiveIndex: 0,
    effectiveUrl: `${GRASS}Pimg2D000.gif`,
  });
  assert.strictEqual(state.selectedIndex, null);
  assert.strictEqual(state.effectiveIndex, 0);
  assert.strictEqual(state.pendingIndex, 0);
  assert.strictEqual(state.effectiveUrl, `${GRASS}Pimg2D000.gif`);
});

test("effective index 0 renders as a normal choice, not a special state", () => {
  const state = readyState({
    selectedIndex: null,
    effectiveIndex: 0,
    effectiveUrl: `${GRASS}Pimg2D000.gif`,
  });
  assert.ok(
    state.options.some(option => option.index === 0),
    "index 0 is an ordinary member of the pool",
  );
  assert.strictEqual(hasNoMapBackgroundOptions(state), false);
  assert.strictEqual(mapBackgroundControlsDisabled(state), false);
});

// ----------------------------------------------------------------- choose

test("only an offered index can be chosen", () => {
  const state = readyState();
  assert.strictEqual(chooseIndex(state, 1).pendingIndex, 1);
  assert.strictEqual(
    chooseIndex(state, 42).pendingIndex,
    3,
    "an index outside the server's list is ignored",
  );
});

test("choosing the already-rendered index leaves nothing to save", () => {
  const state = chooseIndex(readyState(), 3);
  assert.strictEqual(canSaveMapBackground(state), false);
});

test("choosing a different index enables the save", () => {
  const state = chooseIndex(readyState(), 1);
  assert.strictEqual(canSaveMapBackground(state), true);
});

// ------------------------------------------------------------------- save

test("an authorized save sends the chosen integer index", () => {
  const state = chooseIndex(readyState(), 2);
  assert.deepStrictEqual(mapBackgroundSelectionPayload(state.pendingIndex), {
    index: 2,
  });
});

test("choosing index 0 sends 0, not null", () => {
  // MAP-1 canonicalises 0 to a stored null itself. The client must not invent
  // a second "explicit zero" meaning of its own.
  const state = chooseIndex(readyState(), 0);
  assert.deepStrictEqual(mapBackgroundSelectionPayload(state.pendingIndex), {
    index: 0,
  });
});

test("a save in flight disables every control", () => {
  const saving = beginSave(chooseIndex(readyState(), 1));
  assert.strictEqual(saving.status, "saving");
  assert.strictEqual(mapBackgroundControlsDisabled(saving), true);
  assert.strictEqual(canSaveMapBackground(saving), false);
});

test("a save that is not allowed never enters the saving state", () => {
  const unchanged = readyState();
  assert.strictEqual(beginSave(unchanged), unchanged, "no-op save is refused");
});

test("a successful save reports success and adopts the stored index", () => {
  const saving = beginSave(chooseIndex(readyState(), 1));
  const saved = applySaveSuccess(saving, 1);
  assert.strictEqual(saved.status, "ready");
  assert.strictEqual(saved.selectedIndex, 1);
  assert.strictEqual(saved.messageKind, "success");
  assert.strictEqual(saved.message, MAP_BACKGROUND_SAVED_MESSAGE);
});

test("a save that stores null is reported without inventing an index", () => {
  const saving = beginSave(chooseIndex(readyState(), 0));
  const saved = applySaveSuccess(saving, null);
  assert.strictEqual(saved.selectedIndex, null);
  assert.strictEqual(saved.messageKind, "success");
});

test("a failed save never reports success", () => {
  const saving = beginSave(chooseIndex(readyState(), 1));
  const failed = applySaveFailure(saving, 500);
  assert.strictEqual(failed.status, "ready");
  assert.strictEqual(failed.messageKind, "error");
  assert.strictEqual(failed.message, MAP_BACKGROUND_SAVE_FAILED_MESSAGE);
  assert.notStrictEqual(failed.message, MAP_BACKGROUND_SAVED_MESSAGE);
});

test("a failed save leaves the stored selection untouched", () => {
  const saving = beginSave(chooseIndex(readyState(), 1));
  const failed = applySaveFailure(saving, 500);
  assert.strictEqual(failed.selectedIndex, 3, "the server value did not change");
  assert.strictEqual(failed.effectiveIndex, 3);
});

test("a refused save withdraws the editing control", () => {
  for (const status of [401, 403]) {
    const saving = beginSave(chooseIndex(readyState(), 1));
    const refused = applySaveFailure(saving, status);
    assert.strictEqual(refused.status, "forbidden", `status ${status}`);
    assert.strictEqual(refused.canEdit, false);
    assert.strictEqual(refused.message, MAP_BACKGROUND_FORBIDDEN_MESSAGE);
    assert.strictEqual(canSaveMapBackground(refused), false);
    assert.strictEqual(mapBackgroundControlsDisabled(refused), true);
  }
});

// --------------------------------------------------------- unsafe states

test("a viewer without edit authority gets no active control", () => {
  const state = applyLoaded(initialMapBackgroundState(), serverResponse());
  assert.strictEqual(state.canEdit, false);
  assert.strictEqual(mapBackgroundControlsDisabled(state), true);
  assert.strictEqual(canSaveMapBackground(state), false);
  assert.strictEqual(
    chooseIndex(state, 1).pendingIndex,
    3,
    "an unauthorized viewer cannot even change the highlight",
  );
});

test("a read failure gives a safe state with no options", () => {
  const failed = applyReadFailure(applyEditAuthority(initialMapBackgroundState(), true));
  assert.strictEqual(failed.status, "readFailed");
  assert.deepStrictEqual(failed.options, []);
  assert.strictEqual(failed.message, MAP_BACKGROUND_READ_FAILED_MESSAGE);
  assert.strictEqual(canSaveMapBackground(failed), false);
  assert.strictEqual(mapBackgroundControlsDisabled(failed), true);
});

test("an empty option set gives a safe state", () => {
  const empty = readyState({ options: [] });
  assert.strictEqual(hasNoMapBackgroundOptions(empty), true);
  assert.strictEqual(canSaveMapBackground(empty), false);
});

test("the loading state offers nothing", () => {
  const loading = initialMapBackgroundState();
  assert.strictEqual(loading.status, "loading");
  assert.strictEqual(mapBackgroundControlsDisabled(loading), true);
  assert.strictEqual(canSaveMapBackground(loading), false);
});

test("no user message leaks a path or a raw error", () => {
  const messages = [
    MAP_BACKGROUND_READ_FAILED_MESSAGE,
    MAP_BACKGROUND_SAVE_FAILED_MESSAGE,
    MAP_BACKGROUND_SAVED_MESSAGE,
    MAP_BACKGROUND_FORBIDDEN_MESSAGE,
  ];
  for (const message of messages) {
    assert.ok(message.length > 0 && message.length < 80, message);
    assert.ok(!message.includes("/"), `message must not carry a path: ${message}`);
  }
});

// ------------------------------------------------------ classic fidelity

test("the historical thumbnail size is preserved", () => {
  assert.strictEqual(MAP_BACKGROUND_THUMBNAIL_WIDTH, 160);
  assert.strictEqual(MAP_BACKGROUND_THUMBNAIL_HEIGHT, 80);
});

test("the historical labels are preserved", () => {
  assert.strictEqual(MAP_BACKGROUND_PROMPT, "Choose a background image");
  assert.strictEqual(MAP_BACKGROUND_EMPTY_MESSAGE, "No images available!");
  assert.strictEqual(MAP_BACKGROUND_SUBMIT_LABEL, "Ok");
  assert.strictEqual(mapBackgroundAltText(7), "Map Index: 7");
});

// -------------------------------------------------------------- wiring

test("the selector renders the server list and invents no filenames", () => {
  const source = read(SELECTOR);
  assert.ok(
    source.includes("v-for=\"option in state.options\""),
    "candidates come from the server response",
  );
  assert.ok(
    !source.includes("Pimg2D"),
    "the component must never build a background filename itself",
  );
  assert.ok(
    !source.includes("colonyDataHelper"),
    "the component must never resolve a colony theme itself",
  );
});

test("the selector keeps the historical IM2 radio group and Ok submit", () => {
  const source = read(SELECTOR);
  assert.ok(source.includes("name=\"IM2\""), "the classic field name is kept");
  assert.ok(source.includes("type=\"radio\""), "the classic control is a radio");
  assert.ok(
    source.includes("type=\"submit\""),
    "the classic control saves on submit",
  );
});

test("the selector marks the current choice", () => {
  const source = read(SELECTOR);
  assert.ok(
    source.includes(":checked=\"state.pendingIndex === option.index\""),
    "the current choice must be marked, as <$chk2d> did historically",
  );
});

test("the selector disables its controls from one shared rule", () => {
  const source = read(SELECTOR);
  assert.ok(source.includes(":disabled=\"controlsDisabled\""));
  assert.ok(source.includes(":disabled=\"!canSave\""));
});

test("the thumbnail size is applied as an inline style", () => {
  // The app stylesheet sizes `img`, so the width/height attributes alone do
  // not survive and the candidates render at their natural 480x240.
  const source = read(SELECTOR);
  assert.ok(
    source.includes(":style=\"thumbnailStyle\""),
    "the historical 160x80 size must beat the stylesheet",
  );
});

test("the background page checks authority against the route id", () => {
  // BlockPage fetches once in mounted() and has no route watcher, so its
  // `block` prop goes stale after a move between two block ids. Keying the
  // check on the prop would authorize against the previous block.
  const source = read(BACKGROUND_PAGE);
  assert.ok(
    source.includes("this.$route.params.id"),
    "the id must come from the route",
  );
  assert.ok(
    !source.includes("this.block.id"),
    "the id must not come from the parent-supplied prop",
  );
  assert.ok(source.includes("can_admin"), "the page asks the server for authority");
  assert.ok(
    source.includes("/restricted"),
    "an unauthorized viewer is sent away, not shown a dead form",
  );
});

test("the background page passes its authority result to the selector", () => {
  const source = read(BACKGROUND_PAGE);
  assert.ok(source.includes(":can-edit=\"canEdit\""));
  assert.ok(source.includes("place-type=\"block\""), "MAP-2 wires the block only");
});

test("the block map renders the server-resolved background", () => {
  const source = read(BLOCK_MAP_PAGE);
  assert.ok(
    source.includes("mapBackgroundOptionsPath"),
    "the public map reads the effective background from MAP-1",
  );
  assert.ok(
    source.includes("this.effectiveUrl"),
    "the rendered URL is the server's, not a derived one",
  );
});

test("the wizard link points at the restored route, not the dead CGI action", () => {
  const source = read(BLOCK_WIZARD_PAGE);
  assert.ok(!source.includes("ac=wizardimage"), "the dead legacy link is gone");
  assert.ok(source.includes("blockmapbackground"), "it points at the new route");
});

test("the block background route exists and no hood route was added", () => {
  const source = read(ROUTES);
  assert.ok(source.includes("name: \"blockmapbackground\""));
  assert.ok(source.includes("path: \"wizard/background\""));
  assert.ok(
    !source.includes("neighborhoodmapbackground"),
    "the neighborhood selector belongs to MAP-3",
  );
});

test("the shared client can send the PUT the save needs", () => {
  assert.ok(read(API_CLIENT).includes("put:"), "MAP-1's write endpoint uses PUT");
});

// ------------------------------------------------------------------- run

let failed = 0;
for (const entry of tests) {
  try {
    entry.run();
    console.log(`  ok   ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${entry.name}`);
    console.error(`       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
