# Handoff — `fix/classic-place-admin-cleanup`

Written 2026-07-27. **Nothing is merged, pushed, deployed or PR'd.** This branch is
local only and waiting on Ryan's review.

This lane fixed the seven defect groups Ryan found while manually testing
`fix/classic-place-admin-fidelity`. It is a bug-fix and polish lane: no features
were added, and every item the fidelity handoff deferred is still deferred.

---

## 1. Git state

| | |
|---|---|
| Branch | `fix/classic-place-admin-cleanup` |
| Branched from | `fix/classic-place-admin-fidelity` @ `0d9d33a` — **not** from beta |
| Worktree | `~/Projects/cybertown/.worktrees/ctr/classic-place-admin-cleanup` |
| Upstream | **none, deliberately.** Do not set it to `origin/beta` |
| `origin/beta` | `76cb514` — unchanged, still an ancestor |

The parent branch was pushed for safekeeping before this lane started, and its
upstream was corrected away from beta:

```
origin/fix/classic-place-admin-fidelity  0d9d33a
```

`fix/classic-place-admin-fidelity` is unchanged by this lane — same SHA locally
and on origin, worktree still clean.

### ⚠ Never a bare `git push`

This branch has no upstream, so a bare push is an error rather than a beta push —
but the parent branch's tracking was the hazard, and the rule stands. If Ryan
authorizes pushing:

```bash
git push origin fix/classic-place-admin-cleanup:fix/classic-place-admin-cleanup
```

---

## 2. Commits

```
6bd2762  fix: center classic information controls and refresh them on route change
dbf3d7e  fix: restore compact neighborhood background preview controls
80f85d2  fix: normalize update and cancel button ordering
5176a22  fix: show selected home image filenames
0c42172  fix: make block image check navigation consistent
e250988  fix: restore classic home information and image spacing
e7974f9  test: cover classic admin cleanup regressions
07eea8e  fix: let the information window fill the page it is centered in
1adf125  fix: size the home image column to include its own padding
c400474  test: follow the home image column to its padded width
4419e7e  docs: record cleanup findings and deferred lanes
0979983  fix: restore the pre-image Home information proportions exactly
ac3e250  fix: keep the classic buttons static under the pointer
ae32250  test: pin the restored proportions and the static button look
```

```
0979983  fix: restore the pre-image Home information proportions exactly
ac3e250  fix: keep the classic buttons static under the pointer
ae32250  test: pin the restored proportions and the static button look
e1721a8  docs: record the two review corrections
33c4351  fix: send Message to All and Inbox to All Cancel to a named parent route
9f663d4  fix: stop claiming a neighborhood is empty when its blocks failed to load
4ad39c1  fix: make only real controls look clickable
e24ef49  test: prove Cancel navigates, and stop a missing button passing vacuously
```

`07eea8e`-`c400474` are corrections found while capturing the QA screenshots.
`0979983`-`e1721a8` are **Ryan's review corrections** (§3.6, §3.7). The last four
answer the **independent Gemini + CodeRabbit review** (§4).

---

## 3. Each defect, and what actually caused it

### 3.1 Information window centering

**Not a missing `text-center`.** The Manage button and heading were already in a
centered block; the page was a **flex column**, and a flex column shrink-wraps its
items to the widest child. Worse, the component's *root* is an unclassed wrapper
holding the home/place `v-if` pair, and that wrapper is the flex item the router
drops into the page's flex row — so it took its width from its content (477px of
the widest information line inside an 1100px window) and every `w-full` beneath it
resolved against that.

Two changes: `w-full` on the root, and block flow instead of a flex column for the
place branch. Measured before/after: heading box 457px @ x=10 → 1080px @ x=10
inside 1100px.

The manager-authored HTML stays **outside** the centered section, so a place keeps
whatever alignment its author gave it. `center` is in the shared allowlist, so an
author who wants centered text can still say so. The place name is display-only —
the editor behind MANAGE writes `place.description` and nothing else.

### 3.2 Stale Information on route change

The window is a popup that reuses **one component instance** for every
`#/information/<type>/<id>/<slug>` target, and only `mounted()` loaded anything.

