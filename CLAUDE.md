# ctr — agent notes

> ## ⏳ TEMPORARY — active lane marker
>
> **Remove this whole block (and this file, if nothing else has been added to it)
> once `fix/classic-place-admin-fidelity` is merged.** It exists only so a fresh
> session knows what is already finished and does not redo or reopen it.

## Active lane: `fix/classic-place-admin-fidelity`

Branched from `origin/beta` @ `76cb514`. Worktree:
`~/Projects/cybertown/.worktrees/ctr/classic-place-admin-fidelity`.
**Not deployed.** Awaiting Ryan's review.

### Read these first

| Document | What it is |
|---|---|
| [`docs/research/classic-place-admin-re-evidence.md`](docs/research/classic-place-admin-re-evidence.md) | The approved reverse-engineering evidence report. CS 4.0 / 5.1 / 7.0 traced against the Wayback scrape. **This is the behavioral specification** for the three features below — do not re-derive it. |
| [`docs/research/classic-place-admin-followups.md`](docs/research/classic-place-admin-followups.md) | Deferred work, with the same evidence standard. Read before proposing anything in this area. **§1b is retracted** — see the matrix below. |
| [`docs/research/classic-update-hierarchy-matrix.md`](docs/research/classic-update-hierarchy-matrix.md) | The Colony → Neighborhood → Block Update hierarchy trace, the full permission matrix, and the CTR authorization audit. Corrects the follow-ups doc's colony-wizard claim. |
| `~/Projects/cybertown/.qa/ctr/classic-place-admin-fidelity/` | Ten review screenshots (not in git). |

The single most load-bearing finding: **Cybertown ran the CS 4.0-lineage web/CGI
layer, not 5.1/7.0.** CS 4.0 is the specification; 5.1 and 7.0 are counter-examples
where these mechanisms were removed or consolidated.

### Finished — do not reopen without a proven defect

Five commits (`git log origin/beta..HEAD`):

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
   `PlaceUpdateHub.vue` renders all three tiers. **Colony/Neighborhood/Block tool bars
   now expose one Update entry each** — Message to All, Inbox to All and Access Rights
   moved inside the hub. Inventory and rationale: matrix §6.

**Three things in the hub that look like omissions but are decisions:** there is no
colony structural-map capability *for anyone including Admin* (the original's map was
hard-coded template geometry); there is no block create/remove capability (deferred,
with the permission table already decided in matrix §6.4); and there is no Chat Access
tile outside homes (no place-tier backend exists). Tests assert each absence, so
adding one fails rather than ships.

**Sanitizer:** the allowlist previously duplicated in `MessageboardService` and
`InboxService` now lives once in `api/src/libs/sanitize-user-html.ts`, unchanged.
**Do not widen it.** Sanitize on write; never at render time.

**Two Information trust models, deliberately separate — do not merge them:**
a *home* description is citizen-typed and renders through escaping text interpolation
(`spa/src/pages/Information.vue`, guarded by `spa/tests/information-render.test.ts`);
a *place* description is staff-written, server-sanitized, and renders as HTML in
`spa/src/components/place/PlaceInformation.vue`.

### Deliberately deferred — recorded, not forgotten

See the follow-ups doc for evidence. In short: the place **UPDATE button** was an
umbrella Update Wizard at the **neighborhood and block tiers only**; **chat access for
non-home places**; **job-wide `WRO` chat grants**; **Chat Read Access**. Also unsupported
by design: place information for shops, clubs, homes and storage.

**Corrected 2026-07-27 —** the follow-ups doc previously claimed a *colony* wizard existed
because `community.exe` carries `ccgi_home_wizard*` symbols. It does not: those symbols are
a shared linked module present identically in `property.exe`, which has no wizard. Stock
CS 4.0 has no colony Update button, no colony wizard dispatch and no colony wizard
templates; colony neighborhood placement was hand-authored `<AREA>` coordinates in
`community/present.tmpl`. Full trace in
[`docs/research/classic-update-hierarchy-matrix.md`](docs/research/classic-update-hierarchy-matrix.md).
**Colony structural editing is intentionally unavailable, not deferred.**

### Verification state

- SPA `npm test`: **123/123** across 9 suites.
- API `NODE_ENV=development npx jest`: **298 passed, 5 failed** — those 5 across 4 suites
  (`wallet`, `role.repository`, `member.service`, `club.service`) all fail with
  `ECONNREFUSED 127.0.0.1:3306` and are **identical to the `origin/beta` baseline**, not
  caused by this lane. Start MySQL, or re-check the baseline by stashing, before blaming
  a change.
- Lint: use `--no-fix`. Zero errors in new files; `BlockTools.vue` 27→14 and
  `NeighborhoodTools.vue` 20→15 as tab-indented blocks were replaced. **These two files
  are tab-indented and the config sets `no-tabs: error`** — write new lines with spaces
  or you will add errors back.
- SPA production build succeeds (Node 14).

### Local preview (Node 14 required)

`fibers` will not build on Node 20+; `nvm use 14` before `npm test`/`build` in `spa/`.
Dependencies were borrowed by symlinking `node_modules` from an existing checkout.
The screenshot stack was a throwaway isolated MySQL container plus the API on 3001,
`spa/server.js` on 8000 and a static/proxy server on 8088 — recreate rather than assume
it is still running. The existing `ctr-clone-mysql` / `ctr-recon-mysql` containers belong
to other lanes; dump from them, never mutate them.
