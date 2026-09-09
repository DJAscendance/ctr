# qa/phase2 — the Beta X_ITE 16.2.0 gates

Beta-native browser gates for the 4.7.0 → 16.2.0 migration. They assert against
the **rendered X_ITE scene**, not against wire traffic: Phase 1 already proved
the wire, and the point of Phase 2 is that the engine underneath it changed.

Everything here needs a real GPU. `qa/lib/browser.js` reads
`WEBGL_debug_renderer_info` out of a live page and refuses a browser that fell
back to software; a gate that cannot reach the GPU stops rather than reporting
numbers about a CPU.

## Running

Playwright will not run on Node 14, and the SPA will not build on anything
else, so the two live side by side:

```shell
# build the candidate (Node 14.21.3)
cd spa && npm run build

# run a gate (Node 20 + the globally installed playwright)
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export NODE_PATH="$HOME/.npm-global/lib/node_modules/@playwright/cli/node_modules"
export CTR_QA_URL=http://127.0.0.1:8128 CTR_QA_USER=testqa CTR_QA_PASS=testqa
DISPLAY=:1 node qa/phase2/tools/check-two-client.js
```

`server.js` reads `dist/index.html` once at boot, so restart it after a build
or the page will ask for the previous bundle.

## The gates

| Tool | What it proves |
|---|---|
| `check-runtime.js` | the live browser reports X_ITE 16.2.0, every patch installed, the GPU is real |
| `check-world-lifecycle.js` | worlds load, A→B→A leaves one canvas, rapid navigation settles, `Replacing world aborted` = 0, no migration regression signature in the console |
| `check-two-client.js` | two authenticated clients see each other rendered; the `Collision { collide FALSE }` wrapper; the wrapper bound to `presenceKey`; movement, departure, return and world-change cleanup |
| `check-walk-collision.js` | WALK, gravity, world collision, a peer standing on the local citizen's exact spot who does not block them, and two tabs of one member as two nodes |
| `check-ray-events.js` | a ray resolves the correct presence (with negative controls), browser-sourced routes are accepted, a NULL SharedEvent list does not kill place startup |
| `check-memory.js` | 100 world transitions: heap slope, one canvas, no retained citizen |

`lib/beta-client.js` is the only place a gate logs in. It drives the real login
form: seeding `localStorage` does not work, because the SPA calls
`destroySession()` during boot whenever the user fetch fails.

`enterPlace()` waits for the scene's own `worldURL` to name the world asked
for. Waiting for "a scene with root nodes" is already true on arrival — the
previous world is still mounted while the next one loads — so that weaker wait
silently measures the world you just left.

## Not covered here

Weapon damage, respawn, score, and everything else in Outlands free-play. Phase
2 stops at target resolution: a ray finds the right citizen, and nothing is
done to them.
