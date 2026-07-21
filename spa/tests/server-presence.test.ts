/**
 * Real-protocol tests for server.js. These boot the ACTUAL socket server as a
 * subprocess on an ephemeral port (never the dev stack's ports) and drive it
 * with real socket.io-client connections and signed JWTs - so the server-side
 * ownership guards, room-tagging, correlation and transform handling are proven
 * over the wire, not against a re-implementation. socket.io / socket.io-client /
 * jsonwebtoken are already dependencies, so no new dependency is introduced.
 *
 * Presence ownership is asserted only through protocol-visible snapshots and
 * events (ROOM_STATE / AV:new / AV:del) - there is no test-only endpoint.
 */
import assert from "assert";

// Required via `require` (not `import`) so the suite compiles without extra
// @types packages; these are runtime-only helpers.
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");

const SPA_DIR = path.resolve(__dirname, "../../..");
const SERVER = path.join(SPA_DIR, "server.js");
const SECRET = "test-secret-do-not-use-in-prod";

type Test = { name: string; run: () => Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void>): void {
  tests.push({ name, run });
}

let PORT = 0;
let serverProc: any = null;
let serverLog = "";

function signToken(id: number, username: string): string {
  return jwt.sign({ id, username, avatar: { id: `av-${id}` } }, SECRET);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    // Discover a free port via the OS (listen on 0), then hand the concrete
    // number to the server - the server itself is never given the string "0".
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
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`server exited before ready (code ${code})`));
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("timed out waiting for server ready"));
      }
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

/** Waits for the next `event` matching an optional predicate. */
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

/** Asserts `event` does NOT fire within the window (negative control). */
function expectNone(sock: any, event: string, windowMs = 600): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (payload: any) => { cleanup(); reject(new Error(`unexpected ${event}: ${JSON.stringify(payload)}`)); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, windowMs);
    function cleanup() { clearTimeout(timer); sock.off(event, handler); }
    sock.on(event, handler);
  });
}

/** Emits a JOIN and resolves with the correlated ROOM_STATE. */
async function join(sock: any, room: string, token: string, presenceId: string, joinId: string): Promise<any> {
  const rs = waitFor(sock, "ROOM_STATE", (p) => p.joinId === joinId);
  sock.emit("JOIN", { room, token, presenceId, joinId });
  return rs;
}

const sockets: any[] = [];
async function newClient(): Promise<any> {
  const sock = await connect();
  sockets.push(sock);
  return sock;
}

test("ROOM_STATE echoes the room and joinId of the attempt", async () => {
  const token = signToken(1, "alice");
  const sock = await newClient();
  const rs = await join(sock, "room-echo", token, "pres-1", "jid-echo");
  assert.strictEqual(rs.room, "room-echo");
  assert.strictEqual(rs.joinId, "jid-echo");
  assert.ok(Array.isArray(rs.presences));
});

test("an invalid token yields a JOIN:error echoing room and joinId", async () => {
  const sock = await newClient();
  const err = waitFor(sock, "JOIN:error", (p) => p.joinId === "jid-bad");
  sock.emit("JOIN", { room: "room-x", token: "not-a-jwt", presenceId: "pres-1", joinId: "jid-bad" });
  const payload = await err;
  assert.strictEqual(payload.room, "room-x");
  assert.strictEqual(payload.joinId, "jid-bad");
  assert.strictEqual(payload.reason, "invalid_token");
});

test("a malformed JOIN payload is rejected without crashing the server", async () => {
  const sock = await newClient();
  const err = waitFor(sock, "JOIN:error", (p) => p && p.reason === "invalid_payload");
  sock.emit("JOIN", null);
  const payload = await err;
  assert.strictEqual(payload.reason, "invalid_payload");
  // The server is still alive: a subsequent valid JOIN succeeds.
  const token = signToken(2, "bob");
  const rs = await join(sock, "room-alive", token, "pres-alive", "jid-alive");
  assert.strictEqual(rs.room, "room-alive");
});

test("a duplicate same-room JOIN does not re-announce the presence to peers", async () => {
  const room = "room-dup";
  const peer = await newClient();
  await join(peer, room, signToken(10, "peer"), "pres-peer", "jid-p");

  const subject = await newClient();
  const sawJoin = waitFor(peer, "AV:new", (p) => p.presenceId === "pres-sub");
  await join(subject, room, signToken(11, "sub"), "pres-sub", "jid-s1");
  const avNew = await sawJoin;
  assert.strictEqual(avNew.room, room); // AV:new is room-tagged

  // Re-JOIN the same room/presence: peers must NOT get a second "someone joined".
  const noSecond = expectNone(peer, "AV:new");
  await join(subject, room, signToken(11, "sub"), "pres-sub", "jid-s2");
  await noSecond;
});

test("a different-room JOIN announces departure to the old room and arrival to the new", async () => {
  const roomA = "room-A-move";
  const roomB = "room-B-move";
  const peerA = await newClient();
  const peerB = await newClient();
  await join(peerA, roomA, signToken(20, "pa"), "pres-pa", "jid-pa");
  await join(peerB, roomB, signToken(21, "pb"), "pres-pb", "jid-pb");

  const subject = await newClient();
  await join(subject, roomA, signToken(22, "mover"), "pres-mv", "jid-m1");

  const leftA = waitFor(peerA, "AV:del", (p) => p.presenceId === "pres-mv");
  const enteredB = waitFor(peerB, "AV:new", (p) => p.presenceId === "pres-mv");
  await join(subject, roomB, signToken(22, "mover"), "pres-mv", "jid-m2");

  const del = await leftA;
  const add = await enteredB;
  assert.strictEqual(del.room, roomA); // AV:del carries the OLD room
  assert.strictEqual(add.room, roomB); // AV:new carries the NEW room
});

