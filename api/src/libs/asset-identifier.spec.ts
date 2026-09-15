import {
  ASSET_DIRECTORY_MAX_LENGTH,
  ASSET_FILENAME_MAX_LENGTH,
  isAssetDirectory,
  isAssetFilename,
} from './asset-identifier';

/**
 * The reject floor both identifiers share. Every entry is a way of expressing a
 * filesystem path, or a value that cannot name one asset at all. Control
 * characters are written as JavaScript escapes so the runner never carries a
 * literal control byte.
 */
const REJECTED = [
  ['a parent-directory traversal', '../x'],
  ['a forward-slash path', 'a/b'],
  ['a backslash path', 'a\\b'],
  ['an absolute path', '/absolute'],
  ['a Windows drive path', 'C:\\path'],
  ['a URI', 'file://x'],
  ['an empty string', ''],
  ['a whitespace-only string', '   '],
  ['a single dot', '.'],
  ['a double dot', '..'],
  ['a dotfile', '.hidden'],
  ['an embedded double dot', 'a..b'],
  ['a trailing traversal', 'assets/..'],
  ['a NUL character', 'a\u0000b'],
  ['a newline', 'a\nb'],
  ['a tab', 'a\tb'],
  ['a DEL character', 'a\u007Fb'],
  ['a leading-hyphen value', '-leading'],
  ['a space-separated value', 'two words'],
  ['null', null],
  ['undefined', undefined],
  ['a number', 7],
  ['an object', { directory: '1' }],
  ['an array', ['1']],
  ['a boolean', true],
] as ReadonlyArray<[string, unknown]>;

describe('isAssetDirectory', () => {
  it.each(REJECTED)('rejects %s', (_label, raw) => {
    expect(isAssetDirectory(raw)).toBe(false);
  });

  // Real values read from `spa/assets/object/` and `docs/mall-export-schema.md`.
  it.each([
    ['a legacy numeric directory', '1'],
    ['another legacy numeric directory', '2'],
    ['a randomUUID-shaped directory', '550e8400-e29b-41d4-a716-446655440000'],
    ['a dotted directory', 'mall.objects'],
    ['an underscored directory', 'mall_objects'],
  ])('accepts %s', (_label, raw) => {
    expect(isAssetDirectory(raw)).toBe(true);
  });

  it('accepts a value exactly at the length bound', () => {
    expect(isAssetDirectory('a'.repeat(ASSET_DIRECTORY_MAX_LENGTH))).toBe(true);
  });

  it('rejects an over-long directory', () => {
    expect(isAssetDirectory('a'.repeat(ASSET_DIRECTORY_MAX_LENGTH + 1))).toBe(false);
  });
});

describe('isAssetFilename', () => {
  it.each(REJECTED)('rejects %s', (_label, raw) => {
    expect(isAssetFilename(raw)).toBe(false);
  });

  // Real values read from `spa/assets/object/1/` and `spa/assets/object/2/`.
  it.each([
    ['a world file', 'Cryo2000.wrl'],
    ['an inline world file', '5000exp_inline.wrl'],
    ['a thumbnail', '19.jpg'],
    ['a viewer page', 'x_ite.htm'],
    ['an x3d file', 'ObjectPreview.x3dv'],
  ])('accepts %s', (_label, raw) => {
    expect(isAssetFilename(raw)).toBe(true);
  });

  it('accepts a value exactly at the length bound', () => {
    expect(isAssetFilename('a'.repeat(ASSET_FILENAME_MAX_LENGTH))).toBe(true);
  });

  it('rejects an over-long filename', () => {
    expect(isAssetFilename('a'.repeat(ASSET_FILENAME_MAX_LENGTH + 1))).toBe(false);
  });

  it('is wider than the directory bound, and only in length', () => {
    const between = 'a'.repeat(ASSET_DIRECTORY_MAX_LENGTH + 1);
    expect(isAssetDirectory(between)).toBe(false);
    expect(isAssetFilename(between)).toBe(true);
  });
});
