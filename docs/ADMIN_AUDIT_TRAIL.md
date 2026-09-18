# CTR admin audit trail (CTBL-0025)

The operator audit store: what it records, what it refuses to record, which admin actions
are covered, and which admin reads owe an access event.

`docs/ADMIN_SECURITY_BASELINE.md` section 11 states the obligation and section 12 states
the redaction rule. This document is the implementation of both. Where the two disagree,
the baseline wins and this file is wrong.

---

## 1. The single sentence

Every administrative action that changes state writes one durable row naming the
authenticated operator, and a successful change and its record commit together or neither
of them happens. Where the baseline requires a reason, the operator writes it or the action
does not run; and where an administrative read returns another member's private content,
the content is not disclosed until the read has been recorded.

---

## 2. The store

One table, `admin_audit_event`. Created by
`api/db/migrations/20260918090000_create_admin_audit_event.ts`.

| column | type | meaning |
|---|---|---|
| `id` | int unsigned, auto | row id |
| `created_at` / `updated_at` | datetime, default now | table convention, database-set |
| `occurred_at` | datetime, not null | UTC wall clock, **application-set** |
| `event` | varchar(64), not null | a name from the registry in section 4 |
| `result` | varchar(16), not null | `allowed`, `denied` or `failed` |
| `authority` | varchar(32), not null | which layer of baseline section 4 was relied on |
| `actor_member_id` | int unsigned, not null | the authenticated operator |
| `target_type` | varchar(32), null | `member`, `ban`, `role`, `avatar`, `place`, `object` |
| `target_id` | int unsigned, null | the acted-on entity |
| `target_member_id` | int unsigned, null | the member the action was about |
| `reason` | varchar(255), null | operator-supplied reason |
| `source` | varchar(45), null | request origin address |
| `metadata` | text, null | small scrubbed JSON of facts worth keeping |

Indexes, each with one read behind it:

| index | columns | the question it answers |
|---|---|---|
| `admin_audit_event_actor_index` | `actor_member_id, id` | what did this operator do |
| `admin_audit_event_target_member_index` | `target_member_id, id` | what was done to this member |
| `admin_audit_event_event_time_index` | `event, occurred_at` | every ban added in this window |
| `admin_audit_event_time_index` | `occurred_at` | the plain timeline |

There are no others. The timeline index is not redundant with the composite: a query
filtered only on time cannot use an index whose leading column is `event`.

### Why `occurred_at` exists next to `created_at`

`CURRENT_TIMESTAMP` is only UTC when the server's session timezone happens to be. Every
row has to mean the same thing, so the writer formats the instant from `toISOString()` and
sends it as a string. When the two columns disagree, read `occurred_at`.

### Why there are no foreign keys

Neither member reference is a foreign key, and that is the design, not an oversight.

- `target_member_id` cannot reference `member.id`. The most important row this table will
  ever hold is the account-removal event, and that action deletes the member row it names.
  `RESTRICT` would block the removal; `CASCADE` would delete the evidence with the
  account. Both destroy the record the store exists to keep.
- `actor_member_id` cannot reference it either: an operator's own account may be removed
  later, and everything they did must stay attributable afterwards.

The same absence protects the append-only rule in section 5 — with no foreign key, no
delete anywhere else in the schema can cascade into audit history. `place_role_access`
omits a `place_id` foreign key for a comparable reason and is the precedent.

---

## 3. The transaction contract

Two write paths, and the split between them is the whole design. Both live in
`api/src/services/admin-audit/admin-audit.service.ts`.

**`recordChange(trx, input)` — successful changes, atomic.**
Writes `result = 'allowed'` inside the business mutation's own transaction, and **throws**
if the insert fails, which rolls the mutation back with it. Baseline section 11 says a
state change owes an event, so a state change that could not be recorded has not earned
its commit. The consequence that matters: **an `allowed` row can only exist where the
business mutation committed.**

**`recordAccess(input)` — private-content reads, disclosure-gating.**
Writes `result = 'allowed'` on the ordinary connection and **throws** if the insert fails.
There is no business transaction to be atomic with, because a read changes nothing; what
replaces atomicity is order plus refusal. The read runs first, so the row is never a claim
about a read that did not happen; the row is written second; and only then may the handler
answer with the content. The consequence that matters: **private content this store covers
is never disclosed without a row naming who read it.** This is the one path where an audit
outage changes the response, and it changes it to a 500, never to an allowance.

