import { Knex } from 'knex';
const tableName = 'beta_signup';
const COLLATE = 'utf8mb4_unicode_ci';
function applyCommon(table: Knex.CreateTableBuilder) {
  table.collate(COLLATE);
  table.increments('id').primary();
  table.timestamps(false, true);
}

export async function up(knex: Knex): Promise<void> {
  if(!await knex.schema.hasTable(tableName)) {
    await knex.schema.createTable(tableName, table => {
      console.log(`Creating ${tableName} table...`);
      applyCommon(table);

      table.string('email')
        .notNullable()
        .unique();

      table.string('note');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(tableName)) {
    await knex.schema.dropTable(tableName);
  }
}
