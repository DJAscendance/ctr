# CTR Object Placement Invariance Contract

This directory is the ruler used to prove that upgrading X_ITE does not move
existing Cybertown objects. It captures where objects are stored and where they
are actually rendered, then compares two captures and fails on any drift.

Control runtime: **X_ITE 15.1.12**, commit
`ee238a61867554916aa9336655469b7395b09c6d`, tag `xite-15.1.12-qa-pass-baseline`.

Nothing here writes to citizen placement data. The seed tool only inserts
`QAFIX `-prefixed rows into a disposable QA database and refuses to run against
anything larger than a dev seed.

## Placement data flow

Database row to rendered pixel:

1. `object_instance` / `mall_object` rows hold `position` and `rotation` as JSON
   in MySQL `TEXT` columns.
2. `api/src/repositories/object-instance/object-instance.repository.ts`
   (`findByPlaceId`) and `api/src/repositories/mall-object/` read them verbatim.
3. `api/src/services/place/place.service.ts#getPlaceObjects` and the mall
   equivalent pass the raw strings through untouched.
4. `GET /api/place/:placeId/object_instance` — or `GET /api/mall/objects/:placeId`
   for `type = 'shop'` places — returns them as strings.
5. `spa/src/pages/world-browser/WorldBrowserPage.vue#getPlace` fetches the list.
6. `WorldBrowserPage.vue#addSharedObject` `JSON.parse`s each string, substituting
   `{x:0,y:0,z:0}` and `{x:0,y:0,z:0,angle:0}` when the column is `NULL`, then
   builds `X3D.SFVec3f` / `X3D.SFRotation` values.
7. It calls `createProto('SharedObject')` and assigns `translation` and
   `rotation` on the PROTO instance, plus an `Inline` child pointing at
   `/assets/object/<object.directory>/<object.filename>`.
8. `spa/assets/externprotos/shared_xite.wrl` declares `PROTO SharedObject`. Its
   body wires `DEF T1 Transform { translation IS translation; rotation IS rotation }`.
   There is no `scale`, `center` or `scaleOrientation` input, so the rendered
   transform is exactly the two stored values.
9. Writes go back the same way: `saveObjectLocation` posts to
   `/api/object_instance/:id/position` or `/api/mall/:id/position`, and
   `object-instance.service.ts#updateObjectPlacement` re-serialises with
   `Number.parseFloat` and `JSON.stringify`.

## Stored placement fields

| Table | Column | DB type | Format | Units | Null behaviour |
|---|---|---|---|---|---|
| `object_instance` | `position` | `text` | `{"x":n,"y":n,"z":n}` | metres | `NULL` renders as `0 0 0` |
| `object_instance` | `rotation` | `text` | `{"x":n,"y":n,"z":n,"angle":n}` | axis unitless, angle radians | `NULL` renders as `0 0 0 0` |
| `mall_object` | `position` | `text` | same | metres | same |
| `mall_object` | `rotation` | `text` | same | radians | same |

Identity: `object_instance.id` / `mall_object.id`. Place: `place_id`. Owner:
`object_instance.member_id` (nullable since migration `20260415085031`);
`mall_object` has no owner column. Asset: `object.directory` + `object.filename`.

Coordinate system: VRML/X3D right-handed, Y up, metres, X right, Z toward the
viewer. Coordinate order is `x, y, z` in both JSON and the `SFVec3f`.

Rotation format: axis-angle. Four floats, `x y z` axis and `angle` in radians,
matching `SFRotation`. It is **not** Euler and **not** a quaternion.

Scale format: **not persisted and not renderable**. No column exists and the
`SharedObject` PROTO exposes no scale field, so every CTR object renders at
`1 1 1`. The captures record this as `impliedScale` so a future engine that
starts applying a scale is still caught as a failure.

## Two layers

- **Stored** — read straight out of the database with `SELECT`. Must be
  byte-identical before and after an upgrade. Tolerance `0`. The raw TEXT is
  kept alongside the parsed numbers, and both are compared:

  - **raw** — the exact MySQL bytes. `{"x":1.0}` and `{"x":1.0000}` differ here
    even though they parse alike, and the comparator reports that as
    `STORED_RAW_CHANGED`: a stored-data mutation, never rendered movement.
  - **numeric** — the parsed values, which decide where the object ends up.

  A run reports raw, numeric and rendered mismatches as three separate counts,
  so a database rewrite can never be mistaken for an object that moved.
- **Rendered** — read out of the live X_ITE scene graph in a real browser, by
  CTR object id, never by scene order. Allowed a small float margin.

## Tolerances

