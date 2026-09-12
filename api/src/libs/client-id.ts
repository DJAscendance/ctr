/**
 * Whether a value a client supplied in structured data is usable as a row id.
 *
 * The transport hands these over already typed: a JSON request body carries a
 * number, a string, an array, an object, a boolean or null, and a socket
 * payload carries the same set. So the type the client chose is evidence, and
 * throwing it away is what let a malformed value in. `Number([13])` is `13`,
 * `Number('13')` is `13`, and `Number(' 13 ')` is `13`, so an id compared after
 * coercion accepts every shape that happens to coerce to the right number -- an
 * array being the one independent QA found reaching a real Outlands avatar.
 *
 * This checks the value as it arrived instead. Only a primitive number that is
 * a safe integer above zero may reach a lookup; everything else is refused
 * before any query is built and without a second, coercing interpretation of
 * what the client "meant".
 *
 * `Number.isSafeInteger` carries both remaining rules on its own: it is false
 * for `NaN`, for either infinity, for a fraction such as `13.5`, and for a
 * magnitude past 2^53 - 1, where distinct integers stop being distinct.
 * `13.0` is `13` in JavaScript and is accepted, because the rule is the VALUE
 * being a safe integer and not how it was written down.
 *
 * A `parseRouteId` in `route-id.ts` answers the same question for a path
 * segment, which is always a string and so cannot use this rule. The socket
 * server is a separate package and cannot import this module, so it carries
 * its own copy of the predicate -- `isClientId` in `spa/server.js`, named the
 * same on purpose. Change one and change the other.
 *
 * @param raw the value exactly as the client sent it
 * @returns true when it is a primitive, safe, positive integer id
 */
export function isClientId(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0;
}
