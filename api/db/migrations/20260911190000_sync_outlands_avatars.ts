import { Knex } from 'knex';

import { OUTLANDS_AVATARS, OutlandsAvatar, directoryOf } from '../seed_data/outlands_avatars';

/**
 * Put the five Outlands team avatars into a database that was deployed before
 * they existed.
 *
 * The rows were added as `14-avatars.outlands.seed.ts`, and a seed is the only
 * thing that ever writes them: no migration in this repository inserts an
 * `avatar` row. A Beta deployment runs `npm run db:migrate` and nothing else
 * (.github/workflows/main.yml), so the persistent database never received them.
 * Without the rows `GET /avatar` returns no `redm.wrl`, `redf.wrl`, `bluem.wrl`
 * or `bluef.wrl`, the Outlands entrance finds an empty library, all four
 * choices stay disabled and nobody can enter Free Play.
 *
 * The canonical values live in `../seed_data/outlands_avatars`, which the seed
 * reads too, so the deployment path and the fresh-install path cannot drift.
 */

/**
 * The columns this migration owns on an existing row. Everything else --
 * `id`, `member_id`, `gestures`, the timestamps -- is left as deployed.
 *
 * `status` and `private` are owned because together they are what decides who
 * may reach a row. `AvatarRepository.findAllForMemberId` serves `status = 1`
 * and either `private = 0` or the caller's OWN private avatar, and
 * `getByIdAndMemberId` applies the same rule to the persistent avatar-change
 * path. These five are system gameplay resources, not citizen avatars: they
 * carry a weapon, they decide a side in Outlands, and the Game Master's was
 * never a public choice. So they are written `private = 1` with no owner, and
 * because a row with `member_id = NULL` is nobody's own private avatar, both
 * of those queries refuse them for every citizen. The Outlands entrance
 * reaches them through `AvatarRepository.findSystemByFilenames`, which is the
 * one path allowed to.
 *
 * `status = 1` still matters: that narrow path requires it too, so a row left
 * at the schema default `status = 2` is present and still unreachable.
 */
export const SYNCED_FIELDS = ['name', 'filename', 'image', 'directory', 'status', 'private'];

/** The shape of an `avatar` row this migration writes. */
function canonicalRow(avatar: OutlandsAvatar): Record<string, unknown> {
  return {
    name: avatar.name,
    filename: avatar.filename,
    image: avatar.image,
    directory: directoryOf(avatar),
    status: 1,
    private: 1,
  };
}

export interface SyncResult {
  /** True when the `avatar` table was empty and the migration deliberately did nothing. */
  skipped: boolean;
  /** File names inserted. */
  inserted: string[];
  /** File names whose owned columns were brought back to canonical. */
  updated: string[];
}

/**
 * Synchronise the five canonical Outlands avatars.
 *
 * Separated from `up` so the specs can run it twice, inspect what it decided
 * and inject a failure inside its transaction. The migration itself is this
 * call and nothing else.
 */
export async function syncOutlandsAvatars(knex: Knex): Promise<SyncResult> {
  const result: SyncResult = { skipped: false, inserted: [], updated: [] };

  /*
   * A fresh installation runs every migration against an empty schema and only
   * then runs the seeds, which own the stock avatar rows. Writing rows 12..16
   * here would put this migration in competition with `01-avatars.seed` and
   * `14-avatars.outlands.seed` over the same table on a database that has no
   * deployment gap to repair. An empty `avatar` table is exactly that case, so
   * it is left alone and the seeds do their normal work.
   */
  const [{ count }] = await knex('avatar').count({ count: '*' });
  if (Number(count) === 0) {
    result.skipped = true;
    return result;
  }

  const ids = OUTLANDS_AVATARS.map(avatar => avatar.id);
  const filenames = OUTLANDS_AVATARS.map(avatar => avatar.filename);
  const rows = await knex('avatar').whereIn('id', ids).orWhereIn('filename', filenames);

  /*
   * Pre-flight, before a single write.
   *
   * An id or a file name that already belongs to something else is not this
   * migration's to take: silently overwriting it would destroy a citizen's own
   * uploaded avatar, and every member row pointing at it would follow. Each
   * conflict aborts the whole migration with the row named, so an operator can
   * move the offending avatar and run it again.
   */
  const missing: OutlandsAvatar[] = [];
  const stale: OutlandsAvatar[] = [];
  for (const avatar of OUTLANDS_AVATARS) {
    const atId = rows.find(row => Number(row.id) === avatar.id);
    const named = rows.find(row => row.filename === avatar.filename);

    if (atId && atId.filename !== avatar.filename) {
      throw new Error(`avatar id ${avatar.id} is already ${atId.filename}, not the Outlands `
        + `${avatar.filename}; move that avatar before synchronising the Outlands avatars`);
    }
    if (named && Number(named.id) !== avatar.id) {
      throw new Error(`${avatar.filename} is already avatar id ${named.id}, not the Outlands `
        + `id ${avatar.id}; give that avatar another file name before synchronising`);
    }
    /*
     * A stock Outlands avatar has no owner. A row sitting on the canonical id
     * AND file name but carrying a `member_id` is a citizen's upload that
     * happens to collide, and taking it over would move somebody's avatar into
     * the public library.
     */
    if (atId && atId.member_id !== null && atId.member_id !== undefined) {
      throw new Error(`avatar id ${avatar.id} (${avatar.filename}) belongs to member `
        + `${atId.member_id}; release that avatar before synchronising the Outlands avatars`);
    }

    if (!atId) {
      missing.push(avatar);
      continue;
    }
    const wanted = canonicalRow(avatar);
    if (SYNCED_FIELDS.some(field => String(atId[field]) !== String(wanted[field]))) {
      stale.push(avatar);
    }
  }

  if (!missing.length && !stale.length) return result;

  /*
   * The inserts and the updates are one repair. A run that added two rows and
   * then failed would leave the entrance half working and the next run facing a
   * state neither this migration nor an operator wrote, so they share a
   * transaction and fail together.
   */
  await knex.transaction(async trx => {
    if (missing.length) {
      await trx('avatar').insert(missing.map(avatar => ({
        id: avatar.id,
        ...canonicalRow(avatar),
      })));
    }
    for (const avatar of stale) {
      await trx('avatar').where({ id: avatar.id }).update(canonicalRow(avatar));
    }
  });

  result.inserted = missing.map(avatar => avatar.filename);
  result.updated = stale.map(avatar => avatar.filename);
  return result;
}

export async function up(knex: Knex): Promise<void> {
  const result = await syncOutlandsAvatars(knex);
  if (result.skipped) {
    console.log('Outlands avatars: empty avatar table, leaving the rows to the seeds');
    return;
  }
  console.log(`Outlands avatars: inserted ${result.inserted.length}, `
    + `updated ${result.updated.length}`);
}

/**
 * Deliberately empty.
 *
 * Rolling this migration back cannot delete the five avatars: by the time it
 * runs they are indistinguishable from the rows a seeded installation has
 * always had, and members may be wearing them. Removing them would break every
 * `member.avatar_id` pointing at one. There is nothing safe to undo.
 */
export async function down(): Promise<void> {
  console.log('Outlands avatars: nothing to roll back, the rows are ordinary avatars');
}
