import bcrypt from 'bcrypt';
import { Service } from 'typedi';

import {
  MatchPasswordHashes,
  OutlandsMatchRepository,
  PlaceRepository,
  RoleAssignmentRepository,
} from '../../repositories';

/** The two teams a scheduled-match password can grant. */
export type MatchTeam = 'blue' | 'red';

/** What a place's match configuration looks like from outside. Never a value. */
export interface MatchPasswordStatus {
  /** True when a Blue Team (historical `PASS1`) password is configured. */
  blueSet: boolean;
  /** True when a Red Team (historical `PASS2`) password is configured. */
  redSet: boolean;
}

/** A request to replace a place's match passwords. */
export interface MatchPasswordUpdate {
  /** The new Blue password, or null/'' to clear it. */
  blue?: string | null;
  /** The new Red password, or null/'' to clear it. */
  red?: string | null;
}

/**
 * The CTR place slug of Outlands, from `db/seed/02-places.seed.ts`. Match mode
 * belongs to this one place; there is no generic "match password" feature here.
 */
export const OUTLANDS_SLUG = 'outlands';

/**
 * The role that owns match administration.
 *
 * Ryan's modern policy makes the Outlands Chief the primary Outlands authority,
 * and match administration is the only power OUTLANDS-2B gives it. Historically
 * the SET PASSWORDS form was reachable two ways - `#ifdef isAdmin`, or by already
 * holding the Red password - and the second of those is a rotation-by-possession
 * rule that has no safe modern equivalent, so it is not reproduced.
 */
export const OUTLANDS_MATCH_ADMIN_ROLE = 'Outlands Chief';

/** The city-wide administrator, matching the historical `isAdmin` branch. */
export const GLOBAL_ADMIN_ROLE = 'Admin';

/** bcrypt cost, matching `MemberService.SALT_ROUNDS`. */
const SALT_ROUNDS = 10;

/**
 * A real bcrypt hash of a value nobody holds, used only to burn the same time an
 * unsuccessful comparison would. Without it, an unset team password would be
 * refused immediately and a set one slowly, which tells an attacker whether a
 * match is scheduled at all.
 */
const DUMMY_HASH = '$2b$10$IuQjgOx/NEsCny/XtjTXb.iIxulw3zDDBDgVYM0eGEOY6n5C.pawa';

/** Longest accepted match password. The historical box was 10 wide, not capped. */
const MAX_PASSWORD_LENGTH = 128;

/**
 * OUTLANDS-2B. The scheduled-match authority: who may set the passwords, and
 * which team a typed password grants.
 *
 * THE HISTORICAL CONTRACT, from `ne_game/enter3Dpass.tmpl`:
 *
 *     T_pass == PASS1  ->  Blue Team
 *     T_pass == PASS2  ->  Red  Team
 *     neither          ->  boot.wrl, back to the entrance
 *
 * so the password chooses the COLOUR and the avatar tile only chooses the sex.
 * That inversion of the free-play rule is the whole point of match mode and is
 * decided here, on the server, never in the browser.
 *
 * WHAT NEVER LEAVES THIS SERVICE. The stored hashes, and the typed password. The
 * only things it returns are a team name, a boolean and a refusal. There is no
 * read-back path for a match password anywhere in CTR.
 */
@Service()
export class OutlandsMatchService {
  constructor(
    private outlandsMatchRepository: OutlandsMatchRepository,
    private placeRepository: PlaceRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
  ) {}

  /**
   * Finds the Outlands place id.
   * @returns the place id, or null when the place is missing from the database
   */
  public async findOutlandsPlaceId(): Promise<number | null> {
    const place = await this.placeRepository.findBySlug(OUTLANDS_SLUG);
    if (!place || !place.id) {
      return null;
    }
    return place.id;
  }

  /**
   * Resolves which team a typed scheduled-match password grants.
   *
   * BOTH hashes are always compared, even once one has matched, so the work done
   * does not depend on which password was typed or on whether either is set. The
   * caller gets a team or nothing; it is never told which comparison failed, so a
   * refusal cannot be used to learn that a password was "almost" right.
   * @param placeId id of the place the match belongs to
   * @param password the password the member typed
   * @returns `'blue'`, `'red'`, or null when it matches neither
   */
  public async resolveTeam(placeId: number, password: string): Promise<MatchTeam | null> {
    if (typeof password !== 'string' || password === '') {
      return null;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return null;
    }

    const hashes = await this.outlandsMatchRepository.findHashesByPlaceId(placeId);
    const blueMatched = await this.compare(password, hashes.blue);
    const redMatched = await this.compare(password, hashes.red);

    // Blue is checked first because the historical template checks PASS1 first.
    // The two passwords being equal is a misconfiguration, not a mode.
    if (blueMatched) {
      return 'blue';
    }
    if (redMatched) {
      return 'red';
    }
    return null;
  }

