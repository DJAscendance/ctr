# Handoff — `fix/classic-place-admin-fidelity`

Written 2026-07-27 at the end of the implementation session. **Nothing is merged,
pushed, deployed, or PR'd.** The branch is complete for its defined scope and is
waiting on Ryan's manual testing plus one product decision (place-tier chat
moderation, §6).

---

## 1. Git state

| | |
|---|---|
| Branch | `fix/classic-place-admin-fidelity` |
| HEAD | `dfbe2b3bf621288fc8ab3efb4d75229ae31e26a7` |
| `origin/beta` | `76cb514aa3517337adccf1ea989c0e7f18ccc517` |
| merge-base | `76cb514aa3517337adccf1ea989c0e7f18ccc517` — **identical to `origin/beta`** |
| Relationship | beta is a direct ancestor: fast-forwardable, no rebase or merge needed |
| Commits ahead | 23 |
| Worktree | **clean** — `git status --porcelain --untracked-files=all` returns nothing |
| Worktree path | `~/Projects/cybertown/.worktrees/ctr/classic-place-admin-fidelity` |
| Diff vs beta | 44 files changed, +7500 / −340. `git diff --check` clean. |

### ⚠ The branch's upstream is `origin/beta`

`git rev-parse --abbrev-ref @{u}` returns `origin/beta`. **A bare `git push` from
this branch would target beta.** Left as found — changing it is the next agent's
call, not this session's. Always push explicitly:

```bash
git push origin fix/classic-place-admin-fidelity:fix/classic-place-admin-fidelity
```

To disarm it first (safe, local only):
`git branch --set-upstream-to=origin/fix/classic-place-admin-fidelity` after the
first explicit push, or `git branch --unset-upstream`.

### Commit list, oldest first

```
b925da8  docs: trace classic place-admin behavior in the CS4/5.1/7.0 RE corpus
3c6bbf5  refactor: extract the shared block lot-map renderer
08d12e2  feat: preview candidate block backgrounds behind the live lot overlay
f17f97f  fix: restore the classic Home Chat Access presentation
7a59c9f  feat: staff-managed place information
2c6c179  docs: record the place Update Wizard follow-up lanes with RE evidence
70da4a1  docs: add a temporary lane marker pointing at the place-admin reports
15ef35c  docs: trace classic update hierarchy and Cybertown map restrictions
c752ab8  refactor: add shared capability-driven place update hub
986ca15  feat: compose scoped colony and neighborhood update tools
c8b21bd  feat: integrate block administration into the update hub
bcc7666  test: cover hierarchical update-hub permissions
84be9f2  docs: record deferred structural and place-chat authorization lanes
673dcb6  fix: keep the place tool bars intact and gate each button by capability
f12803d  feat: present the place update hub as the home update page
49a00b7  docs: record that blocks have no chat, only colonies and neighborhoods
6dbd764  docs: separate Owner/Access Rights from the deferred Chat Access lane
ade6520  docs: trace the historical chat moderation tools and stop before building
09246f1  fix: make the public Information windows display-only
c86496f  fix: keep tool-bar and moderation actions out of the Update hubs
482891e  test: assert tool placement, not merely route availability
1af60f5  docs: record the corrected hub composition and the placement taxonomy
dfbe2b3  fix: give the Information window the classic MANAGE button
```

The last six are the manual-review corrections (§3). Nothing was squashed or
rewritten.

---

## 2. What is implemented

| Feature | Where |
|---|---|
| **Home Chat Access**, classic presentation | `HomeChatAccessPage.vue` — 8 slots × 16 chars, 2×4 grid, unknown-name note, Update/Cancel |
| **Shared block lot-map renderer** | `components/block/BlockLotMap.vue`, `helpers/block-map.helper.ts` — 12×6 at 40px, one renderer for the public map, the wizard and the background preview |
| **Block background preview** | Candidate scenery drawn *behind* the live lot overlay, with Apply / Cancel / Restore Default. Selecting previews only; nothing persists until Apply |
| **Staff-managed place information** | `PlaceInformationService` + `GET/PUT /place/:id/information`, sanitized on write via `libs/sanitize-user-html.ts` (allowlist), rendered through the one HTML-rendering component |
| **Scoped Update hubs** | `PlaceUpdateHubService` + `GET /place/:placeId/update-hub`, `PlaceUpdateHub.vue`, one component for colony / hood / block |
| **Capability-gated tool bars** | Each button drawn from its own server capability instead of a broad admin flag |
| **The MANAGE button** | Classic management control on every staff-managed Information window |

### Hub composition (final)

