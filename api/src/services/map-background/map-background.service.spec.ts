import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';

import { MapBackgroundService } from './map-background.service';

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
    process.env.ASSETS_DIR = originalAssetsDir;
    await fs.rm(assetsDir, { recursive: true, force: true });
  });

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

    it('returns an empty list when the pool directory does not exist', async () => {
      const options = await service.listOptions('cyberhood', 'hood');

      expect(options).toEqual([]);
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

  describe('getEffectiveUrl', () => {
    it('resolves to index 000 when the selection is null', async () => {
      const url = await service.getEffectiveUrl('grass', 'block', null);

      expect(url).toBe('/assets/img/map_themes/grass/block/Pimg2D000.gif');
    });

    it('resolves to the selected index when one is provided', async () => {
      const url = await service.getEffectiveUrl('grass', 'hood', 26);

      expect(url).toBe('/assets/img/map_themes/grass/hood/Pimg2D026.gif');
    });
  });
});
