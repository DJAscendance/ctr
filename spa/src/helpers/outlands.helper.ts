/**
 * OUTLANDS-2A - the free-play Outlands entrance contract.
 *
 * WHAT THIS SOLVES. Historically `place?plc=ne_game` did NOT return the game.
 * It returned an entrance page: a picture, the fiction, an instruction manual
 * and a four-avatar team picker. The 3D world only appeared after the picker
 * was submitted. CTR mounts a place world straight from the place row, so the
 * historical first step is missing entirely and `ne_game.wrl` starts with no
 * team avatar at all.
 *
 * THE EVIDENCE. Every value below comes from
 * `.reports/ivn-recovery/2026-09-03-outlands-entry-0/REPORT.md` and from the
 * shipped world itself. Nothing here is a guess.
 *
 *   the picker      the recovered entrance page `place_files/edit.html`, whose
 *                   four links are `javascript:setStyle(1..4)` beside
 *                   `edit_data/{redm,redf,bluem,bluef}.jpg`, in that order
 *   the team rule   `ne_game.wrl` `set_team()`, lines 1147-1162 of the
 *                   uncompressed source. The world reads its team from
 *                   `Browser.myAvatarURL` and from nowhere else, by EXACT
 *                   string equality against five absolute `www.cybertown.com`
 *                   addresses
 *   the fallback    the same function's last line. An avatar that matches none
 *                   of the five sends the player back to `place?plc=ne_game`
 *
 * THE IDENTITY RULE, AND WHY IT LOOKS WRONG.
 *
 *   The identity string is DATA, not an address. It is compared, never fetched.
 *
 * `set_team()` string-compares against `http://www.cybertown.com/...`, so the
 * provider must return exactly that - plain HTTP, the historical host, no query
 * string. Rewriting it to a CTR-relative HTTPS path would be the larger and
 * more dangerous change, because it would mean editing the historical world.
 * The avatar and world FILES still load from CTR's own `/assets/worlds/`; the
 * identity string and the asset address are deliberately two different values
 * and nothing in CTR ever requests the historical one.
 *
 * COLOUR IS THE TEAM. SEX IS COSMETIC. Red male and red female are both team 1;
 * blue male and blue female are both team 2. That is the world's own mapping,
 * not a simplification.
 *
 * `myAvatarName` IS THE NICKNAME, NOT THE AVATAR. `ne_game.wrl:930` matches a
 * beam-out against `Browser.myAvatarName`, and `:1444` uses it as the turret
 * lock owner, so it carries the player's CTR username. Returning the avatar
 * file name there would break beam-out and turret ownership.
 *
 * THIS MODULE IS PURE. No DOM, no X_ITE, no router, no globals. The session
 * factory is handed its host, so the whole contract is testable without a
 * browser. `libs/outlands-identity.ts` is the one place that binds the real
 * `X3D.bxx.setIdentityProvider` seam.
 *
 * OUTLANDS-2B ADDS SCHEDULED MATCH MODE below the free-play contract. It does
 * not change one line of it. The two paths differ in four values and in nothing
 * else: which world mounts, which socket session is joined, how the team is
 * decided, and whether the identity carries `?pass=`.
 *
 * OUT OF SCOPE, each its own later lane: the Game Master, `gm.wrl` and team 3
 * (OUTLANDS-2C), scoring (OUTLANDS-2D). `gm.wrl` is deliberately absent from the
 * table below, and `T_style=CKSM.` appears nowhere in this module.
 */

/** The CTR place slug, from `api/db/seed/02-places.seed.ts`. */
export const OUTLANDS_SLUG = "outlands";

/** The CTR route the entrance lives on. Not `/places/outlands`. */
export const OUTLANDS_ROUTE = "/place/outlands";

/**
 * The historical avatar address prefix `set_team()` compares against. Plain
 * HTTP and the dead production host, on purpose - see the header.
 */
export const OUTLANDS_IDENTITY_BASE =
  "http://www.cybertown.com/places/ne_game/vrml/avatars/";

/**
 * Where the recovered entrance art already lives inside CTR. All five images
 * are byte-identical to the recovered evidence, so this lane adds no asset.
 */
export const OUTLANDS_ART_BASE = "/assets/worlds/ne_game/html/";

/** The recovered entrance header picture, `edit_data/outlands.jpg`. */
export const OUTLANDS_HEADER_IMAGE = `${OUTLANDS_ART_BASE}outlands.jpg`;