| Tier | Tiles | Plus |
|---|---|---|
| Colony | Update Information | neighborhood list, fixed-map notice |
| Neighborhood | Update Information · Map Background | block list |
| Block | Update Information · Lot Availability · Map Background | — |

That is the CS 4.0 wizard action set exactly (`wizardinfo`, `wizardpresent`,
`wizardimage`). Everything else a place administrator can do lives on the
permanent tool bar or in its own window — see
`docs/research/classic-update-hierarchy-matrix.md` §6.3 for the four-category
placement table.

### Authorization shape

- The only client input is a place id. Type, slug and the parent chain are read
  from the stored row, so nothing the caller sends steers which scoped check runs.
- Capabilities resolve individually. `canManageAccess` is **not** an alias for
  `canAdmin` — at every tier it excludes that tier's own deputy.
- `canOpen` is narrower than "the endpoint answered 200": true only when a
  capability whose control lives *inside* the hub was granted.
- `unsupported` and `forbidden` return an identical 403 body, so places cannot be
  enumerated.
- Every tile, button and route is independently authorized by its own endpoint.
  **Hidden controls are never the access control.**

---

## 3. Corrected during manual review

Ryan's review found five placement defects and one wording defect. All fixed.

1. **Hubs duplicated permanent tool-bar actions.** Message to All, Inbox to All
   and Access Rights were tiles *and* bar buttons. Tiles removed; the bars are
   untouched.
2. **Two invented moderation tiles.** Moderate Messages / Moderate Inbox were not
   Update Wizard functions. Removed — **not relabelled** as chat moderation. They
   keep their own names and their own windows.
3. **Check Images was in the block hub.** It is `block/action.tmpl`'s third owner
   tool (`TPL=block/plist`) and is absent from the block wizard's action list, so
   it belongs on the bar. Moved back.
4. **`Update Info` green text link on public Information pages.** Removed.
5. **…then over-corrected.** Ryan's follow-up recorded from direct memory that
   authorized staff *did* have a control there — a small classic **MANAGE**
   button, matching the Inbox and Message Board. Restored in that treatment
   (same `.btn-ui` chrome, same `flex border-4 border-black` frame), opening the
   existing editor. Order is now `MANAGE → Welcome to: <name> → information →
   staffing`.
6. **A stale doc claim.** Matrix §6.8 still said the bar buttons had moved into
   the hub — an intermediate iteration, reverted in code but left in the docs.
   Corrected.

Two side effects worth knowing:

- `Information.vue` was restructured so the render order is literal rather than
  incidental. The jail's staff-by-job listing had duplicated the heading and
  information markup as a separate top-level branch; it is now nested under one
  shared layout, so the two cannot drift.
- Removing the link had briefly left Mall information with **no** UI entry point
  (public places have no Update hub). The MANAGE button closed that without
  inventing a public-place hub.

Tests were rewritten to assert **placement**, not merely route availability — the
old suite proved every tile resolved somewhere, which is exactly what let five
tiles sit in the wrong place while passing.

---

## 4. Test results (2026-07-27, at `dfbe2b3`)

| Check | Result |
|---|---|
| SPA `npm test` (Node 14) | **149/149** across 9 suites — 43 in `place-update-hub` |
| API `NODE_ENV=development npx jest` | **303 passed, 5 failed / 30 suites** |
| API `npx tsc --noEmit` (Node 20) | clean |
| SPA production build (Node 14) | succeeds |
| ESLint `--no-fix`, every touched file | at or below the `origin/beta` baseline; new files 0 |

**The 5 API failures are the known beta baseline**, across `wallet`,
`role.repository`, `member.service`, `club.service` — three fail *"Your test suite
must contain at least one test"*, one with `ECONNREFUSED 127.0.0.1:3306`. All four
spec files and all four subject modules are byte-identical to `origin/beta`. Start
MySQL, or diff against beta, before blaming a change here.

Per-file lint, current vs `origin/beta`: `BlockTools` 27→14, `NeighborhoodTools`
20→15, `WorldBrowserTools` 3→3, `BlockMapPage` 19→7, `BlockWizardPage` 225→207,
`routes.ts` 5→5, `Information.vue` 0→0, `place-update-hub.test.ts` 2 (unchanged).

> `BlockTools.vue` and `NeighborhoodTools.vue` are **tab-indented** and the config
> sets `no-tabs: error`. Write new lines with spaces or you will add errors back.
> Never run an autofixing lint command; check `git status` immediately after any
> lint run.

### Live fail-closed probes (all passing)

