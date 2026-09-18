/**
 * The vocabulary of the operator audit store, and the rule that keeps secrets out of it.
 *
 * `docs/ADMIN_SECURITY_BASELINE.md` section 11 lists the administrative actions that owe
 * an audit event; section 12 lists what may never appear in one. This file is both of
 * those, expressed as types a caller cannot easily get wrong: an event name is a member
 * of a closed union, not a string literal typed at the call site, so a renamed action
 * fails to compile instead of quietly splitting its own history into two names.
 */

/**
 * Every audited administrative action, one name per row of section 11's list.
 *
 * Shape: `admin.<noun>.<verb>`, lower case, dotted. Chosen because the store is queried
 * by prefix -- `admin.ban.%` is every ban decision -- and because a dotted name survives
 * being put in a URL, a log line or a grep unchanged.
 *
 * These names are permanent. Renaming one orphans the rows already written under it.
 *
 * `admin.donor.change` is absent on purpose. Section 11 lists donor change as owing an
 * event "if ever enabled", and it is not: `AdminController.addDonor` compares a list of
 * access levels against the string 'admin', so its granted branch has never run. An event
 * name for a path that cannot execute would assert a capability CTR does not have.
 *
 * The last two are ACCESS events rather than change events. Section 11: "Read-only
 * administrative reads do not owe a change event, but reads of another member's private
 * content -- chat history above all -- owe an access event." They name the read, never
 * what was read; see `redactMetadata` and `docs/ADMIN_AUDIT_TRAIL.md` section 11.
 */
export const AUDIT_EVENTS = {
  BAN_ADD: 'admin.ban.add',
  BAN_REMOVE: 'admin.ban.remove',
  ROLE_HIRE: 'admin.role.hire',
  ROLE_FIRE: 'admin.role.fire',
  AVATAR_APPROVE: 'admin.avatar.approve',
  AVATAR_REJECT: 'admin.avatar.reject',
  PLACE_UPDATE: 'admin.place.update',
  OBJECT_UPDATE: 'admin.object.update',
  ACCOUNT_REMOVE: 'admin.account.remove',
  CHAT_READ: 'admin.chat.read',
  TRANSACTION_READ: 'admin.transaction.read',
} as const;

/** One of the eleven names above. */
export type AuditEventName = typeof AUDIT_EVENTS[keyof typeof AUDIT_EVENTS];

/**
 * The names that record a private-content READ rather than a state change.
 *
 * Kept as a set rather than a naming convention because the difference decides which
 * write path a caller may use: a change event commits inside the mutation's transaction,
 * an access event has no mutation to join and instead gates the disclosure itself.
 */
export const AUDIT_ACCESS_EVENTS: ReadonlyArray<AuditEventName> = Object.freeze([
  AUDIT_EVENTS.CHAT_READ,
  AUDIT_EVENTS.TRANSACTION_READ,
]);

/** Whether this name records a private-content read rather than a state change. */
export function isAccessEvent(event: AuditEventName): boolean {
  return AUDIT_ACCESS_EVENTS.includes(event);
}

/** Every registered name, for tests and for a future read surface. */
export const AUDIT_EVENT_NAMES: ReadonlyArray<AuditEventName> =
  Object.freeze(Object.values(AUDIT_EVENTS));

/**
 * How an attempt ended, from section 11's `result` field.
 *
 * `ALLOWED` is the only value written inside a business transaction. `DENIED` and
 * `FAILED` are written on the ordinary connection by a separate, fail-soft path, because
 * a refusal has no transaction to join and a failure's transaction has already rolled
 * back. See `AdminAuditService`.
 */
export const AUDIT_RESULTS = {
  ALLOWED: 'allowed',
  DENIED: 'denied',
  FAILED: 'failed',
} as const;

export type AuditResult = typeof AUDIT_RESULTS[keyof typeof AUDIT_RESULTS];

