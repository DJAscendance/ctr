import { Knex } from 'knex';

/**
 * Lots per block. `BlockMapPage.vue` renders a fixed `v-for="index in 72"` grid and the
 * block wizard offers the same 72 cells, so this is the size of a block everywhere else in
 * CTR -- it is not a number chosen here.
 */
const LOTS_PER_BLOCK = 72;

/** How many rows to insert per statement. */
const CHUNK = 2000;

/**
 * Opens the home lots on every block, so a newly immigrated citizen has somewhere to move
 * into.
 *
 * WHY THIS EXISTS. `map_location` rows are what a home is settled onto, and nothing creates
 * them for an ordinary block: `04-places.hoods.seed` deletes the whole table and then
 * writes back only the rows that position hoods and blocks on their parents' maps. The one
 * thing that opens a residential lot is the block wizard, an admin screen someone has to
 * visit block by block. So a freshly built database has 856 blocks and zero places to live:
 * immigration works, and then the new citizen can never settle a home. That is the gap this
 * closes.
 *
 * It matches classic Cybertown, where a block's lots existed and were free until somebody
 * took one -- an empty block was an empty block, not a block with no land in it.
 *
 * SAFE TO RE-RUN, AND SAFE ON A LIVED-IN DATABASE. Only rows that are absent are inserted:
 * the existing `(parent_place_id, location)` pairs are read first and skipped. That matters
 * more than idempotency for its own sake. An upsert would rewrite `available` on lots an
 * administrator had deliberately closed through the wizard, and re-opening land somebody
 * shut is not a seed's decision to make. Nothing here ever touches `place_id`, so no
 * occupied lot can be freed and no citizen can lose their home to a re-seed.
 */
export async function seed(knex: Knex): Promise<void> {
  const blocks = await knex('place').where({ type: 'block' }).select('id');
  if (!blocks.length) {
    console.log('13-home-lots.seed: no blocks found, nothing to open');
    return;
  }

  const blockIds = blocks.map(block => block.id);

  // One read for the whole city rather than a query per block: 856 blocks would otherwise
  // be 856 round trips before a single row is written.
  const existing = await knex('map_location')
    .whereIn('parent_place_id', blockIds)
    .select('parent_place_id', 'location');

  const taken = new Set(
    existing.map(row => `${row.parent_place_id}:${row.location}`),
  );

  const rows: { parent_place_id: number; location: number; available: boolean }[] = [];
  for (const blockId of blockIds) {
    for (let location = 1; location <= LOTS_PER_BLOCK; location++) {
      if (taken.has(`${blockId}:${location}`)) continue;
      rows.push({ parent_place_id: blockId, location, available: true });
    }
  }

  if (!rows.length) {
    console.log('13-home-lots.seed: every block already has its lots, nothing to do');
    return;
  }

  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    await knex('map_location').insert(rows.slice(offset, offset + CHUNK));
  }

  console.log(
    `13-home-lots.seed: opened ${rows.length} home lots across ${blockIds.length} blocks`,
  );
}
