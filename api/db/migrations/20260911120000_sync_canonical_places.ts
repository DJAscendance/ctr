import { Knex } from 'knex';

import publicPlaceData = require('./../seed_data/public_place_data.json');
import clubPlaceData = require('./../seed_data/club_place_data.json');
import storeData = require('./../seed_data/store_data.json');

/**
 * A canonical public or shop place, exactly as the seeds write it.
 *
 * These are the same JSON files `02-places.seed.ts`, `10-clubs.seed.ts` and
 * `07-mall.store.seed.ts` insert, required as plain data. Nothing here imports
 * the API's DI container or its runtime-managed knex instance: a migration must
 * run on the connection knex hands it, with no `NODE_ENV` lookup.
 */
export interface CanonicalPlace {
  name: string;
  description: string;
  slug: string;
  assets_dir: string | null;
  world_filename: string | null;
  type: string;
}

/** The 23 public and 28 shop rows a correctly seeded stack carries. */
export const CANONICAL_PLACES: CanonicalPlace[] = [
  ...publicPlaceData,
  ...clubPlaceData,
  ...storeData,
];

/**
 * The columns this migration owns. Everything else on an existing row --
 * `id`, `member_id`, the map indexes, the messageboard and inbox intros,
 * `private`, the timestamps -- is left exactly as deployed.
 */
export const SYNCED_FIELDS: Array<keyof CanonicalPlace> = [
  'name',
  'description',
  'assets_dir',
  'world_filename',
  'type',
];

/**
 * The exact shop slugs the deployed Beta mall carried that the canonical mall
 * dropped. Retirement is limited to this list on purpose: "every shop that is
 * not canonical" would also retire a shop added after this migration was
 * written, which is not something a data migration may decide.
 */
export const OBSOLETE_SHOP_SLUGS = [
  'aquaticsshop',
  'bargainoutlet',
  'collectibles',
  'giftshop',
  'holdsdepot',
  'holidayshop',
  'magicalcorner',
  'spaceport',
  'weddingshop',
];

/** Types a canonical slug may already be stored under and still be safe to update. */
const UPDATABLE_TYPES = [null, 'public', 'shop'];

export interface SyncResult {
  /** True when the `place` table was empty and the migration deliberately did nothing. */
  skipped: boolean;
  inserted: string[];
  updated: string[];
  retired: string[];
}

function canonicalValue(place: CanonicalPlace, field: keyof CanonicalPlace): string | null {
  const value = place[field];
  return value === undefined ? null : value;
}

/**
 * Brings an already-deployed `place` table in line with the canonical rows.
 *
 * Existing canonical slugs are updated in place, so their `place.id` -- which
 * `messageboard`, `inbox`, `object_instance` and `place_role_access` all
 * reference -- never moves. Only slugs with no row at all are inserted. Shop
 * rows that are no longer canonical are retired with `status = 0`, which is the
 * same soft-delete the application already uses for storage areas; their rows
 * and ids stay.
 *
 * On an empty table this is a no-op: a fresh install runs migrations before
 * seeds, and the seeds are what create these rows.
 *
 * @param db knex instance or transaction to run against
 * @param canonical canonical rows to synchronize to
 * @returns what the synchronization did, per slug
 */
export async function syncCanonicalPlaces(
  db: Knex | Knex.Transaction,
  canonical: CanonicalPlace[] = CANONICAL_PLACES,
): Promise<SyncResult> {
  const result: SyncResult = { skipped: false, inserted: [], updated: [], retired: [] };

  const duplicates = canonical
    .map(place => place.slug)
    .filter((slug, index, slugs) => slugs.indexOf(slug) !== index);
  if (duplicates.length) {
    throw new Error(`Canonical place data has duplicate slugs: ${duplicates.join(', ')}`);
  }

  const revived = canonical
    .map(place => place.slug)
    .filter(slug => OBSOLETE_SHOP_SLUGS.indexOf(slug) !== -1);
  if (revived.length) {
    throw new Error(
      `Canonical place data lists slugs marked obsolete: ${revived.join(', ')}`,
    );
  }

  const [{ total }] = await db('place').count('id as total');
  if (Number(total) === 0) {
    result.skipped = true;
    return result;
  }

  const canonicalSlugs = canonical.map(place => place.slug);
  const existingRows = await db('place')
    .select('id', 'slug', 'status', 'member_id', ...SYNCED_FIELDS)
    .whereIn('slug', canonicalSlugs);

  const obsoleteRows = await db('place')
    .select('id', 'slug', 'status', 'member_id', 'type')
    .whereIn('slug', OBSOLETE_SHOP_SLUGS);

  const describe = (row: Record<string, unknown>): string =>
    `${row.slug} (id ${row.id}, type ${row.type}, member_id ${row.member_id})`;
  const conflicts = [
    ...existingRows
      .filter(row => row.member_id !== null || UPDATABLE_TYPES.indexOf(row.type) === -1)
      .map(describe),
    ...obsoleteRows
      .filter(row => row.member_id !== null || row.type !== 'shop')
      .map(describe),
  ];
  if (conflicts.length) {
    throw new Error(
      `Canonical slugs are owned by rows this migration must not overwrite: ${conflicts.join(
        '; ',
      )}`,
    );
  }

  const existingBySlug = new Map(existingRows.map(row => [row.slug, row]));

  for (const place of canonical) {
    const existing = existingBySlug.get(place.slug);

    if (!existing) {
      await db('place').insert({
        name: place.name,
        description: place.description,
        slug: place.slug,
        assets_dir: canonicalValue(place, 'assets_dir'),
        world_filename: canonicalValue(place, 'world_filename'),
        type: place.type,
        status: 1,
        private: 0,
      });
      result.inserted.push(place.slug);
      continue;
    }

    const changes: Record<string, string | number | null> = {};
    for (const field of SYNCED_FIELDS) {
      const wanted = canonicalValue(place, field);
      if (existing[field] !== wanted) changes[field] = wanted;
    }
    /* A canonical place is never a retired one. */
    if (existing.status !== 1) changes.status = 1;

    if (Object.keys(changes).length) {
      await db('place').where('id', existing.id).update(changes);
      result.updated.push(place.slug);
    }
  }

  /*
   * The shops that left the mall, and only those. They keep their rows and ids
   * so historical `object_instance` and messageboard references stay valid;
   * `status = 0` is what keeps them out of `findAllStores`, which every
   * member-facing store listing goes through. An obsolete slug with no row is
   * simply nothing to do -- not every deployment carried all nine.
   */
  const retirable = obsoleteRows.filter(row => row.status !== 0).map(row => row.slug);
  if (retirable.length) {
    await db('place').whereIn('slug', retirable).update({ status: 0 });
    result.retired = retirable;
  }

  return result;
}

export async function up(knex: Knex): Promise<void> {
  if (!await knex.schema.hasTable('place')) return;

  await knex.transaction(async trx => {
    const result = await syncCanonicalPlaces(trx);
    if (result.skipped) {
      console.log('place table is empty - leaving canonical places to the seeds');
      return;
    }
    console.log(
      `canonical places synced: ${result.inserted.length} inserted, `
      + `${result.updated.length} updated, ${result.retired.length} retired`,
    );
  });
}

/*
 * Not reversible. The rows this replaced were stale copies of the same places,
 * and nothing records what each field held before the update. Rolling back the
 * schema past this point leaves the canonical data in place, which is correct:
 * it is the data the deployed site already serves.
 */
export async function down(): Promise<void> {
  return;
}
