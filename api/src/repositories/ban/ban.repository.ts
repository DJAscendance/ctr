import { Knex } from 'knex';
import {Service} from 'typedi';

import {Db} from '../../db/db.class';
import {queryOn} from '../../db/query-on';
import {knex} from '../../db';
import {Member} from 'models';

@Service()
export class BanRepository {
  constructor(
   private db: Db,
  ) {
  }
  
  public async addBan(ban_member_id, end_date, type, assigner_member_id, reason) {
    return knex('ban')
      .insert({
        ban_member_id: ban_member_id,
        end_date: end_date,
        type: type,
        assigner_member_id: assigner_member_id,
        reason: reason,
      });
  }
  
  public async deleteBan(banId: number, updateReason: string): Promise<void> {
    return knex('ban')
      .where({id: banId})
      .update({
        status: 0,
        reason: updateReason,
      });
  }

  public async removeAllByUserId(id: number, trx?: Knex.Transaction): Promise<any> {
    await queryOn(this.db.knex, trx)('ban')
      .where('ban_member_id', id)
      .del();
  }
  
  public async getBanHistory(ban_member_id: number): Promise<any> {
    return knex
      .select(
        'ban.id',
        'ban.created_at',
        'ban.end_date',
        'ban.type',
        'member.username',
        'ban.reason',
      )
      .from('ban')
      .innerJoin('member', 'ban.assigner_member_id', 'member.id')
      .where('ban.ban_member_id', ban_member_id)
      .where('ban.status', 1)
      .orderBy('ban.created_at', 'desc');
  }
  
  public async getBanMaxDate(member_id): Promise<any> {
    return this.db.knex
      .select('end_date', 'reason', 'type')
      .from('ban')
      .where('ban_member_id', member_id)
      .where('status', 1)
      .orderBy('end_date', 'desc')
      .limit(1)
      .first();
  }

  /**
   * Whether the member is under a FULL ban right now.
   *
   * Deliberately narrower than `getBanMaxDate`, and the difference is the point. A ban row
   * carries a `type`, and CTR issues two of them: `jail`, which confines a citizen to the
   * Jail but leaves them in the city with a working session, and `full`, which is the
   * refusal of entry. Session revocation must answer for `full` only -- revoking a jailed
   * citizen's session would log them out instead of jailing them, which is not the sentence
   * that was handed down.
   *
   * It also cannot be expressed as "the latest ban", which is what `getBanMaxDate` returns:
   * a jail that ends later than a full ban would mask the full ban behind its own type.
   * This asks its own question against its own rows.
   *
   * `status = 1` is a live row; `deleteBan` sets it to 0, which is how an unban is recorded
   * and therefore how this answer reverses.
   *
   * @param member_id member whose current standing is being read
   * @returns true when at least one un-withdrawn, unexpired full ban applies
   */
  public async hasActiveFullBan(member_id: number): Promise<boolean> {
    const row = await this.db.knex
      .select('id')
      .from('ban')
      .where('ban_member_id', member_id)
      .where('status', 1)
      .where('type', 'full')
      .where('end_date', '>', new Date())
      .limit(1)
      .first();
    return !!row;
  }

  /**
   * Whether the member is confined to the Jail right now.
   *
   * The mirror of `hasActiveFullBan`, and kept apart from it for the same reason: the two
   * sentences are different and must never be read off one another. `full` refuses entry to
   * the city; `jail` leaves the citizen logged in, connected, and confined. Everything that
   * decides what a jailed citizen may see, say, or walk into asks THIS, never
   * `getBanMaxDate`, which returns whichever ban ends last and would let a stale full ban
   * masquerade as a jail sentence.
   *
   * `status = 1` is a live row -- `deleteBan` sets it to 0, which is how a release is
   * recorded -- and `end_date > now` is how a sentence expires on its own. A citizen whose
   * time is up is therefore not an inmate on the very next read, with nothing to run.
   *
   * @param memberId member whose current standing is being read
   * @returns true when at least one un-withdrawn, unexpired jail sentence applies
   */
  public async hasActiveJailBan(memberId: number): Promise<boolean> {
    const row = await this.db.knex
      .select('id')
      .from('ban')
      .where('ban_member_id', memberId)
      .where('status', 1)
      .where('type', 'jail')
      .where('end_date', '>', new Date())
      .limit(1)
      .first();
    return !!row;
  }

  /**
   * Every member who has ever been under a jail sentence, live or spent.
   *
   * Used only by the Jail's chat-history read path, and deliberately wider than
   * `hasActiveJailBan`. Stored messages carry no record of the author's standing at the
   * moment they were written, so "was this line spoken by an inmate" cannot be answered
   * from the `message` row alone. Rather than add a column for rows that already exist,
   * the read path withholds Jail history written by anyone who has ever been jailed there.
   * That errs towards hiding, never towards leaking, and it only reaches rows written
   * before inmate speech stopped being persisted at all.
   *
   * @returns the distinct member ids carrying any jail ban row, withdrawn or expired
   */
  public async findEverJailedMemberIds(): Promise<number[]> {
    const rows = await this.db.knex
      .distinct('ban_member_id')
      .from('ban')
      .where('type', 'jail');
    return rows.map((row: { ban_member_id: number }) => row.ban_member_id);
  }

  public async getBannedTotal(): Promise<any> {
    return this.db.knex
      .countDistinct('ban_member_id as count')
      .from('ban')
      .where({status: 1, type: 'full'})
      .andWhere('end_date', '>=', new Date());
  }

  public async getJailedTotal(): Promise<any> {
    return this.db.knex
      .countDistinct('ban_member_id as count')
      .from('ban')
      .where({status: 1, type: 'jail'})
      .andWhere('end_date', '>=', new Date());
  }

  public async getRecentBan(time: Date): Promise<any> {
    return this.db.knex
      .select('ban.*', 'member.username')
      .from('ban')
      .where('ban.status', 1)
      .andWhere('ban.type', 'full')
      .andWhere('ban.created_at', '>=', time)
      .join('member', 'member.id', 'ban.ban_member_id');
  }

  public async getRecentJail(time: Date): Promise<any> {
    return this.db.knex
      .select('ban.*', 'member.username')
      .from('ban')
      .where('ban.status', 1)
      .andWhere('ban.type', 'jail')
      .andWhere('ban.created_at', '>=', time)
      .join('member', 'member.id', 'ban.ban_member_id');
  }

  public async getUnbannedSoon(time: Date): Promise<any> {
    return this.db.knex
      .select('ban.*', 'member.username')
      .from('ban')
      .where('ban.status', 1)
      .andWhere('ban.end_date', '<=', time)
      .andWhere('ban.end_date', '>', new Date())
      .join('member', 'member.id', 'ban.ban_member_id');
  }

}
