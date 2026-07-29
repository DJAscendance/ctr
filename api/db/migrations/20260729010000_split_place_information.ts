import { Knex } from 'knex';

import { sanitizeUserHtml } from '../../src/libs';

/**
 * Splits public Information away from the administrative Description.
 *
 * THE PROBLEM. `place.description` had three writers with three different
 * meanings: the Admin Panel wrote it as an administrative summary, the MANAGE
 * Information editor wrote manager-authored HTML into it, and a citizen's Home
 * Information editor wrote free text into it. Whoever saved last won, which is
 * why the Admin Panel's Description column showed `<h3>Welcome to the Mall</h3>`.
 * They are two different concepts owned by two different sets of people, so they
 * get two columns:
 *
 *   place.description -> administrator-controlled metadata
 *   place.information -> manager/owner-authored public content, sanitized
 *
 * The column is named `information` with no `_html` suffix because the table's
 * other text columns are bare nouns (`messageboard_intro`, `inbox_intro`,
 * `world_filename`).
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ATOMIC, AND WHAT IS NOT. Stated precisely, because MySQL will not let
 * this be one transaction end to end.
 *
 * MySQL implicitly commits before and after every DDL statement, so ALTER TABLE
 * and CREATE TABLE cannot participate in a transaction here. This migration
 * therefore separates the two phases and orders them so the non-transactional
 * one is harmless:
 *
 *   PHASE 1 - schema only (DDL, NOT transactional, and NOT reversible mid-way).
 *             Adds the `information` column and creates the backup table. Both
 *             are additive: they touch no existing content, so a failure here
 *             leaves every description exactly as it was.
 *
 *   PHASE 2 - content only (DML, ONE transaction). Fills the backup, copies
 *             values across, verifies them, clears what has to be cleared, and
 *             restores the provable administrative descriptions. Any failure
 *             rolls the whole phase back, leaving descriptions untouched and the
 *             migration unrecorded, so it can simply be run again.
 *
 * The claim being made is therefore NOT "the whole migration is atomic". It is:
 * no content is ever modified outside a transaction, and no description is ever
 * cleared before a verified backup of it is committed-visible inside that same
 * transaction.
 * ---------------------------------------------------------------------------
 *
 * SANITIZING. Values are passed through the SHARED sanitizer
 * (`libs/sanitize-user-html`) on the way across - the same allowlist Place
 * Information, Messageboard and Inbox use. That logic is imported, not
 * reimplemented. It matters most for homes: a home's description was stored
 * verbatim and escaped at render time, so this is the one moment those rows are
 * brought under the allowlist before anything renders them as HTML.
 *
 * WHAT IS CLEARED, AND WHY THE TWO CASES DIFFER.
 *
 *   - HOMES: `description` was ONLY ever the citizen's Information. There is no
 *     administrative meaning to preserve, so after the value is verified in
 *     `information` the old column is cleared.
 *
 *   - EVERY OTHER TYPE: `description` is left ALONE. It is presumed to be the
 *     administrator's own text, and this migration does not get to guess. The
 *     single exception is a row whose description is provably not
 *     administrator-authored - see RECONCILIATION.
 *
 * RECONCILIATION. For rows holding manager-authored HTML in `description`, and
 * ONLY those, the original administrative description is recovered from
 * repository evidence:
 *
 *   - public places are seeded with `description` equal to their slug
 *     (api/db/seed/02-places.seed.ts), so `mall` -> 'mall';
 *   - hoods and blocks are never seeded with a description at all
 *     (03/04-places.*.seed.ts set none), so the original was empty -> NULL.
 *
 * A row whose description contains HTML but does NOT match one of those provable
 * shapes is left exactly as found and reported for manual cleanup. Nothing is
 * synthesized.
 */

const BACKUP_TABLE = 'place_information_migration_backup';

