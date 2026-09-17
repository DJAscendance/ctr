/**
 * Real-protocol proof that inmate chat does not reach ordinary visitors.
 *
 * Boots the ACTUAL server.js as a subprocess, alongside a stand-in API that answers the two
 * routes the Jail rules depend on: `/api/place/jail`, which is how the socket server learns
 * which room is the Jail, and `/api/member/jail/standing`, which is how it learns whether
 * the holder of a given token is an inmate, staff, or neither. The stand-in is the sentence
 * lever -- adding an id to INMATES is what `addBan` does to the real API's answer, and
 * removing it is `deleteBan`.
 *
 * Four disposable identities, exactly as the privacy matrix requires: an inmate, an
 * ordinary visitor, a Jail Guard and a Security Officer. No real citizen appears anywhere.
 *
 * The assertion that matters is a NEGATIVE one, and negatives are easy to fake. The visitor
 * socket is not merely checked for "no matching message": it records EVERY `CHAT` payload
 * it receives for the whole run, and the test fails if the inmate's text appears in any of
 * them. A redacted or placeholder event would fail this just as a full one would, because
 * the requirement is that no event arrives at all.
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
/** Production caches standing for 15s; a suite must not sit through that. */
const STANDING_CACHE_MS = 100;
/** The Jail's place id in this stack. Every other room id is an ordinary place. */
const JAIL_ROOM = "77";
const OTHER_ROOM = "100";

const INMATE = { id: 11, username: "jailqa-inmate" };
const VISITOR = { id: 12, username: "jailqa-visitor" };
const GUARD = { id: 13, username: "jailqa-guard" };
const OFFICER = { id: 14, username: "jailqa-officer" };

/** Ids the stand-in API reports as serving a live jail sentence. */
const INMATES = new Set<number>([INMATE.id]);
/** Ids the stand-in API reports as holding a Security or Jail office. */
const STAFF = new Set<number>([GUARD.id, OFFICER.id]);

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

