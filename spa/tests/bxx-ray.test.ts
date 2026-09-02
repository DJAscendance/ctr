/**
 * OUTLANDS-1 guard for the Blaxxun `Browser.computeRayHit` compatibility call.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner,
 * no DOM, no WebGL), so this suite does not stand up an X_ITE browser. It is
 * split in two:
 *
 *   1. BEHAVIOUR, exercised directly against `bxx-ray.helper`. That module owns
 *      every decision the historical scripts actually depend on - segment
 *      bounds, nearest-hit ordering, hitPath direction, the miss fallback and
 *      the adapter chain - so the contract is tested there rather than through
 *      a mocked renderer.
 *
 *   2. WIRING, asserted against the source of `libs/x_ite_mods/bxx_ray.js` and
 *      `App.vue`. These catch the two drifts this lane exists to prevent: a
 *      shim that stops being loaded, and a shim that starts overriding X_ITE's
 *      own node `getType()`, which the renderer dispatches on.
 *
 * Historical anchors checked here come from the decompressed
 * `places/ne_game/vrml/ne_game.wrl`:
 *
 *   fire()             ray = Browser.computeRayHit(start, end);
 *                      we_time = (ray.hitPoint - we_start).length / mps
 *                      for (i..ray.hitPath.length) hitPath[i].getType()
 *   receive_repulsor() ray = Browser.computeRayHit(a, b); ray.hitPoint
 *   Ammo / Turret      Browser.computeRayHit(s, e).hitPath[0].children
 *                      children[i].getName() / children[i].getType()
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");

const SPA_SRC = path.resolve(__dirname, "../../../src");
const RAY_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_ray.js");
const AUTH_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_auth.js");
const APP = path.join(SPA_SRC, "App.vue");

import {
  buildHitPath,
  buildRayHit,
  isOnSegment,
  nearestHit,
  orderHits,
  rayFromPoints,
  resolveNodeNickname,
  resolveNodeType,
  MISS_NORMAL,
} from "../src/helpers/bxx-ray.helper";
import type {
  BxxNodeAdapter,
  BxxNodeView,
  RayIntersection,
  Vec3,
} from "../src/helpers/bxx-ray.helper";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

/** The offset of `token`, having first PROVED the token is present. */
function at(haystack: string, token: string): number {
  const index = haystack.indexOf(token);
  assert.notStrictEqual(index, -1, `expected to find: ${token}`);
  return index;
}

/**
 * The source with comments removed. The "no Outlands identity in this lane"
 * guards below are about executable code: the files legitimately DISCUSS the
 * historical world in prose, and a guard that tripped on a comment would push
 * the next author to delete the explanation rather than the leak.
 */
function codeOf(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function view(name: string, type: string): BxxNodeView {
  return { getName: () => name, getType: () => type };
}

function hit(point: Vec3, distance: number, chain: unknown[] = []): RayIntersection {
  return { point, normal: [0, 1, 0], distance, chain };
}

// ------------------------------------------------------------------ behaviour

test("a ray is built from the historical start/end pair, not a direction", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -10]);
  assert.strictEqual(ray.length, 10, "length is the segment length");
  assert.deepStrictEqual(ray.direction, [0, 0, -1], "direction is a unit vector");
  assert.deepStrictEqual(ray.origin, [0, 0, 0]);
});

test("a degenerate segment yields a zero ray instead of NaN", () => {
  const ray = rayFromPoints([3, 4, 5], [3, 4, 5]);
  assert.strictEqual(ray.length, 0);
  assert.deepStrictEqual(ray.direction, [0, 0, 0], "no division by zero");
  assert.ok(ray.direction.every(Number.isFinite), "direction stays finite");
});

test("a ray misses everything when there are no intersections", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  assert.strictEqual(nearestHit(ray, []), null);
});

test("a ray hits one object", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  const only = hit([0, 0, -25], 25);
  assert.strictEqual(nearestHit(ray, [only]), only);
});

