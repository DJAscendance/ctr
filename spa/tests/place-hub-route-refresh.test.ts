/**
 * Behavioral guard for Update hubs refreshing when the route changes.
 *
 * THE DEFECT THIS PINS. `PlaceUpdatePage` and `PlaceUpdateHub` are each one
 * component instance reused across every place of their tier. Both resolved only
 * in `mounted()`, so a same-tier navigation left the previous place on screen -
 * reproduced live on beta at all three tiers - and a failed lookup stayed latched
 * until a full reload.
 *
 * WHAT IS EXERCISED FOR REAL. The shipped load logic lives in
 * helpers/place-hub-load.helper, so these tests drive the SAME controllers the
 * components use: real reset, real token sequencing, real async resolution
 * against an injected HTTP double whose responses can be settled out of order.
 * Route changes are driven by a real vue-router in `abstract` mode - no DOM
 * needed - over the same topology as src/routes.ts, following the precedent in
 * place-form-cancel.test.
 *
 * WHAT IT CANNOT COVER. The components are .vue files and this harness has no
 * compiler for them, so they are not mounted; adding a component-testing stack is
 * out of scope for a hotfix. The delegation from each component to these
 * controllers is therefore pinned by source assertions at the end - deliberately
 * a small, last line of defence behind the behavioural tests above, not a
 * substitute for them.
 *
 * Authorization is server-side and is pinned in
 * api/src/services/place/place-update-hub.service.spec.ts. Nothing here grants
 * anything; a discarded response leaves the state empty, never "allowed".
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");
const Vue = require("vue");
const VueRouter = require("vue-router");

import {
  LoadSequence,
  createHubLoader,
  createPlaceResolver,
  emptyHubState,
  emptyResolveState,
  placeUpdateRouteChanged,
} from "../src/helpers/place-hub-load.helper";

Vue.use(VueRouter);
Vue.config.productionTip = false;
Vue.config.devtools = false;

const SPA_SRC = path.resolve(__dirname, "../../../src");
const HUB_COMPONENT = path.join(SPA_SRC, "components/place/PlaceUpdateHub.vue");
const HUB_PAGE = path.join(SPA_SRC, "pages/place/PlaceUpdatePage.vue");

type Test = { name: string; run: () => Promise<void> | void };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void> | void): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");
const stub = { render(h: any) { return h("div"); } };

/** The real tier topology, enough of it to navigate between Update hubs. */
function makeRouter(): any {
  return new VueRouter({
    mode: "abstract",
    routes: [
      {
        path: "/place/:id",
        component: stub,
        children: [
          { path: "", component: stub, name: "world-browser" },
          { path: "update", component: stub, name: "colonyUpdate" },
        ],
      },
      {
        path: "/neighborhood/:id",
        component: stub,
        children: [
          { path: "", component: stub, name: "neighborhoodpage" },
          { path: "update", component: stub, name: "neighborhoodUpdate" },
        ],
      },
      {
        path: "/block/:id",
        component: stub,
        children: [
          { path: "", component: stub, name: "blockmap" },
          { path: "update", component: stub, name: "blockUpdate" },
        ],
      },
    ],
  });
}

/** A hub payload as the server returns it. */
function hubFor(
  placeId: number,
  type: string,
  name: string,
  slug: string,
  capabilities: string[] = ["update_information"],
): any {
  return { placeId, name, type, slug, canOpen: true, capabilities };
}

const PLACES: Record<string, any> = {
  games_col: { id: 879, slug: "games_col", type: "colony", name: "Games" },
  scifi_col: { id: 880, slug: "scifi_col", type: "colony", name: "Sci-fi" },
};

const COLONY_CAPS = ["update_information", "list_neighborhoods"];
const HOOD_CAPS = ["update_information", "list_blocks"];

const HUBS: Record<number, any> = {
  879: hubFor(879, "colony", "Games", "games_col", COLONY_CAPS),
  880: hubFor(880, "colony", "Sci-fi", "scifi_col", COLONY_CAPS),
  891: hubFor(891, "hood", "The Shadows", "0101020200000000", HOOD_CAPS),
  902: hubFor(902, "hood", "Fantasy Games", "0101020300000000", HOOD_CAPS),
  892: hubFor(892, "block", "Edge Of<BR>Darkness", "0101020201060000"),
  893: hubFor(893, "block", "Dark Paradise", "0101020201070000"),
};

const CHILDREN: Record<string, any[]> = {
  "/colony/games_col/hoods": [{ id: 891, name: "The Shadows" }],
  "/colony/scifi_col/hoods": [{ id: 940, name: "Star Fleet" }],
  "/hood/891/blocks": [{ id: 892, name: "Edge Of<BR>Darkness" }],
  "/hood/902/blocks": [{ id: 950, name: "Dice" }],
};

