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
  TransactionRepository,
} from '../../repositories';

/**
 * Coverage for the properties of home reset that are expensive to get right and cheap to
 * break: the refund happening exactly once, the lot claim being decided by the database
 * rather than by a prior read, rollback leaving nothing half-done, and the image cleanup
 * obeying the PR #410 contract instead of reintroducing the historical delete.
 *
 * Deliberately NOT covered here: the shape of the reset page. That is ordinary UI and is
 * checked in the browser pass.
 */
describe('HomeService reset', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let mapLocationRepository: jest.Mocked<MapLocationRepository>;
  let homeDesignRepository: jest.Mocked<HomeDesignRepository>;
  let homeRepository: jest.Mocked<HomeRepository>;
  let roleAssignmentRepository: jest.Mocked<RoleAssignmentRepository>;
  let roleRepository: jest.Mocked<RoleRepository>;
  let memberRepository: jest.Mocked<MemberRepository>;
  let transactionRepository: jest.Mocked<TransactionRepository>;
  let memberService: jest.Mocked<MemberService>;
  let blockService: jest.Mocked<BlockService>;
  let service: HomeService;

  const fs = require('fs'); // eslint-disable-line @typescript-eslint/no-var-requires
  const fsNames = ['existsSync', 'readdirSync', 'mkdirSync', 'copyFileSync', 'renameSync',
    'unlinkSync'];
  let fsOriginals: { [k: string]: any };
  let unlinked: string[];

  const MEMBER_ID = 5;
  const HOME_PLACE_ID = 42;
  const WALLET_ID = 77;
  const BLOCK_ID = 1369;
  const NEW_LOT = 31;

  /** The home row as the transaction's FOR UPDATE read sees it. */
  let lockedHome: any;
  /** What findPlaceLocationWithin reports as the home's current lot. */
  let currentLocation: any;

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    mapLocationRepository = createSpyObj(MapLocationRepository);
    homeDesignRepository = createSpyObj(HomeDesignRepository);
    homeRepository = createSpyObj(HomeRepository);
    roleAssignmentRepository = createSpyObj(RoleAssignmentRepository);
    roleRepository = createSpyObj(RoleRepository);
    memberRepository = createSpyObj(MemberRepository);
    transactionRepository = createSpyObj(TransactionRepository);
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
    Container.set(TransactionRepository, transactionRepository);
    Container.set(MemberService, memberService);
    Container.set(BlockService, blockService);
    service = Container.get(HomeService);

    lockedHome = {
      place_id: HOME_PLACE_ID,
      home_design_id: null,
      image: null,
      image_status: 'none',
      image_revision: null,
    };
    currentLocation = { parent_place_id: BLOCK_ID, location: 7 };

    placeRepository.findHomeByMemberId.mockResolvedValue({ id: HOME_PLACE_ID } as any);
    placeRepository.findById.mockResolvedValue({ id: BLOCK_ID, type: 'block' } as any);
    memberRepository.findById.mockResolvedValue(
      { id: MEMBER_ID, username: 'Citizen', wallet_id: WALLET_ID } as any,
    );
    memberService.getDonorLevel.mockResolvedValue(null as any);
    homeRepository.runInTransaction.mockImplementation((work: any) => work({}));
    homeRepository.lockHome.mockImplementation(async () => lockedHome);
    mapLocationRepository.findPlaceLocationWithin.mockImplementation(
      async () => currentLocation,
    );
    mapLocationRepository.lockLocationsWithin.mockResolvedValue(undefined);
    mapLocationRepository.claimLocationWithin.mockResolvedValue(true);
    mapLocationRepository.releaseLocationWithin.mockResolvedValue(undefined);
    placeRepository.updateHomeByMemberIdWithin.mockResolvedValue(undefined);
    homeRepository.updateWithin.mockResolvedValue(undefined);
    transactionRepository.createHomeRefundTransactionWithin.mockResolvedValue(undefined);

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
  });

  function reset(location = NEW_LOT) {
    return service.resetHome(MEMBER_ID, BLOCK_ID, location);
  }

  describe('ownership and target validation', () => {
    it('rejects a member with no home without touching anything', async () => {
      placeRepository.findHomeByMemberId.mockResolvedValue(undefined as any);

      await expect(reset()).rejects.toThrow('You don\'t have a home yet.');
      expect(homeRepository.runInTransaction).not.toHaveBeenCalled();
      expect(transactionRepository.createHomeRefundTransactionWithin).not.toHaveBeenCalled();
    });

    it('refuses a target that is not a block', async () => {
      // Without this a caller could name a colony, a hood, or another member's home.
      placeRepository.findById.mockResolvedValue({ id: 999, type: 'colony' } as any);

      await expect(reset()).rejects.toThrow('Location is not available.');
      expect(homeRepository.runInTransaction).not.toHaveBeenCalled();
    });

    it('refuses a target block that does not exist', async () => {
      placeRepository.findById.mockResolvedValue(undefined as any);

      await expect(reset()).rejects.toThrow('Location is not available.');
      expect(homeRepository.runInTransaction).not.toHaveBeenCalled();
    });

    it('resolves the home from the member id, never from a supplied place id', async () => {
      await reset();

      expect(placeRepository.findHomeByMemberId).toHaveBeenCalledWith(MEMBER_ID);
      expect(placeRepository.updateHomeByMemberIdWithin)
        .toHaveBeenCalledWith({}, MEMBER_ID, expect.anything());
    });
  });

  describe('lot claim', () => {
    it('claims the lot through the conditional update, not a prior read', async () => {
      await reset();

      expect(mapLocationRepository.claimLocationWithin)
        .toHaveBeenCalledWith({}, BLOCK_ID, NEW_LOT, HOME_PLACE_ID);
    });

    it('locks both lots before claiming, so ordering is imposed centrally', async () => {
      await reset();

      const [, keys] = mapLocationRepository.lockLocationsWithin.mock.calls[0];
      expect(keys).toEqual(expect.arrayContaining([
        { parentPlaceId: BLOCK_ID, location: NEW_LOT },
        { parentPlaceId: BLOCK_ID, location: 7 },
      ]));
      const claimOrder = mapLocationRepository.claimLocationWithin.mock.invocationCallOrder[0];
      const lockOrder = mapLocationRepository.lockLocationsWithin.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(claimOrder);
    });

    it('loses the race cleanly when the lot was taken first', async () => {
      // The competing request claimed it between the map render and this claim: the
      // conditional UPDATE matches 0 rows and reports false.
      mapLocationRepository.claimLocationWithin.mockResolvedValue(false);

      await expect(reset()).rejects.toThrow('Location already taken.');
      // Nothing else may have happened - the throw aborts the transaction.
      expect(mapLocationRepository.releaseLocationWithin).not.toHaveBeenCalled();
      expect(homeRepository.updateWithin).not.toHaveBeenCalled();
      expect(transactionRepository.createHomeRefundTransactionWithin).not.toHaveBeenCalled();
    });

    it('frees the old lot only after the new one is claimed', async () => {
      await reset();

      const claimOrder = mapLocationRepository.claimLocationWithin.mock.invocationCallOrder[0];
      const releaseOrder =
        mapLocationRepository.releaseLocationWithin.mock.invocationCallOrder[0];
      expect(claimOrder).toBeLessThan(releaseOrder);
      expect(mapLocationRepository.releaseLocationWithin)
        .toHaveBeenCalledWith({}, BLOCK_ID, 7, HOME_PLACE_ID);
    });

    it('does not claim or release when resetting onto the home\'s current lot', async () => {
      await reset(7);

      expect(mapLocationRepository.claimLocationWithin).not.toHaveBeenCalled();
      expect(mapLocationRepository.releaseLocationWithin).not.toHaveBeenCalled();
      // The rest of the reset still happens.
      expect(homeRepository.updateWithin).toHaveBeenCalled();
    });

    it('claims without releasing when the home currently has no lot', async () => {
      currentLocation = undefined;

      await reset();

      expect(mapLocationRepository.claimLocationWithin).toHaveBeenCalled();
      expect(mapLocationRepository.releaseLocationWithin).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('pays the design price once when a paid design is cleared', async () => {
      lockedHome.home_design_id = '006';
      homeDesignRepository.find.mockReturnValue({ id: '006', price: 2000 } as any);

      await reset();

      expect(transactionRepository.createHomeRefundTransactionWithin)
        .toHaveBeenCalledTimes(1);
      expect(transactionRepository.createHomeRefundTransactionWithin)
        .toHaveBeenCalledWith({}, WALLET_ID, 2000);
    });

    it('pays nothing when the home had no design', async () => {
      lockedHome.home_design_id = null;

      await reset();

      expect(transactionRepository.createHomeRefundTransactionWithin).not.toHaveBeenCalled();
    });

    it('is exactly-once: a second reset sees an already-cleared design', async () => {
      // This is the whole idempotency argument. The first reset clears home_design_id in
      // the same transaction that pays the refund, so a duplicate submit, a client retry
      // or a concurrent second request reads null under the row lock and pays nothing.
      // Modelled the way the database actually behaves: lockHome returns a SNAPSHOT of the
      // stored row, and updateWithin writes to storage. (Returning the mutable row object
      // itself would be unrealistic - the real service decides the refund from the value it
      // read under the lock, before its own update lands.)
      const stored: any = { ...lockedHome, home_design_id: '006' };
      homeRepository.lockHome.mockImplementation(async () => ({ ...stored }));
      homeRepository.updateWithin.mockImplementation(async (_trx, _id, props: any) => {
        Object.assign(stored, props);
      });
      homeDesignRepository.find.mockReturnValue({ id: '006', price: 2000 } as any);

      await reset();
      await reset();

      expect(stored.home_design_id).toBeNull();

      expect(transactionRepository.createHomeRefundTransactionWithin)
        .toHaveBeenCalledTimes(1);
    });

    it('refunds nothing to a Champion holding the champion home', async () => {
      // They were charged nothing for it - same rule updateHome applies.
      lockedHome.home_design_id = 'championhome';
      homeDesignRepository.find.mockReturnValue(
        { id: 'championhome', price: 5000 } as any,
      );
      memberService.getDonorLevel.mockResolvedValue({ name: 'Champion' } as any);

      await reset();

      expect(transactionRepository.createHomeRefundTransactionWithin).not.toHaveBeenCalled();
    });

    it('refunds a non-Champion holding the champion home', async () => {
      lockedHome.home_design_id = 'championhome';
      homeDesignRepository.find.mockReturnValue(
        { id: 'championhome', price: 5000 } as any,
      );
      memberService.getDonorLevel.mockResolvedValue(null as any);

      await reset();

      expect(transactionRepository.createHomeRefundTransactionWithin)
        .toHaveBeenCalledWith({}, WALLET_ID, 5000);
    });

    it('takes the price from stored data, never from anything the caller supplies', async () => {
      lockedHome.home_design_id = '003';
      homeDesignRepository.find.mockReturnValue({ id: '003', price: 160 } as any);

      await reset();

      expect(homeDesignRepository.find).toHaveBeenCalledWith('003');
      expect(transactionRepository.createHomeRefundTransactionWithin)
        .toHaveBeenCalledWith({}, WALLET_ID, 160);
    });

    it('pays the refund inside the caller\'s transaction, not its own', async () => {
      lockedHome.home_design_id = '006';
      homeDesignRepository.find.mockReturnValue({ id: '006', price: 2000 } as any);

      await reset();

      // The trx handle reaching the ledger is the same one the reset is running in.
      const [trx] = transactionRepository.createHomeRefundTransactionWithin.mock.calls[0];
      expect(trx).toBe(homeRepository.lockHome.mock.calls[0][0]);
      // The self-transacting helper must not be used - it would commit separately.
      expect(transactionRepository.createHomeRefundTransaction).not.toHaveBeenCalled();
    });
  });

  describe('rollback integrity', () => {
    it('pays no refund when the transaction fails after the decision', async () => {
      lockedHome.home_design_id = '006';
      homeDesignRepository.find.mockReturnValue({ id: '006', price: 2000 } as any);
      // Simulate the commit failing: runInTransaction rejects, so nothing inside it applied.
      homeRepository.runInTransaction.mockImplementation(async (work: any) => {
        await work({});
        throw new Error('commit failed');
      });

      await expect(reset()).rejects.toThrow('commit failed');
      // The refund call was issued INSIDE the transaction, so the rollback undoes it - the
      // point being that it can never be durable while the design clear is not.
      const refundTrx =
        transactionRepository.createHomeRefundTransactionWithin.mock.calls[0][0];
      expect(refundTrx).toBe(homeRepository.lockHome.mock.calls[0][0]);
    });

    it('does not clean up files when the transaction failed', async () => {
      lockedHome.image_revision = 'rev-abc';
      homeRepository.runInTransaction.mockRejectedValue(new Error('deadlock'));

      await expect(reset()).rejects.toThrow('deadlock');
      expect(unlinked).toEqual([]);
    });
  });

  describe('image boundary (PR #410)', () => {
    it('commits the ("none", null) state the cleanup contract expects', async () => {
      await reset();

      const [, , props] = homeRepository.updateWithin.mock.calls[0];
      expect(props).toEqual({
        home_design_id: null,
        image: null,
        image_status: 'none',
        image_revision: null,
        image_checked_by: null,
        image_checked_at: null,
      });
    });

    it('clears image state under the same row lock as every other image mutation', async () => {
      await reset();

      const lockOrder = homeRepository.lockHome.mock.invocationCallOrder[0];
      const updateOrder = homeRepository.updateWithin.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(updateOrder);
    });

    it('deletes only the exact pending revision captured under the lock', async () => {
      lockedHome.image_revision = 'rev-abc';

      await reset();

      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]).toContain(`${HOME_PLACE_ID}-rev-abc.webp`);
      // Never a glob, and never another revision's file.
      expect(unlinked[0]).not.toContain('*');
    });

    it('deletes no private revision file when there was no image', async () => {
      lockedHome.image_revision = null;

      await reset();

      // The state-guarded public cleanup still runs and is correct to run - with no image
      // there is simply nothing on disk for it to remove (fs.existsSync is forced true
      // here, so it is exercised). What must NOT happen is a revision-named private delete.
      expect(unlinked.filter(path => /\d+-[0-9a-z-]+\.webp$/.test(path))).toEqual([]);
    });

    it('leaves a newer operation\'s public image alone (delayed stale cleanup)', async () => {
      // The reset committed, then an upload committed in the gap. The state-guarded helper
      // re-locks, sees the home is no longer ('none', null), and must not delete.
      lockedHome.image_revision = 'rev-old';
      let lockCount = 0;
      homeRepository.lockHome.mockImplementation(async () => {
        lockCount += 1;
        if (lockCount === 1) return lockedHome;
        // The post-commit re-lock sees a NEWER upload's state.
        return {
          place_id: HOME_PLACE_ID,
          image_status: 'pending',
          image_revision: 'rev-new',
        };
      });

      await reset();

      // Only the old private revision goes; the public file is left to its new owner.
      expect(unlinked).toEqual([
        expect.stringContaining(`${HOME_PLACE_ID}-rev-old.webp`),
      ]);
    });

    it('deletes the public file when the record still reads ("none", null)', async () => {
      lockedHome.image_revision = 'rev-old';
      let lockCount = 0;
      homeRepository.lockHome.mockImplementation(async () => {
        lockCount += 1;
        if (lockCount === 1) return lockedHome;
        return { place_id: HOME_PLACE_ID, image_status: 'none', image_revision: null };
      });

      await reset();

      expect(unlinked).toEqual([
        expect.stringContaining(`${HOME_PLACE_ID}-rev-old.webp`),
        expect.stringContaining(`${HOME_PLACE_ID}.webp`),
      ]);
    });

    it('still reports success when filesystem cleanup fails', async () => {
      // Database truth is already durable; a failed unlink must not undo a committed reset.
      lockedHome.image_revision = 'rev-abc';
      fs.unlinkSync = jest.fn(() => { throw new Error('EACCES'); });

      await expect(reset()).resolves.toBeUndefined();
      expect(homeRepository.updateWithin).toHaveBeenCalled();
    });
  });
});
