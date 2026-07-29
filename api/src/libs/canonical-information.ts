import { sanitizeUserHtml } from './sanitize-user-html';

/**
 * The one canonicalization-and-limit function for authored Information.
 *
 * THE BUG THIS EXISTS TO FIX. The limit used to be measured on the RAW submitted
 * text, before sanitizing. The sanitizer can GROW a value - it normalizes `<br>`
 * to `<br />`, adds quotes to bare attribute values, and closes unclosed tags -
 * so a 3,500-character input could be accepted and stored as 5,250 characters.
 * Loading that stored value back into the editor and pressing Update without
 * changing a thing then failed the limit. The value was unsaveable.
 *
 * THE INVARIANT, stated as the property that actually matters:
 *
 *     any value that was successfully stored can be loaded and re-saved
 *     unchanged without failing the limit
 *
 * which holds because the limit is measured on the CANONICAL value - the exact
 * string that will be written to the database - and sanitizing is idempotent:
 * sanitize(sanitize(x)) === sanitize(x). So re-submitting a stored value
 * canonicalizes to itself, and a value that fit when stored still fits.
 *
 * HOW LENGTH IS COUNTED. `String.prototype.length`: JavaScript UTF-16 code
 * units. An emoji outside the BMP therefore counts as 2, and a combining
 * sequence counts one per code point rather than one per grapheme. That is the
 * same unit the SPA's `textarea` maxlength and character counter use, which is
 * the point - the client and the server must not disagree about what "3,500"
 * means. It is deliberately NOT a byte count: `place.information` is MySQL TEXT
 * (65,535 BYTES), and 3,500 UTF-16 code units is at most 14,000 bytes of UTF-8,
 * so the column is never the binding constraint.
 *
 * SANITIZING IS SILENT. Disallowed markup is dropped and the write SUCCEEDS,
 * exactly as it does for a message board post. Only the length can refuse a
 * write, and it refuses the whole value - nothing is ever truncated, and a
 * refused write leaves the previously stored value untouched.
 */

/** Maximum length of the CANONICAL (sanitized) value, in UTF-16 code units. */
export const INFORMATION_MAX_LENGTH = 3500;

export type CanonicalInformationResult =
  | { status: 'ok'; value: string }
  | { status: 'too_long'; length: number; limit: number };

/**
 * Sanitizes to the canonical stored form and checks it against the limit.
 *
 * Every server path that writes Home Information must go through this: the
 * update route, settlement, and anything added later. Duplicating "sanitize then
 * check" at a call site is how the settlement bypass happened - that path
 * sanitized but never applied the limit at all.
 */
export function canonicalizeInformation(input: unknown): CanonicalInformationResult {
  const text = typeof input === 'string' ? input : '';
  const value = sanitizeUserHtml(text);
  if (value.length > INFORMATION_MAX_LENGTH) {
    return { status: 'too_long', length: value.length, limit: INFORMATION_MAX_LENGTH };
  }
  return { status: 'ok', value };
}

/** The message shown when a canonical value is over the limit. */
export function informationTooLongMessage(limit = INFORMATION_MAX_LENGTH): string {
  return `Description must be ${limit} characters or fewer.`;
}
