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

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const HUB = path.join(SPA_SRC, "components/place/PlaceUpdateHub.vue");
const HOME_INFORMATION = path.join(
  SPA_SRC, "pages/home/HomeUpdateInformationPage.vue",
);

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

// ------------------------------------------------------ Update hub wording

test("the hub heading names the tier, and names a public place directly", () => {
  const hub = read(HUB);
  assert.ok(
    /`Update the \$\{this\.tierNoun\} '\$\{this\.hub\.name\}'`/.test(hub),
    "colony/neighborhood/block headings must read Update the <tier> '<name>'",
  );
  assert.ok(
    /`Update '\$\{this\.hub\.name\}'`/.test(hub),
    "a public place has no tier word a citizen would recognise - name it directly",
  );
});

test("the intro matches how many options are actually offered", () => {
  const hub = read(HUB);
  assert.ok(
    /Use the option below to update this \$\{this\.tierNoun\}\./.test(hub),
    "a single-option hub must not invite the reader to choose",
  );
  assert.ok(
    /Choose an option below to update this \$\{this\.tierNoun\}\./.test(hub),
    "a multi-option hub must invite a choice",
  );
});

test("the vague old lead line is gone", () => {
  // Checked against RENDERED copy only - the computed properties and their
  // comments, which quote the old line to explain why it went, are not what a
  // citizen reads. Documenting a rule must not trip the rule.
  const hub = read(HUB);
  const rendered = hub.slice(hub.indexOf("<template>"), hub.indexOf("</template>"))
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(
    !/information and more/.test(rendered),
    "the hub must not promise 'and more' on hubs that have no more",
  );
  assert.ok(
    !/\.\.\.!/.test(rendered),
    "no trailing ellipsis-and-exclamation in a management screen",
  );
});

test("the tier nouns are the ones citizens see elsewhere", () => {
  const hub = read(HUB);
  for (const noun of ["colony", "neighborhood", "block"]) {
    assert.ok(
      new RegExp(`return "${noun}"`).test(hub),
      `${noun} must be the word used for its tier`,
    );
  }
  assert.ok(
    !/return "hood"/.test(hub),
    "'hood' is the stored type, never the word shown to a citizen",
  );
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

test("Back names its destination when one is known", () => {
  const hub = read(HUB);
  assert.ok(
    /`Back to \$\{this\.hub\.name\}`/.test(hub),
    "Back should say where it goes",
  );
  assert.ok(
    /:\s*"Back"/.test(hub),
    "a denied hub has no place name, so it must fall back to plain Back",
  );
  // Route behaviour is explicitly unchanged by this lane.
  assert.ok(
    /this\.\$router\.back\(\)/.test(hub),
    "the label changed, the navigation did not",
  );
});

// ------------------------------------------------- Home Information limit

test("the home Information editor offers the full 3500 characters", () => {
  const page = read(HOME_INFORMATION);
  assert.ok(/maxLength: 3500/.test(page), "the editor bound must be 3500");
  assert.ok(!/maxLength: 1000/.test(page), "the old 1000 bound must be gone");
});

test("the counter reads against the same limit it enforces", () => {
  const page = read(HOME_INFORMATION);
  assert.ok(
    /\{\{\s*houseDescription\.length\s*\}\}\s*\/\s*\{\{\s*maxLength\s*\}\}/
      .test(page),
    "the counter must read current / maxLength, not a second hard-coded number",
  );
  assert.ok(
    /:maxlength="maxLength"/.test(page),
    "the textarea must use the same bound as the counter",
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
