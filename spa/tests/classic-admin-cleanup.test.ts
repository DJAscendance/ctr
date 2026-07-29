/**
 * Regression guard for the classic place-administration CLEANUP lane.
 *
 * Every assertion here corresponds to a defect found during Ryan's manual test
 * of the completed fidelity branch. They are grouped by defect so a failure says
 * which one came back.
 *
 * Like the other SPA suites this is dependency-free (plain Node, no runner, no
 * @vue/test-utils, no DOM), so it asserts against component source rather than
 * mounting. For presentational defects the markup IS the behaviour; where a
 * defect was behavioural (stale state, navigation) the assertions pin the
 * mechanism that fixes it, not merely its presence.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const INFORMATION = path.join(SPA_SRC, "pages/Information.vue");
const HOME_IMAGE = path.join(SPA_SRC, "pages/home/HomeUpdateImagePage.vue");
const HOME_MAIN_2D = path.join(SPA_SRC, "components/place/home/main2d.vue");
const HOOD_BLOCK_MAP = path.join(
  SPA_SRC,
  "components/neighborhood/HoodBlockMap.vue",
);
const HOOD_MAP_PAGE = path.join(SPA_SRC, "pages/neighborhood/NeighborhoodMapPage.vue");
const HOOD_BACKGROUND_PAGE = path.join(
  SPA_SRC,
  "pages/neighborhood/NeighborhoodMapBackgroundPage.vue",
);
const BLOCK_BACKGROUND_PAGE = path.join(
  SPA_SRC,
  "pages/block/BlockMapBackgroundPage.vue",
);
const MESSAGE_TO_ALL = path.join(SPA_SRC, "pages/MessageToAll.vue");
const INBOX_TO_ALL = path.join(SPA_SRC, "pages/InboxToAll.vue");
const ACCESS_RIGHTS = path.join(SPA_SRC, "pages/AccessRights.vue");
const CHAT_ACCESS = path.join(SPA_SRC, "pages/home/HomeChatAccessPage.vue");
const PLACE_INFO_EDITOR = path.join(
  SPA_SRC,
  "pages/place/PlaceUpdateInformationPage.vue",
);
const HOME_INFO_EDITOR = path.join(
  SPA_SRC,
  "pages/home/HomeUpdateInformationPage.vue",
);
const STYLES = path.join(SPA_SRC, "assets/index.scss");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

/** A .vue file's outermost template, with comments removed. */
function markup(file: string): string {
  const source = read(file);
  return source
    .slice(0, source.lastIndexOf("</template>"))
    .replace(/<!--[\s\S]*?-->/g, "");
}

// ------------------------------------------- 1. Information window centering

test("only the Manage control and the place heading are centered", () => {
  // Scoped to the staff-managed branch. The home branch above it renders its own
  // <place-information> and has no centered section, so an unscoped search finds
  // that one and reports the two in the wrong order.
  const template = markup(INFORMATION);
  const centered = template.indexOf("<div class=\"text-center\">");
  const centeredEnd = template.indexOf("<place-information", centered);
  assert.ok(centered > -1, "expected a centered section");
  assert.ok(centeredEnd > centered, "expected the information after it");

  const section = template.slice(centered, centeredEnd);
  assert.ok(
    section.includes("place-manage"),
    "the Manage button belongs inside the centered section",
  );
  assert.ok(
    section.includes("Welcome to:"),
    "so does the static place heading",
  );

  // The manager-authored HTML must sit OUTSIDE it, or every place's own text
  // would be force-centered regardless of what its author wrote.
  const after = template.slice(centeredEnd);
  assert.ok(
    !/<div class="text-center">[\s\S]*<place-information/.test(after),
    "the custom information must not be nested in a centered wrapper",
  );
});

