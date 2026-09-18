import {
  AUDIT_ACCESS_EVENTS,
  AUDIT_EVENTS,
  AUDIT_EVENT_NAMES,
  AUDIT_REASON_MIN,
  AUDIT_METADATA_MAX_KEYS,
  AUDIT_METADATA_MAX_STRING,
  AUDIT_REASON_MAX,
  AUDIT_RESULTS,
  isAccessEvent,
  isForbiddenMetadataKey,
  normaliseReason,
  normaliseSource,
  redactMetadata,
  serialiseMetadata,
  utcTimestamp,
  validateOperatorReason,
} from './audit-event';

/**
 * The audit vocabulary, and the redaction rule that keeps secrets out of the store.
 *
 * `docs/ADMIN_SECURITY_BASELINE.md` section 12 is a list of things that may never be
 * written into an audit record, and it is absolute. This spec is that list, turned into
 * assertions: each family of forbidden key gets its own case, so a future change that
 * loosens one of them fails here by name rather than somewhere downstream.
 */

describe('audit event registry', () => {
  it('names exactly the nine state changes the baseline says owe an event', () => {
    // Baseline section 11: "ban add, ban delete, role hire, role fire, avatar approve,
    // avatar reject, place update, object update, donor change (if ever enabled), account
    // removal". Donor change is not enabled -- `addDonor`'s granted branch cannot run --
    // so nine names, not ten.
    expect(AUDIT_EVENT_NAMES.filter(name => !isAccessEvent(name)).sort()).toEqual([
      'admin.account.remove',
      'admin.avatar.approve',
      'admin.avatar.reject',
      'admin.ban.add',
      'admin.ban.remove',
      'admin.object.update',
      'admin.place.update',
      'admin.role.fire',
      'admin.role.hire',
    ]);
  });

  it('names the private-content reads the baseline says owe an access event', () => {
    // Same section: "reads of another member's private content -- chat history above all
    // -- owe an access event". Two names, and no more: an ordinary administrative read
    // owes nothing, and inventing an event for one would claim a rule the baseline does
    // not state. The per-route classification is section 10 of docs/ADMIN_AUDIT_TRAIL.md.
    expect([...AUDIT_ACCESS_EVENTS].sort()).toEqual([
      'admin.chat.read',
      'admin.transaction.read',
    ]);
    for (const name of AUDIT_ACCESS_EVENTS) {
      expect(AUDIT_EVENT_NAMES).toContain(name);
      expect(isAccessEvent(name)).toBe(true);
    }
  });

  it('keeps the registry at exactly the names both rules produce', () => {
    expect(AUDIT_EVENT_NAMES).toHaveLength(11);
  });

  it('has no name for the donor path, which cannot execute', () => {
    expect(AUDIT_EVENT_NAMES.some(name => name.includes('donor'))).toBe(false);
  });

  it('uses one stable machine-readable shape for every name', () => {
    for (const name of AUDIT_EVENT_NAMES) {
      expect(name).toMatch(/^admin\.[a-z]+\.[a-z]+$/);
    }
  });

  it('gives every action a distinct name', () => {
    expect(new Set(AUDIT_EVENT_NAMES).size).toBe(AUDIT_EVENT_NAMES.length);
  });

  it('records the three results the baseline names', () => {
    expect(Object.values(AUDIT_RESULTS).sort()).toEqual(['allowed', 'denied', 'failed']);
  });
});

