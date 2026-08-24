import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import { CountRow } from '../row.types';
// Aliased: the model is literally named `Object`, and leaving it under that
// name shadows the global built-in inside this file.
import { Object as ObjectModel, Place } from 'models';

/**
 * `ObjectService.STATUS_PENDING`, repeated rather than imported.
 *
 * A repository importing a service inverts the dependency direction every other
 * repository here observes, and typedi would resolve the cycle at construction
 * time. The value is part of the stored schema, not of the service.
 */
const PENDING_STATUS = 2;

/**
 * An object row as the Mall pages consume it.
 *
 * The stored columns, plus the fields that are attached after the query rather
 * than selected by it: `username` from a join or from `MallService`, and the
 * counts and store that `decorateObjects` fills in. They are optional because
 * the same rows travel through code that runs before decoration.
 */
export interface ObjectWithUsername extends ObjectModel {
  username?: string;
  instances?: number;
  store?: Place;
  forSale?: number;
  publicPlaces?: number;
}

/** Just enough of an object row to derive the staff-panel view memberships. */
export interface ObjectViewRow {
  id: number;
  status: number;
  quantity: number;
  limit: number | null;
}

@Service()
export class ObjectRepository {
  constructor(private db: Db) {}

  public async find(objectSearchParams: Partial<ObjectModel>): Promise<ObjectModel> {
    const [object] = await this.db.object.where(objectSearchParams);
    return object;
  }

  public async findById(objectId: number): Promise<ObjectModel> {
    return this.find({ id: objectId });
  }

  public async removeAccount(userId: number): Promise<void> {
    const objectInstanceIds = this.db.objectInstance
      .distinct('object_id')
      .whereNotNull('object_id');

    await this.db.object
      .where('member_id', userId)
      .where('status', 1)
      .update({status: 4});

    await this.db.object
      .where('member_id', userId)
      .where('status', 2)
      .update({status: 0});

    await this.db.object
      .where('member_id', userId)
      .where('status', 3)
      .whereIn('id', objectInstanceIds.clone())
      .update({status: 4});

    await this.db.object
      .where('member_id', userId)
      .where('status', 3)
      .whereNotIn('id', objectInstanceIds)
      .update({status: 0});

    await this.db.object
      .where('member_id', userId)
      .update({member_id: null});
  }

  /**
   *
   * @param directory
   * @param fileName
   * @param image
   * @param name
   * @param quantity
   * @param price
   * @param memberId
   * @param directory
   * @returns
   */
  public async create(
    directory: string,
    fileName: string,
    image: string,
    texture: string,
    name: string,
    quantity: number,
    price: number,
    memberId: number,
  ): Promise<number> {
    const [object] = await this.db.object.insert({
      directory: directory,
      filename: fileName,
      image: image,
      texture: texture,
      name: name,
      quantity: quantity,
      price: price,
      member_id: memberId,
    });

    return object;
  }

  public async findByStatus(status: number): Promise<ObjectWithUsername[]> {
    const objects = await this.db.object.where('status', status);
    return objects;
  }

  /**
   * Reads one object row inside a transaction, holding a row-level lock on it.
   *
   * The lock is what makes a rejection safe against a concurrent one: the second
   * request blocks here until the first commits, and then sees the status the
   * first one wrote rather than the status it read before either began.
   */
  public async findByIdForUpdate(
    objectId: number,
    trx: Knex.Transaction,
  ): Promise<ObjectModel> {
    const [object] = await this.db.object
      .transacting(trx)
      .forUpdate()
      .where({ id: objectId });
    return object;
  }

  public async update(objectId: number, props: object, trx?: Knex.Transaction): Promise<void> {
    const query = this.db.object.where({ id: objectId });
    if (trx) {
      query.transacting(trx);
    }
    await query.update(props);
  }

  public async updateObjectLimit(objectId: number, limit: number): Promise<void> {
    await this.db.object.where({ id: objectId }).update('limit', limit);
  }

  public async increaseObjectQuantity(
    objectId: number, props: object): Promise<void> {
    await this.db.object.where({ id: objectId }).update(props);
  }

  public async updateObjectName(objectId: number, name: string): Promise<void> {
    await this.db.object.where({ id: objectId }).update('name', name);
  }

  public async getMallForSale(
    status: number,
    mallExpiration: string,
  ): Promise<ObjectWithUsername[]> {
    const objects = await this.db.object
      .where('status', status)
      .where('mall_expiration', '>', mallExpiration);
    return objects;
  }

  public async findAllObjects(
    column: string, 
    compare: string, 
    content: string, 
    limit: number, 
    offset: number,
    orderBy: string,
  ): Promise<ObjectWithUsername[]> {
    const objects = await this.db.object
      .select('object.*')
      .where(column, compare, content)
      .limit(limit)
      .offset(offset)
      .orderBy('id', orderBy);
    return objects;
  }

  public async getMallObjectData(): Promise<ObjectWithUsername[]> {
    return await this.db.object.where('status', 1);
  }

