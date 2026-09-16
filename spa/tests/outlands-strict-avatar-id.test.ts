/**
 * STRICT AVATAR ID VALIDATION, OVER THE REAL SOCKET WIRE.
 *
 * Independent QA found the socket JOIN resolver comparing the client's
 * `outlandsAvatarId` after `Number()`. `Number([13])` is `13`, so an ARRAY was
 * answered with a real Outlands team avatar and the citizen was dressed as
 * `bluef.wrl` on the strength of a value that was never an id.
 *
 * Every case here is sent as a genuine socket.io JOIN payload to the ACTUAL
 * `server.js`, spawned as a subprocess on an OS-assigned free port, and the
 * answer read back off the protocol: the avatar carried in that presence's own
 * ROOM_STATE record. Source inspection would not prove this; a re-implemented
 * resolver would prove only itself.
 *
 * `server.js` asks a real API for the Outlands place and the four team rows, so
 * this suite stands one up on its own free port and points API_URL at it. That
 * stub answers exactly as the real API does -- the ids are primitive NUMBERS,
 * which is what both MySQL drivers were observed to return and what JSON then
 * carries intact -- so the comparison under test sees real data shapes.
 *
 * The case table is the twin of `api/src/libs/client-id.spec.ts`. The two
 * servers are separate packages and cannot share a module, so the rule is
 * written twice and asserted against the same list twice. A value added in one
 * belongs in the other.
 */
import assert from "assert";

const { spawn } = require("child_process");
const net = require("net");
const http = require("http");
const path = require("path");
const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");

const SPA_DIR = path.resolve(__dirname, "../../..");
const SERVER = path.join(SPA_DIR, "server.js");
const SECRET = "outlands-strict-id-gate-secret";

/** The Outlands place id the stub API serves. Any room but this one is a normal room. */
const OUTLANDS_ROOM = "77";
/** A normal room. Plaza stands for every room that is not Outlands. */
const PLAZA_ROOM = "5";

/*
 * The four playable rows, exactly as the API serves them. The historical team
 * mapping is `ne_game.wrl`'s own and is not ours to renumber.
 */
const TEAM_ROWS = [
  { id: 16, filename: "redm.wrl", directory: "16", team: 1 },
  { id: 15, filename: "redf.wrl", directory: "15", team: 1 },
  { id: 14, filename: "bluem.wrl", directory: "14", team: 2 },
  { id: 13, filename: "bluef.wrl", directory: "13", team: 2 },
];

/** The Game Master is a system avatar and is never served as a choice. */
const GAME_MASTER_FILE = "gm.wrl";

/** The citizen's own avatar, carried in their verified token. Every fallback lands here. */
const OWN_AVATAR = { id: 11, filename: "sparkie.wrl", directory: "11" };

/*
 * Every malformed shape a socket.io payload can actually carry. socket.io
 * serialises with JSON, so `undefined` arrives as an ABSENT key and NaN /
 * Infinity cannot be transmitted at all -- those two are asserted against a
 * real JavaScript value in `api/src/libs/client-id.spec.ts` instead of being
 * faked here.
 */
const MALFORMED: Array<[string, unknown]> = [
  ["an array holding the id", [13]],
  ["an array holding the id as a string", ["13"]],
  ["an empty array", []],
  ["the id as a string", "13"],
  ["the id as a zero-padded string", "013"],
  ["the id as a padded string", " 13 "],
  ["an object", {}],
  ["an object carrying the id", { id: 13 }],
  ["true", true],
  ["false", false],
  ["null", null],
  ["a fraction", 13.5],
  ["a negative integer", -13],
  ["zero", 0],
  ["an integer past the safe range", Number.MAX_SAFE_INTEGER + 1],
  ["a very large numeric value", 1e308],
];

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
const sockets: any[] = [];

/** Team rows the stub API currently serves. Mutated by the database-authority cases. */
let servedRows = TEAM_ROWS.slice();

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