/**
 * An HTTP double that resolves immediately unless a URL is put on hold, in which
 * case its promise is parked and released by the test. That is how out-of-order
 * settlement is produced deliberately rather than hoped for.
 */
function makeHttp() {
  const held: Record<string, () => void> = {};
  const calls: string[] = [];
  const http = {
    hold(url: string): void {
      held[url] = () => undefined;
    },
    release(url: string): void {
      const fn = held[url];
      delete held[url];
      if (fn) fn();
    },
    calls,
    get(url: string): Promise<{ data: any }> {
      calls.push(url);
      const body = (): any => {
        const place = Object.keys(PLACES).find((slug) => url === `/place/${slug}`);
        if (place) return { place: PLACES[place] };
        const hubMatch = url.match(/^\/place\/(\d+)\/update-hub$/);
        if (hubMatch) {
          const hub = HUBS[Number(hubMatch[1])];
          if (!hub) throw new Error("404");
          return { hub };
        }
        if (CHILDREN[url]) {
          return url.includes("/hoods")
            ? { hoods: CHILDREN[url] }
            : { blocks: CHILDREN[url] };
        }
        throw new Error(`unexpected url ${url}`);
      };
      if (Object.prototype.hasOwnProperty.call(held, url)) {
        return new Promise((resolve, reject) => {
          held[url] = () => {
            try {
              resolve({ data: body() });
            } catch (e) {
              reject(e);
            }
          };
        });
      }
      try {
        return Promise.resolve({ data: body() });
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
  return http;
}

/** Lets every already-resolved promise settle. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// 1-3. Same-tier navigation without a remount, at each tier.
// ---------------------------------------------------------------------------

test("colony A -> colony B re-resolves instead of keeping colony A", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  await resolver.reload("games_col", "colony");
  assert.strictEqual(resolver.state.placeId, 879, "should start on Games");

  await resolver.reload("scifi_col", "colony");
  assert.strictEqual(
    resolver.state.placeId,
    880,
    "colony hub kept the previous colony after navigating - the reported defect",
  );
  assert.strictEqual(resolver.state.unresolved, false);
});

test("neighborhood A -> neighborhood B re-resolves", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  await resolver.reload("891", "hood");
  assert.strictEqual(resolver.state.placeId, 891);

  await resolver.reload("902", "hood");
  assert.strictEqual(resolver.state.placeId, 902, "kept the previous neighborhood");
});

test("block A -> block B re-resolves", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  await resolver.reload("892", "block");
  assert.strictEqual(resolver.state.placeId, 892);

  await resolver.reload("893", "block");
  assert.strictEqual(resolver.state.placeId, 893, "kept the previous block");
});

test("the hub itself reloads when the resolved id changes", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  await loader.reload(892, "block");
  assert.strictEqual(loader.state.hub.name, "Edge Of<BR>Darkness");

  await loader.reload(893, "block");
  assert.strictEqual(
    loader.state.hub.name,
    "Dark Paradise",
    "hub content stayed on the previous block",
  );
});

// ---------------------------------------------------------------------------
// 4-5. A failed lookup must not latch.
// ---------------------------------------------------------------------------

test("invalid colony route -> valid colony route clears the error", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  // A numeric id where the colony route expects a slug: the live reproduction.
  await resolver.reload("879", "colony");
  assert.strictEqual(resolver.state.unresolved, true, "expected the lookup to fail");
  assert.strictEqual(resolver.state.placeId, 0);

  await resolver.reload("games_col", "colony");
  assert.strictEqual(
    resolver.state.unresolved,
    false,
    "'Insufficient access rights' stayed latched after navigating to a valid colony",
  );
  assert.strictEqual(resolver.state.placeId, 879);
});

test("valid -> invalid -> valid ends resolved, showing no stale place between", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  await resolver.reload("games_col", "colony");
  assert.strictEqual(resolver.state.placeId, 879);

  await resolver.reload("nope_col", "colony");
  assert.strictEqual(resolver.state.unresolved, true);
  assert.strictEqual(
    resolver.state.placeId,
    0,
    "a failed lookup must not leave the previous place addressable",
  );

  await resolver.reload("scifi_col", "colony");
  assert.strictEqual(resolver.state.placeId, 880);
  assert.strictEqual(resolver.state.unresolved, false);
});

test("a denied hub does not keep the previous hub's tiles", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  await loader.reload(891, "hood");
  assert.strictEqual(loader.state.hub.name, "The Shadows");
  assert.ok(loader.state.children.length > 0);

  // A tier mismatch: the stored row is a hood, the URL claimed a block.
  await loader.reload(891, "block");
  assert.strictEqual(loader.state.denied, true);
  assert.strictEqual(loader.state.hub, null, "denied hub still exposed the previous place");
  assert.deepStrictEqual(loader.state.children, [], "denied hub still listed previous children");
});

// ---------------------------------------------------------------------------
// 6. Out-of-order responses.
// ---------------------------------------------------------------------------

test("rapid A -> B -> C: earlier responses cannot overwrite the newest", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  http.hold("/place/879/update-hub");
  http.hold("/place/880/update-hub");

  const a = loader.reload(879, "colony");
  const b = loader.reload(880, "colony");
  const c = loader.reload(891, "hood"); // newest, settles immediately
  await c;

  assert.strictEqual(loader.state.hub.placeId, 891, "C should be showing");

  // Now let the two older loads answer, in the worst order.
  http.release("/place/880/update-hub");
  http.release("/place/879/update-hub");
  await a;
  await b;
  await flush();

  assert.strictEqual(
    loader.state.hub.placeId,
    891,
    "an older in-flight response overwrote the current place",
  );
  assert.strictEqual(loader.state.hub.name, "The Shadows");
});

test("rapid resolves settle to the last route requested", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  http.hold("/place/games_col");
  const first = resolver.reload("games_col", "colony");
  const second = resolver.reload("scifi_col", "colony");
  await second;
  assert.strictEqual(resolver.state.placeId, 880);

  http.release("/place/games_col");
  await first;
  await flush();
  assert.strictEqual(
    resolver.state.placeId,
    880,
    "the superseded colony lookup won the race",
  );
});

test("a superseded failure cannot latch onto the current place", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  http.hold("/place/nope_col");
  const failing = resolver.reload("nope_col", "colony");
  const good = resolver.reload("games_col", "colony");
  await good;

  http.release("/place/nope_col");
  await failing;
  await flush();

  assert.strictEqual(resolver.state.unresolved, false, "stale failure latched the error");
  assert.strictEqual(resolver.state.placeId, 879);
});

// ---------------------------------------------------------------------------
// 7-8. Nothing of A survives into B.
// ---------------------------------------------------------------------------

test("no field of the previous place survives the start of a new load", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  await loader.reload(891, "hood");
  assert.ok(loader.state.hub && loader.state.children.length > 0);

  http.hold("/place/902/update-hub");
  const pending = loader.reload(902, "hood");

  // Mid-flight: this is what the member sees while B loads.
  assert.deepStrictEqual(
    loader.state,
    emptyHubState(),
    "previous place still visible while the next one loads",
  );

  http.release("/place/902/update-hub");
  await pending;
  assert.strictEqual(loader.state.hub.name, "Fantasy Games");
});

test("the resolved id is cleared first, so no tile can target the old place", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);

  await resolver.reload("games_col", "colony");
  assert.strictEqual(resolver.state.placeId, 879);

  http.hold("/place/scifi_col");
  const pending = resolver.reload("scifi_col", "colony");
  assert.deepStrictEqual(
    resolver.state,
    emptyResolveState(),
    "a tile clicked mid-navigation would still have targeted the previous colony",
  );

  http.release("/place/scifi_col");
  await pending;
  assert.strictEqual(resolver.state.placeId, 880);
});

test("tiles and children come from the newly loaded hub, never the previous one", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  await loader.reload(891, "hood");
  assert.deepStrictEqual(loader.state.children.map((c: any) => c.id), [892]);

  await loader.reload(902, "hood");
  assert.deepStrictEqual(
    loader.state.children.map((c: any) => c.id),
    [950],
    "child list still belonged to the previous neighborhood",
  );
  assert.strictEqual(loader.state.hub.placeId, 902);
});

// ---------------------------------------------------------------------------
// 9. A full page load still works, and the router decides when to reload.
// ---------------------------------------------------------------------------

test("a first load with no previous route resolves normally", async () => {
  const http = makeHttp();
  const resolver = createPlaceResolver(http as any);
  const loader = createHubLoader(http as any);

  await resolver.reload("892", "block");
  await loader.reload(resolver.state.placeId, "block");

  assert.strictEqual(resolver.state.placeId, 892);
  assert.strictEqual(loader.state.loaded, true);
  assert.strictEqual(loader.state.denied, false);
  assert.strictEqual(loader.state.hub.name, "Edge Of<BR>Darkness");
});

test("real router navigations between hubs are recognised as place changes", async () => {
  const router = makeRouter();
  const seen: boolean[] = [];
  let previous: any = null;

  const visit = async (path: string): Promise<void> => {
    await router.push(path);
    const current = router.currentRoute;
    if (previous) seen.push(placeUpdateRouteChanged(current, previous));
    previous = { name: current.name, params: { ...current.params } };
  };

  await visit("/place/games_col/update");
  await visit("/place/scifi_col/update");      // colony -> colony
  await visit("/neighborhood/891/update");     // tier change
  await visit("/neighborhood/902/update");     // hood -> hood
  await visit("/block/892/update");            // tier change
  await visit("/block/893/update");            // block -> block

  assert.deepStrictEqual(
    seen,
    [true, true, true, true, true],
    "every hub-to-hub navigation must be treated as a place change",
  );
});

test("a same-place navigation is not treated as a place change", () => {
  const same = { name: "blockUpdate", params: { id: "892" } };
  assert.strictEqual(placeUpdateRouteChanged(same, { ...same }), false);
  // Same id, different tier - genuinely a different place.
  assert.strictEqual(
    placeUpdateRouteChanged(
      { name: "blockUpdate", params: { id: "5" } },
      { name: "neighborhoodUpdate", params: { id: "5" } },
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// 10. Fail-closed.
// ---------------------------------------------------------------------------

test("an unknown place is denied, not rendered", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  await loader.reload(4242, "block");
  assert.strictEqual(loader.state.denied, true);
  assert.strictEqual(loader.state.hub, null);
});

test("a hub without canOpen is denied even though the request succeeded", async () => {
  const http = {
    get: () =>
      Promise.resolve({
        data: {
          hub: {
            placeId: 5,
            type: "block",
            name: "X",
            slug: "s",
            canOpen: false,
            capabilities: ["moderate_inbox"],
          },
        },
      }),
  };
  const loader = createHubLoader(http as any);

  await loader.reload(5, "block");
  assert.strictEqual(loader.state.denied, true, "canOpen:false must refuse");
  assert.strictEqual(loader.state.hub, null);
});

test("a discarded response leaves the state empty, never allowed", async () => {
  const http = makeHttp();
  const loader = createHubLoader(http as any);

  http.hold("/place/892/update-hub");
  const stale = loader.reload(892, "block");
  // Supersede it with a load that will never be released.
  http.hold("/place/893/update-hub");
  const current = loader.reload(893, "block");

  http.release("/place/892/update-hub");
  await stale;
  await flush();

  assert.deepStrictEqual(
    loader.state,
    emptyHubState(),
    "a superseded response must not populate the hub",
  );

  http.release("/place/893/update-hub");
  await current;
  assert.strictEqual(loader.state.hub.placeId, 893);
});

test("a failed child listing is not a refusal", async () => {
  const http = {
    get: (url: string) => {
      if (url.endsWith("/update-hub")) {
        return Promise.resolve({ data: { hub: HUBS[891] } });
      }
      return Promise.reject(new Error("boom"));
    },
  };
  const loader = createHubLoader(http as any);

  await loader.reload(891, "hood");
  assert.strictEqual(loader.state.denied, false, "child failure must not deny the hub");
  assert.strictEqual(loader.state.hub.name, "The Shadows");
  assert.deepStrictEqual(loader.state.children, []);
});

test("LoadSequence only ever calls the newest token current", () => {
  const sequence = new LoadSequence();
  const a = sequence.begin();
  const b = sequence.begin();
  const c = sequence.begin();

  assert.strictEqual(sequence.isStale(a), true);
  assert.strictEqual(sequence.isStale(b), true);
  assert.strictEqual(sequence.isStale(c), false);
  assert.ok(c > b && b > a, "tokens must be monotonic");
});

// ---------------------------------------------------------------------------
// Delegation. The last line of defence, behind the behavioural tests above.
// ---------------------------------------------------------------------------

test("both components delegate their loading to the shared controllers", () => {
  const page = read(HUB_PAGE);
  const hub = read(HUB_COMPONENT);

  assert.ok(
    /createPlaceResolver/.test(page),
    "PlaceUpdatePage must use the shared resolver, not its own mounted-only lookup",
  );
  assert.ok(
    /watch:[\s\S]*\$route\(/.test(page),
    "PlaceUpdatePage must react to route changes",
  );
  assert.ok(
    /createHubLoader/.test(hub),
    "PlaceUpdateHub must use the shared loader",
  );
  assert.ok(
    /watch:[\s\S]*placeId\(/.test(hub),
    "PlaceUpdateHub must reload when the resolved place id changes",
  );
});

test("neither component keeps its own resettable copy of place state", () => {
  const hub = read(HUB_COMPONENT);
  const data = hub.slice(hub.indexOf("data()"), hub.indexOf("computed:"));

  for (const field of ["hub:", "children:", "denied:", "loaded:"]) {
    assert.ok(
      !data.includes(field),
      `PlaceUpdateHub must not hold its own '${field}' - state lives in the `
        + "loader so the reset cannot forget it",
    );
  }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.run();
      console.log(`  ok   ${t.name}`);
    } catch (e) {
      failed += 1;
      console.error(`  FAIL ${t.name}`);
      console.error(`       ${(e as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
})();
