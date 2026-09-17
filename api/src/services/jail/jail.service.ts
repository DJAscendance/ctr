import { Service } from 'typedi';

import { BanRepository } from '../../repositories/ban/ban.repository';
import { PlaceRepository } from '../../repositories/place/place.repository';
import { RoleRepository } from '../../repositories/role/role.repository';
import {
  RoleAssignmentRepository,
} from '../../repositories/role-assignment/role-assignment.repository';

/** How the Jail sees one citizen: inmate, staff, or an ordinary visitor. */
export interface JailStanding {
  /** Under a live jail sentence right now. */
  inmate: boolean;
  /** Holds a Security or Jail office, so inmate speech and the cells are theirs to reach. */
  staff: boolean;
  /** The Jail's own place id, so a caller can recognise the room without guessing a slug. */
  jailPlaceId: number | null;
}

/**
 * The Jail's authority, in one place.
 *
 * Every question the Jail asks -- may this citizen leave, may they hear an inmate, may they
 * stand inside the cells -- resolves through here, on the server, from database state. No
 * caller passes in a claim about themselves, and nothing here reads a URL, a room name, an
 * avatar or a client flag.
 *
 * Roles are resolved BY NAME through the role map. Not one numeric id appears in this file,
 * which is the point: the `role` table has been reseeded and deduplicated more than once,
 * and an id written into authorization code is a decision that silently changes meaning the
 * next time that happens.
 */
@Service()
export class JailService {
  /**
   * The offices that may hear inmates and walk into the cells.
   *
   * These are the Security chain and the Jail's own guards, exactly as the `role` table
   * seeds them (`api/db/seed_data/roles_data.json` and `update_roles_data.json`), with
   * whitespace stripped the way `RoleRepository` sanitizes names.
   *
   * `Admin` is included and nothing else broad is. In particular this is NOT `canAdmin()`:
   * that helper answers a different question -- "may this member moderate the city" -- and
   * membership in it has drifted before. Jail authority is named here, so widening it is a
   * visible edit to this list rather than a side effect of someone else's change.
   */
  public static readonly JAIL_AUTHORITY_ROLES: readonly string[] = [
    'Admin',
    'SecurityCommissioner',
    'SecurityChief',
    'DeputySecurityChief',
    'SecurityCaptain',
    'SecurityLieutenant',
    'SecuritySergeant',
    'SecurityOfficer',
    'SecurityAdvisor',
    'LeadJailGuard',
    'JailGuard',
  ];

  /**
   * The three Jail worlds, and who is served which.
   *
   * These are the original CyberTown files, not new ones. `jail.wrl` and `jailpris.wrl`
   * ship identical geometry -- every DEF in one is in the other -- and differ only in where
   * the viewer starts and which side of the force field they are held on. That is the
   * historical design: one Jail, two ways of standing in it.
   *
   *  * VISITOR starts in the visiting gallery and cannot walk into the cells.
   *  * INMATE starts inside the cells and cannot walk out of them.
   *  * STAFF is the visiting gallery with the barrier lifted, so Security and the guards
   *    can walk in through the force field and back out the same way.
   *
   * All three are thin files that Inline the historical geometry rather than copy it, so
   * the original `jail.wrl` and `jailpris.wrl` are still byte-for-byte what CyberTown
   * shipped. `jail.wrl` remains the seeded value in the database and is never served to
   * anyone by name -- every answer this service gives names one of the three below, so
   * there is no path that quietly falls back to a world with no barrier in it.
   *
   * WHICH FILE A CITIZEN GETS IS DECIDED HERE, ON THE SERVER, FROM THEIR BAN ROWS AND ROLE
   * ASSIGNMENTS. The client never asks for one and cannot name one. That is the whole of
   * the staff cell-entry mechanism: no key, no hidden command, nothing for a visitor to
   * press. The old ESC trick was a viewer exploit and is not reproduced -- staff pass
   * because the server chose their world, and a visitor who presses every key on the
   * keyboard is still standing in `jail.wrl`.
   */
  public static readonly WORLD_VISITOR = 'vrml/jailvisit.wrl';
  public static readonly WORLD_INMATE = 'vrml/jailinmate.wrl';
  public static readonly WORLD_STAFF = 'vrml/jailstaff.wrl';

  /** The slug the Jail is seeded under; see `api/db/seed_data/public_place_data.json`. */
  public static readonly JAIL_SLUG = 'jail';

