const jwt = require("jsonwebtoken");

/*
 * The socket server's half of the session-token contract.
 *
 * A hand-kept mirror of api/src/libs/session-token.ts. The API and the socket server are
 * separate npm packages and cannot share a module, so they share a name, a rule and a test
 * table instead - the same arrangement isClientId already lives under. Change one and change
 * the other.
 *
 * Only the VERIFY half lives here. The socket server has never minted a token and must not
 * start: a session is issued by the API, at login, against the database. Signing is
 * therefore absent on purpose, not missing.
 */

/*
 * The signing algorithm, pinned on verify.
 *
 * Matches SESSION_TOKEN_ALGORITHM in the API. A verify call with no `algorithms` list lets
 * the token's own header choose how it will be checked, which is untrusted input picking its
 * own examiner. One entry, no `none`, no family.
 */
const SESSION_TOKEN_ALGORITHM = "HS256";

/*
 * Verifies a session token and returns its claims, or throws.
 *
 * The expiry claim is REQUIRED, not merely honoured when present. Every token minted before
 * this release carries no `exp` at all, and jwt.verify reads a missing `exp` as "never
 * expires" - which is exactly the permanent session being retired. Refusing it here is what
 * retires it, and it is not softened for compatibility.
 */
function verifySessionToken(token, secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("JWT secret is not configured.");
  }
  const claims = jwt.verify(token, secret, {
    algorithms: [SESSION_TOKEN_ALGORITHM],
  });
  if (typeof claims !== "object" || claims === null) {
    throw new jwt.JsonWebTokenError("session token payload is not an object");
  }
  if (typeof claims.exp !== "number") {
    throw new jwt.JsonWebTokenError("session token has no expiry claim");
  }
  return claims;
}

module.exports = { SESSION_TOKEN_ALGORITHM, verifySessionToken };
