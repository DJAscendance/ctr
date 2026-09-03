import { Model } from './model';

/**
 * OUTLANDS-2B. The scheduled-match passwords for one place, as stored in the db.
 *
 * The two columns are the historical `PASS1` and `PASS2` fields of the Outlands
 * place object. `PASS1` was the Blue Team password and `PASS2` the Red Team
 * password - `ne_game/passupdate.tmpl` labels them - so the names here carry the
 * colour rather than the classic number, and the mapping cannot be misread.
 *
 * Both hold a bcrypt hash or NULL. A plaintext match password is never stored,
 * never returned by an API and never logged.
 */
export interface OutlandsMatchPassword extends Model {
  id: number;
  /** The place these passwords belong to. Unique. */
  place_id: number;
  /** Historical `PASS1`. bcrypt hash, or NULL for "no Blue match configured". */
  blue_password_hash?: string | null;
  /** Historical `PASS2`. bcrypt hash, or NULL for "no Red match configured". */
  red_password_hash?: string | null;
  /** Audit note only: who last set them. */
  updated_by_member_id?: number | null;
}
