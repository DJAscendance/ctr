/**
 * Phase 2 gate: the X_ITE 4.7.0 -> 16.2.0 migration contract.
 *
 * Two kinds of assertion live here, and they are kept apart on purpose.
 *
 *   1. SOURCE SHAPE. The runtime pin, the patch load order, and the parts of
 *      WorldBrowserPage that reach for an X_ITE API whose shape changed between
 *      4.7 and 16.2. These are greps, and a grep can only prove that the right
 *      call is written - the live gates under `qa/phase2/` prove it works.
 *   2. PURE LOGIC. The remote-citizen registry contract that a weapon ray will
 *      depend on in Phase 3: a rendered node resolves to exactly one presence,
 *      two tabs of one member never collapse into one, and a world change drops
 *      every binding. No browser, no X_ITE, no socket.
 *
 * Negative controls are used wherever a passing assertion could otherwise be
 * satisfied by an empty file or an absent lookup.
 */
import assert from "assert";

import { Presence, PresenceStore, presenceKey } from "../src/presence";
import { RemoteMemberRegistry, SelfIdentity } from "../src/remote-members";

const fs = require("fs");
const path = require("path");

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

// Tests run from tests/.compiled/tests/, not from tests/ - three levels up
// is the spa root either way. Matches the other source-shape suites.
const SPA = path.resolve(__dirname, "../../..");

/*
 * Source with its comments removed.
 *
 * These files explain the migration in prose, and that prose names the very
 * calls the assertions below forbid - `updateImportedNode`, `_value`,
 * `replaceWorld`. Matching raw source would let a comment satisfy a rule, and
 * would fail a rule that the code already honours. Every assertion about what
 * the code DOES reads this; assertions about ordering read the raw file.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const read = (rel: string): string => fs.readFileSync(path.join(SPA, rel), "utf8");
/** The same file with its explanatory comments taken out. */
const code = (rel: string): string => stripComments(read(rel));
const exists = (rel: string): boolean => fs.existsSync(path.join(SPA, rel));

const INDEX_HTML = "public/index.html";
const APP_VUE = "src/App.vue";
const WORLD_PAGE = "src/pages/world-browser/WorldBrowserPage.vue";
const MODS = "src/libs/x_ite_mods";

// 1. X_ITE 16 RUNTIME SELECTION -----------------------------------------------

test("the page loads X_ITE 16.2.0", () => {
  const html = read(INDEX_HTML);
  assert.ok(/x_ite@16\.2\.0\/dist\/x_ite\.min\.js/.test(html), "no 16.2.0 script tag");
  assert.ok(/x_ite@16\.2\.0\/dist\/x_ite\.min\.css/.test(html), "no 16.2.0 stylesheet");
});

test("no 4.7.0 runtime is left behind", () => {
  assert.ok(!/x_ite@4\./.test(read(INDEX_HTML)), "a 4.x x_ite URL is still referenced");
});

