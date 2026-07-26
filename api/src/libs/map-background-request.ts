/** Sentinel returned by parseMapBackgroundIndex when the request body is invalid. */
export const INVALID_MAP_BACKGROUND_INDEX = Symbol('INVALID_MAP_BACKGROUND_INDEX');

/**
 * Validates and normalizes the `index` field of a map background selection
 * request body. The only value a client may ever submit is a bare integer
 * index (or null/0 to reset) - never a URL, theme, filename, or path.
 *
 * Returns the normalized index (0 is canonicalized to null) or the
 * INVALID_MAP_BACKGROUND_INDEX sentinel if the body is not well-formed.
 */
export function parseMapBackgroundIndex(
  body: unknown,
): number | null | typeof INVALID_MAP_BACKGROUND_INDEX {
  if (typeof body !== 'object' || body === null || !('index' in body)) {
    return INVALID_MAP_BACKGROUND_INDEX;
  }

  const index = (body as { index: unknown }).index;

  if (index === null) {
    return null;
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return INVALID_MAP_BACKGROUND_INDEX;
  }
  return index === 0 ? null : index;
}
