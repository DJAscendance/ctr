import { Knex } from 'knex';
import { Service } from 'typedi';

import { Db } from '../../db/db.class';
import {MapLocation, Place} from '../../types/models';

/** Repository for fetching/interacting with place data in the database. */
@Service()
export class MapLocationRepository {

  constructor(private db: Db) {}

  public async findPlaceIdMapLocation(placeId: number): Promise<MapLocation> {
    const [mapLocation] = await this.db.mapLocation.where({ place_id: placeId });
    return mapLocation;
  }

  public async findByParentPlaceIdAndLocation(parentPlaceId: number, location: number): Promise<MapLocation> {
    const [mapLocation] = await this.db.mapLocation.where({
      parent_place_id: parentPlaceId,
      location: location,
    });
    return mapLocation;
  }

  /**
   * Creates a new map location with the given parameters.
   * @param locationParams parameters to be used for the new map location
   * @returns promise
   */
  public async create(locationParams: Partial<MapLocation>): Promise<void> {
    await this.db.mapLocation.insert(locationParams)
      .onConflict(['parent_place_id','location'])
      .merge(['place_id','available']);
  }

  /**
   * Claims a lot for a place inside an existing transaction, but ONLY if the lot is still
   * free at the moment of the write. Freeness is proved by the UPDATE's own WHERE clause and
   * reported through the affected-row count - a prior read followed by an unconditional
   * update leaves a window in which another request claims the same lot between the two
   * statements, putting two homes on one lot.
   *
   * `map_location`'s primary key is (parent_place_id, location), so this statement locks
   * exactly one row and two racers for the same lot serialize on it: the loser's WHERE no
   * longer matches and it updates 0 rows.
   *
   * @param trx transaction handle
   * @param parentPlaceId id of the block the lot belongs to
   * @param location lot number within that block
   * @param placeId id of the place claiming the lot
   * @returns true when this call claimed the lot, false when it was already taken
   */
  public async claimLocationWithin(
    trx: Knex.Transaction,
    parentPlaceId: number,
    location: number,
    placeId: number,
  ): Promise<boolean> {
    const affected = await trx<MapLocation>('map_location')
      .where({ parent_place_id: parentPlaceId, location: location, available: true })
      .andWhere(builder => builder.whereNull('place_id').orWhere('place_id', 0))
      .update({ place_id: placeId });
    return affected === 1;
  }

  /**
   * Frees a lot inside an existing transaction, scoped to the place that currently holds it
   * so a stale caller can never release a lot another place has since claimed.
   * @param trx transaction handle
   * @param parentPlaceId id of the block the lot belongs to
   * @param location lot number within that block
   * @param placeId id of the place expected to currently hold the lot
   */
  public async releaseLocationWithin(
    trx: Knex.Transaction,
    parentPlaceId: number,
    location: number,
    placeId: number,
  ): Promise<void> {
    await trx<MapLocation>('map_location')
      .where({ parent_place_id: parentPlaceId, location: location, place_id: placeId })
      .update({ place_id: null });
  }

  /**
   * Reads the map location a place currently occupies, inside an existing transaction.
   * @param trx transaction handle
   * @param placeId id of the place whose lot to read
   */
  public async findPlaceLocationWithin(
    trx: Knex.Transaction,
    placeId: number,
  ): Promise<MapLocation> {
    const [mapLocation] = await trx<MapLocation>('map_location').where({ place_id: placeId });
    return mapLocation;
  }

  /**
   * Takes exclusive row locks on the given lots in a single statement, ordered by the
   * table's primary key (parent_place_id, location).
   *
   * The ordering is the point. A reset moves a home from one lot to another, so it must hold
   * both rows; if each request locked "old lot then new lot", two resets swapping lots in
   * opposite directions would each hold what the other needs and deadlock. Sorting on a
   * global, request-independent key means every request that touches the same pair of rows
   * takes them in the same sequence, so one simply waits for the other.
   *
   * @param trx transaction handle
   * @param keys lots to lock, in any order - this method imposes the canonical order
   */
  public async lockLocationsWithin(
    trx: Knex.Transaction,
    keys: Array<{ parentPlaceId: number; location: number }>,
  ): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    await trx<MapLocation>('map_location')
      .where(builder => {
        for (const key of keys) {
          builder.orWhere({ parent_place_id: key.parentPlaceId, location: key.location });
        }
      })
      .orderBy([{ column: 'parent_place_id' }, { column: 'location' }])
      .forUpdate();
  }

  public async unsetPlaceId(parentPlaceId: number, location: number): Promise<void> {
    await this.db.mapLocation
      .update({place_id: null})
      .where({parent_place_id: parentPlaceId, location: location});
  }

  public async resetAvailabilityByParentPlaceId(parentPlaceId: number): Promise<void> {
    await this.db.mapLocation
      .update({available: false })
      .where({ parent_place_id: parentPlaceId });

  }

  public async createAvailableLocation(parentPlaceId: number , location: number): Promise<void> {
    await this.db.mapLocation
      .insert({
        parent_place_id: parentPlaceId,
        location: location,
        available: true,
      })
      .onConflict(['parent_place_id','location'])
      .merge(['available']);
  }

  public async removePlace(id: number): Promise<any> {
    await this.db.mapLocation
      .where('place_id', id)
      .del();
  }


}
