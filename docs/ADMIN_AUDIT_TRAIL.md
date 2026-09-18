# CTR admin audit trail (CTBL-0025)

The operator audit store: what it records, what it refuses to record, and which admin
actions are covered so far.

`docs/ADMIN_SECURITY_BASELINE.md` section 11 states the obligation and section 12 states
the redaction rule. This document is the implementation of both. Where the two disagree,
the baseline wins and this file is wrong.

---

## 1. The single sentence

Every administrative action that changes state writes one durable row naming the
authenticated operator, and a successful change and its record commit together or neither
of them happens.

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

Nine names, in `api/src/libs/audit-event.ts`. Shape: `admin.<noun>.<verb>`, lower case,
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

### What is still missing after this

- **Operator reasons.** Baseline section 11 requires a reason for role changes, and neither
  role route has one to record: the hire request carries no reason field at all, and
  `fireRole` discards the one its request does carry. Both events therefore store
  `reason = NULL`. Collecting and enforcing reasons is its own item; inventing one here
  would put a sentence in the store that no operator wrote. **CTBL-0025 stays OPEN for it.**
- **Private-content reads.** `searchUserChat` returns a member's chat lines to an operator
  and records nothing. Baseline section 11 asks for the access to be logged — the fact and
  the identifier, never the content. The other admin read surfaces (transaction history,
  wallet history, user places, owned objects) still need classifying against that rule.
- **No audit read API and no audit UI.** The recovered contract names a store, not a
  surface, and an admin-readable surface needs its own gate and its own redaction review
  before it exists.

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

## 9. Metadata actually recorded

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
