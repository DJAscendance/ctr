/**
 * Real-protocol tests for home chat access on server.js.
 *
 * These boot the ACTUAL socket server as a subprocess on an ephemeral port and drive it
 * with real socket.io-client connections and signed JWTs, so the relay-side guard is proven
 * over the wire rather than against a re-implementation of it.
 *
 * The authorization ANSWER comes from a stub API standing in for
 * GET /api/home/chat-access/can-chat/:placeId. That is deliberate: it lets a test flip a
 * guest list mid-session, and fail a lookup, which is exactly what cannot be arranged
 * against the real endpoint. The decision logic behind that endpoint is covered separately
 * and hermetically by api/src/services/home/home-chat-access.service.spec.ts.
 *
 * Persistence is NOT exercised here - the socket server never writes messages. The
 * persistence-side guard lives in message.controller.
 */
import assert from "assert";

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const jwt = require("jsonwebtoken");
const express = require("express");
const { io } = require("socket.io-client");

const SPA_DIR = path.resolve(__dirname, "../../..");
const SERVER = path.join(SPA_DIR, "server.js");
const SECRET = "test-secret-do-not-use-in-prod";

/** Must match CHAT_ACCESS_TTL_MS in server.js. */
const TTL_MS = 5000;

type Test = { name: string; run: () => Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => Promise<void>): void {
  tests.push({ name, run });
}

let PORT = 0;
let API_PORT = 0;
let serverProc: any = null;
let apiServer: any = null;
let serverLog = "";

/**
 * allow[`${room}:${memberId}`] -> boolean. Anything absent is denied, matching a restricted
 * home. `mode` lets a test make the lookup fail or answer nonsense.
 */
const access: { allow: { [key: string]: boolean }; mode: string; calls: number } = {
  allow: {},
  mode: "ok",
  calls: 0,
};