test("the place body is block flow, so centering spans the page", () => {
  const template = markup(INFORMATION);
  // A flex column shrink-wraps its items to the widest child, which centered the
  // heading over the information text instead of over the page.
  assert.ok(
    /<div class="h-full w-full bg-black" style="padding: 10px" v-else>/.test(
      template,
    ),
    "the place branch must not be a flex column",
  );
});

test("editing information cannot rename a place", () => {
  const source = read(INFORMATION);
  // placeName is only ever read from the information response and rendered.
  const assignments = source.match(/this\.placeName = /g) || [];
  assert.strictEqual(
    assignments.length,
    3,
    "expected the response value, the failure fallback, and the route-change reset",
  );
  assert.ok(
    !/v-model="placeName"|<input[^>]*placeName/.test(source),
    "the place name must stay display-only - no editable binding",
  );
});

// -------------------------------------- 2. Stale Information on route change

test("the Information window reloads when its route parameters change", () => {
  const source = read(INFORMATION);
  assert.ok(
    /\$route\(to, from\)/.test(source),
    "a $route watcher is what catches a change with no remount",
  );
  for (const param of ["type", "id", "slug"]) {
    assert.ok(
      new RegExp(`to\\.params\\.${param} === from\\.params\\.${param}`).test(source),
      `a change of ${param} alone must still reload`,
    );
  }
  assert.ok(/this\.reload\(\);/.test(source), "the watcher must reload");
});

test("a route change clears every field before the new place loads", () => {
  const source = read(INFORMATION);
  const reload = source.slice(
    source.indexOf("reload(): void {"),
    source.indexOf("async getData(token: number)"),
  );
  assert.ok(reload.length > 0, "expected a reload() method");
  for (const field of [
    "this.owner = null;",
    "this.deputies = [];",
    "this.securityInfo = {};",
    "this.homeDescription = null;",
    "this.placeName = \"\";",
    "this.placeDescription = \"\";",
    "this.canEditInformation = false;",
  ]) {
    assert.ok(reload.includes(field), `reload() must clear ${field}`);
  }
  // Manage in particular: the previous place's capability must not linger even
  // for the moment the new place is loading.
  const manageReset = reload.indexOf("this.canEditInformation = false;");
  const fetch = reload.indexOf("this.getData(token)");
  assert.ok(
    manageReset < fetch,
    "state must be cleared BEFORE the new requests start",
  );
});

test("an older response can never overwrite a newer route's result", () => {
  const source = read(INFORMATION);
  assert.ok(
    /const token = \+\+this\.loadToken;/.test(source),
    "reload() must take a monotonic token",
  );
  const guards = source.match(/if \(token !== this\.loadToken\) return;/g) || [];
  // One per place: both information branches, both can_edit branches, the home
  // description, and the staffing response.
  assert.strictEqual(
    guards.length,
    6,
    "every response handler must discard itself when superseded",
  );
});

test("deputies are replaced wholesale, not written index by index", () => {
  const source = read(INFORMATION);
  assert.ok(
    /this\.deputies = response\.data\.data\.deputies\.slice\(\);/.test(source),
    "per-index assignment is not reactive in Vue 2 and leaves stale entries",
  );
  assert.ok(
    !/this\.deputies\[index\] = /.test(source),
    "the old per-index write must be gone",
  );
});

// --------------------------------- 3. Neighborhood background editor preview

test("HoodBlockMap owns the neighborhood grid and no cell content", () => {
  const source = read(HOOD_BLOCK_MAP);
  assert.ok(/grid-cols-6/.test(source), "6 columns");
  assert.ok(
    /v-for="location in blockCount"/.test(source),
    "it must iterate the shared block count",
  );
  assert.ok(
    /<slot\s+name="block"/.test(source),
    "consumers supply cell markup through the block scoped slot",
  );
  assert.ok(
    !/Picon2D|Pimg2D/.test(source),
    "specific art belongs to the helper, not the renderer",
  );
});

