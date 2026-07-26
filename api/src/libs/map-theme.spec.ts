import { resolveMapTheme } from './map-theme';

describe('resolveMapTheme', () => {
  it.each([
    ['games_col', 'grass'],
    ['vrtwrlds_col', 'grass'],
    ['ent_col', 'grass'],
    ['inrlms_col', 'grass'],
    ['teen_col', 'grass'],
    ['campus', 'grass'],
    ['ad_col', 'grass'],
    ['hitek_col', 'grass'],
    ['scifi_col', 'desert'],
    ['morningstar', 'desert'],
    ['9thdimension', 'desert'],
    ['cyberhood', 'cyberhood'],
  ])('resolves %s to %s', (slug, theme) => {
    expect(resolveMapTheme(slug)).toBe(theme);
  });

  it('returns null for an unrecognized colony slug', () => {
    expect(resolveMapTheme('not_a_real_colony')).toBeNull();
  });

  it('returns null for an undefined slug', () => {
    expect(resolveMapTheme(undefined)).toBeNull();
  });

  it('returns null for a null slug', () => {
    expect(resolveMapTheme(null)).toBeNull();
  });
});
