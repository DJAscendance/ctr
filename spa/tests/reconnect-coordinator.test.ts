/**
 * Dependency-free tests for the ReconnectCoordinator - the owner of the
 * room-join lifecycle. Same hand-rolled harness as presence.test.ts (no test
 * framework: this toolchain destabilizes if jest is added). The coordinator is
 * driven through a fake EmitterLike socket plus an injectable `isConnected`
 * probe and deterministic joinId generator, so these exercise the REAL state
 * machine (not a test-only imitation) - which is why the machine was extracted
 * into its own `@/`-free module the Node harness can import directly.
 */
import assert from "assert";
import { EventEmitter } from "events";
import { ReconnectCoordinator, LifecycleEvent } from "../src/reconnect-coordinator";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name, run });
}

/** Flush pending microtasks (the coordinator settles attempts on a microtask). */
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** Tracks a promise's settlement without leaving an unhandled rejection. */
function track(p: Promise<void>) {
  const state: { done: boolean; error: Error | null } = { done: false, error: null };
  p.then(
    () => { state.done = true; },
    (err: Error) => { state.done = true; state.error = err; },
  );
  return state;
}

function setup(opts: { connected?: boolean; timeout?: number } = {}) {
  const emitter = new EventEmitter();
  const emitted: { event: string; args: any[] }[] = [];
  let connected = opts.connected ?? true;
  let joinCounter = 0;

  const socket = {
    on: (event: string, cb: (...args: any[]) => void) => emitter.on(event, cb),
    off: (event: string, cb: (...args: any[]) => void) => emitter.off(event, cb),
    emit: (event: string, ...args: any[]) => {
      emitted.push({ event, args });
      // JOIN is client->server only; responses are injected via the emitter.
    },
  };

  const events: LifecycleEvent[] = [];
  const coord = new ReconnectCoordinator({
    socket,
    presenceId: "pres-1",
    isConnected: () => connected,
    generateJoinId: () => `jid-${++joinCounter}`,
    joinTimeoutMs: opts.timeout ?? 10000,
  });
  coord.onLifecycle(e => events.push(e));

  const joins = () => emitted.filter(e => e.event === "JOIN").map(e => e.args[0]);
  const lastJoin = () => joins().slice(-1)[0];
  const setConnected = (v: boolean) => { connected = v; };
  const roomState = (room: string | number, joinId: string, presences: any[] = []) =>
    emitter.emit("ROOM_STATE", { room, joinId, presences });
  const joinError = (room: string | number, joinId: string, reason: string) =>
    emitter.emit("JOIN:error", { room, joinId, reason });

  return { coord, emitter, emitted, events, joins, lastJoin, setConnected, roomState, joinError };
}

test("initial join emits a correlated JOIN, resolves the caller, and reports ready", async () => {
  const s = setup();
  const p = track(s.coord.requestRoom("room-A", "token"));
  assert.deepStrictEqual(s.lastJoin(), {
    room: "room-A", token: "token", presenceId: "pres-1", joinId: "jid-1",
  });
  assert.strictEqual(s.coord.roomReady, false); // not ready until confirmed

  s.roomState("room-A", "jid-1");
  await tick();

  assert.strictEqual(p.done && !p.error, true);
  assert.strictEqual(s.coord.roomReady, true);
  assert.strictEqual(s.coord.phase, "ready");
  assert.deepStrictEqual(s.events, ["ready"]); // "ready", NOT "resynced", on first join
});

test("requestRoom while disconnected defers the wire JOIN until connect (no offline buffering)", async () => {
  const s = setup({ connected: false });
  const p = track(s.coord.requestRoom("room-A", "token"));

  assert.strictEqual(s.joins().length, 0); // A3: nothing emitted while disconnected

  s.setConnected(true);
  s.coord.handleConnect();
  assert.strictEqual(s.joins().length, 1);
  assert.strictEqual(s.lastJoin().room, "room-A");

  s.roomState("room-A", s.lastJoin().joinId);
  await tick();
  assert.strictEqual(p.done && !p.error, true);
  assert.strictEqual(s.coord.roomReady, true);
});

