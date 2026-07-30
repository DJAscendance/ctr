import { Service } from 'typedi';

import { Db } from '../../db';
import { MemberData } from '../../types/models';

/**
 * Reads and writes per-member named attributes (the CS 4.x MD / memdata table).
 *
 * Callers should generally go through a feature-specific service -- the buddy list, the
 * privacy flag -- rather than reaching for raw attribute names here, so the meaning of
 * each name stays in one place.
 */
@Service()
export class MemberDataRepository {
  constructor(private db: Db) {}

  /** Every attribute for a member, as a plain name -> value object. */
  public async getAll(memberId: number): Promise<Record<string, string | null>> {
    const rows = await this.db.knex('member_data')
      .select('name', 'value')
      .where('member_id', memberId);
    return rows.reduce((acc, row) => {
      acc[row.name] = row.value;
      return acc;
    }, {} as Record<string, string | null>);
  }

  /** A single attribute value, or null if it is unset. */
  public async get(memberId: number, name: string): Promise<string | null> {
    const row = await this.db.knex('member_data')
      .select('value')
      .where({ member_id: memberId, name })
      .first();
    return row ? row.value : null;
  }

  /**
   * Attributes whose name starts with `prefix`, as name -> value.
   *
   * Used to read a whole family at once, e.g. 'BU' for every buddy slot. The prefix is
   * escaped so a caller cannot smuggle LIKE wildcards in and widen the match.
   */
  public async getByPrefix(
    memberId: number,
    prefix: string,
  ): Promise<Record<string, string | null>> {
    const escaped = prefix.replace(/[\\%_]/g, char => `\\${char}`);
    const rows = await this.db.knex('member_data')
      .select('name', 'value')
      .where('member_id', memberId)
      .andWhere('name', 'like', `${escaped}%`)
      .orderBy('name');
    return rows.reduce((acc, row) => {
      acc[row.name] = row.value;
      return acc;
    }, {} as Record<string, string | null>);
  }

  /**
   * One attribute across many members, as memberId -> value.
   *
   * Batched deliberately: the roster needs every online member's privacy flag at once, and
   * fetching that per member would add an N+1 to an endpoint that already has two. Members
   * with the attribute unset are simply absent from the map.
   */
  public async getForMembers(
    memberIds: number[],
    name: string,
  ): Promise<Map<number, string | null>> {
    const result = new Map<number, string | null>();
    if (!memberIds.length) return result;

    const rows = await this.db.knex('member_data')
      .select('member_id', 'value')
      .whereIn('member_id', memberIds)
      .andWhere('name', name);
    for (const row of rows) result.set(row.member_id, row.value);
    return result;
  }

  /**
   * Sets an attribute, replacing any existing value.
   *
   * A null or empty value DELETES the row rather than storing an empty string, so
   * "unset" has exactly one representation. Otherwise a cleared buddy slot could read
   * back as '' from one code path and null from another.
   */
  public async set(
    memberId: number,
    name: string,
    // undefined is accepted alongside null, not dead defensive code: these values come from
    // request bodies and dynamically built objects, where a missing key reads as undefined
    // long before it reaches a typed boundary. The guard below treats it as "unset".
    value: string | null | undefined,
  ): Promise<void> {
    if (value === null || value === undefined || value === '') {
      await this.unset(memberId, name);
      return;
    }
    await this.db.knex('member_data')
      .insert({ member_id: memberId, name, value })
      .onConflict(['member_id', 'name'])
      .merge(['value']);
  }

  /** Sets several attributes in one transaction, so a partial write cannot land. */
  public async setMany(
    memberId: number,
    values: Record<string, string | null | undefined>,
  ): Promise<void> {
    const entries = Object.entries(values);
    if (!entries.length) return;

    await this.db.knex.transaction(async trx => {
      const toDelete = entries
        .filter(([, value]) => value === null || value === undefined || value === '')
        .map(([name]) => name);
      const toUpsert = entries
        .filter(([, value]) => !(value === null || value === undefined || value === ''))
        .map(([name, value]) => ({ member_id: memberId, name, value: value as string }));

      if (toDelete.length) {
        await trx('member_data').where('member_id', memberId).whereIn('name', toDelete).del();
      }
      if (toUpsert.length) {
        await trx('member_data')
          .insert(toUpsert)
          .onConflict(['member_id', 'name'])
          .merge(['value']);
      }
    });
  }

  public async unset(memberId: number, name: string): Promise<void> {
    await this.db.knex('member_data').where({ member_id: memberId, name }).del();
  }

  /** Raw rows, for callers that need timestamps or ids. */
  public async findByMember(memberId: number): Promise<MemberData[]> {
    return this.db.memberData.where({ member_id: memberId });
  }

  public async removeAllForMember(memberId: number): Promise<void> {
    await this.db.knex('member_data').where('member_id', memberId).del();
  }
}
