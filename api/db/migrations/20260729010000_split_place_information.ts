import { Knex } from 'knex';

import { sanitizeUserHtml } from '../../src/libs';

/**
 * Splits public Information away from the administrative Description.
 *
 * THE PROBLEM. `place.description` had three writers with three different
 * meanings: the Admin Panel wrote it as an administrative summary, the MANAGE
 * Information editor wrote manager-authored HTML into it, and a citizen's Home
 * Information editor wrote free text into it. Whoever saved last won, which is
 * why the Admin Panel's Description column shows `<h3>Welcome to the Mall</h3>`.
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
 * SANITIZING. The value is passed through the SHARED sanitizer
 * (`libs/sanitize-user-html`) on the way across - the same allowlist Place
 * Information, Messageboard and Inbox already use. That logic is imported, not
 * reimplemented. It matters most for homes: a home's description was stored
 * verbatim and escaped at render time, so this is the one moment those 71 rows
 * are brought under the allowlist before anything renders them as HTML.
 * Re-sanitizing an already-sanitized place value is a no-op.
 *
 * REVERSIBILITY. Every row's original `description` is copied into
 * `place_information_migration_backup` BEFORE anything is modified, and `down()`
 * restores from it verbatim. The backup table is what makes clearing a value
 * safe; without it this migration would be one-way.
 *
 * WHAT IS CLEARED, AND WHY THE TWO CASES DIFFER.
 *
 *   - HOMES: `description` was ONLY ever the citizen's Information. There is no
 *     administrative meaning to preserve, so after the value is safely in
 *     `information` (verified row-by-row) the old column is cleared.
 *
 *   - EVERY OTHER TYPE: `description` is left ALONE. It is presumed to be the
 *     administrator's own text, and this migration does not get to guess.
 *     The single exception is a row whose description is provably not
 *     administrator-authored - see RECONCILIATION.
 *
 * RECONCILIATION. Four rows currently hold manager-authored HTML in
 * `description` (Mall, Employment, The Shadows, Dark Paradise). For those, and
 * ONLY those, the original administrative description is recoverable from
 * repository evidence, so it is restored:
 *
 *   - public places are seeded with `description` equal to their slug
 *     (api/db/seed/02-places.seed.ts), so `mall` -> 'mall';
 *   - hoods and blocks are never seeded with a description at all
 *     (03/04-places.*.seed.ts set none), and 91 of 92 hoods and 679 of 681
 *     blocks are NULL, so the original was empty -> NULL.
 *
 * A row whose description contains HTML but does NOT match one of those provable
 * shapes is left exactly as found and reported for manual cleanup. Nothing is
 * synthesized.
 */

const BACKUP_TABLE = 'place_information_migration_backup';

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

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('place', 'information'))) {
    console.log('Adding information column to place table');
    await knex.schema.alterTable('place', table => {
      table.text('information').nullable();
    });
  }

  // The backup is taken FIRST and covers every row that has a description at
  // all, not just the ones this migration ends up changing, so `down()` can
  // restore the table to its exact prior state regardless of what happened in
  // between.
  if (!(await knex.schema.hasTable(BACKUP_TABLE))) {
    console.log(`Creating ${BACKUP_TABLE}`);
    await knex.schema.createTable(BACKUP_TABLE, table => {
      table.integer('place_id').unsigned().primary();
      table.text('description').nullable();
    });
    await knex.raw(
      `insert into ${BACKUP_TABLE} (place_id, description)
       select id, description from place where description is not null`,
    );
  }

  const places: PlaceRow[] = await knex('place')
    .select('id', 'type', 'slug', 'description')
    .whereIn('type', INFORMATION_TYPES)
    .whereNotNull('description')
    .andWhere('description', '<>', '');

  const unresolved: PlaceRow[] = [];
  let copied = 0;
  let clearedHomes = 0;
  let restored = 0;

  for (const place of places) {
    const clean = sanitizeUserHtml(place.description || '');
    await knex('place').where('id', place.id).update({ information: clean });

    // Read back before clearing anything. "Verified" has to mean the value is
    // actually in the new column, not that the UPDATE returned without throwing.
    const [stored] = await knex('place').select('information').where('id', place.id);
    if (!stored || stored.information !== clean) {
      throw new Error(
        `place ${place.id}: information did not persist; aborting without clearing description`,
      );
    }
    copied += 1;

    if (place.type === 'home') {
      // A home's description was only ever its Information. Safe to clear now
      // that the value is verified in place, and restorable from the backup.
      await knex('place').where('id', place.id).update({ description: null });
      clearedHomes += 1;
      continue;
    }

    if (!HTML_PATTERN.test(place.description || '')) {
      // Plain text in a non-home description: presumed administrative. Untouched.
      continue;
    }

    // Manager-authored HTML sitting in an administrative field. Restore the
    // original ONLY where repository evidence proves what it was.
    if (place.type === 'hood' || place.type === 'block') {
      await knex('place').where('id', place.id).update({ description: null });
      restored += 1;
    } else if (place.type === 'public' && place.slug) {
      await knex('place').where('id', place.id).update({ description: place.slug });
      restored += 1;
    } else {
      unresolved.push(place);
    }
  }

  console.log(
    `place information: ${copied} copied, ${clearedHomes} home descriptions cleared, `
    + `${restored} administrative descriptions restored from seed evidence`,
  );
  for (const place of unresolved) {
    console.log(
      `place ${place.id} (${place.type}): description contains HTML but no provable `
      + 'original exists - left unchanged for manual cleanup',
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(BACKUP_TABLE)) {
    console.log('Restoring place.description from backup');
    // Restore verbatim, including rows this migration cleared. Rows that had no
    // description before are set back to NULL by the second statement.
    await knex.raw(
      `update place p
         join ${BACKUP_TABLE} b on b.place_id = p.id
          set p.description = b.description`,
    );
    await knex.raw(
      `update place p
          set p.description = null
        where p.id not in (select place_id from ${BACKUP_TABLE})`,
    );
    await knex.schema.dropTable(BACKUP_TABLE);
  }

  if (await knex.schema.hasColumn('place', 'information')) {
    console.log('Dropping information column from place table');
    await knex.schema.alterTable('place', table => {
      table.dropColumn('information');
    });
  }
}
