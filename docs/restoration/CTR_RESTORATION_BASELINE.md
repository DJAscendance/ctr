# CTR Restoration Baseline — Historical Cybertown ↔ Current CTR

**Ratified 2026-08-29.** This document is the authoritative capability reconciliation between
historical Cybertown and Cybertown Revival. It supersedes every earlier gap list.

| | |
|---|---|
| **Historical target** | Final-era **deployed** Cybertown, wherever evidence for it exists |
| **Current target** | The CTR beta deployed at `beta.cybertown.dev` |
| **Current deployed CTR SHA** | `ba8c6a3a358ca68e7a75f7d56e60dc4613f1143a` |
| **Source** | `DJAscendance/ctr` @ `beta-integration-2026-08` |
| **Deployment verified** | 2026-08-29 — all four containers on that SHA, `RestartCount=0`, spa/api `200` |
| **Historical recon state** | **Broad recon CLOSED** |
| **Future archaeology** | **Targeted only** — against a specific unresolved implementation question |
| **Purpose** | Authoritative CT → CTR capability reconciliation |
| **Companion documents** | [`CTR_RESTORATION_ROADMAP.md`](CTR_RESTORATION_ROADMAP.md) · [`CTR_RESTORATION_BASELINE.tsv`](CTR_RESTORATION_BASELINE.tsv) (machine-readable) |
| **Board** | [Project #2 — CTR Restoration Tracker](https://github.com/orgs/Cyber-Town-Next-Gen/projects/2) |
| **Umbrella issue** | [`ctr-restoration#28`](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/28) |

## How to use this document

Read the roadmap if you want to know **what to build next**. Read this if you want to know
**what a thing was, what it is now, and why they differ**. Every row carries evidence on both
sides; no row ends in limbo.

If you are about to reopen a historical question, check §3 and §4 first. Most of them are
already settled, and re-deriving a settled answer is how this project has previously lost
weeks.

---

## 1. Historical source precedence

When sources conflict, the higher row wins. This ordering is not negotiable per-question.

| # | Source class | Example |
|---|---|---|
| 1 | **Deployed runtime config / deployed historical source** | `money.cfg`, `exper.cfg`, `phase3.pl` |
| 2 | Final server templates, binaries, logs, database evidence | `bank_transfers.log`, `templates/fundbox/` |
| 3 | Earlier historical source versions | `moneyold.cfg`, `experold.cfg` |
| 4 | Wayback / public documentation | 2007 rate chart, 2010 public FAQ |
| 5 | Secondary recollection | forum posts, memory |

**An earlier public FAQ does not override a later deployed runtime config.** A published page
is evidence about what was *advertised*; a config file is evidence about what the server was
*configured to pay*. Where both survive, the config wins and the discrepancy is recorded
rather than averaged.

Eras are never silently blended. Where sources conflict, the conflict, the winner, and the
reason are all recorded.

---

## 2. Status vocabulary

| Status | Meaning |
|---|---|
| `RESTORED` | Present in CTR with historical behaviour, with current source evidence |
| `RESTORED_WITH_INTENTIONAL_MODERN_SAFETY_DIVERGENCE` | Present, deliberately differing — a safety, correctness or product decision, **not** a parity failure |
| `PRESENT_PARTIAL` | Partly present; a real remaining gap |
| `MISSING_ACTIONABLE` | Absent, evidenced, and has an owning lane |
| `UNKNOWN_TARGETED_RECON_REQUIRED` | A historical fact is genuinely unresolved; a narrow research issue owns it |
| `CONTENT_GAP_ONLY` | The application works; the historical *content* is missing or lost |
| `HISTORICALLY_DECOMMISSIONED` | Cybertown itself had stopped running it by the final era |
| `NOT_RESTORATION_TARGET` | Out of scope by nature — commercial billing, obsolete plugins |
| `OWNER_DECISION_REQUIRED` | Blocked on a product choice, not on evidence or engineering |

Hedging words — "maybe", "sort of", "probably" — do not appear in a status. Where confidence
is genuinely limited, the row carries an explicit evidence class instead.

**Evidence classes** (carried through from the recon): `PROVEN_RUNTIME` · `PROVEN_SOURCE` ·
`PROVEN_PRODUCTION_USE` · `PROVEN_ASSET` · `LIKELY` · `SPECULATIVE`.

---

## 3. Owner decisions — settled. Do not reopen these.

These are **not** open historical questions. They are decisions. A future agent that reopens
one is redoing closed work.

1. **The economy uses deployed runtime config, not published rates.** Immigration 20,000 CC ·
   ordinary daily 80 CC / 5 XP · employed daily 336 CC / 21 XP · referral 2,000 CC · property
   move 50 CC charge · first homestead 50 XP. Recorded with provenance in
   `api/src/libs/economy.ts`.
2. **First homestead XP pays +50, once per member ever.**
3. **The Bank requires server-side idempotency.** A retried transfer moves money once.
4. **Bank self-transfer is refused.**
5. **The Bank keeps the historical both-parties-own-a-home precondition.** It was implementable
   either way; the authentic behaviour was chosen.
6. **Home lots are administratively provisioned.** There is deliberately no automatic
   residential-lot seed. A fresh database having zero available lots is *configuration*, not a
   missing feature and not a bootstrap defect.
7. **Credential rotation is deferred** until the beta deployment lanes complete, and must
   happen before broader tester access.
8. **The Cloudflare IP-only gate waits on owner-supplied CIDRs.** IPs must never be inferred.
9. **Historical insecurity is not a restoration target.** `phase3.pl` carried shell-command
   injection, a non-atomic read-modify-write, a no-rollback branch and an unchecked ticket.
   CTR restores the *behaviour*, never the algorithm.

### Outstanding owner decisions
| # | Decision | Lane |
|---|---|---|
| A | Which beta neighborhoods and lots to open for settlement | [#12](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/12) |
| B | Beta outbound-mail delivery path | [#13](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/13) |
| C | CIDR list for the beta Access bypass | [#15](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/15) |
| D | Whether jail/tribunal is a restoration target at all — it was **already 404 in the final era** | [#21](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/21) |
| E | Whether any external media holds the lost docroot | [#23](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/23) |
| F | Whether guest/visitor access is wanted — CTR is members-only by design | [#26](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/26) |
| G | Timing and approval for the org-repository migration | [#27](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/27) |

---

## 4. Historical unknowns — targeted recon only

**Exactly one open historical question remains.** Everything else that is unbuilt is a
*known* missing feature, not an unknown. Keeping these apart is the point of this section.

| Q | Question | Blocked on | Issue |
|---|---|---|---|
| **Q7** | Cadence and rule set of the periodic payroll sweep, and the purpose of the −20 debit on 679 members | The offline VM 137 FairCom `M` table | [#22](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/22) |

Known and **not** to be re-derived: the 2010-12-31 hour-00 sweep credited **34,972** distinct
member IDs, **+48,656,105 CC** net, modal individual credit **1,400** with a role-graded tail,
and debited **679** members exactly **−20**. The coherent log window is six days only,
2010-12-27 → 2011-01-01 — which is precisely why cadence cannot be inferred from it.

A related question, **Q3** (the `SM/`/`SV/` treasury memo convention), needs the same offline
artifact and blocks nothing.

### Broad archaeology is CLOSED
- **Member homes: 1 recovered of 1,571 targets.** 1,568 proven historical 404, 2 proven 403.
  `/home/<nickname>` was never a server path — the templates emit `/home/<16-digit-id>/`
  exclusively across 812 swept references.
- **Objects and images: 9 recoverable of 46,424.** 0.02%. Crawlers do not walk object ids.
- **Site-wide recoverable total is 248 paths (~6.3 MB), not 2,285.** 2,285 paths *appear in
  the CDX index*; only 248 have a 200 capture.
- The historical `/services/http/80/htdocs` is **absent from the backup** and the Internet
  Archive cannot close it. Only external media can — [#23](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/23).

**Do not reopen broad URL sweeps.** They were run to exhaustion.

---

## 5. Intentional modern divergences

Historical parity does not mean reproducing insecure implementation. These are correct
outcomes and are classified `RESTORED_WITH_INTENTIONAL_MODERN_SAFETY_DIVERGENCE`, never as
parity failures:

- Bank sender derives from the **authenticated session**, never from a request field.
- **Server-side idempotency** on transfers, enforced by a UNIQUE index.
- **Atomic wallet updates** — `increment`/`decrement` inside a transaction, replacing
  read-modify-write.
- **Overflow checks** on the recipient balance, replacing a wrapping 32-bit hex field.
- **No shell interpolation.** `phase3.pl` passed `$MEM_NNM`, `$TO_NNM`, `$TO_AMT`, `$TO_NAM`
  unquoted into backticks and ran `nslookup $ip`.
- **Parameterised SQL** throughout.
- **Escaped receipt content** at the render sink — see `api/src/libs/html.ts` for why
  escaping, not allowlist sanitisation, is correct for a system-generated notice.
- **Fail-closed authorization**, replacing `*ACR` string matching.
- **Role ids resolved by name**, not hard-coded to historic numeric values. Since `ba8c6a3`
  `roleMap` is private, so the compiler enforces async-only access.
- **A durable `transaction` ledger** — Cybertown had no ledger table at all, only logs and
  inbox receipts. CTR exceeds the historical design here.

## 6. Content gaps are not backend bugs

Three rows are `CONTENT_GAP_ONLY`, and one lane (`BETA-HOME-LAYOUT`) is configuration. The
application is correct in all four cases; the *content* is missing. Application engineers
should not read these as parity defects: `HOME-07` (member home pages), `MALL-08` (object and
image bytes), `NAV-07` (rotating banners), plus `BETA-HOME-LAYOUT` (no lots opened on beta).

---

## 7. The matrix

122 capability rows. Sorted by capability domain, not by file — one historical CGI often
implements several capabilities, and one capability often spans several CTR modules.

**Status distribution**

| Status | Count |
| `RESTORED` | 51 |
| `MISSING_ACTIONABLE` | 23 |
| `RESTORED_WITH_INTENTIONAL_MODERN_SAFETY_DIVERGENCE` | 22 |
| `PRESENT_PARTIAL` | 8 |
| `HISTORICALLY_DECOMMISSIONED` | 7 |
| `NOT_RESTORATION_TARGET` | 5 |
| `CONTENT_GAP_ONLY` | 3 |
| `OWNER_DECISION_REQUIRED` | 2 |
| `UNKNOWN_TARGETED_RECON_REQUIRED` | 1 |
Total: **122**

### Authentication & Sessions

*RESTORED 3 · RESTORED + DIVERGENCE 3 · OWNER_DECISION 1 · NOT_A_TARGET 1 — 8 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `AUTH-01` | Member login by nickname + password | place CGI login POST; ccgi_login_main password gate | PROVEN_RUNTIME | Session login by username + password | api/src/services/auth, api/src/routes/auth.routes.ts | `RESTORED` | - | - | - |
| `AUTH-02` | Wrong-password rejection | strcmp gate in ccgi_login_main | PROVEN_RUNTIME | Rejects wrong password | api/src/services/auth | `RESTORED` | - | - | - |
| `AUTH-03` | Ban enforcement | M.EXD moderation ban field | PROVEN_RUNTIME | `member.banned` boolean enforced at login | api/src/types/models/member.model.ts:40; /admin/ban | `RESTORED + DIVERGENCE` | **Divergence:** Single boolean rather than the graded EXT/EXM/EXL/MPL record<br>**Gap:** Severity/expiry/attribution grading absent | ADMIN-A1 | #21 |
| `AUTH-04` | Visitor / guest session | print?NNM=Visitor&login=true | PROVEN_RUNTIME | No guest mode | no guest path in api/src/services/auth | `OWNER_DECISION` | **Gap:** CTR is members-only by design; restoring guest access is a product choice, not a parity obligation | BACKLOG-P3 | #26 |
| `AUTH-05` | Registration | register CGI, register.cfg generations | PROVEN_SOURCE | Registration with immigration grant in ledger | api/src/repositories/member/member.repository.ts:51-71 | `RESTORED + DIVERGENCE` | **Divergence:** Grant is an audited ledger event, not a column DEFAULT | - | - |
| `AUTH-06` | Session ticket lifecycle | table T via ccgi_TicketInsert, DB_ + 16 hex cookie | PROVEN_SOURCE | JWT session | api/src/libs, auth service | `RESTORED + DIVERGENCE` | **Divergence:** Stateless JWT replaces the historical `T` ticket table; `T` was runtime state, not durable record | - | - |
| `AUTH-07` | Subscription entitlement gate | M.RGK checked in 35 CGIs | PROVEN_SOURCE | No subscription tier | n/a | `NOT_A_TARGET` | **Divergence:** IVN commercial billing (`M.RGK`) is a distinct domain<br>**Gap:** Not a restoration target | - | - |
| `AUTH-08` | Password reset | no historical route identified | SPECULATIVE | `POST /member/send_password_reset` + reset | api/src/routes/member.routes.ts:49; api/src/libs/mail.ts | `RESTORED` | **Divergence:** CTR capability with no identified historical counterpart<br>**Gap:** Non-functional on beta -- delivery is broken, not the feature | BETA-MAIL-A1 | #13 |

### Identity & Citizen Lifecycle

*RESTORED 5 · PRESENT_PARTIAL 1 · RESTORED + DIVERGENCE 1 — 7 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `IDENT-01` | Citizen profile view | citizen CGI, 2909 requests | PROVEN_PRODUCTION_USE | Citizen profile view | api/src/controllers/member.controller.ts; spa profile pages | `RESTORED` | - | - | - |
| `IDENT-02` | Profile editing | citizen POST verbs | PROVEN_SOURCE | Profile editing | api/src/services/member/member.service.ts | `RESTORED` | - | - | - |
| `IDENT-03` | Moderation record (EXT/EXM/EXL/MPL) | citizen/excl.cfg, excl_upd.cfg | PROVEN_SOURCE | `banned` boolean + ban history | member.model.ts:40; /admin/banhistory; spa/src/pages/admin/user/BanHistory.vue | `PRESENT_PARTIAL` | **Divergence:** Attribution exists via ban history<br>**Gap:** No moderation level or expiry | ADMIN-A1 | #21 |
| `IDENT-04` | Privacy / appear-hidden | privacy fields on member | PROVEN_SOURCE | Privacy / hide-yourself | member privacy fields; roster visibility rules | `RESTORED` | - | - | - |
| `IDENT-05` | Avatar selection and upload | uploadavt CGI, 433 requests | PROVEN_PRODUCTION_USE | Avatar selection + upload with approval queue | /admin/avatars/{approve,reject}; spa/src/pages/admin/avatar/search.vue | `RESTORED` | - | - | - |
| `IDENT-06` | Experience / XP progression | exper.cfg, M.EXP field | PROVEN_SOURCE | XP progression on deployed-config rates | api/src/libs/economy.ts:48,64,78 | `RESTORED + DIVERGENCE` | **Divergence:** Rates corrected to DEPLOYED_RUNTIME_CONFIG (5/21 daily, +50 first homestead) | - | - |
| `IDENT-07` | Virtual pets | vpet CGI, 233 requests | PROVEN_PRODUCTION_USE | Virtual pets | spa pet components | `RESTORED` | - | - | - |

### Homes & Property

*RESTORED 5 · PRESENT_PARTIAL 2 · MISSING_ACTIONABLE 2 · RESTORED + DIVERGENCE 1 · CONTENT_GAP_ONLY 1 — 11 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `HOME-01` | Property view | property?ac=place, 380231 requests | PROVEN_PRODUCTION_USE | Property view | api/src/controllers/home.controller.ts | `RESTORED` | - | - | - |
| `HOME-02` | My house | property?ac=myhouse | PROVEN_SOURCE | My house | api/src/services/home/home.service.ts | `RESTORED` | - | - | - |
| `HOME-03` | Generic read/list dispatcher (the edit CGI) - the busiest endpoint | edit CGI, 2332853 requests, 21.1% of all traffic; 567 Wayback captures show ac=read 500 / ac=list 128 / forgot 6 / chpass 6 over DTY=B,I,CL,P rendering arbitrary TPL: clu | PROVEN_PRODUCTION_USE | Function distributed across typed CTR routes | api/src/routes/*.ts | `RESTORED + DIVERGENCE` | **Divergence:** A single generic `edit` dispatcher over arbitrary DTY/TPL is replaced by typed routes -- deliberate; the historical shape was an injection surface | - | - |
| `HOME-04` | Home customisation / update | edit POST verbs, 14452 POSTs; property/updateinfo among edit's captured templates | PROVEN_PRODUCTION_USE | HomeUpdatePage / HomeUpdateHomePage | spa home update pages | `PRESENT_PARTIAL` | **Gap:** Coverage against the historical `edit` POST verbs never verified -- audit before treating as a gap | BACKLOG-P3 | #26 |
| `HOME-05` | Home image upload | e_propimageupload, dbimages | PROVEN_SOURCE | Home image upload | api/src/services/home/home.service.ts:284,413 | `RESTORED` | - | - | - |
| `HOME-06` | Home chat access rights | home chat rights templates | PROVEN_SOURCE | Home chat access rights | place access service | `RESTORED` | - | - | - |
| `HOME-07` | Member home static pages | /home/<id>/, 148182 requests over 4074 paths | PROVEN_PRODUCTION_USE | Homes render from live data | api/src/repositories/home | `CONTENT_GAP_ONLY` | **Divergence:** n/a<br>**Gap:** Historical static home pages are unrecoverable: 1 of 1,571 targets recovered, 1,568 proven 404 | ASSET-EXTERNAL | #23 |
| `HOME-08` | Designer homes catalogue and purchase | object/deshomes/housebuy.cfg, /deshom/ | PROVEN_SOURCE | Home purchase exists; no designer catalogue | api/src/controllers/home.controller.ts | `PRESENT_PARTIAL` | **Gap:** Designer homes catalogue absent | BACKLOG-P3 | #26 |
| `HOME-09` | Home purchase debit / refund | object/housebuy.cfg *ADD M MON -TPR | PROVEN_SOURCE | Purchase debit + refund, atomic | TransactionReason.HomePurchase / HomeRefund; home.repository.ts:64 forUpdate | `RESTORED` | - | - | - |
| `HOME-10` | Property move fee | money.cfg m_property_move 50 | PROVEN_SOURCE | Move is free | api/src/services/home/home.service.ts:152; economy.ts:88-96 | `MISSING_ACTIONABLE` | **Gap:** 50 CC charge (`m_property_move`) not applied | ECON-F2 | #19 |
| `HOME-11` | Home-to-home trade between citizens | object/trade1.cfg, trade2.cfg with HTR1-HTR4 | PROVEN_SOURCE | No home-to-home trade | n/a | `MISSING_ACTIONABLE` | **Gap:** Citizen-to-citizen home trade absent | BACKLOG-P3 | #26 |

### Places & Navigation

*RESTORED 5 · RESTORED + DIVERGENCE 1 · MISSING_ACTIONABLE 1 · PRESENT_PARTIAL 1 — 8 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `NAV-01` | Site root and framesets | /, main_ieframes.html, main_nsframes.html | PROVEN_PRODUCTION_USE | Vue SPA | spa/src/ | `RESTORED + DIVERGENCE` | **Divergence:** Framesets replaced by an SPA -- not a target for reversal | - | - |
| `NAV-02` | Colony navigation | community?ac=place&DTY=C, 42530 requests | PROVEN_PRODUCTION_USE | Colony navigation | api/src/repositories/colony/colony.repository.ts | `RESTORED` | - | - | - |
| `NAV-03` | Neighbourhood navigation | neighbor?ac=place, 35976 requests | PROVEN_PRODUCTION_USE | Neighbourhood navigation | api/src/repositories/hood/hood.repository.ts | `RESTORED` | - | - | - |
| `NAV-04` | Block navigation | block?ac=place, 61655 requests | PROVEN_PRODUCTION_USE | Block navigation | block routes/services | `RESTORED` | - | - | - |
| `NAV-05` | Place menu and place view | place?ac=menu / ac=place, 693467 requests | PROVEN_PRODUCTION_USE | Place menu and place view | api/src/services/place/place.service.ts | `RESTORED` | - | - | - |
| `NAV-06` | City map | campus map, colony maps | PROVEN_ASSET | City map | map_location; place map backgrounds | `RESTORED` | - | - | - |
| `NAV-07` | Rotating page banners | /comtech/*, 1157418 requests over 24 paths | PROVEN_PRODUCTION_USE | No rotating banners | n/a | `MISSING_ACTIONABLE` | **Gap:** 24 banner paths, 1,157,418 historical requests; cosmetic | HIST-UI | #25 |
| `NAV-08` | Static info and help trees | /info/ 399 paths, /help/ 517 paths | PROVEN_PRODUCTION_USE | Partial info/help content | spa static pages | `PRESENT_PARTIAL` | **Gap:** 399 /info/ and 517 /help/ paths historically | BACKLOG-P3 | #26 |

### 3D World, Chat & Presence

*RESTORED 4 · NOT_A_TARGET 1 · PRESENT_PARTIAL 1 — 6 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `3D-01` | VRML world delivery | /places/**.wrl, 302072 requests over 5692 paths | PROVEN_RUNTIME | VRML world delivery | nginx static /places | `RESTORED` | - | - | - |
| `3D-02` | Java / BXApplet delivery | /java/contact/classes2.zip, 29462 requests | PROVEN_RUNTIME | Modern 3D client | n/a | `NOT_A_TARGET` | **Divergence:** Java/BXApplet delivery is not a restoration target<br>**Gap:** Obsolete plugin technology | - | - |
| `3D-03` | Multiuser presence | cpserver / soserver | PROVEN_RUNTIME | Socket presence | ct-socket service | `RESTORED` | - | - | - |
| `3D-04` | Live chat round trip | cpserver | PROVEN_RUNTIME | Live chat round trip | ct-socket service | `RESTORED` | - | - | - |
| `3D-05` | Shared objects placed in worlds | SO rows, 31034 place-drops, 2125049 instances | PROVEN_RUNTIME | Shared objects placed in worlds | object repository; place drops | `RESTORED` | - | - | - |
| `3D-06` | Avatar state / gestures | blaxxun Contact client | LIKELY | Avatar state | socket presence payload | `PRESENT_PARTIAL` | **Gap:** Gesture parity unverified (recon confidence LIKELY, not proven) | - | - |

### CityCash Economy & Experience

*RESTORED + DIVERGENCE 4 · RESTORED 4 · NOT_A_TARGET 2 · PRESENT_PARTIAL 1 · UNKNOWN_RECON 1 · MISSING_ACTIONABLE 1 — 13 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `ECON-01` | CityCash balance per citizen | M.MON, 8-digit zero-padded hex, 32-bit unsigned | PROVEN_SOURCE | `wallet.balance INT UNSIGNED` | api/src/types/models/wallet.model.ts | `RESTORED + DIVERGENCE` | **Divergence:** Native integer replaces 8-char zero-padded hex `M.MON`; overflow is checked, not wrapped | - | - |
| `ECON-02` | Balance display to citizen | bank/phase1.tmpl, fundbox, object/display.cfg | PROVEN_SOURCE | Balance displayed to citizen | spa wallet display | `RESTORED` | - | - | - |
| `ECON-03` | Native declarative money engine | *ADD M ID <id> MON +/-<amt> with TMPM scratch guard | PROVEN_SOURCE | Knex increment/decrement inside transactions | transfer.repository.ts:193-194; credit.repository.ts:235 | `RESTORED + DIVERGENCE` | **Divergence:** Replaces the declarative `*ADD M ... MON` engine and its TMPM scratch guard; parameterised, no shell interpolation | - | - |
| `ECON-04` | Transaction ledger | no historical ledger table; logs + Inbox receipts only | PROVEN_SOURCE | Durable `transaction` ledger table | api/src/types/models/transaction.model.ts | `RESTORED + DIVERGENCE` | **Divergence:** CTR EXCEEDS history: Cybertown had no ledger table at all, only logs and inbox receipts | - | - |
| `ECON-05` | Citizen-visible transaction history | two Inbox receipts per transfer written by phase3.pl | PROVEN_SOURCE | Ledger rows exist; admin-only UI | spa/src/pages/admin/user/TransactionHistory.vue | `PRESENT_PARTIAL` | **Gap:** No citizen-facing transaction history | HIST-TXN | #20 |
| `ECON-06` | Daily login CityCash credit | money.cfg m_member_daily_login 80; money.log 1082 events | PROVEN_PRODUCTION_USE | 80 CC daily login | api/src/libs/economy.ts:48 DAILY_CC = 80 | `RESTORED` | - | - | - |
| `ECON-07` | Daily job CityCash credit | money.cfg m_job_daily_login 256; money.log 1046 events | PROVEN_PRODUCTION_USE | 336 CC employed daily total | api/src/libs/economy.ts:57 DAILY_CC_EMPLOYED | `RESTORED` | - | - | - |
| `ECON-08` | Periodic bulk payroll sweep | 34974 change-money rows on 2010-12-31 hour 00 across 34972 member IDs, +48656105 net, modal 1400 with role-graded tail | PROVEN_PRODUCTION_USE | Weekly role payroll cron | api/src/cron/role-credit.ts; role.income_cc/income_xp | `RESTORED + DIVERGENCE` | **Divergence:** CTR runs its own weekly cadence and rates<br>**Gap:** Historical cadence and per-member rule unknown | Q7 | #22 |
| `ECON-13` | Periodic fee or charge on members | 679 members debited 20 in the same 2010-12-31 sweep | PROVEN_PRODUCTION_USE | No periodic debit | n/a | `UNKNOWN_RECON` | **Gap:** 679 members debited exactly -20 in the 2010-12-31 sweep; purpose unidentified | Q7 | #22 |
| `ECON-09` | Immigration grant | money.cfg m_immigrate 20000 | PROVEN_SOURCE | 20,000 CC immigration grant, ledgered | api/src/libs/economy.ts:73; member.repository.ts:67-70 | `RESTORED` | - | - | - |
| `ECON-10` | Referrer bonus | money.cfg m_referer 2000 | PROVEN_SOURCE | Constant recorded, deliberately unwired | api/src/libs/economy.ts:81-87 REFERRER_BONUS_CC | `MISSING_ACTIONABLE` | **Gap:** No referral concept exists: no column, no table, no signup parameter | ECON-F1 | #18 |
| `ECON-11` | Timer bonus / minimum-balance reset | money.cfg m_member_bonus 10, m_member_reset 1000 | PROVEN_SOURCE | No timer bonus / balance reset | n/a | `NOT_A_TARGET` | **Gap:** `m_member_bonus` 10 / `m_member_reset` 1000 exist in config; no evidence either ever ran | - | - |
| `ECON-12` | Interest, loans, tax, rent, salary | searched; no evidence in any source | PROVEN_SOURCE | No interest, loans, tax, rent or salary | n/a | `NOT_A_TARGET` | **Gap:** Searched every source; no evidence these existed | - | - |

### Bank (citizen transfer)

*RESTORED 6 · RESTORED + DIVERGENCE 2 · MISSING_ACTIONABLE 1 · CONTENT_GAP_ONLY 1 — 10 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `BANK-01` | Citizen-to-citizen CityCash transfer | bank/phase1-3 templates + phase3.pl; 55 logged transfers | PROVEN_PRODUCTION_USE | Citizen-to-citizen CityCash transfer | api/src/services/bank/bank.service.ts; POST /bank/transfer | `RESTORED` | - | BANK-A1 | DONE |
| `BANK-02` | Bank 2D transfer console UI | bank/phase1.tmpl form, phase2 confirm, phase3 receipt; 11 console chrome slices recovered under places/fundbox/images sha256-verified and dimension-identical to the bank  | PROVEN_ASSET | Bank transfer console | spa/src/components/modals/BankTransferModal.vue | `RESTORED` | **Gap:** Functional; period-pixel alignment outstanding | HIST-UI | #25 |
| `BANK-03` | Bank information / help page | places/bank/info.html | PROVEN_ASSET | No Bank help page | n/a | `MISSING_ACTIONABLE` | **Gap:** `places/bank/info.html` not reproduced | HIST-UI | #25 |
| `BANK-04` | 3D Bank world with 3 CC transfer machines | places/bank/vrml/bank.wrl 193963 bytes | PROVEN_ASSET | No 3D Bank world | n/a | `CONTENT_GAP_ONLY` | **Gap:** `places/bank/vrml/bank.wrl` (193,963 B) not deployed as a world | HIST-UI | #25 |
| `BANK-05` | Transfer memo / reason free text | TO_NAM max 30 chars; present in all 288 logged transfers | PROVEN_PRODUCTION_USE | Memo, max 30 chars | transaction.model.ts `memo`; bank.service.ts | `RESTORED` | - | BANK-A1 | DONE |
| `BANK-06` | Transfer receipts to both parties | phase3.pl writes two DB I I Inbox rows | PROVEN_SOURCE | Receipts to both parties | transfer.repository.ts:333 | `RESTORED` | - | BANK-A1 | DONE |
| `BANK-07` | Both-parties-must-own-a-home precondition | phase3.pl length(FROM_HOM)<15 and length(TO_HOM)<15 guards | PROVEN_SOURCE | Both parties must own a home | bank.service.ts TransferRefusal sender-no-home / recipient-no-home | `RESTORED` | **Gap:** Historical precondition kept by owner decision | BANK-A1 | DONE |
| `BANK-08` | Insufficient-funds refusal | phase3.pl fromcash >= TO_AMT | PROVEN_SOURCE | Insufficient-funds refusal | bank.service.ts `insufficient-funds` | `RESTORED` | - | BANK-A1 | DONE |
| `BANK-09` | Debit rollback on failed credit | phase3.pl rollback branch | PROVEN_SOURCE | Single atomic DB transaction | transfer.repository.ts:193-194 | `RESTORED + DIVERGENCE` | **Divergence:** No rollback branch to get wrong -- debit and credit commit or roll back together, replacing the historical no-rollback path | - | - |
| `BANK-10` | Transfer audit log | bank_transfers.log, 55 rows with both closing balances | PROVEN_PRODUCTION_USE | Durable ledger row + idempotency key | transaction.model.ts; UNIQUE idempotency index | `RESTORED + DIVERGENCE` | **Divergence:** A queryable ledger replaces an append-only text log | - | - |

### PlaceCash / Fundbox

*MISSING_ACTIONABLE 10 — 10 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `PCASH-01` | Place-owned balance | O.MON on place/object records; Bank place 0000000000000041 held 781069509 | PROVEN_PRODUCTION_USE | Wallet has no place holder | wallet.model.ts is `{balance}` only | `MISSING_ACTIONABLE` | **Gap:** Place-owned balance absent | CASH-A2 | #17 |
| `PCASH-02` | Neighbourhood-owned balance | N.MON in fundbox/phase0.cfg | PROVEN_SOURCE | No neighbourhood wallet | wallet.model.ts | `MISSING_ACTIONABLE` | **Gap:** Neighbourhood-owned balance absent | CASH-A2 | #17 |
| `PCASH-09` | Colony-owned balance | recovered Wayback render of fundbox/phase7 targets DTY=C ID=0105000000000000 NAM Inner Realms; fundbox configs address the target generically as <$DTY> + <$ID> | PROVEN_ASSET | No colony wallet | wallet.model.ts | `MISSING_ACTIONABLE` | **Gap:** Colony-owned balance absent (DTY=C) | CASH-A2 | #17 |
| `PCASH-10` | Fundbox executor authorization - owneraccess to pay out or deposit, writeaccess to donate | fundbox/phase3.tmpl and phase6.tmpl #ifdef owneraccess; phase9.tmpl #ifdef writeaccess with an ACCESS DENIED fallthrough; all after *ACR | PROVEN_SOURCE | No Fundbox authorization | n/a | `MISSING_ACTIONABLE` | **Gap:** Per-phase owner/write access distinction absent | CASH-A2 | #17 |
| `PCASH-03` | Fundbox console - 9 phases | fundbox/phase0,0a,1-9,99 templates and configs | PROVEN_SOURCE | No Fundbox console | n/a | `MISSING_ACTIONABLE` | **Gap:** Nine-phase console absent | CASH-A2 | #17 |
| `PCASH-04` | Place-to-member payout | phase3dep.pl, placecash_transfers.log 47 rows | PROVEN_PRODUCTION_USE | No place-to-member payout | n/a | `MISSING_ACTIONABLE` | **Gap:** Payout flow absent | CASH-A2 | #17 |
| `PCASH-05` | Member-to-place deposit | phase6dep.pl, placecash_deposits.log | PROVEN_SOURCE | No member-to-place deposit | n/a | `MISSING_ACTIONABLE` | **Gap:** Deposit flow absent | CASH-A2 | #17 |
| `PCASH-06` | Member-to-department donation | phase9dep.pl, placecash_donations.log 186 rows | PROVEN_PRODUCTION_USE | No department donation | n/a | `MISSING_ACTIONABLE` | **Gap:** Donation flow absent | CASH-A2 | #17 |
| `PCASH-07` | Fundbox policy fields | FBS and FBP fields updated by fundbox/phase99.cfg | PROVEN_SOURCE | No FBS/FBP policy fields | n/a | `MISSING_ACTIONABLE` | **Gap:** Fundbox policy fields absent | CASH-A2 | #17 |
| `PCASH-08` | Donate CityCash button on place pages | bank/ac_event.tmpl links fundbox/phase7; images/buttons/bdonatecash.gif | PROVEN_ASSET | No donate button | n/a | `MISSING_ACTIONABLE` | **Gap:** Place-page donate entry point absent | CASH-A2 | #17 |

### Mall, Commerce & Objects

*RESTORED 9 · RESTORED + DIVERGENCE 3 · MISSING_ACTIONABLE 3 · DECOMMISSIONED 2 · CONTENT_GAP_ONLY 1 — 18 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `MALL-01` | Object catalogue browse | object?ac=list, 344759 requests | PROVEN_PRODUCTION_USE | Object catalogue browse | api/src/services/object/object.service.ts | `RESTORED` | - | - | - |
| `MALL-02` | Object purchase debit | object POST verbs; SO.TPR price | PROVEN_SOURCE | Purchase debit | TransactionReason.ObjectPurchase; object.repository.ts:142 forUpdate | `RESTORED` | - | - | - |
| `MALL-03` | Seller profit credit | *ADD M ID <CRE> MON +<TPR> | PROVEN_SOURCE | Seller profit credit | TransactionReason.ObjectProfit | `RESTORED` | - | - | - |
| `MALL-04` | Object upload fee | object/upload.cfg reads M.MON | PROVEN_SOURCE | Upload fee | TransactionReason.ObjectUpload | `RESTORED` | - | - | - |
| `MALL-05` | Upload rejection refund | no historical evidence found | PROVEN_SOURCE | Upload rejection refund exists | TransactionReason.ObjectUploadRefund | `RESTORED + DIVERGENCE` | **Divergence:** CTR may EXCEED history -- no historical evidence of this refund was found<br>**Gap:** Verify before treating as a gap | BACKLOG-P3 | #26 |
| `MALL-06` | Unsold-instance refund | no historical evidence found | PROVEN_SOURCE | Unsold-instance refund exists | TransactionReason.ObjectUnsoldInstancesRefund | `RESTORED + DIVERGENCE` | **Divergence:** CTR may EXCEED history -- no historical evidence found<br>**Gap:** Verify before treating as a gap | BACKLOG-P3 | #26 |
| `MALL-07` | Object moderation workflow | object upload hold configs, UPL_STATUS and UBL1-50 blocklist on O 0000000000000009 | PROVEN_SOURCE | Object moderation workflow | mall.controller.ts:448,650; admin/objects | `RESTORED + DIVERGENCE` | **Divergence:** Sanitised staff notices; no UBL blocklist on a magic object id | - | - |
| `MALL-08` | Object bytes and thumbnails | /dbobjects 42018 paths, /dbimages 5432 paths | PROVEN_PRODUCTION_USE | Objects render from live uploads | object storage | `CONTENT_GAP_ONLY` | **Divergence:** n/a<br>**Gap:** 46,424 historical object/image paths lost; 9 recoverable from Wayback (0.02%) | ASSET-EXTERNAL | #23 |
| `MALL-09` | Restock | SO.CNT decrement on purchase | PROVEN_SOURCE | Restock | TransactionReason.ObjectRestock | `RESTORED` | - | - | - |
| `MALL-10` | Personal storage / warehouse | storage/list.cfg, property/storlist.cfg | PROVEN_SOURCE | Personal storage | spa/src/pages/admin/user/StorageAreas.vue; storage service | `RESTORED` | - | - | - |
| `MALL-11` | Object drop / pickup / move | object POST verbs, 39390 POSTs | PROVEN_PRODUCTION_USE | Object drop / pickup / move | object service | `RESTORED` | - | - | - |
| `MALL-12` | Black market | templates/blackmarket | PROVEN_SOURCE | Black market | mall place components | `RESTORED` | - | - | - |
| `MALL-13` | Flea market | templates/fleamarket, fleachatmembers.tmpl | PROVEN_SOURCE | Flea market | mall place components | `RESTORED` | - | - | - |
| `MALL-14` | Shopping funds console | templates/shopping/funds/phase1-3 | PROVEN_SOURCE | No shopping funds console | n/a | `MISSING_ACTIONABLE` | **Gap:** Depends on the place-wallet primitive | CASH-A2 | #17 |
| `MALL-15` | Auction / bidding | templates/bid | PROVEN_SOURCE | No auction | n/a | `MISSING_ACTIONABLE` | **Gap:** Auction/bidding absent | BACKLOG-P3 | #26 |
| `MALL-16` | Casino / arcade | templates/casino, templates/arcade | PROVEN_SOURCE | No casino/arcade | n/a | `MISSING_ACTIONABLE` | **Gap:** Casino/arcade absent | BACKLOG-P3 | #26 |
| `MALL-17` | CityCash Lottery - Game of Chance | templates/event/citycash1-5; citycash5setup and citycash5.dat build the event tree; 8 weekly rounds with 1st-3rd prizes, 10 million CC headline prize, max 10 entries per  | PROVEN_SOURCE | No lottery | n/a | `DECOMMISSIONED` | **Gap:** Created 2000-10-24; the `event` CGI drew ZERO requests in the final-era window | - | - |
| `MALL-18` | CityCash sink - lottery ticket purchase | citycash5 event MON -32 and the insufficient-funds refusal string | PROVEN_SOURCE | No lottery ticket sink | n/a | `DECOMMISSIONED` | **Gap:** Decommissioned with MALL-17; its sink was -32, not the -20 of ECON-13 | - | - |

### Community, Mail & Clubs

*RESTORED 7 · RESTORED + DIVERGENCE 4 · DECOMMISSIONED 3 · MISSING_ACTIONABLE 3 · NOT_A_TARGET 1 — 18 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `COMM-01` | Message boards read | msb?ac=listhdr / listmsg, 152243 requests | PROVEN_PRODUCTION_USE | Message boards read | api/src/controllers/messageboard.controller.ts | `RESTORED` | - | - | - |
| `COMM-02` | Message board post | msb?ac=write, 11776 POSTs | PROVEN_PRODUCTION_USE | Message board post, sanitised on write | messageboard.controller.ts:170,218,278 | `RESTORED + DIVERGENCE` | **Divergence:** Allowlist sanitisation on write<br>**Gap:** Sanitisation is per-call-site, not enforced at a choke point | GENERAL-INBOX-SECURITY | #14 |
| `COMM-03` | Private mail | message?ac=list, 580978 requests, 3rd busiest | PROVEN_PRODUCTION_USE | Private mail: compose, reply, list, delete, broadcast | api/src/routes/inbox.routes.ts; api/src/services/inbox/inbox.service.ts | `RESTORED` | **Divergence:** Inbox is keyed on the recipient home place -- which MATCHES the historical `i<HOM><date>` key<br>**Gap:** None found. Assessed and closed as RESTORED; no mail lane created | - | - |
| `COMM-04` | Instant messaging | msg CGI, msserver; zero requests in 2010 window | PROVEN_PRODUCTION_USE | No instant messaging | n/a | `DECOMMISSIONED` | **Gap:** `msg` CGI / msserver drew ZERO requests in the final-era window | - | - |
| `COMM-05` | Inbox item write from another subsystem | DB I I ID i<HOM><date> OWN NNM NAM TXT | PROVEN_SOURCE | Inbox writes from other subsystems | inbox.repository.ts:119; transfer.repository.ts:333 | `RESTORED + DIVERGENCE` | **Divergence:** Bank receipts escaped at the sink rather than allowlisted -- see libs/html.ts | - | - |
| `COMM-06` | Broadcast to all | no historical route identified | SPECULATIVE | InboxToAll / MessageToAll | spa/src/pages/InboxToAll.vue, MessageToAll.vue | `RESTORED + DIVERGENCE` | **Divergence:** CTR capability; no historical route was identified | - | - |
| `COMM-07` | Clubs directory | club?ac=directory, 17842 requests | PROVEN_PRODUCTION_USE | Clubs directory | club service | `RESTORED` | - | - | - |
| `COMM-08` | Club creation and membership | e_club_create 10 XP; club-member repository | PROVEN_SOURCE | Club creation and membership | club-member repository | `RESTORED` | - | - | - |
| `COMM-09` | Club finance | templates/club with MON in admin config | LIKELY | No club finance | n/a | `MISSING_ACTIONABLE` | **Gap:** Depends on the place-wallet primitive | CASH-A2 | #17 |
| `COMM-10` | Buddy list | buddy CGI; zero requests in 2010 window | PROVEN_PRODUCTION_USE | No buddy list | n/a | `DECOMMISSIONED` | **Gap:** `buddy` CGI drew ZERO requests in the final-era window | - | - |
| `COMM-11` | Online citizen roster | memberdir/chatmembers.tmpl | PROVEN_SOURCE | Online citizen roster | socket presence; roster privacy rules | `RESTORED` | - | - | - |
| `COMM-12` | Voting | vote?ac=listhdr, 616 requests, vote.cfg | PROVEN_PRODUCTION_USE | Voting | api/src/controllers/vote.controller.ts | `RESTORED` | - | - | - |
| `COMM-13` | Community calendar | calweb.cgi, 35754 requests | PROVEN_PRODUCTION_USE | Community calendar | calendar components | `RESTORED + DIVERGENCE` | **Divergence:** Replaces calweb.cgi | - | - |
| `COMM-14` | Events | event CGI; 194 finished 2001-2003 events, zero requests | PROVEN_PRODUCTION_USE | No events system | spa/src/pages/admin/LiveEvent.vue is a separate admin tool | `DECOMMISSIONED` | **Gap:** 194 finished 2001-2003 events; ZERO requests in the final-era window | - | - |
| `COMM-15` | Member directory / search | templates/memberdir | PROVEN_SOURCE | Member directory / search | /admin/usersearch; citizen directory | `RESTORED` | - | - | - |
| `COMM-16` | Problem report form | templates/problem_report/pr.pl | PROVEN_SOURCE | No problem report form | n/a | `MISSING_ACTIONABLE` | **Gap:** Support intake absent; cheap and useful once beta has testers | BACKLOG-P3 | #26 |
| `COMM-17` | Surveys and contests | survey/, minisurvey/, subsurvey/, trivia/ | PROVEN_SOURCE | No surveys/contests | n/a | `MISSING_ACTIONABLE` | **Gap:** survey/minisurvey/subsurvey/trivia absent | BACKLOG-P3 | #26 |
| `COMM-18` | Sponsorship application | sponsorshipapp/sa.pl, sponsorsdir | PROVEN_SOURCE | No sponsorship application | n/a | `NOT_A_TARGET` | **Gap:** Commercial sponsorship intake; not a restoration target | - | - |

### Governance, Roles & Moderation

*RESTORED + DIVERGENCE 3 · RESTORED 2 · PRESENT_PARTIAL 1 · OWNER_DECISION 1 · MISSING_ACTIONABLE 1 — 8 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `GOV-01` | Roles and role hierarchy | 124 roles, 22914 role memberships | PROVEN_RUNTIME | Roles resolved by name | api/src/repositories/role/role.repository.ts (roleMap private since ba8c6a3) | `RESTORED + DIVERGENCE` | **Divergence:** Role ids are NOT hard-coded to historic numeric values; the compiler enforces async-only cache access | - | - |
| `GOV-02` | Hiring and firing | citizen?ac=employment; employment templates | PROVEN_SOURCE | Hiring and firing | /admin/hirerole, /admin/firerole | `RESTORED` | - | - | - |
| `GOV-03` | Place-scoped authority / deputies | *ACR rightsaccess owneraccess writeaccess readaccess | PROVEN_SOURCE | Place-scoped authority | api/src/services/place/PlaceAccessService | `RESTORED + DIVERGENCE` | **Divergence:** Fail-closed authorization replaces *ACR string matching | - | - |
| `GOV-04` | Elections / mayor | templates/cityhall, vote | PROVEN_SOURCE | Elections / mayor | vote.controller.ts; spa/src/pages/MayorElection.vue | `RESTORED + DIVERGENCE` | **Divergence:** Immigration-date eligibility gate is a CTR addition | - | - |
| `GOV-05` | Jail / security | templates/jail-OLD, jailoffice-OLD; jail CGI 404, 1776 requests | PROVEN_PRODUCTION_USE | Jail place component; ban + ban history | /admin/ban, /admin/banhistory | `PRESENT_PARTIAL` | **Gap:** No confinement state. NOTE: the jail CGI was ALREADY 404 in the final era | ADMIN-A1 | #21 |
| `GOV-06` | Tribunal | tribunal/tribunal.pl | PROVEN_SOURCE | No tribunal | n/a | `OWNER_DECISION` | **Gap:** Disposition workflow absent; owner must decide whether it is a target | ADMIN-A1 | #21 |
| `GOV-07` | Staff / admin console | /cgi-bin/admin/admin, 3083 requests | PROVEN_PRODUCTION_USE | Admin console: 19 routes, 29 Vue pages | api/src/routes/admin.routes.ts; spa/src/pages/admin/ | `RESTORED` | **Divergence:** CTR EXCEEDS history in several areas | - | - |
| `GOV-08` | Administrative balance adjustment | admin_OLd_nO-ENtrY/member.cfg exposes MON | LIKELY | No balance adjustment | wallet.repository.ts:22 `addMoney` has an EMPTY BODY and zero callers | `MISSING_ACTIONABLE` | **Gap:** Staff cannot adjust a balance; the apparent mechanism is dead code | ADMIN-A1 | #21 |

### News & Content

*RESTORED 1 · DECOMMISSIONED 1 — 2 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `NEWS-01` | Daily News archive | /DailyNews/ 4685 and /dailynews2/ 4818 requests | PROVEN_PRODUCTION_USE | Daily News | api/src/controllers/news.controller.ts; spa/src/pages/News.vue | `RESTORED` | - | - | - |
| `NEWS-02` | News CGI | news CGI; zero requests in 2010 window | PROVEN_PRODUCTION_USE | No separate news CGI | news.controller.ts covers it | `DECOMMISSIONED` | **Gap:** `news` CGI drew ZERO requests in the final-era window | - | - |

### Platform & Operational

*PRESENT_PARTIAL 1 · MISSING_ACTIONABLE 1 · DECOMMISSIONED 1 — 3 rows*

| ID | Capability | Historical evidence | Class | Current CTR | Current evidence | Status | Divergence / Gap | Lane | Issue |
|---|---|---|---|---|---|---|---|---|---|
| `PLAT-01` | Colony and place content breadth | 131 template directories, 24 CGI trees | PROVEN_SOURCE | 837 places on beta | beta DB baseline at ba8c6a3 | `PRESENT_PARTIAL` | **Gap:** 131 historical template directories; content breadth work | BACKLOG-P3 | #26 |
| `PLAT-02` | Spell-check helper | aspell/nspell.pl, 376 requests | PROVEN_PRODUCTION_USE | No spell-check helper | n/a | `MISSING_ACTIONABLE` | **Gap:** Trivial | BACKLOG-P3 | #26 |
| `PLAT-03` | ccenter and ftfetch | broken config; zero requests in 2010 window | PROVEN_PRODUCTION_USE | No ccenter/ftfetch | n/a | `DECOMMISSIONED` | **Gap:** Broken config historically; ZERO requests in the final-era window | - | - |
---

## 8. Sources

### Historical corpus — READ-ONLY, never altered
```
$HIST = ~/Downloads/Skate.FM Submissions - 202608141549/Cybertown/Cybertown Backups
$CC   = $HIST/IVN11/136/services/http/80/cgi-bin/colonycity
$CY   = $HIST/IVN11/136/services/http/80/cgi-bin/cybertown
$CS   = $HIST/IVN11/137/services/commserv/2000
$LOGS = $HIST/IVN2010/136/services2/http/80/logs
```

Coverage: **78** Cybertown-authored `.pl` files including the complete `phase3.pl` transfer
engine · **9** CGI trees · **39** CGI binaries, 32 retaining symbol tables · blaxxun RA source
· blaxxun server binaries (**VWP 5.1.0.10** — never assume 6.0 behaviour) · FairCom c-tree
files, offline · **131** template directories with `money.cfg` and `exper.cfg` · **13** logs
including 4 money logs · a 19,918-row docroot manifest.
**Missing:** `/services/http/80/htdocs` — the single largest hole.

### Recon package (2026-08-29)
`side-comm-serv-setup/.reports/ctr-historical-gap-recon/2026-08-29/`

`FINAL_STATE.md` · `EXECUTIVE_SUMMARY.md` · `CTR_GAP_MATRIX.md`/`.tsv` (the 122-feature
census this document reconciles) · `BANKING_RECON.md` (56 K, 25 sections) ·
`BANKING_IMPLEMENTATION_HANDOFF.md` · `HISTORICAL_SOURCE_MAP.md` · `HISTORICAL_ASSET_MAP.md` ·
`PRODUCTION_USAGE_MAP.md` · `EVIDENCE_LEDGER.tsv` (95 claims) · `OPEN_QUESTIONS.md` ·
`WAYBACK_RECOVERY.md` · `HOME_WAYBACK_RECOVERY.md` · `NON_HOME_RECOVERABLE.tsv` (247 rows) ·
`wayback/cdx/all.cdx` (386,484 captures, 1998–2012; regenerable via `cdx_index.sh` — do not
commit).

### Recovered assets
`wb-ct-scrape/citycash-transfer/` — 11 sha256-verified console chrome slices,
dimension-matched to the Bank templates' declared geometry. **These are the Fundbox skin**;
the Bank's own skin is not archived. Bank and Fundbox are one design with two skins, and the
Fundbox skin is complete and sufficient.

### Deployment
`cybertown-dev-ops/runbooks/ctr-beta-deploy.md` — host, access, deploy and the
verify-by-content procedure. Verify by content, never by HTTP status: Cloudflare Access
answers `302` at the edge whether the origin is healthy or dead.

## 9. Provenance of this document

Built by reconciling the 122-row `CTR_GAP_MATRIX.tsv` census — snapshotted at `d0c792f`,
before BANK-A1 merged — against current source at `ba8c6a3`. Every row's *current* column was
re-verified against committed code, not carried forward. The material changes from that
snapshot:

- **Ten `BANK-*` rows moved from `MISSING` to `RESTORED`.** BANK-A1 landed the transfer,
  memo, receipts, home precondition, insufficient-funds refusal, atomic debit/credit and
  ledger.
- **`ECON-06`, `ECON-07`, `ECON-09` moved to `RESTORED`.** The economy was corrected to
  deployed runtime config in `api/src/libs/economy.ts`.
- **`GOV-01` gained a divergence note.** `roleMap` became private in `ba8c6a3`.
- **`COMM-03` (private mail) was reassessed `PARTIAL` → `RESTORED`, and no lane was created.**
  The recon's `PARTIAL` rested on "mapping unverified", not on an identified gap. CTR's inbox
  covers compose, reply, list, delete, broadcast and intro
  (`api/src/routes/inbox.routes.ts`), and it is keyed on the recipient's home place — which
  **matches** the historical `i<HOM><date>` inbox key. No historical mail capability was found
  that CTR lacks.
- **`GOV-07` (admin console) confirmed `RESTORED`, not a gap.** 19 admin routes and 29 Vue
  pages. `ADMIN-A1` was scoped down to three specific capabilities rather than "restore admin".
- **`GENERAL-INBOX-SECURITY` was re-scoped.** The Inbox `v-html` is not an unguarded sink —
  all six writer call sites sanitise. The real defect is that safety is by convention rather
  than construction. See [#14](https://github.com/Cyber-Town-Next-Gen/ctr-restoration/issues/14).
