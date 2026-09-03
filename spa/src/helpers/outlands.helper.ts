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
 * OUT OF SCOPE, each its own later lane: match mode and `T_pass` (OUTLANDS-2B),
 * the Game Master, `gm.wrl` and team 3 (OUTLANDS-2C), scoring (OUTLANDS-2D).
 * `gm.wrl` is deliberately absent from the table below.
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

/** The selection, and the registration of it, for one Outlands visit. */
export interface OutlandsIdentitySession {
  /** Register an avatar. Returns the avatar, or `null` for an unknown key. */
  select(key: unknown, avatarName?: unknown): OutlandsAvatar | null;
  /** The avatar in force, or `null` when the entrance has not been used. */
  selected(): OutlandsAvatar | null;
  /** Exactly what the provider would return now, or `null`. */
  identity(): OutlandsIdentity | null;
  /** Forget the selection and unregister the provider. */
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
 * for an unrelated world.
 */
export function createOutlandsIdentitySession(
  getHost: () => OutlandsIdentityHost | null | undefined,
): OutlandsIdentitySession {
  let current: OutlandsAvatar | null = null;
  let nickname = "";

  function identity(): OutlandsIdentity | null {
    if (current === null) { return null; }
    return { avatarURL: current.identityUrl, avatarName: nickname };
  }

  function register(provider: (() => OutlandsIdentity) | null): void {
    const host = getHost();
    if (!host || !host.bxx || typeof host.bxx.setIdentityProvider !== "function") { return; }
    host.bxx.setIdentityProvider(provider);
  }

  return {
    select(key: unknown, avatarName?: unknown): OutlandsAvatar | null {
      const found = findOutlandsAvatar(key);
      if (found === null) { return null; }
      current = found;
      nickname = avatarName === null || avatarName === undefined ? "" : String(avatarName);
      register(() => ({ avatarURL: found.identityUrl, avatarName: nickname }));
      return found;
    },
    selected(): OutlandsAvatar | null {
      return current;
    },
    identity,
    release(): void {
      if (current === null) { return; }
      current = null;
      nickname = "";
      register(null);
    },
  };
}