**`recordOutcome(result, input)` — refusals and failures, best effort.**
Writes `denied` or `failed` on the ordinary connection, and **never throws**. Neither has
a transaction to join: a refusal never opened one, and a failure's has already rolled
back. Neither may change the response the handler already decided on — an audit outage
must not turn a 403 into a 500, and must certainly not turn a refusal into an allowance.
A `denied` or `failed` row therefore carries no atomicity promise, by design.

Proved against a real MySQL, both directions, by
`api/src/controllers/admin.controller.audit.integration.spec.ts` for the ban and
account-removal paths and
`api/src/controllers/admin.controller.audit.phase-b.integration.spec.ts` for the other
five: a forced audit failure leaves no mutation behind, and a forced business failure
leaves no `allowed` row.

---

## 4. The event registry

Eleven names, in `api/src/libs/audit-event.ts` -- nine state changes and two private-content
reads. Shape: `admin.<noun>.<verb>`, lower case,
dotted, so the store can be queried by prefix and the name survives a URL, a log line or a
grep unchanged. **These names are permanent** — renaming one orphans the rows already
written under it.

| event | baseline action | success recorded | refusal recorded |
|---|---|---|---|
| `admin.ban.add` | ban add | **yes, atomic** | yes |
| `admin.ban.remove` | ban delete | **yes, atomic** | yes |
| `admin.role.fire` | role fire | **yes, atomic** | yes |
| `admin.account.remove` | account removal | **yes, atomic** | yes |
| `admin.role.hire` | role hire | **yes, atomic** | yes |
| `admin.avatar.approve` | avatar approve | **yes, atomic** | yes |
| `admin.avatar.reject` | avatar reject | **yes, atomic** | yes |
| `admin.place.update` | place update | **yes, atomic** | yes |
| `admin.object.update` | object update | **yes, atomic** | yes |

All nine mutation actions record both directions. The last five arrived later than the
first four, and section 6 says what had to change first.

Two more names record a READ rather than a change. Baseline section 11: "Read-only
administrative reads do not owe a change event, but reads of another member's private
content — chat history above all — owe an access event."

| event | the read | success recorded | refusal recorded |
|---|---|---|---|
| `admin.chat.read` | `searchUserChat` | **yes, before disclosure** | yes |
| `admin.transaction.read` | `getTransactions`, `getTransactionsByWalletId` | **yes, before disclosure** | yes |

One name per KIND of private content, not one per route. `getTransactions` and
`getTransactionsByWalletId` return the same rows from the same table and differ only in
scope, so they share a name and say which scope they were in — `scope: 'member'` or
`scope: 'community'` — in metadata. A separate name would split one history in two and
answer no question the metadata does not.

`isAccessEvent(name)` distinguishes the two families, because the difference decides which
write path a caller may use: a change event commits inside the mutation's transaction, an
access event gates the disclosure instead.

`admin.donor.change` deliberately does not exist. Baseline section 11 lists donor change
as owing an event "if ever enabled", and it is not: `AdminController.addDonor` compares a
list of access levels against the string `'admin'`, so its granted branch has never run.
An event name for a path that cannot execute would assert a capability CTR does not have.

---

## 5. Append-only

`AdminAuditEventRepository` exposes `insert` and nothing else. There is no `update`, no
`delete`, no `truncate` and no read, so no controller, service or future feature can reach
for one. A database administrator with a shell is outside this contract and always will
be; the point is that CTR itself offers no lever. Enforced by a test that inspects the
repository's and the service's method surface.

---

## 6. The five writes that had to be repaired first

Four actions were audited before the other five, and the gap was never an audit problem.
Five handlers answered 200 before their own write had resolved:

- `AdminService.hireRole` did not await `addIdToAssignment`;
- `AdminController.avatarApprove` and `avatarReject` did not await `AvatarService`;
- `AdminController.placesUpdate` did not await `PlaceService.updatePlaces`;
- `AdminController.objectssUpdate` did not await `AdminService.updateObjects`.

Two consequences, and the second is worse than the first. There was no committed mutation
for an audit row to commit *with*, so recording success would have produced the one row
this store must never hold — an `allowed` event for a change nobody checked. And a write
that *rejected* could not reach its own handler's catch block: the rejection left the
process as an unhandled rejection while the operator was told the action had succeeded.

All five now await their write inside a transaction the `allowed` event joins, so the rule
in section 1 holds for every mutation action: no success answer before the write lands, and
no committed write without its event. The visible change for a client is that a database
failure is now a 500 or a 400 instead of a false success.

### Where each transaction is opened