/** One selectable free-play avatar. */
export interface OutlandsAvatar {
  /** The avatar file stem, and the key the entrance emits. */
  key: string;
  /** The historical `T_style` form value this tile submitted. */
  style: number;
  /** The team `set_team()` derives from this avatar. */
  team: number;
  /** Team colour, which is what actually chooses the team. */
  colour: string;
  /** Cosmetic only. */
  sex: string;
  /** What the resident reads on the tile. */
  label: string;
  /** The EXACT string the identity provider must return. Never fetched. */
  identityUrl: string;
  /** The recovered tile picture, served from CTR's own assets. */
  thumbnailUrl: string;
}

function avatar(
  key: string,
  style: number,
  team: number,
  colour: string,
  sex: string,
): OutlandsAvatar {
  return Object.freeze({
    key,
    style,
    team,
    colour,
    sex,
    label: `${colour} ${sex.toLowerCase()}`,
    identityUrl: `${OUTLANDS_IDENTITY_BASE}${key}.wrl`,
    thumbnailUrl: `${OUTLANDS_ART_BASE}${key}.jpg`,
  });
}

/**
 * The four free-play avatars, in the historical `T_style` order the recovered
 * entrance page lists them: red male, red female, blue male, blue female.
 */
export const OUTLANDS_AVATARS: readonly OutlandsAvatar[] = Object.freeze([
  avatar("redm", 1, 1, "Red", "Male"),
  avatar("redf", 2, 1, "Red", "Female"),
  avatar("bluem", 3, 2, "Blue", "Male"),
  avatar("bluef", 4, 2, "Blue", "Female"),
]);

/**
 * Every identity string this lane can produce. A second, independent gate: a
 * provider value that is not in this list is a defect, and the tests say so.
 */
export const OUTLANDS_IDENTITY_URLS: readonly string[] = Object.freeze(
  OUTLANDS_AVATARS.map(entry => entry.identityUrl),
);

/* ------------------------------------------------------------------------ *
 * OUTLANDS-2B - the scheduled match contract.
 *
 * THE EVIDENCE, all of it recovered and none of it inferred:
 *
 *   the box        `ne_game/enter.tmpl` line 65,
 *                  `<INPUT TYPE="textfield" NAME="T_pass" SIZE="10" VALUE="">`,
 *                  under the label reproduced in `OUTLANDS_MATCH_PROMPT`
 *   the collapse   the same file's `setStyle(v)`. With `T_pass` non-empty it
 *                  runs `if(v == 3){v = 1;} if(v == 4){v = 2;}` before
 *                  submitting, so `T_style` can only ever be 1 or 2 in a match.
 *                  The colour the member clicked is DISCARDED
 *   the mapping    `ne_game/enter3Dpass.tmpl`. `T_pass == PASS1` gives Blue and
 *                  `T_pass == PASS2` gives Red; `T_style` 1 gives male and 2
 *                  gives female. So the PASSWORD picks the colour and the TILE
 *                  picks the sex - the exact inverse of free play
 *   the identity   the same file, `vrmlmyavatar ...avatars/bluem.wrl?pass=<$T_pass>`
 *   the world      the same file, `3dscene .../vrml/ne_game_pass.wrl` for both
 *                  passwords, and `.../vrml/boot.wrl` for neither
 *   the zone       the same file, `sname Outlands Match 1`, against free play's
 *                  `sname Outlands` in `enter3D.tmpl`. Two blaxxun scenes on one
 *                  server: a match and free play never shared game state
 *   the team       `ne_game_pass.wrl` `set_team()`, which splits the identity on
 *                  `pass=` and compares the part BEFORE it against the same five
 *                  bare URLs. Red is team 1 and blue is team 2, as in free play
 * ------------------------------------------------------------------------ */

/** The team a scheduled-match password grants. Decided by the server, never here. */
export type OutlandsMatchTeam = "blue" | "red";

/** What the avatar tile chooses in a match: the sex, and only the sex. */
export type OutlandsSex = "male" | "female";

/** Which of the two Outlands paths a visit is on. */
export type OutlandsMode = "free" | "match";

/** The historical prompt beside the `T_pass` box, transcribed from `enter.tmpl`. */
export const OUTLANDS_MATCH_PROMPT =
  "If you have a scheduled match, enter your password here and select an avatar to enter";