| Layer | Tolerance |
|---|---|
| stored position | `0` (exact) |
| stored rotation | `0` (exact) |
| rendered position | `0.0001` m |
| rendered rotation axis | `0.0001` |
| rendered rotation angle | `0.0001` rad |
| rendered scale | `0.0001` |

## Drop, move and beam

| Function | Where | Input coordinates | Conversion | Saved | Rendered |
|---|---|---|---|---|---|
| `dropObject` | `WorldBrowserPage.vue` | current viewpoint `position` / `rotation`, kept live by the `ProximitySensor` `position_changed` and `orientation_changed` callbacks | drops the object `d = 4` m in front: `pos + rot.multVec(0,0,-4)` with `y` forced to `0`, so drop height is the avatar's eye height; rotation is `SFRotation(0,1,0, atan2(offset.x, offset.z))` and the saved angle adds `Math.PI` so the object faces the avatar | `POST /object_instance/:id/drop` with `dropPosition._value` and the four rotation floats | same values, immediately via `addSharedObject` |
| `moveObject` | `WorldBrowserPage.vue` | none | sets `startMove = true` on the PROTO instance; the HUD gizmo inside `shared_xite.wrl` then drives `newPosition` / `newRotation` eventOuts | `saveObjectLocation` reads `translation` / `rotation` back off the node and posts to `/object_instance/:id/position` or `/mall/:id/position`; the service re-runs `Number.parseFloat` | the node is already at the new transform; no reload |
| `beamTo` | `WorldBrowserPage.vue` | for an object, the node's `translation._value` and `rotation._value` (angle popped off); for an avatar, `users[id].transform` | offset `rot.multVec(0,0,-distance)` with `y` forced to `0`; `distance` comes from `SharedZone.beamToDistance`, defaulting to `-4` for objects and `3` for avatars | nothing — it creates and binds a temporary `Viewpoint`, then disposes it on unbind | moves the camera only; object transforms are untouched |

`dropObject` and `beamTo` both depend on the current Viewpoint. `dropObject`
additionally depends on the `ProximitySensor` in the world file keeping
`this.position` / `this.rotation` current, so a world without one drops objects
at the last known camera pose.

## Three coordinate systems — keep them separate

1. **Mall upload / object-local.** `ObjectProperties.vue#loadObjectPreview` loads
   the empty `assets/object/ObjectPreview.wrl` and then adds the object's
   `Inline` as a bare root node. CTR applies no wrapper `Transform`, no floor
   snap and no re-centring, so the object's own authoring origin is what ships.
   `mall/checker.vue` adds `MallReference.wrl` next to it purely as a visual
   size guide.
2. **Citizen saved world placement.** The `position` / `rotation` JSON above.
   Relative to the world file's origin.
3. **X_ITE Transform.** The `DEF T1 Transform` inside the `SharedObject` PROTO,
   fed only by layer 2.

Future `.x3d`, `.glb` and `.obj` support must not collapse these. In particular
`.glb` is Y-up metres but authored with a different handedness convention, and
`.obj` carries no unit at all; both need conversion at layer 1, never at layer 2.

## Files

| File | Role |
|---|---|
| `lib/contract.js` | field map, tolerances, stored-value parsing |
| `lib/comparator.js` | baseline vs candidate comparison |
| `lib/rendered-identity.js` | scene node to placement row, duplicate detection |
| `lib/targets.js` | resolves each target's place id and route from the database |
| `test/comparator.test.js` | proves the comparator fails when it should |
| `test/cli.test.js` | proves `compare.js` refuses a duplicated key |
| `test/rendered-identity.test.js` | proves a placement rendered twice fails |
| `test/lifecycle.test.js` | proves an unobserved row is never a pass |
| `test/run.js` | standalone runner (`node test/run.js`) |
| `tools/build-fixture-set.js` | regenerates `fixtures/fixture-set.json` |
| `tools/prepare-task-db.js` | emits the pre-fixture SQL that reproduces the baseline's row ids |
| `tools/seed-fixtures.js` | emits fixture seed / purge SQL |
| `tools/run-seed.sh` | guarded seed runner (`seed` \| `purge`) |
| `tools/capture-stored.js` | read-only stored-layer capture |
| `tools/capture-rendered.js` | live-browser rendered-layer capture |
| `tools/check-lifecycle.js` | world-return and reload stability, and coverage reconciliation |
| `tools/check-rendered-vs-stored.js` | rendered transform equals stored transform, one runtime |
| `tools/check-cycles.js` | repeated visits never grow the live object count |
| `tools/compare.js` | comparison CLI, exits non-zero on FAIL |

## Running it