test("a rebind by a new socket preserves the transform and leaves one snapshot entry", async () => {
  const room = "room-rebind";
  const sock1 = await newClient();
  await join(sock1, room, signToken(30, "carol"), "pres-rb", "jid-r1");
  // Move to a known position (room-tagged AV, from the owning socket).
  sock1.emit("AV", { room, pos: [5, 6, 7], rot: [0, 1, 0, 2] });
  await new Promise((r) => setTimeout(r, 200)); // let the server store it

  // A NEW socket rebinds the same logical presence while it still exists.
  const sock2 = await newClient();
  const rs = await join(sock2, room, signToken(30, "carol"), "pres-rb", "jid-r2");
  const mine = rs.presences.filter((p: any) => p.presenceId === "pres-rb");
  assert.strictEqual(mine.length, 1); // exactly one record, not a duplicate
  assert.deepStrictEqual(mine[0].pos, [5, 6, 7]); // transform preserved across rebind
  assert.deepStrictEqual(mine[0].rot, [0, 1, 0, 2]);
});

test("a stale old socket cannot delete or announce a presence a newer socket now owns", async () => {
  const room = "room-stale";
  const peer = await newClient();
  await join(peer, room, signToken(40, "peer40"), "pres-peer40", "jid-pe");

  const sock1 = await newClient();
  await join(sock1, room, signToken(41, "dana"), "pres-stale", "jid-o1");

  // New socket takes over the same logical presence (a reconnect rebind).
  const sock2 = await newClient();
  await join(sock2, room, signToken(41, "dana"), "pres-stale", "jid-o2");

  // The stale old socket disconnecting must NOT broadcast an AV:del for the
  // presence the new socket now owns.
  const noDel = expectNone(peer, "AV:del", 800);
  sock1.disconnect();
  await noDel;

  // The presence is still there: a fresh observer sees it in the snapshot.
  const observer = await newClient();
  const rs = await join(observer, room, signToken(42, "obs"), "pres-obs", "jid-ob");
  const stillThere = rs.presences.some((p: any) => p.presenceId === "pres-stale");
  assert.strictEqual(stillThere, true);
});

test("a stale old socket cannot broadcast AV under a presence a newer socket owns", async () => {
  const room = "room-staleav";
  const peer = await newClient();
  await join(peer, room, signToken(50, "peer50"), "pres-peer50", "jid-pv");

  const sock1 = await newClient();
  await join(sock1, room, signToken(51, "eve"), "pres-av", "jid-a1");
  const sock2 = await newClient();
  await join(sock2, room, signToken(51, "eve"), "pres-av", "jid-a2");

  // Stale socket's movement is ignored (it no longer owns the presence)...
  const noAv = expectNone(peer, "AV", 700);
  sock1.emit("AV", { room, pos: [9, 9, 9] });
  await noAv;

  // ...but the current owner's movement is relayed (positive control).
  const gotAv = waitFor(peer, "AV", (p) => p.presenceId === "pres-av");
  sock2.emit("AV", { room, pos: [1, 2, 3] });
  const av = await gotAv;
  assert.strictEqual(av.room, room); // relayed AV is room-tagged
  assert.deepStrictEqual(av.pos, [1, 2, 3]);
});

test("an AV tagged for a different room than the socket's current room is dropped", async () => {
  const room = "room-avguard";
  const peer = await newClient();
  await join(peer, room, signToken(60, "peer60"), "pres-peer60", "jid-g1");
  const subject = await newClient();
  await join(subject, room, signToken(61, "frank"), "pres-fr", "jid-g2");

  // Mis-tagged AV (claims a room the socket isn't in) must be dropped.
  const noAv = expectNone(peer, "AV", 700);
  subject.emit("AV", { room: "some-other-room", pos: [7, 7, 7] });
  await noAv;

  // Correctly-tagged AV is relayed (positive control).
  const gotAv = waitFor(peer, "AV", (p) => p.presenceId === "pres-fr");
  subject.emit("AV", { room, pos: [4, 5, 6] });
  const av = await gotAv;
  assert.deepStrictEqual(av.pos, [4, 5, 6]);
});

async function run(): Promise<void> {
  let failures = 0;
  try {
    PORT = await getFreePort();
    serverProc = await startServer(PORT);
  } catch (err) {
    console.error("  ✗ could not start test server");
    console.error(err instanceof Error ? `    ${err.message}` : err);
    if (serverLog) console.error("    --- server output ---\n" + serverLog);
    process.exit(1);
  }

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

  // Unconditional teardown: close every client, then kill the server subprocess.
  for (const s of sockets) {
    try { s.disconnect(); } catch (e) { /* ignore */ }
  }
  await killServer(serverProc);

  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures > 0) {
    if (serverLog) console.error("--- server output ---\n" + serverLog);
    process.exit(1);
  }
}

run();
