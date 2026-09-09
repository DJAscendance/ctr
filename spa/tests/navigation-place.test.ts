/**
 * A cancelled navigation must not write `appStore.data.place`.
 *
 * WHAT IS BEING GUARDED. `router.beforeEach` in `spa/src/main.ts` fetches the place for
 * the route it is asked about. That fetch is asynchronous, and vue-router never tells an
 * in-flight `.then` that its navigation has gone. The proven Outlands failure is the
 * second of the two ways it goes:
 *
 *   standing in Outlands, hash to "/place/enter", then back to "/place/outlands" on the
 *   next frame. The return is `isSameRoute` with the route the app is still on, so
 *   vue-router refuses it as a redundant navigation - but `confirmTransition` has already
 *   set `pending` to it, so the Plaza navigation is cancelled, AND no guard runs for the
 *   return, so nothing re-fetches Outlands. The Plaza fetch then resolves into a store
 *   whose route, socket room and loaded world are all Outlands.
 *
 * That wrong place makes `applyAvatarIdentity()` fall back: `Browser.myAvatarName` becomes
 * the username instead of the presence key, so the Beamer's `name == Browser.myAvatarName`
 * is never true, and `Browser.myAvatarURL` becomes the real asset instead of the historical
 * address, so `ne_game.wrl`'s own anti-avatar-swap line beams the citizen out on every
 * tick. Neither symptom is fixed where it shows; both are fixed by the store write.
 *
 * HOW THIS TESTS IT. With the REAL `vue-router` 3.5.2 the SPA ships, in `abstract` mode so
 * no DOM is needed, driven by a place fetch this suite resolves by hand. Nothing here
 * depends on which callback usually finishes first: every race is ordered explicitly.
 *
 * Every race is run against BOTH designs, so the suite states the old behaviour as well as
 * the new:
 *
 *   "legacy" - what `main.ts` used to do: write the store from inside the guard.
 *   "staged" - what it does now: stage against the navigation, commit from `afterEach`.
 *
 * Six parts:
 *
 *   1. STAGING          - the helper on its own.
 *   2. NORMAL           - Plaza -> Mall -> Plaza -> Outlands -> Plaza, both designs.
 *   3. DUPLICATE ABORT  - the proven Outlands race. Legacy MUST fail it.
 *   4. SUPERSEDED       - a superseded navigation, resolving last, may not win.
 *   5. RAPID            - one fast pair, then seven rapid navigations.
 *   6. CONTRACT         - after every navigation the store names the landed route.
 */
