import { Service } from 'typedi';

import { PlaceRepository } from '../../repositories';
import { sanitizeUserHtml } from '../../libs';
import { Place } from '../../types/models';
import { BlockService } from '../block/block.service';
import { ColonyService } from '../colony/colony.service';
import { HoodService } from '../hood/hood.service';
import { PlaceService } from './place.service';

/**
 * Place types that support staff-managed information text, and how each one is
 * authorized.
 *
 * `scoped-slug` means PlaceService.canAdmin(slug, placeId, memberId) - the
 * existing per-place staff role check that already gates every other admin tool
 * on generic public places (Mall, Bank, Beach, Theatre, ...).
 */
const SUPPORTED_PLACE_TYPES = ['block', 'hood', 'colony', 'public'] as const;

export type SupportedPlaceType = typeof SUPPORTED_PLACE_TYPES[number];

export interface PlaceInformation {
  placeId: number;
  name: string;
  type: string;
  /** Already sanitized when stored; safe to render as HTML. */
  description: string;
}

export type UpdateInformationResult =
  | { status: 'success'; description: string }
  | { status: 'not_found' }
  | { status: 'unsupported' }
  | { status: 'forbidden' }
  | { status: 'too_long' };

/**
 * Staff-managed information text for a place - the classic "Update Info" tool.
 *
 * The original was a single free-text attribute `TXT` on the place record,
 * editable by anyone holding Owner Access and rendered above the place's
 * Owner/Assistants/Leaders/Deputies listing (blaxxun CS 4.0
 * templates/place/updateinfo.{cfg,tmpl}, rendered by block/info.tmpl and
 * neighbor/info.tmpl; see docs/research/classic-place-admin-re-evidence.md
 * section 4). CTR already has that column - `place.description` - so this reuses
 * it rather than adding a parallel field.
 *
 * Two deliberate departures from the original:
 *
 *   1. The original rendered TXT as raw, unescaped HTML with no filtering layer
 *      anywhere in CS 4.0, 5.1 or 7.0. That is stored XSS. Text is sanitized
 *      ON WRITE against the shared allowlist, so what is read back is already
 *      safe and no reader has to remember to clean it.
 *
 *   2. The original had one implicit "Owner Access" right covering everything.
 *      CTR has real per-type scoped staff roles, and this uses them unchanged
 *      rather than inventing a new right.
 *
 * The place TYPE is always read from the database row, never taken from the
 * request. A caller cannot nominate a type (or a slug) to steer which
 * authorization check runs.
 */
@Service()
export class PlaceInformationService {
  constructor(
    private placeRepository: PlaceRepository,
    private placeService: PlaceService,
    private blockService: BlockService,
    private hoodService: HoodService,
    private colonyService: ColonyService,
  ) {}

  /**
   * Matches the `place.description` column, which is MySQL TEXT (65535 bytes).
   * The limit here is a usability bound on a staff notice, not a storage bound -
   * it is set well under the column capacity so that sanitizing (which can only
   * shrink the value) can never push a previously-accepted value over the edge.
   */
  public static readonly INFORMATION_MAX_LENGTH = 8000;

  public static isSupportedType(type: string): type is SupportedPlaceType {
    return (SUPPORTED_PLACE_TYPES as readonly string[]).includes(type);
  }

  /** Public read. Returns null when the place does not exist. */
  public async getInformation(placeId: number): Promise<PlaceInformation | null> {
    const place = await this.placeRepository.findById(placeId);
    if (!place) {
      return null;
    }
    return {
      placeId: place.id,
      name: place.name,
      type: place.type,
      description: place.description || '',
    };
  }

  /**
   * Decides whether `memberId` may edit this place's information.
   *
   * Authorization is selected by the place's OWN stored type. Each branch
   * delegates to the scoped check that already governs that place type's other
   * admin tools - no new notion of "who may edit information" is introduced.
   */
  public async canEdit(place: Place, memberId: number): Promise<boolean> {
    switch (place.type) {
    case 'block':
      return await this.blockService.canAdmin(place.id, memberId);
    case 'hood':
      return await this.hoodService.canAdmin(place.id, memberId);
    case 'colony':
      return await this.colonyService.canAdmin(place.id, memberId);
    case 'public':
      // Generic staffed places (Mall, Bank, Beach, Theatre, ...) are keyed by
      // slug in PlaceService's role table. The slug comes off the stored row.
      return place.slug
        ? await this.placeService.canAdmin(place.slug, place.id, memberId)
        : false;
    default:
      // Homes have their own owner-managed Information tool; shops, clubs and
      // storage have no scoped staff role that would make "staff-managed
      // information" meaningful. Unsupported types are refused rather than
      // guessed at.
      return false;
    }
  }

  public async updateInformation(
    placeId: number,
    memberId: number,
    description: string,
  ): Promise<UpdateInformationResult> {
    const place = await this.placeRepository.findById(placeId);
    if (!place) {
      return { status: 'not_found' };
    }
    if (!PlaceInformationService.isSupportedType(place.type)) {
      return { status: 'unsupported' };
    }
    if (!(await this.canEdit(place, memberId))) {
      return { status: 'forbidden' };
    }

    // Length is checked on the SUBMITTED text, before sanitizing. Checking after
    // would let someone submit an arbitrarily large blob of disallowed markup
    // that happens to sanitize down to something short.
    if (description.length > PlaceInformationService.INFORMATION_MAX_LENGTH) {
      return { status: 'too_long' };
    }

    const clean = sanitizeUserHtml(description);
    await this.placeRepository.updateDescription(placeId, clean);
    return { status: 'success', description: clean };
  }
}
