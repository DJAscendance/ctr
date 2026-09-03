import { Knex } from 'knex';

/**
 * OUTLANDS-2B. Gives the historical scheduled-match passwords a home.
 *
 * THE HISTORICAL SHAPE. Classic Cybertown kept two fields on the Outlands place
 * object `O ID 0000000000000029`, written by `ne_game/passupdate.cfg`:
 *
 *     *UPD O ID 0000000000000029 PASS1 <$PASS1>     ; Blue Team password
 *     *UPD O ID 0000000000000029 PASS2 <$PASS2>     ; Red  Team password
 *
 * `ne_game/passupdate.tmpl` labels them without ambiguity, so PASS1 is Blue and
 * PASS2 is Red. That mapping is reproduced here and must not be reversed.
 *
 * WHY NOT TWO COLUMNS ON `place`, WHICH IS THE HISTORICAL SHAPE. Because CTR's
 * place read path is `SELECT *`. `PlaceRepository.findBySlug()` returns the whole
 * row and `PlaceController.getPlace()` hands that row straight to the client on an
 * unauthenticated `GET /api/place/:slug`; `findByType`, `searchAllPlaces` and
 * `findUserPlaces` do the same. A password column on `place` would therefore be
 * published to every visitor the moment it was added, and closing that would mean
 * auditing and column-listing every place read in the API - a far larger and more
 * dangerous change than this table. A separate table cannot be selected by
 * accident, so the secret has no read path except the one this lane writes.
 *
 * WHAT IS STORED. bcrypt hashes, never the typed password. The historical server
 * stored plaintext and compared with string equality; the observable contract is
 * only "one password means Blue, one means Red, anything else is refused", and a
 * hash satisfies it exactly. Nothing in CTR ever needs to read a match password
 * back, so nothing can.
 *
 * NULL means "no scheduled match is configured for that team", which is the state
 * a fresh database is in and the state clearing the passwords returns it to.
 */

const COLLATE = 'utf8mb4_unicode_ci';
const tableName = 'outlands_match_password';

export async function up(knex: Knex): Promise<void> {
  if (!await knex.schema.hasTable(tableName)) {
    console.log(`Creating ${tableName} table`);
    await knex.schema.createTable(tableName, table => {
      table.collate(COLLATE);
      table.increments('id').primary();
      table.timestamps(false, true);

      // One row per place. Unique so a place can never carry two disagreeing
      // sets of match passwords.
      table.integer('place_id')
        .unsigned()
        .notNullable()
        .unique();
      table.foreign('place_id')
        .references('place.id');

      // Historical PASS1. bcrypt hash, or NULL for "no Blue match configured".
      table.string('blue_password_hash', 255).nullable();
      // Historical PASS2. bcrypt hash, or NULL for "no Red match configured".
      table.string('red_password_hash', 255).nullable();

      // Who last set them. Nullable and unconstrained on purpose: this is an
      // audit note, and losing the member row must never block a password
      // rotation or wedge the table.
      table.integer('updated_by_member_id')
        .unsigned()
        .nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(tableName)) {
    console.log(`Dropping ${tableName} table`);
    await knex.schema.dropTable(tableName);
  }
}
