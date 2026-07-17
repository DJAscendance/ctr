import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('home', 'image'))) {
    console.log('Adding image column to home table');
    await knex.schema.alterTable('home', table => {
      table.string('image');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('home', 'image')) {
    console.log('Dropping image column from home table');
    await knex.schema.alterTable('home', table => {
      table.dropColumn('image');
    });
  }
}
