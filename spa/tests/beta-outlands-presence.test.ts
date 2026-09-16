/**
 * BETA-NATIVE OUTLANDS PRESENCE GATE.
 *
 * This suite proves, over the real wire against the real `server.js`, the exact
 * set of multiplayer guarantees the accepted Outlands free-play code depends on
 * - stated in BETA's own protocol (JOIN {room, token, presenceId, joinId} /
 * ROOM_STATE / AV / AV:new / AV:del / unsubscribe), NOT in the older
 * accepted-line protocol (JOIN {token, room} + socket.id identity + AV:new as
 * the only snapshot mechanism).
 *
 * The invariants come from the accepted line's O5 and direct-JOIN gates, but
 * they are re-expressed here as Beta-native statements:
 *
 *   accepted: "socket.id identifies a citizen"
 *   beta:     "presenceKey(memberId, presenceId) identifies a citizen"
 *
 *   accepted: "AV:new replay enumerates the room"
 *   beta:     "ROOM_STATE.presences enumerates the room"
 *
 * The Outlands operations each invariant underwrites:
 *   enumerate remote citizens        -> ROOM_STATE.presences
 *   add / remove one remote citizen  -> AV:new / AV:del (room-tagged)
 *   update position / rotation       -> AV (room-tagged, presence-tagged)
 *   one presence per representation  -> presence key uniqueness in a snapshot
 *   clear on world change            -> old-room presence must not survive
 *   ray target has a real position   -> absent position must stay ABSENT
 *
 * Kept in the same dependency-free style as server-presence.test.ts: the real
 * server is spawned as a subprocess on an OS-assigned free port (never the dev
 * stack's), and every assertion is made through protocol-visible payloads only.
 */
import assert from "assert";

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");

const SPA_DIR = path.resolve(__dirname, "../../..");
const SERVER = path.join(SPA_DIR, "server.js");
const SECRET = "beta-outlands-gate-secret";

type Test = { name: string; run: () => Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void>): void {
  tests.push({ name, run });
}

let PORT = 0;
let serverProc: any = null;
let serverLog = "";

// ---------------------------------------------------------------------------
// Beta identity helpers - the client-side contract, restated here so the gate
// asserts against the key it actually intends to standardise on.
// ---------------------------------------------------------------------------

/** The Beta logical presence key. Never socket.id. */
function presenceKey(memberId: number | string, presenceId: string): string {
  return `${memberId}:${presenceId}`;
}

type Snapshot = Array<{
  memberId: number;
  presenceId: string;
  socketId?: string;
  username?: string;
  avatar?: any;
  pos?: number[];
  rot?: number[];
}>;

/** Every logical key present in a ROOM_STATE snapshot. */
function keysOf(snapshot: Snapshot): string[] {
  return snapshot.map(p => presenceKey(p.memberId, p.presenceId));
}

/** How many records a snapshot holds for one logical key. */
function countOf(snapshot: Snapshot, key: string): number {
  return keysOf(snapshot).filter(k => k === key).length;
}

function entryOf(snapshot: Snapshot, key: string): any {
  return snapshot.find(p => presenceKey(p.memberId, p.presenceId) === key);
}

// ---------------------------------------------------------------------------
// Detectors. Each names one failure the gate must be able to see. They are
// exercised against synthetic snapshots in the NEGATIVE CONTROLS section, so a
// detector can never be silently vacuous.
// ---------------------------------------------------------------------------

/** Fails if `key` is still enumerated in a room it should have left. */
function assertNoGhost(snapshot: Snapshot, key: string, room: string): void {
  if (keysOf(snapshot).includes(key)) {
    throw new Error(`ghost presence: ${key} is still enumerated in room ${room}`);
  }
}

/** Fails if `key` is missing from a room it should be in. */
function assertPresent(snapshot: Snapshot, key: string, room: string): void {
  if (!keysOf(snapshot).includes(key)) {
    throw new Error(`missing presence: ${key} is not enumerated in room ${room}`);
  }
}

/** Fails if a logical key appears more than once in one snapshot. */
function assertNoDuplicate(snapshot: Snapshot, key: string): void {
  const n = countOf(snapshot, key);
  if (n > 1) throw new Error(`duplicate presence: ${key} appears ${n} times in one snapshot`);
}