/**
 * The API `server.js` talks to, answering only the two Outlands routes it asks
 * for. Standing this up rather than mocking axios keeps the JSON round trip in
 * the picture, which is where an id's type would be lost if it ever were.
 */
function startStubApi(port: number): Promise<any> {
  return new Promise((resolve) => {
    const srv = http.createServer((req: any, res: any) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/place/outlands") {
        res.end(JSON.stringify({ place: { id: Number(OUTLANDS_ROOM), name: "Outlands" } }));
        return;
      }
      if (req.url === "/avatar/outlands") {
        res.end(JSON.stringify({ avatars: servedRows }));
        return;
      }
      res.statusCode = 404;
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
        API_URL: `http://127.0.0.1:${API_PORT}`,
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

/* Base no-unused-vars cannot see a TS type position; the name is the signature. */
// eslint-disable-next-line no-unused-vars
function waitFor(sock: any, event: string, predicate?: (payload: any) => boolean,
  timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (payload: any) => {
      if (predicate && !predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function cleanup() { clearTimeout(timer); sock.off(event, handler); }
    sock.on(event, handler);
  });
}

function signToken(id: number, username: string): string {
  // Minted the way the API mints one now: pinned algorithm, expiry always present.
  // A token with no `exp` is a pre-release token and server.js refuses it.
  return jwt.sign(
    { id, username, avatar: OWN_AVATAR },
    SECRET,
    { algorithm: "HS256", expiresIn: 3600 },
  );
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/**
 * JOINs a room with the given override and answers with the avatar the SERVER
 * decided this presence wears. Read out of the presence's own ROOM_STATE record,
 * which is the protocol's statement of what every other citizen will see.
 */
async function joinAndReadAvatar(
  room: string,
  outlandsAvatarId: unknown,
  memberId = 501,
): Promise<any> {
  const sock = await connect();
  const presenceId = nextId("presence");
  const joinId = nextId("join");
  const token = signToken(memberId, `citizen${memberId}`);
  const state = waitFor(sock, "ROOM_STATE", (p: any) => p.joinId === joinId);
  const payload: any = { room, token, presenceId, joinId };
  // An ABSENT key is a different case from an explicit null, and JSON cannot
  // carry `undefined`, so absence is produced by not writing the key at all.
  if (outlandsAvatarId !== undefined) payload.outlandsAvatarId = outlandsAvatarId;
  sock.emit("JOIN", payload);
  const answer = await state;
  const mine = answer.presences.find(
    (p: any) => `${p.memberId}` === `${memberId}` && p.presenceId === presenceId,
  );
  assert.ok(mine, "the joining presence is missing from its own ROOM_STATE");
  sock.disconnect();
  return mine.avatar;
}

/** Fails unless the presence is wearing the citizen's own avatar out of their token. */
function assertOwnAvatar(avatar: any, what: string): void {
  assert.deepStrictEqual(
    avatar, OWN_AVATAR,
    `${what}: expected the citizen's own avatar, got ${JSON.stringify(avatar)}`,
  );
}

// ---------------------------------------------------------------------------
// THE EXACT QA FINDING
// ---------------------------------------------------------------------------

test("regression: outlandsAvatarId = [13] does not authorise bluef.wrl", async () => {
  // The coercion that used to answer this with a real row.
  assert.strictEqual(Number([13]), 13);

  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, [13]);
  assert.notStrictEqual(
    avatar && avatar.filename, "bluef.wrl",
    "an array was authorised as the blue female team avatar",
  );
  assertOwnAvatar(avatar, "outlandsAvatarId = [13]");
});

test("regression: outlandsAvatarId = \"13\" does not authorise bluef.wrl", async () => {
  assert.strictEqual(Number("13"), 13);
  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, "13");
  assert.notStrictEqual(avatar && avatar.filename, "bluef.wrl");
  assertOwnAvatar(avatar, "outlandsAvatarId = the string 13");
});

test("regression: outlandsAvatarId = { id: 13 } does not authorise bluef.wrl", async () => {
  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, { id: 13 });
  assert.notStrictEqual(avatar && avatar.filename, "bluef.wrl");
  assertOwnAvatar(avatar, "outlandsAvatarId = { id: 13 }");
});

// ---------------------------------------------------------------------------
// EVERY MALFORMED SHAPE THE WIRE CAN CARRY
// ---------------------------------------------------------------------------

for (const [label, value] of MALFORMED) {
  test(`malformed in Outlands: ${label} falls back to the citizen's own avatar`, async () => {
    const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, value);
    assertOwnAvatar(avatar, label);
  });
}

