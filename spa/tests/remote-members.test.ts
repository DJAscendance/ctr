/**
 * Pure-logic tests for the Outlands remote-member adapter.
 *
 * These drive the real PresenceStore with the real Beta payload shapes - the
 * same records `server.js` puts in ROOM_STATE - and prove that every operation
 * the accepted Outlands free-play code performs has a Beta-native answer, with
 * no socket, no browser and no X_ITE.
 *
 * The eight operations under test, from the accepted line:
 *   enumerate current remote citizens
 *   add one remote citizen
 *   update remote position
 *   update remote rotation
 *   remove remote citizen
 *   find the correct remote avatar for a combat ray
 *   clear remote citizens on world change
 *   preserve one active presence per remote representation
 */
import assert from "assert";

import { Presence, PresenceStore, presenceKey } from "../src/presence";
import { RemoteMemberRegistry, SelfIdentity } from "../src/remote-members";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

const ME: SelfIdentity = { memberId: 1, presenceId: "my-tab" };

/** A ROOM_STATE-shaped record. `pos`/`rot` omitted unless explicitly given. */
function presence(memberId: number, presenceId: string, extra: Partial<Presence> = {}): Presence {
  return {
    memberId,
    presenceId,
    socketId: `sock-${memberId}-${presenceId}`,
    username: `user${memberId}`,
    avatar: { directory: "d", filename: "f.wrl" },
    ...extra,
  } as Presence;
}

function fresh(): { store: PresenceStore; registry: RemoteMemberRegistry } {
  const store = new PresenceStore();
  const registry = new RemoteMemberRegistry(() => ME);
  registry.attach(store);
  return { store, registry };
}

// --- enumerate -------------------------------------------------------------

test("an empty room enumerates no remote citizens", () => {
  const { registry } = fresh();
  assert.deepStrictEqual(registry.listRemoteMembers(), []);
});

test("the local user is never a remote citizen, however the store learned about them", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(1, "my-tab"), presence(2, "other")]);
  const keys = registry.listRemoteMembers().map(m => m.key);
  assert.deepStrictEqual(keys, [presenceKey(2, "other")]);
  assert.strictEqual(registry.getRemoteMember(presenceKey(1, "my-tab")), undefined);
});

test("another tab of the LOCAL member is a remote citizen - same member, different presence", () => {
  const { store, registry } = fresh();
  store.reconcile([presence(1, "my-tab"), presence(1, "my-other-tab")]);
  const keys = registry.listRemoteMembers().map(m => m.key);
  assert.deepStrictEqual(keys, [presenceKey(1, "my-other-tab")]);
});

test("a ROOM_STATE that landed before gameplay attached is drained, not lost", () => {
  const store = new PresenceStore();
  store.reconcile([presence(2, "a"), presence(3, "b")]);
  const registry = new RemoteMemberRegistry(() => ME);
  const seen: string[] = [];
  registry.onRemoteChange(c => seen.push(`${c.type}:${c.type === "remove" ? c.key : c.member.key}`));
  registry.attach(store);
  assert.deepStrictEqual(seen.sort(), ["add:2:a", "add:3:b"]);
});

test("an unattached registry answers empty instead of throwing", () => {
  const registry = new RemoteMemberRegistry(() => ME);
  assert.deepStrictEqual(registry.listRemoteMembers(), []);
  assert.strictEqual(registry.getRemoteMember("2:a"), undefined);
  assert.strictEqual(registry.updateRemoteTransform("2:a", [1, 2, 3]), undefined);
  assert.strictEqual(registry.removeRemoteMember("2:a"), undefined);
});

// --- add / one presence per representation ---------------------------------

test("adding a remote citizen makes it enumerable under its logical key", () => {
  const { registry } = fresh();
  const added = registry.upsertRemoteMember(presence(2, "a"));
  assert.ok(added);
  assert.strictEqual(added!.key, "2:a");
  assert.strictEqual(registry.listRemoteMembers().length, 1);
});

