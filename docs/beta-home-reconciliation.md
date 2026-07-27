# Beta modern home-feature reconciliation

Lane: `fix/beta-modern-home-reconciliation`, branched from the verified `beta` head
`5d3e828582b2154190539edbd608584ac99c81f2`.

This is a **semantic reconciliation** lane. Fork PR #1 (`local-testing`, head
`4616466c95ce29f1d1cdc1f6895fa7177085d0f2`, merged to fork `master` as
`a1420a280cba878b66901c02b5183d525db06191`) is treated as a **behavioral specification**,
not as a patch. Its implementation predates the modern beta architecture and must not
overwrite it.

## Verified starting state (2026-07-27)

| Fact | Value |
|---|---|
| Local `beta` | `5d3e828` |
| `origin/beta` (DJAscendance) | `5d3e828` — identical, 0 ahead / 0 behind |
| Coolify app | `r11tggcohedq05k1hiofoitj` (project `ctr-beta`) |
| Last finished deployment commit | `5d3e828…` — matches `origin/beta` |
| Running containers | 5 (`nginx`, `db`, `ct-api`, `ct-socket`, `mailhog`), up 27 h |
| Upstream PR #409 | OPEN — `upstream/citizen-directory` @ `b90e520` |
| Upstream PR #410 | OPEN — `upstream/home-image-upload` @ `ca7fe34` |
| Upstream PR #411 | OPEN — `place-map-backgrounds` @ `cba0508` |
| Upstream PR #412 | OPEN — `fix/socket-presence-foundation` @ `8cb4622` |
| Fork PR #5 | OPEN (draft) — `fix/socket-reconnect-resync` @ `0163991`, based on #412 |
| Fork PR #1 | MERGED 2026-07-17 into fork `master` (reference only) |

Commits present on `local-testing` but absent from `beta` (`--cherry-pick` right side):

```
4616466 Repair role-ID durability and can_admin auth status (QA findings A & B)
60d8a34 Gitignore runtime home image uploads
3f0a107 Add CLAUDE.md/AGENTS.md and conform touched SPA lines to eslint
64af9a4 Merge remote-tracking branch 'upstream/master' into local-testing
54aa2e4 Fix two correctness bugs surfaced by code review of the QA fixes
e097218 Fix issues found in independent QA review
9e16729 Add Home customization: Chat Access Rights, Information, Image upload, Reset
3a159f0 Merge branch 'feature/howdoi-feedback' into local-testing
d0721b7 / 63df429 / 4d148a7 / a791890 / 759e036 / 298c2b1  (Directory / How Do I? / Feedback)
```

The Directory / How Do I? / Feedback commits are **superseded** — beta already carries the
upstream PR #409 versions of that work.

## Live beta database findings (read-only inspection)

The beta database is a `mysqldump` restore of Ryan's local dev database, which had
`local-testing` migrations applied. That produces a **code/data divergence** the beta branch
does not currently know about:

| Finding | Detail | Consequence |
|---|---|---|
| `migrations` row id 39 | `20260717120000_dedupe_role_rows.ts`, batch 5, recorded as applied | The migration **file does not exist on `beta`**. `knex migrate:latest` refuses to run against a corrupt directory ("the following files are missing"), so beta currently **cannot apply any new migration**. |
| `role_name_unique` | UNIQUE index on `role.name` already present | Dedupe already enforced at the DB level. |
| Duplicate role names | none (114 role rows, 0 duplicated names) | The dedupe consolidation has already run; re-running is a no-op. |
| `Home Chat Guest` | exists, `role.id = 192` | Present in **data** but absent from `beta`'s `update_roles_data.json` seed. A fresh `migrate + seed` beta would **not** have this role. |
| `home` table | has `image`, `image_status`, `image_checked_by`, `image_checked_at`, `image_revision` | Full PR #410 moderation schema present. |
| `map_location` | PK `(parent_place_id, location)`, columns `place_id`, `available` | Supports an atomic conditional claim (`UPDATE … WHERE place_id IS NULL`). |
| Homes | 2 home places / 2 `home` rows | Small dataset; reset QA needs a known-free lot. |
| `migrations` table name | `migrations` (not `knex_migrations`) | Per `api/src/knexfile.ts`. |

