/**
 * A cancelled navigation must not write `appStore.data.place`.
 *
 * WHAT IS BEING GUARDED. `router.beforeEach` in `spa/src/main.ts` fetches the place for
 * the route it is asked about. That fetch is asynchronous, and vue-router never tells an
 * in-flight `.then` that its navigation has gone, so an answer for a place the citizen
 * never reached could land on top of the place they are standing in. A navigation is lost
 * two ways, and the second is the nastier one:
 *
 *   * SUPERSEDED. A later navigation starts, so `confirmTransition` sets `pending` to the
 *     new route and the earlier navigation is cancelled when its guard calls `next()`.
 *   * DUPLICATE ABORT. The citizen asks again for the route the app is still on. That is
 *     `isSameRoute(route, current)`, so vue-router refuses it as redundant - but it sets
 *     `pending` to it FIRST, so the navigation already in flight is cancelled, and NO
 *     guard runs for the duplicate at all. Nothing re-fetches the place the citizen is
 *     standing in, so nothing corrects the store afterwards. The in-flight answer simply
 *     wins, and the store ends up naming a place the route never reached.
 *
 * HOW THIS TESTS IT. With the REAL `vue-router` 3.5.2 the SPA ships, in `abstract` mode so
 * no DOM is needed, driven by a place fetch this suite resolves BY HAND. Nothing here
 * depends on which callback usually finishes first and nothing here waits on a timer to
 * make a point: every race is ordered explicitly.
 *
 * Every race is run against BOTH designs, so the suite states the old behaviour as well as
 * the new, and the legacy cases are real negative controls - they assert that the old
 * design DID corrupt the store, so they fail loudly if the defect is ever misdescribed:
 *
 *   "legacy" - what `main.ts` used to do: write the store from inside the guard.
 *   "staged" - what it does now: stage against the navigation, commit from `afterEach`.
 *
 * Six parts:
 *
 *   1. STAGING          - the helper on its own, including the WeakMap contract.
 *   2. NORMAL           - an ordinary tour of the city, both designs.
 *   3. DUPLICATE ABORT  - the duplicate-route race. Legacy MUST fail it.
 *   4. SUPERSEDED       - a superseded navigation, resolving last, may not win.
 *   5. RAPID            - one fast pair, then seven rapid navigations.
 *   6. CONTRACT         - after every navigation the store names the landed route.
 *
 * The places here are ordinary ones - Plaza, Mall, Club, Flea Market. The broken contract
 * is generic and so is this suite: nothing in it knows about any particular world.
 */
import assert from "assert";
// The app's webpack build resolves "vue" to the Vue 3 migration build (see vue.config.js).
// This suite runs in plain Node, where no webpack alias applies, so it names @vue/compat
// outright - otherwise it would exercise a different Vue from the one the SPA ships.
import Vue from "@vue/compat";
import VueRouter, { Route } from "vue-router";

import { NavigationScopedValue } from "../src/helpers/navigation-place.helper";

Vue.config.productionTip = false;
Vue.config.devtools = false;
Vue.use(VueRouter);

let passed = 0;
let failed = 0;

