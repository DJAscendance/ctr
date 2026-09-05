# Arrow-key navigation

Guards `spa/src/libs/x_ite_mods/arrow_keys.js`, the patch that gives the
archived worlds their Blaxxun-style arrow-key walking.

## Why this exists

That patch replaces `WalkViewer`'s key handling and binds `keydown`/`keyup` on
the browser element. It now also unbinds them in `dispose()`, because it used to
bind and never unbind — and since the handlers are `this.keydown.bind(this)`,
every world's viewer stayed reachable from the one `<x3d-canvas>` that lives for
the whole session, dragging its browser, viewpoint and scene along with it. That
was the repeated-world memory leak; see `qa/memory/README.md`.

Adding an unbind creates the opposite risk. An unbind that is too eager would
tear down the *live* viewer's handlers and leave the member unable to move — and
it would only show up after a world change, because the first world has no
earlier viewer to dispose. So this tool does not ask "do the arrow keys work".
It asks "do they still work on the third world", and walks several worlds to get
there.

## What it asserts

**Walk distance is the same on every visit to a world.** This is the assertion
that actually catches the bug, and it is deliberately not a fixed number — a
fixed number would bake in whatever the engine does today. With the leak, every
retained `WalkViewer` went on answering key events on the shared canvas, so one
`ArrowUp` drove several viewers at once and the camera moved a multiple of the
authored speed, more on each visit:

| Plaza visit | leaking | fixed |
|---|---|---|
| 1 | 20.9 | 10.4 |
| 3 | 42.9 | 10.4 |
| 5 | 63.7 | 10.4 |

The Plaza's `NavigationInfo` declares `speed 10`, so a 1.5 second press should
cover about 10.4 units once the acceleration ramp is taken off. The fixed column
is the authored speed. The leaking column is two, four and six viewers pushing
at once. **The fix restores the authored walk speed; it does not change it.**

**Collision**, but only where there is known to be a wall. Distance alone cannot
prove it: an open world is supposed to let the camera keep going, and the Plaza
covers about 60 units in the six-second press. `ENCLOSED` names the worlds that
are shut in and how far a long press may carry the camera there.

**Gravity**, as a bound on how far height may change over a run.

## Worlds that are not this patch's business

`arrow_keys.js` only replaces `WalkViewer`. A world whose `NavigationInfo`
declares no `type` gets the X3D default of `EXAMINE`, and its arrow keys are
legitimately not walking anywhere — the flea market is one of these. The tool
reads the bound viewer and reports those worlds as `viewer=other` instead of
failing them. The class name is minified, so the walk viewer is identified by
comparing against the viewer bound by the first world in the plan, which
authors `"WALK"`.

Note what this means in practice: under the leak, the flea market *did* move,
because a stale `WalkViewer` from an earlier world was still answering. Arrow
keys appearing to work in an Examine world was a symptom, not a feature.

## Running it

Needs the QA frontend from `qa/placement/README.md` and `playwright` on
`NODE_PATH`.

```shell
NODE_PATH=<dir containing playwright> \
DISPLAY=:1 node qa/navigation/tools/check-arrow-keys.js
```

Exits non-zero if movement stops working, if walk speed drifts between visits,
or if collision or gravity is lost.