function signToken(id: number, username: string): string {
  return jwt.sign({ id, username, avatar: { id: `av-${id}` } }, SECRET);
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

function startStubApi(port: number): Promise<any> {
  const app = express();
  app.get("/api/home/chat-access/can-chat/:placeId", (req: any, res: any) => {
    access.calls += 1;
    if (access.mode === "error") {
      res.status(500).json({ error: "boom" });
      return;
    }
    if (access.mode === "malformed-body") {
      res.status(200).json({ allowed: "yes" });   // truthy string, not true
      return;
    }
    if (access.mode === "empty-body") {
      res.status(200).json({});
      return;
    }
    if (access.mode === "not-json") {
      res.status(200).send("allowed");
      return;
    }
    let memberId: number | undefined;
    try {
      const decoded: any = jwt.verify(String(req.headers.apitoken), SECRET);
      memberId = decoded.id;
    } catch (err) {
      res.status(401).json({ error: "bad token" });
      return;
    }
    const allowed = access.allow[`${req.params.placeId}:${memberId}`] === true;
    res.status(200).json({ allowed });
  });
  return new Promise((resolve) => {
    const srv = app.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function startServer(port: number, apiPort: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: SPA_DIR,
      env: {
        ...process.env,
        WEBSOCKET_PORT: String(port),
        JWT_SECRET: SECRET,
        API_URL: `http://127.0.0.1:${apiPort}/api`,
      },
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
        reject(new Error(`server exited before ready (code ${code})\n${serverLog}`));
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`timed out waiting for server ready\n${serverLog}`));
      }
    }, 15000);
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

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Connects a client and JOINs the given room, resolving once ROOM_STATE arrives. */
function connectAndJoin(memberId: number, username: string, room: string, presenceId: string) {
  return new Promise<any>((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${PORT}`, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    const timer = setTimeout(() => reject(new Error("join timed out")), 8000);
    socket.on("connect", () => {
      socket.emit("JOIN", {
        room,
        token: signToken(memberId, username),
        presenceId,
        joinId: `join-${presenceId}-${room}`,
      });
    });
    socket.on("ROOM_STATE", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("JOIN:error", (e: any) => {
      clearTimeout(timer);
      reject(new Error(`JOIN failed: ${JSON.stringify(e)}`));
    });
  });
}

/** Collects CHAT events on a socket for the given window. */
function collectChat(socket: any, ms: number): Promise<any[]> {
  const received: any[] = [];
  const handler = (data: any) => received.push(data);
  socket.on("CHAT", handler);
  return wait(ms).then(() => {
    socket.off("CHAT", handler);
    return received;
  });
}

/** A relayed message is one carrying a username - the denial is a `type: "system"` frame. */
function relayed(frames: any[]): any[] {
  return frames.filter(f => f && f.username !== undefined);
}
function denials(frames: any[]): any[] {
  return frames.filter(f => f && f.type === "system");
}

/**
 * Every test uses its OWN room id. The server caches a member's permission per
 * (room, member) for CHAT_ACCESS_TTL_MS, and all tests share one long-lived server
 * process, so reusing a room would let one test's revocation still be cached when the next
 * one starts. Unique rooms keep the cache real - it is deliberate behaviour under test in
 * two of these cases - while keeping the tests independent.
 */
let nextRoom = 4242;
function freshRoom(): string {
  nextRoom += 1;
  return String(nextRoom);
}
const OWNER = 1;
const GUEST = 2;
const VISITOR = 3;

test("an unrelated visitor's CHAT is not relayed in a restricted home", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true, [`${HOME}:${GUEST}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner");
  const visitor = await connectAndJoin(VISITOR, "Visitor", HOME, "p-visitor");

  const ownerHeard = collectChat(owner, 1200);
  const visitorHeard = collectChat(visitor, 1200);
  visitor.emit("CHAT", { msg: "let me in", msg_id: 1 });

  const heardByOwner = await ownerHeard;
  const heardByVisitor = await visitorHeard;

  assert.strictEqual(relayed(heardByOwner).length, 0,
    "the owner must not receive an unauthorized visitor's message");
  assert.strictEqual(relayed(heardByVisitor).length, 0,
    "the message must not be echoed back to its sender either");
  assert.ok(denials(heardByVisitor).length >= 1,
    "the visitor should be told they cannot chat here");

  owner.close();
  visitor.close();
});

test("the homeowner's CHAT is relayed", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner2");
  const visitor = await connectAndJoin(VISITOR, "Visitor", HOME, "p-visitor2");

  const heard = collectChat(visitor, 1200);
  owner.emit("CHAT", { msg: "welcome", msg_id: 2 });
  const frames = await heard;

  const messages = relayed(frames);
  assert.strictEqual(messages.length, 1, "the owner's message should reach the room");
  assert.strictEqual(messages[0].username, "Owner");

  owner.close();
  visitor.close();
});

test("a configured guest's CHAT is relayed", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true, [`${HOME}:${GUEST}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner3");
  const guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest3");

  const heard = collectChat(owner, 1200);
  guest.emit("CHAT", { msg: "hello", msg_id: 3 });
  const frames = await heard;

  const messages = relayed(frames);
  assert.strictEqual(messages.length, 1, "a configured guest should be relayed");
  assert.strictEqual(messages[0].username, "Guest");

  owner.close();
  guest.close();
});

test("an unrestricted home permits an ordinary visitor", async () => {
  const OPEN_HOME = freshRoom();
  access.mode = "ok";
  // The real endpoint answers true for everyone when a home has no guest list.
  access.allow = { [`${OPEN_HOME}:${VISITOR}`]: true, [`${OPEN_HOME}:${OWNER}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", OPEN_HOME, "p-owner4");
  const visitor = await connectAndJoin(VISITOR, "Visitor", OPEN_HOME, "p-visitor4");

  const heard = collectChat(owner, 1200);
  visitor.emit("CHAT", { msg: "hi all", msg_id: 4 });
  const frames = await heard;

  assert.strictEqual(relayed(frames).length, 1,
    "an open home should relay an ordinary visitor");

  owner.close();
  visitor.close();
});

