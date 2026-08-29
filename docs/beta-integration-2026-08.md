# CTR beta integration — 2026-08-29

A beta test branch that combines the pending CTR work so the owner and community can exercise
it together without touching production. It is **not** a proposed merge to upstream `master`;
each feature is still reviewed as its own PR.

| | |
|---|---|
| Integration date | 2026-08-29 |
| Upstream base | `CybertownRevival/ctr@2c744e2d7038247bbc792bd634e308c9a0d8399e` (`master`) |
| Branch | `beta-integration-2026-08` on `DJAscendance/ctr` |
| Previous beta branch | `beta` @ `b19f41eb87e43515c6dd6df52a7787518648f792` — untouched, preserved for rollback |

The historical `beta` branch was deliberately **not** merged. It carries an older generation of
work that has since been reconstructed cleanly against upstream; merging it would reintroduce
superseded versions of things already on this branch. It is kept as-is.

## Inherited fork base — PR #1, #2, #3

Fork PR #6 and #7 were branched from fork `master`, not from upstream `master`, so merging their
tips carried in three fork features that were merged long before this lane. The previous version
of this document referred to them only as an unexplained "25-commit fork foundation (`2e96fa2`)".
They are not mystery commits, and they are not an accidental re-merge of the old `beta` branch —
they are these three reviewed pull requests, merged onto fork `master` on 2026-07-17 in this
order:

| fork PR | merge commit | parents | brings in |
|---|---|---|---|
| #1 — *Merge home tools, control panel updates, and upstream changes* | `a1420a28` | `4d95500b` + `4616466c` | Home Tools, home Information editing, home Chat Access Rights, home reset, the How Do I? and Citizen Directory modals, and a sync of upstream `master` (`64af9a4` merged `2c744e2d` into `local-testing`) |
| #2 — *Restore the Citizen Directory banner* | `a56212ad` | `a1420a28` + `72c9e81f` | the Citizen Directory banner asset and its placement |
| #3 — *Add moderated home image uploads* | `2e96fa28` | `a56212ad` + `9586c41b` | home image upload, the Block Leader CHECK moderation queue, approve/reject, and the private pending-image store |

`2e96fa28` is the tip of that chain, and `702af0b1` (the fork #6 → #9 → #10 stack tip merged
below) contains it — verified with `git merge-base --is-ancestor`. So the fork features above are
part of this beta whether or not they are listed as separate merges, which is exactly why they
are smoke-tested in their own right rather than assumed.

## Included

Every candidate below was already rebased onto current upstream `master` (`behind = 0`), so no
candidate needed a rebase before integration.

**These are not fast-forwards.** Each of the eleven integration commits is a genuine two-parent
merge commit joining two divergent descendants of `2c744e2d` — for example
`c25928c` has parents `4ff42d4` and `702af0b`. A fast-forward produces no merge commit and
cannot conflict; the conflicts resolved further down this document are themselves proof that
these were real merges. `git log --merges 2c744e2d..HEAD` lists all eleven.

| PR | title | source head | decision |
|---|---|---|---|
| upstream #412 → fork #5 | socket presence foundation + reconnect/resync | `a1bae5a2` (contains `8cb4622b`) | INCLUDE — merged as one stack |
| fork #6 → #9 → #10 | access rights, deputy reconciliation, primary-role atomicity | `702af0b1` | INCLUDE — tip only; also carries the inherited fork base PR #1/#2/#3 (`2e96fa28`), described above |
| fork #7 → #8 | `member_data` store, roster visibility + hide-yourself | `1ae407f0` | INCLUDE — tip only |
| upstream #415 | role impersonation via `update_role` | `8c99ee91` | INCLUDE |
| upstream #423 | daily/weekly job credit reliability | `9008902e` | INCLUDE |
| upstream #422 | Mall staff workflow: checker, inspection, JSON export | `45b157de` | INCLUDE |
| upstream #419 | admin button in main menu | `cdc97a62` | INCLUDE |
| upstream #417 | Cybertown News system | `3c850a53` | INCLUDE |
| upstream #418 | Live Event feature | `723e3fec` | INCLUDE |
| upstream #420 | Jail info / Deputy Security Chief | `ee9ff72f` | INCLUDE |
| upstream #421 | `fleamarket.wrl` BlaxxunZone restoration | `8f7d4bc5` | INCLUDE |