test("repeated adds for one key collapse to a single representation", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a"));
  registry.upsertRemoteMember(presence(2, "a"));
  registry.upsertRemoteMember(presence(2, "a", { socketId: "sock-reconnected" }));
  assert.strictEqual(registry.listRemoteMembers().length, 1);
  assert.strictEqual(registry.getRemoteMember("2:a")!.socketId, "sock-reconnected");
});

test("a reconnect changes only the socket id - the render key is unchanged", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a", { socketId: "before" }));
  const before = registry.getRemoteMember("2:a")!;
  registry.upsertRemoteMember(presence(2, "a", { socketId: "after" }));
  const after = registry.getRemoteMember("2:a")!;
  assert.notStrictEqual(before.socketId, after.socketId);
  assert.strictEqual(before.key, after.key);
  assert.strictEqual(registry.listRemoteMembers().length, 1);
});

test("two tabs of one member are two representations, not one", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "tab-1"));
  registry.upsertRemoteMember(presence(2, "tab-2"));
  assert.strictEqual(registry.listRemoteMembers().length, 2);
  assert.deepStrictEqual(
    registry.listRemoteMembers().map(m => m.key).sort(),
    ["2:tab-1", "2:tab-2"],
  );
});

// --- no false position ------------------------------------------------------

test("a citizen with no reported transform has NO position - not [0,0,0]", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a"));
  const member = registry.getRemoteMember("2:a")!;
  assert.strictEqual(member.pos, undefined);
  assert.strictEqual(member.rot, undefined);
});

test("only citizens with a real position are placeable targets", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "nowhere"));
  registry.upsertRemoteMember(presence(3, "somewhere", { pos: [4, 0, 5] }));
  const placeable = registry.placeableRemoteMembers().map(m => m.key);
  assert.deepStrictEqual(placeable, ["3:somewhere"]);
});

test("an authored origin IS a real position and stays targetable", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "origin", { pos: [0, 0, 0] }));
  assert.deepStrictEqual(registry.placeableRemoteMembers().map(m => m.key), ["2:origin"]);
});

// --- update position / rotation --------------------------------------------

test("a position update lands on the right citizen", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a"));
  registry.upsertRemoteMember(presence(3, "b"));
  registry.updateRemoteTransform("2:a", [7, 8, 9]);
  assert.deepStrictEqual(registry.getRemoteMember("2:a")!.pos, [7, 8, 9]);
  assert.strictEqual(registry.getRemoteMember("3:b")!.pos, undefined);
});

test("a rotation-only update does not erase a known position", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a", { pos: [1, 2, 3] }));
  registry.updateRemoteTransform("2:a", undefined, [0, 1, 0, 1.5]);
  const member = registry.getRemoteMember("2:a")!;
  assert.deepStrictEqual(member.pos, [1, 2, 3]);
  assert.deepStrictEqual(member.rot, [0, 1, 0, 1.5]);
});

test("a transform update for an unknown citizen is ignored, not invented", () => {
  const { registry } = fresh();
  assert.strictEqual(registry.updateRemoteTransform("9:ghost", [1, 1, 1]), undefined);
  assert.strictEqual(registry.listRemoteMembers().length, 0);
});

// --- remove ----------------------------------------------------------------

test("removing a citizen drops it from enumeration", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a"));
  const removed = registry.removeRemoteMember("2:a");
  assert.strictEqual(removed!.key, "2:a");
  assert.deepStrictEqual(registry.listRemoteMembers(), []);
});

test("removing a citizen also releases its ray binding, in the same call", () => {
  const { registry } = fresh();
  const node = { id: "node-a" };
  registry.upsertRemoteMember(presence(2, "a"));
  registry.bindRemoteNode("2:a", node);
  registry.removeRemoteMember("2:a");
  assert.strictEqual(registry.remoteKeyForNode(node), undefined);
  assert.strictEqual(registry.remoteMemberForNode(node), undefined);
});

test("a store-driven removal (AV:del) also releases the ray binding", () => {
  const { store, registry } = fresh();
  const node = { id: "node-b" };
  store.upsert(presence(2, "a"));
  registry.bindRemoteNode("2:a", node);
  store.remove("2:a"); // as an AV:del would
  assert.strictEqual(registry.remoteKeyForNode(node), undefined);
});