test("the version is pinned exactly, never floating", () => {
  const html = read(INDEX_HTML);
  const versions = (html.match(/x_ite@[^/"]+/g) || []).map(s => s.replace("x_ite@", ""));
  assert.ok(versions.length > 0, "no x_ite reference found at all");
  for (const v of versions) {
    assert.strictEqual(v, "16.2.0", `x_ite pinned as '${v}', which is not an exact version`);
  }
  // The three shapes that would let the CDN move the engine under us.
  assert.ok(!/x_ite@(latest|16["/]|\^)/.test(html), "a floating x_ite version is referenced");
});

test("the pinned bundle carries an integrity hash", () => {
  const html = read(INDEX_HTML);
  const sri = html.match(/integrity="sha384-[A-Za-z0-9+/=]+"/g) || [];
  assert.ok(sri.length >= 2, `expected an SRI hash on both x_ite tags, found ${sri.length}`);
});

// 2. PATCH LOAD ORDER ---------------------------------------------------------

/** The `x3dPatches` array in App.vue, in order. */
function patchOrder(): string[] {
  const app = read(APP_VUE);
  const block = app.match(/const x3dPatches = \[([\s\S]*?)\];/);
  assert.ok(block, "App.vue has no x3dPatches array");
  return (block[1].match(/"([a-z0-9_]+\.js)"/g) || []).map(s => s.replace(/"/g, ""));
}
const at = (name: string): number => patchOrder().indexOf(name);

test("the compatibility shim is required before the patch list", () => {
  const app = read(APP_VUE);
  const compat = app.indexOf("require(\"./libs/x_ite_mods/x_ite_compat.js\")");
  const list = app.indexOf("const x3dPatches");
  assert.ok(compat !== -1, "x_ite_compat.js is not required at all");
  assert.ok(compat < list, "x_ite_compat.js is not required before the patch list");
});

test("the compat shim is NOT also inside the list it has to precede", () => {
  assert.strictEqual(at("x_ite_compat.js"), -1,
    "x_ite_compat.js is in x3dPatches, so its ordering guarantee is lost");
});

test("every patch loads inside its own try/catch", () => {
  const app = read(APP_VUE);
  // Built from parts so the pattern stays inside the line limit.
  const loop = new RegExp(
    "for \\(const patch of x3dPatches\\)[\\s\\S]*?"
    + "try \\{[\\s\\S]*?require\\(`\\./libs/x_ite_mods/\\$\\{patch\\}`\\)",
  );
  assert.ok(loop.test(app), "the patch loop does not require each patch inside a try");
});

test("bxx_avatars loads after bxx_rayhit, whose computeRayHit it wraps", () => {
  assert.ok(at("bxx_rayhit.js") !== -1, "bxx_rayhit.js is not loaded");
  assert.ok(at("bxx_avatars.js") > at("bxx_rayhit.js"),
    "bxx_avatars.js would capture a computeRayHit that does not exist yet");
});

test("bxx_events loads after bxx_auth, which creates the route store it drains", () => {
  assert.ok(at("bxx_events.js") > at("bxx_auth.js"));
});

test("bxx_identity loads after bxx_auth, whose accessors it layers over", () => {
  assert.ok(at("bxx_identity.js") > at("bxx_auth.js"));
});

test("bxx_url stays the outermost loadURL wrapper", () => {
  const order = patchOrder();
  assert.strictEqual(order[order.length - 1], "bxx_url.js",
    "bxx_url.js is not last; a suppressed legacy call would reach an inner wrapper");
});

test("every patch named in the list is a file that exists", () => {
  for (const patch of patchOrder()) {
    assert.ok(exists(`${MODS}/${patch}`), `x3dPatches names ${patch}, which does not exist`);
  }
});

test("the 4.7-only patches are gone, not merely unreferenced", () => {
  // Each of these reached for an API X_ITE 16.2.0 removed. Leaving the file on
  // disk invites it back into the list.
  for (const dead of [
    "spec_color.js", "bxx_speed_avatar.js", "default_gravity.js",
    "extend_context_menu.js", "test.js", "bxx_node.js", "bxx_ray.js",
  ]) {
    assert.ok(!exists(`${MODS}/${dead}`), `${dead} still exists`);
    assert.strictEqual(at(dead), -1, `${dead} is still in x3dPatches`);
  }
});

test("NEGATIVE CONTROL: the patch list is not empty", () => {
  assert.ok(patchOrder().length >= 10,
    "x3dPatches is suspiciously short - the ordering assertions above would pass vacuously");
});

// 3. THE REMOTE CITIZEN IS BUILT UNDER A COLLISION WRAPPER --------------------

test("a remote citizen is wrapped in a Collision node with collide FALSE", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/createNode\("Collision"\)/.test(page), "no Collision node is created");
  assert.ok(/collision\.collide = false;/.test(page), "the wrapper does not set collide false");
  assert.ok(/collision\.children = \[inline\];/.test(page), "the Inline is not inside the wrapper");
  assert.ok(/addRootNode\(collision\)/.test(page), "the wrapper is not added as a root node");
});

test("the Inline is attached only through the wrapper, never as a root node itself", () => {
  const page = code(WORLD_PAGE);
  assert.ok(!/addRootNode\(inline\)/.test(page) && !/addRootNode\(avInline\)/.test(page),
    "the avatar Inline is still added to the scene directly, so it would block WALK");
});

test("the registry binds the WRAPPER, not the Inline", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/bindRemoteNode\(key, collision\)/.test(page),
    "bindRemoteNode is not called with the collision wrapper");
  assert.ok(!/bindRemoteNode\(key, avInline\)/.test(page),
    "the Inline is still bound; X_ITE 16 hands back a fresh wrapper for a child node");
});

test("the citizen registered as a blaxxun Avatar is keyed by presence, not by username", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/registerBlaxxunAvatar\(collision, key\)/.test(page),
    "registerBlaxxunAvatar is not called with (wrapper, presenceKey)");
  assert.ok(!/registerBlaxxunAvatar\([^)]*username/.test(page),
    "a username is being used as the rendered identity");
});

test("the avatar transform node comes from the Inline's own scene, not from IMPORT", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/getNamedNode\("Avatar"\)/.test(page), "the DEF'd Avatar node is not looked up");
  assert.ok(!/updateImportedNode/.test(page) && !/getImportedNode/.test(page),
    "IMPORT is still used; X_ITE 16 returns a stub that silently drops set_position");
});