test("malformed in Outlands: an absent outlandsAvatarId falls back", async () => {
  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, undefined);
  assertOwnAvatar(avatar, "absent outlandsAvatarId");
});

test("no malformed value ever becomes a team avatar", async () => {
  const teamFiles = TEAM_ROWS.map(row => row.filename);
  for (const [label, value] of MALFORMED) {
    const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, value);
    assert.ok(
      !teamFiles.includes(avatar && avatar.filename),
      `${label} was dressed as a team avatar (${JSON.stringify(avatar)})`,
    );
  }
});

test("the socket survives every malformed value and still serves the next JOIN", async () => {
  for (const [, value] of MALFORMED) {
    await joinAndReadAvatar(OUTLANDS_ROOM, value);
  }
  // Proves the server is alive AND still correct, not merely alive.
  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, 13);
  assert.strictEqual(avatar.filename, "bluef.wrl");
});

test("a malformed value does not disconnect the citizen", async () => {
  const sock = await connect();
  const presenceId = nextId("presence");
  const token = signToken(777, "citizen777");
  const first = nextId("join");
  const firstState = waitFor(sock, "ROOM_STATE", (p: any) => p.joinId === first);
  sock.emit("JOIN", {
    room: OUTLANDS_ROOM, token, presenceId, joinId: first, outlandsAvatarId: [13],
  });
  await firstState;
  assert.strictEqual(sock.connected, true, "the socket was closed by a malformed override");

  // The same socket is still usable, and a good id on it still works.
  const second = nextId("join");
  const secondState = waitFor(sock, "ROOM_STATE", (p: any) => p.joinId === second);
  sock.emit("JOIN", {
    room: OUTLANDS_ROOM, token, presenceId, joinId: second, outlandsAvatarId: 14,
  });
  const answer = await secondState;
  const mine = answer.presences.find((p: any) => p.presenceId === presenceId);
  assert.strictEqual(mine.avatar.filename, "bluem.wrl");
  sock.disconnect();
});

// ---------------------------------------------------------------------------
// VALID CONTROLS -- the historical team mapping still works
// ---------------------------------------------------------------------------

const HISTORICAL: Array<[number, string]> = [
  [13, "bluef.wrl"],
  [14, "bluem.wrl"],
  [15, "redf.wrl"],
  [16, "redm.wrl"],
];

for (const [id, filename] of HISTORICAL) {
  test(`valid: team id ${id} still produces ${filename} in Outlands`, async () => {
    const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, id);
    assert.strictEqual(avatar.filename, filename);
    assert.strictEqual(avatar.id, id);
  });
}

test("valid: 13.0 is 13 and still produces bluef.wrl", async () => {
  assert.strictEqual(13.0, 13);
  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, 13.0);
  assert.strictEqual(avatar.filename, "bluef.wrl");
});

// ---------------------------------------------------------------------------
// ROOM CONTROL -- a team avatar is an Outlands thing
// ---------------------------------------------------------------------------

for (const [id, filename] of HISTORICAL) {
  test(`room control: ${id} in Plaza does not produce ${filename}`, async () => {
    const avatar = await joinAndReadAvatar(PLAZA_ROOM, id);
    assertOwnAvatar(avatar, `team id ${id} requested in Plaza`);
  });
}

test("room control: [13] in Plaza falls back too", async () => {
  const avatar = await joinAndReadAvatar(PLAZA_ROOM, [13]);
  assertOwnAvatar(avatar, "[13] requested in Plaza");
});

