/**
 * A full ban wins before any route rule.
 *
 * The defect these cases exist for: a citizen under a FULL ban typed `#/place/jail` and the
 * client kept their token. The server had already refused them -- the API answers 403 and
 * the socket revokes the session -- so the only thing left saying they were still a citizen
 * was the browser, and it said so because of the PAGE they asked for. Two ways in:
 *
 *   1. the ban chain in `main.ts` tested the route before the sentence, so the Jail's own
 *      branch (and the place-scoped pages' branch) matched a full ban as well as a jail one;
 *   2. the guard fetched the route's place FIRST, and awaited it -- and every place answers
 *      403 for a full-banned caller, so the guard rejected before the session check that
 *      destroys the token ever ran.
 *
 * The first is now one ordered rule, checked here for every pairing of sentence and route.
 * The second is checked against `main.ts` itself: the order of two awaits is not visible
 * from any export, so it is pinned to the source.
 */
import assert from "assert";

import {
  BanNavigation,
  decideBannedNavigation,
} from "../src/helpers/ban-navigation.helper";

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

/** Every route family the guard can be asked for, named once. */
const ROUTES = {
  jail: "/place/jail",
  news: "/news",
  plaza: "/place/plaza",
  mall: "/place/mall",
  inbox: "/inbox/13",
  information: "/information/place/13/jail",
  messageboard: "/messageboard/13",
  restricted: "/restricted",
  unknown: "/nosuchroute",
  home: "/home/someone",
  club: "/club/42",
};

function expect(
  banType: string | undefined | null,
  route: string | undefined | null,
  want: BanNavigation,
): void {
  assert.strictEqual(
    decideBannedNavigation(banType, route), want,
    `${String(banType)} + ${route}`,
  );
}

console.log("1. A FULL BAN ENDS THE SESSION, WHATEVER ROUTE WAS ASKED FOR");

test("the Jail is not an escape from a full ban", () => {
  expect("full", ROUTES.jail, "end-session");
});

test("the news carve-out does not reach a full ban", () => {
  expect("full", ROUTES.news, "end-session");
});

test("the worlds end the session", () => {
  expect("full", ROUTES.plaza, "end-session");
  expect("full", ROUTES.mall, "end-session");
});

test("the place-scoped pages end the session rather than merely being refused", () => {
  expect("full", ROUTES.inbox, "end-session");
  expect("full", ROUTES.information, "end-session");
  expect("full", ROUTES.messageboard, "end-session");
});

test("the restricted notice is not a place to sit out a full ban", () => {
  expect("full", ROUTES.restricted, "end-session");
});

test("an unknown route ends the session", () => {
  expect("full", ROUTES.unknown, "end-session");
});

test("a home and a club end the session", () => {
  expect("full", ROUTES.home, "end-session");
  expect("full", ROUTES.club, "end-session");
});

test("every route in the table answers the same for a full ban", () => {
  for (const route of Object.values(ROUTES)) {
    expect("full", route, "end-session");
  }
});

console.log("\n2. A SENTENCE THIS FILE CANNOT READ IS A REFUSAL, NOT A JAIL");

test("a missing ban type ends the session", () => {
  expect(undefined, ROUTES.jail, "end-session");
  expect(null, ROUTES.jail, "end-session");
});

test("a ban type nobody has heard of ends the session", () => {
  for (const type of ["", "Jail", "JAIL", "jailed", "shadow", "full "]) {
    expect(type, ROUTES.jail, "end-session");
  }
});

console.log("\n3. A JAIL SENTENCE KEEPS THE CITIZEN IN THE CITY");

test("the Jail itself is allowed", () => {
  expect("jail", ROUTES.jail, "allow");
});

test("the news page is allowed - the NEWS button still works", () => {
  expect("jail", ROUTES.news, "allow");
});

test("the restricted notice is allowed, so the refusal can be shown", () => {
  expect("jail", ROUTES.restricted, "allow");
});

test("every other world confines the inmate to the Jail", () => {
  expect("jail", ROUTES.plaza, "confine");
  expect("jail", ROUTES.mall, "confine");
  expect("jail", ROUTES.home, "confine");
  expect("jail", ROUTES.club, "confine");
});

test("an unknown route confines the inmate to the Jail", () => {
  expect("jail", ROUTES.unknown, "confine");
});

test("the place-scoped pages are refused, not confined", () => {
  expect("jail", ROUTES.inbox, "restricted");
  expect("jail", ROUTES.information, "restricted");
  expect("jail", ROUTES.messageboard, "restricted");
});

test("a path that is not a path confines rather than admits", () => {
  expect("jail", undefined, "confine");
  expect("jail", null, "confine");
  assert.strictEqual(
    decideBannedNavigation("jail", 1 as unknown as string), "confine",
  );
});

console.log("\n4. THE GUARD SETTLES STANDING BEFORE IT FETCHES A PLACE");

/** A double quote, so the source snippets below can be written in template literals. */
const Q = String.fromCharCode(34);

const MAIN: string = fs.readFileSync(
  path.resolve(__dirname, "../../../src/main.ts"), "utf8",
);

test("the place fetch is a step of its own, not the guard's opening line", () => {
  assert.ok(
    MAIN.includes("async function stagePlaceFor(to: RouteLocationNormalized)"),
    "the place fetch is no longer its own step",
  );
});

test("the session is read before any place is fetched", () => {
  const session = MAIN.indexOf(`}>(${Q}/member/session${Q})`);
  const fetchPlace = MAIN.indexOf("await stagePlaceFor(to);");
  assert.ok(session > -1, "the session check is gone");
  assert.ok(fetchPlace > -1, "the guard no longer fetches the place");
  assert.ok(
    session < fetchPlace,
    "a place is fetched before the session is read, so a 403 aborts the ban flow again",
  );
});

test("only a navigation that is going to land fetches its place", () => {
  assert.ok(
    /if \(decision === true\) \{\s*await stagePlaceFor\(to\);/.test(MAIN),
    "the place fetch is not gated on the guard's decision",
  );
});

test("the full-ban flow still destroys the client session", () => {
  const banned = MAIN.indexOf("if (banned) {");
  const endSession = MAIN.indexOf(`if (banDecision === ${Q}end-session${Q}) {`);
  const destroy = MAIN.indexOf("appStore.methods.destroySession();", endSession);
  assert.ok(banned > -1 && endSession > banned, "the end-session branch is gone");
  assert.ok(destroy > -1, "the end-session branch no longer destroys the session");
  assert.ok(
    MAIN.indexOf(`name: ${Q}banned${Q},`, destroy) > destroy,
    "the end-session branch no longer sends the citizen to the ban notice",
  );
});

test("the guard has no route test of its own left inside the banned branch", () => {
  const banned = MAIN.indexOf("if (banned) {");
  const afterBan = MAIN.indexOf("appStore.methods.setUser(user);", banned);
  const block = MAIN.slice(banned, afterBan);
  assert.strictEqual(
    /to\.fullPath (===|!==|\.includes)/.test(block), false,
    "a route test is back in the banned branch, where it could outrank the sentence",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
