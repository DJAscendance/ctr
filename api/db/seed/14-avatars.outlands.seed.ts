/* eslint-disable */
import { Knex } from 'knex';

import { OUTLANDS_AVATARS, directoryOf } from '../seed_data/outlands_avatars';

/**
 * The five Outlands team avatars.
 *
 * Outlands decides which side a member is on from the avatar they are wearing.
 * ne_game.wrl's set_team reads Browser.myAvatarURL and matches the file name,
 * and the historical entry page ne_game/enter3D.tmpl produced exactly these
 * five, one per choice on the "select an avatar to enter Outlands" screen.
 *
 * Without these rows nobody can wear one, so every member entering Outlands is
 * teamless and the world parks them under the map at y = -1000, which is where
 * a member with no team was always meant to wait.
 *
 * The values themselves live in ../seed_data/outlands_avatars, shared with
 * 20260911190000_sync_outlands_avatars, which puts the same five rows into a
 * database that was deployed before this seed existed. A deployment runs
 * migrations and not seeds, so both paths exist and they must not disagree.
 *
 * The directory of each row must stay equal to its id, which is the rule
 * 07-avatars.directory.seed established and which the assets under
 * spa/assets/avatars/12..16 were imported to match.
 */
export async function seed(knex: Knex): Promise<void> {
  const avatars = OUTLANDS_AVATARS;

  // One row of the five existing is not proof the other four do. A database that
  // lost some of them - or never got them, because an earlier run of this seed
  // stopped at the first one it found - has to end up with all five, so every
  // required row is decided on its own.
  const rows = await knex('avatar')
    .whereIn('id', avatars.map(a => a.id))
    .orWhereIn('filename', avatars.map(a => a.filename));

  const missing: typeof avatars = [];
  for (const avatar of avatars) {
    const atId = rows.find(row => Number(row.id) === avatar.id);
    const named = rows.find(row => row.filename === avatar.filename);
    // An id or a file name that belongs to some other avatar is not ours to take.
    // Stop, loudly, rather than overwrite or duplicate a row we do not own.
    if (atId && atId.filename !== avatar.filename) {
      throw new Error(`avatar id ${avatar.id} is already ${atId.filename}, not the Outlands `
        + `${avatar.filename}; move that avatar before seeding the Outlands avatars`);
    }
    if (named && Number(named.id) !== avatar.id) {
      throw new Error(`${avatar.filename} is already avatar id ${named.id}, not the Outlands `
        + `id ${avatar.id}; give that avatar another file name before seeding`);
    }
    if (!atId) missing.push(avatar);
  }

  if (!missing.length) {
    console.log('All five Outlands avatars already present, skipping');
    return;
  }

  console.log(`Creating ${missing.length} of the Outlands team avatars: `
    + missing.map(a => a.filename).join(', '));
  await knex('avatar').insert(missing.map(avatar => ({
    id: avatar.id,
    name: avatar.name,
    filename: avatar.filename,
    image: avatar.image,
    directory: directoryOf(avatar),
    status: 1,
    // System gameplay avatars, not citizen avatars. `private = 1` with no
    // owner is what keeps them out of the ordinary avatar library and out of
    // the persistent avatar-change path; the Outlands entrance reads them
    // through its own narrow route. The same value the synchronisation
    // migration writes -- a fresh install and a deployed one must not differ.
    private: 1,
  })));
}
