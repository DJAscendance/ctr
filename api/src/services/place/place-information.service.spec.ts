import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceRepository } from '../../repositories';
import { BlockService } from '../block/block.service';
import { ColonyService } from '../colony/colony.service';
import { HoodService } from '../hood/hood.service';
import { PlaceInformationService } from './place-information.service';
import { PlaceService } from './place.service';

/**
 * The security-relevant properties of staff-managed place information.
 *
 * The one that matters most: the place TYPE decides which scoped staff check
 * runs, and the type is read from the stored row. A caller who can reach the
 * endpoint must not be able to nominate a type or slug and thereby get a
 * different - weaker - check applied to a place they do not administer.
 */
describe('PlaceInformationService', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let placeService: jest.Mocked<PlaceService>;
  let blockService: jest.Mocked<BlockService>;
  let hoodService: jest.Mocked<HoodService>;
  let colonyService: jest.Mocked<ColonyService>;
  let service: PlaceInformationService;

  const MEMBER_ID = 42;

  const place = (overrides: Record<string, unknown> = {}): any => ({
    id: 7,
    name: 'Mall',
    slug: 'mall',
    type: 'public',
    description: '',
    ...overrides,
  });

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    placeService = createSpyObj(PlaceService);
    blockService = createSpyObj(BlockService);
    hoodService = createSpyObj(HoodService);
    colonyService = createSpyObj(ColonyService);

    Container.reset();
    Container.set(PlaceRepository, placeRepository);
    Container.set(PlaceService, placeService);
    Container.set(BlockService, blockService);
    Container.set(HoodService, hoodService);
    Container.set(ColonyService, colonyService);

    service = new PlaceInformationService(
      placeRepository, placeService, blockService, hoodService, colonyService,
    );

    placeService.canAdmin.mockResolvedValue(true);
    blockService.canAdmin.mockResolvedValue(true);
    hoodService.canAdmin.mockResolvedValue(true);
    colonyService.canAdmin.mockResolvedValue(true);
    placeRepository.updateDescription.mockResolvedValue(undefined as any);
  });

  describe('reading', () => {
    it('returns the stored description for a place', async () => {
      placeRepository.findById.mockResolvedValue(
        place({ description: '<p>Open daily.</p>' }),
      );

      await expect(service.getInformation(7)).resolves.toEqual({
        placeId: 7,
        name: 'Mall',
        type: 'public',
        description: '<p>Open daily.</p>',
      });
    });

    it('represents a place that has never been given information as empty', async () => {
      placeRepository.findById.mockResolvedValue(place({ description: null }));

      const info = await service.getInformation(7);

      expect(info?.description).toBe('');
    });

    it('returns null for a place that does not exist', async () => {
      placeRepository.findById.mockResolvedValue(undefined as any);

      await expect(service.getInformation(7)).resolves.toBeNull();
    });
  });

  describe('authorization is selected by the STORED place type', () => {
    it('checks the block staff role for a block', async () => {
      await service.canEdit(place({ type: 'block', slug: null, id: 11 }), MEMBER_ID);

      expect(blockService.canAdmin).toHaveBeenCalledWith(11, MEMBER_ID);
      expect(placeService.canAdmin).not.toHaveBeenCalled();
      expect(hoodService.canAdmin).not.toHaveBeenCalled();
      expect(colonyService.canAdmin).not.toHaveBeenCalled();
    });

    it('checks the neighborhood staff role for a hood', async () => {
      await service.canEdit(place({ type: 'hood', slug: null, id: 12 }), MEMBER_ID);

      expect(hoodService.canAdmin).toHaveBeenCalledWith(12, MEMBER_ID);
      expect(blockService.canAdmin).not.toHaveBeenCalled();
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });

    it('checks the colony staff role for a colony', async () => {
      await service.canEdit(place({ type: 'colony', slug: 'campus', id: 13 }), MEMBER_ID);

      expect(colonyService.canAdmin).toHaveBeenCalledWith(13, MEMBER_ID);
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });

    it('checks the scoped slug role for a public place, using the stored slug',
      async () => {
        await service.canEdit(place({ type: 'public', slug: 'mall', id: 7 }), MEMBER_ID);

        expect(placeService.canAdmin).toHaveBeenCalledWith('mall', 7, MEMBER_ID);
      });

    it('refuses a public place with no slug rather than falling through', async () => {
      await expect(
        service.canEdit(place({ type: 'public', slug: null }), MEMBER_ID),
      ).resolves.toBe(false);
      expect(placeService.canAdmin).not.toHaveBeenCalled();
    });

    it.each(['home', 'shop', 'club', 'storage', 'nonsense'])(
      'refuses the unsupported place type %s without consulting any staff check',
      async type => {
        await expect(
          service.canEdit(place({ type }), MEMBER_ID),
        ).resolves.toBe(false);
        expect(placeService.canAdmin).not.toHaveBeenCalled();
        expect(blockService.canAdmin).not.toHaveBeenCalled();
        expect(hoodService.canAdmin).not.toHaveBeenCalled();
        expect(colonyService.canAdmin).not.toHaveBeenCalled();
      },
    );

    it('propagates a refusal from the scoped check', async () => {
      placeService.canAdmin.mockResolvedValue(false);

      await expect(service.canEdit(place(), MEMBER_ID)).resolves.toBe(false);
    });
  });

  describe('updating', () => {
    it('sanitizes on write and stores the cleaned value', async () => {
      placeRepository.findById.mockResolvedValue(place());

      const result = await service.updateInformation(
        7, MEMBER_ID, '<p>Open <b>daily</b>.</p><script>alert(1)</script>',
      );

      expect(result).toEqual({
        status: 'success',
        description: '<p>Open <b>daily</b>.</p>',
      });
      expect(placeRepository.updateDescription)
        .toHaveBeenCalledWith(7, '<p>Open <b>daily</b>.</p>');
    });

    it('allows clearing the information', async () => {
      placeRepository.findById.mockResolvedValue(place({ description: '<p>x</p>' }));

      const result = await service.updateInformation(7, MEMBER_ID, '');

      expect(result).toEqual({ status: 'success', description: '' });
      expect(placeRepository.updateDescription).toHaveBeenCalledWith(7, '');
    });

    it('refuses an unauthorized member and writes nothing', async () => {
      placeRepository.findById.mockResolvedValue(place());
      placeService.canAdmin.mockResolvedValue(false);

      await expect(service.updateInformation(7, MEMBER_ID, 'hi'))
        .resolves.toEqual({ status: 'forbidden' });
      expect(placeRepository.updateDescription).not.toHaveBeenCalled();
    });

    it('refuses an unsupported place type and writes nothing', async () => {
      placeRepository.findById.mockResolvedValue(place({ type: 'home' }));

      await expect(service.updateInformation(7, MEMBER_ID, 'hi'))
        .resolves.toEqual({ status: 'unsupported' });
      expect(placeRepository.updateDescription).not.toHaveBeenCalled();
    });

    it('reports a missing place without consulting any staff check', async () => {
      placeRepository.findById.mockResolvedValue(undefined as any);

      await expect(service.updateInformation(7, MEMBER_ID, 'hi'))
        .resolves.toEqual({ status: 'not_found' });
      expect(placeService.canAdmin).not.toHaveBeenCalled();
      expect(placeRepository.updateDescription).not.toHaveBeenCalled();
    });

    it('measures length on the SUBMITTED text, before sanitizing', async () => {
      placeRepository.findById.mockResolvedValue(place());
      // Sanitizes down to nothing, but is far over the limit as submitted. If the
      // check ran after sanitizing, this would be accepted.
      const padding = '<script>x</script>'.repeat(1000);

      await expect(service.updateInformation(7, MEMBER_ID, padding))
        .resolves.toEqual({ status: 'too_long' });
      expect(placeRepository.updateDescription).not.toHaveBeenCalled();
    });

    it('accepts text exactly at the limit', async () => {
      placeRepository.findById.mockResolvedValue(place());
      const atLimit = 'a'.repeat(PlaceInformationService.INFORMATION_MAX_LENGTH);

      const result = await service.updateInformation(7, MEMBER_ID, atLimit);

      expect(result.status).toBe('success');
    });

    it('stays well under the TEXT column capacity', () => {
      // place.description is MySQL TEXT: 65535 bytes. The limit is a usability
      // bound on a staff notice, deliberately far below the storage bound.
      expect(PlaceInformationService.INFORMATION_MAX_LENGTH).toBeLessThan(65535);
    });
  });
});
