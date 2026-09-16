import jwt, { Algorithm, JwtPayload } from 'jsonwebtoken';

/**
 * The one place CTR decides what a session token is.
 *
 * Both halves of the city read this contract: the API through these functions, and the
 * socket server through `spa/session-token.js`, which is a hand-kept mirror because the two
 * servers are separate npm packages and cannot share a module. The rules below are the
 * whole contract -- an algorithm, an expiry that must be there, and nothing else. Change one
 * copy and change the other, the same arrangement `isClientId` already lives under.
 */

/**
 * The signing algorithm, pinned on BOTH sign and verify.
 *
 * HS256 is what CTR has always minted: `jwt.sign` with a string secret and no `algorithm`
 * option produced an `HS256` header, and every token in circulation carries it. So this is
 * the existing algorithm written down, not a new choice.
 *
 * Pinning it on VERIFY is the part that matters. A verify call with no `algorithms` list
 * lets the token's own header pick the algorithm, which means untrusted input choosing how
 * it will be checked. The list is exactly one entry on purpose: no `none`, and no broad
 * family that would let a token nominate a weaker member of it.
 */
export const SESSION_TOKEN_ALGORITHM: Algorithm = 'HS256';

/** Environment variable that sets how long a new session token stays valid, in seconds. */
export const SESSION_TOKEN_TTL_ENV = 'SESSION_TOKEN_TTL_SECONDS';

/**
 * How long a new session lasts when the deployment does not say otherwise: 30 days.
 *
 * CTR had no session-lifetime policy at all before this -- tokens were minted with no `exp`
 * and were therefore valid forever. There is no earlier value to preserve, so the default is
 * chosen to be the smallest change to how the city FEELS while still being finite: a citizen
 * who visits at least once a month is never asked to log in again, which is what the
 * localStorage-backed "stay signed in" behaviour already promised them. A deployment that
 * wants a shorter leash sets SESSION_TOKEN_TTL_SECONDS.
 */
export const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * The configured session lifetime in seconds.
 *
 * Read per call rather than frozen at import, for the same reason `site-config.ts` gives:
 * the value is consulted per login, so a test never has to defeat a constant that was
 * captured before it could set the variable. Anything that is not a positive whole number of
 * seconds -- absent, blank, zero, negative, fractional, or not a number at all -- falls back
 * to the documented default rather than being half-honoured.
 */
export function getSessionTtlSeconds(): number {
  const raw = (process.env[SESSION_TOKEN_TTL_ENV] || '').trim();
  if (!raw.length) return DEFAULT_SESSION_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_SESSION_TTL_SECONDS;
  return parsed;
}

/**
 * Mints a session token for the given claims.
 *
 * @param claims the session payload -- identity only, never a secret
 * @param secret the shared JWT secret
 * @returns the signed token, always carrying an `exp` claim
 */
export function signSessionToken(claims: Record<string, unknown>, secret: string): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT secret is not configured.');
  }
  return jwt.sign(claims, secret, {
    algorithm: SESSION_TOKEN_ALGORITHM,
    expiresIn: getSessionTtlSeconds(),
  });
}

/**
 * Verifies a session token and returns its claims, or throws.
 *
 * Adding `expiresIn` to the signing side is only half of the fix, and on its own it would
 * have fixed nothing: every token minted before this release has no `exp` claim at all, and
 * `jwt.verify` treats a missing `exp` as "this one never expires" rather than as a failure.
 * Those are exactly the permanent sessions being retired, so the expiry claim is REQUIRED
 * here, not merely honoured when present. A pre-release token is refused from the moment
 * this ships.
 *
 * That is deliberate and it costs every logged-in citizen one login. It is the only way the
 * old permanent tokens stop being accepted, so it is not softened for compatibility.
 *
 * @param token the raw token as the client sent it
 * @param secret the shared JWT secret
 * @returns the verified claims
 */
export function verifySessionToken(token: string, secret: string): JwtPayload {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT secret is not configured.');
  }
  const claims = jwt.verify(token, secret, {
    algorithms: [SESSION_TOKEN_ALGORITHM],
  });
  // A string payload is a token that was never one of ours: CTR always signs an object.
  if (typeof claims !== 'object' || claims === null) {
    throw new jwt.JsonWebTokenError('session token payload is not an object');
  }
  if (typeof (claims as JwtPayload).exp !== 'number') {
    throw new jwt.JsonWebTokenError('session token has no expiry claim');
  }
  return claims as JwtPayload;
}