  public async getUploadTotal(): Promise<CountRow[]> {
    return await this.db.object.count<CountRow[]>('id as count');
  }

  public async getTotalByStatus(status: number): Promise<CountRow[]> {
    return await this.db.object
      .count<CountRow[]>('id as count')
      .where('status', status);
  }

  public async getAcceptedTotal(): Promise<CountRow[]> {
    return await this.db.object
      .count<CountRow[]>('id as count')
      .where('status', '!=', '0')
      .where('status', '!=', '2');
  }

  public async getAverageMallPrice(): Promise<{ price: number }[]> {
    return await this.db.object
      .avg({price: 'price'})
      .where('status', 1);
  }

  public async getHighestMallPrice(): Promise<{ price: number }[]> {
    return await this.db.object
      .max({price: 'price'})
      .where('status', 1);
  }

  public async searchMallObjects(
    search: string,
    limit: number,
    offset: number,
  ): Promise<ObjectWithUsername[]> {
    return await this.db.object
      .where('status','!=', '0')
      .where('status','!=', '2')
      .where(this.like('name', search))
      .limit(limit)
      .offset(offset);
  }

  public async searchAllObjects(
    search: string, 
    compare: string, 
    status:number, 
    limit: number, 
    offset: number): Promise<ObjectWithUsername[]> {
    return await this.db.object
      .where('status',compare, status)
      .where(this.like('name', search))
      .limit(limit)
      .offset(offset);
  }

  public async getObjectsCatalog(limit: number, offset: number): Promise<ObjectWithUsername[]> {
    return await this.db.object
      .select('object.*', 'member.username')
      .where('object.status','!=', '0')
      .where('object.status','!=', '2')
      .leftJoin('member', 'object.member_id', 'member.id')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset);
  }

  public async catalogTotal(): Promise<CountRow[]> {
    return await this.db.object
      .count<CountRow[]>('id as count')
      .where('status','!=', '0')
      .where('status','!=', '2');
  }

  public async getTotal(search: string): Promise<CountRow[]> {
    return await this.db.object
      .count<CountRow[]>('id as count')
      .where('status','!=', '0')
      .where('status','!=', '2')
      .where(this.like('object.name', search));
  }

  public async getSearchTotal(
    search: string,
    compare: string,
    status: number,
  ): Promise<CountRow[]> {
    return await this.db.object
      .count<CountRow[]>('id as count')
      .where('status',compare, status)
      .where(this.like('object.name', search));
  }

  public async findMallSoldOut(): Promise<ObjectWithUsername[]> {
    const objects = await this.db.object
      .select('object.*', 'member.username')
      .leftJoin('member', 'member.id', 'object.member_id')
      .where('object.status', '=', '1');
    return objects;
  }

  /**
   * Every object's id, status and stock fields, for deriving the staff-panel
   * view memberships an export publishes. Deliberately narrow: the full rows are
   * streamed a page at a time instead.
   */
  public async findViewRows(): Promise<ObjectViewRow[]> {
    return this.db.object
      .select('id', 'status', 'quantity', 'limit')
      .where('status', PENDING_STATUS)
      .orderBy('id', 'asc');
  }

  /**
   * One page of full object rows, in the export's deterministic id order.
   *
   * Pending only. The export exists so the Mall Checker can publish the
   * submission queue to the Mall's own site; objects already stocked, warehoused
   * or removed are not part of that, and shipping them would put the whole CTR
   * catalogue in a document meant for one queue.
   */
  public async findPageForExport(limit: number, offset: number): Promise<ObjectWithUsername[]> {
    return this.db.object
      .select('object.*')
      .where('status', PENDING_STATUS)
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset);
  }

  public async getUserUploadedObjects(
    userId: number, 
    compare: string, 
    content: string,
    limit: number,
    offset: number): Promise<ObjectWithUsername[]> {
    const object = await this.db.object
      .select('object.*', 'member.username')
      .where('object.member_id', userId)
      .where('object.status', compare, content)
      .join('member', 'member.id', 'object.member_id')
      .limit(limit)
      .offset(offset)
      .orderBy('object.name');
    return object;
  }

  public async getMallObject(objectId: number): Promise<ObjectWithUsername[]> {
    const object = await this.db.object
      .select('object.*', 'member.username')
      .where('object.id', objectId)
      .where('object.status', 1)
      .join('member', 'member.id', 'object.member_id');
    return object;
  }

  public async total(column: string, compare: string, content: string): Promise<CountRow[]> {
    return this.db.object.count<CountRow[]>('id as count').where(column, compare, content);
  }

  public async totalCreator(
    column: string, compare: string, content: string, userId: number): Promise<CountRow[]> {
    return this.db.object.count<CountRow[]>('id as count')
      .where('member_id', userId)
      .where(column, compare, content);
  }

  private like(field: string, value: string) {
    return function() {
      this.whereRaw('?? LIKE ?', [field, `%${value}%`]);
    };
  }
}
