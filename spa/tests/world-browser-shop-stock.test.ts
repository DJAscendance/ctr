/**
 * The newest place load owns the objects the page holds.
 *
 * A hard reload of a shop fires WorldBrowserPage's `$store.data.view3d` and
 * `$route` watchers in the same tick. Each starts a loadAndJoinPlace(), so two
 * fetches for the same place are in flight on one component and either can
 * answer last. Two separate faults come out of that:
 *
 *   1. DUPLICATE ACCUMULATION. The shipped shop branch pushed every fetch's
 *      rows into the array that was already there, so the live run built one
 *      SharedObject root per copy - one mall_object, two roots in the scene.
 *      Closed by assigning instead of pushing; still guarded here.
 *   2. STALE REPLACEMENT. Assignment alone is not enough. getPlace() runs to
 *      the end whatever its generation, and loadAndJoinPlace()'s generation
 *      check sits AFTER `await this.getPlace(...)` - too late to stop a slow
 *      OLD answer from painting its stock over the newer load's. Closed by
 *      re-checking the generation at the point of commit, inside getPlace().
 *
 * This suite runs the REAL getPlace() out of WorldBrowserPage.vue. It is not a
 * re-implementation: the method body is lifted from the component source and
 * evaluated as it ships, so a regression in the file fails here. Overlapping
 * loads are given DIFFERENT stock and are settled in hostile order, so a stale
 * commit is visible instead of being hidden behind an identical payload. Both
 * the as-shipped push and an unguarded assignment are held as negative
 * controls, so the suite is known to see each fault it guards against.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

type Test = { name: string; run: () => Promise<void> | void };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void> | void): void {
  tests.push({ name, run });
}

// Tests run from tests/.compiled/tests/ - three levels up is the spa root.
const SPA = path.resolve(__dirname, "../../..");
const WORLD_PAGE = "src/pages/world-browser/WorldBrowserPage.vue";
const read = (rel: string): string => fs.readFileSync(path.join(SPA, rel), "utf8");

/**
 * Lifts one method, brace-balanced, out of the component's `methods` block and
 * returns it as a plain async function. Only the TypeScript annotations on the
 * signature are removed; the body is byte-for-byte what ships.
 */
function liftMethod(source: string, name: string): any {
  const head = new RegExp(`async ${name}\\(([^)]*)\\)\\s*:\\s*Promise<void>\\s*\\{`);
  const match = head.exec(source);
  assert.ok(match, `${name}() not found in ${WORLD_PAGE}`);
  const params = match![1].replace(/:\s*[A-Za-z<>[\]| ]+/g, "");
  const start = match!.index + match![0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    i += 1;
  }
  assert.strictEqual(depth, 0, `${name}() body never closed`);
  const body = source.slice(start, i - 1);
  return vm.runInNewContext(
    `(async function (${params}) {${body}})`,
    { console, document: { title: "" } });
}

/**
 * One shop's stock as GET /api/mall/objects/807 answers it: the in-stock row
 * carries the id the caller asks for, and a sold-out row rides along so the
 * status filter stays under test.
 */
const shopStock = (id: number): any => ({
  objects: [
    { id, object_id: 1, name: `PR40 Fixture ${id}`, directory: "2", filename: "Cryo2000.wrl",
      status: 1, position: "{\"x\":-2,\"y\":0,\"z\":18}", rotation: null },
    { id: id + 1, object_id: 3, name: `PR40 Sold ${id}`, directory: "2",
      filename: "Cryo2000.wrl", status: 0, position: null, rotation: null },
  ],
});

/** One ordinary place's objects as GET /api/place/807/object_instance answers it. */
const placeStock = (id: number): any => ({
  object_instance: [
    { id, object_id: 1, name: `PR40 Instance ${id}`, directory: "2",
      filename: "Cryo2000.wrl", position: null, rotation: null },
  ],
});

