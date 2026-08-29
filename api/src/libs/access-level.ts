/**
 * Helpers for reading the value `MemberService.getAccessLevel()` resolves to.
 *
 * At runtime that value is a `string[]` of the capability tags the member holds,
 * built in `member.service.ts`: 'admin', 'security', 'leader', 'live-event'. Its
 * declared type is wider (`LegacyAccessLevel`) because a couple of legacy callers
 * still compare it to a bare string, so a gate that reaches straight for
 * `.length` or `.includes(...)` is trusting a shape TypeScript does not
 * guarantee. Everything here treats any non-array as "holds nothing", so a
 * malformed, null or undefined access level denies rather than throwing.
 */

/** The capability tags `getAccessLevel()` can return. */
export type AccessCapability = 'admin' | 'security' | 'leader' | 'live-event';

/**
 * The capability tags in `raw`, or an empty list when `raw` is not an array of
 * strings. Never throws.
 */
export function accessCapabilities(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((capability): capability is string => typeof capability === 'string')
    : [];
}

/**
 * Whether `raw` holds at least one of `capabilities`. Fails closed: an empty,
 * null, undefined or non-array access level holds nothing.
 */
export function hasAccess(raw: unknown, ...capabilities: AccessCapability[]): boolean {
  const held = accessCapabilities(raw);
  return capabilities.some(capability => held.includes(capability));
}
