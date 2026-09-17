/**
 * Which pages a citizen serving a sentence may still open.
 *
 * The route guard in `main.ts` holds a jailed citizen in the Jail by redirecting every
 * navigation that is not `/place/jail` back to `/place/jail`. That catch-all is what
 * confines an inmate, and it is correct for worlds -- but it is a catch-all, so it also
 * caught pages that are not a world and belong to nowhere in particular.
 *
 * The NEWS button is the case that showed it. `App.vue` opens it with
 * `window.open("#/news", ...)`, so the redirect did not merely refuse the page: it opened a
 * SECOND browser window showing the Jail again. Nothing was confined by that -- the news
 * page is one global, read-only notice board that says nothing about where its reader is
 * standing, or where anyone else is -- and the citizen lost a working button.
 *
 * This is deliberately a LIST and not a pattern. Every entry is a page somebody decided an
 * inmate may read, so widening it has to be an edit somebody can see in a diff. The
 * place-scoped pages (`/messageboard/`, `/inbox/`, `/information/`) are NOT here and must
 * not be: they belong to a place the inmate is not in, and the guard already refuses them.
 *
 * A FULL ban is not covered by this file at all. That citizen loses their session outright;
 * deciding so belongs to the guard, which checks the ban type before it consults this list.
 */

/** The pages a jail sentence does not take away. Exact paths, not prefixes. */
export const JAIL_READABLE_PATHS: readonly string[] = ["/news"];

/**
 * Whether a jailed citizen's navigation is one of the pages above.
 *
 * Exact match only, so a page cannot be reached by hanging extra segments off an allowed
 * one -- `/news/../place/plaza` and `/newsfeed` are both refused. A non-string is refused
 * rather than coerced: "could not tell" and "is allowed" must never be the same state.
 */
export function isJailReadablePath(fullPath: string | undefined | null): boolean {
  if (typeof fullPath !== "string") return false;
  return JAIL_READABLE_PATHS.includes(fullPath);
}
