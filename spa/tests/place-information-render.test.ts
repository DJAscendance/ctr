/**
 * Rendering-trust guard for staff-managed place information.
 *
 * CTR now has two Information surfaces with deliberately different trust models,
 * and the whole safety argument depends on not confusing them:
 *
 *   HOME  - arbitrary text a citizen typed. Rendered through text interpolation,
 *           so markup is escaped and shown literally. Guarded by
 *           information-render.test.ts.
 *   PLACE - written by staff and sanitized on the SERVER before storage
 *           (PlaceInformationService.updateInformation -> sanitizeUserHtml).
 *           Rendered as HTML, which is only safe because of that.
 *
 * This suite pins the place half: the v-html lives in exactly one component,
 * that component is fed only from the server endpoint, and the home path never
 * acquires a v-html by accident.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const PLACE_INFORMATION = path.join(SPA_SRC, "components/place/PlaceInformation.vue");
const INFORMATION_VUE = path.join(SPA_SRC, "pages/Information.vue");
const EDITOR_VUE = path.join(
  SPA_SRC,
  "pages/place/PlaceUpdateInformationPage.vue",
);
const ROUTES = path.join(SPA_SRC, "routes.ts");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

test("exactly one component renders place information as HTML", () => {
  const source = read(PLACE_INFORMATION);
  const bindings = source.match(/v-html\s*=/g) || [];
  assert.strictEqual(
    bindings.length,
    1,
    "PlaceInformation must have exactly one v-html binding",
  );
  assert.ok(
    /v-html="description"/.test(source),
    "it must render the `description` prop and nothing else",
  );
});

test("the rendered value can only come from the server endpoint", () => {
  const page = read(INFORMATION_VUE);
  assert.ok(
    /this\.placeDescription = response\.data\.description \|\| "";/.test(page),
    "placeDescription is assigned from the information response",
  );
  const assignments = page.match(/this\.placeDescription = /g) || [];
  assert.strictEqual(
    assignments.length,
    2,
    "expected exactly two assignments: the response value and the empty fallback",
  );
  assert.ok(
    /\$http\.get\(`\/place\/\$\{placeId\}\/information`\)/.test(page),
    "the value must come from GET /place/:id/information",
  );
  assert.ok(
    !/placeDescription = this\.\$route/.test(page),
    "never populate the rendered value from a route parameter",
  );
});

test("the home description path still escapes markup", () => {
  const page = read(INFORMATION_VUE);
  assert.ok(
    /\{\{\s*homeDescription\s*\|\|/.test(page),
    "a home description must stay on text interpolation",
  );
  assert.ok(
    !/v-html\s*=\s*"homeDescription"/.test(page),
    "a home description must never be rendered as HTML",
  );
});

test("place information renders above the staffing listing", () => {
  const page = read(INFORMATION_VUE);
  const template = page.slice(
    page.indexOf("<template>"),
    page.lastIndexOf("</template>"),
  );
  const informationAt = template.lastIndexOf("<place-information");
  const leaderAt = template.indexOf("Leader<br/>");
  assert.ok(informationAt !== -1, "expected the place information block");
  assert.ok(leaderAt !== -1, "expected the Leader listing");
  assert.ok(
    informationAt < leaderAt,
    "the classic order is information first, then Leader and Deputies",
  );
});

test("the security listing also shows the place's information", () => {
  const template = read(INFORMATION_VUE);
  const jailBlock = template.slice(
    template.indexOf("$route.params.slug === 'jail'"),
    template.indexOf("v-else-if=\"$route.params.type === 'home'\""),
  );
  assert.ok(
    /<place-information/.test(jailBlock),
    "a staffed public place keeps its information even where the listing differs",
  );
});

test("the editor is the classic textarea with Update and Cancel", () => {
  const source = read(EDITOR_VUE);
  assert.ok(
    /Update the Information for \{\{ name \}\}/.test(source),
    "expected the classic heading",
  );
  assert.ok(/<textarea/.test(source), "a plain textarea, as the original");
  assert.ok(
    /'Updating\.\.\.' : 'Update'/.test(source),
    "the primary button is Update",
  );
  assert.ok(/>Cancel</.test(source), "Cancel must be offered");
  assert.ok(
    /Insufficient access rights\./.test(source),
    "the classic refusal wording",
  );
});

test("the editor never sanitizes client-side in place of the server", () => {
  const source = read(EDITOR_VUE);
  // Matches an actual call, not the word: the page documents WHY sanitizing is
  // the server's job, and documenting the rule must not trip the rule.
  assert.ok(
    !/\b(sanitize\w*|DOMPurify)\s*\(/i.test(source),
    "sanitizing belongs on the server, on write - a client-side pass would imply otherwise",
  );
  assert.ok(
    /\$http\.put\(`\/place\/\$\{this\.placeId\}\/information`/.test(source),
    "the editor submits to the guarded update endpoint",
  );
});

test("the editor route carries only a place id", () => {
  const routes = read(ROUTES);
  assert.ok(
    /path: "\/place\/:placeId\/information\/update"/.test(routes),
    "expected the place information editor route",
  );
  assert.ok(
    !/information\/update\/:type|:slug\/information\/update/.test(routes),
    "the route must not accept a place type or slug - the server derives it",
  );
});

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