test("the neighborhood map page uses the shared renderer", () => {
  const source = read(HOOD_MAP_PAGE);
  assert.ok(/<hood-block-map/.test(source), "it must render through HoodBlockMap");
  assert.ok(
    !/grid-cols-6/.test(source),
    "restating the grid is the drift this extraction prevents",
  );
  assert.ok(
    !/in 30\b/.test(source),
    "and so is restating the block count",
  );
});

// --------------------------------------------------- 3/4. padding and layout

test("the background editors and their hubs have inner padding", () => {
  for (const [label, file] of [
    ["neighborhood background editor", HOOD_BACKGROUND_PAGE],
    ["block background editor", BLOCK_BACKGROUND_PAGE],
  ] as Array<[string, string]>) {
    assert.ok(
      /<div class="p-2"/.test(markup(file)),
      `${label} must not sit flush against the window edge`,
    );
  }
});

// ------------------------------------------------------ 4. Button-order audit

/**
 * Position of the button whose LABEL matches `word`, in `template`.
 *
 * Throws when there is no such button. That is the point: the earlier version
 * returned "" for a missing control, and `indexOf("")` is 0, so a form that had
 * lost its primary button entirely still "passed" the ordering assertion with
 * 0 < cancelAt. A missing control must fail loudly, not silently sort first.
 *
 * Matching is on the label text, not the whole element: the place-information
 * editor's error-state "Back" buttons carry @click="cancel", and matching
 * attributes would find one of those instead of the real Cancel.
 */
export function buttonPosition(template: string, word: string, context: string): number {
  const buttons = template.match(/<button[\s\S]*?<\/button>/g) || [];
  const labelOf = (button: string): string =>
    button.slice(button.indexOf(">") + 1, button.lastIndexOf("</button>"));
  const matches = buttons.filter(b => new RegExp(word, "i").test(labelOf(b)));
  if (matches.length === 0) {
    throw new Error(`${context}: no button labelled ${word}`);
  }
  const at = template.indexOf(matches[0]);
  if (at < 0) {
    throw new Error(`${context}: could not locate the ${word} button in the template`);
  }
  return at;
}

test("a missing button fails the ordering check instead of passing vacuously", () => {
  // Regression guard for the guard. A template with a Cancel but no primary
  // must raise, not report position 0.
  const noPrimary = "<div><button type=\"button\">Cancel</button></div>";
  assert.throws(
    () => buttonPosition(noPrimary, "Update", "fixture"),
    /no button labelled Update/,
    "a missing primary button must fail loudly",
  );
  // And the check still works on a well-formed fixture, in both orders.
  const good =
    "<div><button>Update</button><button type=\"button\">Cancel</button></div>";
  const bad =
    "<div><button type=\"button\">Cancel</button><button>Update</button></div>";
  assert.ok(buttonPosition(good, "Update", "f") < buttonPosition(good, "Cancel", "f"));
  assert.ok(buttonPosition(bad, "Update", "f") > buttonPosition(bad, "Cancel", "f"));
});

test("every audited edit form puts its primary action before Cancel", () => {
  const forms: Array<[string, string, string]> = [
    ["Message to All", MESSAGE_TO_ALL, "POST"],
    ["Inbox to All", INBOX_TO_ALL, "POST"],
    ["Access Rights", ACCESS_RIGHTS, "Update"],
    ["Home Chat Access", CHAT_ACCESS, "Update"],
    ["Place Information editor", PLACE_INFO_EDITOR, "Update"],
    ["Home Information editor", HOME_INFO_EDITOR, "Update"],
    ["Home image upload", HOME_IMAGE, "Update"],
  ];
  for (const [label, file, primary] of forms) {
    // Anchored on the BUTTON ELEMENTS, not on the words: several of these pages
    // also use "Update" in a heading or in body copy, so a plain text search
    // finds prose rather than the control. Case-insensitive because Message to
    // All and Inbox to All shout their labels (POST / CANCEL) - the ORDER is
    // what is being pinned, not the casing.
    const template = markup(file);
    // Both lookups throw if their control is absent, so presence is proved
    // before order is compared.
    const primaryAt = buttonPosition(template, primary, label);
    const cancelAt = buttonPosition(template, "Cancel", label);
    assert.notStrictEqual(
      primaryAt,
      cancelAt,
      `${label}: ${primary} and Cancel must be two distinct controls`,
    );
    // Source order is DOM order is tab order: asserting it here keeps anyone
    // from reordering visually with CSS while leaving keyboard order wrong.
    assert.ok(
      primaryAt < cancelAt,
      `${label}: ${primary} must come before Cancel in the DOM`,
    );
  }
});