/**
 * Where `down()` parks Information written AFTER this migration ran.
 *
 * Rolling back drops the `information` column, which would silently destroy any
 * Information authored since - content no pre-migration backup can contain,
 * because it did not exist yet. It is archived here first, so a rollback is
 * recoverable rather than merely reversible. Kept deliberately: dropping it is a
 * separate, deliberate act.
 */
const ROLLBACK_ARCHIVE_TABLE = 'place_information_rollback_archive';

/** This migration's own name, stamped into the backup so a stale one is detectable. */
const MIGRATION_ID = '20260729010000_split_place_information';

/** Types with a manager/owner Information editor today. Others have none. */
const INFORMATION_TYPES = ['block', 'hood', 'colony', 'public', 'home'];

/** Cheap "does this look like markup" test, matching the audit query. */
const HTML_PATTERN = /<[a-zA-Z/!]/;

interface PlaceRow {
  id: number;
  type: string;
  slug: string | null;
  description: string | null;
}

/**
 * Fails the migration unless a pre-existing backup table can be PROVEN safe to
 * build on.
 *
 * A leftover table from an earlier attempt is not evidence of a good backup - it
 * is evidence that an earlier attempt did not finish. The property that actually
 * matters is a superset guarantee:
 *
 *     every row that still holds a description is represented in the backup
 *
 * because that is exactly what makes clearing safe. Anything weaker (row counts
 * matching, the table merely existing) can be true of a backup that is missing
 * the one row about to be destroyed.
 */
async function validateBackupSchema(trx: Knex.Transaction): Promise<void> {
  const columns = await trx('information_schema.columns')
    .select('column_name as name')
    .where('table_schema', trx.raw('database()'))
    .andWhere('table_name', BACKUP_TABLE);
  const names = columns.map((c: any) => String(c.name).toLowerCase()).sort();
  const expected = ['description', 'description_after', 'migration_id', 'place_id'];
  for (const column of expected) {
    if (!names.includes(column)) {
      throw new Error(
        `${BACKUP_TABLE} exists but has an unexpected schema (missing '${column}'; `
        + `found ${names.join(', ')}). Refusing to trust it - inspect and drop it `
        + 'manually before re-running.',
      );
    }
  }

}

/**
 * Content checks for a backup that already holds rows. Split from the schema
 * check because an EMPTY leftover table still has to have its shape verified -
 * otherwise the insert below fails with a raw SQL error instead of a diagnosis.
 */
async function validateExistingBackupContent(trx: Knex.Transaction): Promise<void> {
  const [{ count: duplicates }] = await trx.raw(
    `select count(*) as count from (
       select place_id from ${BACKUP_TABLE} group by place_id having count(*) > 1
     ) d`,
  ).then((r: any) => r[0]);
  if (Number(duplicates) > 0) {
    throw new Error(
      `${BACKUP_TABLE} contains ${duplicates} duplicated place_id rows, so the original `
      + 'description for those places is ambiguous. Refusing to proceed.',
    );
  }

  const [{ count: foreign }] = await trx.raw(
    `select count(*) as count from ${BACKUP_TABLE}
      where migration_id is null or migration_id <> ?`,
    [MIGRATION_ID],
  ).then((r: any) => r[0]);
  if (Number(foreign) > 0) {
    throw new Error(
      `${BACKUP_TABLE} contains ${foreign} rows that do not belong to ${MIGRATION_ID}. `
      + 'It is a stale or foreign backup. Refusing to proceed.',
    );
  }

  const [{ count: unbacked }] = await trx.raw(
    `select count(*) as count from place p
      where p.description is not null
        and p.description <> ''
        and not exists (select 1 from ${BACKUP_TABLE} b where b.place_id = p.id)`,
  ).then((r: any) => r[0]);
  if (Number(unbacked) > 0) {
    throw new Error(
      `${BACKUP_TABLE} is incomplete: ${unbacked} place rows still hold a description `
      + 'that is not backed up. Refusing to clear anything on top of a partial backup.',
    );
  }
}