## Deliberately not merged

| PR | why |
|---|---|
| fork #11 (`fix/daily-credit-await`) | SUPERSEDED by upstream #423, the clean reconstruction of the same lane. Merging both would duplicate the credit work. |
| fork #13 (`feat/mall-staff-workflow`) | SUPERSEDED — same head SHA as upstream #422 (`45b157de`); it is a review surface on the fork, not separate work. |
| fork `beta` @ `b19f41e` | ALREADY_CONTAINED / SUPERSEDED, see above. |
| fork #6, #9, #7 as separate merges | ALREADY_CONTAINED in the stack tips that were merged. |

## Conflicts resolved

**`spa/server.js`, `spa/src/components/Chat.vue`** — presence stack vs. Home Chat Access Rights.
The presence stack rewrote the JOIN handler around a logical presence key; the access-rights
stack added a per-room chat allow-list. Both kept. The `CHAT_ACCESS` lookup is now awaited at the
*end* of the JOIN handler, after presence and `ROOM_STATE` have settled, so a slow or failing API
call can never delay or reorder the presence handshake. In `Chat.vue` the listener became a named
handler (`onChatAccessEvent`) registered and unregistered alongside the others, because Chat
remounts on every place navigation and anonymous listeners would accumulate.
Covered by `spa/tests/server-presence.test.ts` and `spa/tests/presence.test.ts` (53/53 pass).

**`RoleAssignmentService` constructor** — a *silent* conflict, resolved with no marker. #423
rewrote the constructor (adding `CreditRepository`, dropping the `TransactionRepository` whose
logic it moved); the access-rights stack added `MemberRepository` for `reconcilePrimaryRole`. git
kept #423's list verbatim and dropped the other side's dependency. Caught by `tsc`, not by the
merge. Both are injected now; `TransactionRepository` is genuinely unused and stays out.

**`role-assignment.repository.ts`, `transaction.repository.ts`, `member.service.ts`,
`member.controller.ts`, `admin.services.ts`** — #422 ran a typing/lint hygiene pass over code the
fork stack and #423 had rewritten behaviourally. The behavioural side was kept throughout; #422's
type tightening was re-applied where it was still correct (`getOnlineUsers`/`getStorage` →
`Promise<void>`, `getDonor` → `RoleNameRow | undefined`, which is what the query actually
returns). Two `DonorRoleIds` declarations (one per side) were collapsed to #422's exported one.

**`spa/src/pages/admin/admin.vue`** — #418 restructured the admin menu (formatting, a Live Event
link, and *tighter* gating on Overview/Members/Places); #417 added the News link and the
`canEditNews` gate. #418's structure is the base, with #417's News additions re-applied onto it.
The tighter gating is what survived — no merge in this lane widens an authorization check.

**`api/src/repositories/index.ts`, `api/src/services/index.ts`** — barrel exports, both sides
add one. Unioned.

## Socket / upload

