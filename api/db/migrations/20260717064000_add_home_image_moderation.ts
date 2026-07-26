import { Knex } from 'knex';

/**
 * Adds image-moderation columns to the home table. Uploaded home images are held in a
 * "pending" state and hidden from the public (a "NOT CHECKED!" placeholder is shown
 * instead) until a Block Leader / Block Deputy / admin approves them via the CHECK tool -
 * recreating the classic Cybertown image-check workflow.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('home', 'image_status'))) {
    console.log('Adding image moderation columns to home table');
    await knex.schema.alterTable('home', table => {
      // 'none' (no image) | 'pending' (awaiting check) | 'approved' | 'rejected'
      table.string('image_status').notNullable().defaultTo('none');
      table.integer('image_checked_by').unsigned().nullable();
      table.timestamp('image_checked_at').nullable();
    });

    // Grandfather any existing uploaded images as already-approved so nothing that is
    // currently visible disappears when this ships.
    await knex('home').whereNotNull('image').update({ image_status: 'approved' });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('home', 'image_status')) {
    console.log('Dropping image moderation columns from home table');
    await knex.schema.alterTable('home', table => {
      table.dropColumn('image_status');
      table.dropColumn('image_checked_by');
      table.dropColumn('image_checked_at');
    });
  }
}