test("a reconcile that drops a citizen releases its ray binding too", () => {
  const { store, registry } = fresh();
  const node = { id: "node-c" };
  store.reconcile([presence(2, "a"), presence(3, "b")]);
  registry.bindRemoteNode("2:a", node);
  store.reconcile([presence(3, "b")]); // 2:a is gone from the room
  assert.strictEqual(registry.remoteKeyForNode(node), undefined);
  assert.deepStrictEqual(registry.listRemoteMembers().map(m => m.key), ["3:b"]);
});

test("removing an unknown citizen is a no-op", () => {
  const { registry } = fresh();
  assert.strictEqual(registry.removeRemoteMember("9:nope"), undefined);
});

// --- combat ray lookup ------------------------------------------------------

test("a hit node resolves to the citizen it stands for", () => {
  const { registry } = fresh();
  const nodeA = { id: "a" };
  const nodeB = { id: "b" };
  registry.upsertRemoteMember(presence(2, "a", { pos: [1, 0, 1] }));
  registry.upsertRemoteMember(presence(3, "b", { pos: [2, 0, 2] }));
  registry.bindRemoteNode("2:a", nodeA);
  registry.bindRemoteNode("3:b", nodeB);
  assert.strictEqual(registry.remoteMemberForNode(nodeA)!.key, "2:a");
  assert.strictEqual(registry.remoteMemberForNode(nodeB)!.key, "3:b");
});

test("an unbound or missing node resolves to nobody rather than to the wrong citizen", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "a"));
  registry.bindRemoteNode("2:a", { id: "a" });
  assert.strictEqual(registry.remoteMemberForNode({ id: "stranger" }), undefined);
  assert.strictEqual(registry.remoteMemberForNode(null), undefined);
  assert.strictEqual(registry.remoteMemberForNode(undefined), undefined);
});

test("rebinding a citizen to a new node stops the old node answering for them", () => {
  const { registry } = fresh();
  const oldNode = { id: "old" };
  const newNode = { id: "new" };
  registry.upsertRemoteMember(presence(2, "a"));
  registry.bindRemoteNode("2:a", oldNode);
  registry.bindRemoteNode("2:a", newNode);
  assert.strictEqual(registry.remoteKeyForNode(oldNode), undefined);
  assert.strictEqual(registry.remoteKeyForNode(newNode), "2:a");
  assert.strictEqual(registry.getRemoteNode("2:a"), newNode);
});

test("binding a node already claimed by someone else releases the earlier claim", () => {
  const { registry } = fresh();
  const node = { id: "shared" };
  registry.upsertRemoteMember(presence(2, "a"));
  registry.upsertRemoteMember(presence(3, "b"));
  registry.bindRemoteNode("2:a", node);
  registry.bindRemoteNode("3:b", node);
  assert.strictEqual(registry.remoteKeyForNode(node), "3:b");
  assert.strictEqual(registry.getRemoteNode("2:a"), undefined);
});

test("a username lookup returns EVERY presence wearing it, because usernames repeat", () => {
  const { registry } = fresh();
  registry.upsertRemoteMember(presence(2, "tab-1", { username: "twin" }));
  registry.upsertRemoteMember(presence(2, "tab-2", { username: "twin" }));
  registry.upsertRemoteMember(presence(3, "solo", { username: "other" }));
  assert.strictEqual(registry.remoteMembersForUsername("twin").length, 2);
  assert.strictEqual(registry.remoteMembersForUsername("other").length, 1);
  assert.deepStrictEqual(registry.remoteMembersForUsername("nobody"), []);
});

test("the node lookup separates two tabs a username lookup cannot", () => {
  const { registry } = fresh();
  const node1 = { id: "1" };
  const node2 = { id: "2" };
  registry.upsertRemoteMember(presence(2, "tab-1", { username: "twin", pos: [1, 0, 1] }));
  registry.upsertRemoteMember(presence(2, "tab-2", { username: "twin", pos: [9, 0, 9] }));
  registry.bindRemoteNode("2:tab-1", node1);
  registry.bindRemoteNode("2:tab-2", node2);
  assert.deepStrictEqual(registry.remoteMemberForNode(node2)!.pos, [9, 0, 9]);
  assert.strictEqual(registry.remoteMembersForUsername("twin").length, 2);
});