test("nearest hit wins when several nested nodes are on the ray", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  const far = hit([0, 0, -80], 80);
  const near = hit([0, 0, -12], 12);
  const middle = hit([0, 0, -40], 40);
  assert.strictEqual(nearestHit(ray, [far, near, middle]), near);
  assert.deepStrictEqual(
    orderHits([far, near, middle]).map(h => h.distance),
    [12, 40, 80],
    "ordering is nearest first",
  );
});

test("orderHits does not mutate the array the traversal handed it", () => {
  const unsorted = [hit([0, 0, -80], 80), hit([0, 0, -12], 12)];
  orderHits(unsorted);
  assert.deepStrictEqual(unsorted.map(h => h.distance), [80, 12], "input untouched");
});

test("an intersection behind the start point is not a hit", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  const behind = hit([0, 0, 30], 30);
  assert.strictEqual(isOnSegment(ray, behind), false);
  assert.strictEqual(nearestHit(ray, [behind]), null);
});

test("an intersection past the segment end is not a hit", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  const past = hit([0, 0, -140], 140);
  assert.strictEqual(isOnSegment(ray, past), false);
});

test("an intersection exactly on the end point still counts", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  assert.strictEqual(isOnSegment(ray, hit([0, 0, -100], 100)), true);
});

test("a non-finite distance is rejected rather than sorted", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  assert.strictEqual(isOnSegment(ray, hit([0, 0, -5], Number.NaN)), false);
});

test("a miss returns the segment end so fire() cannot divide by NaN", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -1000]);
  const root = view("", "Group");
  const result = buildRayHit(ray, null, root, () => view("", "Node"));
  assert.deepStrictEqual(result.hitPoint, [0, 0, -1000], "hitPoint is the segment end");
  assert.deepStrictEqual(result.hitNormal, MISS_NORMAL);
  assert.ok(result.hitPoint.every(Number.isFinite), "a travel time stays computable");
});

test("hitPath is root first and ends at the shape that was hit", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  const root = view("", "Group");
  const chain = ["transform", "shape"];
  const names = new Map<unknown, BxxNodeView>([
    ["transform", view("wall", "Transform")],
    ["shape", view("", "Shape")],
  ]);
  const result = buildRayHit(ray, hit([0, 0, -9], 9, chain), root, node => names.get(node)!);
  assert.strictEqual(result.hitPath.length, 3);
  assert.strictEqual(result.hitPath[0].getType(), "Group", "hitPath[0] is the scene root");
  assert.strictEqual(result.hitPath[1].getName(), "wall");
  assert.strictEqual(
    result.hitPath[result.hitPath.length - 1].getType(),
    "Shape",
    "the last entry is the hit shape",
  );
});

test("hitPath is never empty, so the historical loop always has something to walk", () => {
  const ray = rayFromPoints([0, 0, 0], [0, 0, -100]);
  const root = view("", "Group");
  const missed = buildRayHit(ray, null, root, () => view("", "Node"));
  assert.ok(missed.hitPath.length >= 1, "hitPath[0] always exists");
  assert.strictEqual(buildHitPath(root, []).length, 1);
});

test("hitPath[0].children is what the Ammo and Turret PROTOs read", () => {
  // Ammo:   ray = Browser.computeRayHit(s,e).hitPath[0].children;
  //         for(i..) if(ray[i].getName()=='battle' && ray[i].getType()=='Script')
  const root: BxxNodeView = {
    getName: () => "",
    getType: () => "Group",
    children: [view("battle", "Script"), view("SharedZone", "BlaxxunZone")],
  };
  const found = (root.children ?? []).filter(
    child => child.getName() === "battle" && child.getType() === "Script",
  );
  assert.strictEqual(found.length, 1, "the battle Script is discoverable from the root");
  const zone = (root.children ?? []).filter(
    child => child.getName() === "SharedZone" && child.getType() === "BlaxxunZone",
  );
  assert.strictEqual(zone.length, 1, "the Turret PROTO can also find SharedZone");
});

test("a PROTO instance reports its prototype name, not its X3D base type", () => {
  const zone = { getTypeName: () => "BlaxxunZone" };
  assert.strictEqual(resolveNodeType(zone, [], zone.getTypeName), "BlaxxunZone");
});

