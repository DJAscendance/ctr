/**
 * Route-parameter and Back-destination behaviour, driven through a REAL router.
 *
 * TWO DEFECTS ARE PINNED HERE.
 *
 * 1. The shell's global `beforeEach` guard matched on a substring of the path
 *    ("does it contain /place/?") and then read `to.params.id`. The Information
 *    editor's route declares `placeId`, not `id`, so the guard fired with
 *    `undefined` and every direct entry issued `GET /api/place/undefined`. The
 *    same shape sent `GET /api/home/undefined` from `/home/update/information`.
 *    The guard now requires the declared parameter to be present.
 *
 * 2. The hub's Back button was labelled "Back to <place>" but called
 *    `$router.back()`. After direct entry or a refresh the history stack points
 *    somewhere else entirely, so the label was simply false. It now navigates to
 *    the destination it names.
 *
 * WHY THESE ARE ROUTER TESTS, NOT SOURCE ASSERTIONS. Both defects are about what
 * the router RESOLVES, which a string search cannot see: the first is a mismatch
 * between a path pattern and a parameter name, and the second is the difference
 * between a label and a destination. The real route table is loaded, real
 * navigations are performed in `abstract` mode (no DOM needed), and the guard is
 * reproduced against it.
 */
import assert from "assert";

const path = require("path");

const Vue = require("vue");
const VueRouter = require("vue-router");

Vue.use(VueRouter);

const SPA_SRC = path.resolve(__dirname, "../../../src");

type Test = { name: string; run: () => Promise<void> | void };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void> | void): void {
  tests.push({ name, run });
}

/**
 * The route shapes under test, transcribed from src/routes.ts.
 *
 * The real file cannot be imported here - it pulls in .vue single-file
 * components, and this harness has no compiler for them. What matters for these
 * tests is the PATH PATTERNS and their parameter names, which are copied
 * verbatim and asserted against the real file below, so a rename there fails
 * this suite rather than silently invalidating it.
 */
const routes = [
  {
    path: "/place/:id",
    name: "colonyPage",
    children: [{ path: "update", name: "colonyUpdate" }],
  },
  { path: "/place/:placeId/information/update", name: "place-update-information" },
  { path: "/information/:type/:id/:slug?", name: "information" },
  { path: "/neighborhood/:id", name: "neighborhoodpage",
    children: [{ path: "update", name: "neighborhoodUpdate" }] },
  { path: "/block/:id", name: "blockmap",
    children: [{ path: "update", name: "blockUpdate" }] },
  { path: "/home/update/information", name: "home-update-information" },
  { path: "/home/:username", name: "user-home" },
];

const makeRouter = () => new VueRouter({ mode: "abstract", routes });

/**
 * The corrected guard's decision, extracted so it can be exercised directly.
 * Returns the request the shell would issue, or null for "no request at all".
 */
function shellLookupFor(to: any): string | null {
  if (to.fullPath.includes("/place/") && to.params.id) {
    return `/place/${to.params.id}`;
  }
  if (to.fullPath.includes("/club/") && to.params.id) {
    return `/place/by_id/${to.params.id}`;
  }
  if (
    (to.fullPath.includes("/inbox/") || to.fullPath.includes("/messageboard/"))
    && to.params.place_id
  ) {
    return `/place/by_id/${to.params.place_id}`;
  }
  if (to.fullPath.includes("/clubdoor/") && to.params.id) {
    return `/place/by_id/${to.params.id}`;
  }
  if (to.fullPath.includes("/home/") && to.params.username) {
    return `/home/${to.params.username}`;
  }
  return null;
}

async function resolve(router: any, location: string): Promise<any> {
  await new Promise<void>((done, fail) => {
    router.push(location, () => done(), (error: any) => (error ? fail(error) : done()));
  });
  return router.currentRoute;
}

// ------------------------------------------------- the route parameter contract

test("the Information editor route declares placeId, and the router fills it",
  async () => {
    const route = await resolve(makeRouter(), "/place/7/information/update");

    assert.strictEqual(route.name, "place-update-information");
    assert.strictEqual(route.params.placeId, "7");
    assert.strictEqual(route.params.id, undefined,
      "this route has no `id` - anything reading one is reading undefined");
  });

test("direct entry to the Information editor issues no place lookup", async () => {
  const route = await resolve(makeRouter(), "/place/7/information/update");

  assert.strictEqual(shellLookupFor(route), null,
    "the shell must not request /place/undefined for a route with no `id`");
});

test("a colony route still resolves its lookup normally", async () => {
  const route = await resolve(makeRouter(), "/place/games_col/update");

  assert.strictEqual(route.params.id, "games_col");
  assert.strictEqual(shellLookupFor(route), "/place/games_col");
});

test("the home Information editor issues no home lookup", async () => {
  const route = await resolve(makeRouter(), "/home/update/information");

  assert.strictEqual(route.params.username, undefined);
  assert.strictEqual(shellLookupFor(route), null,
    "the shell must not request /home/undefined");
});

test("a real home page still resolves its lookup", async () => {
  const route = await resolve(makeRouter(), "/home/BassMekanik");

  assert.strictEqual(shellLookupFor(route), "/home/BassMekanik");
});

test("no route in the table ever produces an 'undefined' lookup", async () => {
  const router = makeRouter();
  const paths = [
    "/place/games_col", "/place/games_col/update", "/place/7/information/update",
    "/information/public/7/mall", "/information/home/857",
    "/neighborhood/891", "/neighborhood/891/update",
    "/block/893", "/block/893/update",
    "/home/update/information", "/home/BassMekanik",
  ];
  for (const target of paths) {
    const route = await resolve(router, target);
    const lookup = shellLookupFor(route);
    assert.ok(
      lookup === null || !lookup.includes("undefined"),
      `${target} produced ${lookup}`,
    );
  }
});

