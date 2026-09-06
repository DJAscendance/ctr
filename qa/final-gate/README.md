# X_ITE 16.2.0 final gate

The rulers built to answer the compatibility questions the earlier migration
suites did not cover. `qa/placement`, `qa/memory`, `qa/scene-cache`,
`qa/texture`, `qa/navigation` and `qa/legacy-links` each guard one property.
This directory covers the rest of the runtime surface: the world controls, the
sensors the placement actions depend on, the content matrices, and the flight
that used to kill the renderer.

Control runtime: **X_ITE 15.1.12**. Candidate: **X_ITE 16.2.0**, pinned in
`spa/public/index.html`.

## The reader comes first

`lib/scene-access.js` is the reason the rest of this works, and it is worth
reading before any of the tools.

X_ITE 16 hands the page a sealed SAI facade whose prototype carries only the
X3DNode methods the specification requires. None of them reach the two places
most archived CTR content actually lives: inside an `Inline`'s own scene, and
inside a PROTO instance's body. The Mall is the case that forces the issue - a
walk over the facade alone finds ten root nodes, no `TouchSensor`, no clock hand
and no door, and would report a world with no controls in it.

The facade keeps the concrete node on a symbol-keyed own property. There are
four; the concrete node is the one whose prototype carries `getInternalScene`
(Inline and the other URL objects) or `getBody` (every PROTO instance). The
library finds it by capability rather than by position, because the position is
a minifier artefact that will move on any rebuild while a class that stops
exposing `getBody` has genuinely changed.

Two further facts about the field API, both learned the hard way:

- **An SFNode field *is* the node.** It answers `getNodeTypeName()` directly.
  Calling `getValue()` on it returns an internal holder with no node interface,
  and an earlier version of the walk did exactly that - reporting a Mall with
  654 `Shape` nodes and no geometry under any of them, and 31 `Sound` nodes with
  no `AudioClip`. MFNode fields are iterable and carry a `length`.
- **There is no `_value`.** X_ITE 4 and 15 hung an internal holder off every
  `SFVec3f` and `SFRotation`, with underscored `x_` / `y_` / `z_` members. 16.2.0
  removed it. `.x` / `.y` / `.z` / `.angle` work on every version. This is not
  only a QA concern: it was a live defect in `dropObject` and `beamTo`, fixed in
  `compat: read placement fields without X_ITE's removed value holder`.

## The tools

| Tool | What it settles |
|---|---|
| `tools/survey-worlds.js` | every world builds, on one canvas at the right size, with load timings, a frame-rate sample, the failed-request log and a screenshot |
| `tools/check-interactions.js` | the ProximitySensor tracks real movement and belongs to the current scene; `dropObject`, `moveObject` and `beamTo`; NavigationInfo |
| `tools/check-mall.js` | the Mall control set, and the analogue clock read as a chain from the City Time endpoint to the hand angles |
| `tools/check-content.js` | the PROTO, EXTERNPROTO, Inline, texture-URL and audio matrices, plus Script and base-URL resolution |
| `tools/check-object-preview.js` | the second X_ITE browser `ObjectProperties.vue` builds by hand |
| `tools/check-hitek.js` | the spaceship transport, and `run.gif` as a decoding MovieTexture |
| `tools/check-navigation.js` | the viewer that gets bound, collision, and gravity |
| `tools/compare-engines.js` | the same world file under 15.1.12 and 16.2.0 in a bare page |

## Running them

Needs the QA frontend on port 8128 from `qa/placement/README.md`, a logged-in
test account, and `playwright` on `NODE_PATH`. Node 20+; Playwright will not run
on the Node 14 the SPA is built with.

```shell
export NODE_PATH=<dir containing playwright>
export DISPLAY=:1
export CTR_QA_CLUB=837          # /api/club/search returns nothing for the QA account

node qa/final-gate/tools/survey-worlds.js       artifacts/final-gate 3
node qa/final-gate/tools/check-interactions.js  <disposableObjectInstanceId> artifacts/final-gate
node qa/final-gate/tools/check-mall.js          artifacts/final-gate
node qa/final-gate/tools/check-content.js       artifacts/final-gate
node qa/final-gate/tools/check-object-preview.js <catalogueObjectId> artifacts/final-gate
node qa/final-gate/tools/check-hitek.js         artifacts/final-gate
node qa/final-gate/tools/check-navigation.js    artifacts/final-gate
node qa/final-gate/tools/compare-engines.js     artifacts/final-gate
```