function test(name: string, body: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1;
      console.log(`  ok   ${name}`);
    })
    .catch((error: Error) => {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${error.message}`);
    });
}

/* ------------------------------------------------------------------ */
/* The stand-in city.                                                  */

interface Place {
  id: number;
  name: string;
  slug: string;
}

const PLACES: { [slug: string]: Place } = {
  enter: { id: 1, name: "The Plaza", slug: "enter" },
  mall: { id: 2, name: "The Mall", slug: "mall" },
  club: { id: 3, name: "The Club", slug: "club" },
  fleamarket: { id: 4, name: "The Flea Market", slug: "fleamarket" },
};

const BLANK = { render: (h: any) => h("div") };

/** One `/api/place/<slug>` call the suite has not answered yet. */
interface InFlight {
  slug: string;
  answer: () => void;
}

interface Harness {
  store: { place: Place | null };
  router: VueRouter;
  inFlight: InFlight[];
  /** Navigations vue-router refused or cancelled, newest last. */
  failures: string[];
  /** Every route `afterEach` was given, in order. */
  landed: string[];
  // The base `no-unused-vars` rule misreads the parameter name of a TS function type as
  // a real binding, the same way it does in `navigation-place.helper.ts`.
  // eslint-disable-next-line no-unused-vars
  go: (slug: string) => void;
  // eslint-disable-next-line no-unused-vars
  answer: (slug: string) => Promise<void>;
  answerAll: () => Promise<void>;
  settle: () => Promise<void>;
}

/** Lets every already-queued microtask and macrotask run. */
function settle(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0))
    .then(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
    .then(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
}

/**
 * Builds a router wired exactly like `main.ts`, in one of the two designs.
 *
 * The place fetch does not resolve on its own: it parks an entry in `inFlight` and waits
 * for the suite to answer it, which is what makes every race here deterministic.
 */
function buildHarness(design: "legacy" | "staged"): Harness {
  const store: { place: Place | null } = { place: null };
  const inFlight: InFlight[] = [];
  const failures: string[] = [];
  const landed: string[] = [];

  const router = new VueRouter({
    mode: "abstract",
    routes: [
      { path: "/", name: "home", component: BLANK },
      { path: "/place/:id", name: "place", component: BLANK },
      { path: "/information", name: "information", component: BLANK },
    ],
  });

  const navigationPlace = new NavigationScopedValue<Place>(place => {
    store.place = place;
  });

  router.beforeEach(async (to, from, next) => {
    if (to.fullPath.indexOf("/place/") === 0) {
      const place = await new Promise<Place>(resolve => {
        inFlight.push({
          slug: to.params.id,
          answer: () => resolve(PLACES[to.params.id]),
        });
      });
      if (design === "legacy") {
        // What main.ts used to do, and the whole defect: an answer that belongs to a
        // navigation nobody is on any more still lands in the store.
        store.place = place;
      } else {
        navigationPlace.stage(to, place);
      }
    }
    next();
  });

  router.afterEach((to: Route) => {
    landed.push(to.fullPath);
    if (design === "staged") {
      navigationPlace.confirm(to);
    }
  });

  function go(slug: string): void {
    const path = slug === "information" ? "/information" : `/place/${slug}`;
    const result = router.push(path) as unknown as Promise<unknown>;
    if (result && typeof result.catch === "function") {
      result.catch((error: Error) => {
        failures.push(`${slug}: ${error.message.split("\n")[0]}`);
      });
    }
  }

  async function answer(slug: string): Promise<void> {
    const index = inFlight.findIndex(entry => entry.slug === slug);
    assert.ok(index >= 0, `no in-flight place fetch for "${slug}"`);
    const entry = inFlight[index];
    inFlight.splice(index, 1);
    entry.answer();
    await settle();
  }

  async function answerAll(): Promise<void> {
    while (inFlight.length > 0) {
      const entry = inFlight.shift() as InFlight;
      entry.answer();
      await settle();
    }
  }

  return { store, router, inFlight, failures, landed, go, answer, answerAll, settle };
}

/** Puts a harness in a place and leaves nothing in flight. */
async function stand(harness: Harness, slug: string): Promise<void> {
  harness.go(slug);
  await settle();
  await harness.answer(slug);
  assert.strictEqual(harness.router.currentRoute.fullPath, `/place/${slug}`);
}

/* ------------------------------------------------------------------ */

async function run(): Promise<void> {
  /* ---------------------------------------------- 1. STAGING ---- */
  console.log("\n1. STAGING");

  await test("a staged value is committed when its own navigation is confirmed", () => {
    const written: string[] = [];
    const staging = new NavigationScopedValue<string>(value => written.push(value));
    const navigation = {};
    staging.stage(navigation, "The Club");
    assert.strictEqual(staging.isStaged(navigation), true);
    assert.strictEqual(staging.confirm(navigation), true);
    assert.deepStrictEqual(written, ["The Club"]);
  });

  await test("a value staged by another navigation cannot ride in on a confirmation", () => {
    const written: string[] = [];
    const staging = new NavigationScopedValue<string>(value => written.push(value));
    const cancelled = {};
    const landedNav = {};
    staging.stage(cancelled, "The Plaza");
    assert.strictEqual(staging.confirm(landedNav), false);
    assert.deepStrictEqual(written, []);
    assert.strictEqual(staging.isStaged(cancelled), true);
  });

  await test("confirming twice commits once", () => {
    const written: string[] = [];
    const staging = new NavigationScopedValue<string>(value => written.push(value));
    const navigation = {};
    staging.stage(navigation, "The Mall");
    staging.confirm(navigation);
    assert.strictEqual(staging.confirm(navigation), false);
    assert.deepStrictEqual(written, ["The Mall"]);
  });

  await test("staging twice for one navigation keeps the later answer", () => {
    const written: string[] = [];
    const staging = new NavigationScopedValue<string>(value => written.push(value));
    const navigation = {};
    staging.stage(navigation, "first");
    staging.stage(navigation, "second");
    staging.confirm(navigation);
    assert.deepStrictEqual(written, ["second"]);
  });

  await test("a navigation that staged nothing commits nothing", () => {
    const written: string[] = [];
    const staging = new NavigationScopedValue<string>(value => written.push(value));
    assert.strictEqual(staging.confirm({}), false);
    assert.deepStrictEqual(written, []);
  });

  await test("a confirmed navigation keeps no staged state afterwards", () => {
    const staging = new NavigationScopedValue<string>(() => undefined);
    const navigation = {};
    staging.stage(navigation, "The Plaza");
    staging.confirm(navigation);
    // The entry is dropped on commit, so a landed navigation cannot be replayed and
    // cannot hold its place value alive once vue-router is done with the route.
    assert.strictEqual(staging.isStaged(navigation), false);
  });

  await test("the staging map is keyed weakly, so a cancelled navigation is collectable", () => {
    const staging = new NavigationScopedValue<string>(() => undefined);
    // A cancelled navigation is never confirmed, so its entry is never deleted by hand.
    // It must not be held by a strong reference, or every lost navigation would leak its
    // place forever. The map itself is the contract being asserted here.
    assert.strictEqual(
      Object.getPrototypeOf(staging["staged" as keyof typeof staging]), WeakMap.prototype,
      "staged values must be held in a WeakMap, not an unbounded Map",
    );
  });

  /* ----------------------------------------------- 2. NORMAL ---- */
  console.log("\n2. NORMAL NAVIGATION");

  for (const design of ["legacy", "staged"] as const) {
    await test(`${design}: Plaza -> Mall -> Plaza -> Club -> Plaza follows the route`, async () => {
      const harness = buildHarness(design);
      for (const slug of ["enter", "mall", "enter", "club", "enter"]) {
        await stand(harness, slug);
        assert.strictEqual(
          (harness.store.place as Place).slug, slug,
          `store says ${(harness.store.place as Place).name} at /place/${slug}`,
        );
        assert.strictEqual(harness.router.currentRoute.params.id, slug);
      }
      assert.deepStrictEqual(harness.failures, []);
    });
  }

  await test("staged: a non-place navigation leaves the place it landed in alone", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "club");
    harness.go("information");
    await settle();
    assert.strictEqual(harness.router.currentRoute.fullPath, "/information");
    assert.strictEqual((harness.store.place as Place).slug, "club");
  });

  /* -------------------------------------- 3. DUPLICATE ABORT ---- */
  console.log("\n3. DUPLICATE ABORT");

  /**
   * Club -> Plaza -> Club with no wait. vue-router refuses the return as redundant, which
   * cancels the Plaza navigation without running any guard for the return, and the Plaza
   * fetch resolves afterwards.
   */
  async function runDuplicateAbort(design: "legacy" | "staged"): Promise<Harness> {
    const harness = buildHarness(design);
    await stand(harness, "club");

    harness.go("enter");
    await settle();
    assert.strictEqual(harness.inFlight.length, 1, "the Plaza fetch should be in flight");

    harness.go("club");
    await settle();

    await harness.answer("enter");
    await settle();
    return harness;
  }

  await test("legacy: the cancelled Plaza fetch DOES corrupt the store", async () => {
    const harness = await runDuplicateAbort("legacy");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual(
      (harness.store.place as Place).name, "The Plaza",
      "the old design was expected to leave The Plaza in the store",
    );
    console.log(
      `       old code: route=${harness.router.currentRoute.fullPath} ` +
      `store=${(harness.store.place as Place).name}`,
    );
  });

  await test("staged: the cancelled Plaza fetch cannot write the store", async () => {
    const harness = await runDuplicateAbort("staged");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual((harness.store.place as Place).name, "The Club");
    assert.strictEqual((harness.store.place as Place).slug, "club");
    console.log(
      `       new code: route=${harness.router.currentRoute.fullPath} ` +
      `store=${(harness.store.place as Place).name}`,
    );
  });

  await test("staged: the return ran no guard, so nothing re-fetched the Club", async () => {
    const harness = await runDuplicateAbort("staged");
    // One fetch for the arrival in the Club and one for the cancelled Plaza. If the
    // return had run the guard this would be three, and the store would be right for
    // the wrong reason.
    assert.deepStrictEqual(harness.landed, ["/place/club"]);
    assert.ok(
      harness.failures.some(entry => entry.indexOf("redundant") >= 0),
      `expected a redundant-navigation failure, got ${JSON.stringify(harness.failures)}`,
    );
    assert.ok(
      harness.failures.some(entry => entry.indexOf("cancelled") >= 0),
      `expected a cancelled-navigation failure, got ${JSON.stringify(harness.failures)}`,
    );
  });

  /* ------------------------------------------- 4. SUPERSEDED ---- */
  console.log("\n4. SUPERSEDED NAVIGATION");

  /** A starts, B supersedes A, and A's answer arrives last. */
  async function runSupersede(design: "legacy" | "staged"): Promise<Harness> {
    const harness = buildHarness(design);
    await stand(harness, "enter");

    harness.go("mall");
    await settle();
    harness.go("club");
    await settle();

    await harness.answer("club");
    await harness.answer("mall");
    return harness;
  }

  await test("legacy: the superseded navigation wins by resolving last", async () => {
    const harness = await runSupersede("legacy");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual((harness.store.place as Place).name, "The Mall");
  });

  await test("staged: the landed navigation owns the store, whoever answers last", async () => {
    const harness = await runSupersede("staged");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual((harness.store.place as Place).name, "The Club");
    console.log(
      `       reverse race: route=${harness.router.currentRoute.fullPath} ` +
      `store=${(harness.store.place as Place).name}`,
    );
  });

  await test("staged: the same race with the answers in the natural order agrees", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "enter");
    harness.go("mall");
    await settle();
    harness.go("club");
    await settle();
    await harness.answer("mall");
    await harness.answer("club");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual((harness.store.place as Place).name, "The Club");
  });

  await test("staged: three deep, only the last one may write", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "enter");
    harness.go("mall");
    await settle();
    harness.go("fleamarket");
    await settle();
    harness.go("club");
    await settle();
    await harness.answer("mall");
    await harness.answer("fleamarket");
    await harness.answer("club");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual((harness.store.place as Place).name, "The Club");
    assert.deepStrictEqual(harness.landed, ["/place/enter", "/place/club"]);
  });

  /* ------------------------------------------------ 5. RAPID ---- */
  console.log("\n5. RAPID NAVIGATION");

  await test("staged: one fast Plaza/Club pair", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "club");
    harness.go("enter");
    harness.go("club");
    await settle();
    await harness.answerAll();
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/club");
    assert.strictEqual((harness.store.place as Place).name, "The Club");
  });

  await test("staged: seven rapid navigations end on the place they landed in", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "club");
    const sequence = ["enter", "club", "enter", "club", "enter", "club", "enter"];
    for (const slug of sequence) {
      harness.go(slug);
    }
    await settle();
    await harness.answerAll();
    await settle();
    const landedPath = harness.router.currentRoute.fullPath;
    assert.strictEqual(
      `/place/${(harness.store.place as Place).slug}`, landedPath,
      `store=${(harness.store.place as Place).name} route=${landedPath}`,
    );
    console.log(`       seven rapid: route=${landedPath} ` +
      `store=${(harness.store.place as Place).name}`);
  });

  await test("staged: a rapid burst answered in reverse still ends consistent", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "enter");
    for (const slug of ["mall", "club", "fleamarket", "enter", "mall"]) {
      harness.go(slug);
    }
    await settle();
    while (harness.inFlight.length > 0) {
      const entry = harness.inFlight.pop() as InFlight;
      entry.answer();
      await settle();
    }
    await settle();
    assert.strictEqual(
      `/place/${(harness.store.place as Place).slug}`,
      harness.router.currentRoute.fullPath,
    );
  });

  /* --------------------------------------------- 6. CONTRACT ---- */
  console.log("\n6. PLACE STORE CONTRACT");

  await test("staged: after every navigation the store names a landed route", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "enter");
    const script = ["club", "enter", "club", "mall", "club", "enter"];
    for (const slug of script) {
      harness.go(slug);
      harness.go("club");
      await settle();
      await harness.answerAll();
      await settle();
      const path = harness.router.currentRoute.fullPath;
      const place = harness.store.place as Place;
      assert.strictEqual(`/place/${place.slug}`, path, `store=${place.name} route=${path}`);
      assert.strictEqual(
        harness.landed[harness.landed.length - 1], path,
        "the store must name the last route vue-router confirmed",
      );
    }
  });

  await test("staged: nothing is left in flight that could write later", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "club");
    harness.go("enter");
    await settle();
    harness.go("club");
    await settle();
    await harness.answerAll();
    await settle();
    assert.strictEqual(harness.inFlight.length, 0);
    assert.strictEqual((harness.store.place as Place).name, "The Club");
    // And a later, ordinary navigation still works.
    await stand(harness, "mall");
    assert.strictEqual((harness.store.place as Place).name, "The Mall");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