/**
 * A component in the state a hard reload leaves it: the store already names the
 * place, and no fetch resolves until the test says so, so overlapping loads can
 * be settled in any order. The nth load started is answered with the nth
 * payload, so each load carries its own distinct stock.
 *
 * `settle([...])` answers the named loads in the named order and waits for each
 * one to run to the end before the next is answered. Resolving the fetches back
 * to back would not do: the lifted method runs in its own vm realm, so `await`
 * there takes the cross-realm slow path and the order the commits happen in is
 * not the order the fetches were resolved in. Waiting on the load itself makes
 * "B answers first, A answers last" mean exactly that.
 */
function placeComponent(type: string, payloads: any[]): any {
  const expected = type === "shop" ? "/mall/objects/807" : "/place/807/object_instance";
  const pending: Array<() => void> = [];
  const loads: Array<Promise<void>> = [];
  return {
    loadGeneration: 0,
    loads,
    $store: { data: { place: { id: 807, name: "Antique Shop", type } } },
    $http: {
      get: (url: string) => {
        assert.strictEqual(url, expected, `unexpected fetch ${url}`);
        const nth = pending.length;
        return new Promise(resolve => {
          pending.push(() => resolve({ data: payloads[nth] }));
        });
      },
    },
    debugMsg: () => { /* no debug output under test */ },
    sharedObjects: [] as any[],
    settle: async (order: number[]): Promise<void> => {
      for (const n of order) {
        assert.ok(pending[n], `load ${n} never started a fetch`);
        pending[n]();
        await loads[n];
      }
    },
  };
}

const getPlace = liftMethod(read(WORLD_PAGE), "getPlace");

/**
 * Starts one load exactly the way loadAndJoinPlace() does: mint the next
 * generation, then hand it to getPlace(). Every later call supersedes this one.
 */
const startLoad = (vmx: any, run = getPlace): Promise<void> => {
  const load = run.call(vmx, ++vmx.loadGeneration);
  vmx.loads.push(load);
  return load;
};

/**
 * The ids the component holds, copied into this realm. The method runs inside a
 * vm context, so an array it creates has that context's Array prototype and a
 * strict deep-equal would reject it on prototype alone - which is a fact about
 * the sandbox, not about the stock.
 */
const heldIds = (vmx: any): number[] => Array.from(vmx.sharedObjects, (o: any) => o.id);

// --- one load ---------------------------------------------------------------

test("a single shop load holds exactly the in-stock rows", async () => {
  const vmx = placeComponent("shop", [shopStock(101)]);
  const run = startLoad(vmx);
  await vmx.settle([0]);
  await run;
  assert.deepStrictEqual(heldIds(vmx), [101],
    `one load should hold the one in-stock row and not the sold-out one: ${
      JSON.stringify(vmx.sharedObjects)}`);
});

// --- two loads, different stock, both orders --------------------------------

test("stale order: the OLD load answers LAST and must not overwrite the new stock",
  async () => {
    // The reload shape: both watchers start their loads in the same tick. A is
    // older and carries stock 101, B is newer and carries 202. B answers first,
    // A answers last - the order that used to leave the shop showing 101.
    const vmx = placeComponent("shop", [shopStock(101), shopStock(202)]);
    const a = startLoad(vmx);
    const b = startLoad(vmx);
    await vmx.settle([1, 0]);
    await Promise.all([a, b]);
    assert.deepStrictEqual(heldIds(vmx), [202],
      `the superseded load overwrote the newer stock: ${JSON.stringify(vmx.sharedObjects)}`);
    assert.notDeepStrictEqual(heldIds(vmx), [101]);
  });

test("reverse order: the OLD load answers FIRST and the new load still wins", async () => {
  const vmx = placeComponent("shop", [shopStock(101), shopStock(202)]);
  const a = startLoad(vmx);
  const b = startLoad(vmx);
  await vmx.settle([0, 1]);
  await Promise.all([a, b]);
  assert.deepStrictEqual(heldIds(vmx), [202],
    `the newest load does not own the stock: ${JSON.stringify(vmx.sharedObjects)}`);
});

// --- three loads ------------------------------------------------------------