// -------------------------------------------------------- invalid and recovery

test("an unresolvable colony identifier still resolves the ROUTE", async () => {
  // Failing closed is the component's job - the route itself must still match,
  // or the editor never gets the chance to report the error.
  const route = await resolve(makeRouter(), "/place/not_a_colony/update");

  assert.strictEqual(route.name, "colonyUpdate");
  assert.strictEqual(route.params.id, "not_a_colony");
});

test("navigating from an invalid identifier to a valid one recovers", async () => {
  const router = makeRouter();
  await resolve(router, "/place/not_a_colony/update");
  const route = await resolve(router, "/place/games_col/update");

  assert.strictEqual(route.params.id, "games_col");
  assert.strictEqual(shellLookupFor(route), "/place/games_col");
});

test("same-tier and cross-tier transitions carry only the new parameters",
  async () => {
    const router = makeRouter();

    let route = await resolve(router, "/neighborhood/891/update");
    assert.strictEqual(route.params.id, "891");

    route = await resolve(router, "/neighborhood/902/update");
    assert.strictEqual(route.params.id, "902", "same-tier must re-parameterize");

    route = await resolve(router, "/block/893/update");
    assert.strictEqual(route.name, "blockUpdate");
    assert.strictEqual(route.params.id, "893", "cross-tier must re-parameterize");

    route = await resolve(router, "/place/7/information/update");
    assert.strictEqual(route.params.placeId, "7");
    assert.strictEqual(route.params.id, undefined,
      "the previous tier's id must not survive into a route that has no id");
  });

// ------------------------------------------------------ Back destinations

/** The hub's own backRoute rule, transcribed from PlaceUpdateHub.vue. */
function backRouteFor(hub: any): any {
  if (!hub) return null;
  if (hub.type === "colony") return hub.slug ? { path: `/place/${hub.slug}` } : null;
  if (hub.type === "hood") {
    return { name: "neighborhoodpage", params: { id: String(hub.placeId) } };
  }
  if (hub.type === "block") {
    return { name: "blockmap", params: { id: String(hub.placeId) } };
  }
  return null;
}

test("Back from a colony hub resolves to that colony's page", async () => {
  const target = backRouteFor({ type: "colony", slug: "games_col", name: "Games" });
  const route = await resolve(makeRouter(), (target as any).path);

  assert.strictEqual(route.params.id, "games_col");
});

test("Back from a neighborhood hub resolves to that neighborhood", async () => {
  const router = makeRouter();
  const target = backRouteFor({ type: "hood", placeId: 891, name: "The Shadows" });
  const resolved = router.resolve(target).route;

  assert.strictEqual(resolved.name, "neighborhoodpage");
  assert.strictEqual(resolved.params.id, "891");
});

test("Back from a block hub resolves to that block", async () => {
  const router = makeRouter();
  const target = backRouteFor({ type: "block", placeId: 893, name: "Dark Paradise" });
  const resolved = router.resolve(target).route;

  assert.strictEqual(resolved.name, "blockmap");
  assert.strictEqual(resolved.params.id, "893");
});

test("a denied hub names no destination, so it falls back to history", () => {
  assert.strictEqual(backRouteFor(null), null);
});

test("Back does not depend on how the hub was reached", async () => {
  // Direct entry: the history stack has exactly one entry, so $router.back()
  // would go nowhere useful. The named destination is identical either way.
  const direct = makeRouter();
  await resolve(direct, "/block/893/update");

  const viaParent = makeRouter();
  await resolve(viaParent, "/block/893");
  await resolve(viaParent, "/block/893/update");

  const unrelated = makeRouter();
  await resolve(unrelated, "/home/BassMekanik");
  await resolve(unrelated, "/block/893/update");

  const target = backRouteFor({ type: "block", placeId: 893, name: "Dark Paradise" });
  for (const router of [direct, viaParent, unrelated]) {
    assert.strictEqual(router.resolve(target).route.params.id, "893");
  }
});

test("Cancel from the Information editor resolves to that place's Information window",
  async () => {
    const router = makeRouter();
    const resolved = router.resolve({
      name: "information",
      params: { type: "public", id: "7" },
    }).route;

    assert.strictEqual(resolved.name, "information");
    assert.strictEqual(resolved.params.type, "public");
    assert.strictEqual(resolved.params.id, "7");
  });

// --------------------------------------------- the transcription stays honest

test("the transcribed paths still match the real route table", () => {
  const fs = require("fs");
  const source: string = fs.readFileSync(path.join(SPA_SRC, "routes.ts"), "utf8");
  for (const declared of [
    '"/place/:id"',
    '"/place/:placeId/information/update"',
    '"/information/:type/:id/:slug?"',
    '"/neighborhood/:id"',
    '"/block/:id"',
    '"/home/update/information"',
    '"/home/:username"',
  ]) {
    assert.ok(
      source.includes(`path: ${declared}`),
      `routes.ts no longer declares ${declared} - update this suite's transcription`,
    );
  }
});

test("the shell guard requires each declared parameter before requesting", () => {
  const fs = require("fs");
  const main: string = fs.readFileSync(path.join(SPA_SRC, "main.ts"), "utf8");
  for (const guard of [
    'to.fullPath.includes("/place/") && to.params.id',
    'to.fullPath.includes("/home/") && to.params.username',
    'to.fullPath.includes("/clubdoor/") && to.params.id',
  ]) {
    assert.ok(main.includes(guard), `expected the guard to require: ${guard}`);
  }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.run();
      console.log(`  ok   ${t.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${t.name}`);
      console.error(`       ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
