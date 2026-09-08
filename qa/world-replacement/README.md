# World replacement

Guards how `spa/src/pages/world-browser/WorldBrowserPage.vue` replaces the world
when a member changes place.

## Why this exists

X_ITE 16.2.0 keeps one active `replaceWorld` slot. Starting a second
replacement evicts the first and rejects it, synchronously, with:

```text
Error: Replacing world aborted.
```

That is an intentional cancellation signal, not a load failure.

`loadAndJoinPlace()` used to open that slot itself, calling
`browser.replaceWorld(null)` in front of the 3D/2D branch. `startX3D()` then
called `browser.loadURL(...)`, which chains into X_ITE's own
`replaceWorld(scene)`, took the slot, and cancelled the first one. Neither call
was awaited or caught, so every 3D-to-3D world change raised an unhandled
"Replacing world aborted." for a replacement that was never needed -
`loadURL`'s replacement is what actually tears the old world down.

The explicit call is still required wherever no world load follows it. Routing
out of 3D into a 2D place, and `unloadPlace()` on the way off the page, have
nothing to supersede them, so the old world is only released if they ask for it.

So the property is not "no replaceWorld" and not "no error". It is **one
replacement per transition, made by whichever call owns that path**:

| Path | Replacement | Made by |
|---|---|---|
| 3D → 3D | one | `loadURL()`, inside `startX3D()` |
| 3D → 2D | one | explicit `replaceWorld(null)`, 2D branch |
| leaving the page | one | explicit `replaceWorld(null)`, `unloadPlace()` |

## Running it

No browser, no install, no fixtures:

```shell
node qa/world-replacement/test/check-world-replacement.js
```

The methods are lifted out of the `.vue` file and run as they ship - only their
headers are rewritten. The stand-in browser cancels the way X_ITE 16.2.0 does,
so a duplicate replacement is not merely counted, it produces the real
rejection.

The last cases are negative controls. The removed duplicate is rebuilt in both
of its shapes - with the 2D teardown dropped, as it historically was, and with
it carelessly kept - and each is run back through the same rules, which must
reject it.