test("load completion is not watched with a LoadSensor", () => {
  const page = code(WORLD_PAGE);
  assert.ok(!/createNode\("LoadSensor"\)/.test(page),
    "LoadSensor is X3D-only and X_ITE 16 refuses it in a VRML97 scene");
});

test("the wrapper is recorded before the model arrives, so a mid-load leave cleans up", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/if \(onAttached\) onAttached\(\{ collision, inline \}\)/.test(page),
    "the nodes are only recorded on resolve, so an in-flight wrapper would be stranded");
});

test("removal detaches the wrapper, which takes the Inline with it", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/const attached = entry\.collision \|\| entry\.inline;/.test(page),
    "the detach path does not prefer the wrapper");
  assert.ok(/unregisterBlaxxunAvatar\(attached\)/.test(page),
    "the blaxxun avatar registration is not released");
});

test("a world change disposes the citizens' nodes rather than dropping the map", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/clearRenderedPresences\(\): void/.test(page), "no clearRenderedPresences method");
  assert.ok(!/this\.users = \{\};/.test(page),
    "users is still reset by assignment, which strands every node in the old scene");
});

// 4. THE X_ITE APIS WHOSE SHAPE CHANGED ---------------------------------------

test("addFieldCallback is called key-first, as X_ITE 16 declares it", () => {
  // 16.2.0 destructures the 3-arg form as [key, name, callback]. The 4.7 order
  // throws "n.match is not a function" and takes the whole callback with it.
  const page = code(WORLD_PAGE);
  const calls = page.match(/\.(add|remove)FieldCallback\(([^,)]+)/g) || [];
  assert.ok(calls.length > 0, "no addFieldCallback call found to check");
  for (const call of calls) {
    const first = call.replace(/.*FieldCallback\(/, "").trim();
    assert.ok(!/^["'`]/.test(first),
      `${call} passes the field name first; X_ITE 16 takes the key first`);
  }
});

test("no code reads the internal _value holder X_ITE 16 removed", () => {
  const page = code(WORLD_PAGE);
  const uses = (page.match(/\w+\._value/g) || []);
  assert.deepStrictEqual(uses, [],
    `_value has no holder in 16.2.0; found ${uses.join(", ")}`);
});

test("the world load promise is owned and settled exactly once", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/const load = browser\.loadURL\(/.test(page),
    "the loadURL promise is discarded, so a superseded run can never settle");
  assert.ok(/let settled = false;/.test(page) && /const settleOnce =/.test(page),
    "there is no single-settlement guard");
  assert.ok(/supersededWorldLoad\(error\)/.test(page),
    "a supersession is not told apart from a real load failure");
});

test("the browser callback is keyed by the component, not by a fresh object", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/addBrowserCallback\(this,/.test(page),
    "a fresh key registers a new callback per load and keeps every earlier one");
  assert.ok(!/addBrowserCallback\(\{\}/.test(page));
});

test("the 3D path performs no world replacement of its own (O4/O6)", () => {
  const page = code(WORLD_PAGE);
  const threeD = page.slice(
    page.indexOf("if(this.$store.data.view3d && !this.force2d) {"),
    page.indexOf("} else {", page.indexOf("if(this.$store.data.view3d && !this.force2d) {")),
  );
  assert.ok(threeD.length > 0, "could not isolate the 3D branch");
  assert.ok(!/replaceWorld/.test(threeD),
    "the 3D branch still calls replaceWorld; loadURL's own replacement evicts it");
});

/*
 * The 2D teardown rule, written over source text rather than over one regex, so
 * a negative control below can feed it the ordering this branch used to have.
 * Returns the fault it found, or null when the branch honours the contract.
 *
 * releaseWorldScriptState() names the outgoing world through
 * browser.currentScene, and replaceWorld(null) puts an empty scene there. A
 * release asked for after the replacement therefore has nothing left to name,
 * and the outgoing world's Scripts stay on the window's unload listener.
 */
function twoDTeardownFault(page: string): string | null {
  const branchAt = page.indexOf("if(this.$store.data.view3d && !this.force2d) {");
  if (branchAt === -1) return "could not find the 3D/2D branch";
  const elseAt = page.indexOf("} else {", branchAt);
  const endAt = page.indexOf("async unloadPlace(");
  if (elseAt === -1 || endAt === -1 || endAt < elseAt) return "could not isolate the 2D branch";
  const twoD = page.slice(elseAt, endAt);
  const release = twoD.indexOf("this.releaseWorldScriptState(browser)");
  const replace = twoD.indexOf("browser.replaceWorld(null)");
  if (release === -1) return "leaving 3D no longer releases the world";
  if (replace === -1) return "leaving 3D no longer replaces the world";
  if (release > replace) return "the world is replaced before it is released";
  return null;
}

/** The same source with that one pair of calls put back in the old order. */
function replaceBeforeRelease(page: string): string {
  return page.replace(
    /this\.releaseWorldScriptState\(browser\);(\s*)browser\.replaceWorld\(null\);/,
    "browser.replaceWorld(null);$1this.releaseWorldScriptState(browser);",
  );
}

test("the 2D path still tears the old world down, because nothing supersedes it", () => {
  assert.strictEqual(twoDTeardownFault(code(WORLD_PAGE)), null);
});

test("NEGATIVE CONTROL: replacing the 2D world before releasing it is caught", () => {
  const page = code(WORLD_PAGE);
  const swapped = replaceBeforeRelease(page);
  assert.notStrictEqual(swapped, page, "the fixture changed nothing, so it proves nothing");
  assert.strictEqual(twoDTeardownFault(swapped), "the world is replaced before it is released");
});

/*
 * Inside the release itself the Scripts go first. X_ITE's Script.dispose() runs
 * the world's own shutdown(), and ne_game.wrl's shutdown() hands the blaxxun
 * event mask and the browser event route back. Sweeping the browser first would
 * be undone by that shutdown a moment later, and the next world would inherit
 * the mask and the route.
 */
function releaseOrderFault(page: string): string | null {
  const at = page.indexOf("releaseWorldScriptState(browser: any): void {");
  if (at === -1) return "releaseWorldScriptState is gone";
  const rest = page.slice(at);
  const body = rest.slice(0, rest.indexOf("resetGravity(browser: any)"));
  const scripts = body.indexOf("releaseWorldScripts(browser.currentScene)");
  const sweep = body.indexOf("browser.releaseBlaxxunWorldState()");
  if (scripts === -1) return "the outgoing world's Scripts are no longer disposed";
  if (sweep === -1) return "the browser-level blaxxun state is no longer swept";
  if (scripts > sweep) return "the browser is swept before the Scripts shut down";
  return null;
}

test("the outgoing world's Scripts are released before the browser-state sweep", () => {
  assert.strictEqual(releaseOrderFault(code(WORLD_PAGE)), null);
});

test("NEGATIVE CONTROL: sweeping the browser before Script shutdown is caught", () => {
  const page = code(WORLD_PAGE);
  const scripts = "releaseWorldScripts(browser.currentScene);";
  const sweep = "browser.releaseBlaxxunWorldState();";
  const swapped = page
    .replace(scripts, "__SWEEP__")
    .replace(sweep, scripts)
    .replace("__SWEEP__", sweep);
  assert.notStrictEqual(swapped, page, "the fixture changed nothing, so it proves nothing");
  assert.strictEqual(releaseOrderFault(swapped),
    "the browser is swept before the Scripts shut down");
});

test("a NULL-declared SharedEvent list is filtered rather than iterated", () => {
  const page = code(WORLD_PAGE);
  assert.ok(/sharedEventNodes\(sharedZone\.events\)/.test(page),
    "sharedZone.events is iterated raw; a NULL entry throws and kills place startup");
});

// 5. THE RAY TARGET CONTRACT (pure) -------------------------------------------

const ME: SelfIdentity = { memberId: 1, presenceId: "my-tab" };

function presence(memberId: number, presenceId: string, username?: string): Presence {
  return {
    memberId,
    presenceId,
    socketId: `sock-${memberId}-${presenceId}`,
    username: username || `user${memberId}`,
    avatar: { directory: "d", filename: "f.wrl" },
  } as Presence;
}

function fresh(): { store: PresenceStore; registry: RemoteMemberRegistry } {
  const store = new PresenceStore();
  const registry = new RemoteMemberRegistry(() => ME);
  registry.attach(store);
  return { store, registry };
}

/** Stands in for the Collision wrapper: identity is all the registry uses. */
const wrapper = (label: string): any => ({ node: label });

/** Asserts the lookup found somebody before reading them, so a missed binding
 * fails as "no member resolved" rather than as a property access on undefined. */
function must(member: any, what: string): any {
  assert.ok(member, `${what}: no remote member resolved`);
  return member;
}

test("a bound node resolves to its presence key and to that citizen", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(2, "tab-a")]);
  const key = presenceKey(2, "tab-a");
  const node = wrapper("A");
  registry.bindRemoteNode(key, node);
  assert.strictEqual(registry.remoteKeyForNode(node), key);
  assert.strictEqual(must(registry.remoteMemberForNode(node), "bound node").presenceId, "tab-a");
});

