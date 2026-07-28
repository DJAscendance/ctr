/**
 * Behavioral guard for Cancel on the shared place forms.
 *
 * Message to All and Inbox to All are each ONE component mounted under three
 * parents as a named child with an EMPTY path, so a form's URL is identical to
 * its parent place view's URL. The previous Cancel pushed `$route.path`, which
 * cannot say WHICH of those identically-addressed routes it means: vue-router
 * answers with the first empty-path child declared. That happens to be the place
 * view today, so Cancel worked - by declaration order, not by intent. Reorder the
 * siblings and the same push resolves back to the form, and Cancel silently does
 * nothing. The first test below demonstrates exactly that.
 *
 * A review reported the mechanism as a duplicate-navigation abort. That does NOT
 * reproduce on vue-router 3.5.2: verified in the running preview against the
 * pre-fix bundle, Cancel moved the active route from `colonyInboxToAll` to
 * `world-browser`. The fragility is real, the abort is not, and the `.catch()`
 * that was removed had never fired.
 *
 * The other SPA suites are source-inspection guards. This one is not: it builds
 * a real vue-router in `abstract` mode - which needs no DOM and so runs in this
 * dependency-free harness - over the SAME route topology as `src/routes.ts`,
 * including the empty-path sibling children that cause the aliasing. It then
 * performs real navigations and asserts where the router actually ends up.
 *
 * What that cannot cover: the components are .vue files and this harness has no
 * compiler for them, so the form components themselves are not mounted. The
 * decision they delegate to (`placeFormReturnTarget`) is exercised for real
 * here, and their use of it is pinned by source assertions at the end.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");
const Vue = require("vue");
const VueRouter = require("vue-router");

import {
  PLACE_FORM_FALLBACK,
  PLACE_FORM_PARENT_ROUTE,
  placeFormReturnTarget,
} from "../src/helpers/place-form-return.helper";

Vue.use(VueRouter);
Vue.config.productionTip = false;
Vue.config.devtools = false;

const SPA_SRC = path.resolve(__dirname, "../../../src");
const ROUTES = path.join(SPA_SRC, "routes.ts");
const MESSAGE_TO_ALL = path.join(SPA_SRC, "pages/MessageToAll.vue");
const INBOX_TO_ALL = path.join(SPA_SRC, "pages/InboxToAll.vue");

type Test = { name: string; run: () => Promise<void> | void };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void> | void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");
const stub = { render(h: any) { return h("div"); } };

/**
 * The real topology, reproduced: each place parent has several children with an
 * empty path, the FIRST of which is the place view. That ordering is what makes
 * the form and the place view share a URL, so the test reproduces the hazard
 * rather than a tidied-up version of it.
 */
function buildRouter(): any {
  return new VueRouter({
    mode: "abstract",
    routes: [
      {
        path: "/place/:id",
        component: stub,
        children: [
          { path: "", component: stub, name: "world-browser" },
          { path: "", component: stub, name: "worldAccessRights" },
          { path: "", component: stub, name: "colonyMessageToAll" },
          { path: "", component: stub, name: "colonyInboxToAll" },
          { path: "update", component: stub, name: "colonyUpdate" },
        ],
      },
      {
        path: "/neighborhood/:id",
        component: stub,
        children: [
          { path: "", component: stub, name: "neighborhoodpage" },
          { path: "", component: stub, name: "neighborhoodMessageToAll" },
          { path: "", component: stub, name: "neighborhoodInboxToAll" },
          { path: "update", component: stub, name: "neighborhoodUpdate" },
        ],
      },
      {
        path: "/block/:id",
        component: stub,
        children: [
          { path: "", component: stub, name: "blockmap" },
          { path: "", component: stub, name: "blockMessageToAll" },
          { path: "", component: stub, name: "blockInboxToAll" },
          { path: "update", component: stub, name: "blockUpdate" },
        ],
      },
    ],
  });
}

