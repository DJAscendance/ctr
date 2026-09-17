/**
 * What the session guard owes a BANNED citizen's navigation.
 *
 * The guard in `main.ts` used to answer this inline, as a chain of `else if`s, and the chain
 * asked about the ROUTE before it asked about the SENTENCE. Two of its branches matched on
 * the path alone -- `/place/jail`, and the place-scoped pages -- so a FULL-banned citizen
 * who typed `#/place/jail` was admitted by the Jail's own branch and kept their session.
 * The API and the socket had already refused that citizen; only the client still believed
 * in them, and it went on holding their token in localStorage because of the page they had
 * asked for. That is the defect this file exists to make impossible.
 *
 * The order below is the whole point, and it is stated once:
 *
 *   1. a ban that is not a jail sentence ends the session, whatever route was asked for;
 *   2. only then do the Jail's own rules apply.
 *
 * It is a pure function on purpose. The guard performs the consequences -- destroying the
 * session, redirecting, staging the Jail's place record -- and this only says which
 * consequence is owed, so every pairing of sentence and route can be checked without a
 * browser. See `jail-navigation.helper.ts` for the pages a sentence does not take away.
 */
import { isJailReadablePath } from "./jail-navigation.helper";

/**
 * The one ban type that leaves a citizen in the city with a working session.
 *
 * Stated as an allow-list, not as `!== "full"`. The `ban.type` column is an enum today, and
 * a type this file has never heard of -- a new sentence, a row written by hand, a field the
 * server stopped sending -- must fall to the refusal of entry rather than to the Jail's
 * carve-outs. "Could not tell" and "is merely jailed" must never be the same state.
 */
const CONFINING_BAN_TYPE = "jail";

/**
 * Pages that belong to ONE place. An inmate is not in that place, so a sentence refuses
 * them. Matched as substrings, exactly as the guard has always matched them.
 */
const PLACE_SCOPED_PATH_MARKERS: readonly string[] = [
  "/messageboard/",
  "/inbox/",
  "/information/",
];

/** The Jail: the one world a jail sentence admits. */
const JAIL_PATH = "/place/jail";

/** The page that tells a citizen the page they asked for was refused. */
const RESTRICTED_PATH = "/restricted";

/**
 * What the guard owes this navigation.
 *
 * - `end-session` - destroy the client session and show the ban notice.
 * - `restricted`  - refuse the page and show the restricted-access notice.
 * - `confine`     - send the citizen back to the Jail.
 * - `allow`       - let the navigation land.
 */
export type BanNavigation = "end-session" | "restricted" | "confine" | "allow";

/**
 * Decides one banned citizen's navigation.
 *
 * @param banType the `type` of the ban the server reported, or nothing if it reported none
 * @param fullPath the path the citizen asked for, as vue-router gives it
 */
export function decideBannedNavigation(
  banType: string | undefined | null,
  fullPath: string | undefined | null,
): BanNavigation {
  // FIRST, and before one question is asked about the route. A ban that does not confine
  // is a refusal of entry, and a refusal of entry cannot be argued out of by asking for a
  // particular page.
  if (banType !== CONFINING_BAN_TYPE) return "end-session";

  // A path that is not a path is not a page an inmate may open.
  if (typeof fullPath !== "string") return "confine";

  if (PLACE_SCOPED_PATH_MARKERS.some(marker => fullPath.includes(marker))) return "restricted";
  if (fullPath === RESTRICTED_PATH) return "allow";
  if (isJailReadablePath(fullPath)) return "allow";
  if (fullPath === JAIL_PATH) return "allow";
  return "confine";
}
