/* eslint-disable */
import { Knex } from 'knex';

/**
 * The five Outlands team avatars.
 *
 * Outlands decides which side a member is on from the avatar they are wearing.
 * ne_game.wrl's set_team reads Browser.myAvatarURL and matches the file name,
 * and the historical entry page ne_game/enter3D.tmpl produced exactly these
 * five, one per choice on the "select an avatar to enter Outlands" screen:
 *
 *   redm.wrl / redf.wrl    the Red Team
 *   bluem.wrl / bluef.wrl  the Blue Team
 *   gm.wrl                 the Game Master
 *
 * Without these rows nobody can wear one, so every member entering Outlands is
 * teamless and the world parks them under the map at y = -1000, which is where
 * a member with no team was always meant to wait.
 *
 * The directory of each row must stay equal to its id, which is the rule
 * 07-avatars.directory.seed established and which the assets under
 * spa/assets/avatars/12..16 were imported to match.
 */
export async function seed(knex: Knex): Promise<void> {
  const avatars = [
    { id: 12, name: 'Outlands Game Master', filename: 'gm.wrl', image: 'gm.jpg' },
    { id: 13, name: 'Outlands Blue Team (female)', filename: 'bluef.wrl', image: 'bluef.jpg' },
    { id: 14, name: 'Outlands Blue Team (male)', filename: 'bluem.wrl', image: 'bluem.jpg' },
    { id: 15, name: 'Outlands Red Team (female)', filename: 'redf.wrl', image: 'redf.jpg' },
    { id: 16, name: 'Outlands Red Team (male)', filename: 'redm.wrl', image: 'redm.jpg' },
  ];

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
    directory: String(avatar.id),
    status: 1,
    private: 0,
  })));
}
