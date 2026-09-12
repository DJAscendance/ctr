import fs from 'fs';
import path from 'path';

import { OUTLANDS_AVATARS } from '../../db/seed_data/outlands_avatars';

import {
  OUTLANDS_BLUE_TEAM,
  OUTLANDS_GAME_MASTER_FILENAME,
  OUTLANDS_GAME_MASTER_TEAM,
  OUTLANDS_RED_TEAM,
  OUTLANDS_SYSTEM_FILENAMES,
  OUTLANDS_TEAM_AVATARS,
  isOutlandsTeamAvatar,
  outlandsTeamOfFilename,
} from './outlands';

/*
 * The rows live in `db/seed_data/outlands_avatars`, which the API cannot import:
 * `tsconfig.prod.json` pins `rootDir` to `src`. So the file names are written
 * down twice, and this is what stops them drifting. The canonical module is
 * read off disk rather than imported, for the same reason.
 */
const CANONICAL = fs.readFileSync(
  path.resolve(__dirname, '../../db/seed_data/outlands_avatars.ts'), 'utf8',
);

describe('outlands system avatars', () => {
  it('names the same five files the canonical rows do', () => {
    const canonical = Array.from(CANONICAL.matchAll(/filename: '([^']+)'/g))
      .map(match => match[1])
      .sort();
    expect(canonical).toEqual([...OUTLANDS_SYSTEM_FILENAMES].sort());
  });

  it('offers four playable avatars and never the Game Master', () => {
    expect(OUTLANDS_TEAM_AVATARS).toHaveLength(4);
    expect(OUTLANDS_TEAM_AVATARS.map(avatar => avatar.filename))
      .not.toContain(OUTLANDS_GAME_MASTER_FILENAME);
    expect(isOutlandsTeamAvatar(OUTLANDS_GAME_MASTER_FILENAME)).toBe(false);
    expect(OUTLANDS_SYSTEM_FILENAMES).toContain(OUTLANDS_GAME_MASTER_FILENAME);
  });

  it('keeps the historical team of every avatar', () => {
    expect(outlandsTeamOfFilename('redm.wrl')).toBe(OUTLANDS_RED_TEAM);
    expect(outlandsTeamOfFilename('redf.wrl')).toBe(OUTLANDS_RED_TEAM);
    expect(outlandsTeamOfFilename('bluem.wrl')).toBe(OUTLANDS_BLUE_TEAM);
    expect(outlandsTeamOfFilename('bluef.wrl')).toBe(OUTLANDS_BLUE_TEAM);
    expect(outlandsTeamOfFilename('gm.wrl')).toBe(OUTLANDS_GAME_MASTER_TEAM);
    expect(OUTLANDS_RED_TEAM).toBe(1);
    expect(OUTLANDS_BLUE_TEAM).toBe(2);
    expect(OUTLANDS_GAME_MASTER_TEAM).toBe(3);
  });

  it('gives an ordinary avatar no side at all', () => {
    expect(outlandsTeamOfFilename('default.wrl')).toBe(0);
    expect(outlandsTeamOfFilename('')).toBe(0);
    expect(isOutlandsTeamAvatar('default.wrl')).toBe(false);
  });

  it('agrees with the canonical rows about which ids the five are', () => {
    // Belt and braces: the ids only live in the canonical module, and this
    // fails loudly if that module ever stops carrying all five.
    expect(OUTLANDS_AVATARS.map(avatar => avatar.filename).sort())
      .toEqual([...OUTLANDS_SYSTEM_FILENAMES].sort());
  });
});