/**
 * The ONE refusal a rejected scheduled match ever shows.
 *
 * Historically there was no message at all: a wrong password loaded `boot.wrl`,
 * whose whole body is a `loadURL` back to the entrance, so the player simply
 * found themselves where they started. This says that much and no more. It is a
 * local constant rather than the server's wording precisely so that no future
 * server message can leak "wrong team" or "close" into the UI by accident.
 */
export const OUTLANDS_MATCH_REFUSED =
  "That match password was not accepted. Leave the box empty to play free play.";

/** The free-play world, and the place row's own `world_filename`. */
export const OUTLANDS_FREE_WORLD_FILENAME = "vrml/ne_game.wrl";

/**
 * The scheduled-match world. A DIFFERENT world with its own team logic, its own
 * weapon gate and its own scoring. `ne_game.wrl` is never used for a match, and
 * is never taught to understand a match identity.
 */
export const OUTLANDS_MATCH_WORLD_FILENAME = "vrml/ne_game_pass.wrl";

/** The historical blaxxun scene name for free play. */
export const OUTLANDS_FREE_SCENE_NAME = "Outlands";

/** The historical blaxxun scene name for a scheduled match. */
export const OUTLANDS_MATCH_SCENE_NAME = "Outlands Match 1";

/**
 * The historical `T_style` a match tile submitted, after `setStyle()` collapsed
 * 3 to 1 and 4 to 2. Kept because it is the proof of the sex-only rule, and
 * because the tests compare against it.
 */
export const OUTLANDS_MATCH_STYLE: Readonly<Record<OutlandsSex, number>> =
  Object.freeze({ male: 1, female: 2 });

/**
 * The team number `ne_game_pass.wrl` resolves each colour to. Identical to free
 * play - the match world runs the same red-is-1, blue-is-2 comparison, just
 * after stripping the `?pass=` tail off the identity first.
 */
export const OUTLANDS_MATCH_TEAM_NUMBER: Readonly<Record<OutlandsMatchTeam, number>> =
  Object.freeze({ red: 1, blue: 2 });

/**
 * The avatar file stem a (team, sex) pair selects, exactly as the four
 * `vrmlmyavatar` branches of `enter3Dpass.tmpl` select it.
 */
export const OUTLANDS_MATCH_AVATAR_KEYS:
  Readonly<Record<OutlandsMatchTeam, Readonly<Record<OutlandsSex, string>>>> =
  Object.freeze({
    blue: Object.freeze({ male: "bluem", female: "bluef" }),
    red: Object.freeze({ male: "redm", female: "redf" }),
  });

/** Is this a team a scheduled-match password can grant? */
export function isOutlandsMatchTeam(value: unknown): value is OutlandsMatchTeam {
  return value === "blue" || value === "red";
}

/** Is this one of the two sexes a match tile can choose? */
export function isOutlandsSex(value: unknown): value is OutlandsSex {
  return value === "male" || value === "female";
}

/**
 * The avatar a match (team, sex) pair selects.
 * @param team the colour the server derived from the password
 * @param sex the sex the member's tile chose
 * @returns the avatar, or `null` if either input is not one of the two allowed
 */
export function findOutlandsMatchAvatar(
  team: unknown,
  sex: unknown,
): OutlandsAvatar | null {
  if (!isOutlandsMatchTeam(team) || !isOutlandsSex(sex)) { return null; }
  return findOutlandsAvatar(OUTLANDS_MATCH_AVATAR_KEYS[team][sex]);
}

/**
 * The exact identity string a scheduled match registers.
 *
 * THE QUERY IS NOT DECORATION AND IT IS NOT ENCODED. `enter3Dpass.tmpl`
 * substitutes `<$T_pass>` raw, and `ne_game_pass.wrl` reads the password back
 * with `avatar.substring(avatar.lastIndexOf('pass=') + 5)` - everything after
 * the marker, to the end of the string, byte for byte. Percent-encoding it here
 * would hand the world a different password than the member typed.
 *
 * The free-play identity must never gain this query: `ne_game.wrl` compares the
 * WHOLE string, so a `?pass=` tail would resolve no team there at all.
 * @param team the colour the server derived from the password
 * @param sex the sex the member's tile chose
 * @param password the password the member typed, already validated by the server
 * @returns the identity string, or `null` when the inputs are not usable
 */
