import { Knex } from 'knex';
import * as fs from 'fs';

/**
 * Adds an `image_revision` token column to the home table. Every uploaded home image is
 * assigned a fresh, unguessable revision token; the pending file is stored under a
 * per-revision private filename (`<placeId>-<revision>.webp`) and moderation approval is
 * bound to the exact revision the moderator reviewed. This closes a moderation-bypass race
 * where an approval begun for one uploaded image could publish a different, unchecked image
 * that had replaced it under the old shared `<placeId>.webp` filename. NULL means the home
 * has no current image revision (no image, or an approved image predating this column).
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('home', 'image_revision'))) {
    console.log('Adding image_revision column to home table');
    await knex.schema.alterTable('home', table => {
      table.string('image_revision', 64).nullable();
    });
  }

  // Any image already AWAITING moderation before this migration has no revision token and its
  // file uses the old shared "<placeId>.webp" name, so it cannot be bound to the new
  // revision-based approval - it would sit in the queue forever (approve/reject require a
  // matching revision). Before the private, revision-bound pending storage this migration
  // introduces, a newly uploaded image was written directly to the PUBLIC canonical
  // "<placeId>.webp" file - the very same path an approved image lives at today - while still
  // marked 'pending' (see the pre-revision uploadHomeImage, which wrote straight into
  // ASSETS_DIR/homes-uploads). Clear these rows back to "no image" so the queue is not
  // permanently stuck and the owner simply re-uploads, and capture their place ids FIRST so the
  // now-orphaned, never-approved file for each one can be removed too - otherwise it lingers
  // reachable under the public assets directory even though nothing references it anymore.
  // (Approved rows keep their NULL revision - an approved image needs no revision, and this
  // only targets image_status = 'pending'.) Forward-only: down() cannot restore these rows,
  // which is acceptable for clearing unchecked, unbindable images.
  const legacyPending = await knex('home')
    .where({ image_status: 'pending' })
    .whereNull('image_revision')
    .select('place_id');

  // Delete the orphaned files BEFORE clearing their rows, so a failure partway through leaves
  // the DB rows still 'pending' rather than pointing at files this pass already removed - a
  // retried run then just re-selects the same rows, re-deletes (or hits ENOENT for) their
  // files, and proceeds to the update below. Only ever removes the exact file for a place id
  // whose row we just confirmed was 'pending' (never 'approved') - an ordinary clean
  // deployment has no matching rows, so this loop (and all filesystem access) is skipped
  // entirely. A missing file (ENOENT) means it was already cleaned up some other way and is
  // not an error; any other failure is left to surface and fail the migration rather than
  // being silently swallowed.
  const publicDir = `${process.env.ASSETS_DIR}/homes-uploads`;
  for (const { place_id: placeId } of legacyPending) {
    try {
      fs.unlinkSync(`${publicDir}/${placeId}.webp`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const cleared = await knex('home')
    .where({ image_status: 'pending' })
    .whereNull('image_revision')
    .update({
      image: null,
      image_status: 'none',
      image_checked_by: null,
      image_checked_at: null,
    });
  if (cleared > 0) {
    console.log(`Cleared ${cleared} legacy pending home image(s) that predate image_revision`);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('home', 'image_revision')) {
    console.log('Dropping image_revision column from home table');
    await knex.schema.alterTable('home', table => {
      table.dropColumn('image_revision');
    });
  }
}
