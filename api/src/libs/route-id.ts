/**
 * Parses an `:id` route parameter that must name exactly one existing place.
 *
 * `Number.parseInt` accepts a numeric prefix and truncates a fraction, so
 * `'500x'` becomes `500` and `'1.5'` becomes `1`. Used on a path segment that
 * silently redirects a malformed request onto a different, real resource
 * instead of rejecting it. This validates the complete value instead, and
 * accepts only a plain positive decimal integer.
 *
 * @param raw the raw route parameter value
 * @returns the id, or null when the value does not name one
 */
export function parseRouteId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