export function buildOutlandsMatchIdentityUrl(
  team: unknown,
  sex: unknown,
  password: unknown,
): string | null {
  const avatar = findOutlandsMatchAvatar(team, sex);
  if (avatar === null) { return null; }
  if (typeof password !== "string" || password === "") { return null; }
  return `${avatar.identityUrl}?pass=${password}`;
}

/**
 * The socket session free play joins: the place id, unchanged. Every other CTR
 * place already joins its place id, and free-play Outlands keeps doing so, so
 * OUTLANDS-2A's behaviour is byte-for-byte what it was.
 * @param placeId the CTR place id
 */
export function outlandsFreeSessionKey(placeId: number | string): string | number {
  return placeId;
}

/**
 * The socket session a scheduled match joins - the modern "Outlands Match 1".
 *
 * A place id is always a positive integer, so this string can never collide with
 * any place's own room. That is the whole isolation mechanism: CTR's socket
 * server rooms every relay - `AV`, `SE`, `SO` and `CHAT` - on the joining
 * client's room string, so two different strings are two separate zones over the
 * one existing transport. No second transport is introduced.
 * @param placeId the CTR place id
 */
export function outlandsMatchSessionKey(placeId: number | string): string {
  return `${placeId}:outlands-match-1`;
}

/** The shape the place row has to have for the entrance to apply. */
export interface OutlandsPlaceLike {
  slug?: string | null;
}

/**
 * Is this place the Outlands? Slug equality and nothing else, so every other
 * CTR place keeps its present load sequence untouched.
 */
export function isOutlandsPlace(place: OutlandsPlaceLike | null | undefined): boolean {
  if (place === null || place === undefined) { return false; }
  return place.slug === OUTLANDS_SLUG;
}

/**
 * The avatar a picker key names, or `null`. A linear scan over a frozen array,
 * so a forged key such as `constructor` or `__proto__` finds nothing.
 */
export function findOutlandsAvatar(key: unknown): OutlandsAvatar | null {
  const wanted = key === null || key === undefined ? "" : String(key);
  if (wanted === "") { return null; }
  for (let i = 0; i < OUTLANDS_AVATARS.length; i += 1) {
    if (OUTLANDS_AVATARS[i].key === wanted) { return OUTLANDS_AVATARS[i]; }
  }
  return null;
}

/** What `bxx_identity.js` hands to `Browser.myAvatarURL` / `myAvatarName`. */
export interface OutlandsIdentity {
  avatarURL: string;
  avatarName: string;
}

/*
 * The base `no-unused-vars` rule is on for this project, and it reads the
 * parameter name of a type signature as a real binding. There is nothing to use
 * in a declaration, so the names below are reported whatever they are called.
 * The rule is turned off for the two declarations only - the same treatment
 * `shared-event.helper.ts` already gives `SharedEventCodec`.
 */
/* eslint-disable no-unused-vars */

/** The `X3D.bxx` surface this module needs. `bxx_identity.js` provides it. */
export interface OutlandsIdentityHost {
  bxx?: {
    setIdentityProvider?: (provider: (() => OutlandsIdentity) | null) => void;
  } | null;
}

/** What one validated scheduled-match entry resolved to. */
export interface OutlandsMatchSelection {
  /** The avatar the (team, sex) pair selected. */
  avatar: OutlandsAvatar;
  /** The colour the server derived from the password. */
  team: OutlandsMatchTeam;
  /** The number `ne_game_pass.wrl` resolves that colour to: red 1, blue 2. */
  teamNumber: number;
  /** The sex the member's tile chose. */
  sex: OutlandsSex;
  /** The registered identity, `?pass=` and all. */
  identityUrl: string;
}

/** The selection, and the registration of it, for one Outlands visit. */
export interface OutlandsIdentitySession {
  /** Register a free-play avatar. Returns the avatar, or `null` for an unknown key. */
  select(key: unknown, avatarName?: unknown): OutlandsAvatar | null;
  /**
   * Register a scheduled-match avatar. The team MUST be the one the server
   * returned; this never derives a team from a password itself. Returns `null`
   * for an unusable team, sex or password, and registers nothing in that case.
   */
  selectMatch(
    team: unknown,
    sex: unknown,
    password: unknown,
    avatarName?: unknown,
  ): OutlandsMatchSelection | null;
  /** The avatar in force, or `null` when the entrance has not been used. */
  selected(): OutlandsAvatar | null;
  /** The match in force, or `null` when this is free play or nothing. */
  matchSelection(): OutlandsMatchSelection | null;
  /** Which path this visit is on, or `null` before a selection. */
  mode(): OutlandsMode | null;
  /** Exactly what the provider would return now, or `null`. */
  identity(): OutlandsIdentity | null;
  /** Forget the selection, drop the password and unregister the provider. */
  release(): void;
}
/* eslint-enable no-unused-vars */

