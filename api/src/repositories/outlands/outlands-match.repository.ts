import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { OutlandsMatchPassword } from '../../types/models';

/** The two hashes a place's scheduled-match configuration consists of. */
export interface MatchPasswordHashes {
  /** Historical `PASS1` - Blue Team. bcrypt hash, or null when unset. */
  blue: string | null;
  /** Historical `PASS2` - Red Team. bcrypt hash, or null when unset. */
  red: string | null;
}

/**
 * OUTLANDS-2B. The only read and write path for scheduled-match passwords.
 *
 * This repository is deliberately the whole surface. `outlands_match_password` is
 * not joined into any place query and is not part of any `SELECT *`, so a match
 * password cannot leak through an unrelated endpoint the way it would if the
 * columns sat on `place` - see the migration for why that mattered.
 */
@Service()
export class OutlandsMatchRepository {
  constructor(private db: Db) {}

  /**
   * Reads a place's stored match password hashes.
   * @param placeId id of the place to read
   * @returns both hashes; each is null when that team has no password set, and
   *          both are null when the place has no row at all
   */
  public async findHashesByPlaceId(placeId: number): Promise<MatchPasswordHashes> {
    const row: OutlandsMatchPassword = await this.db.outlandsMatchPassword
      .where({ place_id: placeId })
      .first();
    if (!row) {
      return { blue: null, red: null };
    }
    return {
      blue: row.blue_password_hash ?? null,
      red: row.red_password_hash ?? null,
    };
  }

  /**
   * Writes a place's match password hashes, creating the row on first use.
   *
   * The caller must have already authorized the change and already hashed the
   * values. Passing null for a team clears that team's password, which is how a
   * scheduled match is stood down.
   * @param placeId id of the place to write
   * @param hashes the bcrypt hashes to store, or null to clear
   * @param memberId id of the member making the change, for the audit note
   */
  public async saveHashes(
    placeId: number,
    hashes: MatchPasswordHashes,
    memberId: number,
  ): Promise<void> {
    const existing: OutlandsMatchPassword = await this.db.outlandsMatchPassword
      .where({ place_id: placeId })
      .first();

    const values = {
      blue_password_hash: hashes.blue,
      red_password_hash: hashes.red,
      updated_by_member_id: memberId,
    };

    if (existing) {
      await this.db.outlandsMatchPassword
        .where({ place_id: placeId })
        .update(values);
      return;
    }

    await this.db.outlandsMatchPassword.insert({ place_id: placeId, ...values });
  }
}
