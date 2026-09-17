/**
 * The pages a jail sentence does not take away.
 *
 * The route guard in main.ts confines a jailed citizen by redirecting every navigation that
 * is not /place/jail back to /place/jail. That catch-all is what holds an inmate, and these
 * cases check the one carve-out in front of it: a short, explicit list of global read-only
 * pages, headed by /news.
 *
 * Two of the cases below read main.ts itself rather than the helper. The rule is only worth
 * anything if the guard consults it BEFORE the catch-all, and if it stays scoped to a jail
 * sentence rather than a full ban -- neither is visible from the helper's own exports, so
 * both are pinned against the source.
 */
import assert from "assert";

import {
  JAIL_READABLE_PATHS,
  isJailReadablePath,
} from "../src/helpers/jail-navigation.helper";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : err}`);
  }
}

console.log("1. WHAT AN INMATE MAY STILL READ");

test("the news page is readable while serving a sentence", () => {
  assert.strictEqual(isJailReadablePath("/news"), true);
});

test("the list is exactly the one page, so widening it is a visible edit", () => {
  assert.deepStrictEqual([...JAIL_READABLE_PATHS], ["/news"]);
});

console.log("\n2. WHAT THE LIST MUST NEVER LET THROUGH");

test("the Jail itself is not on the list - the guard admits it by its own branch", () => {
  assert.strictEqual(isJailReadablePath("/place/jail"), false);
});

test("no other world is readable", () => {
  for (const p of ["/place/plaza", "/place/mall", "/place/jailinmate", "/"]) {
    assert.strictEqual(isJailReadablePath(p), false, p);
  }
});

test("the place-scoped pages stay refused", () => {
  for (const p of ["/messageboard/13", "/inbox/13", "/information/place/13/jail"]) {
    assert.strictEqual(isJailReadablePath(p), false, p);
  }
});

test("a longer path cannot be hung off an allowed one", () => {
  for (const p of ["/news/../place/plaza", "/newsfeed", "/news/13", "/news#/place/plaza"]) {
    assert.strictEqual(isJailReadablePath(p), false, p);
  }
});

test("a missing or non-string path is not readable", () => {
  assert.strictEqual(isJailReadablePath(undefined), false);
  assert.strictEqual(isJailReadablePath(null), false);
  assert.strictEqual(isJailReadablePath(1 as unknown as string), false);
  assert.strictEqual(isJailReadablePath({} as unknown as string), false);
});

console.log("\n3. THE GUARD THAT CONSULTS IT");

const MAIN = path.resolve(__dirname, "../../../src/main.ts");
const mainSource: string = fs.readFileSync(MAIN, "utf8");
/** A double quote, so the source snippets below can be written in template literals. */
const Q = String.fromCharCode(34);

test("the guard imports the rule from the helper", () => {
  assert.ok(
    /import \{[^}]*isJailReadablePath[^}]*\} from "\.\/helpers\/jail-navigation\.helper"/
      .test(mainSource),
    "main.ts does not import the rule",
  );
});

test("the readable-path branch is reached before the redirect-to-jail catch-all", () => {
  const readable = mainSource.indexOf("isJailReadablePath(to.fullPath)");
  const catchAll = mainSource.indexOf(
    `to.fullPath !== ${Q}/place/jail${Q} && banInfo.type === ${Q}jail${Q}`,
  );
  assert.ok(readable > -1, "the readable-path branch is gone");
  assert.ok(catchAll > -1, "the redirect-to-jail catch-all is gone");
  assert.ok(readable < catchAll, "the catch-all now shadows the readable-path branch");
});

test("the branch is scoped to a jail sentence, never a full ban", () => {
  assert.ok(
    mainSource.includes(`banInfo.type === ${Q}jail${Q} && isJailReadablePath(to.fullPath)`),
    "a full ban could now keep its session on a readable page",
  );
});

test("the catch-all that confines an inmate is still there", () => {
  assert.ok(
    mainSource.includes(`decide(${Q}/place/jail${Q})`),
    "the redirect that holds an inmate in the Jail is gone",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