Migrations are **not** run at container start — `compose.beta.yml`'s `ct-api` command is
`npm install && node … src/api.ts`. They are a manual step.

## Feature-intent reconciliation matrix

Legend for **Status**: `missing` · `partial` · `present` · `superseded` · `obsolete` ·
`unsafe` · `docs-only`.

### Home Information

| Feature / invariant | Historical evidence | Current beta | Status | Modern dependency | Required implementation | Tests | Regression risk |
|---|---|---|---|---|---|---|---|
| Information option in Home Update menu | `HomeUpdatePage.vue` links entry with real route | `HomeUpdatePage.vue:71-75` — entry exists with `link: ''` (dead tile) | missing | SPA router | Point tile at `/home/update/information` | Playwright menu | none |
| Owner edit page | `HomeUpdateInformationPage.vue` (94 lines) | file absent | missing | `$http`, ct-theme | New Vue page on current conventions | Playwright | none |
| `GET /home/information/:placeId` | `home.routes.ts` + `getHomeInformation` | absent | missing | `PlaceRepository.findById` | Restore, home-type guarded | API | none |
| `POST /home/update-information` | `home.routes.ts` + `updateHomeInformation` | absent | missing | `PlaceRepository.updateHomeByMemberId` | Restore; resolve home from session only | API | none |
| Ownership resolved from session | historical resolves via `session.id` | n/a | present (pattern) | `decryptSession` | Keep — never trust body `memberId`/`homeId` | API non-owner test | none |
| Max length 1000, badwords | `home.controller.ts:404-411` | n/a | missing | `validator`, `badwords-list` | Restore verbatim intent | API | none |
| Empty description allowed | `updateHomeInformation(…, houseDescription \|\| '')` | n/a | missing | — | Preserve | API | none |
| Public display of description | `Information.vue` (11 lines) | absent | missing | existing home popup | Restore, escaped rendering | Playwright + XSS test | none |
| No-home response | `throw 'You don't have a home yet.'` | same idiom used by beta image paths | missing | — | Reuse the exact beta idiom | API | none |

### Reset Home

| Feature / invariant | Historical evidence | Current beta | Status | Modern dependency | Required implementation | Tests | Regression risk |
|---|---|---|---|---|---|---|---|
| Reset option in menu | `HomeUpdatePage.vue` | dead tile (`link: ''`, line 80-84) | missing | router | Point at `/home/reset` | Playwright | none |
| Reset page with block map + lot picker | `HomeResetPage.vue` (164 lines) | absent | missing | existing map components | New page | Playwright | none |
| `POST /home/reset` | `home.routes.ts` + `resetHome` | absent | missing | — | Restore route | API | none |
| Owner-only | resolved from `session.id` | n/a | missing | `decryptSession` | Keep | API | none |
| Server validates block/lot | `findByParentPlaceIdAndLocation` + `available` + `place_id > 0` | `moveHome` does the same (`home.service.ts:118-126`) | partial | `MapLocationRepository` | Reuse the beta `moveHome` validation shape | API | none |
| Atomic claim of the new lot | `mapLocationRespository.claimLocation()` — **method does not exist on beta** | beta `moveHome` uses non-atomic `unsetPlaceId` + `create` | missing | `map_location` PK | Add narrowly-scoped `claimLocation` (conditional UPDATE) | concurrency test | `moveHome` left as-is (out of lane) |
| Whole reset atomic | historical: **not** transactional (sequential awaits) | n/a | **unsafe — rejected** | `homeRepository.runInTransaction` | Wrap DB mutations in one transaction | rollback test | none |
| Clears name / description / icon | `place.name = "<username>'s Home"`, `description = ''`, `map_icon_index = 1` | n/a | missing | `PlaceRepository` | Preserve | API | none |
| Clears 3D design | `home.home_design_id = null` | n/a | missing | `HomeRepository` | Preserve | API | none |
| Clears image | historical `deleteExistingHomeImage()` + `image = null` | **superseded** by PR #410 revision model | **unsafe — rejected** | `deletePublicImageIfState`, `lockHome` | Clear to `('none', null)` under the home row lock, then state-guarded cleanup — exactly the contract `home.service.ts:370` already documents for "remove / reset" | image race matrix | **high if ported verbatim** |
| Clears chat guest list | `removeAllForPlaceAndRole(place.id, HomeChatGuest)` — method absent on beta | absent | missing | `role_assignment` | Add narrow repository method | API | none |
| Refund of paid design | `home.controller.ts:347-369` — full design price, `Champion`+`championhome` ⇒ 0 | beta `updateHome` uses the identical rule (`home.controller.ts:265-282`) | partial | `performHomeRefundTransaction` | Reuse beta's `updateHome` refund rule verbatim; never trust a client price | exact-once test | none |
| Refund idempotency | historical: none — a repeated POST refunds again | n/a | **unsafe — must improve** | wallet/transaction | Refund only when a design was actually cleared, inside the same committed operation | duplicate-request test | none |
| Post-commit FS cleanup failure recoverable | historical: FS delete before DB write | n/a | **unsafe — rejected** | PR #410 helpers | DB truth first, best-effort guarded cleanup after | FS-failure test | none |