test("no Cancel button can be taken for a submit", () => {
  for (const [label, file] of [
    ["Message to All", MESSAGE_TO_ALL],
    ["Inbox to All", INBOX_TO_ALL],
    ["Access Rights", ACCESS_RIGHTS],
    ["Home Chat Access", CHAT_ACCESS],
    ["Place Information editor", PLACE_INFO_EDITOR],
    ["Home Information editor", HOME_INFO_EDITOR],
    ["Home image upload", HOME_IMAGE],
  ] as Array<[string, string]>) {
    const template = markup(file);
    // Find the button element that carries the Cancel label.
    const buttons = template.match(/<button[\s\S]*?<\/button>/g) || [];
    const cancel = buttons.filter(b => /Cancel/i.test(b));
    assert.ok(cancel.length > 0, `${label} must have a Cancel button element`);
    for (const button of cancel) {
      assert.ok(
        /type="button"/.test(button),
        `${label}: Cancel must be type="button", never a default submit`,
      );
    }
  }
});

// Cancel's NAVIGATION is proved behaviorally against a real vue-router in
// place-form-cancel.test.ts - a source string could only ever show that a push
// was written, not that it arrived, which is exactly how the duplicate-navigation
// defect survived here.

// -------------------------------------------- 5. Home-image selected filename

test("the chosen image filename is shown instead of 'No file chosen'", () => {
  const template = markup(HOME_IMAGE);
  assert.ok(
    /v-if="selectedFileName"/.test(template),
    "the page must render the selected filename",
  );
  assert.ok(
    /\{\{ selectedFileName \}\}/.test(template),
    "and show the name itself",
  );
  assert.ok(
    /class="text-center text-green mt-3"[\s\S]{0,80}Selected:/.test(template),
    "in the green selected/confirmation treatment the page already uses",
  );
});

test("choosing a file no longer blanks the native input", () => {
  const source = read(HOME_IMAGE);
  const setFile = source.slice(
    source.indexOf("setFile(e) {"),
    source.indexOf("clearSelection() {"),
  );
  assert.ok(setFile.length > 0, "expected setFile()");
  assert.ok(
    !/e\.target\.value = "";/.test(setFile),
    "blanking the input on selection is what produced 'No file chosen'",
  );
  // The reset still has to happen SOMEWHERE, or re-picking the same file after
  // an upload would not fire change.
  assert.ok(
    /input\.value = "";/.test(source),
    "the reset must move to clearSelection(), not disappear",
  );
  for (const consumer of ["this.imagePending = true;", "this.imagePending = false;"]) {
    assert.ok(source.includes(consumer), "expected the upload/remove paths");
  }
  const clears = source.match(/this\.clearSelection\(\);/g) || [];
  assert.strictEqual(
    clears.length,
    2,
    "selection is cleared exactly where it is consumed: after upload and after removal",
  );
});

