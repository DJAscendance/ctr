/**
 * Real-protocol proof that a ban ends a socket session that is ALREADY connected.
 *
 * Boots the ACTUAL server.js as a subprocess on an ephemeral port, alongside a stand-in API
 * that answers `/api/member/session/status` exactly as the real one does -- 200 when the
 * session-revocation guard would let the request through, 403 when it would refuse it. The
 * stand-in is the ban lever: flipping one citizen's standing is what the administrator's
 * `addBan` does to the real API's answer, and `deleteBan` is what flips it back.
 *
 * The test that matters most is "a citizen already standing in a room". Guarding JOIN alone
 * would be the quiet downgrade of this fix to "blocked on reconnect", so the connected
 * socket is left idle -- sending nothing -- and must still lose its session.
 */
import assert from "assert";

const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const http = require("http");
const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");

const SPA_DIR = path.resolve(__dirname, "../../..");
const SERVER = path.join(SPA_DIR, "server.js");
const SECRET = "test-secret-do-not-use-in-prod";
const OTHER_SECRET = "a-completely-different-secret";
/** Short on purpose: the suite must observe a sweep, not wait out a production interval. */
const SWEEP_MS = 300;
/** Likewise short: production caches standing for 15s, which a suite must not sit through. */
const STANDING_CACHE_MS = 100;

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

/** Citizens the stand-in API currently refuses. Empty means everyone is in good standing. */
const REVOKED = new Set<number>();

/** Mints a token the way the API now does: pinned algorithm, expiry always present. */
function signToken(id: number, username: string, expiresIn: number | string = 3600): string {
  return jwt.sign(
    { id, username, avatar: { id: `av-${id}` } },
    SECRET,
    { algorithm: "HS256", expiresIn },
  );
}

