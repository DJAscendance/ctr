/*
 * Importing the repository barrel eagerly constructs a real knex instance, and
 * this project ships no knex configuration for the test environment. These
 * specs only ever exercise mocked repositories and services, so the db module
 * is stubbed out before anything can pull the real one in.
 */
jest.mock('../../db', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mockDb } = require('@spec/mocks');
  return { db: mockDb, knex: mockDb.knex };
});

import path from 'path';
import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { BlockService } from './block.service';
import { MapBackgroundService } from '../map-background/map-background.service';
import {
  BlockRepository,
  ColonyRepository,
  HoodRepository,
  MapLocationRepository,
  MemberRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';
import { MapLocation, Place } from '../../types/models';

describe('BlockService - map background selection', () => {
  /*
   * `resolveOptions` is delegated to a real MapBackgroundService reading the
   * repository's own shipped assets, so the stale-index fallback below is
   * proven against the real grass/block pool rather than against a stub that
   * could agree with a wrong implementation.
   */
  const repoAssetsDir = path.resolve(__dirname, '../../../../spa/assets');
  let originalAssetsDir: string | undefined;

  const BLOCK_ID = 500;
  const HOOD_ID = 60;
  const COLONY_ID = 7;

  const fakeBlock: Partial<Place> = { id: BLOCK_ID, type: 'block', map_background_index: null };
  const fakeHood: Partial<Place> = { id: HOOD_ID, type: 'hood' };
  const grassColony: Partial<Place> = { id: COLONY_ID, type: 'colony', slug: 'games_col' };

  let blockRepository: jest.Mocked<BlockRepository>;
  let colonyRepository: jest.Mocked<ColonyRepository>;
  let hoodRepository: jest.Mocked<HoodRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let mapBackgroundService: jest.Mocked<MapBackgroundService>;
  let service: BlockService;

  beforeEach(() => {
    blockRepository = createSpyObj(BlockRepository);
    colonyRepository = createSpyObj(ColonyRepository);
    hoodRepository = createSpyObj(HoodRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    placeRepository = createSpyObj(PlaceRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberRepository = createSpyObj(MemberRepository);
    mapBackgroundService = createSpyObj(MapBackgroundService);

    blockRepository.find.mockResolvedValue(fakeBlock as Place);
    hoodRepository.find.mockResolvedValue(fakeHood as Place);
    colonyRepository.find.mockResolvedValue(grassColony as Place);
    mapLocationRepository.findPlaceIdMapLocation.mockImplementation(async (placeId: number) => {
      if (placeId === BLOCK_ID) {
        return { place_id: BLOCK_ID, parent_place_id: HOOD_ID } as MapLocation;
      }
      return { place_id: HOOD_ID, parent_place_id: COLONY_ID } as MapLocation;
    });
    mapBackgroundService.isValidIndex.mockResolvedValue(true);

    originalAssetsDir = process.env.ASSETS_DIR;
    process.env.ASSETS_DIR = repoAssetsDir;
    const realMapBackgroundService = new MapBackgroundService();
    mapBackgroundService.listOptions
      .mockImplementation((theme, level) => realMapBackgroundService.listOptions(theme, level));
    mapBackgroundService.resolveOptions.mockImplementation((theme, level, selectedIndex) =>
      realMapBackgroundService.resolveOptions(theme, level, selectedIndex));

    Container.reset();
    Container.set(BlockRepository, blockRepository);
    Container.set(ColonyRepository, colonyRepository);
    Container.set(HoodRepository, hoodRepository);
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(PlaceRepository, placeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    Container.set(MemberRepository, memberRepository);
    Container.set(MapBackgroundService, mapBackgroundService);
    service = Container.get(BlockService);
  });

  afterEach(() => {
    if (originalAssetsDir === undefined) {
      delete process.env.ASSETS_DIR;
    } else {
      process.env.ASSETS_DIR = originalAssetsDir;
    }
  });

  describe('getMapBackgroundOptions', () => {
    it('resolves the theme from the owning colony and returns options', async () => {
      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(mapBackgroundService.resolveOptions).toHaveBeenCalledWith('grass', 'block', null);
      expect(result).toEqual({
        selectedIndex: null,
        effectiveIndex: 0,
        effectiveUrl: '/assets/img/map_themes/grass/block/Pimg2D000.gif',
        options: [0, 1, 2, 3].map(index => ({
          index,
          url: `/assets/img/map_themes/grass/block/Pimg2D00${index}.gif`,
        })),
      });
    });

    it('returns the stored positive selection', async () => {
      blockRepository.find.mockResolvedValue({ ...fakeBlock, map_background_index: 1 } as Place);

      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(result.selectedIndex).toBe(1);
      expect(result.effectiveIndex).toBe(1);
    });

    it('falls back to the default index when the stored index left the pool', async () => {
      // grass/block ships indexes 0-3, so a stored 26 can no longer render.
      blockRepository.find.mockResolvedValue({ ...fakeBlock, map_background_index: 26 } as Place);

      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(result.selectedIndex).toBe(26);
      expect(result.effectiveIndex).toBe(0);
      expect(result.effectiveUrl).toBe('/assets/img/map_themes/grass/block/Pimg2D000.gif');
    });

    it('does not write the stale index back to the database while reading', async () => {
      blockRepository.find.mockResolvedValue({ ...fakeBlock, map_background_index: 26 } as Place);

      await service.getMapBackgroundOptions(BLOCK_ID);

      expect(placeRepository.updateMapBackgroundIndex).not.toHaveBeenCalled();
    });

    it('returns null when the block does not exist', async () => {
      blockRepository.find.mockResolvedValue(undefined);

      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(result).toBeNull();
    });

    it('returns null when the owning colony slug has no theme mapping', async () => {
      colonyRepository.find.mockResolvedValue({ ...grassColony, slug: 'unknown_col' } as Place);

      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(result).toBeNull();
    });
  });

  describe('updateMapBackgroundSelection', () => {
    it('persists a valid positive index', async () => {
      const result = await service.updateMapBackgroundSelection(BLOCK_ID, 1);

      expect(mapBackgroundService.isValidIndex).toHaveBeenCalledWith('grass', 'block', 1);
      expect(placeRepository.updateMapBackgroundIndex).toHaveBeenCalledWith(BLOCK_ID, 1);
      expect(result).toEqual({ status: 'success', selectedIndex: 1 });
    });

    it('canonicalizes a submitted 0 to null without validating against the pool', async () => {
      const result = await service.updateMapBackgroundSelection(BLOCK_ID, 0);

      expect(mapBackgroundService.isValidIndex).not.toHaveBeenCalled();
      expect(placeRepository.updateMapBackgroundIndex).toHaveBeenCalledWith(BLOCK_ID, null);
      expect(result).toEqual({ status: 'success', selectedIndex: null });
    });

    it('stores null directly for a reset request', async () => {
      const result = await service.updateMapBackgroundSelection(BLOCK_ID, null);

      expect(placeRepository.updateMapBackgroundIndex).toHaveBeenCalledWith(BLOCK_ID, null);
      expect(result).toEqual({ status: 'success', selectedIndex: null });
    });

    it('rejects an index that does not exist in the resolved theme pool', async () => {
      mapBackgroundService.isValidIndex.mockResolvedValue(false);

      const result = await service.updateMapBackgroundSelection(BLOCK_ID, 99);

      expect(placeRepository.updateMapBackgroundIndex).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'invalid' });
    });

    it('returns not_found when the block does not exist', async () => {
      blockRepository.find.mockResolvedValue(undefined);

      const result = await service.updateMapBackgroundSelection(BLOCK_ID, 1);

      expect(result).toEqual({ status: 'not_found' });
    });

    it('returns not_found when the owning colony has no theme mapping', async () => {
      colonyRepository.find.mockResolvedValue({ ...grassColony, slug: 'unknown_col' } as Place);

      const result = await service.updateMapBackgroundSelection(BLOCK_ID, 1);

      expect(result).toEqual({ status: 'not_found' });
    });
  });
});