/** Every tier, both forms, and the place view each must return to. */
const CASES: Array<{ tier: string; form: string; parent: string; id: string }> = [
  { tier: "Colony", form: "colonyMessageToAll", parent: "world-browser", id: "games_col" },
  { tier: "Colony", form: "colonyInboxToAll", parent: "world-browser", id: "games_col" },
  { tier: "Neighborhood", form: "neighborhoodMessageToAll", parent: "neighborhoodpage", id: "891" },
  { tier: "Neighborhood", form: "neighborhoodInboxToAll", parent: "neighborhoodpage", id: "891" },
  { tier: "Block", form: "blockMessageToAll", parent: "blockmap", id: "892" },
  { tier: "Block", form: "blockInboxToAll", parent: "blockmap", id: "892" },
];

// --------------------------------------- why a path is not a safe destination

/** The same parent, with its empty-path children in a chosen order. */
function routerWithOrder(names: string[]): any {
  return new VueRouter({
    mode: "abstract",
    routes: [
      {
        path: "/block/:id",
        component: stub,
        children: names.map(name => ({ path: "", component: stub, name })),
      },
    ],
  });
}

test("a path push resolves by SIBLING ORDER, not by destination", async () => {
  // This is the real hazard, and it is why Cancel must name where it is going.
  //
  // Every one of these children answers to the same URL, so `{ path }` cannot
  // express which one is wanted - vue-router simply returns the FIRST empty-path
  // child. Today the place view happens to be declared first, so pushing the
  // form's own path lands on it by luck of declaration order.
  const asDeclared = routerWithOrder(["blockmap", "blockMessageToAll"]);
  await asDeclared.push({ name: "blockMessageToAll", params: { id: "892" } });
  await asDeclared.push({ path: asDeclared.currentRoute.path });
  assert.strictEqual(
    asDeclared.currentRoute.name,
    "blockmap",
    "with the place view declared first, a path push happens to work",
  );

  // Reorder the siblings - a routine edit, with no reason to suspect it affects
  // Cancel - and the same path now resolves to the form itself. Cancel would
  // silently do nothing, which is exactly the failure mode a path-based
  // destination invites.
  const reordered = routerWithOrder(["blockMessageToAll", "blockmap"]);
  await reordered.push({ name: "blockMessageToAll", params: { id: "892" } });
  await reordered.push({ path: reordered.currentRoute.path }).catch(() => undefined);
  assert.strictEqual(
    reordered.currentRoute.name,
    "blockMessageToAll",
    "reordered, the path resolves back to the form - Cancel goes nowhere",
  );

  // The named destination is unaffected by declaration order, which is the whole
  // reason for naming it.
  await reordered.push(
    placeFormReturnTarget(reordered.currentRoute.name, reordered.currentRoute.params),
  );
  assert.strictEqual(
    reordered.currentRoute.name,
    "blockmap",
    "a named destination survives any sibling reordering",
  );
});

// ----------------------------------------------------- the fixed behavior

for (const { tier, form, parent, id } of CASES) {
  test(`${tier} ${form}: Cancel lands on the parent place view`, async () => {
    const router = buildRouter();
    await router.push({ name: form, params: { id } });
    assert.strictEqual(router.currentRoute.name, form, "precondition: on the form");

    // Exactly what the component's switchView() does.
    const target = placeFormReturnTarget(
      router.currentRoute.name,
      router.currentRoute.params,
    );
    await router.push(target);

    assert.strictEqual(
      router.currentRoute.name,
      parent,
      `Cancel must change the active route to ${parent}`,
    );
    assert.strictEqual(
      router.currentRoute.params.id,
      id,
      "and return to the SAME place, not a default one",
    );
  });
}

test("Cancel works on a form entered directly, with no history behind it", async () => {
  // A fresh router: the form is the first navigation there has ever been, so
  // there is nothing to go 'back' to. The destination must still be valid.
  for (const { form, parent, id } of CASES) {
    const router = buildRouter();
    await router.push({ name: form, params: { id } });
    assert.strictEqual(router.currentRoute.name, form);
    await router.push(
      placeFormReturnTarget(router.currentRoute.name, router.currentRoute.params),
    );
    assert.strictEqual(
      router.currentRoute.name,
      parent,
      `${form} must resolve a destination without relying on history`,
    );
  }
});