test("removing a guest revokes access within the refresh bound", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true, [`${HOME}:${GUEST}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner5");
  const guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest5");

  // Prove the guest can speak first, which also warms the cache.
  let heard = collectChat(owner, 1200);
  guest.emit("CHAT", { msg: "before", msg_id: 5 });
  assert.strictEqual(relayed(await heard).length, 1, "guest should start out allowed");

  // The owner removes them. Nobody leaves the room and nothing restarts.
  access.allow[`${HOME}:${GUEST}`] = false;
  await wait(TTL_MS + 400);

  heard = collectChat(owner, 1500);
  guest.emit("CHAT", { msg: "after", msg_id: 6 });
  const frames = await heard;

  assert.strictEqual(relayed(frames).length, 0,
    "a removed guest must stop being relayed within the refresh bound");

  owner.close();
  guest.close();
});

test("adding a guest grants access within the refresh bound", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner6");
  const visitor = await connectAndJoin(VISITOR, "Visitor", HOME, "p-visitor6");

  let heard = collectChat(owner, 1200);
  visitor.emit("CHAT", { msg: "before", msg_id: 7 });
  assert.strictEqual(relayed(await heard).length, 0, "visitor should start out denied");

  access.allow[`${HOME}:${VISITOR}`] = true;
  await wait(TTL_MS + 400);

  heard = collectChat(owner, 1500);
  visitor.emit("CHAT", { msg: "after", msg_id: 8 });

  assert.strictEqual(relayed(await heard).length, 1,
    "a newly added guest must be relayed within the refresh bound");

  owner.close();
  visitor.close();
});

test("reconnecting does not preserve stale permission", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true, [`${HOME}:${GUEST}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner7");
  let guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest7");

  let heard = collectChat(owner, 1200);
  guest.emit("CHAT", { msg: "before", msg_id: 9 });
  assert.strictEqual(relayed(await heard).length, 1, "guest should start out allowed");

  // Revoke, then reconnect on a NEW transport under the same logical presence.
  access.allow[`${HOME}:${GUEST}`] = false;
  guest.close();
  await wait(TTL_MS + 400);
  guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest7");

  heard = collectChat(owner, 1500);
  guest.emit("CHAT", { msg: "after reconnect", msg_id: 10 });

  assert.strictEqual(relayed(await heard).length, 0,
    "a reconnect must not carry forward a permission that has since been revoked");

  owner.close();
  guest.close();
});

test("home permission does not follow a member into another room", async () => {
  const HOME = freshRoom();
  const OTHER_ROOM = freshRoom();
  access.mode = "ok";
  // Allowed in the home, and NOT allowed in the other room.
  access.allow = { [`${HOME}:${GUEST}`]: true, [`${OTHER_ROOM}:${OWNER}`]: true };

  const guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest8");
  const bystander = await connectAndJoin(OWNER, "Owner", OTHER_ROOM, "p-owner8");

  // Move the guest to the other room, under the same presence id.
  guest.emit("JOIN", {
    room: OTHER_ROOM,
    token: signToken(GUEST, "Guest"),
    presenceId: "p-guest8",
    joinId: "join-move",
  });
  await wait(600);

  const heard = collectChat(bystander, 1500);
  guest.emit("CHAT", { msg: "still allowed?", msg_id: 11 });

  assert.strictEqual(relayed(await heard).length, 0,
    "permission granted at a home must not carry into a different place");

  guest.close();
  bystander.close();
});