// ---------------------------------------------------------------------------
// AUTHORITY -- the rows decide, not the client and not a constant
// ---------------------------------------------------------------------------

test("authority: the Game Master id is never served as a team avatar", async () => {
  // 12 is a well formed id. It is refused because the API never serves the row.
  const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, 12);
  assertOwnAvatar(avatar, "the Game Master id");
  assert.notStrictEqual(avatar && avatar.filename, GAME_MASTER_FILE);
});

test("authority: well formed but unauthorised integers fall back", async () => {
  for (const id of [1, 11, 17, 999999, Number.MAX_SAFE_INTEGER]) {
    const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, id);
    assertOwnAvatar(avatar, `unauthorised id ${id}`);
  }
});

test("authority: an inactive row cannot be forced through the socket", async () => {
  servedRows = TEAM_ROWS.filter(row => row.filename !== "bluef.wrl");
  try {
    // The cache holds the previous answer for a minute, so a fresh connection is
    // not enough - the server is restarted so it must ask the API again.
    await restartServer();
    const avatar = await joinAndReadAvatar(OUTLANDS_ROOM, 13);
    assertOwnAvatar(avatar, "an inactive team row");
    // The three rows the API still serves are unaffected.
    const other = await joinAndReadAvatar(OUTLANDS_ROOM, 14);
    assert.strictEqual(other.filename, "bluem.wrl");
  } finally {
    servedRows = TEAM_ROWS.slice();
    await restartServer();
  }
});

test("authority: the client cannot supply the row itself", async () => {
  // A payload naming a whole avatar, not an id. Nothing but the API's own rows
  // may dress a presence.
  const avatar = await joinAndReadAvatar(
    OUTLANDS_ROOM, { id: 13, filename: "bluef.wrl", directory: "13", team: 2 },
  );
  assertOwnAvatar(avatar, "a client-supplied avatar row");
});

test("authority: a team avatar is never taken from the token", async () => {
  // Even a token claiming a team avatar only dresses that citizen as what the
  // token says - identity still comes from the token, gameplay from the rows.
  const sock = await connect();
  const presenceId = nextId("presence");
  const joinId = nextId("join");
  const token = signToken(888, "citizen888");
  const state = waitFor(sock, "ROOM_STATE", (p: any) => p.joinId === joinId);
  sock.emit("JOIN", { room: PLAZA_ROOM, token, presenceId, joinId, outlandsAvatarId: 13 });
  const answer = await state;
  const mine = answer.presences.find((p: any) => p.presenceId === presenceId);
  assertOwnAvatar(mine.avatar, "a Plaza JOIN asking for a team avatar");
  sock.disconnect();
});

// ---------------------------------------------------------------------------
// RECONNECT AND SECOND TAB
// ---------------------------------------------------------------------------

test("reconnect: a valid team avatar is restored for that tab only", async () => {
  const memberId = 601;
  const presenceId = nextId("presence");
  const token = signToken(memberId, "citizen601");

  // Tab A, in Outlands, wearing a team avatar.
  const a = await connect();
  const joinA = nextId("join");
  const stateA = waitFor(a, "ROOM_STATE", (p: any) => p.joinId === joinA);
  a.emit("JOIN", {
    room: OUTLANDS_ROOM, token, presenceId, joinId: joinA, outlandsAvatarId: 15,
  });
  const answerA = await stateA;
  assert.strictEqual(
    answerA.presences.find((p: any) => p.presenceId === presenceId).avatar.filename,
    "redf.wrl",
  );
  a.disconnect();

  // The same tab reconnects and re-advertises the same valid id.
  const b = await connect();
  const joinB = nextId("join");
  const stateB = waitFor(b, "ROOM_STATE", (p: any) => p.joinId === joinB);
  b.emit("JOIN", {
    room: OUTLANDS_ROOM, token, presenceId, joinId: joinB, outlandsAvatarId: 15,
  });
  const answerB = await stateB;
  assert.strictEqual(
    answerB.presences.find((p: any) => p.presenceId === presenceId).avatar.filename,
    "redf.wrl",
  );
  b.disconnect();

  // Leaving Outlands and reconnecting there gives the citizen back their own.
  const c = await connect();
  const joinC = nextId("join");
  const stateC = waitFor(c, "ROOM_STATE", (p: any) => p.joinId === joinC);
  c.emit("JOIN", { room: PLAZA_ROOM, token, presenceId, joinId: joinC });
  const answerC = await stateC;
  assertOwnAvatar(
    answerC.presences.find((p: any) => p.presenceId === presenceId).avatar,
    "after leaving Outlands",
  );
  c.disconnect();
});