test("browser Back still works after Cancel", async () => {
  const router = buildRouter();
  await router.push({ name: "blockmap", params: { id: "892" } });
  await router.push({ name: "blockMessageToAll", params: { id: "892" } });
  await router.push(
    placeFormReturnTarget(router.currentRoute.name, router.currentRoute.params),
  );
  assert.strictEqual(router.currentRoute.name, "blockmap");

  // Cancel pushed rather than replaced, so history is intact and Back returns to
  // the form the citizen was filling in.
  await new Promise<void>(resolve => {
    router.go(-1);
    setTimeout(resolve, 0);
  });
  assert.strictEqual(
    router.currentRoute.name,
    "blockMessageToAll",
    "Back must still traverse the history Cancel added to",
  );
});

test("an unmapped form falls back to a destination that always resolves", async () => {
  const router = buildRouter();
  const target = placeFormReturnTarget("someFutureTierMessageToAll", { id: "1" });
  assert.deepStrictEqual(target, {
    name: PLACE_FORM_FALLBACK.name,
    params: { ...PLACE_FORM_FALLBACK.params },
  });
  await router.push(target);
  assert.strictEqual(
    router.currentRoute.name,
    PLACE_FORM_FALLBACK.name,
    "the fallback must be a real, resolvable route",
  );
});

test("every mapped destination exists in the real routes file", () => {
  const routes = read(ROUTES);
  const parents = new Set(Object.values(PLACE_FORM_PARENT_ROUTE));
  parents.add(PLACE_FORM_FALLBACK.name);
  for (const name of parents) {
    assert.ok(
      new RegExp(`name: "${name}"`).test(routes),
      `${name} must be a real route in src/routes.ts`,
    );
  }
  // And every form route the map covers must exist too, so a rename cannot leave
  // the map silently pointing at nothing.
  for (const form of Object.keys(PLACE_FORM_PARENT_ROUTE)) {
    assert.ok(
      new RegExp(`name: "${form}"`).test(routes),
      `${form} must be a real route in src/routes.ts`,
    );
  }
});

test("each mapped parent is its place's DEFAULT child, not some other screen", () => {
  const routes = read(ROUTES);
  const blocks: Array<[string, string, string]> = [
    ["/place/:id", "/login", "world-browser"],
    ["/neighborhood/:id", "/block/:id", "neighborhoodpage"],
    ["/block/:id", "/home/update", "blockmap"],
  ];
  for (const [start, end, expected] of blocks) {
    const section = routes.slice(
      routes.indexOf(`path: "${start}"`),
      routes.indexOf(`path: "${end}"`),
    );
    assert.ok(section.length > 0, `expected the ${start} route block`);
    const firstNamed = /path: ""[\s\S]*?name: "([^"]+)"/.exec(section);
    assert.ok(firstNamed, `expected an empty-path child under ${start}`);
    assert.strictEqual(
      firstNamed![1],
      expected,
      `${expected} must be the first empty-path child of ${start} - the view its URL resolves to`,
    );
  }
});

// ------------------------------------------------- the components use it

test("both forms delegate Cancel to the shared helper and mutate nothing", () => {
  for (const [label, file] of [
    ["Message to All", MESSAGE_TO_ALL],
    ["Inbox to All", INBOX_TO_ALL],
  ] as Array<[string, string]>) {
    const source = read(file);
    const start = source.indexOf("switchView(): void {");
    assert.ok(start > -1, `${label} must have a Cancel handler`);
    const body = source.slice(start, source.indexOf("},", start));

    assert.ok(
      /placeFormReturnTarget\(\s*this\.\$route\.name,/.test(body),
      `${label}: Cancel must resolve its destination by ROUTE NAME`,
    );
    assert.ok(
      /this\.\$router\.push\(target\)/.test(body),
      `${label}: Cancel must navigate to that destination`,
    );
    assert.ok(
      !/\$http\.|post\(/i.test(body),
      `${label}: Cancel must issue no request`,
    );
    // The catch existed only to swallow the duplicate-navigation abort. With a
    // correct destination there is nothing benign left to hide.
    assert.ok(
      !/\.catch\(/.test(body),
      `${label}: no catch may hide a failed Cancel navigation`,
    );
    assert.ok(
      !/\$route\.path/.test(body),
      `${label}: a path aliases the form and the place view - never navigate by it`,
    );
  }
});

// ------------------------------------------------------------------ run

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failures++;
      console.error(`  FAIL ${name}`);
      console.error(`       ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
})();