test("two tabs for one member behave consistently", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true, [`${HOME}:${GUEST}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner9");
  const tabA = await connectAndJoin(GUEST, "Guest", HOME, "p-guest9a");
  const tabB = await connectAndJoin(GUEST, "Guest", HOME, "p-guest9b");

  let heard = collectChat(owner, 1200);
  tabA.emit("CHAT", { msg: "from tab A", msg_id: 12 });
  assert.strictEqual(relayed(await heard).length, 1, "tab A should be relayed");

  heard = collectChat(owner, 1200);
  tabB.emit("CHAT", { msg: "from tab B", msg_id: 13 });
  assert.strictEqual(relayed(await heard).length, 1, "tab B should be relayed identically");

  // Revoking applies to both tabs, not just the one that spoke.
  access.allow[`${HOME}:${GUEST}`] = false;
  await wait(TTL_MS + 400);

  heard = collectChat(owner, 1500);
  tabA.emit("CHAT", { msg: "A after revoke", msg_id: 14 });
  tabB.emit("CHAT", { msg: "B after revoke", msg_id: 15 });
  assert.strictEqual(relayed(await heard).length, 0,
    "revocation must apply to every tab of that member");

  owner.close();
  tabA.close();
  tabB.close();
});

test("a failed authorization lookup denies rather than permits", async () => {
  const HOME = freshRoom();
  access.mode = "ok";
  access.allow = { [`${HOME}:${OWNER}`]: true, [`${HOME}:${GUEST}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner10");
  const guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest10");

  let heard = collectChat(owner, 1200);
  guest.emit("CHAT", { msg: "before outage", msg_id: 16 });
  assert.strictEqual(relayed(await heard).length, 1, "guest allowed before the outage");

  // API starts failing. Wait past the TTL so the cached allow cannot mask it.
  access.mode = "error";
  await wait(TTL_MS + 400);

  heard = collectChat(owner, 1500);
  guest.emit("CHAT", { msg: "during outage", msg_id: 17 });
  assert.strictEqual(relayed(await heard).length, 0,
    "an unavailable authorization lookup must fail CLOSED");

  access.mode = "ok";
});

test("a malformed authorization response cannot permit a message", async () => {
  const HOME = freshRoom();
  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner11");
  const guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest11");

  for (const mode of ["malformed-body", "empty-body", "not-json"]) {
    access.mode = mode;
    access.allow = { [`${HOME}:${GUEST}`]: true };
    await wait(TTL_MS + 400);

    const heard = collectChat(owner, 1500);
    guest.emit("CHAT", { msg: `mode ${mode}`, msg_id: 18 });
    assert.strictEqual(relayed(await heard).length, 0,
      `a ${mode} response must not be treated as permission`);
  }

  access.mode = "ok";
  owner.close();
  guest.close();
});

test("a failed lookup is not cached, so the next message retries", async () => {
  const HOME = freshRoom();
  access.mode = "error";
  access.allow = { [`${HOME}:${GUEST}`]: true, [`${HOME}:${OWNER}`]: true };

  const owner = await connectAndJoin(OWNER, "Owner", HOME, "p-owner12");
  const guest = await connectAndJoin(GUEST, "Guest", HOME, "p-guest12");

  let heard = collectChat(owner, 1200);
  guest.emit("CHAT", { msg: "denied", msg_id: 19 });
  assert.strictEqual(relayed(await heard).length, 0, "denied during the outage");

  // Recovery must NOT need to wait out a TTL, because a failure is never cached.
  access.mode = "ok";
  heard = collectChat(owner, 1500);
  guest.emit("CHAT", { msg: "recovered", msg_id: 20 });
  assert.strictEqual(relayed(await heard).length, 1,
    "the next message after recovery should be relayed immediately");

  owner.close();
  guest.close();
});

(async () => {
  PORT = await getFreePort();
  API_PORT = await getFreePort();
  apiServer = await startStubApi(API_PORT);
  serverProc = await startServer(PORT, API_PORT);

  let failed = 0;
  for (const t of tests) {
    try {
      await t.run();
      console.log(`  ok  ${t.name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FAIL ${t.name}`);
      console.error(`       ${(error as Error).message}`);
    }
  }

  await killServer(serverProc);
  await new Promise(resolve => apiServer.close(resolve));

  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed > 0) {
    console.error("\n--- server log ---\n" + serverLog);
  }
  process.exit(failed ? 1 : 0);
})();