test("NEGATIVE CONTROL: an unbound node resolves to nobody", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(2, "tab-a")]);
  registry.bindRemoteNode(presenceKey(2, "tab-a"), wrapper("A"));
  assert.strictEqual(registry.remoteKeyForNode(wrapper("some world Transform")), undefined);
  assert.strictEqual(registry.remoteMemberForNode(wrapper("some world Transform")), undefined);
});

test("two tabs of ONE member are two presences with two nodes", () => {
  const { store, registry } = fresh();
  // Same member, same username, two tabs. This is the case a username-keyed
  // registry collapses and a presence-keyed one must not.
  store.reconcile([presence(2, "tab-a", "sameName"), presence(2, "tab-b", "sameName")]);
  const keyA = presenceKey(2, "tab-a");
  const keyB = presenceKey(2, "tab-b");
  assert.notStrictEqual(keyA, keyB);

  const nodeA = wrapper("A");
  const nodeB = wrapper("B");
  registry.bindRemoteNode(keyA, nodeA);
  registry.bindRemoteNode(keyB, nodeB);

  assert.strictEqual(registry.remoteKeyForNode(nodeA), keyA);
  assert.strictEqual(registry.remoteKeyForNode(nodeB), keyB);
  assert.strictEqual(must(registry.remoteMemberForNode(nodeA), "node A").username, "sameName");
  assert.strictEqual(must(registry.remoteMemberForNode(nodeB), "node B").username, "sameName");
  assert.notStrictEqual(
    must(registry.remoteMemberForNode(nodeA), "node A").presenceId,
    must(registry.remoteMemberForNode(nodeB), "node B").presenceId,
  );
});

