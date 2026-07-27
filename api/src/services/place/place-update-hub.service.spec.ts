import { Container } from 'typedi';
import { createSpyObj } from 'jest-createspyobj';

import { PlaceRepository } from '../../repositories';
import { BlockService } from '../block/block.service';
import { ColonyService } from '../colony/colony.service';
import { HoodService } from '../hood/hood.service';
import { MemberService } from '../member/member.service';
import { PlaceInformationService } from './place-information.service';
import { PlaceUpdateHubService } from './place-update-hub.service';

/**
 * Capability resolution for the scoped place Update hubs.
 *
 * Three properties are load-bearing and each is pinned below:
 *
 *  1. NO STRUCTURAL COLONY CAPABILITY EXISTS. Not for a Colony Leader, not for a
 *     Colony Deputy, not for a global Admin. Cybertown's colony maps were custom
 *     image maps whose coordinates were hard-coded in the server's own template,
 *     so no user-facing role ever had this power. The assertion is written against
 *     the WHOLE capability list rather than a named capability, so inventing one
 *     later fails this test instead of silently shipping.
 *
 *  2. "May open the hub" is not "may do everything in it". `canManageAccess`
 *     excludes each tier's own deputy where `canAdmin` admits them, so a Colony
 *     Deputy sees the hub and Information but not Access Rights.
 *
 *  3. The place TYPE comes from the stored row. A caller cannot nominate a type,
 *     slug or parent id to get a weaker scoped check applied.
 *
 * See docs/research/classic-update-hierarchy-matrix.md sections 0.1, 2.2 and 3.
 */
