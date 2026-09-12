/**
 * What the API has to know about Outlands, and nothing else.
 *
 * The five Outlands avatar ROWS are canonically written down once, in
 * `db/seed_data/outlands_avatars.ts`, which the seed and the synchronisation
 * migration both read. The API cannot import that module: `tsconfig.prod.json`
 * pins `rootDir` to `src`, so a production build rejects any source file
 * reaching outside it. What lives here instead is the one thing that file does
 * not carry and the runtime does need -- which of the five are playable, and
 * which side each one puts a citizen on.
 *
 * That leaves the file names written in two places, so
 * `outlands.spec.ts` reads the canonical rows off disk and fails if the two
 * ever disagree. Drift is caught by a test, not left to be noticed.
 *
 * The team numbers are ne_game.wrl's own, read by its `battle` Script in
 * `set_team()`. They are historical gameplay and are not ours to renumber.
 */

/** The side ne_game.wrl puts a citizen on. */
export const OUTLANDS_RED_TEAM = 1;
export const OUTLANDS_BLUE_TEAM = 2;
/** The Game Master's side. Never a citizen choice. */
export const OUTLANDS_GAME_MASTER_TEAM = 3;

/** The Game Master avatar. It is a system avatar like the other four, and it is not playable. */
export const OUTLANDS_GAME_MASTER_FILENAME = 'gm.wrl';

export interface OutlandsTeamAvatar {
  filename: string;
  team: number;
}

/**
 * What the Outlands runtime is told about a team avatar, and nothing else.
 *
 * The entrance needs the id to ask for a side and the world needs the path to
 * build the avatar URL `ne_game.wrl` reads. Everything else on the row --
 * `member_id`, `private`, `status`, `gestures` -- is system bookkeeping a
 * citizen has no use for, so it does not leave the API.
 */
export interface OutlandsTeamAvatarView {
  id: number;
  filename: string;
  directory: string;
  team: number;
}

/**
 * The four playable choices, in the historical order of the entrance screen:
 * the Red pair, then the Blue pair.
 */
export const OUTLANDS_TEAM_AVATARS: OutlandsTeamAvatar[] = [
  { filename: 'redm.wrl', team: OUTLANDS_RED_TEAM },
  { filename: 'redf.wrl', team: OUTLANDS_RED_TEAM },
  { filename: 'bluem.wrl', team: OUTLANDS_BLUE_TEAM },
  { filename: 'bluef.wrl', team: OUTLANDS_BLUE_TEAM },
];

/** Every Outlands system avatar file name, the Game Master included. */
export const OUTLANDS_SYSTEM_FILENAMES: string[] = [
  ...OUTLANDS_TEAM_AVATARS.map(avatar => avatar.filename),
  OUTLANDS_GAME_MASTER_FILENAME,
];

/** The side a file name puts a citizen on, or 0 when it is not an Outlands avatar. */
export function outlandsTeamOfFilename(filename: string): number {
  if (!filename) return 0;
  if (filename === OUTLANDS_GAME_MASTER_FILENAME) return OUTLANDS_GAME_MASTER_TEAM;
  const match = OUTLANDS_TEAM_AVATARS.find(avatar => avatar.filename === filename);
  return match ? match.team : 0;
}

/** True for a file name that is one of the four playable team avatars. */
export function isOutlandsTeamAvatar(filename: string): boolean {
  return OUTLANDS_TEAM_AVATARS.some(avatar => avatar.filename === filename);
}
