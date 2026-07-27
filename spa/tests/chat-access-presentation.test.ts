/**
 * Presentation guard for the Home Chat Access tool.
 *
 * The behavioural half of this feature - owner-only management, the cap of eight,
 * the owner being implicitly allowed and never stored, unknown names ignored,
 * blanks and duplicates normalised, no public guest list, and enforcement over the
 * real Socket.IO protocol - is covered by api/src/services/home/
 * home-chat-access.service.spec.ts and spa/tests/chat-access.test.ts. Nothing here
 * touches any of that.
 *
 * What this guards is the classic presentation, which is easy to erode by accident:
 * the CS 4.0 chat-write wording, eight fields in two rows of four, the 16-character
 * nickname slots, the absence of an owner field, and - most importantly - that the
 * broad Owner Access copy never migrates onto this page. Owner Access is a
 * different axis on a different object and grants far more than chatting
 * (docs/research/classic-place-admin-re-evidence.md section 2.2).
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const CHAT_ACCESS_VUE = path.join(SPA_SRC, "pages/home/HomeChatAccessPage.vue");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const source: string = fs.readFileSync(CHAT_ACCESS_VUE, "utf8");
const template: string = source.slice(
  source.indexOf("<template>"),
  source.lastIndexOf("</template>"),
);
const style: string = source.slice(
  source.indexOf("<style"),
  source.indexOf("</style>"),
);

test("uses the classic Chat Write Access heading", () => {
  const heading = template.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(
    /Update Write Access for Chat/.test(heading),
    "expected the CS 4.0 heading 'Update Write Access for Chat'",
  );
});

test("uses chat-specific wording, never Owner Access wording", () => {
  assert.ok(
    /allowed to chat with you at your home/.test(template),
    "expected the classic chat-write lead sentence",
  );
  assert.ok(
    !/full access to everything/i.test(source),
    "that is Owner Access copy - it grants far more than chatting",
  );
  assert.ok(
    !/read the inbox|change access rights|delete things/i.test(template),
    "Owner Access capabilities must not be described on the chat page",
  );
});

test("renders exactly eight nickname fields and no owner field", () => {
  assert.ok(
    /const MAX_GUESTS = 8;/.test(source),
    "the field count must stay pinned to eight",
  );
  assert.ok(
    /v-for="\(guest, index\) in guests"/.test(template),
    "fields are rendered from the guests array",
  );
  assert.ok(
    /new Array\(MAX_GUESTS\)\s*\n?\s*\.fill\(""\)/.test(source) ||
      /new Array\(MAX_GUESTS\)\.fill\(""\)/.test(source),
    "the form is padded to a stable eight boxes",
  );
  assert.ok(
    !/OWN_NNM|name="owner"|Owner:/i.test(template),
    "the homeowner is implicit - the original chat form had no owner field",
  );
});

test("nickname slots are 16 characters, as the original", () => {
  assert.ok(
    /const NICKNAME_MAX_LENGTH = 16;/.test(source),
    "expected the classic MAXLENGTH=16",
  );
  assert.ok(
    /:maxlength="nicknameMaxLength"/.test(template),
    "the input must bind the shared constant rather than restate it",
  );
});

test("lays the fields out four across, with a narrow-screen fallback", () => {
  assert.ok(
    /grid-template-columns:\s*repeat\(4,/.test(style),
    "eight fields in two rows of four at normal desktop width",
  );
  assert.ok(
    /@media \(max-width: 640px\)/.test(style) &&
      /grid-template-columns:\s*repeat\(2,/.test(style),
    "a narrow viewport must fall back rather than overflow",
  );
});

test("carries the classic unknown-nickname note", () => {
  const text = template.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(
    /Note: If a nickname does not exist, it is ignored without notification\./.test(
      text,
    ),
    "expected the original note verbatim",
  );
});

test("explains what an empty list means", () => {
  const text = template.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(
    /If no nickname is defined, everyone is allowed to chat/.test(text),
    "an empty list means everyone may chat - say so",
  );
  assert.ok(
    /no need to add yourself/.test(text),
    "the owner is implicitly allowed - say so",
  );
  assert.ok(
    /still come in and look around/.test(text),
    "visitors without chat access may still enter - say so",
  );
});

test("offers Update and Cancel", () => {
  assert.ok(
    />\{\{ submitting \? 'Updating\.\.\.' : 'Update' \}\}</.test(template),
    "the primary button is Update, not Save",
  );
  assert.ok(
    /@click="\$router\.back\(\)">Cancel</.test(template),
    "Cancel must leave without submitting",
  );
});

test("submits the whole set as the authoritative replacement list", () => {
  assert.ok(
    /this\.\$http\.post\("\/home\/chat-access", \{ guests: this\.guests \}\)/.test(
      source,
    ),
    "every box is sent, so the submission is the complete list",
  );
  const mutations = source.match(/this\.\$http\.(post|put|delete)\(/g) || [];
  assert.strictEqual(
    mutations.length,
    1,
    "the page must make exactly one mutating request",
  );
});

test("records the deferred original capabilities rather than dropping them", () => {
  assert.ok(
    /WRO bitmask/.test(source) && /Chat Read\s+Access axis/.test(source),
    "job-wide grants and the read axis are deferred, and must stay documented",
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
