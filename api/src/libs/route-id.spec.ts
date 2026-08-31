import { parseRouteId } from './route-id';

describe('parseRouteId', () => {
  it.each([
    ['1', 1],
    ['7', 7],
    ['500', 500],
    ['501', 501],
    ['9007199254740991', 9007199254740991],
  ])('accepts the plain positive integer %s', (raw, expected) => {
    expect(parseRouteId(raw)).toBe(expected);
  });

  /*
   * Number.parseInt would silently turn each of these into a different, real
   * place id instead of rejecting the request.
   */
  it.each([
    ['500x', 'a numeric prefix'],
    ['500 ', 'a trailing space'],
    [' 500', 'a leading space'],
    ['1.5', 'a fraction'],
    ['1e2', 'exponent notation'],
    ['0x1f', 'hexadecimal notation'],
    ['500abc', 'trailing letters'],
  ])('rejects %s (%s)', raw => {
    expect(parseRouteId(raw)).toBeNull();
  });

  it.each([
    ['', 'an empty value'],
    ['-1', 'a negative value'],
    ['+1', 'an explicit plus sign'],
    ['0', 'zero, which no place uses'],
    ['007', 'a leading-zero form of an existing id'],
    ['not-a-number', 'a non-numeric value'],
    ['NaN', 'the string NaN'],
    ['Infinity', 'the string Infinity'],
  ])('rejects %s (%s)', raw => {
    expect(parseRouteId(raw)).toBeNull();
  });

  it('rejects an integer beyond the safe range', () => {
    expect(parseRouteId('9007199254740993')).toBeNull();
  });

  it.each([
    [undefined],
    [null],
    [500],
    [{}],
    [['500']],
  ])('rejects the non-string value %p', raw => {
    expect(parseRouteId(raw)).toBeNull();
  });
});
