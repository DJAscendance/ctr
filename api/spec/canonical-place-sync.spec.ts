import path from 'path';
import knexFactory, { Knex } from 'knex';

import { describeWithDb } from './integration-db';
import {
  CANONICAL_PLACES,
  OBSOLETE_SHOP_SLUGS,
  SYNCED_FIELDS,
  syncCanonicalPlaces,
} from '../db/migrations/20260911120000_sync_canonical_places';

/*
 * The canonical-place migration runs once, against a database that already holds
 * deployed rows. These specs exercise the deterministic helper the migration
 * calls, which is the only way to run it twice and to inject a failure.
 *
 * Every case runs in its own throwaway schema on the configured server, created
 * and dropped here, so the schema named by DB_DATABASE is never written. The
 * schema is built by the repository's own migrations, so `place` has the shape
 * the migration will actually meet.
 */

const MIGRATIONS = {
  directory: path.resolve(__dirname, '../db/migrations'),
  extension: 'ts',
  tableName: 'migrations',
};

const connection = {
  host: process.env.DB_HOST,
  port: Number.parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  charset: 'utf8mb4',
};

const CANONICAL_SHOP_SLUGS = CANONICAL_PLACES
  .filter(place => place.type === 'shop')
  .map(place => place.slug);

/**
 * An active shop this migration knows nothing about: not canonical, not one of
 * the nine retired slugs. It stands in for a shop added to Beta after this
 * migration was written, and it must come through untouched.
 */
const UNRELATED_SHOP = {
  name: 'Future Test Shop',
  description: 'added after this migration was written',
  slug: 'futuretestshop',
  assets_dir: '/shop/',
  world_filename: 'vrml/shop.wrl',
  type: 'shop',
  status: 1,
  member_id: null as number | null,
};

/** A deployed, still-active row for one of the nine retired shop slugs. */
function obsoleteRow(slug: string): Record<string, unknown> {
  return {
    name: slug,
    description: `stale ${slug}`,
    slug,
    assets_dir: '/shop/',
    world_filename: 'vrml/shop.wrl',
    type: 'shop',
    status: 1,
  };
}

let schemaName: string;
let db: Knex;

/** A deployed row for `slug`, deliberately drifted away from the canonical one. */
function staleRow(slug: string): Record<string, unknown> {
  const canonical = CANONICAL_PLACES.find(place => place.slug === slug);
  return {
    name: slug,
    description: `stale ${slug}`,
    slug,
    assets_dir: canonical.type === 'shop' ? '/shop/' : '/stale/',
    world_filename: canonical.type === 'shop' ? 'vrml/shop.wrl' : 'stale.wrl',
    type: canonical.type,
    status: 1,
  };
}

async function placeBySlug(slug: string): Promise<Record<string, unknown>> {
  return db('place').where({ slug }).first();
}

async function countPlaces(): Promise<number> {
  const [{ total }] = await db('place').count('id as total');
  return Number(total);
}

