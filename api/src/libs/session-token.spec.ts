import jwt from 'jsonwebtoken';

import {
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_TOKEN_ALGORITHM,
  SESSION_TOKEN_TTL_ENV,
  getSessionTtlSeconds,
  signSessionToken,
  verifySessionToken,
} from './session-token';

const SECRET = 'session-token-spec-secret';
const OTHER_SECRET = 'a-different-secret-entirely';
const CLAIMS = { id: 7, username: 'citizen', avatar: { id: 3 }, admin: 0 };

/**
 * The session contract, asserted as rules rather than as one happy path.
 *
 * The rule that earns most of this file is the LEGACY one. Adding `expiresIn` to the signing
 * side fixes nothing by itself: every token already in circulation was minted without an
 * `exp` claim, and jsonwebtoken reads a missing `exp` as "valid forever". So "a token with
 * no exp is refused" is asserted directly, against a token built the way the old code built
 * them, and not inferred from the new signer's output.
 */
describe('session-token', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[SESSION_TOKEN_TTL_ENV];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('the algorithm', () => {
    it('signs with HS256, which is what every token in circulation already carries', () => {
      expect(SESSION_TOKEN_ALGORITHM).toBe('HS256');
      const header = JSON.parse(
        Buffer.from(signSessionToken(CLAIMS, SECRET).split('.')[0], 'base64').toString(),
      );
      expect(header.alg).toBe('HS256');
    });

    it('refuses a token signed with an algorithm it did not choose', () => {
      const hs512 = jwt.sign(CLAIMS, SECRET, { algorithm: 'HS512', expiresIn: 3600 });
      expect(() => verifySessionToken(hs512, SECRET)).toThrow();
    });

    it('refuses an unsigned "none" token', () => {
      // Built by hand: jsonwebtoken will not sign `none` with a secret present, which is
      // exactly the attack shape -- a token that nominates its own, absent, examiner.
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
        .toString('base64').replace(/=/g, '');
      const body = Buffer.from(JSON.stringify({ ...CLAIMS, exp: 99999999999 }))
        .toString('base64').replace(/=/g, '');
      expect(() => verifySessionToken(`${header}.${body}.`, SECRET)).toThrow();
    });
  });

  describe('the expiry claim', () => {
    it('puts an exp on every token it mints', () => {
      const claims = jwt.decode(signSessionToken(CLAIMS, SECRET)) as jwt.JwtPayload;
      expect(typeof claims.exp).toBe('number');
      expect(claims.exp - claims.iat).toBe(DEFAULT_SESSION_TTL_SECONDS);
    });

    it('accepts a token it minted itself', () => {
      const claims = verifySessionToken(signSessionToken(CLAIMS, SECRET), SECRET);
      expect(claims.id).toBe(7);
      expect(claims.username).toBe('citizen');
    });

    it('REFUSES a legacy token that carries no exp claim at all', () => {
      // Exactly how the old code minted: sign, secret, no options.
      const legacy = jwt.sign(CLAIMS, SECRET);
      expect(jwt.decode(legacy)).not.toHaveProperty('exp');
      expect(() => verifySessionToken(legacy, SECRET)).toThrow(/no expiry claim/);
    });

    it('refuses an expired token', () => {
      const expired = jwt.sign(CLAIMS, SECRET, { algorithm: 'HS256', expiresIn: -60 });
      expect(() => verifySessionToken(expired, SECRET)).toThrow(jwt.TokenExpiredError);
    });
  });

  describe('the secret', () => {
    it('refuses a token signed with a different secret', () => {
      const foreign = signSessionToken(CLAIMS, OTHER_SECRET);
      expect(() => verifySessionToken(foreign, SECRET)).toThrow(jwt.JsonWebTokenError);
    });

    it('refuses to sign or verify when no secret is configured', () => {
      expect(() => signSessionToken(CLAIMS, undefined as unknown as string)).toThrow();
      expect(() => verifySessionToken('anything', '')).toThrow();
    });
  });

  describe('malformed input', () => {
    it.each([
      ['empty string', ''],
      ['not a jwt at all', 'hello'],
      ['two segments', 'aaa.bbb'],
      ['garbage segments', 'aaa.bbb.ccc'],
    ])('refuses %s', (_label, token) => {
      expect(() => verifySessionToken(token, SECRET)).toThrow();
    });
  });

  describe('the configured lifetime', () => {
    it('is 30 days when the deployment says nothing', () => {
      expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);
      expect(DEFAULT_SESSION_TTL_SECONDS).toBe(2592000);
    });

    it('honours a positive whole number of seconds', () => {
      process.env[SESSION_TOKEN_TTL_ENV] = '3600';
      expect(getSessionTtlSeconds()).toBe(3600);
      const claims = jwt.decode(signSessionToken(CLAIMS, SECRET)) as jwt.JwtPayload;
      expect(claims.exp - claims.iat).toBe(3600);
    });

    it.each([
      ['blank', '   '],
      ['zero', '0'],
      ['negative', '-1'],
      ['fractional', '1.5'],
      ['not a number', 'forever'],
    ])('falls back to the default for a %s value rather than half-honouring it',
      (_label, value) => {
        process.env[SESSION_TOKEN_TTL_ENV] = value;
        expect(getSessionTtlSeconds()).toBe(DEFAULT_SESSION_TTL_SECONDS);
      });
  });
});