See `docs/beta-socket-upload-investigation.md`. Short version: a Mall upload cannot restart the
socket server (proven by measurement, and by the controller's extension whitelist), but an SPA
rebuild could, because the watcher was unscoped. Fixed with `spa/nodemon.json`, a non-watching
`npm start`, and `docker-compose.beta.yml`.

## Verification

Run on this branch, all green except the documented baseline failures:

- `api`: `tsc --noEmit` clean; `tsc --project tsconfig.prod.json` clean; jest **427 passed**,
  38 skipped (database-backed specs, opt-in), 3 suites fail with "must contain at least one
  test" — these three files are empty stubs on upstream `master` too, verified, so they are
  baseline failures and not regressions.
- `spa`: presence/reconnect/server suites **53/53 pass**; production `npm run build` succeeds on
  Node 14.21.3.
- Lint: no error introduced by any conflict resolution. `spa/src/App.vue` gains 28 style errors
  and several API files gain indentation/quote errors — all attributable to the community PRs
  themselves (#417/#418/#419/#420 each fail the same way on their own head), not to integration.
  `spa/src/components/Chat.vue` has *fewer* errors than baseline (146 vs 170).

## Pre-deployment gate — 2026-08-29

The whole stack was brought up against a disposable MySQL 5.7 and exercised. What that found is
recorded below; every fix was then re-examined by independent QA, and the corrections that pass
produced are folded into the sections that follow. Where the first pass got something wrong, the
correction is stated in place rather than left to be inferred.

### Admin authorization — from "wide open" to least privilege

`MemberService.getAccessLevel()` resolves to a `string[]`. Ten admin endpoints gated on
`if (admin)` / `if (!admin)`, and an empty array is truthy, so the gate was unconditionally open:
**any authenticated member, holding no role at all, could reach them.** Measured live against the
running API before the fix — a member with `accessLevel: []` got HTTP 200 from
`/api/admin/userchat` (any member's private chat logs), `/api/admin/transactions` (the whole
ledger), `/api/admin/banhistory`, `/api/admin/rolelist`, `/api/admin/usersearch`,
`/api/admin/places`, `/api/admin/allplacessearch`, `/api/admin/userplacessearch`,
`/api/admin/transactions/:id`, and passed the gate on the write endpoint
`/api/admin/places/update`.

The first fix replaced every one of those with `admin.length > 0`. That closes the bypass, but it
is still too wide: it says *any* staff capability opens *every* admin endpoint, so a Colony Leader
could read private chat logs and the whole transaction ledger. The admin UI has never claimed
that. Each gate is now the capability the UI itself applies, and the mapping is documented on
`AdminController` with the file that establishes each rule:

| endpoint | capability | UI source |
| --- | --- | --- |
| `getBanHistory`, `searchUsers`, `places`, `searchAllPlaces` | admin / security / leader | `admin.vue` Members and Places menus |
| `getTransactions`, `getTransactionsByWalletId` | security | `admin.vue` Transactions menu, `user/SubMenu.vue` |
| `searchUserChat` | security | `user/ChatMessages.vue` redirects without it |
| `findUserPlaces` | security | Storage/Clubs tabs in `user/SubMenu.vue` |
| `getObjectInstances`, `getCommunityData` | security | User Objects and Overview menus |
| `getOwnedObjects` | admin | Objects tab in `user/SubMenu.vue` |
| `getRoleList` | admin **or** a security-role manager | `roles.vue` requires admin; `SubMenu.vue` shows HIRE/TERMINATE to either |
| `placesUpdate` | admin **or** security | the Edit action in `place/search.vue` |
| `dropObjectInstance` (object-instance controller) | admin **or** security | same contract as editing a place |

No new role model was invented: `getObjectInstances`, `getOwnedObjects` and `getCommunityData`
were already written this way in the same file, and `getRoleList` now mirrors `hireRole`/
`fireRole` exactly. Note that the narrowing is not as aggressive as it looks — the Admin role is a
member of both `canAdmin`'s and `canLeader`'s role sets, so a real admin resolves to
`['admin', 'security', 'leader', 'live-event']` and keeps everything.

Gates no longer touch `.length` or `.includes` directly. `libs/access-level.ts` provides
`hasAccess(raw, ...capabilities)`, which treats anything that is not an array of strings as
holding nothing, so a `null`, `undefined` or malformed access level denies instead of throwing.
It also refuses the bare string `'admin'`, which `'admin'.includes('admin')` would otherwise
accept.

`getRoleList` also gained the `else` 403 that every sibling endpoint already had; without it a
denied member would have hung rather than been refused.

Verified live on the running beta stack across five accounts (no roles, Colony Leader, Security
Officer, Security Chief, Admin) and confirmed in a browser: the admin panel renders Members and
Places for a leader; adds Overview, Transactions and User Objects for security; and adds Avatars,
Roles, Seized Objects, Mall Objects, News and Live Event for an admin — matching the server
exactly. Covered by `admin.controller.authorization.spec.ts` (118 tests),
`object-instance.controller.authorization.spec.ts` and `libs/access-level.spec.ts`.

Two endpoints (`addDonor`, `getDonor`) compare `getAccessLevel()` to the bare string `'admin'`,
which the array can never equal. They therefore deny everyone, including real admins — verified
live, admin gets 403. That is fail-closed, so it is **not** a security problem and is deliberately
left alone: making them work would newly enable an access-gated path, which is the owner's
decision, not a QA lane's. Status: **SAFE_BUT_BROKEN**, deferred.

### `place.controller.updateVirtualPet` — one write, one response

The first gate report claimed this method had no authorization. **That was wrong**, and the
correction matters: it authorizes `admin.includes('security') || owner.id === placeId`, which is
the intended rule (the home's owner, or security). The commented-out line above it is an older,
stricter rule and was a red herring.

The real defect is structural. Validation, the authorization test, the database write and the
response all ran *inside* the loop over the submitted behaviours, so the number of writes and
responses tracked the number of behaviours rather than the number of requests: an empty list
answered nothing at all and left the request hanging; two valid behaviours wrote twice and tried
to respond twice; a valid behaviour followed by a banned one wrote and answered success before
answering with an error. Malformed JSON threw out of the handler entirely.

It now runs in the only order that can be correct — authenticate, parse and validate the request,
authorize, parse the behaviours safely, validate them all, then write once and answer once. An
empty behaviour list is treated as valid (one write, one response): `pet_behaviours` is a
free-form JSON blob, the loop only ever existed to word-filter it, and the SPA never removes rows,
so there is no established rule that rejects it. Validation failures keep the existing
`200`-with-`error` shape because `HomeVirtualPet.vue` reads the message off a successful response;
malformed JSON, which that page cannot produce, gets a plain 400. A member who has not settled a
home has no owner record, so the ownership test is optional-chained — reaching for `owner.id`
would throw and leave the request unanswered, which is the exact failure being removed.

Measured live on the beta stack, all eight cases answering in 10–30 ms with no hang:

| case | result | writes |
| --- | --- | --- |
| empty behaviours, security | `200 {"success":"success"}` | 1 |
| one valid behaviour | `200 {"success":"success"}` | 1 |
| two valid behaviours | `200 {"success":"success"}` | 1 |
| valid then banned | `200 {"error":"Pet input/output cannot contain a banned word."}` | 0 |
| banned then valid | `200 {"error":"Pet input/output cannot contain a banned word."}` | 0 |
| malformed JSON | `400 {"error":"Pet behaviours are not valid JSON."}` | 0 |
| non-owner, no capability | `200 {"error":"You do not have access to update this."}` | 0 |
| non-owner, leader only | `200 {"error":"You do not have access to update this."}` | 0 |

The stored row after the run held the last valid submission, confirming the rejected attempts
wrote nothing. 24 unit tests cover the same matrix plus the homeless-member case.

### The beta deployment definition is now standalone

`docker-compose.beta.yml` used to be an overlay on `docker-compose.yml`. That cannot work for a
public beta, and the reason is structural rather than a matter of care: **compose merges the
`ports` list, it does not replace it, and there is no override syntax that removes an inherited
published port.** Measured on the running overlay stack, the beta published 3000 (API), 9229 (API
debugger), 8000 (socket), 9230 (socket debugger), 3360 (MySQL), 1025 and 8025 (MailHog), plus
8001 and 443 on nginx. The same limitation applies to `command:` and to the development bind
mounts.

The file is therefore standalone. In the beta deployment it is run by Coolify as a normal
Git-based Docker Compose application; the same file runs by hand for local verification:

```bash
docker compose -f docker-compose.beta.yml up -d --build
docker compose -f docker-compose.beta.yml --profile bootstrap run --rm ct-bootstrap   # first run only
```

Nothing is published to the host in either case, so a local run reaches nginx over the compose
network (`docker compose -f docker-compose.beta.yml exec nginx …`) rather than on a host port.

`docker-compose.yml` is untouched and remains the development stack. What the beta definition now
guarantees, each verified on the running stack:

- **No published port at all.** nginx is the only ingress and it is `expose:`d on container
  port 80; nothing in the stack binds a host port. `ss -ltn` on the host shows no listener on
  3000, 9229, 8000, 9230, 3360, 1025, 8025, 8001 or 443 belonging to this stack. Host 80/443
  belong to Coolify's Traefik, which routes `beta.cybertown.dev` to the nginx container.
- **No debugger anywhere.** `npm run dev` (API) and `npm run dev-server` (socket) both open an
  inspector on `0.0.0.0`; neither is used. The resolved API command is
  `node -r dotenv/config dist/api.js` and the socket's is `node -r dotenv/config server.js`.
- **Compiled JavaScript, not ts-node.** The API image runs the output of `npm run build:prod`.
  `tsconfig.prod.json` now excludes `**/*.spec.ts` (a deployable build has no reason to carry the
  specs, and the image does not copy `spec/` at all) and pins `rootDir: "src"` so the entry point
  cannot drift — excluding the specs alone moved it from `dist/src/api.js` to `dist/api.js`, which
  is precisely the kind of silent change a deployment command must not depend on.
- **Dependencies are installed at image build**, from the lockfiles, with `npm ci`. Node 14.21.3
  and npm 6 accept the existing lockfileVersion 1 files unchanged, so nothing was regenerated.
  Runtime `npm install` is what mutated `spa/package-lock.json` during QA; a full build now leaves
  both lockfiles untouched.
- **No source bind mounts.** Editing the checkout cannot change a running container, and nothing
  in the stack can write back into the repository. This also makes "an SPA rebuild restarts the
  chat server" structurally impossible rather than merely watched-against.
- **MailHog is gone.** It was never wired in: `api/src/libs/mail.ts` hard-codes `127.0.0.1:25` and
  the mailhog host/port lines beside it are commented out. Publishing a mail UI for a service
  nothing sends to is exposure with no function. **Open question for the owner: beta mail
  delivery — password reset currently has no reachable SMTP host.**
- **Secrets come from the environment** (`DB_USER`, `DB_PASS`, `DB_DATABASE`,
  `MYSQL_ROOT_PASSWORD`, `JWT_SECRET`, optional `CHAT_WEBHOOK_URL`). The
  required ones use compose's `:?` form, so the stack refuses to start rather than fall back to a
  development default on a public host.

### Asset seeding fails loudly

A named volume mounted over a populated directory starts empty — Docker seeds it from the image
at that path, so tracked files underneath the mount are hidden, not copied. `assets/object` and
`assets/avatars` hold 8 and 40 tracked files respectively, including `avatars/1/default.*`, and
without seeding `/assets/avatars/1/default.htm` returned **500** through nginx.

`docker/beta/seed-assets.sh` restores them on every start with `cp -Rn` (no-clobber, so a runtime
upload always wins) and then **verifies the result rather than trusting cp's exit status** — some
implementations report failure when `-n` skipped everything, which is the normal case on a second
start, and the previous version silenced both the output and the status. A missing seed source or
a seed that did not land is fatal and the service does not start. Verified:

| case | result |
| --- | --- |
| fresh volume | 48 tracked files present in all three services; `/assets/avatars/1/default.htm` 200 |
| existing volume, novel runtime file | survives container recreation |
| existing volume, runtime file with a tracked name | keeps the runtime content, not the default |
| missing seed source | `FATAL missing seed source …`, exit 1, service does not start |
| unwritable (read-only) target | names every missing file, exit 1, service does not start |

One thing this uncovered is worth recording because `git status` cannot show it: `spa/assets/object`
is gitignored with eight files force-added, so five QA scratch files left in it by an earlier lane
were invisible to `git status` and were baked into the first build of these images.
`.dockerignore` now excludes `spa/assets/{object,avatars}/qa-*`.

### Restart policy, proven on recreated containers

`restart: unless-stopped` on `ct-api`, `ct-socket`, `nginx` and `db`. Proving it needs care:
`docker kill` is recorded by Docker as a *manual* stop and deliberately does not restart, which
reads as a broken policy. Each service process was therefore killed from the host PID namespace,
a genuine crash:

| service | RestartCount | outcome |
| --- | --- | --- |
| `ct-api` | 0 → 1 | back up automatically |
| `ct-socket` | 1 → 2 | back up automatically |
| `nginx` | 0 → 1 | back up automatically |
| `db` | 0 → 1 | back up automatically |

There is no nodemon in the beta API, so API recovery is Docker's, not a watcher's.

### nginx: WebSocket upgrade, and a real stale-upstream failure

`location /` proxies Socket.IO but carried no `proxy_http_version 1.1` and no
`Upgrade`/`Connection` headers — they were on `location /api`, which proxies plain JSON and never
upgrades. In a real browser the handshake failed with *"Unexpected response code: 400"* and every
client silently fell back to HTTP long-polling. Fixed with a `map $http_upgrade
$connection_upgrade` and the upgrade headers on `location /`; verified `101 Switching Protocols`
through nginx, real websocket transport on live clients, and long-polling still available as a
fallback (`EIO=4&transport=polling` returns the handshake advertising `upgrades: ["websocket"]`).

The transient 502 seen during container replacement turned out **not** to be transient. nginx
resolves a literal hostname in `proxy_pass` once, at config load, and holds that address for the
life of the process. Reproduced deliberately by holding the old address with a filler container so
`ct-api` came back on a different one: four consecutive probes 20 s apart all returned 502, with
no recovery. Fixed with `resolver 127.0.0.11` (Docker's embedded DNS) plus upstreams in variables,
which is what defers the lookup to request time. Re-verified by moving `ct-socket` from
`172.23.0.4` to `172.23.0.7` without touching nginx: index, API and WebSocket all stayed 200/200/
101.

### nginx: the API's 5 MB upload limit was unreachable behind a 1 MB proxy

`api/src/controllers/home.controller.ts` sets `IMAGE_FILESIZE_LIMIT = 5 * 1024 * 1024` and
answers an oversized home image with its own message. Nothing in `docker/nginx/vhost.conf` ever
set `client_max_body_size`, so nginx's built-in default of **1 MB** applied: every home image
between 1 MB and 5 MB was refused at the proxy with nginx's stock 413 page, and neither the
API's limit nor its error message could be reached. Verified against `nginx:alpine` that no
packaged config sets the directive.

This matters more on the beta than in development, because on the beta nginx is the *only*
published port — there is no way to reach the API around it. Fixed with `client_max_body_size
5m` on `location /api`, commented to be kept in step with `IMAGE_FILESIZE_LIMIT`.

The same block also still sent a literal `Connection: upgrade` on every request. That is the
exact thing the `map $http_upgrade $connection_upgrade` added for `location /` exists to avoid,
and `location /api` proxies plain JSON that never upgrades, so it now uses the same conditional.
`nginx -t` passes on the resulting file.

### Database bootstrap is now a single deterministic command

`npm run db:init` **cannot succeed against this compose stack**: compose already creates the
schema via `MYSQL_DATABASE`, and `db/scripts/create-db.ts` calls `process.exit(1)` when the
database exists, aborting the chain before `db:migrate` and `db:seed` ever run.

`migrate:latest` on an empty schema then fails at `20260309032638_add_voting_tables.ts`, which
inserts a demo vote row referencing `place.id = 1` — a row the seeds only create afterwards. It
stops at 32 of 43, and because MySQL 5.7 DDL is not transactional the three `vote_*` tables are
left behind, so a naive retry fails differently with `ER_TABLE_EXISTS_ERROR`. Reaching 43/43 by
way of a deliberate failure and a manual cleanup is not a procedure.

`docker/beta/bootstrap-db.sh` never triggers the failure. It creates the database idempotently,
**refuses to run against a database that already has tables**, migrates up to the last migration
before the voting one, runs `02-places.seed.ts` so place 1 exists, migrates the remainder, then
runs every other seed. The pivot is expressed as a migration *name*, not a count, so migrations
added later cannot silently move it. No historical migration was modified.

It runs in a separate `tooling` image target, which keeps ts-node (migrations and seeds are `.ts`);
the long-running API image does not have it. It is behind a compose profile, so an ordinary `up`
can never start it:

```bash
docker compose -f docker-compose.beta.yml --profile bootstrap run --rm ct-bootstrap
```

Tested twice from an empty MySQL 5.7 database — the beta schema and a second disposable schema —
both reaching **43/43 migrations and all 12 seeds** in one command with no manual step. Re-running
it against either populated database stops at *"Refusing to bootstrap: … already has 27 table(s)"*.

### Test results

With the integration specs armed against a disposable schema
(`CTR_INTEGRATION_TEST_DB=ctr_beta_itest`, bootstrapped by the script above): **630 passed, 1
skipped, 34 suites**. The three failing suites are the same empty stubs as on upstream `master`
(`club.service.spec.ts`, `wallet.service.spec.ts`, and `role.repository.spec.ts`, which is not a
spec at all — it contains a copy of a repository class). `tsc --noEmit` and
`tsc --project tsconfig.prod.json` both clean; `eslint` reports exactly the same 11 errors and 2
warnings on the touched controllers as their `HEAD` versions do, so this lane added none.

Re-measured at commit time with a plain `npx jest --runInBand` and no database reachable:
**594 passed, 25 skipped, 13 failed, 4 suites failing**. The 13 failures are all
`object.service.atomic.spec.ts` hitting the unguarded-connection gap described below; pointed at
a real MySQL 5.7 it is **13/13 green**. The other three failing suites are the empty stubs. The
four new specs in this lane contribute **167 passing tests**. The SPA
suite is 53/53. The SPA production build is exercised on every image build.

**Coverage gap, stated plainly:** only two files opt into a real database —
`daily-credit.integration.spec.ts` and `role-credit.integration.spec.ts`. A third,
`object.service.atomic.spec.ts`, talks to a real database but has **no opt-in guard at all**: it
connects to whatever `DB_HOST`/`DB_DATABASE` the environment names, and only passes because the
host cannot resolve `db` now that MySQL is no longer published. That is worth a guard. There is no
real-DB spec for Mall moderation, rejection refunds, Mall upload or export, `member_data`, place
access, home-image moderation races, News, or Live Event.

### Runtime QA on the beta stack

Two citizens joined room 1 over real WebSocket transport while a third uploaded five Mall objects
through nginx:

| upload | HTTP | socket PID | RestartCount | A disconnects | B disconnects |
| --- | --- | --- | --- | --- | --- |
| 1 | 200 | 38 | 0 | 0 | 0 |
| 2 | 200 | 38 | 0 | 0 | 0 |
| 3 | 200 | 38 | 0 | 0 | 0 |
| 4 | 200 | 38 | 0 | 0 | 0 |
| 5 | 200 | 38 | 0 | 0 | 0 |

Both clients received every chat message sent between uploads, each saw exactly one `ROOM_STATE`
for the whole session (so nothing forced a re-JOIN), and both stayed on `websocket`. Separately,
crashing the socket process mid-session produced exactly one disconnect per client, automatic
reconnection within ~1.3 s, a fresh `ROOM_STATE`, and working chat afterwards.

## The CTNG server, and what deployment would take

Inspected read-only on 2026-08-29. **Nothing on it was created, changed, redeployed or removed.**

`64.44.177.139` is the CTNG origin — `hostname` answers `cybertownng.com`, Ubuntu 24.04.4 LTS,
4 CPU, 7.7 GiB RAM, 51 GiB free on `/`, Docker 29.7.1 with Compose v5.3.1, up 25 days.

An earlier note in this repository treated `172.67.219.16` as the VPS. It is not a machine: it is
one of the two Cloudflare edge addresses `admin.cybertownng.com` resolves to (the other is
`104.21.78.87`). The old CTR beta host `172.93.163.158` is a different box entirely and is not
involved in this lane.

The server runs Coolify 4.1.2 and nothing else — six Coolify containers (app, Postgres, Redis,
realtime, sentinel, and a Traefik v3.6 proxy) and **zero application containers, zero services,
zero managed databases and no application volumes.** It is an unused Coolify install waiting for
its first deployment. Coolify holds exactly one project, `CTNG`, with one environment,
`production`, and one destination: the local server on the `coolify` docker network.

`admin.cybertownng.com` is **the Coolify dashboard itself** — it is the value of Coolify's own
`instance_settings.fqdn` ("CTNG Admin"), and Traefik carries three routers for it. It must keep
pointing where it points; the CTR beta needs its own hostname. `beta.cybertownng.com` does not
currently resolve, so it is free.

Ingress today is Cloudflare-proxied DNS to this origin, terminating at Traefik on 443 with a
Let's Encrypt certificate, with Cloudflare Access (Zero Trust) in front of the dashboard. There is
no Cloudflare Tunnel and none is needed: `cloudflared` is not installed and no tunnel service
runs. The host has no firewall of its own (`ufw` inactive, iptables INPUT policy ACCEPT), but
80/443 are unreachable from outside Cloudflare — the network filter is upstream of the host, and
the repository's own `ctng-admin-tls.yaml` records that "the firewall only admits Cloudflare
ranges". Zone SSL mode is `full`.

So the shape is **Cloudflare proxied DNS → 64.44.177.139**, not a tunnel — the same shape the
dashboard already uses.

### The approved deployment architecture

The beta is deployed as a **normal Coolify Git-based Docker Compose application** (Coolify's
standard mode, *not* Raw Compose Deployment) in project `CTNG`, environment `production`, built
from `docker-compose.beta.yml` on this branch. Coolify owns:

- the deployment and redeploy/restart lifecycle, and the logs, all from its dashboard;
- the resource-specific Docker network the services are attached to;
- Traefik connectivity and the generated proxy routing;
- the domain assignment — `beta.cybertown.dev` is mapped to the **nginx** service on **container
  port 80**;
- the environment and secrets, which live in the Coolify application environment and are not in
  this repository.

Two things follow, and they are why this file changed after the pre-deployment gate:

- **nginx does not publish host port 8001, or any host port.** Traefik already owns host 80 and
  443. A published port would put the stack beside the proxy rather than behind it — outside its
  TLS and outside the Cloudflare filter that is the only thing keeping the origin private. The
  `ports:` entry is therefore `expose: ["80"]`, and `BETA_HTTP_PORT` is gone.
- **No hand-authored Traefik configuration is required or wanted.** No
  `traefik.http.routers.*` labels in the compose file, no custom `coolify` network declared in
  it, and no file dropped into `/data/coolify/proxy/dynamic/`. Coolify generates the routing from
  the configured domain, and hand-written routing would be invisible to the dashboard and would
  drift the moment Coolify regenerated its own. An earlier draft of this document said the
  `ports:` entry should be "replaced by Traefik labels"; that was the manual-Traefik path, and it
  is not the path taken.

nginx remains the sole ingress. The API, the socket server and MySQL are reachable only over the
application network, by compose service name (`ct-api:3000`, `ct-socket:8000`, `db:3306`), and no
domain is assigned to any of them.

## Not done in this lane

Deployment itself. Nothing was built on, deployed to, migrated on, or routed to the CTNG server.
`admin.cybertownng.com` is unchanged, `beta.cybertown.dev` is untouched and remains the rollback
target, and no migration has been run against any beta database.

## Rollback

The branch is additive and isolated: `git branch -D beta-integration-2026-08` removes it, and
neither `master` (fork or upstream), `beta`, nor any candidate PR branch was modified or
force-pushed.