  constructor(
    private banRepository: BanRepository,
    private placeRepository: PlaceRepository,
    private roleRepository: RoleRepository,
    private roleAssignmentRepository: RoleAssignmentRepository,
  ) {}

  /**
   * Whether this member is serving a sentence right now.
   *
   * The single definition of "inmate" in the codebase. It is a live, unexpired `jail` ban
   * row and nothing else -- never the page they are on, the room they joined, a flag they
   * sent, or a role they hold.
   */
  public async isInmate(memberId: number): Promise<boolean> {
    if (!memberId) return false;
    return this.banRepository.hasActiveJailBan(memberId);
  }

  /**
   * Whether this member holds a Security or Jail office.
   *
   * Resolved through `awaitRoleMap`, which is asked for every name it is about to read.
   * That matters here more than anywhere: a snapshot taken before the seeds finished would
   * hand back `undefined` for each office and quietly refuse a real Security Chief the
   * right to hear the inmates they are supervising.
   */
  public async isStaff(memberId: number): Promise<boolean> {
    if (!memberId) return false;
    const roleMap = await this.roleRepository.awaitRoleMap(
      ...JailService.JAIL_AUTHORITY_ROLES,
    );
    const authorityIds = JailService.JAIL_AUTHORITY_ROLES
      .map(name => roleMap[name])
      .filter(id => typeof id === 'number');
    if (authorityIds.length === 0) return false;
    const assignments = await this.roleAssignmentRepository.getByMemberId(memberId);
    return !!assignments.find(assignment => authorityIds.includes(assignment.role_id));
  }

  /** The Jail's place id, or null when the place has not been seeded. */
  public async getJailPlaceId(): Promise<number | null> {
    const place = await this.placeRepository.findBySlug(JailService.JAIL_SLUG);
    return place ? place.id : null;
  }

  /**
   * One member's whole standing, in a single answer.
   *
   * Both flags are read independently and both can be true: a Jail Guard who has been
   * sentenced is an inmate AND staff. Callers decide what that means for them -- the chat
   * router lets such a member hear the wing they are locked in, and the world chooser keeps
   * them confined, because a sentence outranks an office for confinement.
   */
  public async getStanding(memberId: number): Promise<JailStanding> {
    const [inmate, staff, jailPlaceId] = await Promise.all([
      this.isInmate(memberId),
      this.isStaff(memberId),
      this.getJailPlaceId(),
    ]);
    return { inmate, staff, jailPlaceId };
  }

  /** Whether the given place id is the Jail. */
  public async isJailPlace(placeId: number): Promise<boolean> {
    const jailPlaceId = await this.getJailPlaceId();
    return jailPlaceId !== null && jailPlaceId === placeId;
  }

  /**
   * Returns the place, with the Jail's world file chosen for this member.
   *
   * A pure read that copies rather than mutates, so a cached place row is never rewritten
   * for the next caller with a different standing.
   *
   * A sentence outranks an office: a jailed guard is served the inmate world. Otherwise
   * they could be sentenced and then walk out of their own cell, which is the escape this
   * lane exists to close.
   *
   * Anything that is not the Jail is returned untouched, and an unidentified caller gets
   * the visitor world -- the seeded default -- so failing to prove who you are never
   * widens what you can reach.
   */
  public async applyWorldForMember<T extends { id: number, world_filename?: string }>(
    place: T,
    memberId?: number,
  ): Promise<T> {
    if (!place) return place;
    if (!(await this.isJailPlace(place.id))) return place;

    if (!memberId) return { ...place, world_filename: JailService.WORLD_VISITOR };

    const standing = await this.getStanding(memberId);
    if (standing.inmate) return { ...place, world_filename: JailService.WORLD_INMATE };
    if (standing.staff) return { ...place, world_filename: JailService.WORLD_STAFF };
    return { ...place, world_filename: JailService.WORLD_VISITOR };
  }

  /**
   * The member ids whose stored Jail messages are withheld from ordinary visitors.
   *
   * See `BanRepository.findEverJailedMemberIds` for why this is "ever jailed" rather than
   * "jailed now": a stored message records no standing, so the only honest read-path rule
   * is one that cannot serve a line an inmate might have spoken.
   */
  public async findEverJailedMemberIds(): Promise<number[]> {
    return this.banRepository.findEverJailedMemberIds();
  }
}
