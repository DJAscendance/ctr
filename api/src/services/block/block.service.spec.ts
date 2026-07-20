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
import { Place } from '../../types/models';

describe('BlockService - map background selection', () => {
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
        return { place_id: BLOCK_ID, parent_place_id: HOOD_ID } as any;
      }
      return { place_id: HOOD_ID, parent_place_id: COLONY_ID } as any;
    });
    mapBackgroundService.listOptions.mockResolvedValue([
      { index: 0, url: '/assets/img/map_themes/grass/block/Pimg2D000.gif' },
      { index: 1, url: '/assets/img/map_themes/grass/block/Pimg2D001.gif' },
    ]);
    mapBackgroundService.isValidIndex.mockResolvedValue(true);
    mapBackgroundService.getEffectiveUrl
      .mockResolvedValue('/assets/img/map_themes/grass/block/Pimg2D000.gif');

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

  describe('getMapBackgroundOptions', () => {
    it('resolves the theme from the owning colony and returns options', async () => {
      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(mapBackgroundService.listOptions).toHaveBeenCalledWith('grass', 'block');
      expect(result).toEqual({
        selectedIndex: null,
        effectiveIndex: 0,
        effectiveUrl: '/assets/img/map_themes/grass/block/Pimg2D000.gif',
        options: [
          { index: 0, url: '/assets/img/map_themes/grass/block/Pimg2D000.gif' },
          { index: 1, url: '/assets/img/map_themes/grass/block/Pimg2D001.gif' },
        ],
      });
    });

    it('returns the stored positive selection', async () => {
      blockRepository.find.mockResolvedValue({ ...fakeBlock, map_background_index: 1 } as Place);

      const result = await service.getMapBackgroundOptions(BLOCK_ID);

      expect(result.selectedIndex).toBe(1);
      expect(result.effectiveIndex).toBe(1);
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