function signToken(id: number, username: string): string {
  return jwt.sign(
    { id, username, avatar: { id: `av-${id}` } },
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

/*
 * The stand-in API. Only the routes server.js actually calls.
 *
 * `/api/member/jail/standing` answers about the TOKEN HOLDER and nobody else, which is the
 * real endpoint's contract and the reason a client cannot claim an office: the id comes out
 * of the verified JWT, never out of the request body or the query string.
 */
function startApi(port: number): Promise<any> {
  return new Promise((resolve) => {
    const srv = http.createServer((req: any, res: any) => {
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url.startsWith("/api/member/session/status")) {
        return json(200, { active: true });
      }
      if (req.url.startsWith("/api/place/jail")) {
        return json(200, { place: { id: Number(JAIL_ROOM), slug: "jail" } });
      }
      if (req.url.startsWith("/api/member/jail/standing")) {
        let claims: any = null;
        try {
          claims = jwt.verify(req.headers.apitoken, SECRET, { algorithms: ["HS256"] });
        } catch (err) {
          return json(403, { error: "Forbidden." });
        }
        return json(200, {
          inmate: INMATES.has(claims.id),
          staff: STAFF.has(claims.id),
          jailPlaceId: Number(JAIL_ROOM),
        });
      }
      if (req.url.startsWith("/api/home/chat-access/status/")) {
        return json(200, { restricted: false, allowedUsernames: [] });
      }
      return json(404, { error: "not found" });
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
        JAIL_STANDING_CACHE_MS: String(STANDING_CACHE_MS),
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

/**
 * A connected client that keeps EVERY chat payload it was ever sent.
 *
 * The transcript is the evidence. Asserting "the visitor did not get this one message"
 * would pass for a server that sent a redacted copy or a placeholder; asserting against the
 * whole transcript will not.
 */
interface Client { sock: any; chats: any[] }

function connect(): Promise<Client> {
  const sock = io(`http://127.0.0.1:${PORT}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(sock);
  const chats: any[] = [];
  sock.on("CHAT", (payload: any) => chats.push(payload));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("client connect timeout")), 5000);
    sock.on("connect", () => { clearTimeout(t); resolve({ sock, chats }); });
    sock.on("connect_error", (e: Error) => { clearTimeout(t); reject(e); });
  });
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether this client was ever sent a chat carrying the given text. */
function heard(client: Client, text: string): boolean {
  return client.chats.some(payload => payload && payload.msg === text);
}

/**
 * Puts all four identities in the Jail and returns their clients.
 *
 * Each run uses fresh sockets so one test's transcript can never be mistaken for another's.
 */
async function assembleJail(tag: string): Promise<Record<string, Client>> {
  const inmate = await connect();
  const visitor = await connect();
  const guard = await connect();
  const officer = await connect();
  const joins = [
    join(inmate.sock, JAIL_ROOM, signToken(INMATE.id, INMATE.username), `${tag}-i`),
    join(visitor.sock, JAIL_ROOM, signToken(VISITOR.id, VISITOR.username), `${tag}-v`),
    join(guard.sock, JAIL_ROOM, signToken(GUARD.id, GUARD.username), `${tag}-g`),
    join(officer.sock, JAIL_ROOM, signToken(OFFICER.id, OFFICER.username), `${tag}-o`),
  ];
  const results = await Promise.all(joins);
  results.forEach((r, index) => {
    assert.strictEqual(r.ok, true, `JOIN ${index} into the Jail should have been accepted`);
  });
  return { inmate, visitor, guard, officer };
}

// --------------------------------------------------------------------------------------

test("an inmate's message never reaches an ordinary visitor", async () => {
  const room = await assembleJail("t1");
  const secret = "t1 do not let the visitor hear this";
  room.inmate.sock.emit("CHAT", { msg: secret, msg_id: null, exp: 0 });
  await sleep(600);
  assert.strictEqual(
    heard(room.visitor, secret), false,
    `the visitor received inmate chat; transcript: ${JSON.stringify(room.visitor.chats)}`,
  );
  assert.strictEqual(
    room.visitor.chats.length, 0,
    `the visitor received chat events at all; transcript: ${JSON.stringify(room.visitor.chats)}`,
  );
});

test("an inmate's message reaches a Jail Guard", async () => {
  const room = await assembleJail("t2");
  const line = "t2 guard should hear this";
  room.inmate.sock.emit("CHAT", { msg: line, msg_id: null, exp: 0 });
  await sleep(600);
  assert.strictEqual(heard(room.guard, line), true, "the Jail Guard heard nothing");
});

test("an inmate's message reaches a Security Officer", async () => {
  const room = await assembleJail("t3");
  const line = "t3 security should hear this";
  room.inmate.sock.emit("CHAT", { msg: line, msg_id: null, exp: 0 });
  await sleep(600);
  assert.strictEqual(heard(room.officer, line), true, "the Security Officer heard nothing");
});

test("an inmate hears their own message back", async () => {
  const room = await assembleJail("t4");
  const line = "t4 sender echo";
  room.inmate.sock.emit("CHAT", { msg: line, msg_id: null, exp: 0 });
  await sleep(600);
  assert.strictEqual(heard(room.inmate, line), true, "the speaker did not see their own line");
});

test("a visitor's own Jail chat is still public", async () => {
  const room = await assembleJail("t5");
  const line = "t5 an ordinary visitor speaking";
  room.visitor.sock.emit("CHAT", { msg: line, msg_id: 1, exp: 0 });
  await sleep(600);
  assert.strictEqual(heard(room.visitor, line), true, "the visitor lost their own chat");
  assert.strictEqual(heard(room.guard, line), true, "staff lost ordinary Jail chat");
  assert.strictEqual(
    heard(room.inmate, line), true,
    "an inmate must still hear staff and visitors, or the sentence becomes solitary",
  );
});

test("staff can answer an inmate, and the inmate receives it", async () => {
  const room = await assembleJail("t6");
  const line = "t6 guard replying to the wing";
  room.guard.sock.emit("CHAT", { msg: line, msg_id: 2, exp: 0 });
  await sleep(600);
  assert.strictEqual(heard(room.inmate, line), true, "the inmate did not receive the reply");
});

test("a visitor cannot gain inmate chat by claiming an office in the payload", async () => {
  const room = await assembleJail("t7");
  // Every field a client controls, set to whatever a forger would set it to. None of them
  // is read for authority: standing is fetched from the API against the socket's own token.
  room.visitor.sock.emit("JOIN", {
    room: JAIL_ROOM,
    token: signToken(VISITOR.id, VISITOR.username),
    presenceId: "p-t7-spoof",
    joinId: "t7-spoof",
    staff: true,
    inmate: true,
    role: "Security Chief",
    roleId: 1,
    admin: true,
  });
  await sleep(300);
  const secret = "t7 still not for the visitor";
  room.inmate.sock.emit("CHAT", { msg: secret, msg_id: null, exp: 0 });
  await sleep(600);
  assert.strictEqual(
    heard(room.visitor, secret), false,
    `a spoofed payload bought inmate chat; transcript: ${JSON.stringify(room.visitor.chats)}`,
  );
});

test("a visitor cannot gain inmate chat by claiming an office in the chat payload", async () => {
  const room = await assembleJail("t8");
  room.visitor.sock.emit("CHAT", { msg: "t8 warmup", msg_id: 3, role: "Jail Guard", exp: 0 });
  await sleep(300);
  const before = room.visitor.chats.length;
  const secret = "t8 the visitor must not hear this";
  room.inmate.sock.emit("CHAT", { msg: secret, msg_id: null, exp: 0 });
  await sleep(600);
  assert.strictEqual(heard(room.visitor, secret), false, "a claimed role bought inmate chat");
  assert.strictEqual(
    room.visitor.chats.length, before,
    "the visitor received an extra event while an inmate was speaking",
  );
});

test("a jailed citizen cannot JOIN any room but the Jail", async () => {
  const client = await connect();
  const result = await join(
    client.sock, OTHER_ROOM, signToken(INMATE.id, INMATE.username), "t9",
  );
  assert.strictEqual(result.ok, false, "a jailed citizen entered an ordinary place");
  assert.strictEqual(result.p.reason, "jailed");
});

test("a jailed citizen may still JOIN the Jail", async () => {
  const client = await connect();
  const result = await join(
    client.sock, JAIL_ROOM, signToken(INMATE.id, INMATE.username), "t10",
  );
  assert.strictEqual(result.ok, true, "a jailed citizen was locked out of the Jail itself");
});

test("an ordinary visitor is not confined to the Jail", async () => {
  const client = await connect();
  const result = await join(
    client.sock, OTHER_ROOM, signToken(VISITOR.id, VISITOR.username), "t11",
  );
  assert.strictEqual(result.ok, true, "an unjailed citizen was refused an ordinary place");
});

test("releasing an inmate restores ordinary travel and ordinary chat", async () => {
  const released = { id: 15, username: "jailqa-released" };
  INMATES.add(released.id);
  const jailed = await connect();
  const blocked = await join(
    jailed.sock, OTHER_ROOM, signToken(released.id, released.username), "t12a",
  );
  assert.strictEqual(blocked.ok, false, "the sentence was not in force to begin with");

  // The normal application path: `deleteBan` (or an expiry) flips what the API reports.
  INMATES.delete(released.id);
  await sleep(STANDING_CACHE_MS * 3);

  const free = await connect();
  const allowed = await join(
    free.sock, OTHER_ROOM, signToken(released.id, released.username), "t12b",
  );
  assert.strictEqual(allowed.ok, true, "a released citizen is still trapped");

  // And their Jail chat is public again, like any other visitor's.
  const room = await assembleJail("t12c");
  const speaker = await connect();
  await join(speaker.sock, JAIL_ROOM, signToken(released.id, released.username), "t12d");
  const line = "t12 released and speaking in public";
  speaker.sock.emit("CHAT", { msg: line, msg_id: 4, exp: 0 });
  await sleep(600);
  assert.strictEqual(
    heard(room.visitor, line), true,
    "a released citizen's chat is still being treated as inmate speech",
  );
});

test("an expired sentence stops making someone an inmate", async () => {
  // An expiry is not a separate code path: `hasActiveJailBan` filters on `end_date > now`,
  // so a spent sentence simply stops being reported. This proves the socket server follows
  // that change without anything having to be run against it.
  const expired = { id: 16, username: "jailqa-expired" };
  const client = await connect();
  const result = await join(
    client.sock, OTHER_ROOM, signToken(expired.id, expired.username), "t13",
  );
  assert.strictEqual(result.ok, true, "a citizen with no live sentence was confined");
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
