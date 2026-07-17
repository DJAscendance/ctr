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
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('home', 'image_revision')) {
    console.log('Dropping image_revision column from home table');
    await knex.schema.alterTable('home', table => {
      table.dropColumn('image_revision');
    });
  }
}
