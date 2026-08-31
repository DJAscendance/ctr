import { Model } from './model';

/**
 * A named per-member attribute, as stored in the db.
 *
 * The CS 4.x MD / memdata table. Buddy slots (BU0..BU9), the hide-yourself flag (IMS) and
 * similar per-member state live here as named attributes rather than as dedicated columns.
 */
export interface MemberData extends Model {
  /** ID of the member the attribute belongs to */
  member_id: number;
  /** Attribute name, e.g. 'BU0' or 'IMS' */
  name: string;
  /** Attribute value; null clears it */
  value: string | null;
}
