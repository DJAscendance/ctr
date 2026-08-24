import { Model } from './model';

/**
 * A role check-marked to grant write access at a place.
 *
 * The second access axis. A row means every holder of role_id may write at place_id,
 * independently of the owner/deputy identity slots.
 */
export interface PlaceRoleAccess extends Model {
  /** ID of the place the grant applies to */
  place_id: number;
  /** ID of the role being granted write access */
  role_id: number;
}