### Chat Access Rights

| Feature / invariant | Historical evidence | Current beta | Status | Modern dependency | Required implementation | Tests | Regression risk |
|---|---|---|---|---|---|---|---|
| Menu option | `HomeUpdatePage.vue` | dead tile (line 85-88) | missing | router | Point at `/home/chat-access` | Playwright | none |
| Config page, 8 slots | `HomeChatAccessPage.vue` (144 lines), `MAX_CHAT_GUESTS = 8` | absent | missing | — | New page | Playwright | none |
| `GET`/`POST /home/chat-access` | historical routes | absent | missing | — | Restore, owner-scoped | API | none |
| Owner-only read/write | resolved from `session.id` | n/a | missing | `decryptSession` | Keep | API | none |
| Blank discarded, duplicates normalized, cap 8 | `home.service.ts:384-388` | absent | missing | — | Preserve | API | none |
| Unknown usernames silently ignored | `home.service.ts:370` comment — "matching the block/hood access rights UX" | absent | missing | `MemberRepository` | **Preserve** (verified original behavior; consistent with sibling features) | API | none |
| Empty list ⇒ open chat | `getChatAccessStatusByPlaceId` returns `restricted: false` | absent | missing | — | Preserve | API | none |
| Owner always allowed | owner username prepended to `allowedUsernames` | absent | missing | — | Preserve | API | none |
| Storage as `role_assignment` rows | `HomeChatGuest` role + place-scoped assignments | role id 192 exists in beta **data** only | partial | `role`, `role_assignment` | Keep the relation (smallest change; row already exists); add the seed entry so a fresh DB matches | role tests | seed drift if omitted |
| `GET /home/chat-access/status/:placeId` **unauthenticated** | `home.controller.ts:507-512` — "No session required … server-to-server" | absent | **unsafe — rejected** | — | Any world-readable route publishes a home's guest list to anyone. Replace with an internal, non-public path. | direct-fetch test | none |
| API enforcement on message create | `message.controller.ts` guard before persist | absent | missing | `MessageService` | Restore on the modern controller | bypass test | none |
| Socket enforcement on `CHAT` | historical `server.js` `CHAT` handler + 15 s room cache | absent; beta `server.js:299-320` is the **rewritten** PR #412/#5 handler | missing (must be re-derived) | `PRESENCE`, `USERS` | Add the guard to the modern handler using `PRESENCE.get(user.presenceKey).memberId` — never socket id | bypass / reconnect / two-tab tests | **high if the historical `server.js` is ported — it would revert PR #412 and #5 wholesale** |
| Chat restriction ≠ entry restriction | historical restricts chat only | n/a | missing | — | Preserve | Playwright | none |