Run them one at a time. Three headless Chromium instances against one QA server
starve each other, and the symptom is a world that reports its sensor at the
origin - which reads exactly like a broken ProximitySensor.

## Things that will waste a day if you do not know them

**Headless idle throttling stops the engine clock.** X_ITE drives its time from
the page's frame loop. A headless page with no input pending gets its timers
slowed to a crawl: an early run of `check-mall.js` measured the browser
advancing 1.6 seconds across a 70 second wait and reported a stopped clock, when
what had stopped was the page. Every tool that waits now launches with
`--disable-background-timer-throttling` and `--disable-renderer-backgrounding`,
and the ones that wait a long time poll the page to keep it scheduled. With that
in place the hands advance exactly with wall time.

**Readiness needs the world URL, not the root count.** The previous scene is
still mounted when the hash changes, so "root nodes above zero" passes
immediately and the run measures the world it was leaving. `survey-worlds.js`
first reported every world loading within two milliseconds of every other
because it was measuring its own polling interval, and `compare-engines.js`
reported the Mall with the Outlands' node counts. Both now wait for
`scene.worldURL` to change first.

**A failed Inline is not an absent one.** X_ITE gives every Inline an internal
scene whether or not the fetch succeeded; a missing file yields an empty scene
whose `worldURL` falls back to the document address. `check-content.js`
therefore counts an Inline as resolved only when its inner scene has root nodes,
and classifies each empty one by what the server actually returned.

**The QA nginx answers an unknown `/places/...` path with the SPA's index.html
and a 200.** So `/places/no_cache/shopping/temp.wrl` is not a 404 - it is a
successful response containing HTML, which X_ITE parses to nothing without
complaint. Any check that judges resources by status code alone will call that a
pass.

**Writing an eventOut does not always travel the ROUTE.** Setting `touchTime` on
a `TouchSensor` stands in for a pick, and it works for a PROTO declared in the
world file - the shop doors run `Browser.loadURL` through it. It does *not* work
inside an EXTERNPROTO body: the same write into `malldirectory.wrl` is accepted
and goes nowhere, while sending the event to the eventIn at the far end of that
ROUTE scrolls the panel. `check-mall.js` drives the directory at the eventIn and
leaves the doors to carry the evidence that picking reaches a Script at all.

**`getFieldDefinitions()` is how you enumerate fields.** `getFields()` does not
exist on X_ITE 16.

## QA data this suite needs

Neither of these touches real content; both live only in the disposable QA
database.

- **A disposable `object_instance` owned by the login account**, for the drop,
  move and beam gates. `check-interactions.js` takes its id as an argument and
  restores its placement afterwards. The flea market is the place to drop it in:
  the drop controller allows a drop there without place ownership.
- **A catalogue `object` row with a model that exists on disk**, for the preview
  gate. No object in the QA database had one, which is why the previous pass
  could not run this gate at all. `assets/object/1/5000exp.wrl` ships in this
  repository and carries a relative texture, so a row pointing at it gives the
  normal preview path something real to load.

## Known content defects these tools will report

None of these are engine faults, and `compare-engines.js` shows the HUD ones
behaving identically on 15.1.12.

- `ne_game.wrl` (Outlands) uses `HUD{}` twice and declares the type nowhere, so
  no HUD is built. `enter.wrl` declares the same type against
  `/externprotos/nodes_xite.wrl#HUD`, a local file that ships here, and its HUD
  builds - which is what proves the custom type works.
- `shopping.wrl` (Mall) declares `HUD` and `Occlusion` against a `urn:` address
  and a retired `blaxxun.com` URL. Neither stops the world.
- `/places/no_cache/<world>/temp.wrl` is served as HTML, as above.
- `assets/worlds/ne_game/vrml/weapons/beamer.gif` is missing from the repository.
- `Browser.setGravity` and `Browser.getGravity` in `bxx_auth.js` write through
  `this.browserOptions`, which X_ITE 16 no longer exposes, so both throw. Ten
  call sites across the home world templates in `worlds/007`, `/008`, `/009` and
  `/00a` use `setGravity` to switch gravity off while a lift moves. The QA home
  world, `worlds/003`, does not.