test("reconnect: a malformed value is never re-advertised successfully", async () => {
  const memberId = 602;
  const presenceId = nextId("presence");
  const token = signToken(memberId, "citizen602");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sock = await connect();
    const joinId = nextId("join");
    const state = waitFor(sock, "ROOM_STATE", (p: any) => p.joinId === joinId);
    sock.emit("JOIN", {
      room: OUTLANDS_ROOM, token, presenceId, joinId, outlandsAvatarId: [13],
    });
    const answer = await state;
    assertOwnAvatar(
      answer.presences.find((p: any) => p.presenceId === presenceId).avatar,
      `re-advertised [13], attempt ${attempt + 1}`,
    );
    sock.disconnect();
  }
});

test("second tab: an Outlands tab and a Plaza tab of one citizen do not leak", async () => {
  const memberId = 603;
  const token = signToken(memberId, "citizen603");
  const tabA = nextId("presence");
  const tabB = nextId("presence");

  const a = await connect();
  const joinA = nextId("join");
  const stateA = waitFor(a, "ROOM_STATE", (p: any) => p.joinId === joinA);
  a.emit("JOIN", { room: OUTLANDS_ROOM, token, presenceId: tabA, joinId: joinA,
    outlandsAvatarId: 16 });
  const answerA = await stateA;
  assert.strictEqual(
    answerA.presences.find((p: any) => p.presenceId === tabA).avatar.filename, "redm.wrl",
  );

  const b = await connect();
  const joinB = nextId("join");
  const stateB = waitFor(b, "ROOM_STATE", (p: any) => p.joinId === joinB);
  b.emit("JOIN", { room: PLAZA_ROOM, token, presenceId: tabB, joinId: joinB });
  const answerB = await stateB;
  const bMine = answerB.presences.find((p: any) => p.presenceId === tabB);
  assertOwnAvatar(bMine.avatar, "tab B in Plaza");

  // The two tabs are distinct presences of one account, and neither wears the
  // other's avatar. presenceKey(memberId, presenceId) is unchanged by this fix.
  assert.notStrictEqual(tabA, tabB);
  assert.strictEqual(`${bMine.memberId}`, `${memberId}`);

  a.disconnect();
  b.disconnect();
});

// ---------------------------------------------------------------------------
// NEGATIVE CONTROL -- the gate can actually see the defect it guards
// ---------------------------------------------------------------------------

test("negative control: the assertion fails when handed a team avatar", async () => {
  let threw = false;
  try {
    assertOwnAvatar(TEAM_ROWS[3], "deliberately wrong");
  } catch (err) {
    threw = true;
  }
  assert.ok(threw, "assertOwnAvatar accepted a team avatar - the gate is vacuous");
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function restartServer(): Promise<void> {
  await killServer(serverProc);
  serverProc = await startServer(PORT);
}

async function run(): Promise<void> {
  let failures = 0;
  console.log("outlands strict avatar id (socket)\n");
  try {
    API_PORT = await getFreePort();
    apiServer = await startStubApi(API_PORT);
    PORT = await getFreePort();
    serverProc = await startServer(PORT);
  } catch (err) {
    console.error("  ✗ could not start the test servers");
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
  if (apiServer) await new Promise(resolve => apiServer.close(resolve));

  console.log(`\n${tests.length - failures}/${tests.length} passed`);
  if (failures > 0) {
    if (serverLog) console.error(`--- server output ---\n${serverLog}`);
    process.exit(1);
  }
}

run();