test("the filename is a base name, and selection is distinct from errors", () => {
  const source = read(HOME_IMAGE);
  assert.ok(
    /return \(this\.imageFile && this\.imageFile\.name\) \|\| "";/.test(source),
    "File.name is the base name - never a local path",
  );
  // A new choice must clear the previous outcome, so an old error or an old
  // "uploaded" message cannot sit beside a file that has not been sent.
  const setFile = source.slice(
    source.indexOf("setFile(e) {"),
    source.indexOf("clearSelection() {"),
  );
  for (const reset of [
    "this.showError = false;",
    "this.showUploaded = false;",
    "this.showRemoved = false;",
  ]) {
    assert.ok(setFile.includes(reset), `choosing a file must reset ${reset}`);
  }
});

test("no upload happens before Update is pressed", () => {
  const source = read(HOME_IMAGE);
  const uploads = source.match(/\$http\.post\(/g) || [];
  assert.strictEqual(uploads.length, 2, "exactly upload-image and remove-image");
  const setFile = source.slice(
    source.indexOf("setFile(e) {"),
    source.indexOf("clearSelection() {"),
  );
  assert.ok(
    !/\$http\./.test(setFile),
    "selecting a file must not touch the network - PR #410's pending-file model",
  );
});

// ------------------------------------------------------ 6. Block CHECK button

test("pointer and focus are scoped to genuinely interactive controls", () => {
  const styles = read(STYLES);
  const rule = styles.slice(styles.indexOf(".btn-ui {"), styles.indexOf(".btn-ui-inline"));
  const markup = rule.replace(/\/\/[^\n]*/g, "");
  // `.btn-ui` is the classic button LOOK, worn by inert placeholders too - the
  // neighborhood Vote control and the non-colony Update label are handler-less
  // spans. Clickability must attach to elements that DO something.
  const ROLE_BUTTON = `.btn-ui[role=${JSON.stringify("button")}]`;
  for (const selector of ["a.btn-ui", "button.btn-ui", ROLE_BUTTON]) {
    assert.ok(
      markup.includes(selector),
      `${selector} must be named explicitly rather than styling the class itself`,
    );
  }
  const base = markup.slice(0, markup.indexOf("}"));
  assert.ok(
    !/cursor:/.test(base),
    "the bare .btn-ui rule must not make every element wearing it look clickable",
  );
  assert.ok(
    /a\.btn-ui:focus-visible/.test(markup),
    "keyboard users need a visible focus indicator on real controls",
  );
  assert.ok(
    /:disabled|aria-disabled/.test(markup),
    "a disabled control must not claim it can be used",
  );
});

test("no .btn-ui span is left pretending to be a control", () => {
  // Both known inert spans - Vote and the non-colony Update - carry the class
  // for its chrome alone. Neither has a handler, and there is no role="button"
  // anywhere, so the scoped selectors leave both correctly inert. If one ever
  // needs to act, it must become a <button> or <router-link> rather than have
  // the selector widened back to the class.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".vue")) continue;
      const source = fs.readFileSync(full, "utf8");
      const spans = source.match(/<span[^>]*class="[^"]*\bbtn-ui\b[^"]*"[^>]*>/g) || [];
      for (const span of spans) {
        if (/@click|v-on:click|role="button"/.test(span)) {
          offenders.push(`${path.relative(SPA_SRC, full)}: ${span.trim()}`);
        }
      }
    }
  };
  walk(SPA_SRC);
  assert.deepStrictEqual(
    offenders,
    [],
    "an interactive .btn-ui span must be converted to real semantic markup",
  );
});

