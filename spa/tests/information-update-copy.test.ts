/**
 * The wording and limits this lane fixed, pinned so they cannot drift back.
 *
 * WHY SOURCE ASSERTIONS. The SPA harness is dependency-free (plain Node, no
 * runner, no DOM, no .vue compiler), so these components cannot be mounted here.
 * What can be pinned is the source of truth for each decision - which is enough
 * for copy and for a numeric limit, and is stated plainly rather than dressed up
 * as behavioural coverage. The BEHAVIOUR behind the limit is covered on the
 * server, where the boundary actually is:
 * api/src/services/home/home-information-limits.spec.ts.
 *
 * The copy matters more than it looks. The old hub line - "Here you can change
 * this colony's information and more ...!" - was rendered on every hub including
 * the ones offering exactly one tool, so it promised a "more" that was not there
 * and trailed an ellipsis and an exclamation mark into a management screen.
 */
import assert from "assert";

import {
  hubBackLabel,
  hubBackRoute,
  hubHeading,
  hubIntro,
  tierNoun,
} from "../src/helpers/place-update-hub.helper";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const HUB = path.join(SPA_SRC, "components/place/PlaceUpdateHub.vue");
const HOME_INFORMATION = path.join(
  SPA_SRC, "pages/home/HomeUpdateInformationPage.vue",
);
const HOME_UPDATE = path.join(SPA_SRC, "pages/home/HomeUpdateHomePage.vue");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

// ------------------------------------------------------ Update hub wording

test("the heading names the tier and the place, for every reachable tier", () => {
  // Called, not grepped: these assert the string a real place produces.
  assert.strictEqual(hubHeading("colony", "Games"), "Update the colony 'Games'");
  assert.strictEqual(
    hubHeading("hood", "The Shadows"),
    "Update the neighborhood 'The Shadows'",
  );
  assert.strictEqual(
    hubHeading("block", "Dark Paradise"),
    "Update the block 'Dark Paradise'",
  );
});

test("the tier nouns are the words citizens see, not the stored types", () => {
  assert.strictEqual(tierNoun("colony"), "colony");
  assert.strictEqual(tierNoun("hood"), "neighborhood",
    "'hood' is the stored type, never the word shown to a citizen");
  assert.strictEqual(tierNoun("block"), "block");
});

test("the intro matches how many options are actually offered", () => {
  assert.strictEqual(
    hubIntro("colony", 1),
    "Use the option below to update this colony.",
  );
  assert.strictEqual(
    hubIntro("hood", 2),
    "Choose an option below to update this neighborhood.",
  );
  assert.strictEqual(
    hubIntro("block", 3),
    "Choose an option below to update this block.",
  );
  // A hub can legitimately render zero tiles; it must still not invite a choice.
  assert.strictEqual(
    hubIntro("block", 0),
    "Use the option below to update this block.",
  );
});

test("no heading exists for a tier that has no hub", () => {
  // Public places are administered through MANAGE on their Information window;
  // there is no public Update hub and no route that could reach one. An earlier
  // version carried a `public` heading branch tested by a case that could never
  // run in the product - the branch is gone rather than re-tested.
  const helper = read(path.join(SPA_SRC, "helpers/place-update-hub.helper.ts"));
  assert.ok(
    !/Update '\$\{/.test(helper),
    "no bare `Update '<name>'` heading - that was the unreachable public branch",
  );
  assert.ok(
    !/"public"/.test(helper.slice(helper.indexOf("export function tierNoun"))),
    "the copy helpers must not branch on a tier that has no hub",
  );
});

test("the vague old lead line is gone", () => {
  for (const type of ["colony", "hood", "block"] as const) {
    for (const count of [1, 2, 3]) {
      const intro = hubIntro(type, count);
      assert.ok(!/information and more/.test(intro), `still promises more: ${intro}`);
      assert.ok(!/\.\.\.!/.test(intro), `still trails an ellipsis: ${intro}`);
    }
  }
});

test("Back names its destination, and resolves to it", () => {
  assert.strictEqual(hubBackLabel("Dark Paradise"), "Back to Dark Paradise");
  assert.strictEqual(hubBackLabel(null), "Back",
    "a denied hub knows no place, so history is the honest fallback");

  assert.deepStrictEqual(
    hubBackRoute({ type: "colony", placeId: 879, slug: "games_col" }),
    { path: "/place/games_col" },
  );
  assert.deepStrictEqual(
    hubBackRoute({ type: "hood", placeId: 891 }),
    { name: "neighborhoodpage", params: { id: "891" } },
  );
  assert.deepStrictEqual(
    hubBackRoute({ type: "block", placeId: 893 }),
    { name: "blockmap", params: { id: "893" } },
  );
  assert.strictEqual(hubBackRoute(null), null);
});

test("a colony with no slug names no destination rather than a broken one", () => {
  assert.strictEqual(hubBackRoute({ type: "colony", placeId: 879, slug: null }), null);
});

test("child list headings name the child type", () => {
  const hub = read(HUB);
  assert.ok(
    /"Neighborhoods in this colony"/.test(hub),
    "a colony lists neighborhoods",
  );
  assert.ok(
    /"Blocks in this neighborhood"/.test(hub),
    "a neighborhood lists blocks",
  );
});

test("the fixed-map notice explains the limit without an apostrophe pile-up", () => {
  const hub = read(HUB);
  assert.ok(
    /The colony map layout is fixed\./.test(hub),
    "expected the corrected fixed-layout sentence",
  );
  assert.ok(
    /Neighborhoods cannot be added, removed or\s+repositioned from this page\./
      .test(hub),
    "expected the corrected second sentence",
  );
});