```shell
# one-time, disposable QA database only. Migrate and seed first, then:
node qa/placement/tools/prepare-task-db.js | <mysql into the QA container>
qa/placement/tools/run-seed.sh seed     # `purge` removes every QAFIX row again

# capture the control baseline
node qa/placement/tools/capture-stored.js
DISPLAY=:1 node qa/placement/tools/capture-rendered.js

# after an engine upgrade
node qa/placement/tools/capture-stored.js   /tmp/candidate/stored-16.2.0.json
DISPLAY=:1 node qa/placement/tools/capture-rendered.js /tmp/candidate/rendered-16.2.0.json
node qa/placement/tools/compare.js qa/placement/baselines /tmp/candidate report.json

# supporting checks
node qa/placement/test/run.js
node qa/placement/tools/check-lifecycle.js /tmp/candidate/rendered-16.2.0.json
node qa/placement/tools/check-rendered-vs-stored.js /tmp/candidate
DISPLAY=:1 node qa/placement/tools/check-cycles.js 10
```

`check-lifecycle.js` and `check-cycles.js` fail on a row that never rendered.
`CTR_QA_ACCEPT_PARSE_BLOCK=1` accepts `WORLD_PARSE_BLOCK` rows, and only those;
they are still printed with their ids so an accepted block stays visible.

## Reproducing the baseline's row ids

Both baselines key every record on `<source>:<row id>`, and those ids come out
of auto-increment counters. A rebuilt database hands out different ones, and the
comparison then reports all sixty rows as missing rather than as unchanged.

`tools/prepare-task-db.js` sets the counters, so a database that has been
migrated and seeded lands the fixture rows on exactly the baseline's ids. It also
creates the two QA accounts, the home place, and the five pre-existing rows the
fixture seed does not own - reproducing their position and rotation bytes from
what the baseline itself records. Run it before `run-seed.sh seed`.

The object directories the pre-existing rows name are upload-area paths, and
`spa/assets/object/` is gitignored, so those `.wrl` files are not in the
repository and their `Inline` loads fail. That does not affect placement: the
`SharedObject` PROTO instance carries the transform whether or not its geometry
resolves, so the row is still measured. It does mean a placement screenshot shows
fewer objects than the scene graph holds.

## An unobserved row is never a pass

The rendered capture emits one record per expected placement row, taken from the
database, and marks each with what was actually seen:

| Observation | Meaning |
|---|---|
| `RENDERED` | the node was found and its transform read |
| `WORLD_PARSE_BLOCK` | the world's parse aborted, so nothing could render |
| `WORLD_NOT_LOADED` | the place never became current, for some other reason |
| `NOT_RENDERED` | the world loaded but this row produced no node |

This matters because a failed load is invisible from the node list alone. When
`GET /api/home/:username` rejects, `main.ts` never calls `setPlace`; when a world
fails to parse, X_ITE keeps the previous scene. Either way the browser is still
showing the last place, complete with its `SharedObject` nodes. A capture that
read only the node list credited those to the place under test, which reads as a
partial render rather than as a place that was never reached. Every phase now
checks the current place id and the loaded world URL before any node counts.

## Duplicate input is refused, never deduplicated

`compare.js` checks every capture file for a repeated `<source>:<id>` as it
reads it, before any record reaches the merged `Map`. A `Map` would silently
keep one of the two rows, and whichever copy it dropped could be the one
carrying the drift the comparison exists to find. A duplicate aborts the run
with `DUPLICATE_OBJECT_KEY <source>:<id>` and exit status 3, and no comparison
is performed at all.

## Routes matter

`/place/:id` resolves a place by **slug**. A numeric place id there leaves the
store empty, so the world URL becomes `/assets/worlds/undefinedundefined` and
nothing loads. Use:

| Category | Route |
|---|---|
| public | `/place/enter` |
| home | `/home/:username` |
| club | `/club/:placeId` (the login user must own or belong to the club, or the club door blocks the 3D view) |
| place | `/place/fleamarket` |

## Coverage and its limits

| Category | Stored | Rendered |
|---|---|---|
| home | 20 fixtures + 1 pre-existing | 21 |
| club | 10 fixtures | 10 |
| place (flea market) | 10 fixtures | 10 |
| public (Plaza) | 5 fixtures + 3 pre-existing NULL-placement rows | 8 |
| shop (`mall_object`) | 10 fixtures + 1 pre-existing | 11 |

Every category is now measured at both layers: 60 stored rows, 60 rendered.

Shop coverage arrives via two routes because all `type = 'shop'` places share one
world, `assets/worlds/shop/vrml/shop.wrl`: `/place/antiqueshop` carries 10 of the
fixtures and `/place/electronicsstore` the remaining one.

