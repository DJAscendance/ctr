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
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
export CTR_QA_URL=http://127.0.0.1:8128
export CTR_QA_USER=testqa      CTR_QA_PASS=testqa
export CTR_QA_USER2=outlandsqa2 CTR_QA_PASS2=testqa

DISPLAY=:1 node qa/outlands/tools/check-freeplay.js
DISPLAY=:1 node qa/outlands/tools/check-lifecycle.js
DISPLAY=:1 node qa/outlands/tools/check-stale-place.js
CTR_TRANSITIONS=100 DISPLAY=:1 node qa/outlands/tools/check-memory.js
```

Both accounts need the Outlands team avatars in the `avatar` table
(`api/db/seed/14-avatars.outlands.seed.ts`). Nothing else is seeded.

## The gates

| Tool | What it proves |
|---|---|
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