  /**
   * Reports whether each team has a password configured. This is the ONLY thing
   * the administration screen can learn about the stored values.
   * @param placeId id of the place to report on
   * @returns which teams have a password set
   */
  public async getStatus(placeId: number): Promise<MatchPasswordStatus> {
    const hashes = await this.outlandsMatchRepository.findHashesByPlaceId(placeId);
    return {
      blueSet: typeof hashes.blue === 'string' && hashes.blue !== '',
      redSet: typeof hashes.red === 'string' && hashes.red !== '',
    };
  }

  /**
   * Replaces a place's match passwords.
   *
   * A team whose value is absent from the request keeps whatever it already has;
   * a team whose value is null or the empty string is cleared, which stands the
   * scheduled match down. The caller must have already authorized the change.
   * @param placeId id of the place to configure
   * @param memberId id of the member making the change, for the audit note
   * @param update the new passwords
   * @returns the resulting status
   */
  public async setPasswords(
    placeId: number,
    memberId: number,
    update: MatchPasswordUpdate,
  ): Promise<MatchPasswordStatus> {
    const current = await this.outlandsMatchRepository.findHashesByPlaceId(placeId);
    const next: MatchPasswordHashes = {
      blue: await this.nextHash(update.blue, current.blue),
      red: await this.nextHash(update.red, current.red),
    };
    await this.outlandsMatchRepository.saveHashes(placeId, next, memberId);
    return {
      blueSet: next.blue !== null,
      redSet: next.red !== null,
    };
  }

  /**
   * May this member administer scheduled matches at this place?
   *
   * Two sources, and no others:
   *
   *   - the `Admin` role, the modern stand-in for the historical `isAdmin` branch
   *     of `passupdate.tmpl`;
   *   - the `Outlands Chief` role held AT THIS PLACE, which is Ryan's modern
   *     primary Outlands authority.
   *
   * `Outlands Deputy` is deliberately absent: OUTLANDS-2B defines no Deputy
   * powers. `PlacesChief` is deliberately absent too - it carries the generic
   * `canAdmin` for every place, and match passwords are a secret rather than an
   * ordinary place setting, so this lane does not widen it by assumption.
   * @param memberId id of the member acting
   * @param placeId id of the place being administered
   * @returns true only if one of the two sources above applies
   */
  public async canAdministerMatch(memberId: number, placeId: number): Promise<boolean> {
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return false;
    }
    if (!Number.isInteger(placeId) || placeId <= 0) {
      return false;
    }

    // Resolved by role NAME rather than through `RoleRepository.roleMap`, whose
    // constructor populates it asynchronously: on a cold start the map can still
    // be empty, and an authorization check that silently reads `undefined` would
    // compare `undefined === undefined` against an unset assignment.
    const assignments = await this.roleAssignmentRepository
      .getRoleNameAndIdByMemberId(memberId);
    if (!Array.isArray(assignments)) {
      return false;
    }

    return assignments.some(assignment => {
      if (!assignment || typeof assignment.name !== 'string') {
        return false;
      }
      if (assignment.name === GLOBAL_ADMIN_ROLE) {
        return true;
      }
      return assignment.name === OUTLANDS_MATCH_ADMIN_ROLE
        && Number(assignment.place_id) === placeId;
    });
  }

  /** bcrypt comparison that still costs a hash when nothing is stored. */
  private async compare(password: string, hash: string | null): Promise<boolean> {
    if (typeof hash !== 'string' || hash === '') {
      await bcrypt.compare(password, DUMMY_HASH);
      return false;
    }
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      // A malformed stored hash must refuse entry, not crash the request. The
      // error itself is not logged, because it can carry the hash.
      return false;
    }
  }

  /** Work out one team's new stored hash from the requested value. */
  private async nextHash(
    requested: string | null | undefined,
    current: string | null,
  ): Promise<string | null> {
    if (requested === undefined) {
      return current;
    }
    if (requested === null || requested === '') {
      return null;
    }
    if (typeof requested !== 'string') {
      return current;
    }
    if (requested.length > MAX_PASSWORD_LENGTH) {
      return current;
    }
    return bcrypt.hash(requested, SALT_ROUNDS);
  }
}