Anonymous 401 on `can_edit` / `update-hub` / `PUT information`. Outsider 403
everywhere including the Mall. Mall staff 403 at a hood and 403 on the Mall's own
hub. Block leader 403 cross-scope, 200 on its own block. Bad id 400, missing 404,
unsupported type 403. Type spoofing ineffective — the stored row decides.

---

## 5. Preview stack — **left running at Ryan's request**

| Piece | Where | Process |
|---|---|---|
| Site | <http://127.0.0.1:8088> | `node preview-server.js` (static + `/api` and `/socket.io` proxy) |
| API | 127.0.0.1:3001 | `node -r ts-node/register -r dotenv/config src/api.ts` in `api/` (Node 20) |
| Socket / chat | 127.0.0.1:8000 | `node -r dotenv/config server.js` in `spa/` (Node 14) |
| Database | Docker `ctr-classicadmin-mysql`, host port **13308** | throwaway, this lane only |

**Not connected to beta or production.** `api/.env` points at `127.0.0.1:13308`;
no `cybertown.dev` or `cybertown.com` host appears in any running config. The
container's `/tmp` and `/docker-entrypoint-initdb.d` are empty — no QA scripts
were ever copied into it (all seeding ran through `docker exec … mysql -e`).

> `ctr-clone-mysql` (13307) and `ctr-recon-mysql` (13306) belong to **other lanes**.
> Dump from them if you need to; never mutate them.

### Verify it is still healthy

```bash
curl -s -o /dev/null -w 'site %{http_code}\n'   http://127.0.0.1:8088/
curl -s -o /dev/null -w 'api  %{http_code}\n'   http://127.0.0.1:3001/api/place/892/update-hub   # 401 = alive
curl -s -o /dev/null -w 'sock %{http_code}\n'   'http://127.0.0.1:8000/socket.io/?EIO=4&transport=polling'
docker ps --filter name=ctr-classicadmin-mysql
# the served bundle must match the built one:
curl -s http://127.0.0.1:8088/ | grep -o 'app\.[a-f0-9]*\.js' | head -1
ls -t spa/dist/js/app.*.js | head -1
```

Expect `200 / 401 / 200`, the container up, and the two hashes equal
(currently `app.f4d2e317.js`).

### Restart / reset

```bash
W=~/Projects/cybertown/.worktrees/ctr/classic-place-admin-fidelity
QA=~/Projects/cybertown/.qa/ctr/classic-place-admin-fidelity

# API (Node 20)
cd "$W/api"  && nvm use 20 && node -r ts-node/register -r dotenv/config src/api.ts

# socket (Node 14)
cd "$W/spa"  && nvm use 14 && node -r dotenv/config server.js

# static site + proxy (any Node)
node "$QA/preview-server.js"

# after changing SPA source, rebuild before screenshotting
cd "$W/spa" && nvm use 14 && npm run build
```

`preview-server.js` was copied into the QA directory because it had been running
out of a previous session's scratchpad, which will eventually be cleaned up. The
copy is self-contained and hard-codes the worktree path.

**Shutdown**, if it is ever wanted: `kill` the three node PIDs and
`docker stop ctr-classicadmin-mysql`. The container holds the only copy of the QA
seed — re-import the lane dump rather than hand-editing rows if it is reset.

### Known preview quirks

- **Node 14 is mandatory for the SPA** (`fibers` will not build on 20+). The API
  needs Node 20. `nvm use` in the right directory each time.
- `node_modules` were borrowed by symlinking from an existing checkout; jest and
  knex stack traces therefore mention `../../beta-home-reconciliation/api/…`.
  That is the symlink, not a stray dependency.
- The Information window is a **popup and reuses one component** for every
  `#/information/...` target. Pasting a second Information URL over a first will
  not remount it — navigate somewhere else in between, or the screenshot will show
  the previous place.
- Browsers cache the built bundle aggressively. Add a cache-busting query
  (`?cb=$(date +%s%N)`) when a screenshot looks stale.
- `playwright-cli` writes screenshots to `./.playwright-cli` **relative to the
  current directory** — `cd` to a fixed directory in any capture script.
- The Mall's heading reads `Welcome to: mall` because the seed row's `place.name`
  is the lowercase slug. Seed data, not the component.
- The block named `Edge Of<BR>Darkness` contains a literal `<BR>` in its seed
  name. It renders escaped, which is correct.

---

## 6. Throwaway QA accounts

All exist **only** in `ctr-classicadmin-mysql`. They share one password, which is
recorded in `REVIEW-GUIDE.md` (not in git) and deliberately not repeated here.