### Shop identity: the rendered id is not the stored id

`GET /api/mall/objects/:placeId` selects `object.*` next to the mall row's
position and rotation, so `object.id` shadows `mall_object.id`. The id the SPA
puts on the `SharedObject` PROTO is therefore the **catalogue object id**, while
the stored layer keys on `mall_object.id`. `capture-rendered.js` resolves
`(place slug, object id)` back to the real row id so both layers key alike, and
fails with `AMBIGUOUS_MALL_IDENTITY` if one shop ever stocks the same catalogue
object twice — at which point a rendered node could not be tied to a single
placement row at all. Nothing is matched by scene order.

The QA database ships with only dev seed data, so the fixtures are synthetic.
They were seeded from the local item library and cover: every axis sign, the
origin, raised and sunken Y, stacked objects at three heights, all four walls,
X-axis and Z-axis tilts, an oblique unit axis, high-precision coordinates copied
off a real drop, sub-tolerance offsets, animated and static geometry, and both
back-dated and current `created_at` values.

The contract, comparator, tests, captures and comparison all run on the pinned
Node 24.21.0, which is also new enough for Playwright, so `capture-rendered.js`
no longer needs a second runtime. It renders on the GPU via ANGLE (`DISPLAY=:1`);
software rasterisation
produces identical transforms because they are scene-graph values, but the
screenshots are then not representative.

`qa/` sits outside the `spa` and `api` ESLint projects, so `npm run lint` in
either workspace does not reach it. No production SPA or API source is touched
by this directory, so no build is required to use it.

## Fixture defects this ruler had, and what they hid

Two of them, both in QA setup rather than in the product. Recorded because each
one produced a plausible-looking partial result rather than an error.

- **The home place had no block.** `place` carries no parent column: the
  home-to-block link lives in `map_location`, and `homeService.getHomeBlock`
  walks it. A home place inserted without a claimed lot makes that walk
  dereference an undefined row, `GET /api/home/:username` answers 400, and the
  SPA silently stays in the place it was already in. The capture then read the
  *previous* world's objects and reported them as a home that had partly
  rendered. `seed-fixtures.js` now claims a free lot for an unlinked home.

- **The club route was a written-down id.** `/club/837` is only the fixture club
  on the database the baseline was captured from. Anywhere else that route
  reaches another place or the club door, and ten real placements were recorded
  as unobserved. Home and club ids are now resolved from the database by
  `lib/targets.js`, never written down.

`check-cycles.js` carried a third, quieter version of the same problem: because
home and club had no slug, their expected count came from the first observation
rather than from the database, so whatever the first cycle happened to see
became the standard every later cycle was measured against. All targets now take
their expected count from the database.

## Shop on the beta X_ITE branch

`spa/assets/worlds/shop/vrml/shop.wrl` carries a blaxxun multiuser
`DEF S Script` at top level using `IS` statements, which is invalid outside a
PROTO. X_ITE 16.2.0 aborts the parse at line 104:29 and the world never loads,
so the 11 `mall_object` placements it holds cannot be observed at all. They stay
in the 60-row stored comparison and are classified `WORLD_PARSE_BLOCK`, never
merged into the stored rows and never counted as agreement.

This is world content and it predates the engine work: the file's blob is
identical at the PR 1 base, at the integrated reference, and at the branch head,
and no commit on the branch touches it.

## Known baseline defects

- `KNOWN_BASELINE_NON_PLACEMENT_DEFECT` — reloading a shop leaves every mall
  object in the scene twice. Both copies carry identical placement, the CTR ids
  stay unique, and the count returns to normal on the next navigation, so
  captures and comparisons are unaffected. `WorldBrowserPage.vue` adds objects
  from a 2 s `setTimeout` after world init with no guard against a second init
  pass, and the shop path has no socket-driven reconciliation because
  `onSharedObjectEvent` only ever queries the `object_instance` endpoint. This
  became visible only once the shop world started loading; it is object-lifecycle
  work, not placement work, and is left for a separate pass.

- `KNOWN_BASELINE_NON_PLACEMENT_DEFECT` — `GET /api/mall/can_admin?id=2` returns
  HTTP 400 on every shop load for a non-admin QA user. It does not affect world
  load or placement.

- `KNOWN_BASELINE_NON_PLACEMENT_DEFECT` — Mall `startSharedEvents` can hit a
  `null` entry in `sharedZone.events` and call `addFieldCallback` on it. It
  throws after the world and all `SharedObject` nodes are already in the scene,
  so placement capture is unaffected. Not fixed in this phase; recorded so the
  16.2.0 comparison starts from a known condition.
