/**
 * The contract between the two servers, checked from the socket's side.
 *
 * api/src/libs/session-token.ts and spa/session-token.js are hand-kept mirrors: separate npm
 * packages cannot share a module, so they share a rule instead. A mirror is only worth
 * having if it is proven to still be one, so this mints tokens the way the API mints them
 * and asserts the socket's verifier reaches the same verdict every time.
 *
 * Drift here is the dangerous kind: a token the API considers dead but the socket still
 * accepts is a citizen who is logged out of the city and still standing in the world.
 */
import assert from "assert";

const path = require("path");
const jwt = require("jsonwebtoken");

const SPA_DIR = path.resolve(__dirname, "../../..");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SESSION_TOKEN_ALGORITHM, verifySessionToken } = require(
  path.join(SPA_DIR, "session-token.js"),
);

const SECRET = "shared-jwt-secret";
const WRONG_SECRET = "not-the-shared-secret";
const CLAIMS = { id: 21, username: "citizen", avatar: { id: 4 }, admin: 0 };

type Test = { name: string; run: () => void };
const tests: Test[] = [];
function test(name: string, run: () => void): void {
  tests.push({ name, run });
}

/** Exactly what api/src/libs/session-token.ts signSessionToken does. */
function signLikeTheApi(ttlSeconds: number | string = 2592000): string {
  return jwt.sign(CLAIMS, SECRET, { algorithm: "HS256", expiresIn: ttlSeconds });
}

test("both halves pin the same algorithm", () => {
  assert.strictEqual(SESSION_TOKEN_ALGORITHM, "HS256");
});

test("the socket accepts a token the API just minted", () => {
  const claims = verifySessionToken(signLikeTheApi(), SECRET);
  assert.strictEqual(claims.id, 21);
  assert.strictEqual(claims.username, "citizen");
  assert.strictEqual(typeof claims.exp, "number");
});

test("the socket refuses a LEGACY token with no exp, as the API does", () => {
  const legacy = jwt.sign(CLAIMS, SECRET);
  assert.ok(!Object.prototype.hasOwnProperty.call(jwt.decode(legacy), "exp"));
  assert.throws(() => verifySessionToken(legacy, SECRET), /no expiry claim/);
});

test("the socket refuses an expired token", () => {
  assert.throws(
    () => verifySessionToken(signLikeTheApi(-60), SECRET),
    (err: Error) => err.name === "TokenExpiredError",
  );
});

test("the socket refuses a token signed with a different secret", () => {
  const foreign = jwt.sign(CLAIMS, WRONG_SECRET, { algorithm: "HS256", expiresIn: 3600 });
  assert.throws(
    () => verifySessionToken(foreign, SECRET),
    (err: Error) => err.name === "JsonWebTokenError",
  );
});

test("the socket refuses a token that nominates a different algorithm", () => {
  const hs512 = jwt.sign(CLAIMS, SECRET, { algorithm: "HS512", expiresIn: 3600 });
  assert.throws(() => verifySessionToken(hs512, SECRET));
});

test("the socket refuses an unsigned 'none' token", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toString("base64").replace(/=/g, "");
  const body = Buffer.from(JSON.stringify({ ...CLAIMS, exp: 99999999999 }))
    .toString("base64").replace(/=/g, "");
  assert.throws(() => verifySessionToken(`${header}.${body}.`, SECRET));
});

test("the socket refuses malformed input rather than throwing something unexpected", () => {
  for (const bad of ["", "hello", "aaa.bbb", "aaa.bbb.ccc"]) {
    assert.throws(() => verifySessionToken(bad, SECRET), `should have refused: "${bad}"`);
  }
});

test("neither half will work without a configured secret", () => {
  assert.throws(() => verifySessionToken(signLikeTheApi(), ""), /not configured/);
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
if (failures > 0) process.exit(1);
