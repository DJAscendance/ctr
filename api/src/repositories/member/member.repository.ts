import { Knex } from 'knex';
import { Service } from 'typedi';
import { Db } from '../../db/db.class';
import { CountRow } from '../row.types';
import { IMMIGRATION_GRANT_CC } from '../../libs/economy';
// Relative rather than the bare 'models' specifier used elsewhere in this file's
// neighbourhood. TransactionReason is an enum, i.e. a runtime value, so this import is
// emitted rather than elided as a type-only one would be -- and jest cannot resolve
// 'models', which is a tsconfig `paths` alias with no matching moduleNameMapper. Files that
// import only types get away with it; this one would not.
import { Member, Transaction, TransactionReason, Wallet } from '../../types/models';
import { knex } from '../../db';

/**
 * A place id from the member table, plus the fields `MemberService` attaches to
 * it afterwards while building the active-places list.
 */
/**
 * An online member, plus the flags `MemberController` attaches while building
 * the online list.
 */
export interface OnlineUserRow {
  id: number | null;
  username: string;
  hasHome?: boolean;
  security?: boolean;
}

export interface ActivePlaceRow {
  place_id: number;
  name?: string;
  slug?: string;
  type?: string;
  username?: string;
  count?: number;
}

/** Repository for interacting with member table data in the database. */
@Service()
export class MemberRepository {
  constructor(private db: Db) { }

  /**
   * Creates a new member with the given parameters.
   * @param memberParams parameters to be used for the new member
   * @returns promise resolving in the id for the newly created member
   */
  public async create(memberParams: Partial<Member>): Promise<number> {
    return await this.db.knex.transaction(async trx => {
      // Opened at zero and then credited, rather than relying on the wallet column's
      // DEFAULT. Two reasons: `m_immigrate` was historically an awarded EVENT rather than
      // an opening balance, and the largest single grant in the economy should leave a
      // ledger row. A schema default leaves none, which is how the previous 1000cc start
      // came to be the one piece of money in CTR that nothing could account for.
      const [walletId] = await trx<Wallet>('wallet').insert({ balance: 0 });
      const [memberId] = await trx<Member>('member').insert({
        ...memberParams,
        wallet_id: walletId,
      });

      // Same transaction as the member and wallet inserts, so a new citizen either exists
      // WITH their grant and its ledger row, or does not exist at all. `increment` rather
      // than an absolute write for consistency with every other money path, even though
      // nothing else can hold this wallet yet.
      await trx<Wallet>('wallet')
        .where({ id: walletId })
        .increment('balance', IMMIGRATION_GRANT_CC);
      await trx<Transaction>('transaction').insert({
        amount: IMMIGRATION_GRANT_CC,
        reason: TransactionReason.Immigration,
        recipient_wallet_id: walletId,
      });

      return memberId;
    });
  }

  /**
   * Pays the one-time settle-a-home experience award to a member who has earned it and has
   * not yet been paid.
   *
   * `e_propsettle` in colonycity/config/exper.cfg -- 50 XP for settling a home. Historical
   * behaviour, not a revival addition.
   *
   * RECONCILIATION, NOT AN AWARD. This is deliberately safe to call at any time, from any
   * path, as many times as anything likes -- it asks "does this member deserve the award and
   * still lack it?" rather than "pay this member". That is what lets one statement serve two
   * jobs that would otherwise need separate mechanisms:
   *
   *   - called immediately after a successful settle, it pays the new homesteader;
   *   - called on every successful login, it pays anyone the first call missed.
   *
   * The second is what makes the award RECOVERABLE. An earlier revision called this only
   * from the settle path and swallowed the failure, so a transient database error there
   * meant the home existed, the marker stayed NULL, and the citizen could never earn the
   * award again -- CTR gives nobody a second first home. Independent QA proved that
   * permanently lost the 50 XP. Now the marker staying NULL is precisely the condition that
   * makes the next login retry, so a failure costs a delay rather than the award.
   *
   * It is also the backfill. Citizens who homesteaded before this column existed have a home
   * and a NULL marker, which is the same state as a failed award and is answered the same
   * way: one payment, on their next login. No migration mutates the member table, and no
   * separate backfill job exists to be run once and then be wrong for everyone who signs up
   * afterwards.
   *
   * THREE CONDITIONS, all in the one statement, so there is no read-then-decide anywhere for
   * a racing request to slip between and no lock to take:
   *
   *   1. `id = ?`                            -- this member;
   *   2. `first_homestead_rewarded_at IS NULL` -- never paid. Two concurrent calls both run
   *      the UPDATE; MySQL serialises them on the row and the second matches nothing;
   *   3. `EXISTS (a home)`                   -- has actually earned it. Without this a login
   *      would pay every citizen who has never owned a home.
   *
   * Condition 3 asks `place`, which is CTR's authoritative record of home ownership
   * (`type = 'home'`, `member_id`), and is the same relationship every other home path uses.
   * Not `home.image` or profile data, neither of which is ownership.
   *
   * Note what conditions 2 and 3 do TOGETHER: 3 alone would pay again after a move-out and
   * move-back, and 2 alone would pay someone who never homesteaded. Both are required, and
   * 2 is what makes "once per member ever" true rather than "once per home".
   *
   * `xp = xp + ?` in SQL rather than a JavaScript read plus a write of the total, for the
   * same reason every other money and XP path in this codebase does it that way: a daily or
   * weekly credit landing at the same moment must not be overwritten.
   *
   * @param memberId member to reconcile
   * @param amount experience to award
   * @returns true if this call is the one that paid; false if the member had already been
   * rewarded, has no home, or does not exist
   */
  public async reconcileFirstHomesteadXp(memberId: number, amount: number): Promise<boolean> {
    const updated = await this.db.knex('member')
      .where({ id: memberId })
      .whereNull('first_homestead_rewarded_at')
      .whereExists(builder => builder
        .select(this.db.knex.raw('1'))
        .from('place')
        .where('place.type', 'home')
        .andWhereRaw('place.member_id = member.id'))
      .update({
        xp: this.db.knex.raw('xp + ?', [amount]),
        first_homestead_rewarded_at: this.db.knex.fn.now(),
      });
    return updated === 1;
  }

