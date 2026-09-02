/**
 * OUTLANDS-1b guard for the Blaxxun `HUD` node.
 *
 * The SPA test harness is deliberately dependency-free (plain Node, no runner,
 * no DOM, no WebGL), so this suite does not stand up an X_ITE browser. It is
 * split in three:
 *
 *   1. CONTRACT, checked against the surviving declarations that still ship in
 *      this repository - `assets/worlds/externprotos/shared_xite.wrl` and
 *      `assets/worlds/externprotos/nodes_xite.wrl`. If either file is ever
 *      edited, the field list this lane restored stops matching and this suite
 *      says so. Nothing here is transcribed from memory.
 *
 *   2. BEHAVIOUR, exercised against `bxx-hud.helper`, which owns the two rules
 *      the binding acts on: which traversals are visited in camera space, and
 *      which nodes replace rather than extend their parent matrix.
 *
 *   3. WIRING, asserted against the source of `libs/x_ite_mods/bxx_hud.js`,
 *      `libs/x_ite_mods/bxx_ray.js` and `App.vue`. These catch the drifts this
 *      lane exists to prevent: a node that stops being registered, a shim that
 *      stops being loaded, an Outlands-specific special case creeping into a
 *      generic compatibility node, and a historical world being "fixed" in
 *      place instead of the runtime.
 */
import assert from "assert";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SPA = path.resolve(__dirname, "../../..");
const SPA_SRC = path.join(SPA, "src");
const HUD_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_hud.js");
const RAY_MOD = path.join(SPA_SRC, "libs/x_ite_mods/bxx_ray.js");
const APP = path.join(SPA_SRC, "App.vue");

const WORLDS = path.join(SPA, "assets/worlds");
const SHARED_PROTOS = path.join(WORLDS, "externprotos/shared_xite.wrl");
const NODE_PROTOS = path.join(WORLDS, "externprotos/nodes_xite.wrl");
const OUTLANDS = path.join(WORLDS, "ne_game/vrml");
const PLAZA = path.join(WORLDS, "enter/vrml/enter.wrl");

import {
  HUD_FIELDS,
  HUD_FIELD_NAMES,
  HUD_NEAR_MARGIN,
  HUD_TYPE_NAME,
  hudNearClearanceScale,
  hudTraversal,
  isViewRelative,
  matrixMode,
} from "../src/helpers/bxx-hud.helper";
import type { TraverseKind } from "../src/helpers/bxx-hud.helper";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name, run });
}

const read = (file: string): string => fs.readFileSync(file, "utf8");

/** A world file as text, whether or not it was shipped gzipped. */
function world(file: string): string {
  const raw: Buffer = fs.readFileSync(file);
  const gzipped = raw[0] === 0x1f && raw[1] === 0x8b;
  return (gzipped ? zlib.gunzipSync(raw) : raw).toString("utf8");
}

