# Repeated-world memory regression

Guards one property: entering worlds over and over inside a single page session
must not make the application hold more.

## Why this exists

The Mall work left one thing unproven. Loading worlds repeatedly used to kill
the tab at roughly fifty loads, and every measurement of it up to that point had
been taken with a tool that reloaded the page between worlds. A reload discards
the renderer, so it measures a heap that was never allowed to accumulate — the
one state in which the defect cannot appear.

This tool therefore has one hard rule: **one page for the whole run.** It calls
`page.goto` exactly once, to log in, and every transition afterwards is a write
to `location.hash`. It never closes the page and never restarts Chromium. A tool
that recycles the page cannot prove this issue is fixed, so this one may not.

## What it measures

`lib/probe.js` runs in the page after every transition and reads:

| field | source | why it is watched |
|---|---|---|
| `rootNodes`, `worldURL`, `sceneId` | the live X_ITE scene | an empty world is a failure, and `sceneId` shows whether a scene was replaced or reused |
| `canvasCount`, `worldCanvasCount` | the DOM | `#world` must hold exactly one canvas; a second one is a stranded scene |
| `listeners` | the socket.io client's `_callbacks` table | per-event handler counts |
| `browserCallbacks` | the X_ITE browser's callback table | `addBrowserCallback` keys by its first argument, so this must stay at one |
| `sharedObjectsMapSize` | `WorldBrowserPage` | old-world object nodes must not survive into the next world |
| `heapUsed` | `performance.memory` | uncollected heap, kept for context only |
| `retainedHeap` | CDP, at checkpoints | heap after forced GC — the number the pass rule is built on |

Nothing above is exposed by the application deliberately, so every read is
defensive. A shape the probe does not recognise is reported as `null` and the
run treats that field as *unavailable*, which fails. A probe that guesses a
number is worse than one that abstains, because the whole question is whether a
count grew.

## The pass rule

In `lib/gates.js`, and it is not "the renderer survived". A sixty-load run that
merely finishes looks identical to one that is still leaking and would have died
at ninety.

The memory gate is a **slope**, fitted by least squares over the forced-GC
checkpoints only. An uncollected heap reading swings with ordinary allocation,
so any fixed threshold on it can be met or missed by timing alone. After GC,
what is left is what the application is holding.

The fit starts at transition 10, not at transition 1. The first loads pay
one-time costs — textures, EXTERNPROTOs, engine caches — and charging those to a
per-transition rate makes a clean run look like a leaking one.

A run fails if any of these hold:

- fewer than 60 transitions completed, or the renderer died;
- any world came back with no root nodes;
- `#world` ever held other than exactly one canvas;
- socket listener, canvas, or browser-callback counts ended higher than they
  started after warm-up;
- shared-object counts drifted upward *for a repeated route* (they are expected
  to differ between routes);
- retained heap grew by more than 1.5 MB per transition.

`test/gates.test.js` holds that rule against synthetic runs, including the cases
that matter most: a leaking run that survives to the end must fail, and a run
whose counters could not be read must fail rather than pass silently.

## Running it

Needs the QA frontend from `qa/placement/README.md` (port 8128), a logged-in
test account, and `playwright` on `NODE_PATH`. Node 20+ — Playwright will not
run on the Node 14 the SPA is built with.

```shell
node qa/memory/test/gates.test.js          # pass rule only, no browser

NODE_PATH=<dir containing playwright> \
DISPLAY=:1 node qa/memory/tools/check-world-memory.js 100 artifacts/memory
```

Arguments are the transition count (default 100) and the output directory. It
writes `memory-run.json` (full per-transition records plus the verdict) and
`memory-run.csv` (the flat table), prints a checkpoint summary, and exits 0 on
PASS, 1 on a gate failure, 2 on a run that could not complete.

## The bare X_ITE control

`tools/check-bare-xite.js` answers the question the application run cannot:
*who* is holding the old worlds.

It serves a hand-written page on the QA origin — so `/assets` still resolves —
containing X_ITE from the same CDN pin the application uses, the engine patches
read straight out of `spa/src/libs/x_ite_mods/`, and nothing else. No Vue, no
router, no socket, no components. Then it replaces the world through
`browser.loadURL` over and over on one canvas.

```shell
NODE_PATH=<dir containing playwright> \
DISPLAY=:1 node qa/memory/tools/check-bare-xite.js 40 artifacts/memory/bare-xite.json

# only the compatibility shim, over the worlds that load without the rest
CTR_BARE_PATCHES=minimal \
CTR_BARE_WORLDS=/assets/worlds/enter/vrml/enter.wrl,/assets/worlds/shop/vrml/shop.wrl \
DISPLAY=:1 node qa/memory/tools/check-bare-xite.js 30

# bisect: an exact patch set, always behind x_ite_compat.js
CTR_BARE_PATCH_LIST=arrow_keys.js DISPLAY=:1 node qa/memory/tools/check-bare-xite.js 20
```

Read it against the application run:

| bare control | application run | conclusion |
|---|---|---|
| flat | climbing | the retention is in CTR's component lifecycle |
| climbing | climbing | the retention is in the engine or in a patch |

That last row is why the patch switches exist. When the full-patch control grew
at 19.6 MB per load and the shim-only control grew at 0.8 MB, the engine was
cleared and a patch was implicated; bisecting the list found `arrow_keys.js`
alone at 17.9 MB per load. Keep the world list identical between the runs being
compared — the Mall is heavier than the shops, so changing worlds and patches at
the same time proves nothing.

`legacy_links.js` is the one patch the control cannot load: it is the only one
that pulls a module in through `require`, and it only rewrites dead
cybertown.com URLs on navigation, which this harness never performs.

## The route plan

One cycle is Plaza, Mall, Electronics Store, Mall, Flea Market, member home,
club, Mall, Antique Shop, Mall.

The member home is not filler. It is served by the `user-home` route record
while the shops are served by `world-browser`, and a plan built only from
`/place/:id` slugs keeps one `WorldBrowserPage` instance alive for the entire
run. Crossing route records is what forces components to be destroyed and
rebuilt, which is the condition a registration that is never undone needs in
order to show itself.

The club step is dropped, with a note in the output, when the QA database has no
club the test account can enter.