| Account | Role | Scope |
|---|---|---|
| `qaColonyLeader` | Colony Leader | colony 879 *Games* |
| `qaColonyDeputy` | Colony Deputy | colony 879 *Games* |
| `qaHoodLeader` | Neighborhood Leader | hood 891 *The Shadows* |
| `qaHoodDeputy` | Neighborhood Deputy | hood 891 *The Shadows* |
| `qaBlockLeader` | Block Leader | block 892 *Edge Of\<BR\>Darkness* |
| `qaBigBlockLeader` | Block Leader | block 1384 *Music Dome* (58 homes, 14 free lots) |
| `qaMallStaff` | Mall Manager (role 49) | place 7 *mall* |
| `qaHubOutsider` | *(none)* | denial checks |
| `BassMekanik` | Admin / Founder / Com tech | pre-existing; **password not set by this lane** |

Place chains: colony 879 → hood 891 → blocks 892, 893. Separately colony 889 →
hood 1383 → block 1384.

---

## 7. Evidence, screenshots and QA paths

| What | Path |
|---|---|
| RE evidence report (behavioral spec) | `docs/research/classic-place-admin-re-evidence.md` |
| Update-hierarchy matrix + placement table + capability matrix | `docs/research/classic-update-hierarchy-matrix.md` |
| Deferred lanes with evidence | `docs/research/classic-place-admin-followups.md` |
| **Chat moderation trace and design** | `docs/research/classic-chat-moderation-trace.md` |
| Review guide (routes, accounts, what mutates) | `~/Projects/cybertown/.qa/ctr/classic-place-admin-fidelity/REVIEW-GUIDE.md` |
| Screenshots | same directory — `30`–`43` are post-correction; `11`–`26` pre-correction, kept for comparison; `01`–`10` the earlier feature set |
| Capture and probe scripts | same directory — `preview-server.js`, `shoot-corrected.sh`, `shoot-info.sh`, `hubcheck.sh` |

`STALE-39-mis-capture-do-not-review.png` is a mis-capture from this session
(the popup had not remounted). Renamed rather than deleted so the record stays
honest. Ignore it.

None of the above is tracked in git.

---

## 8. Unresolved — preserve these

### 8.1 Place-tier chat moderation needs a product and authorization design

**Blocked on a decision, not on research.** `docs/research/classic-chat-moderation-trace.md`
is the full trace. Headlines:

- **The original had two separate features, not one.**
  - **Moderate Chat** — `place/moderate.tmpl` loading the
    `blaxxun.moderator.applet.Moderator` Java applet against a **separate
    `mdserver` daemon**. Gated on a single `#ifdef owneraccess`, with **no stored
    "who may moderate" list anywhere**; the csadmin screen states the entire model
    in one parenthesis: *"no password ⇒ only owners can moderate"*. It controlled
    who could speak **live** (Mute/Unmute, Privilege/Unprivilege) and persisted
    nothing. A scene was only moderatable if a server admin had listed its URL
    under an `APISERVER` entry in `etc/idserver.cfg`.
  - **Chat Read / Write Access** — `common/chatrights` →
    `updwriterights&cht=1`, eight 16-char nickname slots plus the `WRO` 32-bit job
    bitmask. It governed who may **speak**. This is what CTR already restored for
    homes.
- **No historical colony or neighborhood implementation was found, of either.**
  Only `place.exe` carries the `moderate` action — `community.exe`, `neighbor.exe`
  and `block.exe` carry none, and no colony/neighborhood/block template references
  it. Every archived Cybertown moderation URL is `place?ac=moderate&plc=<public
  slug>` (beach, fleamarket, jail, nightclub). Every archived `cht=1` rights URL
  targets `DTY=I&KEY=h<homeID>`. A sweep of all 280,363 CDX rows finds no colony
  or neighborhood instance.
- **The Deputy question is dissolved, not answered.** The original had no
  "leader but not deputy" vocabulary on any ACL axis, so whatever CTR adopts is a
  new product decision rather than a restoration.
- **Implementation needs all four stop conditions**: a new relation, a migration,
  a socket authorization rule and a moderator identity model. Design is in §4 of
  the trace.

Nothing cosmetic was built. No chat-named capability exists at any tier; no tile's
key, label or description mentions chat. Both are pinned by tests on both sides.

Standing product constraints: **colony and neighborhood only — you cannot chat in
a block.** Colony Deputies **are** required to be included in Colony Chat Access;
that requirement is *not* derivable from `canManageAccess`, which excludes each
tier's own deputy for the Owner axis only (matrix §6.5a).

### 8.2 `spa/server.js` unauthenticated moderation-event rebroadcast — needs security review

`spa/server.js:345-349`:

```js
socket.on('moderation', function(data) {
    socket.broadcast.emit('moderation_event', { data: data });
});
```

