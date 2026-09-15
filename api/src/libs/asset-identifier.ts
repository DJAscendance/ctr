/**
 * Bounded asset identifiers for the admin object catalog.
 *
 * `object.directory` and `object.filename` name one on-disk asset directory and
 * one basename inside it. They are *identifiers*, not paths: the admin surface
 * may not accept a filesystem path at all, so anything path-shaped is refused
 * here, at the controller boundary, before `path.resolve` sees it and before any
 * row is written. See `docs/ADMIN_SECURITY_BASELINE.md`, prohibition 4.
 *
 * The containment helpers in `object-source.service.ts` are unchanged and stay
 * behind this as defence in depth. They are the second line, not the first.
 *
 * Everything here is pure: no filesystem, no database, no network, no inventory
 * lookup. Like `libs/access-level.ts` it fails closed, so an unexpected shape is
 * rejected rather than thrown on.
 */

/** Longest accepted asset directory identifier. */
export const ASSET_DIRECTORY_MAX_LENGTH = 64;

/** Longest accepted asset filename identifier. */
export const ASSET_FILENAME_MAX_LENGTH = 128;

/**
 * Layer 2, the charset allow-list. One segment, starting with an alphanumeric,
 * then alphanumerics, dot, underscore or hyphen.
 */
const ASSET_DIRECTORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ASSET_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** NUL, every other C0 control character, and DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

/**
 * Layer 1, the absolute reject floor. This list is never widened, for any stored
 * value: a real row that fails it is a data finding, not a grammar finding.
 *
 * Absolute paths, multi-segment syntax, drive letters and URI schemes are all
 * covered by the separator, colon and dot rules - no separate check replaces
 * them.
 */
function passesRejectFloor(raw: unknown, maxLength: number): raw is string {
  if (typeof raw !== 'string') return false;
  if (raw.length === 0 || raw.trim().length === 0) return false;
  if (raw.length > maxLength) return false;
  if (raw.includes('/') || raw.includes('\\')) return false;
  if (raw.includes(':')) return false;
  if (raw.includes('..')) return false;
  if (raw === '.' || raw === '..') return false;
  if (raw.startsWith('.')) return false;
  if (CONTROL_CHARACTER.test(raw)) return false;
  return true;
}

/** Whether `raw` is one bounded asset directory identifier. Never throws. */
export function isAssetDirectory(raw: unknown): raw is string {
  return passesRejectFloor(raw, ASSET_DIRECTORY_MAX_LENGTH)
    && ASSET_DIRECTORY_PATTERN.test(raw);
}

/** Whether `raw` is one bounded asset filename identifier. Never throws. */
export function isAssetFilename(raw: unknown): raw is string {
  return passesRejectFloor(raw, ASSET_FILENAME_MAX_LENGTH)
    && ASSET_FILENAME_PATTERN.test(raw);
}