Two shapes, and the split follows what the action touches.

`AdminService.hireRole` and `AdminService.updateObjects` open their own, exactly as
`addBan`, `deleteBan` and `fireRole` already did: `AdminService` holds `AdminAuditService`
and these are wholly admin operations.

Avatar approve/reject and place update are opened by the controller, because
`AvatarService` and `PlaceService` are domain services with citizen-facing callers and the
audit store is not their concern. `removeAccount` is the precedent — it orchestrates a
transaction across several services for the same reason. Each service method gained an
optional `Knex.Transaction`, routed through `queryOn`, so every pre-existing caller that
passes nothing keeps the behaviour it has always had.

### Zero rows is not a change

An `allowed` row says an authorised operator's write ran and committed. It does not by
itself say a row moved, because these routes accept raw ids and always have: an id that
names nothing updates nothing and still answers 200.

Rather than change what those routes accept — a separate contract, and not this lane's —
each event records what the database actually did. `rows_updated` is the affected-row count
the update reported, and the avatar events also carry `old_status`, read inside the same
transaction, which is the only thing that separates "the id named no avatar" (null) from
"the avatar already had that status" (`rows_updated` zero). `admin.ban.remove` set this
precedent in the first four: a missing ban reads as nulls rather than throwing.

### What Phase C then closed

Phase B left two gaps and named them. Section 10 (reasons) and section 9 (private reads)
below are what closed them. What remains after Phase C:

- **No audit read API and no audit UI.** The recovered contract names a store, not a
  surface, and an admin-readable surface needs its own gate and its own redaction review
  before it exists. Baseline section 11 does not require one, so this is not an open
  CTBL-0025 obligation.

Also untouched, and tracked elsewhere:

- the raw-id validation debt in `addBan`, `deleteBan` and `removeAccount`. The audit path
  stores a non-positive or unparseable id as `null` rather than throwing, so it records
  "no usable target" without changing what those routes accept;
- the breadth of `canAdmin()`, which answers true for Admin plus six Security roles. This
  store records the actions current authorization allows; it does not redefine who may
  perform them;
- account-removal financial-history and completeness debts.

---

## 7. What never reaches a row

Baseline section 12, implemented as `redactMetadata` in `api/src/libs/audit-event.ts` and
tested one prohibition family at a time in `audit-event.spec.ts`.

Three rules, applied in order; a value must survive all three:

1. A key whose name matches a credential pattern (`password`, `hash`, `salt`, `token`,
   `jwt`, `secret`, `credential`, `apikey`, `privatekey`, `signing`, `cookie`, `session`,
   `authorization`, `auth`, `bearer`, `env`) is dropped, value unread. So is a key that
   carries message or chat content, or an email address (`body`, `content`, `text`,
   `message`, `chat`, `email`, `mail`).
2. A value that is not a scalar is dropped. Objects and arrays are how a whole request
   body gets stored by accident.
3. Strings are truncated at 120 characters and the object is capped at 20 keys.

Callers pass named facts, never raw input; the scrub runs anyway, as the net under them.

The only thing the audit path reads off the `Request` object is `request.ip`. No header,
cookie or body field is touched, so nothing carrying a credential can arrive that way.

---

## 8. Actor authority

The actor is `MemberService.decryptSession(...).id` and nothing else. No request body,
query string, client username or client role claim is consulted, and the target id is
never reused as the actor. `admin.controller.audit.spec.ts` fires every audited route with
a body that claims six different ways to be another member and asserts the stored actor is
still the session's.

For `fireRole`, the row also records *which* gate granted the action — `global-role` for a
global Admin, `resource-scoped-right` for a security-role manager. Baseline section 4
keeps those two paths apart, and "on what basis was this allowed" is not answerable later
from the actor's id alone, because role holdings change.

---

## 9. Which admin reads owe an access event

Baseline section 11 draws a line, not a blanket: "Read-only administrative reads do not owe
a change event, but reads of another member's private content — chat history above all —
owe an access event." Auditing every admin `GET` would be the easy reading and the wrong
one; it would assert an obligation the baseline does not state and bury the events that
matter under ones that do not.

**The test used, stated so a future route can be measured against it:** a read owes an
access event when it returns a member's own authored words or their own recorded personal
activity, and no citizen can obtain that data about them anywhere else in the API. A read
that returns rows describing the shared world — a place, an object, who holds a role —
does not, even when it is scoped to one member and even when only Security may call it.
Neither "Security-only" nor "member-scoped" is by itself evidence of private content.

