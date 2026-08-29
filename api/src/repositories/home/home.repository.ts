import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import {Home, Member} from '../../types/models';

/** Repository for fetching/interacting with home data in the database. */
@Service()
export class HomeRepository {

  constructor(private db: Db) {}

  public async create(homeParams: Home): Promise<void> {
    await this.db.home.insert(homeParams);
  }

  public async findById(placeId: number): Promise<Home> {
    const [home] = await this.db.home.where({ place_id: placeId });
    return home;
  }

  /**
   * Updates properties on the home record with the given id.
   * @param placeId id of place to be updated
   * @param props object containing key/value pairs of home properties to be updated
   * @param returning optional. defaults to false. returns the updated record if true.
   * @returns promise resolving in the updated home object, or rejecting on error
   */
  public async update(placeId: number, props: Partial<Home>, returning = false):
    Promise<Home | undefined> {
    await this.db.home
      .where({ place_id: placeId })
      .update(props);
    return returning
      ? this.findById(placeId)
      : undefined;
  }

  public async removePlace(id: number): Promise<any> {
    await this.db.home
      .where('place_id', id)
      .del();
  }

  /**
   * Runs the given work inside a single database transaction, so all image mutations for a
   * home (upload / approve / reject / remove / reset) commit or roll back together.
   * @param work callback receiving the transaction handle
   */
  public async runInTransaction<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.db.knex.transaction(work);
  }

  /**
   * Reads a home row while taking an exclusive row-level lock on it (`SELECT ... FOR
   * UPDATE`). Because every image mutation for a home first acquires this lock, they are
   * serialized against one another across concurrent requests - and across processes, since
   * the lock lives in the database, not in this process. Must be called inside a
   * transaction; the lock is held until that transaction commits or rolls back.
   * @param trx transaction handle from runInTransaction
   * @param placeId id of the home's place record
   */
  public async lockHome(trx: Knex.Transaction, placeId: number): Promise<Home> {
    const [home] = await trx<Home>('home').where({ place_id: placeId }).forUpdate();
    return home;
  }

  /**
   * Updates a home row within an existing transaction (see lockHome / runInTransaction).
   * @param trx transaction handle
   * @param placeId id of the home's place record
   * @param props columns to update
   */
  public async updateWithin(
    trx: Knex.Transaction,
    placeId: number,
    props: Partial<Home>,
  ): Promise<void> {
    await trx<Home>('home').where({ place_id: placeId }).update(props);
  }

  /**
   * Lists all homes whose uploaded image is awaiting moderation, joined with the owner's
   * username and the containing block, for display in the image-check queue. Includes each
   * pending image's revision token so the moderator's approve/reject request can be bound to
   * the exact revision they reviewed.
   */
  public async findPendingImageHomes(): Promise<any[]> {
    return this.db.knex('home')
      .join('place', 'place.id', 'home.place_id')
      .leftJoin('member', 'member.id', 'place.member_id')
      .leftJoin('map_location', 'map_location.place_id', 'home.place_id')
      .leftJoin('place as block', 'block.id', 'map_location.parent_place_id')
      .where('home.image_status', 'pending')
      .whereNotNull('home.image')
      .select(
        'home.place_id as placeId',
        'home.image as image',
        'home.image_revision as revision',
        'place.name as homeName',
        'member.username as ownerUsername',
        'block.name as blockName',
      );
  }

}
