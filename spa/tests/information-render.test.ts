/**
 * Rendering-safety guard for the home Information view.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner), and the
 * repo carries no @vue/test-utils or DOM environment - so this suite does NOT mount the
 * component. Introducing a component-testing stack is out of scope for this repair lane.
 *
 * What it does instead is guard the property that actually regresses: a home's Information
 * must never reach the page as markup that has not been through the shared sanitizer.
 *
 * The contract CHANGED in the Information/Update follow-up lane. It used to be "store
 * verbatim, escape at render", so this suite asserted text interpolation and the absence
 * of v-html. Home Information is now sanitized ON WRITE against the same allowlist
 * Messageboard, Inbox and Place Information use, and renders through the same
 * PlaceInformation component they do - so the guarded property moved from "escape it
 * here" to "the only path to the page is the sanitized one".
 *
 * The realistic failure mode is now someone rendering homeDescription through a raw
 * v-html of their own, or restoring an unsanitized write, either of which puts
 * unfiltered citizen markup on the page. Those are what these assertions catch.
 *
 * The server-side half of the contract (sanitized on write, stored already-clean) is
 * covered by api/src/controllers/home-information.controller.spec.ts and
 * api/src/services/home/home-information.service.spec.ts.
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

test("Information.vue keeps a dedicated home branch", () => {
  // The branch's POSITION is not the point - only that a home gets a branch of
  // its own, separate from the staff-managed places.
  assert.ok(
    /v-(else-)?if="\$route\.params\.type === 'home'"/.test(template),
    "expected a dedicated home branch in Information.vue",
  );
});

test("the home branch renders through the shared sanitized-HTML component", () => {
  const homeBranch = template.slice(
    template.indexOf("$route.params.type === 'home'"),
    template.indexOf("<!--", template.indexOf("$route.params.type === 'home'")),
  );
  assert.ok(
    /<place-information/.test(homeBranch),
    "home information must render through PlaceInformation, whose input is sanitized on write",
  );
  assert.ok(
    /:description="homeDescription"/.test(homeBranch),
    "PlaceInformation must be given homeDescription, and nothing else",
  );
});

test("Information.vue never binds v-html directly", () => {
  // Matches an actual directive binding (v-html="..."), not the bare word: the component
  // carries a comment explaining the rule, and documenting it must not trip it.
  //
  // Still asserted even though home information is now HTML: rendering must go through
  // PlaceInformation, which is the ONE component allowed to bind v-html and the one
  // place the "already sanitized on write" contract is documented. A second raw binding
  // here would be a second contract nobody is maintaining.
  assert.ok(
    !/v-html\s*=/.test(source),
    "render via PlaceInformation, not a raw v-html binding of your own",
  );
});

test("Information.vue shows a fallback when the description is empty", () => {
  assert.ok(
    /This citizen has not added any information yet\./.test(template),
    "an empty description must fall back to explanatory text, not render blank",
  );
});

test("Information.vue preserves the owner's line breaks without rewriting text", () => {
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