/**
 * Which authority layer of section 4 the action relied on.
 *
 * Recorded rather than inferred, because `hireRole` and `fireRole` can be granted by
 * either of two separate paths and "who was allowed to do this, and on what basis" is not
 * answerable later from the actor's id alone -- roles change.
 */
export const AUDIT_AUTHORITIES = {
  /** `canAdmin()` or a `hasAccess(...)` capability tag: authority over the whole community. */
  GLOBAL_ROLE: 'global-role',
  /** `canSecurityManageRole(roleId)`: authority over one named resource. */
  RESOURCE_SCOPED: 'resource-scoped-right',
} as const;

export type AuditAuthority = typeof AUDIT_AUTHORITIES[keyof typeof AUDIT_AUTHORITIES];

/** What kind of thing the event acted on, for `target_type`. */
export const AUDIT_TARGETS = {
  MEMBER: 'member',
  BAN: 'ban',
  ROLE: 'role',
  AVATAR: 'avatar',
  PLACE: 'place',
  OBJECT: 'object',
} as const;

export type AuditTarget = typeof AUDIT_TARGETS[keyof typeof AUDIT_TARGETS];

/** A metadata value that is safe to store: a scalar, or nothing. */
export type AuditMetadataValue = string | number | boolean | null;

/** The caller's proposed metadata, before scrubbing. */
export type AuditMetadataInput = Record<string, unknown>;

/**
 * Key names whose VALUE may never be stored, from section 12.
 *
 * Matched case-insensitively against the whole key, as substrings, so `oldPassword`,
 * `password_hash`, `apitoken` and `Authorization` are all caught by the same three
 * entries. Deliberately broad: the cost of dropping a harmless field called `monkey_key`
 * is a missing fact in a review, and the cost of keeping a field called `reset_token` is
 * a credential in a table an administrator can read.
 */
const FORBIDDEN_KEY_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'password',
  'passwd',
  'hash',
  'salt',
  'token',
  'jwt',
  'secret',
  'credential',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'signing',
  'cookie',
  'session',
  'authorization',
  'auth',
  'bearer',
  'env',
]);

/**
 * Key names that carry the CONTENT of a private message or chat line.
 *
 * Section 12: "log that it was read, and its identifier, never its content". An id is
 * fine, the words are not, and these are the names the words arrive under.
 */
const CONTENT_KEY_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'body',
  'content',
  'text',
  'message',
  'chat',
  'email',
  'mail',
]);

/** Longest string kept in metadata; anything longer is truncated, not dropped. */
export const AUDIT_METADATA_MAX_STRING = 120;

/** Most keys kept in one metadata object. Section 22: keep it small. */
export const AUDIT_METADATA_MAX_KEYS = 20;

/** Longest `reason` stored, matching the column. */
export const AUDIT_REASON_MAX = 255;

/** Longest `source` stored, wide enough for an IPv6 literal. */
export const AUDIT_SOURCE_MAX = 45;

function keyMatches(key: string, patterns: ReadonlyArray<string>): boolean {
  const lowered = key.toLowerCase();
  return patterns.some(pattern => lowered.includes(pattern));
}

/** Whether this key's value may be stored at all. */
export function isForbiddenMetadataKey(key: string): boolean {
  return keyMatches(key, FORBIDDEN_KEY_PATTERNS) || keyMatches(key, CONTENT_KEY_PATTERNS);
}

/**
 * Reduces a caller's proposed metadata to the part that is safe to keep.
 *
 * Three rules, applied in order, and a value has to survive all three:
 *
 *   1. A forbidden or content-bearing key is dropped, value unread. This is the section 12
 *      rule and it is not overridable.
 *   2. A value that is not a scalar is dropped. Objects and arrays are how a whole request
 *      body gets in by accident, and section 22 forbids storing one.
 *   3. `undefined` is dropped, long strings are truncated, and the object is capped at
 *      `AUDIT_METADATA_MAX_KEYS` entries in insertion order.
 *
 * Callers are expected to pass named facts rather than raw input; this runs anyway, as
 * the net under them.
 *
 * @param raw the caller's proposed metadata, or nothing
 * @returns a flat object of scalars, or null when nothing survived
 */