Fixed with a `$route` watcher — the smallest mechanism that catches a change of
`type` alone (hood → block) or of `slug` alone, which a single-param watcher would
miss. `reload()` clears every rendered field **synchronously, before** the requests
start, so nothing from the previous place — including its Manage capability —
survives even momentarily.

Rapid A → B → C is handled with a monotonic load token; all six response handlers
discard themselves when superseded. Also replaced the per-index `deputies` write,
which is not reactive in Vue 2 and left the previous place's extra deputies behind.

### 3.3 Neighborhood background editor

Three separate problems:

- **No preview content at all.** `showsLotOverlay` was `placeType === 'block'`, so a
  neighborhood fell through to a bare `<img>`. Extracted `HoodBlockMap` (the
  neighborhood counterpart of `BlockLotMap`) and rendered the candidate behind the
  real map. `NeighborhoodMapPage` now uses the same component, so the preview and
  the live map cannot disagree. Verified on hood 891: all 10 blocks, their names
  and their mini-city icons, over the candidate.
- **The 27-image wall.** A `flex-wrap` grid rendered every option. Replaced with one
  `flex-nowrap` row of five plus explicit ‹ / › paging and a "Showing 1-5 of 27"
  count; the strip opens on the page holding the current selection.
- **Button order and Cancel.** Was `Apply · Cancel · Restore Default`, and Cancel
  reverted the preview in place. Now `Apply · Restore Default · Cancel`, in the DOM
  as well as on screen, and Cancel navigates to the Update hub. Verified: Cancel
  from `#/neighborhood/891/background` lands on `#/neighborhood/891/update`.

Both background editors also got `p-2`; these wizard pages have no wrapper padding
of their own.

### 3.4 Button-order audit

Audited all twelve surfaces named in the brief. **Only Message to All and Inbox to
All were wrong** — both drew CANCEL before POST. Everything else already put its
primary action first.

Fixed in the DOM, not with CSS, so visual order, DOM order and keyboard order
agree. Cancel is now `type="button"` on both (it previously inherited the default
submit type). Their Cancel handler pushes the route's own path, which resolves back
to the place view; vue-router rejects a navigation to the route you are already on,
so that rejection is swallowed rather than surfacing as an unhandled rejection.

> **Left for Ryan to confirm:** the labels stay **POST**, not "Update". The brief's
> screenshot list writes these two as `Update · Cancel`, but POST is what the
> buttons do and renaming a posting action to match a convention about *order*
> would be a wording regression. Say the word and it is a one-line change.

### 3.5 Home-image selected filename

**Presentation, not PR #410 state logic** — the stop condition did not trigger.
`setFile()` blanked `e.target.value` on every selection so re-picking the *same*
file would still fire `change`. The `File` was captured correctly and the upload
always worked; only the widget's own label was cleared, so the page said "No file
chosen" right up to a successful upload.

The reset is only needed where `imageFile` is dropped while the input still holds
it — after an upload or a removal — so it moved into `clearSelection()`. The chosen
name is also confirmed back in the green the page already uses. `File.name` is the
base name, so no local path is exposed, and a fresh choice clears the previous
outcome so an old error cannot sit beside an unsent file.

Every PR #410 invariant is untouched: no request on selection, pending files stay
private, revision-specific storage, stale-moderation refusal, replacement and
withdrawal all unchanged.

### 3.6 Block CHECK button

It was a bare `<span>` with a click handler, so it had no pointer cursor, no hover
response, no tab stop, no focus ring and nothing for a screen reader — and it
opened a detached popup window.

Now a `router-link` like every other bar destination, pointing at a new
`blockImageCheck` **child route of `/block/:id`** that reuses `HomeImageCheckPage`
unchanged. Only the frame differs: same component, same queue endpoint, same
approve and reject calls. The standalone `/home/image-check` route stays for its
own callers.

**No authorization was bypassed.** The queue and both moderation actions are
authorized server-side on every request, so reaching the route grants nothing — an
unauthorized member who types the URL still gets an empty queue and a refusal.
Check Images also stays a permanent tool bar action rather than migrating into the
Update hub.