| route | classification | evidence |
|---|---|---|
| `searchUserChat` | **REQUIRES_ACCESS_AUDIT** | Selects `message.body` for one named member. The baseline names chat history outright, and nothing in CTR lets a citizen search another member's chat lines. |
| `getTransactionsByWalletId` | **REQUIRES_ACCESS_AUDIT** | One named member's whole financial ledger. `GET /api/bank/account` resolves the account from the session and from nothing else, so no citizen can see another member's. |
| `getTransactions` | **REQUIRES_ACCESS_AUDIT** | The same ledger columns from the same table, unscoped across every member. Auditing the per-member read and not this one would leave an operator a way to read everyone's ledger unrecorded. |
| `findUserPlaces` | ORDINARY_ADMIN_READ | Returns `place` rows of type `club` or `storage` — world entities, not member content. Any logged-in citizen can already list clubs at `GET /api/club/search`. |
| `getObjectInstances` | ORDINARY_ADMIN_READ | An inventory listing: object name, owner username, the place it sits in. `GET /api/place/:placeId/object_instance` serves the same rows to anyone, with no session at all. |
| `getOwnedObjects` | ORDINARY_ADMIN_READ | The same inventory shape scoped to one member. See the note below — this is the closest call on the list. |
| `searchUsers` | ORDINARY_ADMIN_READ | Username and last-login, the same identity a citizen sees on any profile. |
| `getBanHistory` | ORDINARY_ADMIN_READ | CTR's own moderation record about a member, not content the member authored. |
| `getCommunityData` | ORDINARY_ADMIN_READ | Aggregate community counts. Names no member. |
| `places`, `searchAllPlaces` | ORDINARY_ADMIN_READ | World-entity rows, member-visible in the world itself. |
| `getRoleList` | ORDINARY_ADMIN_READ | Role names and assignment counts. Names no member. |
| `avatars` | ORDINARY_ADMIN_READ | The moderation queue: avatars submitted for review, which is what the queue is for. |

`api/src/controllers/admin.controller.audit.phase-c.spec.ts` asserts both halves — that the
three audited reads write their event, and that the ordinary ones write nothing.

### The one close call, recorded rather than buried

`getOwnedObjects` lists a member's objects including those in their backpack, and a
backpack is the one part of that inventory no other citizen can see. It is classified
ORDINARY_ADMIN_READ because an inventory line names a world object and its location, not
something the member wrote or a record of their personal activity — the same reason
`findUserPlaces` is ordinary. That is a judgement about where the baseline's line falls,
not a proof, and it is written here so a later reviewer can disagree with it on the
evidence rather than discover it by reading the controller.

---

## 10. The operator reason contract

Baseline section 11 lists `reason` as "required for bans, role changes and account
removal". Phase A and Phase B recorded whatever arrived and accepted nothing arriving; a
requirement the server does not enforce is a suggestion, so Phase C enforces it.

**Five actions require one**, recovered from the current routes rather than assumed:

| action | route | body field |
|---|---|---|
| ban add | `POST /api/admin/ban` | `reason` |
| ban delete | `POST /api/admin/deleteban` | `banReason` |
| role hire | `POST /api/admin/hirerole` | `reason` |
| role fire | `POST /api/admin/firerole` | `reason` |
| account removal | `POST /api/admin/remove-account` | `reason` |

No other currently active admin action is covered: avatar approve/reject, place update and
object update are not bans, role changes or account removal, and widening the rule past what
the baseline says would be this lane inventing a contract rather than recovering one.

**The rule**, `validateOperatorReason` in `api/src/libs/audit-event.ts`: the value must be a
string; it is trimmed; what is left must be 1 to 255 characters, the width of the `reason`
column. Anything else is refused. There is no default, no placeholder, no `N/A`, and no
silent truncation of an over-long reason — a stored reason that is not the sentence the
operator wrote is a misquote in an evidentiary record.

**The refusal** is `400`, with no business mutation and **no audit row at all** — not even a
denied one. A denied row means an authority question that answered no; an authorised
operator who mistyped a form has attempted no administrative action. Phase B's independent
QA classified controller validation 400s as outside the authorization-denial contract, and
this follows it.

**Order.** The authorization gate runs first, always. A caller without authority still gets
`403` and still owes the denied event; turning their refusal into a validation `400` would
both mislead them and lose the row. `AdminController.requireReason` is called only after the
gate has opened.

`normaliseReason` still exists and still truncates. It is the storage-side net protecting
the column from a value that already passed the gate, not a second opinion about whether the
action may run.