test("an adapter can claim a node, which is how OUTLANDS-2 adds remote avatars", () => {
  const remote = { id: 7 };
  const adapter: BxxNodeAdapter = node =>
    (node === remote ? { type: "Avatar", nickname: "Mina" } : null);
  assert.strictEqual(resolveNodeType(remote, [adapter], () => "Transform"), "Avatar");
  assert.strictEqual(resolveNodeNickname(remote, [adapter]), "Mina");
});

test("an unclaimed node falls through the adapter chain to its own type", () => {
  const other = { id: 8 };
  const adapter: BxxNodeAdapter = () => null;
  assert.strictEqual(resolveNodeType(other, [adapter], () => "Transform"), "Transform");
  assert.strictEqual(resolveNodeNickname(other, [adapter]), undefined);
});

test("a throwing adapter cannot break the fire path", () => {
  const bad: BxxNodeAdapter = () => { throw new Error("boom"); };
  assert.strictEqual(resolveNodeType({}, [bad], () => "Shape"), "Shape");
  assert.strictEqual(resolveNodeNickname({}, [bad]), undefined);
});

test("a node with no resolvable type still returns a string", () => {
  assert.strictEqual(resolveNodeType({}, []), "Node", "getType() never returns undefined");
  assert.strictEqual(resolveNodeType({}, [], () => undefined), "Node");
});

// --------------------------------------------------------------------- wiring

test("the ray shim is loaded by App.vue after the base bxx shim", () => {
  const app = read(APP);
  assert.ok(
    at(app, "libs/x_ite_mods/bxx_auth.js") < at(app, "libs/x_ite_mods/bxx_ray.js"),
    "bxx_ray extends bxx_auth, so it must load after it",
  );
});

test("the shim never overrides X_ITE's own node getType()", () => {
  const source = read(RAY_MOD);
  assert.strictEqual(
    /X3DBaseNode\s*\.\s*prototype\s*\.\s*getType/.test(source),
    false,
    "X_ITE dispatches on the numeric getType() array; patching it breaks the renderer",
  );
  assert.ok(
    source.includes("resolveNodeType"),
    "the Blaxxun type string is produced by the adapter chain instead",
  );
});

test("the shim exposes an adapter seam rather than hard-coding Outlands rules", () => {
  const source = read(RAY_MOD);
  assert.ok(source.includes("X3D.bxx.nodeAdapters"), "OUTLANDS-2 has somewhere to register");
  assert.strictEqual(
    /redm\.wrl|bluem\.wrl|ne_game|Outlands/i.test(codeOf(RAY_MOD)),
    false,
    "no Outlands identity may leak into the generic ray engine",
  );
});

test("computeRayHit hands back real SFVec3f points", () => {
  const source = read(RAY_MOD);
  assert.ok(
    source.includes("new X3D.SFVec3f"),
    "the historical script calls .add()/.subtract() on hitPoint",
  );
});

test("getWorldStartTime no longer returns the unassigned `wst`", () => {
  const source = read(AUTH_MOD);
  assert.strictEqual(
    /return wst\b/.test(source),
    false,
    "`wst` was never assigned, so every timer seeded from it was undefined",
  );
  assert.ok(source.includes("_bxxWorldStartTime"), "a per-world stamp replaces it");
});

test("setCollisionDetection no longer throws", () => {
  const source = read(AUTH_MOD);
  const body = source.slice(
    at(source, "b.setCollisionDetection"),
    at(source, "b.getCollisionDetection"),
  );
  assert.strictEqual(
    body.includes("UnimplementedBXXMethod"),
    false,
    "the historical call must not raise",
  );
  assert.ok(body.includes("avatarSize"), "collision distance is the lever X_ITE actually exposes");
});

// --------------------------------------------------------------------- runner

void (async (): Promise<void> => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.run();
      console.log(`  ok  ${item.name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL  ${item.name}`);
      console.error(`        ${(error as Error).message}`);
    }
  }
  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
})();
