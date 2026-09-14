# qa/outlands — the Beta Outlands free-play gates

Phase 3 gates: a real citizen can enter Outlands, pick a side, fight, be beamed
out, come back, and leave without taking anything with them.

Everything asserted about the game is read out of `ne_game.wrl`'s own `battle`
Script — team, weapon, ammunition, beam-out, respawn — rather than out of the
SPA, so a gate cannot pass on a CTR reimplementation of Outlands. The clients
only ever click the entrance, stand still and press keys.

These need a real GPU. `qa/lib/browser.js` (through `qa/phase2/lib/beta-client.js`)
reads `WEBGL_debug_renderer_info` out of a live page and refuses a browser that
fell back to software.

## Running

```shell
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
export CTR_QA_URL=http://127.0.0.1:8128
export CTR_QA_USER=testqa      CTR_QA_PASS=testqa
export CTR_QA_USER2=testqa2     CTR_QA_PASS2=testqa
export CTR_QA_USER_2D=testqa2d  CTR_QA_PASS_2D=testqa   # a member whose chatdefault is 0

DISPLAY=:1 node qa/outlands/tools/check-entrance.js
DISPLAY=:1 node qa/outlands/tools/check-system-avatars.js
DISPLAY=:1 node qa/outlands/tools/check-avatar-isolation.js
DISPLAY=:1 node qa/outlands/tools/check-freeplay.js
DISPLAY=:1 node qa/outlands/tools/check-lifecycle.js
DISPLAY=:1 node qa/outlands/tools/check-stale-place.js
CTR_TRANSITIONS=100 DISPLAY=:1 node qa/outlands/tools/check-memory.js
```

The stack needs the Outlands team avatars in the `avatar` table
(`api/db/seed/14-avatars.outlands.seed.ts`, or the
`20260911190000_sync_outlands_avatars` migration on a deployed database). They
are system rows: `private = 1` with no `member_id`, so no citizen can list one
or wear one as their main avatar, and the entrance reads them through
`GET /api/avatar/outlands` instead of the ordinary library. Nothing else is
seeded.
`CTR_QA_USER_2D` must be a member whose `chatdefault` is 0; that column, not
`is_3d`, is what puts a member in the 3D view.

## The gates

| Tool | What it proves |
|---|---|
| `check-entrance.js` | the historical entrance screen: all four choices end to end, the Game Master absent, a typed match password refused rather than dropped into free play, the world withheld until a side is worn, a 2D-default citizen carried into the 3D battle zone, and the ordinary avatar given back on the way out — across a page load |
| `check-system-avatars.js` | that the five Outlands avatars are system resources and nothing else: the ordinary avatar library returns none of them, the ordinary avatar picker shows none of them, all five ids are refused by the persistent avatar-change path even when it is called directly, an ordinary public avatar still works, and the citizen's permanent avatar is unchanged before, during and after a visit to Outlands |
| `check-avatar-isolation.js` | that a team avatar stays temporary gameplay state: the Outlands POST answers with validated gameplay data and no token, `localStorage["token"]` is byte-for-byte unchanged before, during and after a battle, no other durable key appears, a reload returns to the entrance, browser Back and BOTH navigation orders (with and without a `/member/session` refresh) land in the Plaza wearing the citizen's own avatar, and a second tab and a tab opened mid-battle are untouched |
| `check-freeplay.js` | the historical entrance, the four choices, red/blue mapping, the world's own spawn, W/D/A, the ammunition contract, Beamer, Repulsor, AAPD, ammo dispensers, beam-out, respawn and friendly fire — two authenticated citizens, on opposite sides |
| `check-lifecycle.js` | two presences of ONE member as two targets, room state, leaving, returning, rapid Plaza/Outlands navigation, and what the outgoing world gives back |
| `check-memory.js` | 100 entrance-to-battle-to-Plaza cycles: heap slope, one canvas, no retained citizen, no retained gameplay browser state, flat socket listeners |
| `check-stale-place.js` | that a navigation vue-router cancelled cannot write `appStore.data.place`: after a fast Plaza/Outlands pair and after seven rapid navigations, the store, the socket room, `Browser.myAvatarName` and `Browser.myAvatarURL` all still describe Outlands, the world's own avatar-swap line stays quiet, and a real Beamer hit still lands |

`lib/outlands-client.js` is the shared driver. Two rules it keeps:

- **Never write a gameplay field.** The one QA liberty is standing a citizen
  somewhere, and it is taken the way the world takes it — by binding a
  Viewpoint, which is what `set_viewpoint()` does.
- **Read the world, not the copy.** Spawns come out of `ne_game.wrl` at run
  time (`spawnPoints()`), so a gate cannot drift into restating its content.

## Two things that are easy to get wrong again

- **The entrance component stays mounted behind the running world.** The 2D
  pane is a `v-show`, so `.outlands-entrance` is still in the DOM after a side
  has been chosen. `entranceState().shown` therefore means *visible*
  (`offsetParent`), not merely present.
- **Leaving Outlands hands the ordinary avatar back**, so every return goes
  through the entrance again. A gate that navigates straight to
  `#/place/outlands` and waits for `ne_game.wrl` will time out on the entrance.
  That is the product working, not a fault.

## Not covered here

Scheduled matches, `ne_game_pass.wrl`, `boot.wrl`, the Game Master, the turret
cannons and the historical score service. All deferred.
