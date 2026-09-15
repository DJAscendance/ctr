# CLAUDE.md

Guidance for AI agents (and humans) working in this repository. Read this before making
changes.

## What this is

Cybertown Revival (CTR) — a revival of the classic Blaxxun-based Cybertown virtual world.
Two apps in one repo:

- **`api/`** — Node/TypeScript backend (Express, Knex/MySQL, TypeDI, ts-node). Routes are
  mounted under `/api/...` (see `api/src/api.ts`). Controllers → services → repositories.
- **`spa/`** — Vue 2 + TypeScript single-page app (vue-cli, Tailwind). Built to `spa/dist`
  and served by nginx; a small `server.js` serves the realtime pieces.

## Coding standards

These map to each project's ESLint config (`api/.eslintrc.json`,
`spa/package.json → eslintConfig`). **When your added lines conflict with the stated rule,
follow the project's ESLint — it is the source of truth and what review expects.**

- **2-space indentation.** No tabs. Wrapped/continuation lines may add **+1 space**.
- **Max line length 100.** (Keep lines ≤ 100; wrap longer ones.)
- **Quotes differ by project:**
  - **API (`api/`): single quotes** — `'like this'`. Exception: SQL query strings.
  - **SPA (`spa/`): double quotes** — `"like this"` — in `<script>`. (Template attribute
    expressions like `:to="{ name: 'x' }"` keep their inner single quotes.)
- **Use `===` / `!==`** for comparisons, never `==` / `!=`.
- **No trailing whitespace.**
- **Trailing comma** on the last item of multi-line arrays/objects/params
  (`comma-dangle: always-multiline`).
- **Blank line (newline) at end of every file** (`eol-last`).
- **Semicolons** required. SPA also enforces `prefer-const`, `prefer-template`, `no-var`.

Note: large legacy files (e.g. `spa/src/components/Chat.vue`) carry a lot of pre-existing
ESLint debt. **Don't mass-reformat them** — keep your *added* lines compliant and leave
unrelated pre-existing violations alone unless doing a dedicated cleanup. Verify your
changes with the diff-scoped approach, not a whole-file lint (which surfaces legacy noise).

Lint a file: `docker exec ctr-ct-socket-1 bash -c "cd /usr/src/app && npx eslint --quiet <path>"`
(SPA), or the equivalent in `ctr-ct-api-1` for `api/`.

## Local dev environment

`docker-compose up` brings up the stack (see `docker-compose.yml`):

| Service | Container | Notes |
|---------|-----------|-------|
| nginx | `ctr-nginx-1` | app at **http://localhost:8001** |
| api | `ctr-ct-api-1` | Express, nodemon; host port 3001 → 3000; routes under `/api` |
| socket/SPA | `ctr-ct-socket-1` | serves SPA; runs the SPA build |
| db | `ctr-db-1` | MySQL 5.7, `root`/`pw`, db `cybertown`, host port 3360 |
| mailhog | `ctr-mailhog-1` | mail UI on 8025 |

Common commands:

- **Build the SPA** (after `spa/` changes — the container serves built assets):
  `docker exec ctr-ct-socket-1 bash -c "cd /usr/src/app && npm run build -- --mode development"`
- **Run DB migrations:** `docker exec ctr-ct-api-1 bash -c "cd /usr/src/app && npm run db:migrate"`
- The API auto-reloads on `.ts` changes (nodemon). Watch: `docker logs -f ctr-ct-api-1`.
- Home images: only **approved** images live in `spa/assets/homes-uploads/` (nginx-served,
  canonical `<placeId>.webp`). **Pending** (unchecked) images live in a private,
  non-nginx-served directory — `api/private-uploads/homes-pending/` by default, set via
  `PRIVATE_UPLOADS_DIR` — and are viewable only through the authenticated moderator preview
  endpoint. Both dirs are gitignored runtime data; in deployment `PRIVATE_UPLOADS_DIR` must
  point at **persistent** storage (pending images survive restarts).

## Gotchas

- **Admin surfaces have a written baseline.** Before adding or changing anything under
  `/api/admin/*` or `spa/src/pages/admin/`, read
  **[`docs/ADMIN_SECURITY_BASELINE.md`](./docs/ADMIN_SECURITY_BASELINE.md)**. It is
  binding: four hard prohibitions, the fail-closed gate rule, the bounded asset-identifier
  rule, and the audit event each admin action owes.

- **Admin role id.** CTBL-0026 has landed: the role dedupe migration is applied, the live
  `role` table has no duplicate names, and `RoleRepository.roleMap` resolves the first name
  match by ascending id, so `roleMap.Admin === 1`. **To make a member admin, add a
  `role_assignment` with `role_id = 1`.** Prefer resolving roles by name through
  `RoleRepository`/`roleMap` rather than hardcoding any id — the map is the authoritative
  source, not a literal number.
- **Auth:** JWT in the `apitoken` header, signed with `JWT_SECRET` (no expiry). Session
  payload: `{ id, username, avatar, admin }`. `memberService.decryptSession(req, res)`.
- **Place hierarchy:** `place` has no `parent_id`. Home→block linkage is in `map_location`
  (`place_id` = home, `parent_place_id` = block). Use `homeService.getHomeBlock(placeId)`.
- **Home image moderation concurrency.** Every upload gets an unguessable `home.image_revision`
  token and its own private file `<placeId>-<revision>.webp`; the public file is always the
  canonical `<placeId>.webp`. All image mutations (upload / approve / reject / remove / reset)
  run inside a transaction that first takes a `SELECT … FOR UPDATE` row lock on the home, so
  they are serialized **across processes**. Approval/rejection are **bound to the exact
  revision the moderator reviewed** (sent from the queue): if the owner replaced the image
  meanwhile, the current revision no longer matches and the API returns **409** — nothing is
  published. Approval publishes the reviewed revision with an atomic temp-then-rename into the
  public dir; the private copy is deleted only after commit. Net invariant: **the public file
  only ever contains an approved revision's bytes**; an unchecked upload can never be promoted.
  Do not reintroduce a shared pending filename or approve "whatever is currently pending".
  **Post-commit cleanup rule:** the row lock only protects work while its transaction is open,
  so any filesystem cleanup done *after* commit must be either (a) revision-specific (delete a
  single captured immutable `<placeId>-<rev>.webp`, never a wildcard), or (b) routed through
  `deletePublicImageIfState()`, which re-locks the row and only deletes the canonical public
  file while the record still holds the exact state the caller committed. Never delete the
  shared public path or wildcard-delete pending files unguarded after releasing the lock —
  that lets an old request clobber a newer operation's files.

## Git / remotes

- `fork` → `DJAscendance/ctr` (our fork, the writable remote).
  `origin` → `CybertownRevival/ctr` (upstream). Check with `git remote -v`; there is no
  remote named `upstream`.
- Upstream's default branch is **`master`** (not `main`).
- `local-testing` is the working integration branch; feature work branches off it.
- Commit/push only when asked. Branch before committing if on a default branch.