test("an interrupted initial JOIN recovers on reconnect and resolves the ORIGINAL caller", async () => {
  const s = setup();
  const p = track(s.coord.requestRoom("room-A", "token"));
  const firstJoinId = s.lastJoin().joinId;

  // Transport drops before ROOM_STATE arrives.
  s.coord.handleDisconnect();
  await tick();
  assert.strictEqual(p.done, false); // logical intent stays pending
  assert.strictEqual(s.coord.phase, "disconnected");
  assert.deepStrictEqual(s.events, ["disconnected"]);

  // Reconnect -> a fresh attempt for the SAME room, same presenceId, new joinId.
  s.coord.handleConnect();
  const secondJoin = s.lastJoin();
  assert.strictEqual(secondJoin.room, "room-A");
  assert.strictEqual(secondJoin.presenceId, "pres-1");
  assert.notStrictEqual(secondJoin.joinId, firstJoinId);
  assert.strictEqual(s.coord.roomReady, false); // connected but not yet resynced (A7)

  s.roomState("room-A", secondJoin.joinId);
  await tick();
  assert.strictEqual(p.done && !p.error, true); // original caller finally resolves
  assert.strictEqual(s.coord.roomReady, true);
  assert.deepStrictEqual(s.events, ["disconnected", "resynced"]); // recovery, not a 2nd "ready"
});

test("a newer room intent supersedes the older pending one", async () => {
  const s = setup();
  const pA = track(s.coord.requestRoom("room-A", "token"));
  const pB = track(s.coord.requestRoom("room-B", "token"));
  await tick();

  assert.strictEqual(!!pA.error, true);
  assert.ok(/superseded/.test(pA.error!.message));
  assert.strictEqual(s.lastJoin().room, "room-B");
  assert.strictEqual(s.coord.pendingJoinId, s.lastJoin().joinId);

  s.roomState("room-B", s.lastJoin().joinId);
  await tick();
  assert.strictEqual(pB.done && !pB.error, true);
});

test("A interrupted then B selected while offline: only B is joined on reconnect, A is superseded", async () => {
  const s = setup();
  const pA = track(s.coord.requestRoom("room-A", "token"));
  assert.strictEqual(s.joins().length, 1); // A's initial attempt

  // Transport drops, then the user navigates to B while still offline.
  s.setConnected(false);
  s.coord.handleDisconnect();
  const pB = track(s.coord.requestRoom("room-B", "token"));
  await tick();

  assert.strictEqual(!!pA.error, true); // A rejected as superseded
  assert.ok(/superseded/.test(pA.error!.message));
  assert.strictEqual(s.joins().length, 1); // still nothing new emitted while offline

  // Reconnect: exactly one new attempt, and it is for B (never a stale A rejoin).
  s.setConnected(true);
  s.coord.handleConnect();
  assert.strictEqual(s.joins().length, 2);
  assert.strictEqual(s.lastJoin().room, "room-B");
  assert.strictEqual(s.joins().filter(j => j.room === "room-A").length, 1); // only the pre-drop A

  s.roomState("room-B", s.lastJoin().joinId);
  await tick();
  assert.strictEqual(pB.done && !pB.error, true);
});

test("clearing room intent while offline prevents any later automatic rejoin", async () => {
  const s = setup();
  const pA = track(s.coord.requestRoom("room-A", "token"));
  s.setConnected(false);
  s.coord.handleDisconnect();

  s.coord.clearRoomIntent();
  await tick();
  assert.strictEqual(!!pA.error, true);
  assert.ok(/cleared/.test(pA.error!.message));

  const joinsBefore = s.joins().length;
  s.setConnected(true);
  s.coord.handleConnect(); // must NOT rejoin the abandoned room
  assert.strictEqual(s.joins().length, joinsBefore);
  assert.strictEqual(s.coord.phase, "idle");
  assert.strictEqual(s.coord.currentRoom, null);
});

