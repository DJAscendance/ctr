import { accessCapabilities, hasAccess } from './access-level';

describe('accessCapabilities', () => {
  it('returns the capability tags of an array', () => {
    expect(accessCapabilities(['admin', 'security'])).toEqual(['admin', 'security']);
  });

  it('drops non-string members rather than trusting them', () => {
    expect(accessCapabilities(['admin', 1, null, {}, 'leader'])).toEqual(['admin', 'leader']);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'admin'],
    ['a number', 7],
    ['an object', { admin: true }],
  ])('treats %s as holding nothing', (_label, raw) => {
    expect(accessCapabilities(raw)).toEqual([]);
  });
});

describe('hasAccess', () => {
  it('is true when any one of the listed capabilities is held', () => {
    expect(hasAccess(['leader'], 'admin', 'security', 'leader')).toBe(true);
  });

  it('is false when none of the listed capabilities is held', () => {
    expect(hasAccess(['leader'], 'admin', 'security')).toBe(false);
  });

  it('is false for an empty access level', () => {
    expect(hasAccess([], 'admin', 'security', 'leader', 'live-event')).toBe(false);
  });

  // The bare string 'admin' is the shape `LegacyAccessLevel` still permits. It
  // must not satisfy a gate: `'admin'.includes('admin')` would be true, which is
  // exactly the substring trap this helper exists to close.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the bare string "admin"', 'admin'],
  ])('fails closed for %s', (_label, raw) => {
    expect(hasAccess(raw, 'admin')).toBe(false);
  });
});
