# qa/jail — the Jail's cell boundary

One gate. It answers a single question that no unit test can: **does a citizen actually stay
on the side of the force field their standing puts them on, in a real browser, under the
pinned X_ITE 16.2.0?**

```shell
node qa/jail/tools/check-jail-confinement.js
CTR_QA_ALLOW_SOFTWARE=1 node qa/jail/tools/check-jail-confinement.js   # host with no GPU
```

No stack is needed. The gate serves `spa/assets` itself on `CTR_JAIL_QA_PORT` (8211 by
default) and drives a browser against it.

## What it proves

| World | Served to | Spawn | Must not |
|---|---|---|---|
| `jailvisit.wrl` | everyone else | visiting gallery, z ≈ 19.5 | walk into the cells |
| `jailinmate.wrl` | a citizen under a live jail ban | cell block, z ≈ −24.6 | walk into the gallery |
| `jailstaff.wrl` | Security and Jail offices | visiting gallery | — (its staff door is checked instead) |

Plus, on the staff world only: binding the staff door's cell-block Viewpoint really does put
the guard inside the cells, standing on the floor.

## Two traps this gate already fell into

**The SAI reports the authored viewpoint, not the avatar.** `browser.getActiveViewpoint()`
and the Blaxxun `viewpointPosition` shim both answer with where the camera was *declared*,
which never changes as you walk — so neither can see a barrier working. The gate injects a
ProximitySensor large enough to contain the world and reads `position_changed`, which is the
real position.

**Arrow keys do nothing.** X_ITE's WALK viewer moves on a held mouse drag. The first version
of this gate used `keyboard.down("ArrowUp")` and reported every world as confined — because
no input ever reached the browser and nobody moved at all. Every negative result is now
guarded by a check that the viewer moved; a world where the viewer is stuck fails rather
than passes.

## Where the numbers come from

Nothing here is invented. `DEF forcefield` in `jail.wrl` is a polygon at **z = 1.25** once
the `-1 0 0 -1.571` rotation on its Transform is applied. The worlds' own `DEF CheckMe`
scripts turned a visitor back anywhere inside z < 1.5 and a prisoner back anywhere outside
z > 0.9. The two spawns are the Viewpoints `jail.wrl` and `jailpris.wrl` were shipped with.

The same constants live in `spa/src/helpers/jail.helper.ts`, which
`spa/tests/jail-client-rules.test.ts` checks, so the client and this gate cannot drift apart.

## Known, and not caused by this gate

Four textures 404 in every Jail world, including the untouched historical ones:
`walls.jpg`, `tech1.gif`, `vent01.jpg`, `bwalls.jpg`. They were already missing.

`jail.wrl` and `jailpris.wrl` also throw once per frame from `CheckMe`, `CheckNav` and
`zap_control`: they call `Browser.viewpointPosition`, `Browser.setNavigationMode` and
`Browser.getWorldStartTime`, which are Blaxxun extensions X_ITE does not have. That is
exactly why the confinement those scripts encoded had to be restored as collision geometry
instead.