### Roles and authorization

| Feature / invariant | Historical evidence | Current beta | Status | Required action | Tests |
|---|---|---|---|---|---|
| Dedupe migration | `20260717120000_dedupe_role_rows.ts` | file absent; **already applied to the beta DB** | missing (file) | **Restore the file verbatim** — it is idempotent, index-guarded, and no-op on clean data. This also repairs the corrupt migration directory. | clean-DB, duplicate-DB, re-run |
| `UNIQUE(role.name)` | migration adds `role_name_unique` | index already present in beta DB | present (data) | none beyond the file restore | index test |
| Deterministic role lookup | `role.repository.ts` — sort by id, first-wins | beta keeps last-wins (`role.repository.ts:17-21`) | missing | Restore the deterministic resolution — defense in depth | lookup test |
| No hardcoded Admin id | migration docstring (`roleMap.Admin === 114` was accidental) | n/a | present | keep; never constant-ise DB ids | — |
| `can_admin` 401/404/500 handling | `place.controller.ts` rework in `4616466` | beta has the older 400-for-everything shape | missing | Restore — it is an auth-correctness fix, not a home feature | controller tests |
| `Home Chat Guest` seed row | `update_roles_data.json` +6 lines | absent from beta seed | missing | Add, so `migrate + seed` reproduces the live data | seed test |

## Phase 2 — Finalized invariants

These are the properties the reconstructed features must hold on the **current** beta
architecture. They are binding: a change that violates one is a stop condition, not a
trade-off.

### PR #410 — home image moderation

Sourced from the live implementation in `api/src/services/home/home.service.ts`, not from
the PR description.

1. Pending bytes live under `PRIVATE_UPLOADS_DIR`/`homes-pending`, outside `ASSETS_DIR` and
   every nginx-served path. Only `getPendingImagePath` + the authenticated
   `/home/moderation/:placeId/image` endpoint may read them.
2. Every upload gets a fresh `randomBytes(16)` revision and its own private filename
   `<placeId>-<revision>.webp`. Files are immutable — a replacement never overwrites the
   file an in-flight approval is reading.
3. The public file is the canonical `<placeId>.webp` and is only ever written by
   `publishApprovedImage` via copy-to-temp + atomic `rename`.
4. Approve and reject are bound to the **exact reviewed revision**; a mismatch is a 409
   conflict (`conflict()`, `status: 409`), never a silent publish.
5. Every image mutation runs inside `homeRepository.runInTransaction` while holding
   `lockHome(trx, placeId)` — a `FOR UPDATE` row lock that serializes uploads, approvals,
   rejections, removals and resets across processes.
6. Post-commit filesystem cleanup is **state-guarded**: `deletePublicImageIfState` re-takes
   the row lock and only deletes while `(image_status, image_revision)` still equals what
   the caller committed. The documented caller contract is already written down at
   `home.service.ts:366-371`, and it explicitly names **reset** → `('none', null)`.
7. Deletion is always exact-path: `deletePendingRevisionFile(placeId, revision)` or the
   canonical public path. No globs. `deletePublicTempFiles` is the one directory scan and is
   anchored to `.tmp-<placeId>-` + `.webp`.
8. DB truth is authoritative; a failed post-commit unlink logs and is swallowed, never fails
   the request and never rolls the record back.

**Consequence for Reset:** reset must not re-implement image clearing. It commits
`image: null, image_status: 'none', image_revision: null, image_checked_by: null,
image_checked_at: null` under the same row lock, then calls the existing
`deletePendingRevisionFile` + `deletePublicImageIfState(placeId, 'none', null)`. That is
byte-for-byte the contract `removeHomeImage` already implements, so reset reuses it rather
than inventing a parallel path.

### PR #412 — renderer-independent presence

Sourced from `spa/server.js` on beta.

