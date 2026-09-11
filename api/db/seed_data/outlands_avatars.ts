/**
 * The five Outlands team avatars, as one definition.
 *
 * Outlands decides which side a member is on from the avatar they wear:
 * ne_game.wrl's `set_team` reads `Browser.myAvatarURL` and matches the file
 * name. The historical entry page produced exactly these five, one per choice
 * on the "select an avatar to enter Outlands" screen:
 *
 *   redm.wrl / redf.wrl    the Red Team
 *   bluem.wrl / bluef.wrl  the Blue Team
 *   gm.wrl                 the Game Master, never a public choice
 *
 * Two callers need these values and must not disagree about them: the seed,
 * which fills a fresh install, and the synchronisation migration, which fills
 * a database that was deployed before the seed existed. This module is the one
 * place they are written down. It is plain data with no knex and no imports, so
 * a migration may require it without pulling in the API's DI container.
 *
 * `directory` is not stored here because it is not independent: the rule
 * 07-avatars.directory.seed established, and which the imported assets under
 * spa/assets/avatars/12..16 were laid out to match, is that a stock avatar's
 * directory is its id.
 */
export interface OutlandsAvatar {
  id: number;
  name: string;
  filename: string;
  image: string;
}

/** The five rows a correctly seeded stack carries. */
export const OUTLANDS_AVATARS: OutlandsAvatar[] = [
  { id: 12, name: 'Outlands Game Master', filename: 'gm.wrl', image: 'gm.jpg' },
  { id: 13, name: 'Outlands Blue Team (female)', filename: 'bluef.wrl', image: 'bluef.jpg' },
  { id: 14, name: 'Outlands Blue Team (male)', filename: 'bluem.wrl', image: 'bluem.jpg' },
  { id: 15, name: 'Outlands Red Team (female)', filename: 'redf.wrl', image: 'redf.jpg' },
  { id: 16, name: 'Outlands Red Team (male)', filename: 'redm.wrl', image: 'redm.jpg' },
];

/** The directory a stock avatar row must carry: its own id, as a string. */
export function directoryOf(avatar: OutlandsAvatar): string {
  return String(avatar.id);
}