describeWithDb('canonical place sync', () => {
  beforeAll(async () => {
    schemaName = `ctr_place_sync_spec_${process.pid}`;
    const server = knexFactory({ client: 'mysql', connection });
    await server.raw('DROP DATABASE IF EXISTS ??', [schemaName]);
    await server.raw('CREATE DATABASE ?? CHARACTER SET utf8mb4', [schemaName]);
    await server.destroy();

    db = knexFactory({
      client: 'mysql',
      connection: { ...connection, database: schemaName },
      pool: { min: 0, max: 5 },
      migrations: MIGRATIONS,
    });
    await db.migrate.latest();
  }, 300000);

  afterAll(async () => {
    if (!db) return;
    await db.raw('DROP DATABASE IF EXISTS ??', [schemaName]);
    await db.destroy();
  });

  beforeEach(async () => {
    await db('place').del();
  });

  it('leaves an empty place table to the seeds', async () => {
    const result = await syncCanonicalPlaces(db);

    expect(result.skipped).toBe(true);
    expect(result.inserted).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.retired).toEqual([]);
    expect(await countPlaces()).toBe(0);
  });

  it('updates a stale canonical row in place and keeps its id', async () => {
    await db('place').insert(staleRow('mall'));
    const before = await placeBySlug('mall');

    const result = await syncCanonicalPlaces(db);

    expect(result.updated).toContain('mall');
    const after = await placeBySlug('mall');
    expect(after.id).toBe(before.id);
    expect(after.name).toBe('The Mall');
    expect(after.assets_dir).toBe('/shopping/');
    expect(after.world_filename).toBe('vrml/shopping.wrl');
  });

  it('inserts only the canonical rows that are missing', async () => {
    await db('place').insert(staleRow('mall'));
    await db('place').insert(staleRow('antiqueshop'));

    const result = await syncCanonicalPlaces(db);

    expect(result.inserted).not.toContain('mall');
    expect(result.inserted).not.toContain('antiqueshop');
    expect(result.inserted).toContain('celebrationshop');
    expect(result.inserted.length).toBe(CANONICAL_PLACES.length - 2);
    expect(await countPlaces()).toBe(CANONICAL_PLACES.length);
  });

  it('matches every canonical field and keeps every pre-existing id', async () => {
    const seeded = ['mall', 'newcomers', 'antiqueshop', 'generalstore', 'largeitemshop'];
    for (const slug of seeded) await db('place').insert(staleRow(slug));
    const idsBefore = new Map(
      (await db('place').select('id', 'slug')).map(row => [row.slug, row.id]),
    );

    await syncCanonicalPlaces(db);

    const rows = await db('place').select('*');
    const bySlug = new Map(rows.map(row => [row.slug, row]));
    const mismatches: string[] = [];
    for (const place of CANONICAL_PLACES) {
      const row = bySlug.get(place.slug);
      if (!row) {
        mismatches.push(`${place.slug}: missing`);
        continue;
      }
      if (row.status !== 1) mismatches.push(`${place.slug}: status ${row.status}`);
      for (const field of SYNCED_FIELDS) {
        const wanted = place[field] === undefined ? null : place[field];
        if (row[field] !== wanted) {
          mismatches.push(`${place.slug}.${field}: ${row[field]} != ${wanted}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
    for (const [slug, id] of idsBefore) expect(bySlug.get(slug).id).toBe(id);
  });

  it('retires an obsolete shop instead of deleting it, and keeps its id', async () => {
    for (const slug of OBSOLETE_SHOP_SLUGS) await db('place').insert(obsoleteRow(slug));
    const idsBefore = new Map(
      (await db('place').select('id', 'slug')).map(row => [row.slug, row.id]),
    );

    const result = await syncCanonicalPlaces(db);

    expect(result.retired.sort()).toEqual([...OBSOLETE_SHOP_SLUGS].sort());
    const retired = await db('place').whereIn('slug', OBSOLETE_SHOP_SLUGS).select('*');
    expect(retired.length).toBe(OBSOLETE_SHOP_SLUGS.length);
    for (const row of retired) {
      expect(row.status).toBe(0);
      expect(row.id).toBe(idsBefore.get(row.slug));
    }

    const active = await db('place').where({ type: 'shop', status: 1 }).select('slug');
    expect(active.map(row => row.slug).sort()).toEqual([...CANONICAL_SHOP_SLUGS].sort());
  });

  it('is safe to run again', async () => {
    await db('place').insert(staleRow('mall'));
    await db('place').insert(obsoleteRow('giftshop'));
    await db('place').insert(UNRELATED_SHOP);
    await syncCanonicalPlaces(db);
    const first = await db('place').select('id', 'slug', 'status').orderBy('id');

    const second = await syncCanonicalPlaces(db);

    expect(second.inserted).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.retired).toEqual([]);
    expect(await db('place').select('id', 'slug', 'status').orderBy('id')).toEqual(first);
    expect((await placeBySlug('futuretestshop')).status).toBe(1);
    expect((await placeBySlug('giftshop')).status).toBe(0);
  });

  it('leaves an unrelated active shop alone', async () => {
    await db('place').insert(UNRELATED_SHOP);
    for (const slug of OBSOLETE_SHOP_SLUGS) await db('place').insert(obsoleteRow(slug));
    const idBefore = (await placeBySlug('futuretestshop')).id;

    const result = await syncCanonicalPlaces(db);

    expect(result.retired.sort()).toEqual([...OBSOLETE_SHOP_SLUGS].sort());
    expect(result.retired).not.toContain('futuretestshop');
    const after = await placeBySlug('futuretestshop');
    expect(after.status).toBe(1);
    expect(after.id).toBe(idBefore);
    expect(after.name).toBe(UNRELATED_SHOP.name);
    expect(after.world_filename).toBe(UNRELATED_SHOP.world_filename);

    const active = await db('place').where({ type: 'shop', status: 1 }).select('slug');
    expect(active.map(row => row.slug).sort())
      .toEqual([...CANONICAL_SHOP_SLUGS, 'futuretestshop'].sort());
  });

  it('retires only the obsolete shops the database actually has', async () => {
    const present = ['giftshop', 'spaceport', 'weddingshop'];
    for (const slug of present) await db('place').insert(obsoleteRow(slug));

    const result = await syncCanonicalPlaces(db);

    expect(result.retired.sort()).toEqual([...present].sort());
    const absent = OBSOLETE_SHOP_SLUGS.filter(slug => present.indexOf(slug) === -1);
    for (const slug of absent) expect(await placeBySlug(slug)).toBeUndefined();
    for (const slug of present) expect((await placeBySlug(slug)).status).toBe(0);
  });

  it('refuses an obsolete slug owned by a member, before changing anything', async () => {
    await db('place').insert(staleRow('mall'));
    await db('place').insert({ ...obsoleteRow('giftshop'), member_id: 4242 });
    const before = await db('place').select('*').orderBy('id');

    await expect(syncCanonicalPlaces(db)).rejects.toThrow(/must not overwrite/);

    expect(await db('place').select('*').orderBy('id')).toEqual(before);
    expect(await countPlaces()).toBe(2);
  });

  it('refuses an obsolete slug stored under another type, before changing anything', async () => {
    await db('place').insert(staleRow('mall'));
    await db('place').insert({ ...obsoleteRow('spaceport'), type: 'public' });
    const before = await db('place').select('*').orderBy('id');

    await expect(syncCanonicalPlaces(db)).rejects.toThrow(/must not overwrite/);

    expect(await db('place').select('*').orderBy('id')).toEqual(before);
  });

  it('refuses a canonical slug owned by a member, before changing anything', async () => {
    await db('place').insert({ ...staleRow('mall'), type: 'home', member_id: 4242 });
    const before = await db('place').select('*').orderBy('id');

    await expect(syncCanonicalPlaces(db)).rejects.toThrow(/must not overwrite/);

    expect(await db('place').select('*').orderBy('id')).toEqual(before);
  });

  it('applies nothing when the enclosing transaction fails', async () => {
    await db('place').insert(staleRow('mall'));
    const before = await db('place').select('*').orderBy('id');
    expect(before.length).toBe(1);

    await expect(db.transaction(async trx => {
      await syncCanonicalPlaces(trx);
      throw new Error('injected failure');
    })).rejects.toThrow('injected failure');

    const after = await db('place').select('*').orderBy('id');
    expect(after.length).toBe(1);
    expect(after).toEqual(before);
  });
});