1. Presence identity is the logical key `` `${memberId}:${presenceId}` `` (`presenceKey`),
   never the socket id. `socketId` is stored **inside** the presence record as replaceable
   transport metadata.
2. `memberId`, `username` and `avatar` come only from the verified JWT (`validJwt`), so a
   client-chosen `presenceId` cannot impersonate an account.
3. `JOIN` answers with one authoritative `ROOM_STATE` snapshot echoing the client's
   `joinId`; a stale reply can never settle a newer attempt.
4. Only the socket that currently owns a presence key may broadcast under it
   (`presence.socketId !== socket.id` ⇒ drop) — see the `AV` handler.
5. Two tabs on one account are two presences and must both survive.
6. Chat readiness does not depend on X_ITE initialization.
7. Room transitions tear down the old presence exactly once and only if this socket still
   owns it.

**Consequence for Chat Access:** enforcement reads member identity from
`PRESENCE.get(user.presenceKey).memberId` (JWT-derived), never from the socket id and never
from anything the client sent in the `CHAT` payload.

### Fork PR #5 — reconnect and resync

1. A replaced transport rejoins and re-derives authoritative state; no duplicate local or
   remote presence appears.
2. Stale events tagged for a previous room are rejected.
3. Listener count does not grow across reconnects or repeated navigation.

**Consequence for Chat Access:** the guest list is *not* cached in client state across a
reconnect. Authorization is re-derived server-side on every enforced action, so a reconnect
cannot carry stale permission either way.

### Roles

1. Role ids are database facts, never application constants. Nothing may hardcode `192`
   (`Home Chat Guest`) or `114` (the historical accidental `Admin`).
2. Name → id resolution must be deterministic and independent of row order.
3. `UNIQUE(role.name)` stays enforced.
4. Reconciliation preserves every meaningful assignment.
5. No change may broaden Block, Neighborhood, Colony, Mall, security or global scope.

### Seed architecture (answers the `Home Chat Guest` question)

Inspected before changing anything:

| Seed | Data file | Behaviour |
|---|---|---|
| `05-roles.seed.ts` | `roles_data.json` | `knex('role').insert(rolesData)` — **unconditional, no guard, no try/catch** |
| `09-update.roles.seed.ts` | `update_roles_data.json` | per row: `SELECT … WHERE name = ?` → `insert` when absent, `update` when present; per-row `try/catch` |

So the two files have different contracts. `05` is the seed the dedupe migration's docstring
blames for the original duplicates, and now that `role_name_unique` exists it will fail with
`ER_DUP_ENTRY` on any re-run against a populated database. **That is pre-existing on `beta`
and is not touched by this lane** — recorded here as a known hazard.

`09` is already an idempotent upsert keyed on `name`. Adding `Home Chat Guest` to
`update_roles_data.json` therefore satisfies every requirement with no new machinery:

- fresh database → row absent → inserted;
- live beta → row present at `id = 192` → updated in place by **name**, `id` never touched;
- repeated runs → upsert, so no failure and no duplicate;
- nothing depends on `192` — `RoleRepository.roleMap` resolves by name.

The historical change added the row to `update_roles_data.json`, which was already the
correct file. It is adopted for that reason, not because it is what the history did.

## Follow-up lanes (found here, deliberately NOT fixed here)

### 1. `db:init` cannot build an empty database — blocking for fresh environments

`npm run db:init` (`create-db && db:migrate && db:seed`) fails partway through migration
against a genuinely empty database.

Reproducer:

```bash
mysql -e "CREATE DATABASE fresh CHARACTER SET utf8mb4;"
DB_DATABASE=fresh npx knex migrate:latest --knexfile src/knexfile.ts
```

```
Creating vote_options table...
Creating vote_response table...
Adding voting seeds...
migration file "20260309032638_add_voting_tables.ts" failed
insert into `vote_list` (..., `place_id`, `title`)
  values (NULL, 'Vote for the next mayor of Cybertown', NULL, 1, 'Mayor Election 2026')
ER_NO_REFERENCED_ROW_2: Cannot add or update a child row: a foreign key constraint fails
  (`fresh`.`vote_list`, CONSTRAINT `vote_list_place_id_foreign`
   FOREIGN KEY (`place_id`) REFERENCES `place` (`id`))
```

