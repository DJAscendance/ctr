import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HomeService } from './home.service';
import {
  PlaceRepository,
  MapLocationRepository,
  HomeDesignRepository,
  HomeRepository,
  RoleAssignmentRepository,
  RoleRepository,
  MemberRepository,
} from '../../repositories';

/**
 * Regression coverage for the home-image moderation concurrency contract: an approval (or
 * rejection) must act on ONLY the exact image revision the moderator reviewed. If the owner
 * replaced the image since the moderator loaded the queue - so the currently-pending revision
 * differs from the reviewed one - the operation must be refused (409 conflict) WITHOUT writing
 * anything. This is the check whose absence let an approval begun for image A publish an
 * unchecked image B. The true cross-process race is exercised by the integration QA script
 * api/qa/home-image-moderation-race.sh; these hermetic unit tests lock in the binding logic.
 */
describe('HomeService image moderation revision binding', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let homeDesignRepository: jest.Mocked<HomeDesignRepository>;
  let homeRepository: jest.Mocked<HomeRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let service: HomeService;

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    homeDesignRepository = createSpyObj(HomeDesignRepository);
    homeRepository = createSpyObj(HomeRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberRepository = createSpyObj(MemberRepository);

    Container.reset();
    Container.set(PlaceRepository, placeRepository);
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(HomeDesignRepository, homeDesignRepository);
    Container.set(HomeRepository, homeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    Container.set(MemberRepository, memberRepository);
    service = Container.get(HomeService);

    // runInTransaction simply runs the callback with a dummy transaction handle.
    homeRepository.runInTransaction.mockImplementation((work: any) => work({}));
  });

  it('refuses approval when the reviewed revision no longer matches, without writing', async () => {
    homeRepository.lockHome.mockResolvedValue({
      place_id: 1694,
      image: '1694.webp',
      image_status: 'pending',
      image_revision: 'current-revision',
    } as any);

    await expect(
      service.approveHomeImage(1694, 42, 'stale-reviewed-revision'),
    ).rejects.toMatchObject({ status: 409 });

    // Nothing was published or recorded.
    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
  });

  it('refuses approval when no reviewed revision is supplied', async () => {
    await expect(
      service.approveHomeImage(1694, 42, ''),
    ).rejects.toMatchObject({ status: 409 });
    expect(homeRepository.lockHome).not.toHaveBeenCalled();
    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
  });

  it('refuses rejection when the reviewed revision no longer matches', async () => {
    homeRepository.lockHome.mockResolvedValue({
      place_id: 1694,
      image: '1694.webp',
      image_status: 'pending',
      image_revision: 'current-revision',
    } as any);

    await expect(
      service.rejectHomeImage(1694, 42, 'stale-reviewed-revision'),
    ).rejects.toMatchObject({ status: 409 });

    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
  });

  it('does not approve when there is no pending image', async () => {
    homeRepository.lockHome.mockResolvedValue({
      place_id: 1694,
      image: null,
      image_status: 'none',
      image_revision: null,
    } as any);

    await expect(
      service.approveHomeImage(1694, 42, 'any-revision'),
    ).rejects.toThrow('No pending image to approve.');
    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
  });
});
