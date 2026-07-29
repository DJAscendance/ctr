import { PlaceRepository } from '../../repositories';
import { HomeService } from '../home/home.service';
import { PlaceInformationService } from './place-information.service';

/**
 * The boundary between the two authored-text fields on `place`.
 *
 * THE BUG THIS PINS. Both surfaces used to write `place.description`: the Admin
 * Panel as an administrative summary, the Information editors as public content.
 * Whoever saved last won, so manager-authored HTML showed up as the Description
 * in the admin place list, and an administrator retyping a description silently
 * destroyed the place's published Information.
 *
 * The contract now is one column each, and these tests assert the direction of
 * every write rather than merely that a write happened. `not.toHaveBeenCalled`
 * on the other field is the point - a test that only checked the field it cares
 * about would pass just as happily if both were written.
 */
describe('administrative Description and public Information do not compete', () => {
  const createSpyObj = <T>(): any => ({
    findById: jest.fn(),
    updateInformation: jest.fn().mockResolvedValue(undefined),
    updatePlaces: jest.fn().mockResolvedValue(undefined),
    findHomeByMemberId: jest.fn(),
    updateHomeByMemberId: jest.fn().mockResolvedValue(undefined),
  }) as unknown as T;

  describe('a manager editing Information', () => {
    it('writes information and never touches description', async () => {
      const placeRepository: any = createSpyObj<PlaceRepository>();
      placeRepository.findById.mockResolvedValue({
        id: 7, type: 'block', name: 'Dark Paradise', information: '<p>old</p>',
      });
      const service = new PlaceInformationService(
        placeRepository, null as any, null as any, null as any, null as any,
      );
      jest.spyOn(service as any, 'canEdit').mockResolvedValue(true);

      await service.updateInformation(7, 1, '<p>new</p>');

      expect(placeRepository.updateInformation)
        .toHaveBeenCalledWith(7, '<p>new</p>');
      // The only method that can write description is updatePlaces, and this
      // path must never reach it.
      expect(placeRepository.updatePlaces).not.toHaveBeenCalled();
    });

    it('reads information, not description, so an admin edit is invisible to it',
      async () => {
        const placeRepository: any = createSpyObj<PlaceRepository>();
        placeRepository.findById.mockResolvedValue({
          id: 7,
          type: 'public',
          name: 'Mall',
          description: 'mall',
          information: '<h3>Welcome to the Mall</h3>',
        });
        const service = new PlaceInformationService(
          placeRepository, null as any, null as any, null as any, null as any,
        );

        const info = await service.getInformation(7);

        expect(info?.description).toEqual('<h3>Welcome to the Mall</h3>');
      });
  });

  describe('a home owner editing Information', () => {
    it('writes information and never touches description', async () => {
      const placeRepository: any = createSpyObj<PlaceRepository>();
      placeRepository.findHomeByMemberId.mockResolvedValue({ id: 42 });
      const service = new HomeService(
        placeRepository, null as any, null as any, null as any, null as any,
        null as any, null as any, null as any, null as any, null as any,
      );

      await service.updateHomeInformation(5, 'Welcome to my house boat');

      const [, props] = placeRepository.updateHomeByMemberId.mock.calls[0];
      expect(Object.keys(props)).toEqual(['information']);
      expect(props.description).toBeUndefined();
    });
  });

  describe('an administrator editing the place', () => {
    /**
     * PlaceRepository.updatePlaces used to spread the request body straight into
     * the UPDATE, so it wrote whatever columns the caller happened to send -
     * including `information`. That is the whole reason the allowlist exists, so
     * it is asserted through the real repository with a fake query builder
     * rather than a mock of the method under test.
     */
    const updateWithBody = async (body: Record<string, unknown>) => {
      const update = jest.fn().mockResolvedValue(undefined);
      const where = jest.fn().mockReturnValue({ update });
      const knex = jest.fn().mockReturnValue({ where });
      const repository = new PlaceRepository({ knex } as any);

      await repository.updatePlaces(body);
      return { update, where };
    };

    it('writes the administrative columns it was given', async () => {
      const { update, where } = await updateWithBody({
        id: 7, name: 'The Mall', description: 'mall', slug: 'mall',
      });

      expect(where).toHaveBeenCalledWith('id', 7);
      expect(update).toHaveBeenCalledWith({
        name: 'The Mall', description: 'mall', slug: 'mall',
      });
    });

    it('drops an information field smuggled into the request body', async () => {
      const { update } = await updateWithBody({
        id: 7, description: 'mall', information: '<script>alert(1)</script>',
      });

      const [written] = update.mock.calls[0];
      expect(written).toEqual({ description: 'mall' });
      expect(written).not.toHaveProperty('information');
    });

    it('drops any other column that is not administrative', async () => {
      const { update } = await updateWithBody({
        id: 7, name: 'The Mall', member_id: 999, messageboard_intro: 'hi',
      });

      expect(update).toHaveBeenCalledWith({ name: 'The Mall' });
    });

    it('does not issue an update at all when nothing allowed was sent', async () => {
      const { update } = await updateWithBody({ id: 7, information: '<p>x</p>' });

      expect(update).not.toHaveBeenCalled();
    });
  });
});
