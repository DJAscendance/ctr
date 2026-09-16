import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { queryOn } from '../../db/query-on';
import { Avatar } from 'models';

/** Repository for fetching/interacting with avatar data in the database. */
@Service()
export class AvatarRepository {
  constructor(private db: Db) {}

  /**
   * Finds an avatar with the given search parameters if one exists.
   * @param avatarSearchParams object containing properties of an avatar for searching on
   * @returns promise resolving in the found avatar object, or rejecting on error
   * Finds all avatars
   * @returns promise resolving in the found avatars object, or rejecting on error
   */
  public async find(avatarSearchParams: Partial<Avatar>): Promise<Avatar> {
    const [avatar] = await this.db.avatar.where(avatarSearchParams);
    return avatar;
  }

  /**
   * Finds all avatars
   * @returns promise resolving in the found avatars object, or rejecting on error
   */
  public async findAll(): Promise<Avatar[]> {
    return this.db.avatar.where({ status: 1 });
  }

  public async removeAllAvatars(userId: number, trx?: Knex.Transaction): Promise<any> {
    await queryOn(this.db.knex, trx)('avatar')
      .where('member_id', userId)
      .del();
  }

  /**
   * gets all the avatars a memberId can access
   * @param memberId
   * @returns
   */
  public async findAllForMemberId(memberId): Promise<Avatar[]> {
    return this.db.avatar
      .where({
        status: 1,
      })
      .andWhere(builder => {
        builder.where({ private: 0 }).orWhere({ private: 1, member_id: memberId });
      });
  }

  /**
   * The system avatars with the given file names.
   *
   * Deliberately NOT filtered on `private`. The Outlands avatars are marked
   * `private = 1` with no owner precisely so that the ordinary member-facing
   * queries above can never serve them: a citizen may not list one and may not
   * wear one as their main avatar. This is the single narrow path that is
   * allowed to see them, and it is reached only through the Outlands gameplay
   * route.
   *
   * `member_id IS NULL` is part of the rule rather than a detail: it is what a
   * stock system row looks like, and it stops this path from ever reaching a
   * citizen's own upload that happens to share a file name.
   * @param filenames the system avatar file names to look for
   * @returns promise resolving in the matching system avatar rows
   */
  public async findSystemByFilenames(filenames: string[]): Promise<Avatar[]> {
    return this.db.avatar
      .whereIn('filename', filenames)
      .andWhere({ status: 1 })
      .whereNull('member_id');
  }

  /**
   * gets avatar by id a memberId can access
   * @param avatarId
   * @param memberId
   * @returns
   */
  public async getByIdAndMemberId(avatarId, memberId): Promise<Avatar[]> {
    return this.db.avatar
      .where({
        id: avatarId,
        status: 1,
      })
      .andWhere(builder => {
        builder.where({ private: 0 }).orWhere({ private: 1, member_id: memberId });
      });
  }

  public async updateStatus(id, status): Promise<any> {
    return this.db.avatar
      .update({
        status: status,
      })
      .where({
        id: id
      });
  }

  /**
   *
   * @param directory
   * @param fileName
   * @param image
   * @param name
   * @param gestures
   * @param privateStatus
   * @param memberId
   * @returns
   */
  public async create(
    directory: string,
    fileName: string,
    image: string,
    name: string,
    gestures: string,
    privateStatus: number,
    memberId: number,
    status: number,
  ): Promise<number> {
    const [avatar] = await this.db.avatar.insert({
      directory: directory,
      filename: fileName,
      image: image,
      name: name,
      gestures: gestures,
      private: privateStatus,
      member_id: memberId,
      status: status,
    });

    return avatar;
  }

  /**
   * This is to assist with the pagination of the avatar search
   * @param status
   * @return number
   */
  public async totalByStatus(status: number): Promise<any> {
    return this.db.avatar.count('id as count').where({
      status: status,
    });
  }

  /**
   * returns results of avatars by status (pagination)
   * @param status
   * @param limit
   * @param offset
   * @returns
   */
  public async findByStatus(status: number, limit: number, offset: number): Promise<any> {
    return this.db.avatar
      .select(['avatar.*', 'member.username'])
      .leftJoin('member', 'avatar.member_id', 'member.id')
      .where({
        'avatar.status': status,
      })
      .orderBy('avatar.id')
      .limit(limit)
      .offset(offset);
  }
}
