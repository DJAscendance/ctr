import { INVALID_MAP_BACKGROUND_INDEX, parseMapBackgroundIndex } from './map-background-request';

describe('parseMapBackgroundIndex', () => {
  it('returns the integer as-is for a valid positive index', () => {
    expect(parseMapBackgroundIndex({ index: 2 })).toBe(2);
  });

  it('canonicalizes a submitted 0 to null', () => {
    expect(parseMapBackgroundIndex({ index: 0 })).toBeNull();
  });

  it('accepts an explicit null as a reset request', () => {
    expect(parseMapBackgroundIndex({ index: null })).toBeNull();
  });

  it('rejects a missing index field', () => {
    expect(parseMapBackgroundIndex({})).toBe(INVALID_MAP_BACKGROUND_INDEX);
  });

  it('rejects a negative index', () => {
    expect(parseMapBackgroundIndex({ index: -1 })).toBe(INVALID_MAP_BACKGROUND_INDEX);
  });

  it('rejects a fractional index', () => {
    expect(parseMapBackgroundIndex({ index: 1.5 })).toBe(INVALID_MAP_BACKGROUND_INDEX);
  });

  it('rejects a string index', () => {
    expect(parseMapBackgroundIndex({ index: '2' })).toBe(INVALID_MAP_BACKGROUND_INDEX);
  });

  it('rejects a null body', () => {
    expect(parseMapBackgroundIndex(null)).toBe(INVALID_MAP_BACKGROUND_INDEX);
  });

  it('rejects a non-object body', () => {
    expect(parseMapBackgroundIndex('index=2')).toBe(INVALID_MAP_BACKGROUND_INDEX);
  });
});
