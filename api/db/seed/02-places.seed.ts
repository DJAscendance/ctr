import { Knex } from 'knex';

import publicPlaceData = require('./../seed_data/public_place_data.json');

/*
 * The public places the deployed site serves, transcribed from its own
 * `place` rows so a freshly seeded stack matches production. Names and
 * descriptions were previously placeholders - most `name` fields repeated the
 * slug - which is what the member sees in the place header and the map.
 *
 * `type` is set explicitly. It defaulted to NULL here while every deployed row
 * carries 'public', and the messageboard and inbox controllers branch on that
 * value.
 *
 * The rows themselves live in `seed_data/public_place_data.json` so the
 * canonical-place migration can synchronize an already-deployed database
 * against the same bytes this seed writes, instead of carrying a second
 * hand-maintained copy that can drift.
 */
export async function seed(knex: Knex): Promise<void> {
  console.log('Creating seed places');
  await knex('place').insert(publicPlaceData);
}