describe('redactMetadata', () => {
  /**
   * One case per family of section 12 prohibition. The value is a marker string, so a
   * leak is visible as itself in the failure message.
   */
  const FORBIDDEN = [
    ['password', { password: 'hunter2' }],
    ['old password marker', { oldPassword: 'hunter2' }],
    ['password hash', { password_hash: '$2b$10$abcdefghijklmnop' }],
    ['bare hash', { hash: '$2b$10$abcdefghijklmnop' }],
    ['salt', { salt: 'deadbeef' }],
    ['reset token', { reset_token: 'rt_abc123' }],
    ['session token', { session_token: 'st_abc123' }],
    ['api token header', { apitoken: 'eyJhbGciOiJIUzI1NiJ9.abc.def' }],
    ['jwt', { jwt: 'eyJhbGciOiJIUzI1NiJ9.abc.def' }],
    ['authorization header', { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9' }],
    ['bearer value', { bearer: 'eyJhbGciOiJIUzI1NiJ9' }],
    ['cookie', { cookie: 'connect.sid=s%3Aabc' }],
    ['api key', { api_key: 'sk-live-abcdef' }],
    ['private key', { private_key: '-----BEGIN PRIVATE KEY-----' }],
    ['signing key', { signing_secret: 'whsec_abc' }],
    ['environment value', { env_jwt_secret: 'super-secret' }],
    ['generic secret', { secret: 'super-secret' }],
    ['credential', { credential: 'user:pass' }],
    ['message body', { body: 'the words of a private message' }],
    ['message content', { content: 'the words of a private message' }],
    ['chat text', { text: 'the words of a chat line' }],
    ['message', { message: 'the words of a private message' }],
    ['chat line', { chat_line: 'the words of a chat line' }],
    ['email address', { email: 'someone@example.invalid' }],
  ] as ReadonlyArray<[string, Record<string, unknown>]>;

  it.each(FORBIDDEN)('drops %s', (_label, input) => {
    expect(redactMetadata(input)).toBeNull();
    expect(serialiseMetadata(input)).toBeNull();
    for (const key of Object.keys(input)) {
      expect(isForbiddenMetadataKey(key)).toBe(true);
    }
  });

  it('never lets a forbidden value through beside a permitted one', () => {
    const safe = redactMetadata({
      ban_type: 'full',
      password: 'hunter2',
      apitoken: 'eyJhbGciOiJIUzI1NiJ9',
      old_status: 1,
    });
    expect(safe).toEqual({ ban_type: 'full', old_status: 1 });
    expect(JSON.stringify(safe)).not.toContain('hunter2');
    expect(JSON.stringify(safe)).not.toContain('eyJ');
  });

  it('drops a whole request body rather than storing it', () => {
    // Section 22: never store a complete request body. An object value is how one gets in
    // by accident, so the type itself is refused.
    const safe = redactMetadata({
      request: { username: 'someone', password: 'hunter2' },
      headers: ['apitoken'],
      ban_type: 'jail',
    });
    expect(safe).toEqual({ ban_type: 'jail' });
  });

  it('keeps the scalars an operator review actually needs', () => {
    expect(redactMetadata({
      ban_type: 'jail',
      old_status: 1,
      new_status: 0,
      primary_role_cleared: true,
      place_id: null,
    })).toEqual({
      ban_type: 'jail',
      old_status: 1,
      new_status: 0,
      primary_role_cleared: true,
      place_id: null,
    });
  });

  it('truncates a long string instead of storing all of it', () => {
    const safe = redactMetadata({ note: 'x'.repeat(AUDIT_METADATA_MAX_STRING + 50) });
    expect((safe.note as string).length).toBe(AUDIT_METADATA_MAX_STRING + 3);
    expect(safe.note).toMatch(/\.\.\.$/);
  });

  it('caps how many keys one record may carry', () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < AUDIT_METADATA_MAX_KEYS + 10; index += 1) {
      wide[`field_${index}`] = index;
    }
    expect(Object.keys(redactMetadata(wide))).toHaveLength(AUDIT_METADATA_MAX_KEYS);
  });

  it('records an unusable number as a marker rather than a silent null', () => {
    expect(redactMetadata({ count: Number.NaN })).toEqual({ count: 'not-a-number' });
  });

  it('returns null for nothing, and for an object with nothing left', () => {
    expect(redactMetadata(null)).toBeNull();
    expect(redactMetadata(undefined)).toBeNull();
    expect(redactMetadata({})).toBeNull();
    expect(redactMetadata({ undefinedField: undefined })).toBeNull();
  });
});

describe('normaliseReason', () => {
  it('keeps an operator reason, trimmed', () => {
    expect(normaliseReason('  spamming the plaza  ')).toBe('spamming the plaza');
  });

  it('caps the reason to the column width', () => {
    expect(normaliseReason('r'.repeat(AUDIT_REASON_MAX + 100)))
      .toHaveLength(AUDIT_REASON_MAX);
  });

  it('reads anything that is not a usable string as no reason', () => {
    expect(normaliseReason('')).toBeNull();
    expect(normaliseReason('   ')).toBeNull();
    expect(normaliseReason(undefined)).toBeNull();
    expect(normaliseReason({ reason: 'x' })).toBeNull();
    expect(normaliseReason(7)).toBeNull();
  });
});

