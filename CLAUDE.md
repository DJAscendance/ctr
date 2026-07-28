# ctr — agent notes

> ## ⏳ TEMPORARY — active lane marker
>
> **Remove this whole block (and this file, if nothing else has been added to it)
> once `fix/classic-place-admin-fidelity` is merged.** It exists only so a fresh
> session knows what is already finished and does not redo or reopen it.

## Active lane: `fix/classic-place-admin-fidelity`

Branched from `origin/beta` @ `76cb514`. Worktree:
`~/Projects/cybertown/.worktrees/ctr/classic-place-admin-fidelity`.
**Not deployed.** Awaiting Ryan's manual testing.

### Read these first

| Document | What it is |
|---|---|
| [**`docs/handoff/classic-place-admin-fidelity.md`**](docs/handoff/classic-place-admin-fidelity.md) | **Start here.** Git state, what shipped, what the manual review corrected, current test results, the preview stack, QA accounts, every unresolved item, and the scope of the next lane. |
| [`docs/research/classic-place-admin-re-evidence.md`](docs/research/classic-place-admin-re-evidence.md) | The approved reverse-engineering evidence report. CS 4.0 / 5.1 / 7.0 traced against the Wayback scrape. **This is the behavioral specification** for the features below — do not re-derive it. |
| [`docs/research/classic-place-admin-followups.md`](docs/research/classic-place-admin-followups.md) | Deferred work, with the same evidence standard. Read before proposing anything in this area. **§1b is retracted** — see the matrix below. |
| [`docs/research/classic-update-hierarchy-matrix.md`](docs/research/classic-update-hierarchy-matrix.md) | The Colony → Neighborhood → Block Update hierarchy trace, the placement table, the full permission matrix, and the CTR authorization audit. Corrects the follow-ups doc's colony-wizard claim. |
| [`docs/research/classic-chat-moderation-trace.md`](docs/research/classic-chat-moderation-trace.md) | The chat-moderation trace. Two separate historical features, **neither at colony or neighborhood tier**, and why implementation is blocked on a product decision. |
| `~/Projects/cybertown/.qa/ctr/classic-place-admin-fidelity/` | Review guide, screenshots, preview server and capture scripts (not in git). |

The single most load-bearing finding: **Cybertown ran the CS 4.0-lineage web/CGI
layer, not 5.1/7.0.** CS 4.0 is the specification; 5.1 and 7.0 are counter-examples
where these mechanisms were removed or consolidated.

### Finished — do not reopen without a proven defect

23 commits (`git log origin/beta..HEAD`); the highlights:

1. **`3c6bbf5` shared block lot-map renderer.** `spa/src/components/block/BlockLotMap.vue`
   + `spa/src/helpers/block-map.helper.ts`. The 480×240 / 12×6 / 40px geometry is the
   original Cybertown lot coordinate system, confirmed against archived production art —
   **it is not styling, do not "tidy" those constants.** Consumers supply cell markup
   through a scoped slot. Any new lot surface must use this component.
2. **`08d12e2` candidate background behind the live lot overlay.** An *intentional
   enhancement* over the original blind thumbnail picker, labelled as such in the code.
   PR #411's `can_admin` gate, server-side mutation check and Restore Default are
   untouched. Preview is local-only; the single mutating request is reachable solely
   from Apply and Restore Default.
3. **`f17f97f` classic Home Chat Access presentation.** Presentation only — the backend
   representation, authorization and Socket.IO enforcement are untouched and were
   confirmed correct by the RE evidence.
4. **`7a59c9f` staff-managed Place Information.** Reuses `place.description` (MySQL TEXT,
   no migration). Supported: `block`, `hood`, `colony`, `public` (incl. Mall). Type is
   read from the stored row, so a client cannot steer which scoped check runs.
5. **`2c6c179`** the follow-ups doc above.
6. **`15ef35c`** the Update-hierarchy trace and permission matrix. Retracts the
   follow-ups doc's colony-wizard claim.
7. **Scoped place Update hubs.** `GET /place/:placeId/update-hub` +
   `PlaceUpdateHubService` decide capabilities server-side from the **stored** place
   row; `spa/src/helpers/place-update-hub.helper.ts` holds the tool list as data and
   `PlaceUpdateHub.vue` renders all three tiers. Inventory and rationale: matrix §6.
8. **`dfbe2b3` the classic MANAGE button** on every staff-managed Information window,
   in the Inbox / Message Board treatment, opening the existing editor.

