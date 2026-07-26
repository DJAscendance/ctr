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
  MemberRepository,
} from '../../repositories';

/**
 * Regression coverage for the home-image moderation concurrency contract.
 *
 * Two properties are locked in here:
 *  1. Approval/rejection act ONLY on the exact revision the moderator reviewed - a mismatched
 *     or absent revision is refused (409) and nothing is written. (revision binding)
 *  2. Post-commit filesystem cleanup can never delete files that belong to a NEWER operation.
 *     Every deletion of the shared canonical public file goes through a state-guarded re-lock
 *     that skips the delete if a later operation changed the status/revision; every private
 *     deletion targets a single captured immutable revision, never a wildcard. (cleanup safety)
 *
 * The true cross-process race is also exercised by the integration QA script
 * api/qa/home-image-moderation-race.sh; these hermetic tests make each guarded decision
 * deterministic by controlling exactly what the re-lock observes.
 */
describe('HomeService image moderation', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let homeDesignRepository: jest.Mocked<HomeDesignRepository>;
  let homeRepository: jest.Mocked<HomeRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let memberService: jest.Mocked<MemberService>;
  let blockService: jest.Mocked<BlockService>;
  let service: HomeService;

  // The service accesses the filesystem via `const fs = require('fs')`, so we monkeypatch the
  // cached fs module object (the same reference the service holds) to capture effects on disk.
  const fs = require('fs'); // eslint-disable-line @typescript-eslint/no-var-requires
  const fsNames = ['existsSync', 'readdirSync', 'mkdirSync', 'copyFileSync', 'renameSync',
    'unlinkSync'];
  let fsOriginals: { [k: string]: any };
  let unlinked: string[];

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    homeDesignRepository = createSpyObj(HomeDesignRepository);
    homeRepository = createSpyObj(HomeRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberRepository = createSpyObj(MemberRepository);
    memberService = createSpyObj(MemberService);
    blockService = createSpyObj(BlockService);

    Container.reset();
    Container.set(PlaceRepository, placeRepository);
    Container.set(MapLocationRepository, mapLocationRepository);
    Container.set(HomeDesignRepository, homeDesignRepository);
    Container.set(HomeRepository, homeRepository);
    Container.set(RoleAssignmentRepository, roleAssignmentRepository);
    Container.set(RoleRepository, roleRepository);
    Container.set(MemberRepository, memberRepository);
    Container.set(MemberService, memberService);
    Container.set(BlockService, blockService);
    service = Container.get(HomeService);

    // runInTransaction simply runs the callback with a dummy transaction handle.
    homeRepository.runInTransaction.mockImplementation((work: any) => work({}));

    // Capture filesystem effects without touching disk.
    unlinked = [];
    fsOriginals = {};
    for (const name of fsNames) {
      fsOriginals[name] = fs[name];
    }
    fs.existsSync = jest.fn(() => true);
    fs.readdirSync = jest.fn(() => []);
    fs.mkdirSync = jest.fn();
    fs.copyFileSync = jest.fn();
    fs.renameSync = jest.fn();
    fs.unlinkSync = jest.fn((p: any) => { unlinked.push(String(p)); });
  });

  afterEach(() => {
    for (const name of fsNames) {
      fs[name] = fsOriginals[name];
    }
    jest.restoreAllMocks();
  });

  // ---- 1. revision binding ------------------------------------------------------------------

  it('refuses approval when the reviewed revision no longer matches, without writing', async () => {
    homeRepository.lockHome.mockResolvedValue({
      place_id: 1694, image: '1694.webp', image_status: 'pending', image_revision: 'current',
    } as any);

    await expect(
      service.approveHomeImage(1694, 42, 'stale'),
    ).rejects.toMatchObject({ status: 409 });
    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
    expect(fs.renameSync).not.toHaveBeenCalled();
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
      place_id: 1694, image: '1694.webp', image_status: 'pending', image_revision: 'current',
    } as any);

    await expect(
      service.rejectHomeImage(1694, 42, 'stale'),
    ).rejects.toMatchObject({ status: 409 });
    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
  });

  it('does not approve when there is no pending image', async () => {
    homeRepository.lockHome.mockResolvedValue({
      place_id: 1694, image: null, image_status: 'none', image_revision: null,
    } as any);

    await expect(
      service.approveHomeImage(1694, 42, 'any'),
    ).rejects.toThrow('No pending image to approve.');
    expect(homeRepository.updateWithin).not.toHaveBeenCalled();
  });

  // ---- 2. post-commit cleanup safety --------------------------------------------------------

  // Builds a mocked home row for lockHome.
  const homeRow = (status: string, revision: string | null): any => ({
    place_id: 1694,
    image: status === 'none' || status === 'rejected' ? null : '1694.webp',
    image_status: status,
    image_revision: revision,
  });
  const deletedPublic = () => unlinked.some(p => p.endsWith('/homes-uploads/1694.webp'));
  const deletedPrivate = (rev: string) => unlinked.some(p => p.endsWith(`1694-${rev}.webp`));

  it('remove deletes only the captured revision and spares a concurrent upload that took over',
    async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue({ id: 1694 } as any);
      // 1st lock (the clear) sees revision A; 2nd lock (guarded public cleanup) sees a
      // concurrent upload that has already made the home pending revision B.
      homeRepository.lockHome
        .mockResolvedValueOnce(homeRow('pending', 'A'))
        .mockResolvedValueOnce(homeRow('pending', 'B'));
      roleRepository.roleMap = {} as any;

      await service.removeHomeImage(7);

      // Only revision A's private file is deleted; B's file and the public file are untouched.
      expect(deletedPrivate('A')).toBe(true);
      expect(deletedPrivate('B')).toBe(false);
      expect(deletedPublic()).toBe(false);
    });

  it('reject does NOT delete the public file when a later upload+approval took over the home',
    async () => {
      // 1st lock (reject A) sees pending A; 2nd lock (guarded cleanup, expects rejected/null)
      // sees that a later upload+approval has since published revision B (status approved).
      homeRepository.lockHome
        .mockResolvedValueOnce(homeRow('pending', 'A'))
        .mockResolvedValueOnce(homeRow('approved', 'B'));

      await service.rejectHomeImage(1694, 42, 'A');

      expect(deletedPrivate('A')).toBe(true);   // its own private file
      expect(deletedPublic()).toBe(false);      // NOT the newly-approved public file
    });

  it('reject DOES delete the public file when the home is still in the rejected state',
    async () => {
      homeRepository.lockHome
        .mockResolvedValueOnce(homeRow('pending', 'A'))
        .mockResolvedValueOnce(homeRow('rejected', null));

      await service.rejectHomeImage(1694, 42, 'A');

      expect(deletedPublic()).toBe(true);
    });

  it('approval rollback removes a published public file when the DB update fails', async () => {
    // Publish succeeds, then the DB update throws -> the transaction rolls back to pending. The
    // compensation must remove the public file it published (home still pending revision R).
    homeRepository.lockHome
      .mockResolvedValueOnce(homeRow('pending', 'R'))
      .mockResolvedValueOnce(homeRow('pending', 'R'));
    homeRepository.updateWithin.mockRejectedValueOnce(new Error('db down'));

    await expect(service.approveHomeImage(1694, 42, 'R')).rejects.toThrow('db down');
    expect(deletedPublic()).toBe(true);   // compensation deleted the published canonical file
  });

  // ---- 3. block-level authorization ---------------------------------------------------------
  //
  // canModerateHome is the single decision path: a global admin may moderate any home; anyone
  // else may moderate only a home whose block they administer (BlockService.canAdmin, the same
  // predicate that gates the CHECK button). The block is resolved from server-side data
  // (map_location -> parent_place_id), never from client input.

  // Points getHomeBlock(homePlaceId) at a block place id: home -> map_location -> block.
  const homeInBlock = (blockId: number) => {
    mapLocationRepository.findPlaceIdMapLocation.mockResolvedValue(
      { parent_place_id: blockId } as any,
    );
    placeRepository.findById.mockResolvedValue({ id: blockId } as any);
  };

  it('admin may moderate any home without needing block authority', async () => {
    memberService.canAdmin.mockResolvedValue(true);

    await expect(service.canModerateHome(1694, 42)).resolves.toBe(true);
    // Short-circuits on the global admin check; block authority is never consulted.
    expect(blockService.canAdmin).not.toHaveBeenCalled();
  });

  it('block leader may moderate a home in the block they administer', async () => {
    memberService.canAdmin.mockResolvedValue(false);
    homeInBlock(500);
    blockService.canAdmin.mockImplementation(
      async (blockId: number) => blockId === 500,
    );

    await expect(service.canModerateHome(1694, 42)).resolves.toBe(true);
    expect(blockService.canAdmin).toHaveBeenCalledWith(500, 42);
  });

  it('block leader may NOT moderate a home in a different block', async () => {
    memberService.canAdmin.mockResolvedValue(false);
    homeInBlock(999); // home lives in block 999
    // The member only administers block 500, not 999.
    blockService.canAdmin.mockImplementation(
      async (blockId: number) => blockId === 500,
    );

    await expect(service.canModerateHome(1694, 42)).resolves.toBe(false);
  });

  it('ordinary member (no admin, no block authority) may not moderate', async () => {
    memberService.canAdmin.mockResolvedValue(false);
    homeInBlock(500);
    blockService.canAdmin.mockResolvedValue(false);

    await expect(service.canModerateHome(1694, 42)).resolves.toBe(false);
  });

  it('denies moderation when the home/block cannot be resolved', async () => {
    memberService.canAdmin.mockResolvedValue(false);
    mapLocationRepository.findPlaceIdMapLocation.mockRejectedValue(new Error('no such home'));

    await expect(service.canModerateHome(123456, 42)).resolves.toBe(false);
    expect(blockService.canAdmin).not.toHaveBeenCalled();
  });

  // ---- 4. server-side queue filtering -------------------------------------------------------

  const pendingRows = [
    { placeId: 11, ownerUsername: 'a', homeName: 'A', blockId: 500, blockName: 'Blk500',
      revision: 'r1' },
    { placeId: 22, ownerUsername: 'b', homeName: 'B', blockId: 999, blockName: 'Blk999',
      revision: 'r2' },
    { placeId: 33, ownerUsername: 'c', homeName: 'C', blockId: 500, blockName: 'Blk500',
      revision: 'r3' },
    { placeId: 44, ownerUsername: 'd', homeName: 'D', blockId: null, blockName: null,
      revision: 'r4' },
  ];

  it('admin receives the complete pending queue', async () => {
    homeRepository.findPendingImageHomes.mockResolvedValue(pendingRows as any);
    memberService.canAdmin.mockResolvedValue(true);

    const queue = await service.getModerationQueue(7);

    expect(queue.map(q => q.placeId)).toEqual([11, 22, 33, 44]);
    // The private preview endpoint URL is used, never a public asset path.
    expect(queue[0].imageUrl).toBe('/home/moderation/11/image');
    expect(blockService.canAdmin).not.toHaveBeenCalled();
  });

  it('block leader receives only pending homes in the block(s) they administer', async () => {
    homeRepository.findPendingImageHomes.mockResolvedValue(pendingRows as any);
    memberService.canAdmin.mockResolvedValue(false);
    // Leader of block 500 only.
    blockService.canAdmin.mockImplementation(async (blockId: number) => blockId === 500);

    const queue = await service.getModerationQueue(7);

    // Rows 11 and 33 (block 500) only; block 999 and the unresolved-block row are excluded.
    expect(queue.map(q => q.placeId)).toEqual([11, 33]);
    // Block authority is resolved once per distinct block id, not once per row.
    expect(blockService.canAdmin).toHaveBeenCalledTimes(2);
  });

  it('member with no block authority receives an empty queue', async () => {
    homeRepository.findPendingImageHomes.mockResolvedValue(pendingRows as any);
    memberService.canAdmin.mockResolvedValue(false);
    blockService.canAdmin.mockResolvedValue(false);

    const queue = await service.getModerationQueue(7);

    expect(queue).toEqual([]);
  });
});
