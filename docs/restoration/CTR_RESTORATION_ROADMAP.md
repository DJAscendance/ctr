# CTR Restoration Roadmap

**Ratified 2026-08-29** against deployed release `ba8c6a3a358ca68e7a75f7d56e60dc4613f1143a`.

Companion to [`CTR_RESTORATION_BASELINE.md`](CTR_RESTORATION_BASELINE.md), which holds the
evidence for every claim here. Board:
[Project #2 — CTR Restoration Tracker](https://github.com/orgs/Cyber-Town-Next-Gen/projects/2).
Umbrella: [`ctr-restoration#28`](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/28).

This document answers one question: **what order do we build the remainder in.**

---

## Current baseline

| | |
|---|---|
| Source | `DJAscendance/ctr` @ `beta-integration-2026-08` |
| Release | `ba8c6a3a358ca68e7a75f7d56e60dc4613f1143a` |
| Deployed | `beta.cybertown.dev` — Coolify app `ctr-beta` on the CTNG host |
| Verified | 2026-08-29, on the host, by content — four containers on that SHA, `RestartCount=0`, spa/api `200` |

**Completed milestones:** historical gap recon (closed) · BANK-A1 citizen CityCash transfer
(deployed, verified in production) · economy corrected to deployed runtime config · beta
pre-deployment security hardening · first Coolify deployment · fresh-bootstrap stabilization.

---

## The order

### P0 — beta readiness and safety, before broader access
Nothing here is historical restoration. It is what has to be true before more people use beta.

| # | Lane | Issue | Status | Blocker |
|---|---|---|---|---|
| 1 | `BETA-HOME-LAYOUT` — open real residential lots | [#12](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/12) | Blocked | **Owner:** which neighborhoods/lots |
| 2 | `BETA-MAIL-A1` — deliverable outbound mail | [#13](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/13) | Ready | Owner picks a delivery path |
| 3 | `GENERAL-INBOX-SECURITY` — safe by construction | [#14](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/14) | Ready | none |
| 4 | `BETA-ACCESS-A1` — IP bypass for the Access gate | [#15](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/15) | Blocked | **Owner:** CIDR list |
| 5 | `SECURITY-CLEANUP-A1` — credential rotation | [#16](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/16) | Blocked | **Owner-deferred**, by decision |

`BETA-HOME-LAYOUT` is first because it gates the most: with no lots open, nobody can settle a
home, and every home-gated behaviour — including the Bank's both-parties-own-a-home
precondition — is untestable on beta. It is also the cheapest, being configuration.

`SECURITY-CLEANUP-A1` is deliberately **last within P0**: rotating credentials mid-deployment
risks breaking a deploy in flight. It must still land before broader tester access.

### P1 — core historical restoration
| # | Lane | Issue | Status | Depends on |
|---|---|---|---|---|
| 6 | `CASH-A2` — PlaceCash / Fundbox wallets | [#17](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/17) | Ready | BANK-A1 (done) |
| 7 | `HIST-TXN` — citizen transaction history | [#20](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/20) | Ready | BANK-A1 (done) |
| 8 | `ECON-F2` — 50 CC property-move charge | [#19](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/19) | Ready | none |
| 9 | `ECON-F1` — 2,000 CC referral bonus | [#18](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/18) | Ready | none |
| 10 | `ADMIN-A1` — admin parity (3 sub-deliverables) | [#21](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/21) | Partly blocked | Owner decision on jail/tribunal |
| 11 | `ASSET-EXTERNAL` — obtain the lost docroot | [#23](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/23) | Blocked | **Owner:** sourcing |

### P2 — targeted recon and follow-through
| # | Lane | Issue | Status | Blocker |
|---|---|---|---|---|
| 12 | `Q7` — payroll cadence and the −20 debit | [#22](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/22) | Blocked | Offline VM 137 `M` table |
| 13 | Wallet write-path audit (narrowed) | [#11](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/11) | Ready | none |

### P3 — presentation, content, backlog
| # | Lane | Issue |
|---|---|---|
| 14 | `ASSET-WAYBACK` — fetch the 247 recoverable paths | [#24](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/24) |
| 15 | `HIST-UI` — period presentation parity | [#25](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/25) |
| 16 | `BACKLOG-P3` — evidenced but unscheduled capabilities | [#26](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/26) |

### Governance
| # | Lane | Issue | Status |
|---|---|---|---|
| 17 | `ORG-REPO-A1` — canonical org repository (**plan only**) | [#27](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/27) | Blocked — owner approval |

---

## Why this order, where it departs from the obvious

**`HIST-TXN` is ranked above both `ECON-F` lanes** even though it is a product addition
rather than historical parity. BANK-A1 already landed the ledger; the citizen-facing view is
a small read-only surface over data that exists, and it is what makes every subsequent
economy change observable to the people testing it. Shipping economy changes that citizens
cannot see is the harder path.

**`ECON-F2` (property move) is ranked above `ECON-F1` (referral)** despite referral being
the larger historical amount. `ECON-F2` is a charge on an existing flow; `ECON-F1` requires
building a referral workflow that has no counterpart in CTR at all — no column, no table, no
signup parameter. `economy.ts` explicitly refuses to wire the constant up without it. Smaller
and lower-risk goes first.

**`CASH-A2` leads P1** because it is the largest coherent historical gap remaining (twelve
matrix rows), its evidence is complete, and it reuses BANK-A1's proven transfer machinery
rather than needing new primitives. It also unblocks `MALL-14` and `COMM-09`, which are
absent only because the place-wallet primitive does not exist.

**`ASSET-EXTERNAL` sits in P1 despite being unblockable by engineering.** It was raised from
its earlier ranking once the Archive was proven unable to close the object gap — 9 recoverable
of 46,424. If external media exists it should be found now, while the people who would know
are still engaged; if it does not, the loss should be recorded as permanent so no future lane
re-litigates it.

**`Q7` blocks nothing.** It is ranked P2 not because it is unimportant but because every
implementation lane proceeds without its answer.

---

## Deliberately not on this roadmap

| Not here | Why |
|---|---|
| A private-mail lane | Assessed and closed as `RESTORED`. CTR's home-keyed inbox matches the historical `i<HOM><date>` design; no missing capability was found. |
| A second Bank lane | `BANK-A1` is done and deployed. Update it, do not duplicate it. |
| Lottery / Game of Chance | `HISTORICALLY_DECOMMISSIONED` — zero requests in the final-era window. |
| Instant messaging, buddy list, events, news CGI, ccenter | All `HISTORICALLY_DECOMMISSIONED`. |
| Subscription billing (`M.RGK`), Java/BXApplet delivery | `NOT_RESTORATION_TARGET`. |
| Broad Wayback or URL archaeology | **Closed.** Run to exhaustion; settled negatives. |
| Interest, loans, tax, rent, salary; timer bonus | No evidence they ever ran. |
| A residential-lot seed | Explicitly rejected. Lots are administratively provisioned. |
| Cherry-picking `DJAscendance/ctr#11` | Superseded — see below. |

### PR #11 — daily credit
`DJAscendance/ctr#11` (*"Wait for the daily login credit before returning the token"*) is
reconciled as **SUPERSEDED / EFFECTIVELY INCORPORATED**. Its behaviour is inherited by later
upstream work and by the current beta daily-credit implementation. **Do not plan a
cherry-pick.** Its remaining value is as provenance for [#4](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/4).

---

## Board conventions

Project #2's existing fields are used as-is; the board was **not** redesigned.

| Concept | Field value used |
|---|---|
| Done | `Status: Done` |
| Ready to start | `Status: Ready` |
| Blocked — owner decision | `Status: Blocked` + `Work Type: Decision` |
| Blocked — historical recon | `Status: Blocked` + `Work Type: Research` |
| Backlog | `Status: Research` |

**Known limitation:** `Area` has no *Economy*, *Banking* or *Security* value — it was defined
for the City Jobs lane. Economy and security lanes are therefore left with `Area` unset
rather than mis-tagged. Adding options to a `ProjectV2SingleSelectField` replaces the whole
option list and can drop existing item values, so it was **not** done unilaterally. Adding
*Economy* and *Security & Ops* is recommended, as an owner action.

---

## Next implementation lane

**`BETA-HOME-LAYOUT` ([#12](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/12))** — but it is owner-blocked, and it is configuration
rather than code.

**The next lane to write code in is `GENERAL-INBOX-SECURITY` ([#14](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/14))**: it is the
only P0 item with no owner blocker, it is small and well-bounded, and it removes a
stored-XSS foot-gun from the exact subsystem that `HIST-TXN` and `CASH-A2` are both about to
write into.
