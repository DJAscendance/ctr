/**
 * Dependency-free tests for the presence store. No test framework is added
 * as a devDependency - this project's webpack/babel toolchain is old enough
 * that installing jest/babel-jest destabilizes it (verified: doing so broke
 * `npm run build` with an unrelated "Unknown helper regeneratorRuntime"
 * error caused by npm's flat node_modules hoisting, not by any source
 * change). Compile and run with `npm test` (see package.json / tests/tsconfig.json).
 */
import assert from "assert";
import { PresenceStore, presenceKey, Presence } from "../src/presence";

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

function makePresence(overrides: Partial<Presence> = {}): Presence {
  return {
    memberId: 1,
    presenceId: "tab-a",
    socketId: "socket-1",
    username: "alice",
    avatar: { id: "a1" },
    pos: [0, 0, 0],
    rot: [0, 1, 0, 0],
    ...overrides,
  };
}

test("presenceKey combines memberId and presenceId into a stable composite key", () => {
  assert.strictEqual(presenceKey(1, "tab-a"), "1:tab-a");
});

test("presenceKey keeps two tabs on the same member distinct", () => {
  assert.notStrictEqual(presenceKey(1, "tab-a"), presenceKey(1, "tab-b"));
});

test("upsert adds a new presence and emits an add event", () => {
  const store = new PresenceStore();
  const events: string[] = [];
  store.subscribe(e => events.push(e.type));

  const result = store.upsert(makePresence());

  assert.strictEqual(result.username, "alice");
  assert.strictEqual(store.all().length, 1);
  assert.deepStrictEqual(events, ["add"]);
});

test("upsert on an existing key merges fields and emits update, not add", () => {
  const store = new PresenceStore();
  store.upsert(makePresence({ socketId: "socket-1" }));

  const events: string[] = [];
  store.subscribe(e => events.push(e.type));
  store.upsert(makePresence({ socketId: "socket-2" }));

  assert.strictEqual(store.all().length, 1);
  assert.strictEqual(store.get(presenceKey(1, "tab-a"))?.socketId, "socket-2");
  assert.deepStrictEqual(events, ["update"]);
});

test("repeated movement updates collapse to only the latest transform", () => {
  const store = new PresenceStore();
  const key = presenceKey(1, "tab-a");
  store.upsert(makePresence());

  store.updateTransform(key, [1, 0, 0]);
  store.updateTransform(key, [2, 0, 0]);
  store.updateTransform(key, [3, 0, 0]);

  assert.strictEqual(store.all().length, 1);
  assert.deepStrictEqual(store.get(key)?.pos, [3, 0, 0]);
});

test("a presence removed before ever being drained never appears in all()", () => {
  const store = new PresenceStore();
  const key = presenceKey(1, "tab-a");
  store.upsert(makePresence());
  store.remove(key);

  // Simulates a consumer (e.g. X_ITE) becoming ready only after the
  // presence already left - it must never see it.
  assert.strictEqual(store.all().length, 0);
});

test("remove emits a remove event carrying the removed presence", () => {
  const store = new PresenceStore();
  const key = presenceKey(1, "tab-a");
  store.upsert(makePresence());

  const events: any[] = [];
  store.subscribe(e => events.push(e));
  const removed = store.remove(key);

  assert.strictEqual(removed?.username, "alice");
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(events[0], { type: "remove", key, presence: removed });
});

test("clear removes everything without per-entry events", () => {
  const store = new PresenceStore();
  store.upsert(makePresence());
  store.upsert(makePresence({ presenceId: "tab-b", memberId: 2 }));

  const events: string[] = [];
  store.subscribe(e => events.push(e.type));
  store.clear();

  assert.strictEqual(store.all().length, 0);
  assert.strictEqual(events.length, 0);
});

test("reconcile adds presences that are new in the snapshot", () => {
  const store = new PresenceStore();
  const result = store.reconcile([makePresence()]);

  assert.strictEqual(result.added.length, 1);
  assert.strictEqual(result.updated.length, 0);
  assert.strictEqual(result.removed.length, 0);
  assert.strictEqual(store.all().length, 1);
});

test("reconcile updates presences already known, without duplicating them", () => {
  const store = new PresenceStore();
  store.upsert(makePresence({ socketId: "socket-1" }));

  const result = store.reconcile([makePresence({ socketId: "socket-2" })]);

  assert.strictEqual(result.added.length, 0);
  assert.strictEqual(result.updated.length, 1);
  assert.strictEqual(store.all().length, 1);
  assert.strictEqual(store.get(presenceKey(1, "tab-a"))?.socketId, "socket-2");
});

test("reconcile removes presences absent from an authoritative snapshot", () => {
  const store = new PresenceStore();
  store.upsert(makePresence({ presenceId: "tab-a" }));
  store.upsert(makePresence({ memberId: 2, presenceId: "tab-b", username: "bob" }));

  // Authoritative snapshot only contains alice - bob is a ghost (e.g. left
  // during a hard restart without a clean disconnect) and must go.
  const result = store.reconcile([makePresence({ presenceId: "tab-a" })]);

  assert.strictEqual(result.removed.length, 1);
  assert.strictEqual(result.removed[0].username, "bob");
  assert.strictEqual(store.all().length, 1);
  assert.strictEqual(store.all()[0].username, "alice");
});

test("reconcile keeps two tabs of the same member as separate presences", () => {
  const store = new PresenceStore();
  const snapshot = [
    makePresence({ presenceId: "tab-a", socketId: "socket-1" }),
    makePresence({ presenceId: "tab-b", socketId: "socket-2" }),
  ];

  store.reconcile(snapshot);

  assert.strictEqual(store.all().length, 2);
  assert.strictEqual(store.has(presenceKey(1, "tab-a")), true);
  assert.strictEqual(store.has(presenceKey(1, "tab-b")), true);
});

test("reconciling twice with the same snapshot produces no duplicates", () => {
  const store = new PresenceStore();
  const snapshot = [makePresence()];

  store.reconcile(snapshot);
  store.reconcile(snapshot);

  assert.strictEqual(store.all().length, 1);
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : err);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) {
  process.exit(1);
}