**Placement is not authorization — the review found this the hard way.** The hubs
carry only the Update Wizard's own screens: Colony = Information; Neighborhood =
Information + Map Background; Block = Information + Lot Availability + Map Background,
matching CS 4.0's `wizardinfo` / `wizardpresent` / `wizardimage`. **Message to All,
Inbox to All, Access Rights and Check stay on the permanent tool bar** where they have
always been; message-board and inbox moderation stay in their own windows. An earlier
iteration moved the bar buttons into the hub — that was wrong, is reverted, and is now
asserted against. Placement table: matrix §6.3.

**Four things that look like omissions but are decisions:** no colony structural-map
capability *for anyone including Admin* (the original's map was hard-coded template
geometry); no block create/remove capability (deferred, permission table decided in
matrix §6.4); no Chat Access tile outside homes; and **no Chat Moderation tile
anywhere** — see `docs/research/classic-chat-moderation-trace.md`. Tests assert each
absence, so adding one fails rather than ships.

**Sanitizer:** the allowlist previously duplicated in `MessageboardService` and
`InboxService` now lives once in `api/src/libs/sanitize-user-html.ts`, unchanged.
**Do not widen it.** Sanitize on write; never at render time.

**Two Information trust models, deliberately separate — do not merge them:**
a *home* description is citizen-typed and renders through escaping text interpolation
(`spa/src/pages/Information.vue`, guarded by `spa/tests/information-render.test.ts`);
a *place* description is staff-written, server-sanitized, and renders as HTML in
`spa/src/components/place/PlaceInformation.vue`.

### Deliberately deferred — recorded, not forgotten

See the follow-ups doc for evidence and the handoff §8 for the full list. In short:
**block creation / withdrawal** (permissions already decided); **chat access for
non-home places** (colony and neighborhood only — you cannot chat in a block);
**place-tier chat moderation** (blocked on a product decision, trace complete);
**job-wide `WRO` chat grants**; **Chat Read Access**. Also unsupported by design: place
information for shops, clubs, homes and storage.

**Two security items are recorded and deliberately untouched**, for a lane of their own:
`spa/server.js:345-349` rebroadcasts a `moderation` socket event with no authentication,
and `ColonyService.canAdmin` admits an unscoped `ColonyRepresentative` role that does not
exist today — **do not seed a role with that name.** Handoff §8.2, §8.3.

**Corrected 2026-07-27 —** the follow-ups doc previously claimed a *colony* wizard existed
because `community.exe` carries `ccgi_home_wizard*` symbols. It does not: those symbols are
a shared linked module present identically in `property.exe`, which has no wizard. Stock
CS 4.0 has no colony Update button, no colony wizard dispatch and no colony wizard
templates; colony neighborhood placement was hand-authored `<AREA>` coordinates in
`community/present.tmpl`. Full trace in
[`docs/research/classic-update-hierarchy-matrix.md`](docs/research/classic-update-hierarchy-matrix.md).
**Colony structural editing is intentionally unavailable, not deferred.**

### Verification state (at `dfbe2b3`)

- SPA `npm test`: **149/149** across 9 suites.
- API `NODE_ENV=development npx jest`: **303 passed, 5 failed** — those 5 across 4 suites
  (`wallet`, `role.repository`, `member.service`, `club.service`) are **identical to the
  `origin/beta` baseline**, not caused by this lane: three fail "Your test suite must
  contain at least one test", one with `ECONNREFUSED 127.0.0.1:3306`. All four spec files
  and their subject modules are byte-identical to beta. Start MySQL, or diff against beta,
  before blaming a change.
- Lint: use `--no-fix`. Zero errors in new files; every touched file at or below the beta
  baseline. **`BlockTools.vue` and `NeighborhoodTools.vue` are tab-indented and the config
  sets `no-tabs: error`** — write new lines with spaces or you will add errors back.
  Never run an autofixing lint command; check `git status` immediately after.
- API `npx tsc --noEmit` clean; SPA production build succeeds (Node 14).

### Local preview (Node 14 for the SPA, Node 20 for the API)

`fibers` will not build on Node 20+; `nvm use 14` before `npm test`/`build` in `spa/`.
Dependencies were borrowed by symlinking `node_modules` from an existing checkout, which
is why stack traces mention `../../beta-home-reconciliation/api/…`.

**A throwaway preview stack was left running** — site 8088, API 3001, socket 8000, and the
isolated `ctr-classicadmin-mysql` container on 13308. Health checks, restart commands, QA
accounts and known quirks are in
[`docs/handoff/classic-place-admin-fidelity.md`](docs/handoff/classic-place-admin-fidelity.md)
§5. It is not connected to beta or production. The existing `ctr-clone-mysql` /
`ctr-recon-mysql` containers belong to other lanes; dump from them, never mutate them.