import assert from "assert";
import Vue from "vue";
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
  outlands: { id: 3, name: "Outlands", slug: "outlands" },
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
  go: (slug: string) => void;
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
    staging.stage(navigation, "Outlands");
    assert.strictEqual(staging.isStaged(navigation), true);
    assert.strictEqual(staging.confirm(navigation), true);
    assert.deepStrictEqual(written, ["Outlands"]);
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

  /* ----------------------------------------------- 2. NORMAL ---- */
  console.log("\n2. NORMAL NAVIGATION");

  for (const design of ["legacy", "staged"] as const) {
    await test(`${design}: Plaza -> Mall -> Plaza -> Outlands -> Plaza follows the route`, async () => {
      const harness = buildHarness(design);
      for (const slug of ["enter", "mall", "enter", "outlands", "enter"]) {
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
    await stand(harness, "outlands");
    harness.go("information");
    await settle();
    assert.strictEqual(harness.router.currentRoute.fullPath, "/information");
    assert.strictEqual((harness.store.place as Place).slug, "outlands");
  });

  /* -------------------------------------- 3. DUPLICATE ABORT ---- */
  console.log("\n3. DUPLICATE ABORT - the proven Outlands race");

  /**
   * Outlands -> Plaza -> Outlands with no wait. vue-router refuses the return as
   * redundant, which cancels the Plaza navigation without running any guard for the
   * return, and the Plaza fetch resolves afterwards.
   */
  async function runDuplicateAbort(design: "legacy" | "staged"): Promise<Harness> {
    const harness = buildHarness(design);
    await stand(harness, "outlands");

    harness.go("enter");
    await settle();
    assert.strictEqual(harness.inFlight.length, 1, "the Plaza fetch should be in flight");

    harness.go("outlands");
    await settle();

    await harness.answer("enter");
    await settle();
    return harness;
  }

  await test("legacy: the cancelled Plaza fetch DOES corrupt the store (old behaviour)", async () => {
    const harness = await runDuplicateAbort("legacy");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
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
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
    assert.strictEqual((harness.store.place as Place).name, "Outlands");
    assert.strictEqual((harness.store.place as Place).slug, "outlands");
    console.log(
      `       new code: route=${harness.router.currentRoute.fullPath} ` +
      `store=${(harness.store.place as Place).name}`,
    );
  });

  await test("staged: the return really did run no guard, so nothing re-fetched Outlands", async () => {
    const harness = await runDuplicateAbort("staged");
    // One fetch for the arrival in Outlands and one for the cancelled Plaza. If the
    // return had run the guard this would be three, and the store would be right for
    // the wrong reason.
    assert.deepStrictEqual(harness.landed, ["/place/outlands"]);
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
    harness.go("outlands");
    await settle();

    await harness.answer("outlands");
    await harness.answer("mall");
    return harness;
  }

  await test("legacy: the superseded navigation wins by resolving last (old behaviour)", async () => {
    const harness = await runSupersede("legacy");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
    assert.strictEqual((harness.store.place as Place).name, "The Mall");
  });

  await test("staged: the navigation that landed owns the store, whoever answers last", async () => {
    const harness = await runSupersede("staged");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
    assert.strictEqual((harness.store.place as Place).name, "Outlands");
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
    harness.go("outlands");
    await settle();
    await harness.answer("mall");
    await harness.answer("outlands");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
    assert.strictEqual((harness.store.place as Place).name, "Outlands");
  });

  await test("staged: three deep, only the last one may write", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "enter");
    harness.go("mall");
    await settle();
    harness.go("fleamarket");
    await settle();
    harness.go("outlands");
    await settle();
    await harness.answer("mall");
    await harness.answer("fleamarket");
    await harness.answer("outlands");
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
    assert.strictEqual((harness.store.place as Place).name, "Outlands");
    assert.deepStrictEqual(harness.landed, ["/place/enter", "/place/outlands"]);
  });

  /* ------------------------------------------------ 5. RAPID ---- */
  console.log("\n5. RAPID NAVIGATION");

  await test("staged: one fast Plaza/Outlands pair", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "outlands");
    harness.go("enter");
    harness.go("outlands");
    await settle();
    await harness.answerAll();
    assert.strictEqual(harness.router.currentRoute.fullPath, "/place/outlands");
    assert.strictEqual((harness.store.place as Place).name, "Outlands");
  });

  await test("staged: seven rapid navigations end on the place they landed in", async () => {
    const harness = buildHarness("staged");
    await stand(harness, "outlands");
    const sequence = ["enter", "outlands", "enter", "outlands", "enter", "outlands", "enter"];
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
    for (const slug of ["mall", "outlands", "fleamarket", "enter", "mall"]) {
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
    const script = ["outlands", "enter", "outlands", "mall", "outlands", "enter"];
    for (const slug of script) {
      harness.go(slug);
      harness.go("outlands");
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
    await stand(harness, "outlands");
    harness.go("enter");
    await settle();
    harness.go("outlands");
    await settle();
    await harness.answerAll();
    await settle();
    assert.strictEqual(harness.inFlight.length, 0);
    assert.strictEqual((harness.store.place as Place).name, "Outlands");
    // And a later, ordinary navigation still works.
    await stand(harness, "mall");
    assert.strictEqual((harness.store.place as Place).name, "The Mall");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
