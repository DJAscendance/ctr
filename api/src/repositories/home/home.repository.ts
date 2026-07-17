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
   * Lists all homes whose uploaded image is awaiting moderation, joined with the owner's
   * username and the containing block, for display in the image-check queue.
   */
  /**
   * Atomically transitions a home's image from pending to approved, but only if it is still
   * pending. Returns true if this call performed the transition, false if it was already
   * approved/removed (e.g. a concurrent approval won the race). Makes approval safe under
   * duplicate/concurrent submissions - only one caller can ever flip a given pending image.
   */
  public async approveIfPending(placeId: number, checkerMemberId: number): Promise<boolean> {
    const affected = await this.db.home
      .where({ place_id: placeId, image_status: 'pending' })
      .update({
        image_status: 'approved',
        image_checked_by: checkerMemberId,
        image_checked_at: new Date(),
      });
    return affected > 0;
  }

  /**
   * Atomically transitions a home's image from pending to rejected (clearing the stored
   * image), but only if it is still pending. Returns true if this call performed the
   * transition, false if a concurrent rejection already did.
   */
  public async rejectIfPending(placeId: number, checkerMemberId: number): Promise<boolean> {
    const affected = await this.db.home
      .where({ place_id: placeId, image_status: 'pending' })
      .update({
        image: null,
        image_status: 'rejected',
        image_checked_by: checkerMemberId,
        image_checked_at: new Date(),
      });
    return affected > 0;
  }

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
        'place.name as homeName',
        'member.username as ownerUsername',
        'block.name as blockName',
      );
  }

}