test("clearRoomIntent scoped to a room does not clear a newer intent for a different room", () => {
  const s = setup();
  track(s.coord.requestRoom("room-A", "token")); // rejected (superseded) - tracked
  track(s.coord.requestRoom("room-B", "token")); // intent moved to B
  s.coord.clearRoomIntent("room-A"); // stale teardown for A - must be a no-op now
  assert.strictEqual(s.coord.currentRoom, "room-B"); // B intent preserved
  s.coord.clearRoomIntent("room-B");
  assert.strictEqual(s.coord.currentRoom, null);
});

test("invalid auth fails the join and does NOT trigger an auto-retry loop on reconnect", async () => {
  const s = setup();
  const p = track(s.coord.requestRoom("room-A", "token"));
  const joinId = s.lastJoin().joinId;

  s.joinError("room-A", joinId, "invalid_token");
  await tick();
  assert.strictEqual(!!p.error, true);
  assert.ok(/invalid_token/.test(p.error!.message));
  assert.strictEqual(s.coord.phase, "failed");
  assert.deepStrictEqual(s.events, ["failed"]);

  // A subsequent reconnect must not silently re-attempt the doomed request.
  s.coord.handleConnect();
  assert.strictEqual(s.joins().length, 1); // still just the one attempt
  assert.strictEqual(s.events.includes("resynced"), false);
});

test("a stale ROOM_STATE from a superseded attempt cannot flip readiness", async () => {
  const s = setup();
  const pA = track(s.coord.requestRoom("room-A", "token"));
  const staleJoinId = s.lastJoin().joinId;
  const pB = track(s.coord.requestRoom("room-B", "token"));
  const freshJoinId = s.lastJoin().joinId;
  await tick();
  assert.ok(pA.error); // A superseded

  // A late ROOM_STATE for the OLD attempt must not resolve B.
  s.roomState("room-A", staleJoinId);
  await tick();
  assert.strictEqual(s.coord.roomReady, false);
  assert.strictEqual(pB.done, false);

  s.roomState("room-B", freshJoinId);
  await tick();
  assert.strictEqual(pB.done && !pB.error, true);
  assert.strictEqual(s.coord.roomReady, true);
});

test("roomReady stays false while connected but still resyncing (transport alone is not enough)", async () => {
  const s = setup();
  const p = track(s.coord.requestRoom("room-A", "token"));
  s.roomState("room-A", s.lastJoin().joinId);
  await tick();
  assert.strictEqual(s.coord.roomReady, true);

  s.coord.handleDisconnect();
  assert.strictEqual(s.coord.roomReady, false);
  s.coord.handleConnect(); // transport back, but not yet confirmed
  assert.strictEqual(s.coord.roomReady, false);
  assert.strictEqual(s.coord.phase, "joining");

  s.roomState("room-A", s.lastJoin().joinId);
  await tick();
  assert.strictEqual(s.coord.roomReady, true);
  void p;
});

test("a full outage/recovery cycle emits exactly one disconnected and one resynced", async () => {
  const s = setup();
  const p = track(s.coord.requestRoom("room-A", "token"));
  s.roomState("room-A", s.lastJoin().joinId);
  await tick();

  s.coord.handleDisconnect();
  s.coord.handleConnect();
  s.roomState("room-A", s.lastJoin().joinId);
  await tick();

  assert.deepStrictEqual(s.events, ["ready", "disconnected", "resynced"]);
  void p;
});

test("lifecycle unsubscribe stops delivery and subscriptions do not accumulate", async () => {
  const s = setup();
  let a = 0;
  let b = 0;
  const unsubA = s.coord.onLifecycle(() => { a += 1; });
  s.coord.onLifecycle(() => { b += 1; });

  const p = track(s.coord.requestRoom("room-A", "token"));
  s.roomState("room-A", s.lastJoin().joinId);
  await tick();
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1);

  unsubA();
  s.coord.handleDisconnect();
  assert.strictEqual(a, 1); // no further delivery after unsubscribe
  assert.strictEqual(b, 2);
  void p;
});

async function run(): Promise<void> {
  let failures = 0;
  for (const { name, run: runTest } of tests) {
    try {
      await runTest();
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
}

run();