describe('PlaceUpdateHubService', () => {
  let placeRepository: jest.Mocked<PlaceRepository>;
  let placeInformationService: jest.Mocked<PlaceInformationService>;
  let blockService: jest.Mocked<BlockService>;
  let hoodService: jest.Mocked<HoodService>;
  let colonyService: jest.Mocked<ColonyService>;
  let memberService: jest.Mocked<MemberService>;
  let service: PlaceUpdateHubService;

  const MEMBER_ID = 42;

  const place = (overrides: Record<string, unknown> = {}): any => ({
    id: 7,
    name: 'Yerba Buena',
    slug: 'yerbabuena',
    type: 'colony',
    description: '',
    ...overrides,
  });

  /**
   * The complete set of capabilities this service is allowed to grant.
   *
   * Asserting granted ⊆ this list is the guard against a structural capability
   * being introduced later: a new capability that is not added here fails the
   * test rather than shipping silently. A substring heuristic was tried first and
   * rejected - `list_neighborhoods` is a READ-ONLY listing and would trip any
   * "contains 'neighborhood'" rule, which would have taught the next reader to
   * loosen the assertion rather than tighten the code.
   */
  const ALLOWED_CAPABILITIES = [
    'update_information',
    'manage_access_rights',
    'message_to_all',
    'inbox_to_all',
    'moderate_messageboard',
    'moderate_inbox',
    'check_images',
    'manage_lots',
    'manage_background',
    'list_neighborhoods',
    'list_blocks',
  ];

  /**
   * Capabilities that must never exist at any tier for any actor. Named
   * explicitly so the intent survives even if the allowlist is edited.
   */
  const FORBIDDEN_CAPABILITIES = [
    'create_neighborhood',
    'remove_neighborhood',
    'reposition_neighborhood',
    'edit_colony_map',
    'edit_map_coordinates',
    'upload_colony_map',
    'create_block',
    'remove_block',
    'delete_block',
    'chat_access',
  ];

  function expectNoStructuralCapability(capabilities: string[]): void {
    for (const capability of capabilities) {
      expect(ALLOWED_CAPABILITIES).toContain(capability);
      expect(FORBIDDEN_CAPABILITIES).not.toContain(capability);
    }
  }

  beforeEach(() => {
    placeRepository = createSpyObj(PlaceRepository);
    placeInformationService = createSpyObj(PlaceInformationService);
    blockService = createSpyObj(BlockService);
    hoodService = createSpyObj(HoodService);
    colonyService = createSpyObj(ColonyService);
    memberService = createSpyObj(MemberService);

    Container.reset();
    Container.set(PlaceRepository, placeRepository);
    Container.set(PlaceInformationService, placeInformationService);
    Container.set(BlockService, blockService);
    Container.set(HoodService, hoodService);
    Container.set(ColonyService, colonyService);
    Container.set(MemberService, memberService);

    service = new PlaceUpdateHubService(
      placeRepository,
      placeInformationService,
      blockService,
      hoodService,
      colonyService,
      memberService,
    );

    // Default: an ordinary member with nothing anywhere.
    placeInformationService.canEdit.mockResolvedValue(false);
    colonyService.canAdmin.mockResolvedValue(false);
    colonyService.canManageAccess.mockResolvedValue(false);
    hoodService.canAdmin.mockResolvedValue(false);
    hoodService.canManageAccess.mockResolvedValue(false);
    blockService.canAdmin.mockResolvedValue(false);
    blockService.canManageAccess.mockResolvedValue(false);
    memberService.getAccessLevel.mockResolvedValue([] as any);
  });

  async function hubFor(row: any) {
    placeRepository.findById.mockResolvedValue(row);
    return await service.getHub(row.id, MEMBER_ID);
  }

  describe('colony', () => {
    function asColonyLeader() {
      colonyService.canAdmin.mockResolvedValue(true);
      colonyService.canManageAccess.mockResolvedValue(true);
      placeInformationService.canEdit.mockResolvedValue(true);
    }

    function asColonyDeputy() {
      // canAdmin admits the deputy; canManageAccess does not. This is the real
      // shape of ColonyService, not a convenience for the test.
      colonyService.canAdmin.mockResolvedValue(true);
      colonyService.canManageAccess.mockResolvedValue(false);
      placeInformationService.canEdit.mockResolvedValue(true);
    }

    it('lets a Colony Leader open the hub', async () => {
      asColonyLeader();
      const result = await hubFor(place());
      expect(result.status).toBe('success');
      expect(result.status === 'success' && result.hub.canOpen).toBe(true);
    });

    it('lets a Colony Deputy open the hub', async () => {
      asColonyDeputy();
      const result = await hubFor(place());
      expect(result.status).toBe('success');
    });

    it('gives both Leader and Deputy Information and the neighborhood listing',
      async () => {
        for (const setup of [asColonyLeader, asColonyDeputy]) {
          setup();
          const result = await hubFor(place());
          expect(result.status).toBe('success');
          if (result.status !== 'success') return;
          expect(result.hub.capabilities).toContain('update_information');
          expect(result.hub.capabilities).toContain('list_neighborhoods');
        }
      });

    it('gives Access Rights to the Leader but not the Deputy', async () => {
      asColonyLeader();
      const leader = await hubFor(place());
      expect(leader.status === 'success'
        && leader.hub.capabilities).toContain('manage_access_rights');

      asColonyDeputy();
      const deputy = await hubFor(place());
      expect(deputy.status === 'success'
        && deputy.hub.capabilities).not.toContain('manage_access_rights');
    });

    it('grants NO structural map capability to a Colony Leader', async () => {
      asColonyLeader();
      const result = await hubFor(place());
      if (result.status !== 'success') throw new Error('expected success');
      expectNoStructuralCapability(result.hub.capabilities);
    });

    it('grants NO structural map capability to a Colony Deputy', async () => {
      asColonyDeputy();
      const result = await hubFor(place());
      if (result.status !== 'success') throw new Error('expected success');
      expectNoStructuralCapability(result.hub.capabilities);
    });

    it('grants NO structural map capability even to a global Admin', async () => {
      // Admin satisfies every scoped check and the security access level.
      colonyService.canAdmin.mockResolvedValue(true);
      colonyService.canManageAccess.mockResolvedValue(true);
      placeInformationService.canEdit.mockResolvedValue(true);
      memberService.getAccessLevel.mockResolvedValue(['admin', 'security'] as any);

      const result = await hubFor(place());
      if (result.status !== 'success') throw new Error('expected success');
      expectNoStructuralCapability(result.hub.capabilities);
    });

    it('never grants a hood-only or block-only capability at colony tier', async () => {
      colonyService.canAdmin.mockResolvedValue(true);
      colonyService.canManageAccess.mockResolvedValue(true);
      placeInformationService.canEdit.mockResolvedValue(true);
      memberService.getAccessLevel.mockResolvedValue(['security'] as any);

      const result = await hubFor(place());
      if (result.status !== 'success') throw new Error('expected success');
      expect(result.hub.capabilities).not.toContain('manage_lots');
      expect(result.hub.capabilities).not.toContain('manage_background');
      expect(result.hub.capabilities).not.toContain('check_images');
      expect(result.hub.capabilities).not.toContain('list_blocks');
    });

    it('refuses an unrelated member', async () => {
      const result = await hubFor(place());
      expect(result.status).toBe('forbidden');
    });
  });

  describe('neighborhood', () => {
    const hood = () => place({ id: 31, name: 'Sunset', type: 'hood', slug: null });

    it('gives a Neighborhood Leader the background, block listing and access rights',
      async () => {
        hoodService.canAdmin.mockResolvedValue(true);
        hoodService.canManageAccess.mockResolvedValue(true);
        placeInformationService.canEdit.mockResolvedValue(true);

        const result = await hubFor(hood());
        if (result.status !== 'success') throw new Error('expected success');
        expect(result.hub.capabilities).toEqual(expect.arrayContaining([
          'update_information',
          'manage_access_rights',
          'list_blocks',
          'manage_background',
        ]));
      });

    it('lets a Neighborhood Deputy administer but not manage access', async () => {
      hoodService.canAdmin.mockResolvedValue(true);
      hoodService.canManageAccess.mockResolvedValue(false);
      placeInformationService.canEdit.mockResolvedValue(true);

      const result = await hubFor(hood());
      if (result.status !== 'success') throw new Error('expected success');
      expect(result.hub.capabilities).toContain('list_blocks');
      expect(result.hub.capabilities).not.toContain('manage_access_rights');
    });

    it('grants no block-creation capability to ANY role, including a Neighborhood Leader',
      async () => {
        hoodService.canAdmin.mockResolvedValue(true);
        hoodService.canManageAccess.mockResolvedValue(true);
        placeInformationService.canEdit.mockResolvedValue(true);
        memberService.getAccessLevel.mockResolvedValue(['admin', 'security'] as any);

        const result = await hubFor(hood());
        if (result.status !== 'success') throw new Error('expected success');
        expectNoStructuralCapability(result.hub.capabilities);
      });

    it('refuses a member with no role in this neighborhood', async () => {
      const result = await hubFor(hood());
      expect(result.status).toBe('forbidden');
    });
  });

  describe('block', () => {
    const block = () => place({ id: 892, name: 'Cedar', type: 'block', slug: null });

    it('gives a Block Leader lots, background, images and access rights', async () => {
      blockService.canAdmin.mockResolvedValue(true);
      blockService.canManageAccess.mockResolvedValue(true);
      placeInformationService.canEdit.mockResolvedValue(true);

      const result = await hubFor(block());
      if (result.status !== 'success') throw new Error('expected success');
      expect(result.hub.capabilities).toEqual(expect.arrayContaining([
        'update_information',
        'manage_access_rights',
        'manage_lots',
        'manage_background',
        'check_images',
      ]));
    });

    it('lets a Block Deputy administer but not manage access', async () => {
      blockService.canAdmin.mockResolvedValue(true);
      blockService.canManageAccess.mockResolvedValue(false);
      placeInformationService.canEdit.mockResolvedValue(true);

      const result = await hubFor(block());
      if (result.status !== 'success') throw new Error('expected success');
      expect(result.hub.capabilities).toContain('manage_lots');
      expect(result.hub.capabilities).not.toContain('manage_access_rights');
    });

    it('refuses staff of an unrelated block', async () => {
      // canAdmin is scoped, so a leader elsewhere simply resolves false here.
      const result = await hubFor(block());
      expect(result.status).toBe('forbidden');
    });

    it('never grants a colony-only capability at block tier', async () => {
      blockService.canAdmin.mockResolvedValue(true);
      blockService.canManageAccess.mockResolvedValue(true);
      placeInformationService.canEdit.mockResolvedValue(true);

      const result = await hubFor(block());
      if (result.status !== 'success') throw new Error('expected success');
      expect(result.hub.capabilities).not.toContain('list_neighborhoods');
    });
  });

  describe('moderation', () => {
    it('grants the moderation set to a security role even without a scoped role',
      async () => {
        memberService.getAccessLevel.mockResolvedValue(['security'] as any);

        const result = await hubFor(place({ type: 'block', id: 892 }));
        if (result.status !== 'success') throw new Error('expected success');
        expect(result.hub.capabilities).toEqual(expect.arrayContaining([
          'message_to_all',
          'inbox_to_all',
          'moderate_messageboard',
          'moderate_inbox',
        ]));
        // Security is a moderation authority, not a place administrator: it must
        // not confer the scoped place-shaping tools.
        expect(result.hub.capabilities).not.toContain('manage_lots');
        expect(result.hub.capabilities).not.toContain('manage_access_rights');
      });

    it('treats a failure to resolve access level as no security access', async () => {
      memberService.getAccessLevel.mockRejectedValue(new Error('db down'));
      const result = await hubFor(place({ type: 'block', id: 892 }));
      expect(result.status).toBe('forbidden');
    });
  });

  describe('place resolution', () => {
    it('reports not_found for a place that does not exist', async () => {
      placeRepository.findById.mockResolvedValue(undefined as any);
      const result = await service.getHub(999999, MEMBER_ID);
      expect(result.status).toBe('not_found');
    });

    it('reports unsupported for a place type with no hub', async () => {
      // A home has its own owner-managed Update page; it is not a scoped hub.
      for (const type of ['home', 'public', 'shop', 'club', 'storage']) {
        placeRepository.findById.mockResolvedValue(place({ type }));
        const result = await service.getHub(7, MEMBER_ID);
        expect(result.status).toBe('unsupported');
      }
    });

    it('runs the check for the STORED type, not one the caller might prefer',
      async () => {
        // The row says block. Only BlockService may be consulted - if the colony
        // check were reachable, a colony leader elsewhere could administer it.
        colonyService.canAdmin.mockResolvedValue(true);
        colonyService.canManageAccess.mockResolvedValue(true);
        hoodService.canAdmin.mockResolvedValue(true);

        const result = await hubFor(place({ type: 'block', id: 892 }));

        expect(result.status).toBe('forbidden');
        expect(blockService.canAdmin).toHaveBeenCalledWith(892, MEMBER_ID);
        expect(colonyService.canAdmin).not.toHaveBeenCalled();
        expect(hoodService.canAdmin).not.toHaveBeenCalled();
      });

    it('reports the stored type and id back to the client', async () => {
      hoodService.canAdmin.mockResolvedValue(true);
      const result = await hubFor(place({ id: 31, type: 'hood', slug: null }));
      if (result.status !== 'success') throw new Error('expected success');
      expect(result.hub.type).toBe('hood');
      expect(result.hub.placeId).toBe(31);
    });
  });
});
