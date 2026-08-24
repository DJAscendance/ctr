import dotenv from 'dotenv';

// `knexfile` reads `../.env`, which resolves correctly for the running API but
// not for jest, whose cwd is `api/`. Loaded here so these tests talk to the
// same database the API does.
dotenv.config();

import { Db } from '../../db/db.class';
import { MallRepository } from './mall-object.repository';

/**
 * `getStoresByObjectIds`'s placement columns, against a real MySQL.
 *
 * `getAllStoresByObjectId` and `getStoresByObjectIds` must expose the exact
 * same shape -- `mall_position`/`mall_rotation` aliases included -- since the
 * export's `buildObject` reads those fields regardless of which one supplied
 * the store map. A mocked repository cannot catch a query that silently
 * dropped two selected columns; only running the real SQL can.
 *
 * Skipped, loudly, when no database is reachable, so the ordinary unit suite
 * stays runnable without one.
 */
const FIXTURE = {
  placeId: 990101,
  placedObjectId: 990101,
  unplacedObjectId: 990102,
  position: '{"x":1,"y":2,"z":3}',
  rotation: '{"x":0,"y":1,"z":0,"angle":1.5}',
};

describe('MallRepository.getStoresByObjectIds (real database)', () => {
  let db: Db;
  let repository: MallRepository;
  const configured = !!(process.env.DB_HOST && process.env.DB_DATABASE);

  beforeAll(async () => {
    if (!configured) {
      return;
    }
    db = new Db();
    await db.knex.raw('select 1');
  });

  afterAll(async () => {
    if (db) {
      await db.knex.destroy();
    }
  });

  async function cleanup(): Promise<void> {
    await db.knex('mall_object')
      .whereIn('object_id', [FIXTURE.placedObjectId, FIXTURE.unplacedObjectId]).del();
    await db.knex('object')
      .whereIn('id', [FIXTURE.placedObjectId, FIXTURE.unplacedObjectId]).del();
    await db.knex('place').where({ id: FIXTURE.placeId }).del();
  }

  beforeEach(async () => {
    if (!configured) {
      return;
    }
    repository = new MallRepository(db);
    await cleanup();
    await db.knex('place').insert({
      id: FIXTURE.placeId,
      name: 'Fixture Store',
      type: 'shop',
      status: 1,
    });
    await db.knex('object').insert([{
      id: FIXTURE.placedObjectId,
      filename: 'placed-fixture.wrl',
      name: 'Placed Fixture',
    }, {
      id: FIXTURE.unplacedObjectId,
      filename: 'unplaced-fixture.wrl',
      name: 'Unplaced Fixture',
    }]);
    await db.knex('mall_object').insert({
      object_id: FIXTURE.placedObjectId,
      place_id: FIXTURE.placeId,
      position: FIXTURE.position,
      rotation: FIXTURE.rotation,
    });
  });

  afterEach(async () => {
    if (configured) {
      await cleanup();
    }
  });

  (configured ? it : it.skip)(
    'exposes the same mall_position/mall_rotation aliases as getAllStoresByObjectId',
    async () => {
      const scoped = await repository.getStoresByObjectIds(
        [FIXTURE.placedObjectId, FIXTURE.unplacedObjectId],
      );
      const all = await repository.getAllStoresByObjectId();

      expect(scoped[FIXTURE.placedObjectId]).toBeDefined();
      expect(scoped[FIXTURE.placedObjectId].mall_position).toBe(FIXTURE.position);
      expect(scoped[FIXTURE.placedObjectId].mall_rotation).toBe(FIXTURE.rotation);
      expect(scoped[FIXTURE.unplacedObjectId]).toBeUndefined();

      expect(all[FIXTURE.placedObjectId].mall_position).toBe(scoped[FIXTURE.placedObjectId]
        .mall_position);
      expect(all[FIXTURE.placedObjectId].mall_rotation).toBe(scoped[FIXTURE.placedObjectId]
        .mall_rotation);
    },
  );

  (configured ? it : it.skip)('returns nothing for ids outside the requested set', async () => {
    const scoped = await repository.getStoresByObjectIds([FIXTURE.unplacedObjectId]);

    expect(Object.keys(scoped)).toEqual([]);
  });
});
