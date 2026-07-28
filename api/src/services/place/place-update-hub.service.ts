import { Service } from 'typedi';

import { PlaceRepository } from '../../repositories';
import { Place } from '../../types/models';
import { BlockService } from '../block/block.service';
import { ColonyService } from '../colony/colony.service';
import { HoodService } from '../hood/hood.service';
import { MemberService } from '../member/member.service';
import { PlaceInformationService } from './place-information.service';

/**
 * Place types that have a scoped Update hub.
 *
 * Homes have their own owner-managed Update page; generic public places, shops,
 * clubs and storage are administered through their own staff tooling and have no
 * Colony/Neighborhood/Block-style scoped hierarchy to compose. Anything not in
 * this list is refused rather than guessed at.
 */
const HUB_PLACE_TYPES = ['colony', 'hood', 'block'] as const;

export type HubPlaceType = typeof HUB_PLACE_TYPES[number];

/**
 * One capability per distinct authorization question.
 *
 * Deliberately NOT a single `canAdmin` boolean. The classic server gated every
 * Update tool on one `owneraccess` bit (blaxxun CS 4.0
 * templates/{block,neighbor}/action.tmpl), but CTR already draws a finer line -
 * `canManageAccess` excludes each tier's OWN deputy where `canAdmin` admits them -
 * and collapsing that back into one flag would silently widen who may hand out
 * leadership. Each capability below names the exact server-side method that
 * decides it; see docs/research/classic-update-hierarchy-matrix.md section 3.
 */
export type UpdateCapability =
  | 'update_information'
  | 'manage_access_rights'
  | 'message_to_all'
  | 'inbox_to_all'
  | 'moderate_messageboard'
  | 'moderate_inbox'
  | 'check_images'
  | 'manage_lots'
  | 'manage_background'
  | 'list_neighborhoods'
  | 'list_blocks';

/**
 * The capabilities whose control lives INSIDE the Update hub.
 *
 * Holding a capability and belonging on the Update page are different questions.
 * Message to All, Inbox to All, Access Rights and Check Images are permanent
 * tool-bar buttons - in blaxxun CS 4.0 they sat on the action bar BESIDE the
 * Update button, not inside the wizard it opened. Message-board and inbox
 * moderation are reached through their own windows. The wizard's own screens were
 * information, the child map and the background, which is what this list holds.
 *
 * The client keeps the matching table in spa/src/helpers/place-update-hub.helper
 * (CAPABILITY_PLACEMENT); this copy exists so `canOpen` is decided by the server
 * rather than inferred from a list length.
 */
const HUB_PLACED_CAPABILITIES: readonly UpdateCapability[] = [
  'update_information',
  'manage_lots',
  'manage_background',
  'list_neighborhoods',
  'list_blocks',
];

export interface PlaceUpdateHub {
  placeId: number;
  name: string;
  /** Read from the stored row. Never taken from the request. */
  type: HubPlaceType;
  slug: string | null;
  /**
   * True when at least one capability whose control lives in the hub is granted.
   *
   * A member may hold only tool-bar or moderation capabilities - a Security role
   * holds exactly those - and for them the Update page has nothing to show. The
   * endpoint still answers 200 with the full list so the tool bars can gate their
   * own buttons; `canOpen` is what decides whether the Update button appears and
   * whether the hub renders.
   */
  canOpen: boolean;
  capabilities: UpdateCapability[];
}

export type UpdateHubResult =
  | { status: 'success'; hub: PlaceUpdateHub }
  | { status: 'not_found' }
  | { status: 'unsupported' }
  | { status: 'forbidden' };

/**
 * Capability set for a place's scoped Update hub.
 *
 * WHAT THIS IS. In blaxxun CS 4.0 the Neighborhood and Block action bars each
 * carried an Update button behind `#ifdef owneraccess` that opened a per-place
 * wizard (templates/neighbor/action.tmpl:43-44, templates/block/action.tmpl:37-41).
 * The Colony action bar had NO Update button at all - `community.exe` carries no
 * wizard dispatch and `community/present.tmpl` was a hand-authored HTML image map.
 *
 * So the Neighborhood and Block hubs restore an original screen, while the Colony
 * hub is a MODERN COMPOSITION of authentic Cybertown tools rather than a
 * restoration of a screen that existed. That distinction is recorded here and in
 * docs/research/classic-update-hierarchy-matrix.md section 0.1 so it is not later
 * mistaken for a fidelity claim.
 *
 * WHAT IT DELIBERATELY OMITS. No colony structural-map capability exists, at any
 * privilege level including Admin: no add / remove / reposition neighborhood, no
 * image-map coordinate editing, no map upload. The original required editing a
 * template file and a JPEG on the server, and CTR has neither a safe structural
 * editor nor a defined technical-role authorization service. There is no endpoint
 * to gate, so no gate is invented.
 *
 * Block creation, withdrawal and deletion are likewise absent - the original's
 * authorization for them lived in per-place ACL data that survives in no artifact,
 * and the product decision (Neighborhood Deputies may NOT create blocks) is
 * recorded for a future lane in classic-update-hierarchy-matrix.md section 4.1.
 *
 * Chat Access is absent outside homes: `HomeService.canChatInPlace` is home-scoped
 * by construction and there is no place-tier chat ACL to expose. A tile with no
 * authoritative backend would be a lie about what the button does.
 *
 * Chat MODERATION is absent for the same reason and is a different feature again.
 * The original's Moderate Chat button opened a Java applet against a separate
 * moderation daemon (blaxxun CS 4.0 templates/place/moderate.tmpl); CTR has no
 * such service, no per-place moderator grant and no socket-side rule to enforce
 * one. The message-board and inbox capabilities below are NOT it and must never
 * be relabelled as it - see docs/research/classic-chat-moderation-trace.md.
 */