/** The source with comments removed, so prose cannot satisfy a code guard. */
function codeOf(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** Every `HUD {` instantiation in a world, ignoring the PROTO declaration. */
function hudUses(source: string): string[] {
  const withoutComments = source
    .split("\n")
    .map((line) => line.split("#")[0])
    .join("\n");
  const matches = withoutComments.match(/(^|[^A-Za-z0-9_])HUD\s*\{/g) || [];
  return matches.filter((hit) => !/PROTO/.test(hit));
}

const ALL_KINDS: TraverseKind[] = [
  "POINTER",
  "CAMERA",
  "PICKING",
  "COLLISION",
  "SHADOW",
  "DISPLAY",
];

// ------------------------------------------------------------------- contract

test("the restored field list is the one the surviving EXTERNPROTO declares", () => {
  const source = read(SHARED_PROTOS);
  const start = source.indexOf("EXTERNPROTO HUD");
  assert.notStrictEqual(start, -1, "shared_xite.wrl must still declare HUD");
  const declaration = source.slice(start, source.indexOf("]", start));

  for (const field of HUD_FIELDS) {
    const pattern = new RegExp(`${field.access}\\s+${field.type}\\s+${field.name}\\b`);
    assert.ok(
      pattern.test(declaration),
      `historical declaration must carry ${field.access} ${field.type} ${field.name}`,
    );
  }
});

test("nothing was invented: the node has exactly five historical fields", () => {
  assert.strictEqual(HUD_FIELDS.length, 5);
  assert.deepStrictEqual(
    HUD_FIELDS.map((field) => field.name),
    [...HUD_FIELD_NAMES],
  );

  const source = read(SHARED_PROTOS);
  const declaration = source.slice(
    source.indexOf("EXTERNPROTO HUD"),
    source.indexOf("]", source.indexOf("EXTERNPROTO HUD")),
  );
  const declarationLine = /^\s*(?:field|exposedField|eventIn|eventOut)\s+\S+\s+(\S+)/gm;
  const declared = (declaration.match(declarationLine) || [])
    .map((line) => line.trim().split(/\s+/)[2]);
  assert.deepStrictEqual(
    declared.sort(),
    [...HUD_FIELD_NAMES].sort(),
    "the restored surface must not exceed the historical one",
  );
});

test("the CC3D fallback proves the children follow position AND orientation", () => {
  const source = read(NODE_PROTOS);
  const start = source.indexOf("PROTO HUD");
  assert.notStrictEqual(start, -1, "nodes_xite.wrl must still carry the fallback");
  const body = source.slice(start, start + 1500);

  assert.ok(/ProximitySensor/.test(body), "the fallback tracks the viewer");
  assert.ok(
    /ROUTE\s+UserPosition\.position_changed\s+TO\s+HUD\.translation/.test(body),
    "viewer position drives the HUD translation",
  );
  assert.ok(
    /ROUTE\s+UserPosition\.orientation_changed\s+TO\s+HUD\.rotation/.test(body),
    "viewer orientation drives the HUD rotation",
  );
});

test("the CC3D fallback proves a HUD never blocks navigation", () => {
  const body = read(NODE_PROTOS).slice(read(NODE_PROTOS).indexOf("PROTO HUD"));
  assert.ok(/Collision\s*\{[\s\S]{0,80}collide\s+FALSE/.test(body), "collide FALSE");
});

test("the type name the parser must resolve is the one the worlds write", () => {
  assert.strictEqual(HUD_TYPE_NAME, "HUD");
});

// ------------------------------------------------------------------ behaviour

test("collision traversal is skipped, because the fallback sets collide FALSE", () => {
  const plan = hudTraversal("COLLISION");
  assert.strictEqual(plan.visit, false, "HUD children never collide");
  assert.strictEqual(plan.cameraSpace, false);
});

test("every other traversal runs in camera space", () => {
  for (const kind of ALL_KINDS) {
    if (kind === "COLLISION") { continue; }
    const plan = hudTraversal(kind);
    assert.strictEqual(plan.visit, true, `${kind} must reach the children`);
    assert.strictEqual(plan.cameraSpace, true, `${kind} must be camera relative`);
  }
});

test("picking is NOT excluded, because the historical geometry is shaped for it", () => {
  // ne_game.wrl's backstop quad sets weapon range by being hit, and its
  // crosshair is built with an open centre so the ray passes through.
  assert.strictEqual(hudTraversal("PICKING").visit, true);
  assert.strictEqual(hudTraversal("POINTER").visit, true, "the turret TouchSensor needs it");
});

test("only a node that declares itself view relative replaces its parent matrix", () => {
  assert.strictEqual(isViewRelative({ bxxViewRelative: true }), true);
  assert.strictEqual(isViewRelative({ bxxViewRelative: false }), false);
  assert.strictEqual(isViewRelative({ bxxViewRelative: "yes" }), false, "no truthy coercion");
  assert.strictEqual(isViewRelative({}), false, "an ordinary Transform composes");
  assert.strictEqual(isViewRelative(null), false);
  assert.strictEqual(isViewRelative(undefined), false);
  assert.strictEqual(isViewRelative("HUD"), false, "a bare string is not a node");
});

test("the ray walk composes Transforms but resets on a HUD", () => {
  assert.strictEqual(matrixMode({}, true), "compose", "Transform");
  assert.strictEqual(matrixMode({ bxxViewRelative: true }, true), "local", "HUD");
  assert.strictEqual(matrixMode({}, false), "inherit", "Group or Shape");
  assert.strictEqual(
    matrixMode({ bxxViewRelative: true }, false),
    "inherit",
    "no matrix means nothing to replace with",
  );
});

// --------------------------------------------------------------------- wiring

test("the HUD shim is loaded by App.vue, before the ray shim reads its flag", () => {
  const source = codeOf(APP);
  const hudAt = source.indexOf("x_ite_mods/bxx_hud.js");
  const rayAt = source.indexOf("x_ite_mods/bxx_ray.js");
  assert.notStrictEqual(hudAt, -1, "App.vue must require bxx_hud.js");
  assert.notStrictEqual(rayAt, -1, "App.vue must still require bxx_ray.js");
  assert.ok(hudAt < rayAt, "the node type is registered before the ray walk loads");
});

test("the node is registered with X_ITE's own parser table", () => {
  const source = codeOf(HUD_MOD);
  assert.ok(
    source.includes("x_ite/Configuration/SupportedNodes"),
    "registration goes through SupportedNodes, which is what createNode reads",
  );
  assert.ok(source.includes("SupportedNodes.addType(\"HUD\", HUD)"), "the type name is HUD");
  assert.ok(
    source.includes("SupportedNodes.getType(\"HUD\")"),
    "registering twice must be a no-op",
  );
});

test("the node is a grouping node, so a Switch can hold it and hide it", () => {
  const source = codeOf(HUD_MOD);
  assert.ok(
    source.includes("x_ite/Components/Grouping/X3DGroupingNode"),
    "X3DGroupingNode carries X3DChildNode, which Switch casts its choice to",
  );
  assert.ok(source.includes("getContainerField: function () { return \"children\"; }"));
});

test("camera space comes from the viewpoint's own matrix, not a rebuilt one", () => {
  const source = codeOf(HUD_MOD);
  assert.ok(source.includes("getCameraSpaceMatrix"), "reuse the renderer's matrix");
  assert.ok(source.includes("modelViewMatrix.identity()"), "children draw in the viewer frame");
  assert.ok(source.includes("modelViewMatrix.pop()"), "the stack is always restored");
});

test("the ray walk asks the helper, and still composes ordinary transforms", () => {
  const source = codeOf(RAY_MOD);
  assert.ok(source.includes("hud.isViewRelative(node)"), "the seam is the shared predicate");
  assert.ok(source.includes("matrix.multRight(modelMatrix)"), "Transforms still compose");
});

test("the HUD node carries no Outlands knowledge", () => {
  const source = codeOf(HUD_MOD);
  for (const leak of ["ne_game", "outlands", "Outlands", "beamer", "turret", "score", "team"]) {
    assert.strictEqual(
      source.includes(leak),
      false,
      `a generic compatibility node must not mention ${leak}`,
    );
  }
});

test("several HUD instances are independent, because the rules are per node", () => {
  // ne_game.wrl carries two, and the second is instantiated once per Turret.
  // Nothing in the decision path is shared state, so N instances cannot
  // interfere with each other.
  const first = { bxxViewRelative: true };
  const second = { bxxViewRelative: true };
  const plain = {};
  assert.strictEqual(matrixMode(first, true), "local");
  assert.strictEqual(matrixMode(second, true), "local");
  assert.strictEqual(matrixMode(plain, true), "compose", "a sibling Transform is unaffected");
  assert.strictEqual(hudTraversal("DISPLAY").cameraSpace, hudTraversal("DISPLAY").cameraSpace);
});

test("unloading a world leaves nothing behind, because nothing is registered", () => {
  // The only cleanup a compatibility node can get wrong is state that outlives
  // the scene. This one keeps none: no listener, no timer, no interval, and no
  // registry of live instances. Its per-instance state is one matrix.
  const source = codeOf(HUD_MOD);
  for (const leak of [
    "addEventListener",
    "setInterval",
    "setTimeout",
    "requestAnimationFrame",
    "addInterest",
    "addBrowserCallback",
  ]) {
    assert.strictEqual(
      source.includes(leak),
      false,
      `a HUD instance must not outlive its scene via ${leak}`,
    );
  }
  assert.ok(source.includes("this.bxxMatrix = new Matrix4()"), "per-instance state is one matrix");
});

// ---------------------------------------------------- historical world guards

test("the Outlands worlds still use HUD, and still use only its children field", () => {
  for (const file of ["ne_game.wrl", "ne_game_gm.wrl", "ne_game_pass.wrl"]) {
    const source = world(path.join(OUTLANDS, file));
    assert.strictEqual(hudUses(source).length, 2, `${file} instantiates HUD twice`);
    assert.strictEqual(
      /HUD\s*\{\s*(?:children|$)/m.test(source),
      true,
      `${file} opens its HUD straight onto children`,
    );
    for (const unused of ["bboxSize", "bboxCenter", "addChildren", "removeChildren"]) {
      const scoped = source.slice(source.indexOf("HUD{"), source.indexOf("#END HUD"));
      assert.strictEqual(
        scoped.includes(unused),
        false,
        `${file} must not have grown a ${unused} use`,
      );
    }
  }
});

test("the Outlands worlds still declare no HUD PROTO of their own", () => {
  // The whole point of registering a node type: ne_game relies on the built-in,
  // exactly as blaxxun Contact 4.0 provided it. A PROTO appearing here would
  // mean somebody edited historical evidence instead of the runtime.
  for (const file of ["ne_game.wrl", "ne_game_gm.wrl", "ne_game_pass.wrl"]) {
    const source = world(path.join(OUTLANDS, file));
    assert.strictEqual(/PROTO\s+HUD/.test(source), false, `${file} must stay unpatched`);
    assert.strictEqual(
      /EXTERNPROTO\s+HUD/.test(source),
      false,
      `${file} must not gain an EXTERNPROTO`,
    );
  }
});

test("the Outlands weapon ray still depends on HUD geometry being pickable", () => {
  const source = world(path.join(OUTLANDS, "ne_game.wrl"));
  assert.ok(
    /Backstop -- set translation to set weapon range/.test(source),
    "the backstop comment is the evidence that HUD geometry is hit",
  );
  assert.ok(
    source.includes("Browser.computeRayHit"),
    "and the world still fires that ray",
  );
});

test("the Plaza keeps its own EXTERNPROTO, and the built-in must satisfy it too", () => {
  const source = world(PLAZA);
  assert.ok(/EXTERNPROTO\s+HUD/.test(source), "enter.wrl declares the fallback");
  assert.strictEqual(hudUses(source).length, 1, "and instantiates one HUD");
});

// ------------------------------------------------ near plane clearance (4.)
//
// The QA defect this block guards is HUD_NEAR_PLANE_COMPATIBILITY_DEFECT.
// X_ITE derives its near clipping distance from the avatar, not from the
// content: `NavigationInfo.getNearValue()` is `getCollisionRadius() / 2`, and
// CTR leaves the collision radius at the X_ITE default 0.25, so the plane sits
// at 0.125. The Outlands crosshair is drawn at z -0.1 and is lost behind it.
// The correction is a uniform scale about the eye, and these tests pin both
// halves of it: that it fires for geometry inside the plane, and that it is
// exactly 1 - a true no-op - for everything else.

/** The near distance CTR actually runs with: default avatarSize[0] 0.25 / 2. */
const CTR_NEAR = 0.125;

/** A HUD whose nearest face sits `distance` units in front of the eye. */
const at = (distance: number): { empty: boolean; maxZ: number } =>
  ({ empty: false, maxZ: -distance });

test("the historical crosshair distance is inside CTR's near plane", () => {
  // Not an assumption - this is read back out of the shipped world.
  const source = world(path.join(OUTLANDS, "ne_game.wrl"));
  assert.ok(
    /#CrossHairs[\s\S]{0,80}?translation 0 0 -\.1\b/.test(source),
    "ne_game.wrl still draws its crosshair at z -0.1",
  );
  assert.ok(0.1 < CTR_NEAR, "and 0.1 is nearer than the 0.125 near plane");
});

test("a crosshair at 0.100 is scaled out past the near plane", () => {
  const scale = hudNearClearanceScale(at(0.1), CTR_NEAR);
  assert.ok(scale > 1, "the correction must fire");
  assert.ok(
    0.1 * scale > CTR_NEAR,
    `scaled crosshair ${0.1 * scale} must clear ${CTR_NEAR}`,
  );
  assert.strictEqual(scale, (CTR_NEAR * HUD_NEAR_MARGIN) / 0.1);
});

test("normal HUD content farther than the near plane is not touched at all", () => {
  // The Plaza's transport message (z -0.5) and the Outlands turret panel
  // (z -0.199) are the two real cases. Both must come back exactly 1, because
  // anything else would move geometry that was already rendering correctly.
  assert.strictEqual(hudNearClearanceScale(at(0.5), CTR_NEAR), 1, "Plaza");
  assert.strictEqual(hudNearClearanceScale(at(0.199), CTR_NEAR), 1, "turret");
  assert.strictEqual(hudNearClearanceScale(at(100), CTR_NEAR), 1, "backstop");
});

test("the scale preserves screen position, so relative HUD depth survives", () => {
  // A uniform scale about the eye cancels in the perspective divide: the
  // projected x/-z and y/-z of every child are unchanged. What must be checked
  // is that one scale is applied to the whole subtree, so the ORDER of the
  // children is kept - crosshair in front of messages, messages in front of
  // the weapon.
  const scale = hudNearClearanceScale(at(0.1), CTR_NEAR);
  const crosshair = 0.1 * scale;
  const messages = 0.2 * scale;
  const weapon = 0.35 * scale;

  assert.ok(crosshair < messages, "crosshair stays nearest");
  assert.ok(messages < weapon, "messages stay in front of the weapon");
  // Screen position is the ratio of a lateral offset to depth; it is invariant.
  assert.ok(
    Math.abs(0.05 / 0.2 - (0.05 * scale) / messages) < 1e-12,
    "the message offset projects to the same screen position",
  );
});

test("the clearance rule refuses cases a scale cannot fix", () => {
  assert.strictEqual(hudNearClearanceScale({ empty: true, maxZ: -0.1 }, CTR_NEAR), 1,
    "an empty HUD is left alone");
  assert.strictEqual(hudNearClearanceScale(at(0), CTR_NEAR), 1,
    "geometry at the eye cannot be scaled out");
  assert.strictEqual(hudNearClearanceScale(at(-1), CTR_NEAR), 1,
    "geometry behind the eye cannot be scaled out");
  assert.strictEqual(hudNearClearanceScale(at(0.1), 0), 1,
    "a zero near value is not trusted");
  assert.strictEqual(hudNearClearanceScale(at(NaN), CTR_NEAR), 1,
    "an unmeasurable bbox is left alone");
});

test("geometry exactly on the near plane counts as clipped", () => {
  assert.ok(
    hudNearClearanceScale(at(CTR_NEAR), CTR_NEAR) > 1,
    "a HUD sitting exactly on the plane is not reliably drawn, so it is moved",
  );
});

test("the clearance scale tracks the near value rather than assuming 0.125", () => {
  // If a world ever sets its own avatarSize, the correction must follow it.
  // Nothing in the rule is pinned to CTR's default.
  const wide = hudNearClearanceScale(at(0.1), 1);
  assert.ok(0.1 * wide > 1, "a 1.0 near plane is cleared too");
  assert.strictEqual(hudNearClearanceScale(at(0.1), 0.05), 1,
    "a near plane the content already clears leaves it alone");
});

test("only the drawing and hit-testing traversals take the clearance scale", () => {
  // DISPLAY and SHADOW rasterize. POINTER and PICKING hit-test, and X_ITE's
  // pointer ray STARTS at the near plane, so an unscaled HUD button nearer
  // than the plane could never be touched - visible placement and pointer
  // placement have to use the same transform or a button lies about where it
  // is. CAMERA only collects bindables, and COLLISION is skipped outright.
  for (const kind of ["DISPLAY", "SHADOW", "POINTER", "PICKING"] as TraverseKind[]) {
    assert.strictEqual(hudTraversal(kind).nearClearance, true, kind);
  }
  assert.strictEqual(hudTraversal("CAMERA").nearClearance, false, "CAMERA");
  assert.strictEqual(hudTraversal("COLLISION").visit, false, "COLLISION skipped");
  assert.strictEqual(hudTraversal("COLLISION").nearClearance, false, "COLLISION");
});

test("collision exclusion is unchanged by the clearance correction", () => {
  const plan = hudTraversal("COLLISION");
  assert.strictEqual(plan.visit, false, "HUD never blocks player movement");
  assert.strictEqual(plan.cameraSpace, false);
  const code = codeOf(HUD_MOD);
  assert.ok(
    /if\s*\(!plan\.visit\)\s*\{\s*return;/.test(code),
    "and the binding still returns before touching the matrix stack",
  );
});

test("the binding measures the scale and never hard-codes a distance", () => {
  const code = codeOf(HUD_MOD);
  assert.ok(
    code.includes("hud.hudNearClearanceScale"),
    "the shipped rule is the unit-tested one",
  );
  assert.ok(
    code.includes("getNearValue"),
    "and it reads the live near value from NavigationInfo",
  );
  assert.ok(
    code.includes("getBBox"),
    "and the distance comes from the node's own bounding box",
  );
  assert.ok(
    !/0\.1(?![0-9])|0\.125|ne_game|crosshair|Outlands/i.test(code),
    "no world name and no historical coordinate may appear in the binding",
  );
});

test("the correction changes no navigation or projection setting", () => {
  // The HUD READS the near value - that is the whole measurement - but it must
  // not write anything global. A fix that widened avatarSize, moved the
  // projection or touched the depth range would change every normal world too,
  // which is exactly what this lane was told not to do.
  const code = codeOf(HUD_MOD);
  for (const forbidden of [
    "avatarSize",
    "setCollisionDetection",
    "collisionRadius",
    "getProjectionMatrix",
    "getProjectionMatrixWithLimits",
    "depthRange",
    "depthFunc",
    "getViewVolumes",
    "setNearValue",
  ]) {
    assert.ok(
      !code.includes(forbidden),
      `the HUD node must not reach for ${forbidden} - the fix is local to the HUD`,
    );
  }
  // NavigationInfo is read, and read only: no assignment to any of its fields.
  assert.ok(code.includes("getNearValue"), "the near value is read");
  assert.ok(
    !/navigationInfo\s*\.\s*[A-Za-z_]+\s*=(?!=)/.test(code),
    "and nothing on the NavigationInfo is assigned to",
  );
  assert.ok(
    code.includes("getModelViewMatrix"),
    "the whole correction lives in the model-view stack",
  );
  assert.ok(
    !code.includes("getProjectionMatrix"),
    "and never in the projection stack, which is global to the layer",
  );
});

test("the ray walk keeps historical distances, unscaled", () => {
  const code = codeOf(HUD_MOD);
  const getMatrix = code.slice(code.indexOf("getMatrix: function"));
  const body = getMatrix.slice(0, getMatrix.indexOf("traverse: function"));
  assert.ok(
    !body.includes("nearClearanceScale"),
    "getMatrix feeds computeRayHit, which must see the world's own coordinates",
  );
  const ray = codeOf(RAY_MOD);
  assert.ok(
    ray.includes("isViewRelative"),
    "and the ray walk still treats a HUD as view-relative",
  );
});

test("the near-plane correction did not edit a historical world", () => {
  // Belt and braces against "fixing" the crosshair by moving it.
  for (const file of ["ne_game.wrl", "ne_game_gm.wrl", "ne_game_pass.wrl"]) {
    const source = world(path.join(OUTLANDS, file));
    assert.ok(
      hudUses(source).length > 0,
      `${file} must still instantiate HUD`,
    );
  }
  const outlands = world(path.join(OUTLANDS, "ne_game.wrl"));
  assert.ok(
    outlands.includes("translation 0 0 -100"),
    "the backstop must still sit at exactly 100 units",
  );
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
