# Beta Stabilization Tracker

The single source of truth for Beta stabilization work. Created from the completed
**BETA-STAB-000** census.

Every stabilization item lives here. An item that is not in this file is not being
worked on. An item's state here outranks any note, branch name, memory, or chat
summary that says otherwise.

- **Live Beta branch:** `beta-integration-2026-08` on `fork` (`DJAscendance/ctr`)
- **Live Beta SHA at tracker creation:** `840a771827cb5345067298a11608e7d0bf468e63`
- **Upstream:** `origin` (`CybertownRevival/ctr`), default branch `master`

---

## Allowed states

An item may only be in one of these states. No other word is a state.

| State | Meaning |
|---|---|
| `NEW` | Reported. Not yet looked at. |
| `TRIAGE` | Being understood. Scope and root cause not yet settled. |
| `IN PROGRESS` | A write lane is open and editing files. |
| `QA READY` | Implementation finished. Candidate waiting for independent QA. |
| `QA PASS` | Independent QA passed the candidate. |
| `PR READY` | Candidate committed. Ready for a Draft PR. |
| `RELEASE READY` | PR approved and gated. Ready to deploy to Beta. |
| `LIVE` | Deployed to Beta. Live smoke not yet complete. |
| `CLOSED` | Live smoke passed. Work is finished. |
| `BLOCKED` | Cannot proceed. The blocker must be named in the item. |

---

## Single-writer rule

**Only one implementation lane may modify Beta at a time.**

Parallel work is allowed only when it writes nothing to the product:

- read-only archaeology
- independent QA
- history review
- documentation review

Every write lane begins from the **current live Beta SHA** and records that SHA in its
item below.

**If Beta moves while a lane is open, the lane stops.** There is no silent rebase. The
lane reports the drift, keeps its candidate intact, and waits for a decision.

---

## Release flow

```
MAIN uncommitted candidate
  -> independent QA
  -> immutable commit
  -> Draft PR
  -> release gate
  -> Beta deploy
  -> live smoke
  -> CLOSED
```

For an SPA-only lane with no database or API change, the release report may state
**`NO_DB_CHANGE`**. The deployed SHA must still be proven on the live host. This does
not relax the general backup policy for any other lane.

---

## Active queue

| ID | Title | Priority | State |
|---|---|---|---|
| BETA-REG-001 | Admin transaction reason label repair | P1 | QA READY |
| BETA-REG-002 | Jail Enter Cells visible in 2D | P1 | TRIAGE |
| SEC-CLUB-001 | `deleteClub` hangs instead of returning 403 | P1 | TRIAGE |
| BETA-REG-003 | Admin controller cluster item | — | TRIAGE |
| BETA-REG-004 | Admin controller cluster item | — | TRIAGE |
| SEC-ADMIN-001 | Admin controller cluster item | — | TRIAGE |
| ACCOUNT-001 | Account removal completeness | — | TRIAGE |
| SEC-PLACE-001 | Place-access root asymmetry | — | TRIAGE |
| MSG-AUTH-001 | Unauthenticated place message history | — | TRIAGE |
| BETA-UI-001 | Retired beta signup surface | P2 | TRIAGE |
| BETA-UI-002 | Mall checker presentation | P2 | TRIAGE |
| BETA-UI-003 | BETA badge sits on the right edge | P2 | TRIAGE |
| ROUTE-001 | — | — | TRIAGE |
| ADMIN-CC-001 | No admin CityCash control | — | TRIAGE |
| ADMIN-XP-001 | No admin XP control | — | TRIAGE |
| OUTLANDS-3 | — | — | TRIAGE |
| MODERN-001 | — | — | TRIAGE |