test("the hub component delegates its copy and destination to the helpers", () => {
  // The behaviour is tested above by calling the helpers. This only pins that the
  // component actually uses them rather than growing a second copy.
  const hub = read(HUB);
  for (const fn of ["hubHeading", "hubIntro", "hubBackLabel", "hubBackRoute"]) {
    assert.ok(hub.includes(fn), `PlaceUpdateHub must use ${fn}`);
  }
  assert.ok(
    /this\.\$router\.push\(target\)/.test(hub),
    "Back must navigate to the named destination, not just pop history",
  );
});

// ------------------------------------------------- Home Information limit

test("the home Information editor offers the full 3500 characters", () => {
  const page = read(HOME_INFORMATION);
  assert.ok(/maxLength: 3500/.test(page), "the editor bound must be 3500");
  assert.ok(!/maxLength: 1000/.test(page), "the old 1000 bound must be gone");
});

test("the counter reads against the same limit the server publishes", () => {
  const page = read(HOME_INFORMATION);
  assert.ok(
    /\{\{\s*houseDescription\.length\s*\}\}\s*\/\s*\{\{\s*maxLength\s*\}\}/
      .test(page),
    "the counter must read current / maxLength, not a second hard-coded number",
  );
});

test("the editor does not hard-cap input it cannot actually judge", () => {
  // The server measures the SANITIZED value. The SPA has no sanitizer - and must
  // not grow one - so a maxlength here would assert a verdict the client cannot
  // reach: sanitizing can grow a value past the limit or shrink it under.
  // Truncating input at 3,500 raw characters is also silent truncation, which
  // the contract forbids.
  const page = read(HOME_INFORMATION);
  const template = page.slice(page.indexOf("<template>"), page.indexOf("</template>"))
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/maxlength/i.test(template),
    "the textarea must not cap input the client cannot canonicalize",
  );
  assert.ok(
    /showError/.test(page) && /e\.response\?\.data\?\.error/.test(page),
    "the server's refusal must surface through the existing error line",
  );
});

test("the editor reads the information field, not the admin description", () => {
  const page = read(HOME_INFORMATION);
  assert.ok(
    /homeData\.information/.test(page),
    "the editor must load place.information",
  );
  assert.ok(
    !/homeData\.description/.test(page),
    "the administrative description is not this editor's field",
  );
});

test("no validation messaging was added around HTML", () => {
  // Sanitizing is silent by design: disallowed markup is dropped and the save
  // succeeds, exactly as it does for a message board post. A warning here would
  // be a second, competing contract - and a user-facing claim the server does
  // not actually make.
  const page = read(HOME_INFORMATION);
  for (const phrase of [
    "has been blocked",
    "blocked for security",
    "disallowed tag",
    "Basic HTML tags",
    "error message will display",
  ]) {
    assert.ok(
      !page.includes(phrase),
      `no HTML validation messaging: found "${phrase}"`,
    );
  }
});

test("Update and Cancel keep their order, and Cancel still mutates nothing", () => {
  const page = read(HOME_INFORMATION);
  const update = page.indexOf(">Update<");
  const cancel = page.indexOf(">Cancel<");
  assert.ok(update > -1 && cancel > -1, "both buttons must be present");
  assert.ok(update < cancel, "Update comes before Cancel");
  assert.ok(
    /@click="\$router\.back\(\)"/.test(page),
    "Cancel must only navigate",
  );
});

// ------------------------------------------------- house selector semantics

test("every house option is a label wrapping its own radio", () => {
  // 46 radios previously had no associated label at all: screen readers
  // announced them unnamed, and clicking the picture of the house you wanted did
  // nothing. Browser behaviour (a label activates the control it contains) is
  // what fixes both, so the markup shape IS the fix - verified live in the
  // browser as well, where the a11y tree now reports "2D house style 5".
  const page = read(HOME_UPDATE);
  // lastIndexOf: this file nests <template v-for> blocks, so the FIRST
  // </template> closes an inner one and slicing there finds no radios at all.
  const template = page.slice(page.indexOf("<template>"), page.lastIndexOf("</template>"))
    .replace(/<!--[\s\S]*?-->/g, "");

  const radios = (template.match(/<input type="radio"/g) || []).length;
  const labels = (template.match(/<label/g) || []).length;
  assert.ok(radios > 0, "expected radio inputs");
  assert.strictEqual(labels, radios,
    "each radio must be wrapped by exactly one label");
  assert.ok(
    !/<div>\s*<input type="radio"/.test(template),
    "no radio may sit in a bare div - it would have no accessible name",
  );
});

test("every house thumbnail carries alt text, which names its radio", () => {
  const page = read(HOME_UPDATE);
  const images = page.match(/<img[\s\S]*?\/>/g) || [];
  const thumbnails = images.filter(img => /Picon(2D|3D)/.test(img));
  assert.ok(thumbnails.length > 0, "expected house thumbnails");
  for (const img of thumbnails) {
    assert.ok(/:alt=/.test(img), `thumbnail without alt text: ${img.slice(0, 60)}`);
  }
});

test("the selector keeps its tightened layout and 40px thumbnails", () => {
  const page = read(HOME_UPDATE);
  assert.ok(
    /flex flex-wrap justify-center/.test(page),
    "the wrapped centered layout must stay",
  );
  assert.ok(
    !/w-\d+ h-\d+" *:src="'\/assets\/img\/map_themes/.test(page),
    "thumbnails must not be given explicit sizes - they are 40px source images",
  );
});

let failed = 0;
for (const t of tests) {
  try {
    t.run();
    console.log(`  ok   ${t.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${t.name}`);
    console.error(`       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