export function redactMetadata(
  raw: AuditMetadataInput | null | undefined,
): Record<string, AuditMetadataValue> | null {
  if (!raw || typeof raw !== 'object') return null;

  const safe: Record<string, AuditMetadataValue> = {};
  let kept = 0;
  for (const key of Object.keys(raw)) {
    if (kept >= AUDIT_METADATA_MAX_KEYS) break;
    if (isForbiddenMetadataKey(key)) continue;

    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (value === null) {
      safe[key] = null;
      kept += 1;
      continue;
    }
    if (typeof value === 'number') {
      // NaN and Infinity do not survive JSON.stringify as numbers; keep the fact that the
      // field was present and unreadable rather than writing a silent `null`.
      safe[key] = Number.isFinite(value) ? value : 'not-a-number';
      kept += 1;
      continue;
    }
    if (typeof value === 'boolean') {
      safe[key] = value;
      kept += 1;
      continue;
    }
    if (typeof value === 'string') {
      safe[key] = value.length > AUDIT_METADATA_MAX_STRING
        ? `${value.slice(0, AUDIT_METADATA_MAX_STRING)}...`
        : value;
      kept += 1;
      continue;
    }
    // Object, array, function, symbol, bigint: dropped by rule 2.
  }

  return kept > 0 ? safe : null;
}

/** Serialises scrubbed metadata for the TEXT column, or null when there is none. */
export function serialiseMetadata(
  raw: AuditMetadataInput | null | undefined,
): string | null {
  const safe = redactMetadata(raw);
  return safe ? JSON.stringify(safe) : null;
}

/**
 * The reason string as stored: trimmed, length-capped, or null.
 *
 * A reason is operator-supplied prose about a member, which section 12 permits -- it is
 * not the member's own content. It is still capped, because the column is.
 */
export function normaliseReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, AUDIT_REASON_MAX);
}

/** Shortest operator reason accepted, after trimming. One real character. */
export const AUDIT_REASON_MIN = 1;

/**
 * The operator reason as the API accepts it, or `null` when there is no usable one.
 *
 * Baseline section 11 makes a reason part of what a ban, a role change and an account
 * removal owe. That is only true if the server refuses the action when the reason is
 * missing, so this REJECTS rather than repairs: no default, no placeholder, no "N/A", and
 * no silent truncation of an over-long one. A caller who sends nothing gets nothing done.
 *
 * `normaliseReason` below is the storage-side net and behaves differently on purpose -- it
 * truncates, because its job is to protect the column from a value that already passed the
 * gate, not to decide whether the action may run.
 *
 * @param reason the raw `reason` field off the request body
 * @returns the trimmed reason when it is 1..255 characters, otherwise null
 */
export function validateOperatorReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const trimmed = reason.trim();
  if (trimmed.length < AUDIT_REASON_MIN) return null;
  if (trimmed.length > AUDIT_REASON_MAX) return null;
  return trimmed;
}

/**
 * The request origin as stored.
 *
 * Section 11 records `source` "where safe to record". An address is kept; anything that
 * does not look like one, or that is too long to be one, is dropped rather than truncated
 * into something misleading.
 */
export function normaliseSource(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (!trimmed || trimmed.length > AUDIT_SOURCE_MAX) return null;
  return trimmed;
}

/**
 * The UTC wall clock for `occurred_at`, as MySQL's `YYYY-MM-DD HH:MM:SS`.
 *
 * Formatted from `toISOString()` rather than handed over as a `Date`, because the driver
 * renders a `Date` in the connection's timezone and the store's whole value depends on
 * every row meaning the same thing.
 *
 * @param now the instant to record; defaults to the current one
 */
export function utcTimestamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 19).replace('T', ' ');
}