// --- world change -----------------------------------------------------------

test("a world change clears every node binding", () => {
  const { registry } = fresh();
  const nodeA = { id: "a" };
  registry.upsertRemoteMember(presence(2, "a"));
  registry.upsertRemoteMember(presence(3, "b"));
  registry.bindRemoteNode("2:a", nodeA);
  registry.bindRemoteNode("3:b", { id: "b" });
  const summary = registry.clearRemoteMembers();
  assert.strictEqual(summary.cleared, 2);
  assert.strictEqual(registry.remoteKeyForNode(nodeA), undefined);
  assert.strictEqual(registry.getRemoteNode("3:b"), undefined);
});

test("attaching the next room's store drops the previous room's bindings and citizens", () => {
  const store1 = new PresenceStore();
  const registry = new RemoteMemberRegistry(() => ME);
  registry.attach(store1);
  const oldNode = { id: "world-A-node" };
  store1.upsert(presence(2, "a"));
  registry.bindRemoteNode("2:a", oldNode);

  const store2 = new PresenceStore();
  store2.upsert(presence(4, "c"));
  registry.attach(store2);

  assert.strictEqual(registry.remoteKeyForNode(oldNode), undefined,
    "a node from the replaced scene must not still answer for anyone");
  assert.deepStrictEqual(registry.listRemoteMembers().map(m => m.key), ["4:c"]);
});

test("after attaching a new store, the old store no longer drives the registry", () => {
  const store1 = new PresenceStore();
  const store2 = new PresenceStore();
  const registry = new RemoteMemberRegistry(() => ME);
  registry.attach(store1);
  registry.attach(store2);
  const seen: string[] = [];
  registry.onRemoteChange(c => seen.push(c.type));
  store1.upsert(presence(2, "stale")); // an in-flight event from the old room
  assert.deepStrictEqual(seen, []);
  assert.deepStrictEqual(registry.listRemoteMembers(), []);
});

test("detach leaves the registry inert rather than throwing", () => {
  const { store, registry } = fresh();
  store.upsert(presence(2, "a"));
  registry.detach();
  assert.deepStrictEqual(registry.listRemoteMembers(), []);
  store.upsert(presence(3, "b")); // must not reach a detached registry
  assert.deepStrictEqual(registry.listRemoteMembers(), []);
});

// --- change notification ----------------------------------------------------

test("subscribers see add, update and remove for remote citizens only", () => {
  const { store, registry } = fresh();
  const seen: string[] = [];
  registry.onRemoteChange(c => seen.push(`${c.type}:${c.type === "remove" ? c.key : c.member.key}`));
  store.upsert(presence(2, "a"));
  store.updateTransform("2:a", [1, 2, 3]);
  store.upsert(presence(1, "my-tab")); // the local user - never reported
  store.updateTransform("1:my-tab", [9, 9, 9]);
  store.remove("2:a");
  assert.deepStrictEqual(seen, ["add:2:a", "update:2:a", "remove:2:a"]);
});

test("an unsubscribed listener stops receiving changes", () => {
  const { store, registry } = fresh();
  const seen: string[] = [];
  const off = registry.onRemoteChange(c => seen.push(c.type));
  store.upsert(presence(2, "a"));
  off();
  store.upsert(presence(3, "b"));
  assert.deepStrictEqual(seen, ["add"]);
});

test("a not-yet-known local identity does not misclassify everyone as self", () => {
  const store = new PresenceStore();
  const registry = new RemoteMemberRegistry(() => ({ memberId: null as any, presenceId: "" }));
  registry.attach(store);
  store.reconcile([presence(2, "a"), presence(3, "b")]);
  assert.strictEqual(registry.listRemoteMembers().length, 2);
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