test("rebinding a key releases the node it used to answer to", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(2, "tab-a")]);
  const key = presenceKey(2, "tab-a");
  const first = wrapper("first");
  const second = wrapper("second");
  registry.bindRemoteNode(key, first);
  registry.bindRemoteNode(key, second);
  assert.strictEqual(registry.remoteKeyForNode(second), key);
  assert.strictEqual(registry.remoteKeyForNode(first), undefined,
    "the replaced node still answers to the citizen");
});

test("a citizen who leaves stops being a ray target in the same call", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(2, "tab-a")]);
  const key = presenceKey(2, "tab-a");
  const node = wrapper("A");
  registry.bindRemoteNode(key, node);
  store.remove(key);
  assert.strictEqual(registry.remoteKeyForNode(node), undefined);
  assert.strictEqual(registry.remoteMemberForNode(node), undefined);
});

test("a world change drops every binding and reports how many", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(2, "tab-a"), presence(3, "tab-b")]);
  registry.bindRemoteNode(presenceKey(2, "tab-a"), wrapper("A"));
  registry.bindRemoteNode(presenceKey(3, "tab-b"), wrapper("B"));
  const cleared = registry.clearRemoteMembers();
  assert.strictEqual(cleared.cleared, 2);
  assert.strictEqual(registry.remoteKeyForNode(wrapper("A")), undefined);
});

test("a node from the previous world never resolves after the world changed", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(2, "tab-a")]);
  const oldWorldNode = wrapper("world A wrapper");
  registry.bindRemoteNode(presenceKey(2, "tab-a"), oldWorldNode);

  // What WorldBrowserPage does on a place change: a brand new store, re-attached.
  const nextStore = new PresenceStore();
  registry.attach(nextStore);
  nextStore.reconcile([presence(2, "tab-a")]);

  assert.strictEqual(registry.remoteKeyForNode(oldWorldNode), undefined,
    "a node built in the world we left still answers to a citizen");
  assert.strictEqual(registry.remoteMemberForNode(oldWorldNode), undefined);
});

test("the local user is never a ray target, even with a node bound to their key", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(1, "my-tab"), presence(2, "tab-a")]);
  const mine = wrapper("me");
  registry.bindRemoteNode(presenceKey(1, "my-tab"), mine);
  assert.strictEqual(registry.remoteMemberForNode(mine), undefined,
    "the local citizen resolves as a remote target");
});

// ---------------------------------------------------------------------------

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : err);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
