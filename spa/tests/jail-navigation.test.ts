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

import { decideBannedNavigation } from "../src/helpers/ban-navigation.helper";
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

test("a query string cannot be hung off an allowed one", () => {
  for (const p of ["/news?to=/place/plaza", "/news?", "/news/?x=1"]) {
    assert.strictEqual(isJailReadablePath(p), false, p);
  }
});

test("the match is case-sensitive, like the routes it names", () => {
  for (const p of ["/News", "/NEWS", "/nEwS"]) {
    assert.strictEqual(isJailReadablePath(p), false, p);
  }
});

test("a missing or non-string path is not readable", () => {
  assert.strictEqual(isJailReadablePath(undefined), false);
  assert.strictEqual(isJailReadablePath(null), false);
  assert.strictEqual(isJailReadablePath(1 as unknown as string), false);
  assert.strictEqual(isJailReadablePath({} as unknown as string), false);
});

console.log("\n3. THE RULE THAT CONSULTS IT");

const SRC = path.resolve(__dirname, "../../../src");
const mainSource: string = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");
const ruleSource: string = fs.readFileSync(
  path.join(SRC, "helpers/ban-navigation.helper.ts"), "utf8",
);
/** A double quote, so the source snippets below can be written in template literals. */
const Q = String.fromCharCode(34);

test("the readable-path list is consulted by the ban rule, and by nothing else", () => {
  assert.ok(
    /import \{[^}]*isJailReadablePath[^}]*\} from "\.\/jail-navigation\.helper"/
      .test(ruleSource),
    "the ban rule does not import the readable-path list",
  );
  assert.strictEqual(
    mainSource.includes("isJailReadablePath"), false,
    "main.ts reads the list itself again, so the order could differ in two places",
  );
});

test("the guard asks the ban rule, once, and only for a banned citizen", () => {
  assert.ok(
    /import \{[^}]*decideBannedNavigation[^}]*\} from "\.\/helpers\/ban-navigation\.helper"/
      .test(mainSource),
    "main.ts does not import the ban rule",
  );
  const uses = mainSource.split("decideBannedNavigation(").length - 1;
  assert.strictEqual(uses, 1, "the rule is called in more than one place");
  const banned = mainSource.indexOf("if (banned) {");
  assert.ok(banned > -1, "the banned branch is gone");
  assert.ok(
    mainSource.indexOf("decideBannedNavigation(") > banned,
    "the rule is asked outside the banned branch, so it could outlive a sentence",
  );
});

test("the readable page is admitted before the catch-all that confines an inmate", () => {
  assert.strictEqual(decideBannedNavigation("jail", "/news"), "allow");
  assert.strictEqual(decideBannedNavigation("jail", "/place/plaza"), "confine");
});

test("the carve-out is scoped to a jail sentence, never a full ban", () => {
  assert.strictEqual(decideBannedNavigation("full", "/news"), "end-session");
  assert.strictEqual(decideBannedNavigation("full", "/place/jail"), "end-session");
});

test("the catch-all that confines an inmate is still there", () => {
  assert.ok(
    mainSource.includes(`decide(${Q}/place/jail${Q})`),
    "the redirect that holds an inmate in the Jail is gone",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
