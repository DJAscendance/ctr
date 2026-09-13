/**
 * Shop stock is loaded once per place load, however many loads are in flight.
 *
 * A hard reload of a shop fires WorldBrowserPage's `$store.data.view3d` and
 * `$route` watchers in the same tick. Each starts a loadAndJoinPlace(), and each
 * of those runs getPlace() to the end regardless of its generation - the
 * generation check sits AFTER the await. So two fetches of the same shop stock
 * land, one after the other, on one component. The shipped shop branch pushed
 * every fetch's rows into the array that was already there; the live run then
 * built one SharedObject root per row - one mall_object, two roots in the scene.
 *
 * This suite runs the REAL getPlace() out of WorldBrowserPage.vue, with the two
 * overlapping calls the reload produces, against the fixture shop's stock. It is
 * not a re-implementation: the method body is lifted from the component source
 * and evaluated as it ships, so a regression in the file fails here. The
 * as-shipped push is held as a negative control so the suite is known to see
 * the duplicate it guards against.
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
 * returns it as a plain async function. Only the TypeScript return annotation
 * is removed; the body is byte-for-byte what ships.
 */
function liftMethod(source: string, name: string): () => Promise<void> {
  const head = new RegExp(`async ${name}\\([^)]*\\)\\s*:\\s*Promise<void>\\s*\\{`);
  const match = head.exec(source);
  assert.ok(match, `${name}() not found in ${WORLD_PAGE}`);
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
  return vm.runInNewContext(`(async function () {${body}})`, { console, document: { title: "" } });
}

/** The fixture shop's stock, as GET /api/mall/objects/807 answers it. */
const STOCK = {
  objects: [
    { id: 1, object_id: 1, name: "PR40 Fixture Cryo2000", directory: "2", filename: "Cryo2000.wrl",
      status: 1, position: "{\"x\":-2,\"y\":0,\"z\":18}", rotation: null },
    { id: 2, object_id: 3, name: "PR40 Fixture Sold", directory: "2", filename: "Cryo2000.wrl",
      status: 0, position: null, rotation: null },
  ],
};

/**
 * A component in the state a hard reload leaves it: the store already names the
 * shop, and every fetch resolves only when the test says so, so the two
 * overlapping loads can be settled in either order.
 */
function shopComponent(): any {
  const pending: any[] = [];
  return {
    $store: { data: { place: { id: 807, name: "Antique Shop", type: "shop" } } },
    $http: {
      get: (url: string) => {
        assert.strictEqual(url, "/mall/objects/807", `unexpected fetch ${url}`);
        return new Promise(resolve => { pending.push(resolve); });
      },
    },
    debugMsg: () => { /* no debug output under test */ },
    sharedObjects: [] as any[],
    settle: (order: number[]) => {
      for (const n of order) pending[n]({ data: STOCK });
    },
  };
}

const getPlace = liftMethod(read(WORLD_PAGE), "getPlace");

/**
 * The ids the component holds, copied into this realm. The method runs inside a
 * vm context, so an array it creates has that context's Array prototype and a
 * strict deep-equal would reject it on prototype alone - which is a fact about
 * the sandbox, not about the stock.
 */
const heldIds = (vmx: any): number[] => Array.from(vmx.sharedObjects, (o: any) => o.id);

test("a single shop load holds exactly the in-stock rows", async () => {
  const vmx = shopComponent();
  const run = getPlace.call(vmx);
  vmx.settle([0]);
  await run;
  assert.deepStrictEqual(heldIds(vmx), [1],
    `one load should hold the one in-stock row and not the sold-out one: ${
      JSON.stringify(vmx.sharedObjects)}`);
});

test("two loads in flight for one shop leave one copy of its stock", async () => {
  // The reload shape: the two watchers start their loads in the same tick,
  // before either fetch has answered.
  const vmx = shopComponent();
  const first = getPlace.call(vmx);
  const second = getPlace.call(vmx);
  vmx.settle([0, 1]);
  await Promise.all([first, second]);
  assert.deepStrictEqual(heldIds(vmx), [1],
    `the superseded load left its copy of the stock behind: ${JSON.stringify(vmx.sharedObjects)}`);
});

test("the order the two fetches answer in does not matter", async () => {
  const vmx = shopComponent();
  const first = getPlace.call(vmx);
  const second = getPlace.call(vmx);
  vmx.settle([1, 0]);
  await Promise.all([first, second]);
  assert.deepStrictEqual(heldIds(vmx), [1]);
});

test("three overlapping loads still leave one copy", async () => {
  const vmx = shopComponent();
  const runs = [getPlace.call(vmx), getPlace.call(vmx), getPlace.call(vmx)];
  vmx.settle([0, 1, 2]);
  await Promise.all(runs);
  assert.strictEqual(vmx.sharedObjects.length, 1);
});

test("the shop branch assigns the stock, it does not push into the shared array", () => {
  const source = read(WORLD_PAGE).replace(/\/\*[\s\S]*?\*\//g, " ");
  const shopBranch = /type === "shop"\)\s*\{([\s\S]*?)\}\s*else\s*\{/.exec(source);
  assert.ok(shopBranch, "the shop branch of getPlace() was not found");
  assert.ok(!/sharedObjects\.push\(/.test(shopBranch![1]),
    "getPlace() pushes shop stock into this.sharedObjects again");
  assert.ok(/this\.sharedObjects\s*=/.test(shopBranch![1]),
    "getPlace() no longer assigns this.sharedObjects in the shop branch");
});

// NEGATIVE CONTROL: the branch as it shipped, run the same way, shows the duplicate.
test("control: the as-shipped push produced two copies under the same two loads", async () => {
  const asShipped = vm.runInNewContext(`(async function () {
    this.sharedObjects = [];
    const objectResponse = await this.$http.get("/mall/objects/" + this.$store.data.place.id);
    objectResponse.data.objects.forEach(obj => {
      if (obj.status === 1) this.sharedObjects.push(obj);
    });
  })`);
  const vmx = shopComponent();
  const first = asShipped.call(vmx);
  const second = asShipped.call(vmx);
  vmx.settle([0, 1]);
  await Promise.all([first, second]);
  assert.strictEqual(vmx.sharedObjects.length, 2,
    "the control no longer reproduces the duplicate, so this suite proves nothing");
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
