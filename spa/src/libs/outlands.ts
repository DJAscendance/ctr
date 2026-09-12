/*
 * The small amount of Outlands knowledge the SPA itself has to carry.
 *
 * Outlands decides a citizen's side from the avatar they wear: ne_game.wrl's
 * `battle` Script reads `Browser.myAvatarURL` in `set_team()` and matches the
 * file name against five historical names. So the SPA's job at the entrance is
 * to put one of those files on the citizen; everything after that - spawn,
 * weapons, ammunition, beam-out, respawn - belongs to the world's own Script
 * and is deliberately NOT reimplemented here.
 *
 * Nothing in this module renders, shoots, or talks to the socket. It is the
 * table the entrance screen reads and the rule the page-level code asks about,
 * so the Node test harness can drive it directly.
 */

/** The slug CTR serves Outlands under. */
export const OUTLANDS_SLUG = "outlands";

/** The team numbers ne_game.wrl uses. 3 is the Game Master and is not public. */
export const RED_TEAM = 1;
export const BLUE_TEAM = 2;

/*
 * The four public choices, in the historical grouping.
 *
 * The Game Master avatar (gm.wrl) is deliberately absent: it was never a
 * citizen choice, and the Game Master role is a deferred lane.
 */
export const OUTLANDS_TEAM_AVATARS = [
  { filename: "redm.wrl", team: RED_TEAM, teamName: "Red", label: "Red Team" },
  { filename: "redf.wrl", team: RED_TEAM, teamName: "Red", label: "Red Team" },
  { filename: "bluem.wrl", team: BLUE_TEAM, teamName: "Blue", label: "Blue Team" },
  { filename: "bluef.wrl", team: BLUE_TEAM, teamName: "Blue", label: "Blue Team" },
];

/**
 * The file name is the part of an avatar URL that ever carried the side, so
 * the same rule holds on any host and under any assets path. This is exactly
 * the rule ne_game.wrl's own `set_team` applies, and it is duplicated here
 * only so the entrance can label a choice before the world has loaded.
 */
export function outlandsTeamOfFile(filename: string): number {
  if (!filename) return 0;
  let name = String(filename);
  if (name.indexOf("?") > -1) name = name.split("?")[0];
  const parts = name.split("/");
  name = parts[parts.length - 1];
  const match = OUTLANDS_TEAM_AVATARS.find(entry => entry.filename === name);
  return match ? match.team : 0;
}

/** The side the avatar a member is wearing puts them on, or 0 for no side. */
export function outlandsTeamOfAvatar(avatar: any): number {
  return avatar && avatar.filename ? outlandsTeamOfFile(avatar.filename) : 0;
}

/** True when the place being loaded is Outlands. */
export function isOutlands(place: any): boolean {
  return !!place && place.slug === OUTLANDS_SLUG;
}

/**
 * True while the historical Outlands entrance stands in front of the world:
 * Outlands has been asked for and no side has been taken yet.
 *
 * The side is asked of the tab-local gameplay avatar, NEVER of the citizen's
 * own avatar. Taking a side does not change who the citizen is: their avatar
 * row, their `member.avatar_id` and their authentication token are all exactly
 * what they were, so there is nothing about the member to read here.
 *
 * The entrance replaces the ordinary place screen rather than sitting inside
 * it, so the normal place chrome asks this before drawing itself.
 */
export function outlandsEntranceActive(place: any, outlandsAvatar: any): boolean {
  return isOutlands(place) && !outlandsTeamOfAvatar(outlandsAvatar);
}

/*
 * The two compatibility translations Outlands needs, and nothing else.
 *
 * ne_game.wrl's `battle` Script asks the browser two questions about the local
 * citizen, and the answers CTR would give naturally are not the answers the
 * historical Script was written against. Both are answered here rather than by
 * editing the world: the .wrl files are recovered evidence and Beta's rule is
 * to shim the runtime, not to rewrite the content.
 */

/*
 * The five URLs `set_team()` matches on.
 *
 * The historical entry page produced exactly these absolute strings, and
 * set_team compares Browser.myAvatarURL against them one by one. CTR serves
 * the same avatar files from /assets/avatars/<id>/, so the real URL matches
 * none of them, `team` stays below zero, and the world sends the citizen back
 * out of the door.
 *
 * The alternative was to edit set_team to match on the file name, which is
 * what the migration line did. Beta does not edit historical worlds - the
 * blaxxun Script shim exists precisely so they can stay as they were shipped -
 * so the translation is made here, on the way out of the browser instead.
 */
const HISTORICAL_AVATAR_URL_BASE = "http://www.cybertown.com/places/ne_game/vrml/avatars/";

/**
 * The avatar URL a historical Outlands Script expects, or the real one.
 *
 * Only the four team files (and the Game Master's, which no citizen may pick)
 * are translated. A citizen who somehow reaches the world in ordinary clothes
 * keeps their real URL, matches no side, and the world does with them what it
 * always did.
 */
export function blaxxunAvatarURLFor(place: any, filename: string, realURL: string): string {
  if (!isOutlands(place)) return realURL;
  const parts = String(filename || "").split("/");
  const name = parts[parts.length - 1];
  if (!name) return realURL;
  if (!outlandsTeamOfFile(name) && name !== "gm.wrl") return realURL;
  return HISTORICAL_AVATAR_URL_BASE + name;
}

/*
 * The gameplay-name boundary.
 *
 * The Beamer is the one gameplay path that names its target in TEXT. `fire()`
 * sends `team + ray.hitPath[i].nickname` and every client asks
 * `name == Browser.myAvatarName`; that comparison lives inside ne_game.wrl and
 * is not ours to rewrite. So the text has to identify ONE citizen exactly.
 *
 * A username cannot: two tabs of one member are two citizens sharing one
 * username, and a shot at one of them would beam both. Beta's authoritative
 * identity is the presence key `memberId:presenceId`, and the page already
 * labels every rendered remote citizen with theirs. This is the matching half:
 * inside Outlands the citizen's own `Browser.myAvatarName` is their own key, so
 * the two sides of the historical comparison are the same kind of string and
 * only the presence that was actually hit matches.
 *
 * Outside Outlands nothing compares a nickname, and `myAvatarName` is read by
 * historical worlds that DISPLAY it - a home, the bank, the shops - so there it
 * stays the username.
 */
export function blaxxunAvatarNameFor(place: any, key: string, username: string): string {
  if (isOutlands(place) && key) return key;
  return username || "";
}
