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

import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HoodService } from './hood.service';
import { MapBackgroundService } from '../map-background/map-background.service';
import {
  ColonyRepository,
  HoodRepository,
  MapLocationRepository,
  MemberRepository,
  PlaceRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';
import { Place } from '../../types/models';

describe('HoodService - map background selection', () => {
  const HOOD_ID = 60;
  const COLONY_ID = 7;

  const fakeHood: Partial<Place> = { id: HOOD_ID, type: 'hood', map_background_index: null };
  const cyberhoodColony: Partial<Place> = { id: COLONY_ID, type: 'colony', slug: 'cyberhood' };

  let colonyRepository: jest.Mocked<ColonyRepository>;
  let hoodRepository: jest.Mocked<HoodRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let placeRepository: jest.Mocked<PlaceRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let mapBackgroundService: jest.Mocked<MapBackgroundService>;
  let service: HoodService;

  beforeEach(() => {
    colonyRepository = createSpyObj(ColonyRepository);
    hoodRepository = createSpyObj(HoodRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    placeRepository = createSpyObj(PlaceRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberRepository = createSpyObj(MemberRepository);
    mapBackgroundService = createSpyObj(MapBackgroundService);

    hoodRepository.find.mockResolvedValue(fakeHood as Place);
    colonyRepository.find.mockResolvedValue(cyberhoodColony as Place);
    mapLocationRepository.findPlaceIdMapLocation.mockResolvedValue({
      place_id: HOOD_ID,
      parent_place_id: COLONY_ID,
    } as any);
    mapBackgroundService.listOptions.mockResolvedValue([
      { index: 0, url: '/assets/img/map_themes/cyberhood/hood/Pimg2D000.gif' },
    ]);
    mapBackgroundService.isValidIndex.mockResolvedValue(true);
    mapBackgroundService.getEffectiveUrl
      .mockResolvedValue('/assets/img/map_themes/cyberhood/hood/Pimg2D000.gif');

    Container.reset();
    Container.set(ColonyRepository, colonyRepository);
    Container.set(HoodRepository, hoodRepository);
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(PlaceRepository, placeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    Container.set(MemberRepository, memberRepository);
    Container.set(MapBackgroundService, mapBackgroundService);
    service = Container.get(HoodService);
  });

  describe('getMapBackgroundOptions', () => {
    it('resolves the theme from the owning colony and returns options', async () => {
      const result = await service.getMapBackgroundOptions(HOOD_ID);

      expect(mapBackgroundService.listOptions).toHaveBeenCalledWith('cyberhood', 'hood');
      expect(result.options).toEqual([
        { index: 0, url: '/assets/img/map_themes/cyberhood/hood/Pimg2D000.gif' },
      ]);
    });

    it('supports a high grass/hood index such as 26', async () => {
      colonyRepository.find
        .mockResolvedValue({ id: COLONY_ID, type: 'colony', slug: 'campus' } as Place);
      hoodRepository.find.mockResolvedValue({ ...fakeHood, map_background_index: 26 } as Place);
      mapBackgroundService.getEffectiveUrl
        .mockResolvedValue('/assets/img/map_themes/grass/hood/Pimg2D026.gif');

      const result = await service.getMapBackgroundOptions(HOOD_ID);

      expect(mapBackgroundService.listOptions).toHaveBeenCalledWith('grass', 'hood');
      expect(result.selectedIndex).toBe(26);
      expect(result.effectiveUrl).toBe('/assets/img/map_themes/grass/hood/Pimg2D026.gif');
    });

    it('returns null when the hood does not exist', async () => {
      hoodRepository.find.mockResolvedValue(undefined);

      const result = await service.getMapBackgroundOptions(HOOD_ID);

      expect(result).toBeNull();
    });

    it('returns null when the owning colony slug has no theme mapping', async () => {
      colonyRepository.find.mockResolvedValue({ ...cyberhoodColony, slug: 'unknown_col' } as Place);

      const result = await service.getMapBackgroundOptions(HOOD_ID);

      expect(result).toBeNull();
    });
  });

  describe('updateMapBackgroundSelection', () => {
    it('rejects an index outside the resolved pool (cyberhood/hood only has index 0)', async () => {
      mapBackgroundService.isValidIndex.mockResolvedValue(false);

      const result = await service.updateMapBackgroundSelection(HOOD_ID, 1);

      expect(placeRepository.updateMapBackgroundIndex).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'invalid' });
    });

    it('persists a reset to default as null', async () => {
      const result = await service.updateMapBackgroundSelection(HOOD_ID, null);

      expect(placeRepository.updateMapBackgroundIndex).toHaveBeenCalledWith(HOOD_ID, null);
      expect(result).toEqual({ status: 'success', selectedIndex: null });
    });

    it('canonicalizes a submitted 0 to null without validating against the pool', async () => {
      const result = await service.updateMapBackgroundSelection(HOOD_ID, 0);

      expect(mapBackgroundService.isValidIndex).not.toHaveBeenCalled();
      expect(placeRepository.updateMapBackgroundIndex).toHaveBeenCalledWith(HOOD_ID, null);
      expect(result).toEqual({ status: 'success', selectedIndex: null });
    });

    it('persists a valid positive index', async () => {
      const result = await service.updateMapBackgroundSelection(HOOD_ID, 1);

      expect(mapBackgroundService.isValidIndex).toHaveBeenCalledWith('cyberhood', 'hood', 1);
      expect(placeRepository.updateMapBackgroundIndex).toHaveBeenCalledWith(HOOD_ID, 1);
      expect(result).toEqual({ status: 'success', selectedIndex: 1 });
    });

    it('returns not_found when the hood does not exist', async () => {
      hoodRepository.find.mockResolvedValue(undefined);

      const result = await service.updateMapBackgroundSelection(HOOD_ID, 1);

      expect(result).toEqual({ status: 'not_found' });
    });
  });
});
