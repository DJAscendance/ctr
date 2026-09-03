import { Request, Response } from 'express';
import { Container } from 'typedi';

import { MemberService, OutlandsMatchService } from '../services';
import { SessionInfo } from 'session-info.interface';

/**
 * The one refusal a failed scheduled-match entry ever produces.
 *
 * Historically a wrong password loaded `boot.wrl`, whose only statement is a
 * `loadURL` back to `place?plc=ne_game` - the player simply found themselves at
 * the entrance again, with no explanation. Nothing told them whether the password
 * was close, or which team it would have granted. This message keeps that: one
 * wording for a wrong password, for a blank password and for a place with no
 * match scheduled at all.
 */
const MATCH_REFUSED = 'That match password was not accepted.';

/**
 * OUTLANDS-2B. The HTTP boundary for scheduled Outlands matches.
 *
 * Three endpoints, and each of them refuses to say anything about a stored
 * password beyond whether one exists:
 *
 *   POST /api/outlands/match/enter      validate a typed password, get a team
 *   GET  /api/outlands/match/passwords  is a match configured? (Chief only)
 *   PUT  /api/outlands/match/passwords  replace or clear them  (Chief only)
 *
 * No handler here logs a password, echoes one back, or puts one in an error.
 */
class OutlandsController {
  constructor(
    private outlandsMatchService: OutlandsMatchService,
    private memberService: MemberService,
  ) {}

  /**
   * Validates a scheduled-match password and returns the team it grants.
   *
   * This is the trusted boundary the whole lane rests on. The browser never sees
   * a stored password or hash, and never decides a team: it posts what the member
   * typed and is told `blue`, `red`, or nothing at all.
   */
  public async enterMatch(request: Request, response: Response): Promise<void> {
    const session = this.authenticate(request, response);
    if (!session) return;

    const password = request.body?.password;
    if (typeof password !== 'string' || password === '') {
      // A blank password is free play, and free play never reaches this route.
      // Refused with the same message as a wrong one, so the shape of the
      // request cannot be used to probe the endpoint.
      response.status(403).json({ error: MATCH_REFUSED });
      return;
    }

    try {
      const placeId = await this.outlandsMatchService.findOutlandsPlaceId();
      if (placeId === null) {
        response.status(404).json({ error: 'Outlands not found.' });
        return;
      }

      const team = await this.outlandsMatchService.resolveTeam(placeId, password);
      if (team === null) {
        response.status(403).json({ error: MATCH_REFUSED });
        return;
      }

      // The team, and nothing else. The caller already holds the password it
      // typed, so the avatar identity is composed in the browser from this team
      // and the sex it picked; the password is not sent back down.
      response.status(200).json({ team });
    } catch (error) {
      // Deliberately not `console.error(error)`: a thrown bcrypt or knex error
      // can carry the compared value. Only the fact of the failure is recorded.
      console.error('Outlands match entry failed');
      response.status(500).json({ error: 'Could not check the match password.' });
    }
  }

  /**
   * Reports whether each team's password is configured. Outlands Chief only.
   * Returns booleans; it can never return a password or a hash.
   */
  public async getMatchPasswordStatus(request: Request, response: Response): Promise<void> {
    const session = this.authenticate(request, response);
    if (!session) return;

    try {
      const placeId = await this.outlandsMatchService.findOutlandsPlaceId();
      if (placeId === null) {
        response.status(404).json({ error: 'Outlands not found.' });
        return;
      }

      const allowed = await this.outlandsMatchService
        .canAdministerMatch(session.id, placeId);
      if (!allowed) {
        response.status(403).json({ error: 'Not allowed.' });
        return;
      }

      const status = await this.outlandsMatchService.getStatus(placeId);
      response.status(200).json(status);
    } catch (error) {
      console.error('Outlands match password status failed');
      response.status(500).json({ error: 'Could not read the match settings.' });
    }
  }

  /**
   * Replaces or clears the Blue and Red match passwords. Outlands Chief only.
   *
   * A team left out of the body keeps what it has; a team sent as null or "" is
   * cleared, which stands that side's scheduled match down. The response is the
   * same booleans the status endpoint returns.
   */
  public async updateMatchPasswords(request: Request, response: Response): Promise<void> {
    const session = this.authenticate(request, response);
    if (!session) return;

    const { blue, red } = request.body ?? {};
    if (!this.isSettableValue(blue) || !this.isSettableValue(red)) {
      response.status(400).json({ error: 'A match password must be text.' });
      return;
    }

    try {
      const placeId = await this.outlandsMatchService.findOutlandsPlaceId();
      if (placeId === null) {
        response.status(404).json({ error: 'Outlands not found.' });
        return;
      }

      const allowed = await this.outlandsMatchService
        .canAdministerMatch(session.id, placeId);
      if (!allowed) {
        response.status(403).json({ error: 'Not allowed.' });
        return;
      }

      const status = await this.outlandsMatchService
        .setPasswords(placeId, session.id, { blue, red });
      response.status(200).json(status);
    } catch (error) {
      console.error('Outlands match password update failed');
      response.status(500).json({ error: 'Could not save the match settings.' });
    }
  }

  /**
   * Resolves the session, answering 401 itself when there is none.
   * @returns the session, or null once a 401 has already been sent
   */
  private authenticate(request: Request, response: Response): SessionInfo | null {
    const { apitoken } = request.headers;
    if (!apitoken || typeof apitoken !== 'string') {
      response.status(401).json({ error: 'Authentication required.' });
      return null;
    }
    try {
      const session = this.memberService.decodeMemberToken(apitoken);
      if (!session) {
        response.status(401).json({ error: 'Invalid or expired token.' });
        return null;
      }
      return session;
    } catch (error) {
      response.status(401).json({ error: 'Invalid or expired token.' });
      return null;
    }
  }

  /** A settable password is absent, cleared, or a string of a sane length. */
  private isSettableValue(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    return typeof value === 'string' && value.length <= 128;
  }
}

const outlandsMatchService = Container.get(OutlandsMatchService);
const memberService = Container.get(MemberService);
export const outlandsController = new OutlandsController(
  outlandsMatchService, memberService);