/**
 * Fails if a presence carries a position at all. "No valid position yet" is the
 * accepted O5 principle: it must be ABSENT, never the fabricated origin. An
 * Outlands ray fired at a citizen standing at a fabricated [0,0,0] hits empty
 * world space, and a collision wrapper parked there blocks a real doorway.
 */
function assertNoPositionYet(snapshot: Snapshot, key: string): void {
  const entry = entryOf(snapshot, key);
  if (!entry) throw new Error(`cannot check position: ${key} not in snapshot`);
  if (entry.pos !== undefined) {
    throw new Error(
      `false position: ${key} has no real position yet but the snapshot reports ` +
      `pos=${JSON.stringify(entry.pos)} (absent is the only correct answer)`,
    );
  }
  if (entry.rot !== undefined) {
    throw new Error(
      `false rotation: ${key} has no real rotation yet but the snapshot reports ` +
      `rot=${JSON.stringify(entry.rot)}`,
    );
  }
}

/** Fails if a presence carries a transform that belongs to a world it has left. */
function assertNotStalePosition(snapshot: Snapshot, key: string, stale: number[]): void {
  const entry = entryOf(snapshot, key);
  if (!entry) throw new Error(`cannot check position: ${key} not in snapshot`);
  if (entry.pos !== undefined && JSON.stringify(entry.pos) === JSON.stringify(stale)) {
    throw new Error(`stale world position: ${key} carried ${JSON.stringify(stale)} into a new room`);
  }
}

// ---------------------------------------------------------------------------
// Transport plumbing (same shape as server-presence.test.ts).
// ---------------------------------------------------------------------------

function signToken(id: number, username: string): string {
  // Minted the way the API mints one now: pinned algorithm, expiry always present.
  // A token with no `exp` is a pre-release token and server.js refuses it.
  return jwt.sign(
    { id, username, avatar: { id: `av-${id}`, directory: "d", filename: "f.wrl" } },
    SECRET,
    { algorithm: "HS256", expiresIn: 3600 },
  );
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function startServer(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: SPA_DIR,
      env: { ...process.env, WEBSOCKET_PORT: String(port), JWT_SECRET: SECRET },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const onOut = (d: Buffer) => {
      serverLog += d.toString();
      if (!settled && serverLog.includes(`listening on port:${port}`)) {
        settled = true;
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", onOut);
    child.stderr.on("data", (d: Buffer) => { serverLog += d.toString(); });
    child.on("exit", (code: number) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`server exited before ready (code ${code})`)); }
    });
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("timed out waiting for server ready")); }
    }, 10000);
  });
}

function killServer(child: any): Promise<void> {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.on("exit", finish);
    child.kill("SIGKILL");
    setTimeout(finish, 2000);
  });
}

const sockets: any[] = [];

