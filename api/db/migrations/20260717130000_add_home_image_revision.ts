import { Knex } from 'knex';

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
  // matching revision). These images were never public (they are pending). Clear them back to
  // "no image" so the queue is not permanently stuck and the owner simply re-uploads; nothing
  // unchecked is ever exposed. (Approved rows keep their NULL revision - an approved image
  // needs no revision, and this only targets image_status = 'pending'.) Forward-only: down()
  // cannot restore these rows, which is acceptable for clearing unchecked, unbindable images.
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
