/**
 * Rendering-safety guard for the home Information view.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner), and the
 * repo carries no @vue/test-utils or DOM environment - so this suite does NOT mount the
 * component. Introducing a component-testing stack is out of scope for this repair lane.
 *
 * What it does instead is guard the property that actually regresses: a home's Information
 * is arbitrary text a citizen typed, and it must reach the page through Vue's text
 * interpolation, which escapes markup. The realistic failure mode is someone "fixing"
 * line breaks or formatting by switching that binding to v-html, which would turn every
 * home description into stored XSS. This asserts on the source of truth for that decision.
 *
 * The server-side half of the contract (text stored verbatim, never rewritten) is covered
 * by api/src/controllers/home-information.controller.spec.ts.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const INFORMATION_VUE = path.join(SPA_SRC, "pages/Information.vue");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const source: string = fs.readFileSync(INFORMATION_VUE, "utf8");
const template: string = source.slice(
  source.indexOf("<template>"),
  source.indexOf("</template>"),
);

test("Information.vue renders the home description via text interpolation", () => {
  assert.ok(
    /v-else-if="\$route\.params\.type === 'home'"/.test(template),
    "expected a dedicated home branch in Information.vue",
  );
  assert.ok(
    /\{\{\s*homeDescription\s*\|\|/.test(template),
    "home description must be rendered with {{ }} interpolation, which escapes markup",
  );
});

test("Information.vue never binds v-html", () => {
  // Matches an actual directive binding (v-html="..."), not the bare word: the component
  // carries a comment explaining WHY it must not use v-html, and documenting the rule must
  // not trip the rule.
  assert.ok(
    !/v-html\s*=/.test(source),
    "v-html would execute markup a citizen typed into their home description",
  );
});

test("Information.vue shows a fallback when the description is empty", () => {
  assert.ok(
    /homeDescription \|\| 'This citizen has not added any information yet\.'/.test(template),
    "an empty description must fall back to explanatory text, not render blank",
  );
});

test("Information.vue preserves the owner's line breaks without markup", () => {
  assert.ok(
    /white-space:\s*pre-wrap/.test(template),
    "line breaks must be preserved with CSS, never by converting text to <br> markup",
  );
});

test("the home branch fetches from the read-only information endpoint", () => {
  assert.ok(
    /\/home\/information\/\$\{this\.\$route\.params\.id\}/.test(source),
    "expected the home branch to read GET /home/information/:placeId",
  );
});

let failed = 0;
for (const t of tests) {
  try {
    t.run();
    console.log(`  ok  ${t.name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${t.name}`);
    console.error(`       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
