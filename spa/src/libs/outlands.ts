/*
 * TEMPORARY Outlands compatibility - X_ITE 16.2.0 migration only.
 *
 * Outlands owns its own spawn. ne_game.wrl's `battle` Script runs `set_team`
 * three seconds after the world starts, reads the avatar the member wears,
 * and calls `set_viewpoint()`, which moves `battle_view` to one of the four
 * positions its side was given. Until then the member waits at the historical
 * parking spot, `battle_view`'s authored `position 0 -1000 0`.
 *
 * That battle Script is not yet whole on X_ITE 16, so the member never leaves
 * the parking spot. This module carries the small amount of Outlands knowledge
 * the SPA needs to put a member at world level in the meantime:
 *
 *   - which side each of the four public team avatars belongs to;
 *   - the spawn positions and orientations that side already has in the world.
 *
 * Full spawn ownership stays with the battle Script and returns to it in the
 * dedicated Outlands restoration lane. Nothing here is a new coordinate: every
 * value below is copied from the `blue_view_pos` / `blue_view_or` /
 * `red_view_pos` / `red_view_or` fields of `DEF battle Script` in
 * spa/assets/worlds/ne_game/vrml/ne_game.wrl, and the bridge prefers the
 * values it can read back out of the loaded scene over this copy.
 */

/** The slug CTR serves Outlands under. */
export const OUTLANDS_SLUG = "outlands";

/** The team numbers ne_game.wrl uses. 3 is the Game Master and is not public. */
export const RED_TEAM = 1;
export const BLUE_TEAM = 2;

/*
 * The four public choices. The Game Master avatar (gm.wrl) is deliberately
 * absent: it is not a citizen choice and its behaviour belongs to the Outlands
 * restoration lane.
 */
export const OUTLANDS_TEAM_AVATARS = [
  { filename: "redm.wrl", team: RED_TEAM, teamName: "Red", label: "Red Team" },
  { filename: "redf.wrl", team: RED_TEAM, teamName: "Red", label: "Red Team" },
  { filename: "bluem.wrl", team: BLUE_TEAM, teamName: "Blue", label: "Blue Team" },
  { filename: "bluef.wrl", team: BLUE_TEAM, teamName: "Blue", label: "Blue Team" },
];

/*
 * The historical team spawns, copied from ne_game.wrl. `set_viewpoint` picks
 * one of the four at random, which is what the bridge does too.
 */
export const OUTLANDS_SPAWNS = {
  [RED_TEAM]: {
    position: [
      [40.2314, 6.08083, -369.455],
      [-36.8458, 2.7511, -429.445],
      [-0.455572, 2.7511, -377.801],
      [112.526, 1.7501, -328.931],
    ],
    orientation: [
      [0, 1, 0, 2.74937],
      [0, -1, 0, 2.65935],
      [0, -1, 0, 3.01984],
      [0, 1, 0, 1.57286],
    ],
  },
  [BLUE_TEAM]: {
    position: [
      [1.99494, 2.7511, 372.081],
      [-43.3561, 6.08698, 374.37],
      [32.6801, 2.7511, 403.772],
      [116.877, 1.75036, 405.714],
    ],
    orientation: [
      [0, 1, 0, 0.169662],
      [0, -1, 0, 1.04376],
      [0, 1, 0, 0.598793],
      [0, 1, 0, 1.42757],
    ],
  },
};

/**
 * The file name is the part of an avatar URL that ever carried the side, so
 * the same rule holds on any host and under any assets path. This is the rule
 * ne_game.wrl's own set_team uses.
 */
export function outlandsTeamOfFile(filename: string): number {
  if (!filename) return 0;
  let name = String(filename);
  if (name.indexOf("?") > -1) name = name.split("?")[0];
  name = name.split("/").pop();
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
 * Outlands has been asked for and the member is not wearing a side yet.
 *
 * The entrance replaces the ordinary place screen rather than sitting inside
 * it, so the normal place chrome asks this before drawing itself.
 */
export function outlandsEntranceActive(place: any, user: any): boolean {
  return isOutlands(place) && !outlandsTeamOfAvatar(user && user.avatar);
}