test("the classic buttons stay static under the pointer", () => {
  const styles = read(STYLES);
  const rule = styles.slice(styles.indexOf(".btn-ui {"), styles.indexOf(".btn-ui-inline"));
  const markup = rule.replace(/\/\/[^\n]*/g, "");
  // No hover restyling of any kind: the classic Cybertown buttons do not light
  // up, change colour or animate under the mouse.
  assert.ok(!/:hover/.test(markup), "there must be no :hover rule at all");
  assert.ok(
    !/transition|animation|box-shadow:[^;]*(glow|rgba)/i.test(markup),
    "no glow, transition or animation may be introduced",
  );
  // A bare :focus would fire on mouse clicks too, which is hover restyling by
  // another name. Only :focus-visible is allowed.
  assert.ok(
    !/\.btn-ui:focus\s*\{/.test(markup),
    "a bare :focus rule would also fire on a mouse click",
  );
});

// ------------------------------------ 7. Home page owner information spacing

test("the home information table is the original pre-image structure", () => {
  const template = markup(HOME_MAIN_2D);
  assert.ok(
    /<div class="flex flex-auto w-2\/3">/.test(template),
    "the information column must take two thirds, as live CTR does",
  );
  assert.ok(
    /<table class="w-full">/.test(template),
    "and the table must fill it, so the columns spread instead of shrink-wrapping",
  );
  assert.ok(
    !/w-36/.test(template),
    "pinning the label column to 9rem is what collapsed the separation",
  );
  // Cell classes verbatim from the pre-image commit 0c6db9e.
  assert.ok(
    /<td class="w-130 font-bold text-left">/.test(template),
    "the first label cell keeps its original class",
  );
  const labels = template.match(/<td class="font-bold text-left">/g) || [];
  assert.ok(labels.length >= 6, "every other label cell is the plain original");
  const values = template.match(/<td class="text-left">/g) || [];
  assert.ok(values.length >= 7, "every value cell is the plain original");
});

test("no cell padding is added back to the information table", () => {
  const template = markup(HOME_MAIN_2D);
  const table = template.slice(
    template.indexOf("<table"),
    template.indexOf("</table>"),
  );
  // This table uses automatic layout, which distributes spare width in
  // proportion to content width - so padding on a cell is AMPLIFIED, not merely
  // added. pr-8 on the labels pushed the value column from ~20% to ~33%.
  for (const forbidden of ["pr-", "px-", "py-", "pl-", "p-", "whitespace-nowrap", "align-top"]) {
    assert.ok(
      !table.includes(forbidden),
      `${forbidden} on a cell moves the classic column proportions`,
    );
  }
});

test("the image sits in the remaining third, not in the table's space", () => {
  const template = markup(HOME_MAIN_2D);
  assert.ok(
    /flex-none w-1\/3 flex flex-col items-center justify-start text-center pt-2/.test(
      template,
    ),
    "the image region must be the complement of the w-2/3 information column",
  );
  // A fixed pixel column would take its width out of the row BEFORE the
  // information column is sized, so its value would silently decide the first
  // two columns' proportions.
  assert.ok(
    !/style="width: \d+px;"[\s\S]{0,40}<img/.test(template),
    "the image region must not be a fixed-width flex sibling",
  );
  assert.ok(
    /max-width: 200px; max-height: 200px;/.test(template),
    "the image itself is still bounded at 200x200",
  );
});

test("Object Storage Areas keeps its original placement", () => {
  const template = markup(HOME_MAIN_2D);
  // Verbatim from 0c6db9e: no wrapper, no added margin. The gap live CTR shows
  // between the identity fields and this section is the section's own, and
  // adding to it moves Object Storage Areas off the reference.
  const storage = /<storage ([^>]*)><\/storage>/.exec(template);
  assert.ok(storage, "storage must be rendered directly, not inside a wrapper");
  assert.ok(
    /v-if="showStorage"/.test(storage[1]),
    "and keep its original showStorage guard",
  );
  assert.ok(
    !/<div[^>]*mt-\d/.test(template),
    "no margin wrapper may be added around it",
  );
});

test("the no-image state still renders", () => {
  const template = markup(HOME_MAIN_2D);
  assert.ok(
    /<small v-else><i>No image uploaded yet!<\/i><\/small>/.test(template),
    "a home with no image must keep its placeholder",
  );
  assert.ok(
    /v-else-if="homeImagePending"/.test(template),
    "and a pending image must keep the NOT CHECKED placeholder",
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