test("three overlapping loads: only the newest owns the final stock", async () => {
  // Hostile order: the owning load answers FIRST, and both stale loads answer
  // after it, so every late commit has a chance to paint over the winner.
  const vmx = placeComponent("shop", [shopStock(101), shopStock(202), shopStock(303)]);
  const runs = [startLoad(vmx), startLoad(vmx), startLoad(vmx)];
  await vmx.settle([2, 0, 1]);
  await Promise.all(runs);
  assert.deepStrictEqual(heldIds(vmx), [303],
    `generation 3 does not own the final stock: ${JSON.stringify(vmx.sharedObjects)}`);
});

// --- ordinary places share the same ownership rule --------------------------

test("ordinary place: the OLD load answers LAST and must not overwrite", async () => {
  const vmx = placeComponent("place", [placeStock(101), placeStock(202)]);
  const a = startLoad(vmx);
  const b = startLoad(vmx);
  await vmx.settle([1, 0]);
  await Promise.all([a, b]);
  assert.deepStrictEqual(heldIds(vmx), [202],
    `the object_instance branch let a stale load commit: ${JSON.stringify(vmx.sharedObjects)}`);
});

test("ordinary place: a single load still holds its objects", async () => {
  const vmx = placeComponent("place", [placeStock(101)]);
  const run = startLoad(vmx);
  await vmx.settle([0]);
  await run;
  assert.deepStrictEqual(heldIds(vmx), [101]);
});

// --- the source contract ----------------------------------------------------

test("the shop branch assigns the stock, it does not push into the shared array", () => {
  const source = read(WORLD_PAGE).replace(/\/\*[\s\S]*?\*\//g, " ");
  const shopBranch = /type === "shop"\)\s*\{([\s\S]*?)\}\s*else\s*\{/.exec(source);
  assert.ok(shopBranch, "the shop branch of getPlace() was not found");
  assert.ok(!/sharedObjects\.push\(/.test(shopBranch![1]),
    "getPlace() pushes shop stock into this.sharedObjects again");
  assert.ok(/this\.sharedObjects\s*=/.test(shopBranch![1]),
    "getPlace() no longer assigns this.sharedObjects in the shop branch");
});

test("loadAndJoinPlace hands its generation to getPlace", () => {
  const source = read(WORLD_PAGE).replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.ok(/await this\.getPlace\(generation\)/.test(source),
    "loadAndJoinPlace() no longer passes its generation into getPlace()");
});

// --- negative controls ------------------------------------------------------

// CONTROL 1: duplicate accumulation. The branch as it first shipped, run the
// same way, still shows two copies of one shop's stock.
test("control: the as-shipped push produced two copies under two loads", async () => {
  const asShipped = vm.runInNewContext(`(async function () {
    this.sharedObjects = [];
    const objectResponse = await this.$http.get("/mall/objects/" + this.$store.data.place.id);
    objectResponse.data.objects.forEach(obj => {
      if (obj.status === 1) this.sharedObjects.push(obj);
    });
  })`);
  const vmx = placeComponent("shop", [shopStock(101), shopStock(202)]);
  const a = startLoad(vmx, asShipped);
  const b = startLoad(vmx, asShipped);
  await vmx.settle([1, 0]);
  await Promise.all([a, b]);
  assert.strictEqual(vmx.sharedObjects.length, 2,
    "the control no longer reproduces the duplicate, so this suite proves nothing");
});

// CONTROL 2: stale replacement. Assignment with no generation check - the shape
// this correction replaces - still lets the OLD answer win.
test("control: an unguarded assignment let the OLD load win", async () => {
  const unguarded = vm.runInNewContext(`(async function (generation) {
    this.sharedObjects = [];
    const objectResponse = await this.$http.get("/mall/objects/" + this.$store.data.place.id);
    this.sharedObjects = objectResponse.data.objects.filter(obj => obj.status === 1);
  })`);
  const vmx = placeComponent("shop", [shopStock(101), shopStock(202)]);
  const a = startLoad(vmx, unguarded);
  const b = startLoad(vmx, unguarded);
  await vmx.settle([1, 0]);
  await Promise.all([a, b]);
  assert.deepStrictEqual(heldIds(vmx), [101],
    "the control no longer reproduces the stale overwrite, so this suite proves nothing");
});

// ---------------------------------------------------------------------------

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error(err instanceof Error ? `    ${err.message}` : err);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures > 0) process.exit(1);
})();