function connect(): Promise<any> {
  const sock = io(`http://127.0.0.1:${PORT}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("client connect timeout")), 5000);
    sock.on("connect", () => { clearTimeout(t); resolve(sock); });
    sock.on("connect_error", (e: Error) => { clearTimeout(t); reject(e); });
  });
}

async function newClient(): Promise<any> {
  const sock = await connect();
  sockets.push(sock);
  return sock;
}

function waitFor(sock: any, event: string, predicate?: (p: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (payload: any) => {
      if (predicate && !predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs);
    function cleanup() { clearTimeout(timer); sock.off(event, handler); }
    sock.on(event, handler);
  });
}

function expectNone(sock: any, event: string, predicate?: (p: any) => boolean, windowMs = 700): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (payload: any) => {
      if (predicate && !predicate(payload)) return;
      cleanup();
      reject(new Error(`unexpected ${event}: ${JSON.stringify(payload)}`));
    };
    const timer = setTimeout(() => { cleanup(); resolve(); }, windowMs);
    function cleanup() { clearTimeout(timer); sock.off(event, handler); }
    sock.on(event, handler);
  });
}

let joinSeq = 0;
function nextJoinId(): string { joinSeq += 1; return `gate-jid-${joinSeq}`; }

/** A Beta-native JOIN. Resolves with the ROOM_STATE correlated to this attempt. */
async function join(sock: any, room: string, token: string, presenceId: string, joinId = nextJoinId()): Promise<any> {
  const rs = waitFor(sock, "ROOM_STATE", (p) => p.joinId === joinId);
  sock.emit("JOIN", { room, token, presenceId, joinId });
  return rs;
}

/** Beta-native teardown, exactly as SocketManager.leaveRoom emits it. */
function leave(sock: any, room: string): void {
  sock.emit("unsubscribe", { room });
}

/**
 * Enumerates a room from the outside using nothing but the Beta protocol: a
 * throwaway observer JOINs and reads its own authoritative ROOM_STATE. This is
 * the Beta-native equivalent of the accepted line's AV:new replay count.
 */
let observerSeq = 0;
async function enumerateRoom(room: string): Promise<Snapshot> {
  observerSeq += 1;
  const id = 900000 + observerSeq;
  const sock = await newClient();
  const rs = await join(sock, room, signToken(id, `obs${observerSeq}`), `obs-pres-${observerSeq}`);
  const selfKey = presenceKey(id, `obs-pres-${observerSeq}`);
  // Drop the observer itself, then leave so it is not counted by a later
  // enumeration of the same room.
  const others = (rs.presences as Snapshot).filter(
    p => presenceKey(p.memberId, p.presenceId) !== selfKey,
  );
  leave(sock, room);
  await new Promise(r => setTimeout(r, 120));
  return others;
}

const settle = (ms = 200) => new Promise(r => setTimeout(r, ms));

// ===========================================================================
// 1. FIRST JOIN / ROOM_STATE CONTRACT
// ===========================================================================

test("ROOM_STATE is the authoritative room enumeration and echoes room + joinId", async () => {
  const sock = await newClient();
  const rs = await join(sock, "g-first", signToken(1, "alice"), "p-alice", "jid-first");
  assert.strictEqual(rs.room, "g-first");
  assert.strictEqual(rs.joinId, "jid-first");
  assert.ok(Array.isArray(rs.presences), "ROOM_STATE.presences is an array");
  // The joiner sees ITSELF in the snapshot - the client filters self by
  // logical key, so the wire must carry it.
  assertPresent(rs.presences, presenceKey(1, "p-alice"), "g-first");
});

test("every ROOM_STATE record carries the fields the Outlands remote-member contract needs", async () => {
  const peer = await newClient();
  await join(peer, "g-fields", signToken(2, "bob"), "p-bob");
  const snap = await enumerateRoom("g-fields");
  const entry = entryOf(snap, presenceKey(2, "p-bob"));
  assert.ok(entry, "peer enumerated");
  // identity
  assert.strictEqual(typeof entry.memberId, "number");
  assert.strictEqual(typeof entry.presenceId, "string");
  // transport metadata is present but is NOT the identity
  assert.strictEqual(typeof entry.socketId, "string");
  // rendering + roster + the blaxxun nickname a combat ray compares against
  assert.strictEqual(entry.username, "bob");
  assert.ok(entry.avatar && entry.avatar.filename, "avatar carries a file to load");
});

// ===========================================================================
// 2. NO FALSE POSITION (accepted O5 principle, Beta-native)
// ===========================================================================

test("a presence with no valid position yet is enumerated with NO position, not [0,0,0]", async () => {
  const sock = await newClient();
  await join(sock, "g-nopos", signToken(3, "carol"), "p-carol");
  const snap = await enumerateRoom("g-nopos");
  assertNoPositionYet(snap, presenceKey(3, "p-carol"));
});

test("AV:new for a never-moved presence carries no fabricated transform", async () => {
  const peer = await newClient();
  await join(peer, "g-nopos-new", signToken(4, "dave"), "p-dave");
  const sawNew = waitFor(peer, "AV:new", (p) => p.presenceId === "p-eve");
  const joiner = await newClient();
  await join(joiner, "g-nopos-new", signToken(5, "eve"), "p-eve");
  const avNew = await sawNew;
  assert.strictEqual(avNew.pos, undefined, "AV:new must not invent a position");
  assert.strictEqual(avNew.rot, undefined, "AV:new must not invent a rotation");
});

test("once a real position is sent it IS enumerated - the absence rule is not just 'never report'", async () => {
  const sock = await newClient();
  const room = "g-realpos";
  await join(sock, room, signToken(6, "frank"), "p-frank");
  sock.emit("AV", { room, pos: [11, 2, 33], rot: [0, 1, 0, 1.25] });
  await settle();
  const snap = await enumerateRoom(room);
  const entry = entryOf(snap, presenceKey(6, "p-frank"));
  assert.deepStrictEqual(entry.pos, [11, 2, 33]);
  assert.deepStrictEqual(entry.rot, [0, 1, 0, 1.25]);
});

test("[0,0,0] sent as a REAL authored position is kept - the rule bans fabrication, not the origin", async () => {
  const sock = await newClient();
  const room = "g-realorigin";
  await join(sock, room, signToken(7, "grace"), "p-grace");
  sock.emit("AV", { room, pos: [0, 0, 0], rot: [0, 1, 0, 0] });
  await settle();
  const snap = await enumerateRoom(room);
  const entry = entryOf(snap, presenceKey(7, "p-grace"));
  assert.deepStrictEqual(entry.pos, [0, 0, 0], "an authored origin survives");
});

// ===========================================================================
// 3. POSITION / ROTATION UPDATE CONTRACT
// ===========================================================================

test("a position update is relayed room-tagged and presence-tagged, never socket-keyed only", async () => {
  const room = "g-move";
  const peer = await newClient();
  await join(peer, room, signToken(8, "heidi"), "p-heidi");
  const mover = await newClient();
  await join(mover, room, signToken(9, "ivan"), "p-ivan");

  const gotAv = waitFor(peer, "AV", (p) => p.presenceId === "p-ivan");
  mover.emit("AV", { room, pos: [4, 5, 6] });
  const av = await gotAv;
  assert.strictEqual(av.room, room, "AV is room-tagged so a stale room can be rejected client-side");
  assert.strictEqual(av.memberId, 9);
  assert.strictEqual(av.presenceId, "p-ivan");
  assert.deepStrictEqual(av.pos, [4, 5, 6]);
});

test("a rotation-only update does not clear a previously known position", async () => {
  const room = "g-rot";
  const sock = await newClient();
  await join(sock, room, signToken(10, "judy"), "p-judy");
  sock.emit("AV", { room, pos: [1, 2, 3] });
  await settle();
  sock.emit("AV", { room, rot: [0, 1, 0, 3] });
  await settle();
  const snap = await enumerateRoom(room);
  const entry = entryOf(snap, presenceKey(10, "p-judy"));
  assert.deepStrictEqual(entry.pos, [1, 2, 3], "position survives a rotation-only update");
  assert.deepStrictEqual(entry.rot, [0, 1, 0, 3]);
});

// ===========================================================================
// 4. JOIN / LEAVE CONTRACT - one presence, one logical room
// ===========================================================================

test("a second-room JOIN removes the presence from the old room and adds it to the new", async () => {
  const roomA = "g-jl-A";
  const roomB = "g-jl-B";
  const key = presenceKey(11, "p-mover");

  const peerA = await newClient();
  await join(peerA, roomA, signToken(12, "pa"), "p-pa");
  const peerB = await newClient();
  await join(peerB, roomB, signToken(13, "pb"), "p-pb");

  const mover = await newClient();
  await join(mover, roomA, signToken(11, "mover"), "p-mover");
  assertPresent(await enumerateRoom(roomA), key, roomA);

  const leftA = waitFor(peerA, "AV:del", (p) => p.presenceId === "p-mover");
  const enteredB = waitFor(peerB, "AV:new", (p) => p.presenceId === "p-mover");
  await join(mover, roomB, signToken(11, "mover"), "p-mover");
  const del = await leftA;
  const add = await enteredB;

  assert.strictEqual(del.room, roomA, "AV:del carries the OLD room");
  assert.strictEqual(del.memberId, 11);
  assert.strictEqual(del.presenceId, "p-mover");
  assert.strictEqual(add.room, roomB, "AV:new carries the NEW room");

  await settle();
  assertNoGhost(await enumerateRoom(roomA), key, roomA);
  assertPresent(await enumerateRoom(roomB), key, roomB);
});

test("a relocated presence does not carry its old world's position into the new room", async () => {
  const roomA = "g-pos-A";
  const roomB = "g-pos-B";
  const key = presenceKey(14, "p-trav");
  const mover = await newClient();
  await join(mover, roomA, signToken(14, "trav"), "p-trav");
  mover.emit("AV", { room: roomA, pos: [77, 8, 99], rot: [0, 1, 0, 2.5] });
  await settle();
  assert.deepStrictEqual(entryOf(await enumerateRoom(roomA), key).pos, [77, 8, 99]);

  await join(mover, roomB, signToken(14, "trav"), "p-trav");
  await settle();
  const snapB = await enumerateRoom(roomB);
  assertPresent(snapB, key, roomB);
  assertNotStalePosition(snapB, key, [77, 8, 99]);
  // ...and the replacement is ABSENCE, not a fabricated origin.
  assertNoPositionYet(snapB, key);
});

test("a new member enumerates only the members actually in that room", async () => {
  const roomA = "g-iso-A";
  const roomB = "g-iso-B";
  const a = await newClient();
  await join(a, roomA, signToken(15, "ann"), "p-ann");
  const b = await newClient();
  await join(b, roomB, signToken(16, "ben"), "p-ben");

  const snapA = await enumerateRoom(roomA);
  assertPresent(snapA, presenceKey(15, "p-ann"), roomA);
  assertNoGhost(snapA, presenceKey(16, "p-ben"), roomA);

  const snapB = await enumerateRoom(roomB);
  assertPresent(snapB, presenceKey(16, "p-ben"), roomB);
  assertNoGhost(snapB, presenceKey(15, "p-ann"), roomB);
});

test("an explicit unsubscribe removes the remote citizen and announces AV:del", async () => {
  const room = "g-unsub";
  const key = presenceKey(17, "p-leaver");
  const peer = await newClient();
  await join(peer, room, signToken(18, "watch"), "p-watch");
  const leaver = await newClient();
  await join(leaver, room, signToken(17, "leaver"), "p-leaver");
  assertPresent(await enumerateRoom(room), key, room);

  const gone = waitFor(peer, "AV:del", (p) => p.presenceId === "p-leaver");
  leave(leaver, room);
  const del = await gone;
  assert.strictEqual(del.room, room);
  await settle();
  assertNoGhost(await enumerateRoom(room), key, room);
});

test("a stale unsubscribe for an ALREADY-LEFT room must not evict the presence from its current room", async () => {
  // The client's teardown is room-scoped (`unsubscribe {room}`) and
  // SocketManager.leaveRoom emits it unconditionally, while its intent-side
  // guard (clearRoomIntent) is room-checked. So a late teardown for room A can
  // still reach the server after the socket has already joined room B. It must
  // be ignored, or a rapid A->B navigation silently kicks the member out of B
  // while the client still believes it is present - a one-sided ghost.
  const roomA = "g-stale-A";
  const roomB = "g-stale-B";
  const key = presenceKey(19, "p-stale");
  const mover = await newClient();
  await join(mover, roomA, signToken(19, "stale"), "p-stale");
  await join(mover, roomB, signToken(19, "stale"), "p-stale");
  await settle();

  leave(mover, roomA); // stale teardown for the room we already left
  await settle(300);

  assertPresent(await enumerateRoom(roomB), key, roomB);
  assertNoGhost(await enumerateRoom(roomA), key, roomA);
});

// ===========================================================================
// 5. MULTIPLE PRESENCES PER MEMBER
// ===========================================================================

test("two tabs of one member are two distinct remote citizens, not one collapsed record", async () => {
  const room = "g-tabs";
  const tab1 = await newClient();
  const tab2 = await newClient();
  await join(tab1, room, signToken(20, "twin"), "p-tab-1");
  await join(tab2, room, signToken(20, "twin"), "p-tab-2");
  await settle();

  const snap = await enumerateRoom(room);
  assertPresent(snap, presenceKey(20, "p-tab-1"), room);
  assertPresent(snap, presenceKey(20, "p-tab-2"), room);
  assertNoDuplicate(snap, presenceKey(20, "p-tab-1"));
  assertNoDuplicate(snap, presenceKey(20, "p-tab-2"));
  // Same member id, same username - only the presence key separates them, which
  // is exactly why a username-only lookup cannot be the Outlands ray key.
  const mine = snap.filter(p => p.memberId === 20);
  assert.strictEqual(mine.length, 2);
  assert.strictEqual(mine[0].username, mine[1].username);
});

test("two presences of one member move independently", async () => {
  const room = "g-tabs-move";
  const tab1 = await newClient();
  const tab2 = await newClient();
  await join(tab1, room, signToken(21, "duo"), "p-duo-1");
  await join(tab2, room, signToken(21, "duo"), "p-duo-2");
  tab1.emit("AV", { room, pos: [1, 0, 1] });
  tab2.emit("AV", { room, pos: [2, 0, 2] });
  await settle();
  const snap = await enumerateRoom(room);
  assert.deepStrictEqual(entryOf(snap, presenceKey(21, "p-duo-1")).pos, [1, 0, 1]);
  assert.deepStrictEqual(entryOf(snap, presenceKey(21, "p-duo-2")).pos, [2, 0, 2]);
});

test("one tab leaving does not remove the other tab's presence", async () => {
  const room = "g-tabs-leave";
  const tab1 = await newClient();
  const tab2 = await newClient();
  await join(tab1, room, signToken(22, "solo"), "p-solo-1");
  await join(tab2, room, signToken(22, "solo"), "p-solo-2");
  await settle();
  leave(tab1, room);
  await settle(300);
  const snap = await enumerateRoom(room);
  assertNoGhost(snap, presenceKey(22, "p-solo-1"), room);
  assertPresent(snap, presenceKey(22, "p-solo-2"), room);
});

// ===========================================================================
// 6. DISCONNECT / RECONNECT CONTRACT
// ===========================================================================

test("a disconnect removes the remote citizen from the room", async () => {
  const room = "g-disc";
  const key = presenceKey(23, "p-drop");
  const peer = await newClient();
  await join(peer, room, signToken(24, "peer24"), "p-peer24");
  const dropper = await newClient();
  await join(dropper, room, signToken(23, "drop"), "p-drop");
  const gone = waitFor(peer, "AV:del", (p) => p.presenceId === "p-drop");
  dropper.disconnect();
  const del = await gone;
  assert.strictEqual(del.room, room);
  await settle();
  assertNoGhost(await enumerateRoom(room), key, room);
});

test("a reconnect (new socket, same presenceId) yields exactly one presence, not a duplicate", async () => {
  const room = "g-recon";
  const key = presenceKey(25, "p-recon");
  const first = await newClient();
  await join(first, room, signToken(25, "recon"), "p-recon");
  first.emit("AV", { room, pos: [3, 4, 5], rot: [0, 1, 0, 0.75] });
  await settle();
  first.disconnect();
  await settle(300);

  const second = await newClient();
  const rs = await join(second, room, signToken(25, "recon"), "p-recon");
  assertNoDuplicate(rs.presences, key);
  assertPresent(rs.presences, key, room);
  await settle();
  const snap = await enumerateRoom(room);
  assertNoDuplicate(snap, key);
});

test("a reconnect while the old socket is still open rebinds rather than duplicating, and keeps the transform", async () => {
  const room = "g-rebind";
  const key = presenceKey(26, "p-rebind");
  const old = await newClient();
  await join(old, room, signToken(26, "rb"), "p-rebind");
  old.emit("AV", { room, pos: [6, 7, 8], rot: [0, 1, 0, 1.1] });
  await settle();

  const fresh = await newClient();
  const rs = await join(fresh, room, signToken(26, "rb"), "p-rebind");
  assertNoDuplicate(rs.presences, key);
  const entry = entryOf(rs.presences, key);
  assert.deepStrictEqual(entry.pos, [6, 7, 8], "transform survives the rebind");
  assert.deepStrictEqual(entry.rot, [0, 1, 0, 1.1]);
  assert.notStrictEqual(entry.socketId, undefined);
});

test("a stale socket's disconnect cannot delete the presence its replacement now owns", async () => {
  const room = "g-stalesock";
  const key = presenceKey(27, "p-owned");
  const peer = await newClient();
  await join(peer, room, signToken(28, "peer28"), "p-peer28");
  const old = await newClient();
  await join(old, room, signToken(27, "owned"), "p-owned");
  const fresh = await newClient();
  await join(fresh, room, signToken(27, "owned"), "p-owned");

  const noDel = expectNone(peer, "AV:del", (p) => p.presenceId === "p-owned", 800);
  old.disconnect();
  await noDel;
  assertPresent(await enumerateRoom(room), key, room);
});

// ===========================================================================
// 7. RESYNC CONTRACT (a repeated JOIN for the same room + presence)
// ===========================================================================

test("a resync re-JOIN returns one record, keeps position and room, and does not re-announce", async () => {
  const room = "g-resync";
  const key = presenceKey(29, "p-resync");
  const peer = await newClient();
  await join(peer, room, signToken(30, "peer30"), "p-peer30");
  const sock = await newClient();
  await join(sock, room, signToken(29, "resync"), "p-resync");
  sock.emit("AV", { room, pos: [9, 1, 2], rot: [0, 1, 0, 2.2] });
  await settle();

  const noSecondNew = expectNone(peer, "AV:new", (p) => p.presenceId === "p-resync", 700);
  const rs = await join(sock, room, signToken(29, "resync"), "p-resync");
  await noSecondNew;

  assert.strictEqual(rs.room, room, "room remains current");
  assertNoDuplicate(rs.presences, key);
  const entry = entryOf(rs.presences, key);
  assert.deepStrictEqual(entry.pos, [9, 1, 2], "position remains current across resync");
  assert.deepStrictEqual(entry.rot, [0, 1, 0, 2.2]);
});

test("repeated resyncs never grow the room enumeration", async () => {
  const room = "g-resync-many";
  const key = presenceKey(31, "p-many");
  const sock = await newClient();
  for (let i = 0; i < 5; i += 1) {
    await join(sock, room, signToken(31, "many"), "p-many");
  }
  await settle();
  const snap = await enumerateRoom(room);
  assertNoDuplicate(snap, key);
  assert.strictEqual(countOf(snap, key), 1);
});

// ===========================================================================
// 8. RAPID ROOM CHANGES
// ===========================================================================

test("four rapid room changes leave the presence only in the final room", async () => {
  const rooms = ["g-rapid-1", "g-rapid-2", "g-rapid-3", "g-rapid-4"];
  const key = presenceKey(32, "p-rapid");
  const sock = await newClient();
  for (const room of rooms) {
    // Deliberately NOT awaiting a settle between hops: back-to-back JOINs are
    // exactly the navigation pattern that produced the accepted line's
    // direct-JOIN ghost.
    await join(sock, room, signToken(32, "rapid"), "p-rapid");
  }
  await settle(400);

  for (const room of rooms.slice(0, 3)) {
    assertNoGhost(await enumerateRoom(room), key, room);
  }
  const final = await enumerateRoom(rooms[3]);
  assertPresent(final, key, rooms[3]);
  assertNoDuplicate(final, key);
});

test("rapid room changes with movement in between never leak a transform forward", async () => {
  const rooms = ["g-rapidm-1", "g-rapidm-2", "g-rapidm-3"];
  const key = presenceKey(33, "p-rapidm");
  const sock = await newClient();
  await join(sock, rooms[0], signToken(33, "rapidm"), "p-rapidm");
  sock.emit("AV", { room: rooms[0], pos: [50, 0, 50] });
  await settle();
  await join(sock, rooms[1], signToken(33, "rapidm"), "p-rapidm");
  sock.emit("AV", { room: rooms[1], pos: [60, 0, 60] });
  await settle();
  await join(sock, rooms[2], signToken(33, "rapidm"), "p-rapidm");
  await settle();

  const snap = await enumerateRoom(rooms[2]);
  assertPresent(snap, key, rooms[2]);
  assertNotStalePosition(snap, key, [50, 0, 50]);
  assertNotStalePosition(snap, key, [60, 0, 60]);
  assertNoPositionYet(snap, key);
  assertNoGhost(await enumerateRoom(rooms[0]), key, rooms[0]);
  assertNoGhost(await enumerateRoom(rooms[1]), key, rooms[1]);
});

test("a rapid A->B->A return is a single presence in A, not two", async () => {
  const roomA = "g-return-A";
  const roomB = "g-return-B";
  const key = presenceKey(34, "p-ret");
  const sock = await newClient();
  await join(sock, roomA, signToken(34, "ret"), "p-ret");
  await join(sock, roomB, signToken(34, "ret"), "p-ret");
  await join(sock, roomA, signToken(34, "ret"), "p-ret");
  await settle(300);
  const snapA = await enumerateRoom(roomA);
  assertPresent(snapA, key, roomA);
  assertNoDuplicate(snapA, key);
  assertNoGhost(await enumerateRoom(roomB), key, roomB);
});

// ===========================================================================
// 9. NEGATIVE CONTROLS - prove every detector can actually fail.
// ===========================================================================

function mustThrow(name: string, fn: () => void): void {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(`detector "${name}" accepted a broken snapshot - the gate would be vacuous`);
}

test("NEGATIVE CONTROL: the gate detects an old-room ghost", async () => {
  const ghosted: Snapshot = [{ memberId: 1, presenceId: "p" }];
  mustThrow("assertNoGhost", () => assertNoGhost(ghosted, "1:p", "old-room"));
  assertNoGhost([], "1:p", "old-room"); // clean case still passes
});

test("NEGATIVE CONTROL: the gate detects a missing removal", async () => {
  mustThrow("assertPresent", () => assertPresent([], "1:p", "room"));
  assertPresent([{ memberId: 1, presenceId: "p" }], "1:p", "room");
});

test("NEGATIVE CONTROL: the gate detects a duplicate presence", async () => {
  const dupes: Snapshot = [
    { memberId: 1, presenceId: "p" },
    { memberId: 1, presenceId: "p" },
  ];
  mustThrow("assertNoDuplicate", () => assertNoDuplicate(dupes, "1:p"));
  assertNoDuplicate([{ memberId: 1, presenceId: "p" }], "1:p");
});

test("NEGATIVE CONTROL: the gate detects a fabricated [0,0,0] standing in for 'no position yet'", async () => {
  const fake: Snapshot = [{ memberId: 1, presenceId: "p", pos: [0, 0, 0], rot: [0, 1, 0, 0] }];
  mustThrow("assertNoPositionYet", () => assertNoPositionYet(fake, "1:p"));
  assertNoPositionYet([{ memberId: 1, presenceId: "p" }], "1:p");
});

test("NEGATIVE CONTROL: the gate detects a stale old-world position", async () => {
  const stale: Snapshot = [{ memberId: 1, presenceId: "p", pos: [77, 8, 99] }];
  mustThrow("assertNotStalePosition", () => assertNotStalePosition(stale, "1:p", [77, 8, 99]));
  assertNotStalePosition([{ memberId: 1, presenceId: "p", pos: [1, 1, 1] }], "1:p", [77, 8, 99]);
});

test("NEGATIVE CONTROL: the gate detects wrong-room enumeration", async () => {
  // A snapshot that reports a member from another room fails the isolation
  // assertion the room-enumeration tests rely on.
  const wrong: Snapshot = [{ memberId: 2, presenceId: "elsewhere" }];
  mustThrow("assertNoGhost (cross-room)", () => assertNoGhost(wrong, "2:elsewhere", "this-room"));
});

test("NEGATIVE CONTROL: socket.id is NOT stable identity in Beta and must not be used as the key", async () => {
  // Proves the choice of key rather than assuming it: the same logical citizen
  // is reported under two DIFFERENT socketIds across a reconnect, so a
  // socket.id-keyed registry would render the same person twice.
  const room = "g-keyproof";
  const key = presenceKey(35, "p-key");
  const first = await newClient();
  const rs1 = await join(first, room, signToken(35, "keyproof"), "p-key");
  const socket1 = entryOf(rs1.presences, key).socketId;
  first.disconnect();
  await settle(300);
  const second = await newClient();
  const rs2 = await join(second, room, signToken(35, "keyproof"), "p-key");
  const socket2 = entryOf(rs2.presences, key).socketId;

  assert.notStrictEqual(socket1, socket2, "socket.id changed across the reconnect");
  assert.strictEqual(
    presenceKey(35, "p-key"), key,
    "the logical presence key did NOT change - this is why it is the render key",
  );
  assertNoDuplicate(rs2.presences, key);
});

// ===========================================================================

async function run(): Promise<void> {
  let failures = 0;
  try {
    PORT = await getFreePort();
    serverProc = await startServer(PORT);
  } catch (err) {
    console.error("  x could not start test server");
    console.error(err instanceof Error ? `    ${err.message}` : err);
    if (serverLog) console.error("    --- server output ---\n" + serverLog);
    process.exit(1);
  }

  for (const { name, run: runTest } of tests) {
    try {
      await runTest();
      console.log(`  ok   ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error(err instanceof Error ? `    ${err.message}` : err);
    }
  }

  for (const s of sockets) {
    try { s.disconnect(); } catch (e) { /* ignore */ }
  }
  await killServer(serverProc);

  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures > 0) {
    process.exit(1);
  }
}

run();
