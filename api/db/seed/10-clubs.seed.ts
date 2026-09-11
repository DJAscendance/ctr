import { Knex } from 'knex';

import clubPlaceData = require('./../seed_data/club_place_data.json');

/*
 * Newcomers Club is split the same way the deployed row splits it.
 * WorldBrowserPage builds `/assets/worlds/${assets_dir}${world_filename}`, so
 * the old pair resolved to a working URL too - this is parity with production,
 * not a broken path being repaired. Every deployed assets_dir carries a leading
 * slash, which is why the built URL has a doubled separator; nginx merges it.
 *
 * The rows live in `seed_data/club_place_data.json`, shared with the
 * canonical-place migration - see `02-places.seed.ts`.
 */
export async function seed(knex: Knex): Promise<void> {
  console.log('Seeding Club Directory Place data');

  for (const place of clubPlaceData) {
    await knex('place').insert({
      ...place,
      status: 1,
      map_background_index: null,
      map_icon_index: null,
      member_id: null,
      messageboard_intro: null,
      inbox_intro: null,
      private: 0,
    });
  }
}