  /**
   * Finds a member with the given search parameters if one exists.
   * @param memberSearchParams object containing properties of a member for searching on
   * @returns promise resolving in the found member object, or rejecting on error
   */
  public async find(memberSearchParams: Partial<Member>): Promise<Member> {
    const [member] = await this.db.member.where(memberSearchParams);
    return member;
  }

  /**
   * Finds a member with the given id if one exists.
   * @param memberId id of member to search for
   * @returns promise resolving in the found member object, or rejecting on error
   */
  public async findById(memberId: number, trx?: Knex.Transaction): Promise<Member> {
    if (!trx) {
      return this.find({ id: memberId });
    }
    // Read inside the caller's transaction so the wallet id used for a refund
    // is the one that transaction will actually write against.
    const [member] = await this.db.member.transacting(trx).where({ id: memberId });
    return member;
  }

  /**
   * Usernames for many members in one query, for list pages that would
   * otherwise call `findById` once per row.
   */
  public async findByIds(memberIds: number[]): Promise<{ [memberId: number]: Member }> {
    const members: { [memberId: number]: Member } = {};
    if (!memberIds.length) {
      return members;
    }
    const rows = await this.db.member.whereIn('id', memberIds);
    rows.forEach((row: Member) => {
      members[row.id] = row;
    });
    return members;
  }

  public async findIdByUsername(username: string): Promise<Pick<Member, 'id'>[]> {
    return this.db.knex
      .select('id')
      .from('member')
      .where('username', username);
  }

  public async getMemberTotal(): Promise<CountRow[]> {
    return this.db.knex
      .count<CountRow[]>('id as count')
      .from('member');
  }

  public async countByDuration(time: Date): Promise<CountRow[]> {
    return this.db.knex
      .count<CountRow[]>('id as count')
      .from('member')
      .where('last_activity', '>=', time);
  }

  public async getNewestMembers(): Promise<Member[]> {
    return this.db.knex
      .from('member')
      .limit(5)
      .orderBy('id', 'desc');
  }

  public async countNewUsers(time: Date): Promise<CountRow[]> {
    return this.db.knex
      .count<CountRow[]>('id as count')
      .from('member')
      .where('created_at', '>=', time);
  }

  public async check3d(username: string): Promise<Pick<Member, 'is_3d'>[]> {
    return this.db.knex
      .select('is_3d')
      .from('member')
      .where('username', username);
  }

  public async findOnlineUsers(current: Date): Promise<OnlineUserRow[]> {
    return this.db.knex
      .select('id', 'username')
      .from('member')
      .where('last_activity', '>=', current)
      .orderBy('username', 'ASC');
  }

  public async findByWalletId(walletID: number): Promise<Pick<Member, 'username'>[]> {
    return this.db.knex
      .select('username')
      .from('member')
      .where('wallet_id', walletID);
  }

  public async getActivePlaces(current: Date): Promise<ActivePlaceRow[]> {
    return this.db.knex
      .select('place_id')
      .from('member')
      .where('last_activity', '>=', current);
  }

  /**
   * Finds a member with the given password reset token if one exists.
   * @param resetToken reset token to search on
   * @returns promise resolving in the found member object, or rejecting on error
   */
  public async findByPasswordResetToken(resetToken: string): Promise<Member> {
    return this.db.member
      .where({ password_reset_token: resetToken })
      .whereRaw('password_reset_expire > NOW()')
      .limit(1)
      .first();
  }

  public async getPrimaryRoleName(memberId: number): Promise<string> {
    return this.db.knex
      .select('role.name', 'member.primary_role_id')
      .from('member')
      .where('member.id', memberId)
      .join('role', 'member.primary_role_id', 'role.id');
  }

