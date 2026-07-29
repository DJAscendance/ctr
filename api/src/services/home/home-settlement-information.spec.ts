import { INFORMATION_MAX_LENGTH } from '../../libs';
import { HomeService } from './home.service';

/**
 * The settlement path must enforce the SAME Information contract as the editor.
 *
 * THE BUG. `createHome` sanitized the text typed while settling in but never
 * applied the length limit - only the update route did. So a member could settle
 * with Information the editor would afterwards refuse to save back, and there
 * was no size bound on that write at all. QA found it by reading the two paths
 * side by side.
 *
 * Both paths now go through `canonicalizeInformation`, and these tests drive the
 * real service to prove it: over-limit settlement is refused BEFORE anything is
 * claimed or created, so there is no half-settled home to clean up.
 */
describe('HomeService.createHome Information handling', () => {
  let placeRepository: any;
  let mapLocationRepository: any;
  let homeRepository: any;
  let service: HomeService;

  const AVAILABLE_LOCATION = { available: true, place_id: 0, parent_place_id: 10 };

  beforeEach(() => {
    mapLocationRepository = {
      findByParentPlaceIdAndLocation: jest.fn().mockResolvedValue(AVAILABLE_LOCATION),
      claimLocation: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    placeRepository = {
      create: jest.fn().mockResolvedValue(4242),
      update: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({ id: 4242, type: 'home' }),
    };
    homeRepository = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    mapLocationRepository.create = jest.fn().mockResolvedValue(undefined);
    service = new HomeService(
      placeRepository, mapLocationRepository, null as any, homeRepository,
      null as any, null as any, null as any, null as any, null as any, null as any,
    );
  });

  const settle = (description: string) => service.createHome(
    5, 'Ryan', 'B', 10, 3, 'Ryan\'s Home', description, 1, null,
  );

  describe('over the limit', () => {
    const overLimit = 'a'.repeat(INFORMATION_MAX_LENGTH + 1);

    it('refuses settlement rather than storing unbounded Information', async () => {
      await expect(settle(overLimit)).rejects
        .toThrow(`Description must be ${INFORMATION_MAX_LENGTH} characters or fewer.`);
    });

    it('refuses BEFORE claiming a location or creating a place', async () => {
      await expect(settle(overLimit)).rejects.toThrow();

      // Nothing may have been touched - not even the availability lookup, since
      // the check runs first. This is what "no partial mutation" means here.
      expect(placeRepository.create).not.toHaveBeenCalled();
      expect(mapLocationRepository.claimLocation).not.toHaveBeenCalled();
      expect(mapLocationRepository.findByParentPlaceIdAndLocation)
        .not.toHaveBeenCalled();
    });

    it('refuses markup that only exceeds the limit AFTER canonicalization',
      async () => {
        // 3,500 raw characters, 5,250 canonical - the exact shape the editor
        // path was fixed for. Settlement must refuse it for the same reason.
        await expect(settle('<br>'.repeat(875))).rejects.toThrow(/3500 characters/);
        expect(placeRepository.create).not.toHaveBeenCalled();
      });
  });

  describe('within the limit', () => {
    it('stores the canonical value in `information`, never in `description`',
      async () => {
        await settle('<p>Welcome</p><script>alert(1)</script>');

        const [created] = placeRepository.create.mock.calls[0];
        expect(created.information).toEqual('<p>Welcome</p>');
        expect(created.description).toBeUndefined();
      });

    it('accepts exactly the limit', async () => {
      await settle('a'.repeat(INFORMATION_MAX_LENGTH));

      const [created] = placeRepository.create.mock.calls[0];
      expect(created.information.length).toEqual(INFORMATION_MAX_LENGTH);
    });

    it('accepts an empty description', async () => {
      await settle('');

      const [created] = placeRepository.create.mock.calls[0];
      expect(created.information).toEqual('');
    });
  });

  describe('the two write paths agree', () => {
    it('settlement and the editor canonicalize identically', async () => {
      const input = '<p>Hi</p><marquee>go</marquee><script>bad()</script>';

      await settle(input);
      const [created] = placeRepository.create.mock.calls[0];

      const updateRepository = {
        findHomeByMemberId: jest.fn().mockResolvedValue({ id: 4242 }),
        updateHomeByMemberId: jest.fn().mockResolvedValue(undefined),
      };
      const updateService = new HomeService(
        updateRepository as any, null as any, null as any, null as any,
        null as any, null as any, null as any, null as any, null as any, null as any,
      );
      await updateService.updateHomeInformation(5, input);
      const [, props] = updateRepository.updateHomeByMemberId.mock.calls[0];

      expect(created.information).toEqual(props.information);
    });
  });
});
