import { NextFunction, Request, Response } from 'express';

/**
 * The one gate that makes a ban end a session that is already in progress.
 *
 * The defect this closes: a session token was checked exactly once, at the moment it was
 * handed out. Every later request re-read the SAME token and asked only "is the signature
 * good", so a citizen banned five minutes after logging in kept every authenticated route
 * for as long as they held the string -- which, with no expiry claim, was forever.
 *
 * It is written as ONE piece of Express middleware rather than as a check inside
 * `decryptSession` for a plain reason: `decryptSession` is synchronous and is called from
 * 118 places across 16 controllers, and current standing is a database fact, so asking the
 * question there would mean making all 118 call sites asynchronous. Middleware is already
 * asynchronous, already runs before every route, and needs no controller to change. One
 * place to read, one place to get right.
 *
 * What it is NOT: it does not decide who may ban whom, it does not change any role's
 * authority, and it never writes. It reads current standing and refuses a request.
 */

/** The shape this gate needs from MemberService. Narrow on purpose, so tests need no DI. */
export interface SessionStandingReader {
  decodeMemberToken(token: string): { id?: unknown } | null;
  isSessionRevoked(memberId: number): Promise<boolean>;
}

/**
 * Routes a citizen with a revoked session must still be able to reach.
 *
 * Small, exact, and not a prefix match. These two are how the browser LEARNS it is banned:
 * the router guard calls `/api/member/session` on every navigation and renders the ban
 * notice from the `banned` flag it answers with, and `/api/member/is_banned` is the same
 * question asked directly. Refusing them would replace "you are banned until Tuesday" with a
 * blank failure, which tells the citizen less and tells an attacker nothing either way.
 *
 * Neither route hands out anything: `is_banned` is a read, and `session` is made to stop
 * re-minting a token for a banned caller in this same change, so passing them through does
 * not leave a way to keep a session alive.
 */
const REVOKED_SESSION_READABLE_PATHS: readonly string[] = [
  '/api/member/session',
  '/api/member/is_banned',
];

/**
 * Builds the session-revocation middleware.
 *
 * Deliberately quiet about WHY. A banned citizen learns the reason and the end date from
 * `/api/member/is_banned`, which is the route built to tell them; an authorization failure
 * is not the place to publish moderation notes, and a 403 that varies its wording would leak
 * ban state to anyone holding a stray token. Every refusal here is the same sentence.
 *
 * @param members the standing reader -- MemberService in the running API
 * @returns Express middleware to mount ahead of every `/api` router
 */
export function sessionRevocationGuard(members: SessionStandingReader) {
  return async function guard(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const { apitoken } = request.headers;

    // No token at all: a visitor, or a login attempt. Nothing to revoke, and refusing here
    // would break every public route and the login itself.
    if (!apitoken || typeof apitoken !== 'string') {
      next();
      return;
    }

    if (REVOKED_SESSION_READABLE_PATHS.includes(request.path)) {
      next();
      return;
    }

    let session: { id?: unknown } | null = null;
    try {
      session = members.decodeMemberToken(apitoken);
    } catch (error) {
      // An expired, unsigned, wrongly-signed, legacy no-expiry or simply malformed token is
      // already refused by `decodeMemberToken` inside whichever controller handles this
      // route, with that route's own wording. Answering here as well would change the reply
      // a logged-out browser has always received, for no security gain: the request is
      // refused either way. Standing is a question about a member, and a token that does not
      // verify names no member.
      next();
      return;
    }

    if (!session || typeof session.id !== 'number') {
      next();
      return;
    }

    let revoked: boolean;
    try {
      revoked = await members.isSessionRevoked(session.id);
    } catch (error) {
      // Fails CLOSED. This gate exists to stop a banned citizen, so a database it cannot
      // read is not a reason to let one through. A citizen in good standing sees the same
      // failure the rest of the API is about to give them anyway with the database down.
      console.error('Session standing could not be read; refusing the request:', error);
      response.status(403).json({ error: 'Forbidden.' });
      return;
    }

    if (revoked) {
      response.status(403).json({ error: 'Forbidden.' });
      return;
    }

    next();
  };
}