Cause: `20260309032638_add_voting_tables.ts` does not only create tables — it also inserts a
Mayor Election row referencing `place_id = 1`. Places are created by **seeds**, which run
**after** migrations, so on an empty database that foreign key has nothing to point at. The
migration aborts, leaving the schema half-applied and the migration unrecorded.

This also explains beta: no database in this lineage has ever been built from scratch. Beta
is a dump of a local dev database that grew incrementally, where the voting migration ran at
a moment when `place` id 1 already existed — the same history that let the seed suite run
three times.

Remediation options, roughly in order of preference:

1. Move the Mayor Election row out of the migration and into a seed (it is seed data, not
   schema). Cleanest; changes what an already-migrated database receives on re-seed.
2. Guard the insert — skip it when `place` id 1 does not exist. Smallest diff, leaves
   existing databases byte-identical, leaves fresh databases without the row until seeded.
3. Resolve the row's `place_id` at run time from the plaza's slug instead of a hardcoded
   `1`, and skip when absent.

Not touched here: it is a schema-ordering bug unrelated to home features, and beta is
staying on its existing database.

### 2. `NODE_ENV=test` has no entry in `api/src/knexfile.ts`

Jest defaults `NODE_ENV` to `test`; the knexfile defines only `development` and
`production`, so `config[process.env.NODE_ENV]` is `undefined` and `new Db()` throws
`Cannot read property 'client' of undefined`. Every suite that transitively imports
`../services` dies at import time — 12 of 20 suites on unmodified `beta`.

Workaround in use: run the suite with `NODE_ENV=development` explicitly. A one-line `test`
entry would fix it properly, but it changes shared test infrastructure.

### 3. `v-html` bound to member-authored content

`MessageBoard.vue` (message body, `messageboard_intro`), `Inbox.vue` (message body,
`inbox_intro`) and `MayorElection.vue` (error/success strings) render through `v-html` —
the stored-XSS shape Home Information was explicitly built to avoid. Pre-existing; wants its
own audit pass.

### 4. SPA lint is already failing, and `server.js` is not linted at all

`npm run lint` in `spa/` fails on `beta` before any change here:

```
error: Expected '===' and instead saw '==' (eqeqeq)
  at src/libs/x_ite_mods/arrow_keys.js:29:40
```

Separately, `vue-cli-service lint` covers `src/`, so the root-level `server.js` is outside
it. Pointing eslint at that file directly reports **322 problems on unmodified beta** — it
is written with 4-space indentation throughout while the config wants 2. Changes here follow
the file's existing style rather than introducing 2-space islands inside it; conforming the
whole file is a formatting pass of its own.

### 5. Lost-update race across `TransactionRepository`

Every self-transacting helper reads `wallet.balance` then writes
`balance = <the value it read> ± amount` with no row lock, so two concurrent credits to one
wallet can lose one. `createHomeRefundTransactionWithin` (added here) takes `FOR UPDATE`
before its read, but only on its own path — the pre-existing helpers are unchanged. A
general fix belongs with whoever owns the economy.

### Explicitly rejected historical implementation

1. `spa/server.js` from `local-testing` — predates PR #412 presence and PR #5 reconnect;
   porting it reverts both.
2. `home.service.ts` image handling from `local-testing` (`deleteExistingHomeImage`,
   single canonical `<placeId>.webp`, write-then-record) — reverts every PR #410 invariant.
3. Non-transactional reset — leaves partial state on failure.
4. Unauthenticated `GET /home/chat-access/status/:placeId`.
5. Client-only chat gating (`Chat.vue` hiding the input) as the *only* enforcement.
6. Unconditional refund on every reset request.
7. `main2d.vue` / `Chat.vue` historical edits — beta's versions carry later PR #411/#412 work.
