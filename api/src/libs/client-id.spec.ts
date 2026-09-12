import { isClientId } from './client-id';

/*
 * The case table this file and `spa/tests/outlands-strict-avatar-id.test.ts`
 * share. The API and the socket server are separate packages and cannot import
 * one module, so the rule is written twice and asserted against the same list
 * twice instead. A value added here belongs in that file as well.
 */
describe('isClientId', () => {
  it.each<[unknown, string]>([
    [1, 'the smallest id'],
    [12, 'the Game Master row id -- a well formed id, refused later by authority'],
    [13, 'a team avatar id'],
    [14, 'a team avatar id'],
    [15, 'a team avatar id'],
    [16, 'a team avatar id'],
    [999999, 'an ordinary large id'],
    [Number.MAX_SAFE_INTEGER, 'the largest distinguishable integer'],
  ])('accepts %p (%s)', raw => {
    expect(isClientId(raw)).toBe(true);
  });

  /*
   * `13.0` is not a separate value in JavaScript: the language has one number
   * type, `13.0 === 13`, and nothing downstream can tell the two apart. The
   * rule is the VALUE being a safe integer, never the notation it was typed in.
   */
  it('accepts 13.0, because 13.0 IS 13', () => {
    expect(13.0).toBe(13);
    expect(isClientId(13.0)).toBe(true);
  });

  /*
   * Every one of these coerces to a number that names a real row.
   * `Number([13])` is `13`. That is the defect this rule exists to close.
   */
  it.each<[unknown, string]>([
    [[13], 'an array holding the id'],
    [['13'], 'an array holding the id as a string'],
    ['13', 'the id as a string'],
    ['013', 'the id as a zero-padded string'],
    [' 13 ', 'the id as a padded string'],
    [[], 'an empty array, which coerces to 0'],
    [true, 'a boolean, which coerces to 1'],
  ])('rejects %p (%s) even though it coerces to a number', raw => {
    expect(Number.isSafeInteger(Number(raw))).toBe(true);
    expect(isClientId(raw)).toBe(false);
  });

  it.each<[unknown, string]>([
    [{}, 'an object'],
    [{ id: 13 }, 'an object carrying the id'],
    [null, 'null'],
    [undefined, 'undefined -- an absent field'],
    [false, 'false'],
    [13.5, 'a fraction'],
    [-13, 'a negative integer'],
    [0, 'zero, which names no row'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'positive infinity'],
    [Number.NEGATIVE_INFINITY, 'negative infinity'],
    [Number.MAX_SAFE_INTEGER + 1, 'an integer past the safe range'],
    [1e308, 'a very large numeric value'],
  ])('rejects %p (%s)', raw => {
    expect(isClientId(raw)).toBe(false);
  });

  /*
   * Past 2^53 - 1 distinct integers stop being distinct, so an id there does
   * not identify one row. Both of these ARE the same number.
   */
  it('rejects an unsafe integer because it no longer names one row', () => {
    expect(Number.MAX_SAFE_INTEGER + 1).toBe(Number.MAX_SAFE_INTEGER + 2);
    expect(isClientId(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});
