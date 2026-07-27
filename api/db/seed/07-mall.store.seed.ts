import { Knex } from 'knex';

const storeData = require('./../seed_data/store_data.json');

/**
 * Seeds the mall's shops, inserting each only when its slug is not already present and
 * otherwise refreshing the existing row.
 *
 * A bare `insert()` here is what produced the duplicate shops that
 * 20260727130000_dedupe_seeded_places had to clean up - every extra run of the seed suite
 * added a second copy of all 27 shops. That migration also adds UNIQUE(place.slug), so an
 * unconditional insert would now fail outright on a second run; this keeps the seed
 * re-runnable, matching how 09-update.roles.seed already behaves.
 */
export async function seed(knex: Knex): Promise<void> {
  console.log('Seeding store data');

  for (const store of storeData) {
    const existing = await knex('place').where('slug', store.slug).first();
    if (existing) {
      await knex('place').where('slug', store.slug).update(store);
    } else {
      await knex('place').insert(store);
    }
  }
}
