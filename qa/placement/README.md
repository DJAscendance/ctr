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
  kept alongside the parsed numbers.
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
| `test/comparator.test.js` | proves the comparator fails when it should |
| `test/run.js` | standalone runner (`node test/run.js`) |
| `tools/build-fixture-set.js` | regenerates `fixtures/fixture-set.json` |
| `tools/seed-fixtures.js` | emits fixture seed / purge SQL |
| `tools/run-seed.sh` | guarded seed runner (`seed` \| `purge`) |
| `tools/capture-stored.js` | read-only stored-layer capture |
| `tools/capture-rendered.js` | live-browser rendered-layer capture |
| `tools/check-lifecycle.js` | world-return and reload stability check |
| `tools/compare.js` | comparison CLI, exits non-zero on FAIL |

## Running it

```shell
# one-time, disposable QA database only
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
node qa/placement/tools/check-lifecycle.js
```

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
| shop (`mall_object`) | 10 fixtures + 1 pre-existing | **0 — see below** |

Individual shop worlds are stored-layer only. `assets/worlds/shop/vrml/shop.wrl`
pulls in `externprotos/malldirectory/malldirectory.wrl`, which references
`/places/shop/sounds/*.wav`. Those paths fall through the QA static server to
`index.html`, so X_ITE waits on audio that never decodes and `INITIALIZED_EVENT`
never fires. Verified still stuck after 180 s. This is a content and asset-path
gap that predates any engine work, not a placement defect, but it does mean the
`mall_object` rendered path is unmeasured at this baseline.

The QA database ships with only dev seed data, so the fixtures are synthetic.
They were seeded from the local item library and cover: every axis sign, the
origin, raised and sunken Y, stacked objects at three heights, all four walls,
X-axis and Z-axis tilts, an oblique unit axis, high-precision coordinates copied
off a real drop, sub-tolerance offsets, animated and static geometry, and both
back-dated and current `created_at` values.

The contract, comparator, tests, captures and comparison all run on the pinned
Node 14.21.3. `capture-rendered.js` is the exception: Playwright needs a modern
Node, so run that one tool with whatever Node the local Playwright install
supports. It renders on the GPU via ANGLE (`DISPLAY=:1`); software rasterisation
produces identical transforms because they are scene-graph values, but the
screenshots are then not representative.

`qa/` sits outside the `spa` and `api` ESLint projects, so `npm run lint` in
either workspace does not reach it. No production SPA or API source is touched
by this directory, so no build is required to use it.

## Known baseline defects

- `KNOWN_BASELINE_NON_PLACEMENT_DEFECT` — Mall `startSharedEvents` can hit a
  `null` entry in `sharedZone.events` and call `addFieldCallback` on it. It
  throws after the world and all `SharedObject` nodes are already in the scene,
  so placement capture is unaffected. Not fixed in this phase; recorded so the
  16.2.0 comparison starts from a known condition.
