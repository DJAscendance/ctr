import { Service } from 'typedi';

import { Db } from '../../db/db.class';

/** Repository for fetching/interacting with mall data in the database. */
@Service()
export class MallRepository {

  constructor(private db: Db) {}

  public async addToMallObjects(objectId: number): Promise<void> {
    await this.db.mallObject.insert({object_id: objectId});
  }

  public async getMallForSale(
    placeId: number): Promise<any> {
    const objects = await this.db.mallObject
      .select('object.*', 'mall_object.place_id', 'mall_object.position', 'mall_object.rotation')
      .where('place_id', placeId)
      .where('object.status', 1)
      .join('object', 'object.id', 'mall_object.object_id')
      .join('place', 'place.id', 'mall_object.place_id');
    return objects;
  }

  public async getStore(objectId: number): Promise<any> {
    const place = await this.db.mallObject
      .select('place.*')
      .where('mall_object.object_id',  objectId)
      .join('place', 'place.id', 'mall_object.place_id');
    return place;
  }


  /**
   * The store each of many objects sits in, in one query, for list pages that
   * would otherwise ask once per row.
   */
  public async getStoresByObjectIds(objectIds: number[]): Promise<{ [objectId: number]: any }> {
    const stores: { [objectId: number]: any } = {};
    if (!objectIds.length) {
      return stores;
    }
    const rows = await this.db.mallObject
      .select('place.*', 'mall_object.object_id')
      .whereIn('mall_object.object_id', objectIds)
      .join('place', 'place.id', 'mall_object.place_id');
    rows.forEach((row: any) => {
      if (!stores[row.object_id]) {
        stores[row.object_id] = row;
      }
    });
    return stores;
  }

  /** The store every placed object sits in, in one query. */
  public async getAllStoresByObjectId(): Promise<{ [objectId: number]: any }> {
    const stores: { [objectId: number]: any } = {};
    // Placement rides along here rather than being joined onto the export's
    // page query: this already collapses to one row per object, so it cannot
    // fan the page out. The columns are aliased because `place.*` owns the
    // unprefixed names.
    const rows = await this.db.mallObject
      .select(
        'place.*',
        'mall_object.object_id',
        'mall_object.position as mall_position',
        'mall_object.rotation as mall_rotation',
      )
      .join('place', 'place.id', 'mall_object.place_id');
    rows.forEach((row: any) => {
      if (!stores[row.object_id]) {
        stores[row.object_id] = row;
      }
    });
    return stores;
  }
  public async findByObjectId(objectId: number): Promise<any> {
    const object = await this.db.mallObject.where({object_id: objectId});
    return object;
  }

  public async updateObjectPlace(
    mallObjectId: number,
    shopId: number,
  ): Promise<void> {
    await this.db.mallObject.where({ object_id: mallObjectId }).update({
      place_id: shopId,
      position: '{"x":0.0,"y":1.75,"z":0.0}',
      rotation: '{"x":0,"y":0,"z":0,"angle":0}',
    });
  }

  public async updateObjectPlacement(
    mallObjectId: number,
    positionStr: string,
    rotationStr: string,
  ): Promise<void> {
    await this.db.mallObject.where({ object_id: mallObjectId }).update({
      position: positionStr,
      rotation: rotationStr,
    });
  }
}