/** Mints a token the way the API did BEFORE this release: no expiry claim at all. */
function signLegacyToken(id: number, username: string): string {
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

/*
 * The stand-in API. Only the routes server.js actually calls, and only the behaviour that
 * matters here: the status code IS the answer about standing.
 */
function startApi(port: number): Promise<any> {
  return new Promise((resolve) => {
    const srv = http.createServer((req: any, res: any) => {
      if (req.url.startsWith("/api/member/session/status")) {
        const token = req.headers.apitoken;
        let claims: any = null;
        try {
          claims = jwt.verify(token, SECRET, { algorithms: ["HS256"] });
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Malformed JWT token." }));
          return;
        }
        if (typeof claims.exp !== "number" || REVOKED.has(claims.id)) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Forbidden." }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ active: true }));
        return;
      }
      // Chat access and the Outlands lookups: answer the unrestricted default so the
      // handlers under test are not blocked on something this suite is not about.
      if (req.url.startsWith("/api/home/chat-access/status/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ restricted: false, allowedUsernames: [] }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function startServer(port: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd: SPA_DIR,
      env: {
        ...process.env,
        WEBSOCKET_PORT: String(port),
        JWT_SECRET: SECRET,
        API_URL: `http://127.0.0.1:${API_PORT}/api`,
        SESSION_SWEEP_MS: String(SWEEP_MS),
        SESSION_STANDING_CACHE_MS: String(STANDING_CACHE_MS),
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

const sockets: any[] = [];
function connect(): Promise<any> {
  const sock = io(`http://127.0.0.1:${PORT}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(sock);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("client connect timeout")), 5000);
    sock.on("connect", () => { clearTimeout(t); resolve(sock); });
    sock.on("connect_error", (e: Error) => { clearTimeout(t); reject(e); });
  });
}

// The base no-unused-vars rule counts a parameter NAME in a type signature as unused; a
// function type cannot omit it, so the rule is turned off for this one line.
// eslint-disable-next-line no-unused-vars
type Predicate = (payload: any) => boolean;

function waitFor(
  sock: any, event: string, predicate?: Predicate, timeoutMs = 4000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (payload: any) => {
      if (predicate && !predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const timer = setTimeout(
      () => { cleanup(); reject(new Error(`timeout waiting for ${event}`)); },
      timeoutMs,
    );
    function cleanup() { clearTimeout(timer); sock.off(event, handler); }
    sock.on(event, handler);
  });
}

/** Emits a JOIN and resolves with whichever of ROOM_STATE / JOIN:error settles it. */
function join(sock: any, room: string, token: string, id: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => { cleanup(); reject(new Error("timeout waiting for JOIN outcome")); },
      4000,
    );
    const ok = (p: any) => { if (p.joinId === id) { cleanup(); resolve({ ok: true, p }); } };
    const bad = (p: any) => { if (p.joinId === id) { cleanup(); resolve({ ok: false, p }); } };
    function cleanup() {
      clearTimeout(timer);
      sock.off("ROOM_STATE", ok);
      sock.off("JOIN:error", bad);
    }
    sock.on("ROOM_STATE", ok);
    sock.on("JOIN:error", bad);
    sock.emit("JOIN", { room, token, presenceId: `p-${id}`, joinId: id });
  });
}

function waitForDisconnect(sock: any, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!sock.connected) return resolve();
    const timer = setTimeout(
      () => { sock.off("disconnect", onDc); reject(new Error("socket stayed connected")); },
      timeoutMs,
    );
    const onDc = () => { clearTimeout(timer); resolve(); };
    sock.once("disconnect", onDc);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------------------

test("a citizen in good standing joins with a current token", async () => {
  const sock = await connect();
  const result = await join(sock, "100", signToken(1, "alice"), "j1");
  assert.strictEqual(result.ok, true, "JOIN should have been accepted");
  assert.strictEqual(result.p.room, "100");
});

test("an expired token is refused at JOIN", async () => {
  const sock = await connect();
  const result = await join(sock, "100", signToken(2, "bob", -60), "j2");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.p.reason, "invalid_token");
});

test("a LEGACY token with no exp claim is refused at JOIN", async () => {
  const sock = await connect();
  const result = await join(sock, "100", signLegacyToken(3, "carol"), "j3");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.p.reason, "invalid_token");
});

test("a token signed with the wrong secret is refused at JOIN", async () => {
  const sock = await connect();
  const foreign = jwt.sign({ id: 4, username: "mallory" }, OTHER_SECRET, {
    algorithm: "HS256", expiresIn: 3600,
  });
  const result = await join(sock, "100", foreign, "j4");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.p.reason, "invalid_token");
});

test("a token signed with an algorithm the city did not choose is refused", async () => {
  const sock = await connect();
  const hs512 = jwt.sign({ id: 5, username: "eve" }, SECRET, {
    algorithm: "HS512", expiresIn: 3600,
  });
  const result = await join(sock, "100", hs512, "j5");
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.p.reason, "invalid_token");
});

test("a banned citizen cannot JOIN at all", async () => {
  REVOKED.add(6);
  try {
    const sock = await connect();
    const result = await join(sock, "100", signToken(6, "banned-one"), "j6");
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.p.reason, "session_revoked");
  } finally {
    REVOKED.delete(6);
  }
});

test("an ALREADY-CONNECTED, idle citizen loses the session when the ban lands", async () => {
  const sock = await connect();
  const joined = await join(sock, "100", signToken(7, "dave"), "j7");
  assert.strictEqual(joined.ok, true, "should have joined while in good standing");

  const revoked = waitFor(sock, "SESSION:revoked");
  const gone = waitForDisconnect(sock);
  // Both are in flight before the ban lands; neither may leak an unhandled rejection if the
  // other fails first, which would take the whole runner down instead of one test.
  revoked.catch(() => undefined);
  gone.catch(() => undefined);

  // The administrator bans them. The socket sends NOTHING from here on: this is the case
  // that guarding JOIN alone would miss entirely.
  REVOKED.add(7);
  try {
    const payload = await revoked;
    assert.strictEqual(payload.reason, "session_revoked");
    await gone;
    assert.strictEqual(sock.connected, false, "the socket must be closed, not just idle");
  } finally {
    REVOKED.delete(7);
  }
});

test("a banned citizen cannot chat, even before the next sweep", async () => {
  const sock = await connect();
  const joined = await join(sock, "101", signToken(8, "erin"), "j8");
  assert.strictEqual(joined.ok, true);

  REVOKED.add(8);
  try {
    const revoked = waitFor(sock, "SESSION:revoked");
    sock.emit("CHAT", { msg: "you cannot silence me", msg_id: 1 });
    const payload = await revoked;
    assert.strictEqual(payload.reason, "session_revoked");
    await waitForDisconnect(sock);
  } finally {
    REVOKED.delete(8);
  }
});

test("a banned citizen's reconnect is refused too", async () => {
  REVOKED.add(9);
  try {
    const sock = await connect();
    const first = await join(sock, "100", signToken(9, "frank"), "j9a");
    assert.strictEqual(first.ok, false);
    // A reconnect is an ordinary new socket and an ordinary JOIN. Same answer.
    const again = await connect();
    const second = await join(again, "100", signToken(9, "frank"), "j9b");
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.p.reason, "session_revoked");
  } finally {
    REVOKED.delete(9);
  }
});

test("an unbanned citizen connects again normally", async () => {
  REVOKED.add(10);
  const sock = await connect();
  const refused = await join(sock, "100", signToken(10, "grace"), "j10a");
  assert.strictEqual(refused.ok, false);

  // The administrator removes the ban.
  REVOKED.delete(10);
  // The standing cache holds a verdict for a moment; a new session is a new token, so the
  // returning citizen is asked about afresh.
  const again = await connect();
  const allowed = await join(again, "100", signToken(10, "grace", 7200), "j10b");
  assert.strictEqual(allowed.ok, true, "an unbanned citizen must be let back in");
});

test("a citizen in good standing survives repeated sweeps untouched", async () => {
  const sock = await connect();
  const joined = await join(sock, "102", signToken(11, "heidi"), "j11");
  assert.strictEqual(joined.ok, true);
  await sleep(SWEEP_MS * 4);
  assert.strictEqual(sock.connected, true, "an unbanned session must not be swept away");
});

// --------------------------------------------------------------------------------------

async function run(): Promise<void> {
  let failures = 0;
  try {
    API_PORT = await getFreePort();
    apiServer = await startApi(API_PORT);
    PORT = await getFreePort();
    serverProc = await startServer(PORT);
  } catch (err) {
    console.error("  ✗ could not start the test stack");
    console.error(err instanceof Error ? `    ${err.message}` : err);
    if (serverLog) console.error(`    --- server output ---\n${serverLog}`);
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

  for (const s of sockets) {
    try { s.disconnect(); } catch (e) { /* ignore */ }
  }
  await killServer(serverProc);
  if (apiServer) apiServer.close();

  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures > 0) {
    if (serverLog) console.error(`--- server output ---\n${serverLog}`);
    process.exit(1);
  }
}

run();
