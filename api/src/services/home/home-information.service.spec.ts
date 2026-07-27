import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { HomeService } from './home.service';
import { MemberService } from '../member/member.service';
import { BlockService } from '../block/block.service';
import {
  PlaceRepository,
  MapLocationRepository,
  HomeDesignRepository,
  HomeRepository,
  RoleAssignmentRepository,
  RoleRepository,
} from '../../repositories';

/**
 * Coverage for the Home Information service contract.
 *
 * The property that matters most here is ownership: updateHomeInformation resolves the
 * target home from the AUTHENTICATED member id via updateHomeByMemberId (which scopes its
 * WHERE to type='home' AND member_id=?), so there is no code path in which a caller can
 * name someone else's home. These tests lock that in, plus the read path's refusal to
 * serve a non-home place's description through the home route.
 */
describe('HomeService home information', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let homeDesignRepository: jest.Mocked<HomeDesignRepository>;
  let homeRepository: jest.Mocked<HomeRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberService: jest.Mocked<MemberService>;
  let blockService: jest.Mocked<BlockService>;
  let service: HomeService;

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    homeDesignRepository = createSpyObj(HomeDesignRepository);
    homeRepository = createSpyObj(HomeRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberService = createSpyObj(MemberService);
    blockService = createSpyObj(BlockService);

    Container.reset();
    Container.set(PlaceRepository, placeRepository);
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(HomeDesignRepository, homeDesignRepository);
    Container.set(HomeRepository, homeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    Container.set(MemberService, memberService);
    Container.set(BlockService, blockService);
    service = Container.get(HomeService);
  });

  describe('getHomeInformation', () => {
    it('returns the description of a home place', async () => {
      placeRepository.findById.mockResolvedValue(
        { id: 42, type: 'home', description: 'Welcome to my home!' } as any,
      );

      await expect(service.getHomeInformation(42)).resolves.toBe('Welcome to my home!');
    });

    it('returns an empty string when the home has no description', async () => {
      placeRepository.findById.mockResolvedValue({ id: 42, type: 'home' } as any);

      await expect(service.getHomeInformation(42)).resolves.toBe('');
    });

    it('returns an empty string for a place that does not exist', async () => {
      placeRepository.findById.mockResolvedValue(undefined as any);

      await expect(service.getHomeInformation(999)).resolves.toBe('');
    });

    it('refuses to serve a non-home place description through the home route', async () => {
      // A club/block description must not become readable just because the caller asked
      // for it via /home/information/:placeId.
      placeRepository.findById.mockResolvedValue(
        { id: 7, type: 'club', description: 'Private club notes' } as any,
      );

      await expect(service.getHomeInformation(7)).resolves.toBe('');
    });
  });

  describe('updateHomeInformation', () => {
    it('updates the description of the authenticated member\'s own home', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue({ id: 42 } as any);

      await service.updateHomeInformation(5, 'A new description');

      expect(placeRepository.updateHomeByMemberId).toHaveBeenCalledWith(
        5,
        { description: 'A new description' },
      );
    });

    it('scopes the write to the session member id, never a supplied place id', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue({ id: 42 } as any);

      await service.updateHomeInformation(5, 'text');

      // The only identifier reaching the repository is the authenticated member id.
      const [memberId, props] = placeRepository.updateHomeByMemberId.mock.calls[0];
      expect(memberId).toBe(5);
      expect(props).toEqual({ description: 'text' });
      expect(placeRepository.findHomeByMemberId).toHaveBeenCalledWith(5);
    });

    it('stores an empty description as an intentional value', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue({ id: 42 } as any);

      await service.updateHomeInformation(5, '');

      expect(placeRepository.updateHomeByMemberId).toHaveBeenCalledWith(
        5,
        { description: '' },
      );
    });

    it('rejects a member who has no home, without writing anything', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue(undefined as any);

      await expect(service.updateHomeInformation(5, 'text'))
        .rejects.toThrow('You don\'t have a home yet.');
      expect(placeRepository.updateHomeByMemberId).not.toHaveBeenCalled();
    });
  });
});