`.btn-ui` gained `cursor: pointer` and a `:focus-visible` ring — and nothing else.

**Corrected after review:** the first pass also added a hover fill and border
change, which was invented rather than restored. The classic Cybertown buttons are
static under the pointer, and that highlight applied to every control sharing the
class. It is gone, along with the bare `:focus` rule, which fired on mouse clicks
too — hover restyling by another name. Only `:focus-visible` remains, so the ring
appears when a keyboard user tabs to a control and not when a mouse user clicks
one; engines without support skip it and keep their own default ring.

Measured after: CHECK's hover background and border are **identical to its resting
state** (`#001829` / `#8f9bb6`), the ring matches only `:focus-visible`, and Enter
still opens the queue inside the Block content frame.

### 3.7 Home page owner information and image spacing

**Caused by the home-image work, not by this lane's parent** — `main2d.vue` is
byte-identical between `origin/beta` and the fidelity branch. Tracing it back:

```
0c6db9e (pre-image)   →  HEAD
  <div class="flex flex-auto w-2/3">  →  <div class="flex flex-auto">
  <table class="w-full">              →  <table>
  <td class="w-130 …">                →  <td class="w-36 pr-4 …">
```

The table then shrink-wrapped, collapsing the label and value columns to ~120px
apart. Live CTR (`cybertownrevival.com/#/home/BassMekanik`, Ryan's reference
screenshot) still spreads them across two thirds of the page — labels at x≈25,
values at x≈325.

Restored `w-2/3` and `w-full` and dropped the fixed label width, so the automatic
table layout distributes the spare width again. Added cell padding, gave the image
column clearance, and put a gap back before Object Storage Areas.

**Corrected after review — the first pass overshot.** Restoring the containers
fixed the collapse but put the value column at ~33% of the content width where
live has it at ~20%. The cause was the cell padding that had been added alongside:
this table uses **automatic layout**, which distributes spare width between columns
in proportion to their content widths, so `pr-8` on the labels was not a 32px
gutter — it was 32px of extra content width that the distribution then amplified.
`whitespace-nowrap` and `align-top` compounded it.

The first two columns are now `0c6db9e` verbatim: `flex flex-auto w-2/3`, a
`w-full` table, `w-130` on the first label cell, plain `font-bold text-left` /
`text-left` elsewhere, and **no cell padding of any kind**. Object Storage Areas
lost its added `mt-4` wrapper for the same reason — live's gap there is the
section's own.

The image sits in the remaining third rather than beside the table as a fixed
232px sibling. A fixed pixel column takes its width out of the row *before* the
information column is sized, so its value silently decides the table width and
therefore the column proportions; `w-1/3` — the complement of `w-2/3` — keeps the
information column the same two thirds it was before the image feature existed, at
any window width.

Measured at a 1536px content width against the live reference (1529px):

| | cleanup | live |
|---|---|---|
| label column x | 10 | 10 |
| value column x | 374 | 306 |
| information column | 1024 (exactly 2/3) | — |
| image region | 512 (exactly 1/3) | — |
| image centre | 83.3% | ~82.7% |

Verified across **approved, narrower-approved, pending and no-image**: all four
hold identical 1024/512 column widths, so the information layout no longer depends
on whether a home has an image. Long values cannot collide with the image at any
length — they are bounded by the information column and flex siblings do not
overlap (widest value ends at 1033, image starts at 1239).

Narrowly scoped — the 200×200 image bound, the approved/pending/absent states and
the fixed-width layout are unchanged. **Nothing here makes the page responsive.**

