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

## Included

Every candidate below was already rebased onto current upstream `master` (`behind = 0`), so each
merge is a plain forward merge, in dependency order.

| PR | title | source head | decision |
|---|---|---|---|
| upstream #412 → fork #5 | socket presence foundation + reconnect/resync | `a1bae5a2` (contains `8cb4622b`) | INCLUDE — merged as one stack |
| fork #6 → #9 → #10 | access rights, deputy reconciliation, primary-role atomicity | `702af0b1` | INCLUDE — tip only; carries the 25-commit fork foundation (`2e96fa2`) |
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

## Not done in this lane

Deployment. SSH to the beta host was unavailable, so nothing was built, deployed, migrated, or
routed. `admin.cybertownng.com` is unchanged, `beta.cybertown.dev` is untouched and remains the
rollback target, and no migration has been run against any beta database.

## Rollback

The branch is additive and isolated: `git branch -D beta-integration-2026-08` removes it, and
neither `master` (fork or upstream), `beta`, nor any candidate PR branch was modified or
force-pushed.
