import { promises as fs, PathLike } from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';

import { MapLevel, MapTheme } from '../../libs';
import { MapBackgroundConfigurationError, MapBackgroundService } from './map-background.service';

describe('MapBackgroundService', () => {
  let service: MapBackgroundService;
  let assetsDir: string;
  let originalAssetsDir: string | undefined;

  beforeEach(async () => {
    Container.reset();
    service = Container.get(MapBackgroundService);

    originalAssetsDir = process.env.ASSETS_DIR;
    assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ctr-map-background-test-'));
    process.env.ASSETS_DIR = assetsDir;
  });

  afterEach(async () => {
    restoreEnvVar('ASSETS_DIR', originalAssetsDir);
    await fs.rm(assetsDir, { recursive: true, force: true });
  });

  describe('restoreEnvVar', () => {
    /*
     * The teardown above uses this helper rather than a plain assignment.
     * Assigning an undefined original back would store the *string*
     * "undefined" in the process-wide environment, and later specs sharing
     * this Jest worker would then resolve asset paths under `undefined/`.
     */
    const key = 'CTR_MAP_BACKGROUND_ENV_PROBE';

    afterEach(() => {
      delete process.env[key];
    });

    it('deletes the variable when it was originally absent', () => {
      process.env[key] = 'set-during-a-test';

      restoreEnvVar(key, undefined);

      expect(key in process.env).toBe(false);
      expect(process.env[key]).toBeUndefined();
    });

    it('restores the exact original value when one existed', () => {
      process.env[key] = 'set-during-a-test';

      restoreEnvVar(key, '/original/assets');

      expect(process.env[key]).toBe('/original/assets');
    });
  });

  /**
   * Puts an environment variable back exactly as it was, including having
   * been absent. `process.env.X = undefined` would store the string
   * "undefined" instead of removing the variable.
   */
  function restoreEnvVar(key: string, original: string | undefined): void {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }

  async function writeFixture(theme: string, level: string, filename: string): Promise<void> {
    const dir = path.join(assetsDir, 'img', 'map_themes', theme, level);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), 'fixture');
  }

  describe('listOptions', () => {
    it('discovers every three-digit Pimg2D file and sorts numerically', async () => {
      await writeFixture('grass', 'block', 'Pimg2D002.gif');
      await writeFixture('grass', 'block', 'Pimg2D000.gif');
      await writeFixture('grass', 'block', 'Pimg2D001.gif');

      const options = await service.listOptions('grass', 'block');

      expect(options.map(option => option.index)).toEqual([0, 1, 2]);
    });

    it('ignores files that do not match the three-digit Pimg2D pattern', async () => {
      await writeFixture('grass', 'block', 'Pimg2D000.gif');
      await writeFixture('grass', 'block', 'Picon2D000.gif');
      await writeFixture('grass', 'block', 'Pimg2D0000.gif');
      await writeFixture('grass', 'block', 'Pimg2D00.gif');
      await writeFixture('grass', 'block', 'Pimg2D001.png');
      await writeFixture('grass', 'block', 'notPimg2D001.gif');

      const options = await service.listOptions('grass', 'block');

      expect(options.map(option => option.index)).toEqual([0]);
    });

    it('ignores directories that happen to match the filename pattern', async () => {
      await writeFixture('grass', 'block', 'Pimg2D000.gif');
      const fakeDir = path.join(assetsDir, 'img', 'map_themes', 'grass', 'block', 'Pimg2D001.gif');
      await fs.mkdir(fakeDir, { recursive: true });

      const options = await service.listOptions('grass', 'block');

      expect(options.map(option => option.index)).toEqual([0]);
    });

    it('builds a correct, server-controlled URL for each option', async () => {
      await writeFixture('desert', 'hood', 'Pimg2D005.gif');

      const options = await service.listOptions('desert', 'hood');

      expect(options).toEqual([
        { index: 5, url: '/assets/img/map_themes/desert/hood/Pimg2D005.gif' },
      ]);
    });

    it('returns an empty list when the pool directory does not exist (ENOENT)', async () => {
      const options = await service.listOptions('cyberhood', 'hood');

      expect(options).toEqual([]);
    });

    it('propagates a non-ENOENT readdir failure instead of reporting no options', async () => {
      const readdirSpy = jest.spyOn(fs, 'readdir').mockImplementation(async () => {
        const error: NodeJS.ErrnoException = new Error('EACCES');
        error.code = 'EACCES';
        throw error;
      });

      await expect(service.listOptions('grass', 'block')).rejects.toThrow('EACCES');
      readdirSpy.mockRestore();
    });

    it('fails loudly when ASSETS_DIR is unset rather than reading a relative path', async () => {
      delete process.env.ASSETS_DIR;
      const readdirSpy = jest.spyOn(fs, 'readdir');

      await expect(service.listOptions('grass', 'block'))
        .rejects.toBeInstanceOf(MapBackgroundConfigurationError);
      expect(readdirSpy).not.toHaveBeenCalled();
      readdirSpy.mockRestore();
    });

    it('ignores an entry removed between readdir and stat (ENOENT)', async () => {
      await writeFixture('grass', 'block', 'Pimg2D000.gif');
      await writeFixture('grass', 'block', 'Pimg2D001.gif');
      const dir = path.join(assetsDir, 'img', 'map_themes', 'grass', 'block');
      const originalStat = fs.stat.bind(fs);
      const statSpy = jest.spyOn(fs, 'stat').mockImplementation(async (target: PathLike) => {
        if (target === path.join(dir, 'Pimg2D001.gif')) {
          const error: NodeJS.ErrnoException = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
        return originalStat(target);
      });

      const options = await service.listOptions('grass', 'block');
      statSpy.mockRestore();

      expect(options.map(option => option.index)).toEqual([0]);
    });

    it('propagates a non-ENOENT stat failure instead of silently skipping the entry', async () => {
      await writeFixture('grass', 'block', 'Pimg2D000.gif');
      const dir = path.join(assetsDir, 'img', 'map_themes', 'grass', 'block');
      const statSpy = jest.spyOn(fs, 'stat').mockImplementation(async (target: PathLike) => {
        if (target === path.join(dir, 'Pimg2D000.gif')) {
          const error: NodeJS.ErrnoException = new Error('EACCES');
          error.code = 'EACCES';
          throw error;
        }
        return Promise.reject(new Error('unexpected stat target'));
      });

      await expect(service.listOptions('grass', 'block')).rejects.toThrow('EACCES');
      statSpy.mockRestore();
    });

    it('deduplicates defensively if the same index somehow appears twice', async () => {
      const dir = path.join(assetsDir, 'img', 'map_themes', 'grass', 'block');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'Pimg2D000.gif'), 'fixture');

      const options = await service.listOptions('grass', 'block');
      const secondPass = await service.listOptions('grass', 'block');

      expect(options).toEqual(secondPass);
      expect(options.map(option => option.index)).toEqual([0]);
    });
  });

  describe('isValidIndex', () => {
    it('returns true for an index with a matching file', async () => {
      await writeFixture('grass', 'hood', 'Pimg2D003.gif');

      expect(await service.isValidIndex('grass', 'hood', 3)).toBe(true);
    });

    it('returns false for an index with no matching file', async () => {
      await writeFixture('grass', 'hood', 'Pimg2D003.gif');

      expect(await service.isValidIndex('grass', 'hood', 4)).toBe(false);
    });

    it('returns false for an index that only exists in a different theme', async () => {
      await writeFixture('desert', 'block', 'Pimg2D004.gif');

      expect(await service.isValidIndex('grass', 'block', 4)).toBe(false);
    });
  });

  /*
   * The tests above use temporary fixtures to pin the resolver's mechanics.
   * These run it against the map theme assets the repository actually ships,
   * so the option sets stay derived from real theme data rather than from a
   * list hardcoded anywhere in the application.
   */
  describe('against the repository\'s real map theme assets', () => {
    const repoAssetsDir = path.resolve(__dirname, '../../../../spa/assets');

    beforeEach(() => {
      process.env.ASSETS_DIR = repoAssetsDir;
    });

    it.each([
      ['cyberhood', 'block', [0, 1, 2, 3]],
      ['cyberhood', 'hood', [0]],
      ['desert', 'block', [0, 1, 2, 3, 4]],
      ['desert', 'hood', [0, 1, 2]],
      ['grass', 'block', [0, 1, 2, 3]],
      ['grass', 'hood', Array.from({ length: 27 }, (unused, i) => i)],
    ] as [MapTheme, MapLevel, number[]][])(
      'resolves the shipped %s/%s pool',
      async (theme, level, expected) => {
        const options = await service.listOptions(theme, level);

        expect(options.map(option => option.index)).toEqual(expected);
      },
    );

    it('keeps block and hood pools separate within the same theme', async () => {
      // grass ships hood index 26 but no block index 26.
      expect(await service.isValidIndex('grass', 'hood', 26)).toBe(true);
      expect(await service.isValidIndex('grass', 'block', 26)).toBe(false);
    });

    it('keeps pools separate across themes at the same level', async () => {
      // desert ships block index 4 but cyberhood does not.
      expect(await service.isValidIndex('desert', 'block', 4)).toBe(true);
      expect(await service.isValidIndex('cyberhood', 'block', 4)).toBe(false);
    });

    it('builds every option URL from the theme and level, never from the database', async () => {
      const options = await service.listOptions('desert', 'hood');

      expect(options.map(option => option.url)).toEqual([
        '/assets/img/map_themes/desert/hood/Pimg2D000.gif',
        '/assets/img/map_themes/desert/hood/Pimg2D001.gif',
        '/assets/img/map_themes/desert/hood/Pimg2D002.gif',
      ]);
    });
  });

  describe('resolveOptions', () => {
    it('resolves to index 000 when nothing has been selected', async () => {
      await writeFixture('grass', 'block', 'Pimg2D000.gif');

      const result = await service.resolveOptions('grass', 'block', null);

      expect(result.selectedIndex).toBeNull();
      expect(result.effectiveIndex).toBe(0);
      expect(result.effectiveUrl).toBe('/assets/img/map_themes/grass/block/Pimg2D000.gif');
    });

    it('honours a stored index the pool still offers', async () => {
      await writeFixture('grass', 'hood', 'Pimg2D000.gif');
      await writeFixture('grass', 'hood', 'Pimg2D026.gif');

      const result = await service.resolveOptions('grass', 'hood', 26);

      expect(result.selectedIndex).toBe(26);
      expect(result.effectiveIndex).toBe(26);
      expect(result.effectiveUrl).toBe('/assets/img/map_themes/grass/hood/Pimg2D026.gif');
    });

    it('falls back to index 000 when the stored index is no longer in the pool', async () => {
      await writeFixture('grass', 'block', 'Pimg2D000.gif');
      await writeFixture('grass', 'block', 'Pimg2D001.gif');

      const result = await service.resolveOptions('grass', 'block', 26);

      // The raw stored value stays visible so callers can see the stale row.
      expect(result.selectedIndex).toBe(26);
      // But what renders is a file that actually exists.
      expect(result.effectiveIndex).toBe(0);
      expect(result.effectiveUrl).toBe('/assets/img/map_themes/grass/block/Pimg2D000.gif');
    });

    it('reports the full option list alongside the effective selection', async () => {
      await writeFixture('desert', 'hood', 'Pimg2D000.gif');
      await writeFixture('desert', 'hood', 'Pimg2D001.gif');

      const result = await service.resolveOptions('desert', 'hood', 1);

      expect(result.options.map(option => option.index)).toEqual([0, 1]);
    });
  });
});