> **One residual difference, not from this lane.** Rows sit ~30px apart in the
> preview against ~20px on live. Ryan's own before-state screenshot of the fidelity
> preview shows ~28.5px with identical fonts (label text 68px vs live's 67px), so
> it is a global stylesheet difference between this build and what production
> serves, present before any change here. Correcting it in `main2d.vue` would mean
> inventing a line-height override — the very thing this correction removed.

---

## 4. Independent review corrections (Gemini + CodeRabbit)

### 4.1 Cancel on Message to All / Inbox to All — fixed, but not for the stated reason

**The reported mechanism does not reproduce.** The review said vue-router aborts
the Cancel push as a duplicate navigation, leaving the citizen on the form.
Verified in the running preview against the **pre-fix** bundle, reading
`$route.name` directly either side of the click:

```
colonyInboxToAll  --CANCEL-->  world-browser
```

It navigated. On vue-router 3.5.2 the `.catch(() => undefined)` never fired.

**The real defect is ordering fragility.** Each form is a named child with an
empty path, so its URL is identical to its parent place view's, and `{ path }`
cannot say which of the two it means — vue-router returns the *first* empty-path
child declared. The place view is declared first at all three tiers, so Cancel
worked by declaration order rather than by intent. A behavioral test now proves
that reordering those siblings makes the same push resolve back to the form,
where Cancel silently does nothing.

Fixed by naming the destination (`helpers/place-form-return.helper.ts`):

| Form route | Parent place view |
|---|---|
| `colonyMessageToAll`, `colonyInboxToAll` | `world-browser` |
| `neighborhoodMessageToAll`, `neighborhoodInboxToAll` | `neighborhoodpage` |
| `blockMessageToAll`, `blockInboxToAll` | `blockmap` |

Keyed on route name, not the store's place type, so it resolves before any data
loads — Cancel works on a form entered directly with no history. Params carry
over, so it returns to *that* place. Unmapped forms fall back to The Plaza. It
pushes rather than replaces, so browser Back still works. The `.catch` is gone.

Verified live, all six combinations, each with the leader who actually holds the
capability:

```
[colony] Message to All: colonyMessageToAll        --CANCEL--> world-browser
[colony] Inbox to All:   colonyInboxToAll          --CANCEL--> world-browser
[hood]   Message to All: neighborhoodMessageToAll  --CANCEL--> neighborhoodpage
[hood]   Inbox to All:   neighborhoodInboxToAll    --CANCEL--> neighborhoodpage
[block]  Message to All: blockMessageToAll         --CANCEL--> blockmap
[block]  Inbox to All:   blockInboxToAll           --CANCEL--> blockmap
```

POST labels unchanged; `POST · CANCEL` order unchanged.

### 4.2 Contradictory neighborhood overlay output — fixed

A failed overlay fetch rendered the error *and* "This neighborhood has no blocks
on its map yet." The summary came from `blocks.length === 0`, which cannot
separate "loaded and empty" from "not loaded" or "failed".

`overlayLoaded` is now set only inside the success path, and `overlayReady`
(loaded **and** no error) gates both summaries. A retry clears both flags before
starting; each failure path clears its rows so a stale overlay is not left
looking current. Applied to the block occupancy summary too, which had the same
defect. Verified live by forcing the blocks request to 404:

| State | Error | Empty claim | Summary |
|---|---|---|---|
| success, 10 blocks | — | — | shown |
| forced failure | shown | **gone** | — |
| retry after failure | — | — | shown, 10 blocks redrawn |

### 4.3 Pointer/focus scoped to interactive controls — fixed

`cursor: pointer` was on `.btn-ui` itself, but that class is the button *look*,
worn by two inert placeholders:

| File | Element |
|---|---|
| `pages/neighborhood/NeighborhoodTools.vue` | `<span href="" class="btn-ui">Vote</span>` |
| `pages/world-browser/WorldBrowserTools.vue` | `<span v-else-if="type !== 'colony'" class="btn-ui">Update</span>` |

Pointer and the focus ring now apply to `a.btn-ui`, `button.btn-ui` and
`.btn-ui[role="button"]` only; disabled buttons get the default cursor.

**Neither span needed converting.** A sweep of every `.btn-ui` occurrence found
no span or div anywhere carrying a click handler, and no `role="button"` in the
codebase — both are genuinely inert. A test now fails if an interactive
`.btn-ui` span ever appears, so the fix then is real markup, not a widened
selector.

Verified live: the Vote span reads `cursor: auto`; its neighbouring buttons and
links read `pointer`; CHECK keeps `pointer`, hover identical to resting
(`#001829` / `#8f9bb6`), and Enter still opens the queue in the Block frame.

### 4.4 Vacuous label-order test — fixed

`withLabel()` returned `""` for a missing control and `indexOf("")` is 0, so a
form that had lost its primary button still satisfied `primaryAt < cancelAt`.
It is now `buttonPosition()`, which throws when its control is absent; the two
positions are asserted distinct so one control cannot satisfy both lookups; and
a negative test feeds it a fixture with no primary button and requires a throw.

The Cancel source-string assertion — which is how a navigation claim survived
review in the first place — is replaced by the behavioral router suite in §4.1.

### 4.5 Apply / Restore Default persistence — verified

Against the isolated cleanup database only (`ctr-classicadmin-cleanup-mysql`,
13309). Beta, production and the frozen fidelity database were not touched.

| Step | Neighborhood 891 | Block 892 |
|---|---|---|
| original | `NULL` | `NULL` |
| candidate selected, **no Apply** | `NULL` | `NULL` |
| **Apply** | `3` | `2` |
| reload the editor | `3`, radio 3 checked | — |
| **Restore Default** | `NULL` | `NULL` |

All 907 `place.map_background_index` rows were snapshotted before and after: the
files are **identical**, so nothing else changed and both places are back to
their original values.

### 4.6 Preview stacks

Both were already up and healthy — the unavailability was environmental, not a
source finding:

```
cleanup   site 8089 200 | api 3002 401 (alive) | socket 8001 200 | db 13309 alive
fidelity  site 8088 200 | api 3001 401 (alive) | socket 8000 200 | db 13308 alive
```

No `cybertown.dev` or `cybertown.com` host appears in any of the four `.env`
files. The frozen fidelity database was not mutated.

---

## 4. Neighborhood chooser — historical evidence

**Proven:**

- `blaxxun-cs-RE/install-4.0/csbin/community/templates/neighbor/wizard/image.tmpl`
  and its `block/` sibling emit **one radio plus one thumbnail per `<br>`** — a
  single-file list, one candidate per line. Thumbnails are `180x100` (hood) and
  `160x80` (block). Buttons are `Ok` then `Cancel`.
- The shipped assets confirm the scale of the problem: the **grass** theme carries
  **27** hood backgrounds (`Pimg2D*.gif`, 540x300); cyberhood 1, desert 3.
- At one 100px-tall row per candidate, 27 candidates is a ~2700px column inside a
  620x450 popup — i.e. **a strip you scroll**, which matches Ryan's recollection of
  a single bar navigated left/right or by scrollbar.

**Not proven — no evidence survives:**

- Cybertown's *own* chooser page was never archived. `wb-ct-scrape` contains
  `block/ac=wizardinfo`, `ac=wizardplace` and `ac=wizardpresent` captures, but
  **every one is a logged-out "Visitor" login page**, and there is no
  `ac=wizardimage` capture at all. Nothing anywhere in `html/` contains
  `name="IM2"`, `wizardimagesubmit` or the chooser markup.
- So whether Cybertown customized the stock template — and whether it used arrows,
  a scrollbar or something else — cannot be established from the corpus.

**Therefore:** one row is the restoration (from the stock template's one-per-line
topology); the explicit ‹ / › paging and the "Showing N-M of T" counter are the
**practical reconstruction** of scrolling that list, chosen as the smallest compact
behavior that satisfies the brief. This does not conflict with Ryan's recollection —
it implements it — so the stop condition did not trigger.

---

## 5. Sanitizer verification

One shared implementation, `api/src/libs/sanitize-user-html.ts`, already used by all
three consumers before this lane. Verified and now pinned by
`api/src/libs/sanitize-user-html-consumers.spec.ts`:

- `MessageboardService`, `InboxService` and `PlaceInformationService` produce
  **byte-identical** output for one representative input covering allowed formatting
  plus `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, event attributes,
  `javascript:` and `data:` URLs, and a stray `class`.
- `PlaceInformationService` is driven through `updateInformation`, so what is
  asserted is the value that reaches the database.
- The suite **fails if a second `allowedTags` appears anywhere in `api/src`**, or if
  any consumer imports `sanitize-html` directly.
- **The allowlist was not widened.** It is untouched by this lane.

---

## 6. Test results

| Check | Result | Baseline |
|---|---|---|
| SPA `npm test` (Node 14) | **194/194**, 11 suites | was 149/149, 9 suites |
| API `NODE_ENV=development npx jest` (Node 20) | **307 passed, 5 failed / 31 suites** | was 303 passed, 5 failed / 30 |
| API `npx tsc --noEmit` | clean | clean |
| SPA production build (Node 14) | succeeds | succeeds |
| `git diff --check` | clean | — |
| `node --check` on changed root JS | clean (`spa/tests/run-all.js`) | — |

**The 5 API failures are the known beta baseline** — the same 5 in the same 4 suites
(`wallet`, `role.repository`, `member.service`, `club.service`), and all four spec
files are byte-identical to `origin/beta` (`git diff origin/beta` is empty for them).
Three fail *"Your test suite must contain at least one test"*; one needs MySQL on
3306.

ESLint `--no-fix`, per touched file, versus the fidelity branch:
`BlockTools.vue` 14→14, `routes.ts` 5→5, `main2d.vue` 5→5,
`NeighborhoodMapPage.vue` 45→**36**, every new file **0**. `git status` checked
immediately after every lint run; nothing was autofixed.

> `BlockTools.vue` and `NeighborhoodMapPage.vue` are **tab-indented** and the config
> sets `no-tabs: error`. Write new lines with spaces. Never run the autofixing lint
> script.

---

## 7. Cleanup preview stack

Separate from the fidelity preview, which is **left running on 8088 as the frozen
before-state**.

| Piece | Where |
|---|---|
| Site | <http://127.0.0.1:8089> |
| API | 127.0.0.1:3002 |
| Socket | 127.0.0.1:8001 |
| Database | Docker `ctr-classicadmin-cleanup-mysql`, host port **13309** |

Seeded from a `mysqldump` of `ctr-classicadmin-mysql` (a read-only operation on it);
907 places, 12 QA accounts. **Not connected to beta or production** — no
`cybertown.dev` or `cybertown.com` host appears in either `.env`.

> `ctr-classicadmin-mysql` (13308), `ctr-clone-mysql` (13307) and `ctr-recon-mysql`
> (13306) belong to other lanes and were **not mutated**.

### Health check

```bash
curl -s -o /dev/null -w 'site %{http_code}\n' http://127.0.0.1:8089/
curl -s -o /dev/null -w 'api  %{http_code}\n' http://127.0.0.1:3002/api/place/892/update-hub   # 401 = alive
curl -s -o /dev/null -w 'sock %{http_code}\n' 'http://127.0.0.1:8001/socket.io/?EIO=4&transport=polling'
docker ps --filter name=ctr-classicadmin-cleanup-mysql
```

Expect `200 / 401 / 200` and the container up.

### Start / rebuild / reset

```bash
C=~/Projects/cybertown/.worktrees/ctr/classic-place-admin-cleanup
QA=~/Projects/cybertown/.qa/ctr/classic-place-admin-cleanup

cd "$C/api" && nvm use 20 && node -r ts-node/register -r dotenv/config src/api.ts
cd "$C/spa" && nvm use 14 && node -r dotenv/config server.js
node "$QA/preview-server.js"

# after changing SPA source, rebuild before screenshotting
cd "$C/spa" && nvm use 14 && npm run build

# reset the database from the seed taken at the start of this lane
docker exec -i ctr-classicadmin-cleanup-mysql mysql -uroot -ppw < "$QA/fidelity-seed.sql"
```

Shutdown: `kill` the three node PIDs and
`docker stop ctr-classicadmin-cleanup-mysql`.

### Preview quirks worth knowing

- **Node 14 for the SPA, Node 20 for the API.** `nvm use 14` also breaks
  `playwright-cli` (it needs a modern Node) — run captures in a shell that has not
  switched.
- The browser caches the bundle hard. After a rebuild, a plain `goto` to a hash
  route will **not** pick up new code — force `location.reload(true)` first. Two
  screenshots in this lane were silently stale before that was noticed.
- `spa/assets/homes-uploads/857.webp` was copied in from the fidelity worktree so the
  approved-image screenshots render. It is gitignored.
- **One deliberate QA mutation:** `BassMekanik`'s password hash in the *cleanup*
  container only was replaced with the shared QA hash, so the home-page screenshots
  could be taken as the home's owner. The fidelity container's copy is untouched and
  was verified so.

---

## 8. Screenshots

`~/Projects/cybertown/.qa/ctr/classic-place-admin-cleanup/shots/` — not in git.

| # | File | Shows |
|---|---|---|
| 1 | `01-information-centered-manage-heading.png` | MANAGE and heading centered on the page |
| 2 | `02-information-custom-html-left-aligned.png` | custom HTML left-aligned outside the centered section |
| 3 | `03-information-route-changed-directly.png` | block 893 → hood 891 with no remount; no stale content |
| 4 | `04-hood-background-preview-blocks-names-icons.png` | 10 blocks, names and mini-city icons over the candidate |
| 5 | `05-background-selector-paged-strip.png` | one row, paged |
| 6 | `06-buttons-apply-restore-cancel.png` | `Apply · Restore Default · Cancel`, candidate previewed 11-15 of 27 |
| 7 | `07-cancel-returned-to-update-hub.png` | Cancel landed on `#/neighborhood/891/update` |
| 8 | `08-home-image-selected-filename-green.png` | "Selected: my-new-home-picture.webp" in green |
| 9 | `09-check-button-hover-focus.png` | CHECK hover and focus |
| 10 | `10-image-check-in-block-content-area.png` | image check inside the block frame, tool bar intact |
| 0 | `00-live-ctr-reference.png` | **Ryan's live CTR reference** — the visual authority for the Home layout |
| 11 | `11-home-approved-image-padding.png` | approved image, restored proportions |
| 12 | `12-home-no-image-padding.png` | no-image state, same column widths |
| 16 | `16-home-narrow-image.png` | narrower approved image |
| 17 | `17-home-pending-and-long-name.png` | pending placeholder with a long home name |
| 13-15 | `13-message-to-all-buttons.png`, `14-…`, `15-…` | primary-before-Cancel on the three audited forms |

---

## 9. Deferred — unchanged, still open

Everything in the fidelity handoff §8 remains deferred and untouched:

- **§8.1** place-tier chat moderation — blocked on a product decision;
- **§8.2** `spa/server.js:345-349` unauthenticated moderation rebroadcast — security lane;
- **§8.3** `ColonyRepresentative` dormant unscoped authorization — same security lane;
- **§8.4** block creation / withdrawal — permissions decided, not built;
- **§8.5** colony structural map editing — permanently unavailable, not deferred;
- **§8.6** job-wide `WRO` grants, Chat Read Access, home "my links", shops/clubs
  information, a public-place Update hub.

Also explicitly **not** touched by this lane, per the brief:
`spa/server.js` moderation rebroadcast, `ColonyRepresentative` authorization, and the
Message to All / Inbox to All cascade logic. Block name and mini-city icon editing
stays with the block create/edit/withdraw lane.

### Raised by this lane

1. **POST vs Update labels** on Message to All / Inbox to All — see §3.4.
2. **`w-130` is not a Tailwind class.** The pre-image `main2d.vue` carried it on the
   first label cell and there is no matching config entry, so it was always a no-op.
   Harmless, but it is not doing what its name suggests if anyone leans on it.

---

## 10. Recommendation

Review **`fix/classic-place-admin-fidelity` first**, then this branch on top of it —
this lane is a strict continuation and its diff only makes sense against that base.

Merge order: fidelity → cleanup → beta. They are a fast-forward chain; beta is still
a direct ancestor of both, so no rebase or merge commit is needed.

Nothing is pushed, merged or deployed. Ask before any of that.
