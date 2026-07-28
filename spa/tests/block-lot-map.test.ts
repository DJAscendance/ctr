/**
 * Regression guard for the shared block lot-map renderer.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner, no
 * @vue/test-utils, no DOM), so this suite does not mount components. It guards the
 * two things that actually regress:
 *
 *   1. The GEOMETRY, which is not a styling preference - it is the original
 *      Cybertown lot coordinate system recovered from the blaxxun CS 4.0 templates
 *      and archived production art (docs/research/classic-place-admin-re-evidence.md
 *      §3.2). Those numbers are exercised directly against the helper.
 *
 *   2. That every consumer goes THROUGH the shared component and helper rather than
 *      restating the grid. A second hand-rolled 12x6 grid is precisely the drift
 *      this extraction exists to prevent, so the source of each consumer is
 *      asserted to contain no independent grid definition.
 *
 * The behaviour-preservation claim for the public block map (same links, same
 * icons, same fallback) is covered here by asserting the rendered slot markup still
 * carries each of those, since the markup is the behaviour for a presentational
 * page.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const BLOCK_LOT_MAP = path.join(SPA_SRC, "components/block/BlockLotMap.vue");
const BLOCK_MAP_PAGE = path.join(SPA_SRC, "pages/block/BlockMapPage.vue");
const BLOCK_WIZARD_PAGE = path.join(SPA_SRC, "pages/block/BlockWizardPage.vue");
const BACKGROUND_SELECTOR = path.join(
  SPA_SRC,
  "components/PlaceMapBackgroundSelector.vue",
);

import {
  BLOCK_MAP_CELL_SIZE,
  BLOCK_MAP_COLUMNS,
  BLOCK_MAP_HEIGHT,
  BLOCK_MAP_LOT_COUNT,
  BLOCK_MAP_ROWS,
  BLOCK_MAP_WIDTH,
  backgroundStyleFromUrls,
  blockBackgroundFilename,
  blockBackgroundStyle,
  blockFreeIconUrl,
  blockHouseIconUrl,
  locationToRowColumn,
  themeFromBackgroundUrl,
} from "../src/helpers/block-map.helper";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

// ---------------------------------------------------------------- geometry

test("lot geometry matches the archived Cybertown assets", () => {
  assert.strictEqual(BLOCK_MAP_WIDTH, 480, "block backgrounds are 480px wide");
  assert.strictEqual(BLOCK_MAP_HEIGHT, 240, "block backgrounds are 240px tall");
  assert.strictEqual(BLOCK_MAP_CELL_SIZE, 40, "house and free icons are 40x40");
  assert.strictEqual(BLOCK_MAP_COLUMNS, 12, "480 / 40 = 12 columns");
  assert.strictEqual(BLOCK_MAP_ROWS, 6, "240 / 40 = 6 rows");
  assert.strictEqual(BLOCK_MAP_LOT_COUNT, 72, "12 x 6 = 72 lots");
  assert.strictEqual(
    BLOCK_MAP_COLUMNS * BLOCK_MAP_CELL_SIZE,
    BLOCK_MAP_WIDTH,
    "columns must tile the background exactly",
  );
  assert.strictEqual(
    BLOCK_MAP_ROWS * BLOCK_MAP_CELL_SIZE,
    BLOCK_MAP_HEIGHT,
    "rows must tile the background exactly",
  );
});

test("locations are row-major, matching the original oRRCC naming", () => {
  assert.deepStrictEqual(locationToRowColumn(1), { row: 1, column: 1 });
  assert.deepStrictEqual(locationToRowColumn(12), { row: 1, column: 12 });
  assert.deepStrictEqual(locationToRowColumn(13), { row: 2, column: 1 });
  assert.deepStrictEqual(locationToRowColumn(72), { row: 6, column: 12 });
});

test("every location maps to a distinct cell inside the grid", () => {
  const seen = new Set<string>();
  for (let location = 1; location <= BLOCK_MAP_LOT_COUNT; location++) {
    const { row, column } = locationToRowColumn(location);
    assert.ok(row >= 1 && row <= BLOCK_MAP_ROWS, `row out of range at ${location}`);
    assert.ok(
      column >= 1 && column <= BLOCK_MAP_COLUMNS,
      `column out of range at ${location}`,
    );
    const key = `${row}:${column}`;
    assert.ok(!seen.has(key), `duplicate cell ${key} at location ${location}`);
    seen.add(key);
  }
  assert.strictEqual(seen.size, BLOCK_MAP_LOT_COUNT);
});

// ---------------------------------------------------------------- assets

test("background filename padding matches the archived Pimg2D naming", () => {
  assert.strictEqual(blockBackgroundFilename(null), "Pimg2D000.gif");
  assert.strictEqual(blockBackgroundFilename(0), "Pimg2D000.gif");
  assert.strictEqual(blockBackgroundFilename(undefined), "Pimg2D000.gif");
  assert.strictEqual(blockBackgroundFilename(-3), "Pimg2D000.gif");
  assert.strictEqual(blockBackgroundFilename(1.5), "Pimg2D000.gif");
  assert.strictEqual(blockBackgroundFilename(2), "Pimg2D002.gif");
  assert.strictEqual(blockBackgroundFilename(13), "Pimg2D013.gif");
});

test("a selected background layers over the theme default as a fallback", () => {
  assert.strictEqual(
    blockBackgroundStyle("grass", null),
    "url('/assets/img/map_themes/grass/block/Pimg2D000.gif')",
    "no selection renders the default alone",
  );
  assert.strictEqual(
    blockBackgroundStyle("grass", 4),
    "url('/assets/img/map_themes/grass/block/Pimg2D004.gif'), " +
      "url('/assets/img/map_themes/grass/block/Pimg2D000.gif')",
    "a selection must keep the default underneath it",
  );
});

test("house icons are 0-based files from a 1-based index, capped per theme", () => {
  assert.strictEqual(
    blockHouseIconUrl("grass", 1),
    "/assets/img/map_themes/grass/block/Picon2D000.gif",
  );
  assert.strictEqual(
    blockHouseIconUrl("grass", 12),
    "/assets/img/map_themes/grass/block/Picon2D011.gif",
    "grass has no icon cap",
  );
  assert.strictEqual(
    blockHouseIconUrl("cyberhood", 6),
    "/assets/img/map_themes/cyberhood/block/Picon2D000.gif",
    "cyberhood caps at 5 and falls back to icon 000",
  );
  assert.strictEqual(
    blockHouseIconUrl("desert", 8),
    "/assets/img/map_themes/desert/block/Picon2D000.gif",
    "desert caps at 7 and falls back to icon 000",
  );
  assert.strictEqual(
    blockHouseIconUrl("desert", 7),
    "/assets/img/map_themes/desert/block/Picon2D006.gif",
  );
});

test("the free-lot marker is the archived Ficon2D000 asset", () => {
  assert.strictEqual(
    blockFreeIconUrl("grass"),
    "/assets/img/map_themes/grass/block/Ficon2D000.gif",
  );
});

// ---------------------------------------------- single source of geometry

test("BlockLotMap owns the grid and renders no lot content of its own", () => {
  const source = read(BLOCK_LOT_MAP);
  assert.ok(
    /grid-cols-12/.test(source),
    "BlockLotMap must declare the 12-column grid",
  );
  assert.ok(
    /v-for="location in lotCount"/.test(source),
    "BlockLotMap must iterate the shared lot count",
  );
  assert.ok(
    /<slot\s+name="lot"/.test(source),
    "consumers supply cell markup through the lot scoped slot",
  );
  assert.ok(
    !/Picon2D|Ficon2D|Pimg2D/.test(source),
    "BlockLotMap must not know about specific art - that belongs to consumers",
  );
});

for (const [label, file] of [
  ["BlockMapPage", BLOCK_MAP_PAGE],
  ["BlockWizardPage", BLOCK_WIZARD_PAGE],
] as Array<[string, string]>) {
  test(`${label} uses the shared renderer instead of its own grid`, () => {
    const source = read(file);
    assert.ok(
      /<block-lot-map/.test(source),
      `${label} must render through BlockLotMap`,
    );
    assert.ok(
      !/grid-cols-12/.test(source),
      `${label} must not restate the grid - that is the drift this prevents`,
    );
    assert.ok(
      !/in 72\b/.test(source),
      `${label} must not hardcode the lot count`,
    );
    assert.ok(
      !/width: *'480px'|480px/.test(source),
      `${label} must not hardcode the map dimensions`,
    );
  });
}

test("the public block map keeps its links, icons and accessible names", () => {
  const source = read(BLOCK_MAP_PAGE);
  assert.ok(
    /:to="'\/home\/' \+ lot\.username"/.test(source),
    "an occupied lot still links to its owner's home",
  );
  assert.ok(
    /:to="'\/block\/' \+ \$route\.params\.id \+ '\/move\/' \+ lot\.location"/.test(
      source,
    ),
    "a free lot still links to the move route for that location",
  );
  assert.ok(
    /houseIcon\(lot\.map_icon_index\)/.test(source),
    "occupied lots still render the stored house icon",
  );
  assert.ok(/freeImage/.test(source), "free lots still render the Free marker");
  assert.ok(
    /aria-label="lot\.name \+ ' - home of ' \+ lot\.username"/.test(source),
    "occupied lots need an accessible name",
  );
  assert.ok(
    /aria-label="'Free lot ' \+ lot\.location/.test(source),
    "free lots need an accessible name",
  );
  assert.ok(
    /blockBackgroundStyle\(this\.theme, this\.block\.map_background_index\)/.test(
      source,
    ),
    "the map still honours the block's selected background with default fallback",
  );
});

test("the update wizard now shows the block's real background", () => {
  const source = read(BLOCK_WIZARD_PAGE);
  assert.ok(
    /blockBackgroundStyle\(\s*colonyDataHelper\[this\.colony\.slug\]\.map_theme,\s*this\.block\.map_background_index/m.test(
      source,
    ),
    "the wizard must not hardcode the theme default background",
  );
  assert.ok(
    !/Pimg2D000/.test(source),
    "the wizard must not name the default background directly",
  );
});

// -------------------------------------------- background preview overlay

test("background URLs from the server layer over the default", () => {
  assert.strictEqual(
    backgroundStyleFromUrls("/a/Pimg2D000.gif", "/a/Pimg2D000.gif"),
    "url('/a/Pimg2D000.gif')",
    "the default previewing itself must not be layered twice",
  );
  assert.strictEqual(
    backgroundStyleFromUrls("", "/a/Pimg2D000.gif"),
    "url('/a/Pimg2D000.gif')",
    "an unresolved candidate falls back to the default",
  );
  assert.strictEqual(
    backgroundStyleFromUrls("/a/Pimg2D007.gif", "/a/Pimg2D000.gif"),
    "url('/a/Pimg2D007.gif'), url('/a/Pimg2D000.gif')",
  );
});

test("the map theme is recovered from the server-issued URL, not guessed", () => {
  assert.strictEqual(
    themeFromBackgroundUrl("/assets/img/map_themes/desert/block/Pimg2D002.gif"),
    "desert",
  );
  assert.strictEqual(
    themeFromBackgroundUrl("/assets/img/map_themes/cyberhood/hood/Pimg2D000.gif"),
    "cyberhood",
  );
  assert.strictEqual(themeFromBackgroundUrl("nonsense"), "");
  assert.strictEqual(themeFromBackgroundUrl(""), "");
});

test("the background selector previews through the shared lot renderer", () => {
  const source = read(BACKGROUND_SELECTOR);
  assert.ok(
    /<block-lot-map/.test(source),
    "the block preview must render through BlockLotMap",
  );
  assert.ok(
    !/grid-cols-12/.test(source),
    "the selector must not restate the grid",
  );
  assert.ok(
    /:background="previewBackground"/.test(source),
    "the overlay must sit on the CANDIDATE background, not the stored one",
  );
  assert.ok(
    /showsLotOverlay/.test(source) &&
      /placeType === "block"/.test(source),
    "only blocks have a lot occupancy model to overlay",
  );
});

test("previewing is local and never persists", () => {
  const source = read(BACKGROUND_SELECTOR);
  // The only mutating call in the component is submit(), and it is reachable
  // solely from apply() and restoreDefault(). Selecting a radio or pressing
  // Cancel must not reach it.
  const httpMutations = source.match(/this\.\$http\.(put|post|delete)\(/g) || [];
  assert.strictEqual(
    httpMutations.length,
    1,
    "expected exactly one mutating request in the selector",
  );
  assert.ok(
    /submit\(this\.pendingIndex\)/.test(source),
    "Apply persists the previewed index",
  );
  assert.ok(
    /submit\(null\)/.test(source),
    "Restore Default clears the stored selection",
  );
  // Cancel now LEAVES rather than reverting in place: nothing was ever
  // persisted by previewing, so abandoning the screen is the discard. What
  // matters for this suite is unchanged - it must not mutate.
  const cancelBody = source.slice(
    source.indexOf("cancel(): void {"),
    source.indexOf("restoreDefault(): void {"),
  );
  assert.ok(cancelBody.length > 0, "expected a cancel() method");
  assert.ok(
    /this\.\$router\.push\(\{\s*name: this\.hubRouteName,/m.test(cancelBody),
    "Cancel returns to the Update hub it was opened from",
  );
  assert.ok(
    !/\$http\.|submit\(/.test(cancelBody),
    "Cancel must issue no request of any kind",
  );
  assert.ok(
    /v-model\.number="pendingIndex"/.test(source),
    "choosing a background only moves local state",
  );
});

test("Cancel has a hub to return to at both tiers", () => {
  const source = read(BACKGROUND_SELECTOR);
  // Named routes, unconditionally - so Cancel lands somewhere meaningful even
  // when the editor was reached by a pasted URL with no history behind it.
  assert.ok(
    /hubRouteName\(\): string \{[\s\S]*?"blockUpdate"[\s\S]*?"neighborhoodUpdate"/.test(
      source,
    ),
    "both tiers must name their Update hub route",
  );
  assert.ok(
    !/\$router\.back\(\)/.test(source),
    "history-based back would strand a directly-opened editor",
  );
});

test("the buttons read Apply, then Restore, then Cancel", () => {
  const source = read(BACKGROUND_SELECTOR);
  // lastIndexOf: the component nests <template v-slot> blocks, so the FIRST
  // closing tag is an inner slot, not the end of the component template.
  const template = source.slice(0, source.lastIndexOf("</template>"));
  // Anchored on the handlers rather than the labels: the labels are wording and
  // may be revised, but which button does what is the thing being ordered.
  const apply = template.indexOf("@click=\"apply\"");
  const restore = template.indexOf("@click=\"restoreDefault\"");
  const cancel = template.indexOf("@click=\"cancel\"");
  assert.ok(apply > -1, "expected an Apply button");
  assert.ok(restore > -1, "expected a Restore Default button");
  assert.ok(cancel > -1, "expected a Cancel button");
  assert.ok(
    template.includes("Restore Default"),
    "the restore button keeps its explicit label",
  );
  // DOM order IS the tab order, so asserting source order asserts both, and
  // keeps anyone from reordering them with CSS alone.
  assert.ok(apply < restore, "Apply must come before Restore");
  assert.ok(restore < cancel, "Restore must come before Cancel");
});

test("the chooser is one paged row, not a wall of every option", () => {
  const source = read(BACKGROUND_SELECTOR);
  // Markup only - the surrounding comments explain what the wrapping grid did
  // wrong, and saying so must not trip the rule.
  const template = source.slice(0, source.lastIndexOf("</template>"));
  const markup = template.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/flex-wrap/.test(markup),
    "a wrapping grid is what produced the 27-image wall",
  );
  assert.ok(
    /flex-nowrap/.test(markup),
    "candidates must stay on a single row",
  );
  assert.ok(
    /visibleOptions\(\): MapBackgroundOption\[\]/.test(source),
    "only a window of the options may be rendered at once",
  );
  assert.ok(
    /v-for="option in visibleOptions"/.test(source),
    "the row must render the window, not the full option list",
  );
  for (const control of ["pageBack", "pageForward"]) {
    assert.ok(
      source.includes(control),
      `the strip needs an explicit ${control} control`,
    );
  }
  assert.ok(
    /revealOption\(this\.pendingIndex\)/.test(source),
    "the strip must open on the page holding the current selection",
  );
});

test("the overlay distinguishes loading, empty and failed", () => {
  const source = read(BACKGROUND_SELECTOR);
  // Four states, not two. "This neighborhood has no blocks on its map yet" is a
  // claim about the neighborhood, so it may only be made after a response that
  // actually said so - printing it beside a failure told the leader two
  // contradictory things at once.
  assert.ok(
    /overlayLoaded: false,/.test(source),
    "a successful-response flag is what separates empty from failed",
  );
  assert.ok(
    /overlayReady\(\): boolean \{\s*return this\.overlayLoaded && !this\.overlayError;/.test(
      source,
    ),
    "the summary may only show on a successful response with no error",
  );
  for (const gate of [
    "v-if=\"showsLotOverlay && overlayReady\"",
    "v-if=\"showsBlockOverlay && overlayReady\"",
  ]) {
    assert.ok(source.includes(gate), `the summary must be gated: ${gate}`);
  }
  // Retry from failure must start from "nothing known".
  const loadOverlay = source.slice(
    source.indexOf("async loadOverlay()"),
    source.indexOf("async submit("),
  );
  assert.ok(
    /this\.overlayError = "";\s*this\.overlayLoaded = false;/.test(loadOverlay),
    "a retry must clear BOTH flags before it starts",
  );
  const successes = loadOverlay.match(/this\.overlayLoaded = true;/g) || [];
  assert.strictEqual(
    successes.length,
    2,
    "exactly the two success paths - block lots and hood blocks - may set it",
  );
  // A stale overlay from a previous success must not be left looking current.
  assert.ok(
    /this\.locations = \[\];[\s\S]{0,120}this\.overlayError =/.test(loadOverlay),
    "a failed lot fetch must clear the rows as well as flag the error",
  );
  assert.ok(
    /this\.blocks = \[\];[\s\S]{0,120}this\.overlayError =/.test(loadOverlay),
    "a failed block fetch must clear the rows as well as flag the error",
  );
});

test("a neighborhood preview shows its real blocks, names and icons", () => {
  const source = read(BACKGROUND_SELECTOR);
  const overlay = source.slice(
    source.indexOf("<hood-block-map"),
    source.indexOf("</hood-block-map>"),
  );
  assert.ok(overlay.length > 0, "expected a block overlay for neighborhoods");
  assert.ok(
    /:background="previewBackground"/.test(overlay),
    "the candidate background must sit underneath the blocks",
  );
  assert.ok(
    /\{\{ block\.name \}\}/.test(overlay),
    "current block names must be visible against the candidate",
  );
  assert.ok(
    /'background-image': icon/.test(overlay),
    "so must the current block mini-city icons",
  );
  // Rendering, never editing. Structural block edits are a separate lane.
  assert.ok(
    !/<router-link|<input|@click/.test(overlay),
    "the preview is inert - it must not offer navigation or editing",
  );
});

test("the preview shows occupied homes and free lots without offering settlement", () => {
  const source = read(BACKGROUND_SELECTOR);
  const overlay = source.slice(
    source.indexOf("<block-lot-map"),
    source.indexOf("</block-lot-map>"),
  );
  assert.ok(overlay.length > 0, "expected a lot overlay block");
  assert.ok(
    /houseIcon\(lot\.map_icon_index\)/.test(overlay),
    "occupied lots render their house icon",
  );
  assert.ok(/freeImage/.test(overlay), "free lots are visible");
  assert.ok(
    !/router-link/.test(overlay),
    "the preview must not link anywhere - it is not the settlement map",
  );
  assert.ok(
    !/type="checkbox"/.test(overlay),
    "the preview must not offer lots for settlement",
  );
});

test("Restore Default and the authorization handling survive", () => {
  const source = read(BACKGROUND_SELECTOR);
  assert.ok(/Restore Default/.test(source), "Restore Default must remain");
  assert.ok(
    /map-background-selection/.test(source),
    "Apply still goes through the existing selection endpoint",
  );
  assert.ok(
    /status === 403/.test(source),
    "a server-side authorization refusal is still surfaced",
  );
});

// ---------------------------------------------------------------- runner

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exit(failures === 0 ? 0 : 1);