@Service()
export class PlaceUpdateHubService {
  constructor(
    private placeRepository: PlaceRepository,
    private placeInformationService: PlaceInformationService,
    private blockService: BlockService,
    private hoodService: HoodService,
    private colonyService: ColonyService,
    private memberService: MemberService,
  ) {}

  public static isHubType(type: string): type is HubPlaceType {
    return (HUB_PLACE_TYPES as readonly string[]).includes(type);
  }

  /**
   * Resolves every capability for `memberId` at `placeId`.
   *
   * The place's TYPE and its parent chain are read from the database. A caller
   * cannot send a type, slug, colony, hood or block id that steers which scoped
   * check runs - the only client input is the place id, and it is looked up.
   *
   * Returns `forbidden` when no capability at all is granted, so the caller never
   * has to infer "may open" from an empty list.
   */
  public async getHub(placeId: number, memberId: number): Promise<UpdateHubResult> {
    const place = await this.placeRepository.findById(placeId);
    if (!place) {
      return { status: 'not_found' };
    }
    if (!PlaceUpdateHubService.isHubType(place.type)) {
      return { status: 'unsupported' };
    }

    const capabilities = await this.resolveCapabilities(place, place.type, memberId);
    if (capabilities.length === 0) {
      return { status: 'forbidden' };
    }

    return {
      status: 'success',
      hub: {
        placeId: place.id,
        name: place.name,
        type: place.type,
        slug: place.slug || null,
        canOpen: capabilities.some(
          (capability) => HUB_PLACED_CAPABILITIES.indexOf(capability) !== -1,
        ),
        capabilities,
      },
    };
  }

  private async resolveCapabilities(
    place: Place,
    type: HubPlaceType,
    memberId: number,
  ): Promise<UpdateCapability[]> {
    // The scoped administrator check for this tier, and the narrower check that
    // governs handing out leadership. `canManageAccess` is NOT an alias: at every
    // tier it admits the same superiors but excludes that tier's own deputy.
    const [canAdmin, canManageAccess] = await Promise.all([
      this.canAdminForType(place, type, memberId),
      this.canManageAccessForType(place, type, memberId),
    ]);

    // Security roles hold a genuine global moderation authority in CTR - the
    // messageboard and inbox controllers already honour it on every scoped path
    // (MessageboardController.adminCheck). Modelling it here keeps the tile list
    // and the endpoint that backs it in agreement.
    const isSecurity = await this.hasSecurityAccess(memberId);
    const canModerate = canAdmin || isSecurity;

    const granted: UpdateCapability[] = [];

    // Information is authorized by the same service that gates the PUT, so the
    // tile and the endpoint can never disagree about who may edit.
    if (await this.placeInformationService.canEdit(place, memberId)) {
      granted.push('update_information');
    }
    if (canManageAccess) {
      granted.push('manage_access_rights');
    }
    if (canModerate) {
      granted.push('message_to_all', 'inbox_to_all', 'moderate_messageboard', 'moderate_inbox');
    }

    if (type === 'colony' && canAdmin) {
      granted.push('list_neighborhoods');
    }
    if (type === 'hood' && canAdmin) {
      granted.push('list_blocks', 'manage_background');
    }
    if (type === 'block' && canAdmin) {
      granted.push('manage_lots', 'manage_background', 'check_images');
    }

    return granted;
  }

  private async canAdminForType(
    place: Place,
    type: HubPlaceType,
    memberId: number,
  ): Promise<boolean> {
    switch (type) {
    case 'colony':
      return await this.colonyService.canAdmin(place.id, memberId);
    case 'hood':
      return await this.hoodService.canAdmin(place.id, memberId);
    case 'block':
      return await this.blockService.canAdmin(place.id, memberId);
    default:
      return false;
    }
  }

  private async canManageAccessForType(
    place: Place,
    type: HubPlaceType,
    memberId: number,
  ): Promise<boolean> {
    switch (type) {
    case 'colony':
      return await this.colonyService.canManageAccess(place.id, memberId);
    case 'hood':
      return await this.hoodService.canManageAccess(place.id, memberId);
    case 'block':
      return await this.blockService.canManageAccess(place.id, memberId);
    default:
      return false;
    }
  }

  /**
   * Mirrors how the messageboard and inbox controllers decide global moderation.
   * A failure here must not silently become "yes", so it resolves to false.
   */
  private async hasSecurityAccess(memberId: number): Promise<boolean> {
    try {
      const access = await this.memberService.getAccessLevel(memberId);
      return Array.isArray(access) && access.includes('security');
    } catch (error) {
      console.error('placeUpdateHub.hasSecurityAccess failed', error);
      return false;
    }
  }
}
