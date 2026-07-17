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
- Uploaded home images live in `spa/assets/homes-uploads/` (gitignored — runtime data).

## Gotchas

- **Duplicate role rows / admin grants.** The DB has duplicate `role` rows from an old bad
  seed: every role name exists twice (ids 1–113 and 114–192). `RoleRepository.roleMap`
  resolves each name to the **last** id, so `roleMap.Admin === 114`, and `canAdmin()`
  checks that. **To make a member admin, add a `role_assignment` with `role_id = 114`** — a
  `role_id = 1` ("Admin") assignment alone is NOT recognized. The real fix is cleaning up
  the duplicate rows.
- **Auth:** JWT in the `apitoken` header, signed with `JWT_SECRET` (no expiry). Session
  payload: `{ id, username, avatar, admin }`. `memberService.decryptSession(req, res)`.
- **Place hierarchy:** `place` has no `parent_id`. Home→block linkage is in `map_location`
  (`place_id` = home, `parent_place_id` = block). Use `homeService.getHomeBlock(placeId)`.

## Git / remotes

- `origin` → `DJAscendance/ctr` (our fork). `upstream` → `CybertownRevival/ctr`.
- Upstream's default branch is **`master`** (not `main`).
- `local-testing` is the working integration branch; feature work branches off it.
- Commit/push only when asked. Branch before committing if on a default branch.