Closed: CTBL-0025, AUTH-SPA-001. See [Closed items](#closed-items).

---

## BETA-REG-001 — Admin transaction reason label repair

| Field | Value |
|---|---|
| Priority | P1 |
| State | QA READY |
| Owner lane | MAIN |
| Base SHA | `840a771827cb5345067298a11608e7d0bf468e63` |
| Worktree | `/home/ryan/cybertownrevival/.worktrees/ctr/beta-reg-001-bank-labels` |
| Branch | `fix/beta-reg-001-bank-labels` |
| GitHub issue | — |
| Candidate SHA | — |
| PR | — |
| Live SHA | — |
| Evidence | BETA-STAB-000 sections 7-15; independent QA round 1 (FAIL, repaired) |
| QA history | Round 1: FAIL - false weekly prefix boundary. Repaired by MAIN. |

**Scope.** SPA display only. The bank data is correct, the transfer write path is
correct, and no row, wallet, migration, or API file is touched.

**Root cause.** `spa/src/pages/admin/user/TransactionHistory.vue` held its own pair of
parallel arrays and looked a reason up with `indexOf()`. The list did not cover the
whole server `TransactionReason` enum, and the `-1` branch returned the literal
`"Weekly Role Credit"`. So a member-to-member CityCash transfer and an immigration
grant both rendered as a weekly role credit. `spa/src/pages/admin/transactions/
search.vue` carried the same incomplete list and rendered `reasonDisplay[-1]`, a blank
cell. Both lists also used the singular `object-unsold-instance-refund`, which the API
never writes.

**Fix.** One shared pure function, `spa/src/helpers/transaction-reason.helper.ts`. Both
screens call it and neither keeps a private list. An unknown reason renders its own raw
value and never borrows a known label.

**Independent QA round 1: FAIL.** QA proved a false-prefix boundary defect. The first
candidate matched weekly credit with `startsWith("weekly-role-credit")`, so
`weekly-role-creditish` and `weekly-role-credit for abc` were shown to a moderator as
"Weekly Role Credit" - the same class of lie the lane exists to remove.

**Repair.** The weekly match is now strict: the bare enum value exactly, or the anchored
pattern `^weekly-role-credit for \d+$` (the shape `CreditRepository` really stores).
Nothing else is a weekly credit. The repair touched only the helper and its test; no
admin page, no API file, no accepted label changed. Eleven weekly-lookalike strings are
now asserted to stay raw.

**Accepted labels, not to be reopened.** `member-to-member` -> CityCash Transfer ·
`immigration-grant` -> Immigration Grant · `system-to-member` -> Cybertown Transfer ·
`item-purchase` -> Item Purchase · `object-unsold-instances-refund` -> Mall Unsold
Refund · `object-purchase` -> Mall Item Purchase · `object-profit` -> Mall Item Sold.

**Next action.** Independent QA rerun of the uncommitted candidate.

---

## BETA-REG-002 — Jail Enter Cells visible in 2D

| Field | Value |
|---|---|
| Priority | P1 |
| State | TRIAGE |
| Evidence | BETA-STAB-000 sections 16-21 |

**Next action.** Require authorized Jail / Security / Admin staff, plus 3D mode, plus
the Jail place, before the Enter Cells control is shown or acts.

Not implemented in the BETA-REG-001 lane.

---

## SEC-CLUB-001 — `deleteClub` hangs instead of returning 403

| Field | Value |
|---|---|
| Priority | P1 |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

**Scope note.** The club **owner authorization bypass** is already fixed and live.
Commit `21133277` ("fix(club): close owner authorization bypasses", from
`fork/security/post-ctbl0032-club-fixes`) is an ancestor of Beta `840a7718`. It enforces
club ownership before `changeMemberStatus` mutates member status, stops `updateClub`
after a denied ownership check, and carries a 164-line authorization regression test.

What remains open is **only** the denial shape: `deleteClub` hangs for an unauthorized
caller instead of returning 403. Do not describe the owner bypass as still open.

---

## Admin controller cluster — BETA-REG-003, BETA-REG-004, SEC-ADMIN-001, ACCOUNT-001

These stay **four separate IDs**. They are tracked as one shared future implementation
lane only because they all edit `api/src/controllers/admin.controller.ts`, and the
single-writer rule means they cannot be worked in parallel anyway.

None of them is implemented now.

### BETA-REG-003

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |
| Shared lane | admin controller cluster |

### BETA-REG-004

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |
| Shared lane | admin controller cluster |

### SEC-ADMIN-001

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |
| Shared lane | admin controller cluster |

### ACCOUNT-001 — Account removal completeness

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |
| Shared lane | admin controller cluster |

**Proven sub-defect.** `removeAccount` checks `canAdmin()` but never compares
`session.id` against the target id, so an admin can remove their own account. No
self-removal prevention exists.

**Settled during the census.** Wallet and ledger deletion **is** present:
`MemberService.removeAccount` deletes role assignments, bans, transactions by
`wallet_id`, votes, the member row, and the wallet, inside one optional transaction. An
earlier census note claiming the wallet was left behind was corrected. Whether deleting
the whole ledger is the *right* behaviour is a separate policy question, not a proven
defect of this item.

---

## SEC-PLACE-001 — Place-access root asymmetry

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |
| Blocker note | Original defect report not yet recovered |

`api/src/services/place/place-capability.service.ts` has no `getAccessLevel()` and no
`canAccess()` helper; hierarchy traversal walks `parent_place_id` directly. The census
suggests the asymmetry may already be fixed elsewhere.

**Do not close this from inference.** The original defect report must be recovered
first, so closure is checked against what was actually reported.

---

## MSG-AUTH-001 — Unauthenticated place message history

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Classification | **POLICY DECISION** |
| Evidence | BETA-STAB-000 census |

`GET /message/place/:placeId` takes no session. `getResults()` validates only that
`placeId` is a positive integer, applies `jailChatExclusions()`, and returns the place's
message history.

This is **not** labelled a proven security defect. The current code intentionally
permits ordinary unauthenticated place history outside the Jail privacy rules.

**Next action.** Owner policy decision on whether ordinary place history should stay
public.

---

## BETA-UI-001 — Retired beta signup surface

| Field | Value |
|---|---|
| Priority | P2 |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

**Must be preserved:**

- the `beta_signup` table
- its migration history
- public beta landing route compatibility

A future lane may remove the retired UI and API code **only after an export decision**
has been made about the collected data. Nothing is removed now.

---

## BETA-UI-002 — Mall checker presentation

| Field | Value |
|---|---|
| Priority | P2 |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

**No longer blocked.** This item is no longer waiting on confirming commit `183acaab`.
The owner has chosen a new direction.

**Goal.** Keep the current secure and working Mall checker behaviour. Remove the
SaaS-style / AI-style presentation. Make the checker direct, compact, readable, and easy
for Mall staff to use.

**Hard limits:**

- Do **not** plan a wholesale revert to `183acaab`.
- Do **not** restore Vue 2 code.
- Do **not** remove later X_ITE 16, Vue 3, routing, security, or workflow fixes.

### SlopMonster — visible copy only

The future BETA-UI-002 lane uses **SlopMonster**
(<https://github.com/ItsssssJack/SlopMonster/blob/main/SKILL.md>) for **visible copy**.

Its required loop:

1. LINT
2. REWRITE
3. CLEANSE WITH A DIFFERENT MODEL FAMILY
4. RE-LINT

Ship visible copy only at **5 / 5**.

Its rule holds: **never invent proof.** Do not invent counts, ratings, claims,
testimonials, or performance statements.

**Scope limit.** SlopMonster is a copy-cleaning skill. It is **not** the UI design
specification.

| SlopMonster cleans | Separate human-centered UI rules cover |
|---|---|
| button text, headings, instructions | layout, spacing |
| status text, helper text | control hierarchy, information density |
| modal copy, empty states, review wording | workflow order, responsive behaviour |

Do not use generic SaaS cards, dashboards, badges, KPI blocks, or marketing patterns
unless the Mall workflow actually needs them.

---

## BETA-UI-003 — BETA badge sits on the right edge

| Field | Value |
|---|---|
| Priority | P2 |
| State | TRIAGE |
| Evidence | `App.vue` `site-env-badge` uses `right: 0` |

**Next action.** Move the fixed badge to the left and reverse the matching border edge.

Not implemented in the BETA-REG-001 lane.

---

## ROUTE-001

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

Census detail is not reproduced here because it was not recoverable in the BETA-REG-001
lane. Recover it from the census before opening a write lane.

---

## ADMIN-CC-001 — No admin CityCash control

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

`api/src/controllers/admin.controller.ts` has no CityCash grant or modify endpoint. The
SPA shows `cc` amounts in transaction views for reading only. The capability does not
exist; this is missing work, not a broken feature.

---

## ADMIN-XP-001 — No admin XP control

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

`api/src/controllers/admin.controller.ts` has no XP modify endpoint. XP is displayed
read-only in `spa/src/pages/admin/roles/roles.vue` and the user info view. The
capability does not exist; this is missing work, not a broken feature.

---

## OUTLANDS-3

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

Census detail is not reproduced here because it was not recoverable in the BETA-REG-001
lane. Recover it from the census before opening a write lane.

---

## MODERN-001

| Field | Value |
|---|---|
| Priority | — |
| State | TRIAGE |
| Evidence | BETA-STAB-000 census |

Census detail is not reproduced here because it was not recoverable in the BETA-REG-001
lane. Recover it from the census before opening a write lane.

---

## Closed items

These are finished. **Do not put either back in the active queue.**

### CTBL-0025

| Field | Value |
|---|---|
| State | CLOSED |
| Live SHA | `840a771827cb5345067298a11608e7d0bf468e63` |

Admin audit trail: foundation (Phase A), atomic admin writes (Phase B), and required
operator reasons plus private-read access auditing (Phase C). All live and smoke-tested.

### AUTH-SPA-001

| Field | Value |
|---|---|
| State | CLOSED |
| Live SHA | — |
| Evidence | `ban-navigation.helper.ts` wired in `main.ts` |

`decideBannedNavigation()` checks the **ban type before the route**, so a full ban ends
the session whatever route was asked for. Only a `jail` ban keeps the session. An
unknown ban type fails closed.