describe('normaliseSource', () => {
  it('keeps an address', () => {
    expect(normaliseSource('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseSource('::ffff:203.0.113.7')).toBe('::ffff:203.0.113.7');
  });

  it('drops anything too long to be an address rather than truncating it', () => {
    expect(normaliseSource('x'.repeat(200))).toBeNull();
  });

  it('drops a non-string', () => {
    expect(normaliseSource(undefined)).toBeNull();
    expect(normaliseSource(['203.0.113.7'])).toBeNull();
  });
});

describe('utcTimestamp', () => {
  it('formats the instant in UTC, whatever the connection timezone would do', () => {
    // 23:30 on the 5th in UTC is the 6th in some timezones and the 5th in others. Only a
    // UTC rendering gives one answer, and the store depends on every row meaning the same.
    expect(utcTimestamp(new Date('2026-09-05T23:30:07.123Z'))).toBe('2026-09-05 23:30:07');
  });

  it('produces the shape MySQL stores a datetime in', () => {
    expect(utcTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('is within a second of now', () => {
    const before = Date.now();
    const stamped = Date.parse(`${utcTimestamp().replace(' ', 'T')}Z`);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('the event names are the ones the controllers use', () => {
  it('exposes each action under a readable constant', () => {
    expect(AUDIT_EVENTS.BAN_ADD).toBe('admin.ban.add');
    expect(AUDIT_EVENTS.BAN_REMOVE).toBe('admin.ban.remove');
    expect(AUDIT_EVENTS.ROLE_HIRE).toBe('admin.role.hire');
    expect(AUDIT_EVENTS.ROLE_FIRE).toBe('admin.role.fire');
    expect(AUDIT_EVENTS.AVATAR_APPROVE).toBe('admin.avatar.approve');
    expect(AUDIT_EVENTS.AVATAR_REJECT).toBe('admin.avatar.reject');
    expect(AUDIT_EVENTS.PLACE_UPDATE).toBe('admin.place.update');
    expect(AUDIT_EVENTS.OBJECT_UPDATE).toBe('admin.object.update');
    expect(AUDIT_EVENTS.ACCOUNT_REMOVE).toBe('admin.account.remove');
  });
});

/**
 * The operator-reason contract (CTBL-0025 Phase C).
 *
 * Baseline section 11 requires a reason for bans, role changes and account removal. An
 * obligation the server does not enforce is a suggestion, so the rule under test is that
 * `validateOperatorReason` REFUSES rather than repairs: it never returns a value the
 * operator did not write, and never quietly shortens one they did.
 */
describe('operator reason validation', () => {
  it('refuses a reason that was never sent', () => {
    expect(validateOperatorReason(undefined)).toBeNull();
    expect(validateOperatorReason(null)).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    // A JSON body can carry any of these where a sentence was expected.
    expect(validateOperatorReason(0)).toBeNull();
    expect(validateOperatorReason(1)).toBeNull();
    expect(validateOperatorReason(true)).toBeNull();
    expect(validateOperatorReason(['a reason'])).toBeNull();
    expect(validateOperatorReason({ reason: 'a reason' })).toBeNull();
  });

  it('refuses an empty or whitespace-only reason', () => {
    expect(validateOperatorReason('')).toBeNull();
    expect(validateOperatorReason('   ')).toBeNull();
    expect(validateOperatorReason('\t\n  \r')).toBeNull();
  });

  it('accepts the shortest real reason there is', () => {
    expect(AUDIT_REASON_MIN).toBe(1);
    expect(validateOperatorReason('x')).toBe('x');
  });

  it('accepts an ordinary reason and stores it trimmed', () => {
    expect(validateOperatorReason('  spamming the plaza  ')).toBe('spamming the plaza');
  });

  it('accepts a reason exactly as long as the column allows', () => {
    const exact = 'r'.repeat(AUDIT_REASON_MAX);
    expect(validateOperatorReason(exact)).toBe(exact);
    expect(validateOperatorReason(`  ${exact}  `)).toBe(exact);
  });

  it('refuses an over-long reason rather than silently cutting it short', () => {
    // The difference from `normaliseReason` is the whole point: a stored reason that is
    // not the sentence the operator wrote is a misquote in an evidentiary record.
    expect(validateOperatorReason('r'.repeat(AUDIT_REASON_MAX + 1))).toBeNull();
  });

  it('never substitutes a placeholder for a missing reason', () => {
    for (const absent of [undefined, null, '', '   ']) {
      expect(validateOperatorReason(absent)).toBeNull();
    }
  });
});