/**
 * Build a session over an X_ITE-like host.
 *
 * `getHost` is a getter rather than the host itself because `window.X3D` is
 * created by `bxx_identity.js` inside `App.vue`'s `created()`, which can run
 * after this module is imported. Resolving late means the seam is always the
 * real one.
 *
 * REGISTRATION ORDER. `select()` registers the provider SYNCHRONOUSLY and
 * before it returns, and the caller mounts the world only after it returns an
 * avatar. So `ne_game.wrl` can never observe the empty default identity during
 * a successful entry, and its no-team branch never fires.
 *
 * CLEANUP. `release()` unregisters, which puts `Browser.myAvatarURL` back to
 * the pre-OUTLANDS-2 empty string. An Outlands avatar is never left in force
 * for an unrelated world, and a scheduled match's password is dropped with it.
 *
 * ONE SELECTION AT A TIME. `select()` and `selectMatch()` each clear the other,
 * so a free-play avatar and a match avatar can never both be in force. That is
 * what stops a stale `?pass=` tail reaching `ne_game.wrl`, whose `set_team()`
 * compares the whole string and would resolve no team at all.
 */
export function createOutlandsIdentitySession(
  getHost: () => OutlandsIdentityHost | null | undefined,
): OutlandsIdentitySession {
  let current: OutlandsAvatar | null = null;
  let nickname = "";
  /*
   * OUTLANDS-2B. The whole match state, and the only place the typed password
   * lives once the entrance form is cleared. It is a closure variable, so it is
   * never a component field, never reactive, never serialised into a Vue devtools
   * snapshot and never written to any browser storage. `release()` drops it.
   */
  let match: OutlandsMatchSelection | null = null;

  function currentUrl(): string {
    if (match !== null) { return match.identityUrl; }
    return current === null ? "" : current.identityUrl;
  }

  function identity(): OutlandsIdentity | null {
    if (current === null) { return null; }
    return { avatarURL: currentUrl(), avatarName: nickname };
  }

  function register(provider: (() => OutlandsIdentity) | null): void {
    const host = getHost();
    if (!host || !host.bxx || typeof host.bxx.setIdentityProvider !== "function") { return; }
    host.bxx.setIdentityProvider(provider);
  }

  function setNickname(avatarName: unknown): void {
    nickname = avatarName === null || avatarName === undefined ? "" : String(avatarName);
  }

  return {
    select(key: unknown, avatarName?: unknown): OutlandsAvatar | null {
      const found = findOutlandsAvatar(key);
      if (found === null) { return null; }
      current = found;
      match = null;
      setNickname(avatarName);
      register(() => ({ avatarURL: found.identityUrl, avatarName: nickname }));
      return found;
    },
    selectMatch(
      team: unknown,
      sex: unknown,
      password: unknown,
      avatarName?: unknown,
    ): OutlandsMatchSelection | null {
      const avatar = findOutlandsMatchAvatar(team, sex);
      const identityUrl = buildOutlandsMatchIdentityUrl(team, sex, password);
      if (avatar === null || identityUrl === null) { return null; }
      const selection: OutlandsMatchSelection = {
        avatar,
        team: team as OutlandsMatchTeam,
        teamNumber: OUTLANDS_MATCH_TEAM_NUMBER[team as OutlandsMatchTeam],
        sex: sex as OutlandsSex,
        identityUrl,
      };
      current = avatar;
      match = selection;
      setNickname(avatarName);
      register(() => ({ avatarURL: selection.identityUrl, avatarName: nickname }));
      return selection;
    },
    selected(): OutlandsAvatar | null {
      return current;
    },
    matchSelection(): OutlandsMatchSelection | null {
      return match;
    },
    mode(): OutlandsMode | null {
      if (current === null) { return null; }
      return match === null ? "free" : "match";
    },
    identity,
    release(): void {
      if (current === null) { return; }
      current = null;
      match = null;
      nickname = "";
      register(null);
    },
  };
}