  /**
   * Returns the member's primary_role_id, or null.
   *
   * Deliberately separate from getPrimaryRoleName, which INNER JOINs role and so returns
   * an empty set when the column is null -- indistinguishable from "member not found".
   * Reconciliation needs to tell those apart.
   */
  public async getPrimaryRoleId(memberId: number): Promise<number | null> {
    const row = await this.db.knex
      .select('primary_role_id')
      .from('member')
      .where('id', memberId)
      .first();
    return row ? row.primary_role_id : null;
  }

  /**
   * This is to assist with the pagination of the user search
   * @param search
   * @return number
   */
  public async getTotal(search: string): Promise<CountRow[]> {
    return knex
      .count<CountRow[]>('id as count')
      .from('member')
      .where(this.like('username', search));
  }

  public async countByPlaceId(placeId: number, active: Date): Promise<CountRow[]> {
    return knex
      .count<CountRow[]>('id as count')
      .from('member')
      .where('place_id', placeId)
      .where('last_activity', '>=', active);
  }

  public async searchUsers(
    search: string,
    limit: number,
    offset: number,
  ): Promise<Pick<Member, 'id' | 'username' | 'last_daily_login_credit'>[]> {
    return knex
      .select(
        'id',
        'username',
        'last_daily_login_credit',
      )
      .from('member')
      .where(this.like('username', search))
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset);
  }

  /**
   * This is to assist with the pagination of the citizen directory
   * @param search
   * @return number
   */
  public async getDirectoryTotal(search: string): Promise<any> {
    return knex
      .count('id as count')
      .from('member')
      .where(this.like('username', search));
  }

  /**
   * Public-safe citizen directory search - only exposes fields that are
   * safe to show to anyone, not the admin-only member fields.
   */
  public async searchDirectory(search: string, limit: number, offset: number): Promise<any> {
    return knex
      .select(
        'member.id',
        'member.username',
        'member.created_at',
        'member.last_activity',
        'member.primary_role_id',
        'role.name as primary_role_name',
      )
      .from('member')
      .leftJoin('role', 'member.primary_role_id', 'role.id')
      .where(this.like('member.username', search))
      .orderBy('member.username', 'asc')
      .limit(limit)
      .offset(offset);
  }

  public async joinedPlace(memberId: number, props: Partial<Member>): Promise<void> {
    await this.db.member.where({ id: memberId }).update(props);
  }

  public async updateLatestActivity(memberId: number, props: Partial<Member>): Promise<void> {
    await this.db.member.where({ id: memberId }).update(props);
  }

  public async removeAccount(id: number): Promise<void> {
    await this.db.member
      .where('id', id)
      .del();
  }

  /**
   * Updates properties on the member record with the given id.
   * @param memberId id of member to be updated
   * @param props object containing key/value pairs of member properties to be updated
   * @param returning optional. defaults to false. returns the updated record if true.
   * @returns promise resolving in the updated member object, or rejecting on error
   */
  public async update(
    memberId: number,
    props: Partial<Member>,
    returning = false,
  ): Promise<Member | undefined> {
    await this.db.member.where({ id: memberId }).update(props);
    return returning ? this.findById(memberId) : undefined;
  }

  /**
   * This is used to bind the user inputted value to prevent
   * SQL injection attempts while using a Knex Raw
   * @param field
   * @param value
   * @private
   */
  private like(field: string, value: string) {
    return function () {
      this.whereRaw('?? LIKE ?', [field, `%${value}%`]);
    };
  }

  /**
   * Lists the immigrations still waiting on a city administrator, oldest first so the queue
   * is worked in the order people applied.
   *
   * `status = 1` excludes anyone who has since been banned, which is how an application is
   * refused -- there is no separate "rejected" state to filter on. Only the columns the
   * review screen needs are selected; the password hash and the reset token are never part
   * of this projection.
   *
   * @returns promise resolving in the pending members
   */
  public async findPendingApproval(): Promise<Partial<Member>[]> {
    return this.db.member
      .select('id', 'username', 'email', 'created_at')
      .whereNull('approved_at')
      .andWhere({ status: 1 })
      .orderBy('created_at', 'asc');
  }

  /**
   * Marks one pending immigration as approved.
   *
   * The `approved_at IS NULL` condition is part of the UPDATE rather than a preceding read,
   * so two administrators clicking Approve at the same moment produce one approval: the
   * second statement matches no rows and reports false. That is what lets the caller send
   * exactly one approval email.
   *
   * @param memberId member being approved
   * @param approverId administrator performing the approval
   * @returns true if this call is the one that approved them, false if they were already
   * approved or do not exist
   */
  public async approve(memberId: number, approverId: number): Promise<boolean> {
    const updated = await this.db.member
      .where({ id: memberId })
      .whereNull('approved_at')
      .update({ approved_at: new Date(), approved_by: approverId });
    return updated > 0;
  }

}
