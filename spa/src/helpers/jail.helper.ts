/**
 * The Jail's client-side rules, in one testable place.
 *
 * None of this is authority. Authority is `GET /api/member/jail/standing`, answered by the
 * API from ban rows and role assignments; these functions only decide what to do with the
 * answer. They are pulled out of WorldBrowserPage.vue so they can be proved directly rather
 * than by reading a single-file component's source text.
 *
 * The coordinates are historical, not invented:
 *
 *  * z = 1.25 is where `DEF forcefield` in jail.wrl stands, once the -90 degree X rotation
 *    on its Transform is applied to the polygon.
 *  * 0 1.75 19.51 is jail.wrl's own Viewpoint -- the visiting gallery.
 *  * 0 1.75 -24.65, facing back down the wing, is jailpris.wrl's own Viewpoint -- the cell
 *    block, and the historical inmate spawn.
 *
 * `qa/jail/tools/check-jail-confinement.js` walks a real X_ITE browser into that boundary
 * and confirms these numbers against the worlds themselves.
 */

/** The slug the Jail is seeded under. */
export const JAIL_SLUG = "jail";

/** Anything with a smaller z than this is behind the force field, in the cells. */
export const JAIL_CELL_BOUNDARY_Z = 1.25;

/** Where the staff door puts a guard on the way out. */
export const JAIL_GALLERY_SPAWN = { position: [0, 1.75, 19.51], angle: 0 };

/** Where the staff door puts a guard on the way in. */
export const JAIL_CELL_SPAWN = { position: [0, 1.75, -24.65], angle: Math.PI };

/** The API's answer about one citizen. `null` means it was never asked, or could not tell. */
export interface JailStanding {
  inmate: boolean;
  staff: boolean;
  jailPlaceId?: number | null;
}

/**
 * Whether this citizen may use the staff door and beam into the cells.
 *
 * Two conditions, and the second one is the interesting one: a guard who is SERVING A
 * SENTENCE is not staff here. Without it an officer could be jailed and then use their own
 * office to step straight out of their own cell, which is the escape the whole lane exists
 * to close. A sentence outranks an office, exactly as it does on the server when it picks
 * which world to serve.
 *
 * A missing or unreadable standing is "no authority". "Could not tell" and "is staff" must
 * never be the same state.
 */
export function hasJailStaffAuthority(standing: JailStanding | null | undefined): boolean {
  if (!standing) return false;
  return standing.staff === true && standing.inmate !== true;
}

/**
 * Whether a point is behind the force field.
 *
 * False everywhere that is not the Jail, so no other world inherits a coordinate that means
 * nothing there.
 */
export function isJailCellSide(slug: string | undefined | null, z: number): boolean {
  if (slug !== JAIL_SLUG) return false;
  return z < JAIL_CELL_BOUNDARY_Z;
}

/**
 * Whether a beam to this landing point is allowed.
 *
 * A beam binds a Viewpoint straight at the destination, so it does not walk and no wall or
 * force field is consulted on the way. In the Jail that made it a way into the cells for
 * anyone who could see an inmate in the citizen list -- the modern shape of the old ESC
 * trick.
 *
 * Only a landing INSIDE the cells is refused, so beaming between visitors in the gallery is
 * untouched. Staff are exempt, because supervising the Jail means being able to reach an
 * inmate.
 *
 * A dishonest client cannot use this to lure anyone in: the destination is the position the
 * target REPORTED, so a fabricated position beams the caller to the fabricated place and
 * never to the real one.
 */
export function mayBeamTo(
  slug: string | undefined | null,
  z: number,
  standing: JailStanding | null | undefined,
): boolean {
  if (!isJailCellSide(slug, z)) return true;
  return hasJailStaffAuthority(standing);
}