No token check, no authorization, arbitrary payload, broadcast to every connected
client. Any client can forge a `moderation_event`. Emitted legitimately by
`pages/admin/user/BanAdd.vue:105` and `ChatMessages.vue:173` as a notification
ping; consumed by `App.vue:400` and `Chat.vue:1128`.

**Pre-existing and untouched by this branch.** It is named explicitly because it
is exactly the "unrelated endpoint" a cosmetic Chat Moderation tile would have
been wired to. Belongs in a security lane.

### 8.3 `ColonyRepresentative` — dormant authorization hazard

`ColonyService.canAdmin` admits any holder of a `ColonyRepresentative` role
assignment **globally, unscoped** — a colony-wide administrator over every colony.
No such role row exists today, so the clause fails closed. **Do not seed or
otherwise activate a role with that name.** Matrix §2.3. Same security lane as
§8.2.

### 8.4 Block creation / withdrawal — separate future lane

Product decision already recorded (matrix §6.4): scoped Colony Leader **yes**,
scoped Colony Deputy **yes**, Neighborhood Leader **yes**, **Neighborhood Deputy
no**, leadership scoped elsewhere no, ordinary member no.

Not implemented. No `create_block` / `remove_block` / `delete_block` capability
exists, and the service spec asserts the granted set against an allowlist so
adding one later fails a test rather than shipping silently. Still open before it
can be built: slug generation, seeding the new block's 72 `map_location` rows,
background and icon defaults, rollback.

### 8.5 Colony structural map editing — unavailable, permanently

Not deferred. Cybertown's colony maps were **hard-coded HTML image maps** — literal
pixel coordinates in `community/present.tmpl` over a per-colony JPEG. Changing a
colony's layout meant editing that file and that image on the server. Stock CS 4.0
had no colony Update page and `community.exe` carries no wizard dispatch at all.

No structural endpoint exists in CTR, so there is nothing to gate and **no
technical-role check was invented**. `Founder` and `Com tech` exist as role rows
and remain unreferenced by any service. No role — Administrator included — is
offered a structural map control, and the hub says so in the UI.

### 8.6 Other deferred items

| Item | Where recorded |
|---|---|
| Job-wide `WRO` chat grants; Chat **Read** Access | followups §2 |
| Home "my links" block (`LL0`–`LL4` / `LD0`–`LD4`) | followups §3 |
| Shops and clubs for place information | followups §3, evidence §4.5 |
| A public-place Update hub | matrix §6.3 — not needed for information; only if public places later gain wizard-style tools |

---

## 9. The intended next lane is **bug-fixing only**

After Ryan's manual testing, the follow-up lane fixes defects he finds. Scope,
deliberately narrow:

- UI placement and wording;
- navigation, and Back / Cancel behavior;
- stale component state;
- permission visibility;
- layout;
- fidelity differences found during manual testing.

**None of these has been preemptively fixed, and none should be.** Wait for
Ryan's list. Do not widen the lane into features, and do not fold §8.2 or §8.3
into it — those are a security lane of their own.

---

## 10. Graphify — **pending, deliberately not run**

The existing graph lives in the **main checkout**
(`~/Projects/cybertown/ctr/graphify-out`, built 2026-07-09) and covers that checkout, not
this branch. Updating it in place would touch the main checkout, which this session was
told not to do. Running it scoped to the worktree instead would work —
`/graphify <path>` accepts a path — but it writes `<path>/graphify-out`, which would
create an untracked directory inside the worktree and break the clean state recorded in
§1.

So it is **recorded as pending**, not done. If it is wanted later, either accept the
untracked output directory or add it to `.git/info/exclude` first:

```bash
echo 'graphify-out/' >> ~/Projects/cybertown/.worktrees/ctr/classic-place-admin-fidelity/.git/info/exclude
/graphify ~/Projects/cybertown/.worktrees/ctr/classic-place-admin-fidelity
```

Do not run it against `~/Projects/cybertown/ctr` to "refresh" it — that is the main
checkout and is out of this lane's scope.

---

## 11. Push recommendation

**Recommended: yes, push to `origin` (`DJAscendance/ctr`) for safekeeping — but
only with Ryan's explicit approval, which has not been given.**

23 commits of traced research and implementation exist in exactly one place: a
local worktree. A single `rm -rf` or disk failure loses the RE trace as well as
the code, and the trace is the expensive part.

Push the **feature branch only**, explicitly, never a bare `git push`:

```bash
git push origin fix/classic-place-admin-fidelity:fix/classic-place-admin-fidelity
```

**Never push or modify `beta`.** No upstream PR to `CybertownRevival/ctr`, no
merge, no deploy.