### Where the operator's reason ends and CTR's sentence begins

`deleteBan` keeps a business string of the form `<reason> (Deleted by <username>)` in the
ban history, unchanged, because the members screen has always read that way. The audit row
stores the operator's reason **without** that suffix: section 11's `reason` field means what
the operator wrote, and the actor already has a column of its own. The two strings are built
separately in the controller and asserted apart in
`admin.controller.audit.phase-c.spec.ts`.

The admin UI collects each reason from the operator and never supplies one. Two controls
had no input at all before Phase C (role hire, role fire), one had a field the modal never
showed (ban delete), and account removal used a `window.confirm` box, which cannot collect
text — each now has a required input, and nothing more about those screens changed. The ban
delete modal deliberately opens EMPTY rather than pre-filled with the original ban's reason:
that text is why the ban was *given*, by whoever gave it, and reusing it would file someone
else's words as this operator's reason for lifting it.

---

## 11. What an access event never contains

Section 7's redaction rule applies to access events in full, and one addition is specific to
them: **the search string is never stored.** `searchUserChat` takes operator-supplied search
text, and operator-supplied text aimed at a member's chat can itself name private content.
`redactMetadata` would drop a key called `search`-anything under its content rules anyway;
not passing it is the rule, and the scrub is the net under it.

What an access event does carry: the operator, the member read about, the capability relied
on, the page read, and how many rows came back.

| event | metadata |
|---|---|
| `admin.chat.read` | `capability`, `rows_returned`, `limit`, `offset` |
| `admin.transaction.read` | `capability`, `scope`, `rows_returned`, `limit`, `offset` |

`capability` records which tag actually granted the read — `security` for all three routes
today — because `authority` can only say *which layer* of baseline section 4 was relied on,
and all three rely on the global layer. `admin.controller.audit.phase-c.spec.ts` asserts, on
a read whose rows and search string are both known strings, that neither appears anywhere in
the stored row.

---

## 12. What happens when an access event cannot be written

**The private content is withheld.** The handler answers `500` and the operator sees
nothing. This is the opposite of `recordOutcome`'s fail-soft rule, and the asymmetry is the
point: a refusal that goes unrecorded still refused, but private content handed over
unrecorded is exactly the disclosure the event exists to make answerable later.

Three neighbouring cases, so the policy is not over-read:

- **The read itself failed.** No `allowed` event — there was no disclosure to record. The
  attempt is written as `failed` through the ordinary fail-soft path, and the handler's
  `400` is unchanged.
- **The caller had no authority.** `403` and a `denied` event, exactly as a refused mutation
  behaves. An audit outage here does **not** change the response: a denial may never become
  anything else because the store was unreachable.
- **An ordinary admin read.** Nothing is written and nothing is gated. A store outage cannot
  take those routes down, because they never call the store.

---

## 13. Metadata actually recorded

Small, named, and chosen to answer a question a reviewer will have after the fact.

| event | metadata |
|---|---|
| `admin.ban.add` | `ban_type`, `ban_id`, `time_frame_days`, `end_date_utc` |
| `admin.ban.remove` | `ban_type`, `old_status`, `new_status` |
| `admin.role.hire` | `role_id`, `place_id`, `assignment_id` |
| `admin.role.fire` | `role_id`, `place_id`, `assignments_removed` |
| `admin.avatar.approve` | `old_status`, `new_status`, `rows_updated` |
| `admin.avatar.reject` | `old_status`, `new_status`, `rows_updated` |
| `admin.place.update` | `rows_updated`, `place_type` |
| `admin.object.update` | `rows_updated`, `object_status`, `price`, `directory`, `filename` |
| `admin.account.remove` | `username`, `owned_places_removed` |

`ban_type` is mandatory on both ban events: `full` and `jail` are two different sentences
with two different contracts, and a later reader must be able to tell which one was handed
down without inferring it from the `ban` table. `admin.ban.remove` reads the before-state
inside the same transaction as the update, because afterwards the old status is gone.
`username` is kept on account removal because after the delete the id alone identifies
nobody.

`admin.role.hire` records `place_id` as null rather than omitting it: this route grants
global roles only, and the field is kept so the row reads the same way as the
`admin.role.fire` row next to it. `admin.object.update` keeps `directory` and `filename`
because they are the CTBL-0032 surface — the asset an object points at is the thing a
security reviewer will want to see a history of. No place name, description or slug is
stored: `place_type` and `rows_updated` answer what changed without copying member-visible
text into the store.