export async function up(knex: Knex): Promise<void> {
  // ---- PHASE 1: schema only. Additive, so a failure here changes no content.
  if (!(await knex.schema.hasColumn('place', 'information'))) {
    console.log('Adding information column to place table');
    await knex.schema.alterTable('place', table => {
      table.text('information').nullable();
    });
  }

  const backupExisted = await knex.schema.hasTable(BACKUP_TABLE);
  if (!backupExisted) {
    console.log(`Creating ${BACKUP_TABLE}`);
    // Built with `place`'s OWN collation, not the database default. On the real
    // database `place` is utf8mb4_unicode_ci while a freshly created table gets
    // utf8mb4_general_ci, and comparing the two text columns then fails outright
    // with ER_CANT_AGGREGATE_2COLLATIONS - which is exactly the comparison
    // down() depends on to avoid overwriting newer administrative text.
    const [collationRow] = await knex.raw(
      `select table_collation as collation from information_schema.tables
        where table_schema = database() and table_name = 'place'`,
    ).then((r: any) => r[0]);
    const collation = collationRow && collationRow.collation
      ? String(collationRow.collation)
      : null;
    const charset = collation ? collation.split('_')[0] : null;

    await knex.raw(
      `create table ${BACKUP_TABLE} (
         place_id int unsigned not null primary key,
         -- What the description was BEFORE this migration; what down() restores.
         description text,
         -- What this migration LEFT it as. down() compares against this to tell
         -- "nobody has touched it since" from "an administrator has written a
         -- real description here", and only restores the former.
         description_after text,
         migration_id varchar(128) not null
       )${collation ? ` default charset=${charset} collate=${collation}` : ''}`,
    );
  }

  // ---- PHASE 2: all content movement, in ONE transaction.
  await knex.transaction(async trx => {
    const [{ count: existingRows }] = await trx.raw(
      `select count(*) as count from ${BACKUP_TABLE}`,
    ).then((r: any) => r[0]);

    if (backupExisted) {
      // Shape is checked whether or not it holds rows.
      await validateBackupSchema(trx);
    }

    if (backupExisted && Number(existingRows) > 0) {
      console.log(`${BACKUP_TABLE} already exists - validating before reuse`);
      await validateExistingBackupContent(trx);
      console.log(`${BACKUP_TABLE} validated: complete, unique and ours`);
    } else {
      // Either brand new, or an empty shell left by a previous attempt whose
      // content phase rolled back. An EMPTY backup is not a partial one: nothing
      // was ever cleared on the strength of it, so populating it now is safe.
      if (backupExisted) {
        console.log(`${BACKUP_TABLE} exists but is empty - populating it`);
      }
      await trx.raw(
        `insert into ${BACKUP_TABLE} (place_id, description, migration_id)
         select id, description, ? from place where description is not null`,
        [MIGRATION_ID],
      );
      // Prove the snapshot is complete BEFORE anything is cleared. Reading it
      // back inside the same transaction is the point: this is the guarantee
      // every later clear depends on.
      const [{ count: unbacked }] = await trx.raw(
        `select count(*) as count from place p
          where p.description is not null
            and not exists (select 1 from ${BACKUP_TABLE} b where b.place_id = p.id)`,
      ).then((r: any) => r[0]);
      if (Number(unbacked) > 0) {
        throw new Error(
          `backup snapshot is incomplete (${unbacked} rows missing); rolling back`,
        );
      }
    }

    const places: PlaceRow[] = await trx('place')
      .select('id', 'type', 'slug', 'description')
      .whereIn('type', INFORMATION_TYPES)
      .whereNotNull('description')
      .andWhere('description', '<>', '');

    // Sanitizing has to happen in JS, so the copy is per row. Everything that
    // CAN be set-based below is, and all of it shares this one transaction.
    const homeIds: number[] = [];
    const clearIds: number[] = [];
    const slugRestores: PlaceRow[] = [];
    const unresolved: PlaceRow[] = [];

    for (const place of places) {
      const clean = sanitizeUserHtml(place.description || '');
      await trx('place').where('id', place.id).update({ information: clean });

      const [stored] = await trx('place').select('information').where('id', place.id);
      if (!stored || stored.information !== clean) {
        throw new Error(
          `place ${place.id}: information did not persist; rolling back without `
          + 'clearing any description',
        );
      }

      if (place.type === 'home') {
        homeIds.push(place.id);
      } else if (!HTML_PATTERN.test(place.description || '')) {
        // Plain text in a non-home description: presumed administrative.
        continue;
      } else if (place.type === 'hood' || place.type === 'block') {
        clearIds.push(place.id);
      } else if (place.type === 'public' && place.slug) {
        slugRestores.push(place);
      } else {
        unresolved.push(place);
      }
    }

    if (homeIds.length) {
      await trx('place').whereIn('id', homeIds).update({ description: null });
    }
    if (clearIds.length) {
      await trx('place').whereIn('id', clearIds).update({ description: null });
    }
    for (const place of slugRestores) {
      await trx('place').where('id', place.id).update({ description: place.slug });
    }

    // Record what this migration LEFT each backed-up row as, so down() can tell
    // an untouched row from one an administrator has written to since.
    await trx.raw(
      `update ${BACKUP_TABLE} b
         join place p on p.id = b.place_id
          set b.description_after = p.description`,
    );

    console.log(
      `place information: ${places.length} copied, ${homeIds.length} home descriptions `
      + `cleared, ${clearIds.length + slugRestores.length} administrative descriptions `
      + 'restored from seed evidence',
    );
    for (const place of unresolved) {
      console.log(
        `place ${place.id} (${place.type}): description contains HTML but no provable `
        + 'original exists - left unchanged for manual cleanup',
      );
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('place', 'information');

  // Archive Information written since up(). The pre-migration backup cannot
  // contain it, and dropping the column would destroy it silently.
  if (hasColumn) {
    if (!(await knex.schema.hasTable(ROLLBACK_ARCHIVE_TABLE))) {
      await knex.schema.createTable(ROLLBACK_ARCHIVE_TABLE, table => {
        table.increments('id').primary();
        table.integer('place_id').unsigned().notNullable().index();
        table.text('information').nullable();
        table.timestamp('archived_at').defaultTo(knex.fn.now());
      });
    }
    await knex.raw(
      `insert into ${ROLLBACK_ARCHIVE_TABLE} (place_id, information)
       select id, information from place
        where information is not null and information <> ''`,
    );
    console.log(
      `Archived post-migration information into ${ROLLBACK_ARCHIVE_TABLE} `
      + '(kept deliberately; drop it manually once you are satisfied)',
    );
  }

  if (await knex.schema.hasTable(BACKUP_TABLE)) {
    await knex.transaction(async trx => {
      // Restore ONLY the rows the snapshot represents. A row created after up(),
      // or one an administrator has written a description to since, is not in
      // the snapshot and must be left exactly as it is - the previous version of
      // this migration nulled every such row, destroying administrative text it
      // never backed up.
      // Restore ONLY rows still holding exactly what up() left them holding.
      // A row an administrator has written a description to since - including one
      // up() cleared to NULL - is newer than the snapshot and is left alone. The
      // NULL-safe operator <=> is required: `NULL = NULL` is NULL, not true, so a
      // plain comparison would skip every row up() cleared.
      const restored = await trx.raw(
        `update place p
           join ${BACKUP_TABLE} b on b.place_id = p.id
            set p.description = b.description
          where p.description <=> b.description_after`,
      );
      console.log(
        'Restored place.description for backed-up rows untouched since the migration '
        + `(${(restored as any)[0]?.changedRows ?? '?'} rows); rows written since were `
        + 'left as they are',
      );
    });
    await knex.schema.dropTable(BACKUP_TABLE);
  }

  if (hasColumn) {
    console.log('Dropping information column from place table');
    await knex.schema.alterTable('place', table => {
      table.dropColumn('information');
    });
  }
}
