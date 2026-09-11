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

  const existing = await knex('avatar').whereIn('filename', avatars.map(a => a.filename));
  if (existing.length) {
    console.log('Outlands avatars already present, skipping');
    return;
  }

  console.log('Creating the Outlands team avatars');
  await knex('avatar').insert(avatars.map(avatar => ({
    id: avatar.id,
    name: avatar.name,
    filename: avatar.filename,
    image: avatar.image,
    directory: String(avatar.id),
    status: 1,
    private: 0,
  })));
}
