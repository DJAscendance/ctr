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

Proved by `api/src/controllers/admin.controller.audit.integration.spec.ts` against a real
MySQL, both directions: a forced audit failure leaves no ban and no account removal, and a
forced business failure leaves no `allowed` row.

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
| `admin.role.hire` | role hire | no — see section 6 | yes |
| `admin.avatar.approve` | avatar approve | no — see section 6 | yes |
| `admin.avatar.reject` | avatar reject | no — see section 6 | yes |
| `admin.place.update` | place update | no — see section 6 | yes |
| `admin.object.update` | object update | no — see section 6 | yes |

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

## 6. What is deliberately not covered, and why

Five of the nine actions record refusals but **not** successes. The reason is the same in
every case and it is not an audit problem:

- `AdminService.hireRole` does not await `addIdToAssignment`;
- `AdminController.avatarApprove` and `avatarReject` do not await `AvatarService`;
- `AdminController.placesUpdate` does not await `PlaceService.updatePlaces`;
- `AdminController.objectssUpdate` does not await `AdminService.updateObjects`.

Each answers 200 before its write has resolved, so there is no committed mutation for an
audit row to commit *with*. Recording success anyway would produce the one row this store
must never hold: an `allowed` event for a change nobody checked. Awaiting those promises
is a change to the write contract — it turns silent write failures into visible 500s — and
belongs to the floating-promise repair item, not here. **When that lands, adding
`recordChange` to those five is small: the names already exist and the refusal paths are
already wired.**

Also untouched, and tracked elsewhere:

- the raw-id validation debt in `addBan`, `deleteBan` and `removeAccount`. The audit path
  stores a non-positive or unparseable id as `null` rather than throwing, so it records
  "no usable target" without changing what those routes accept;
- the breadth of `canAdmin()`, which answers true for Admin plus six Security roles. This
  store records the actions current authorization allows; it does not redefine who may
  perform them;
- account-removal financial-history and completeness debts.

No audit **read API** and no audit **UI** ship here. The recovered contract names a store,
not a surface, and an admin-readable surface needs its own gate and its own redaction
review before it exists.

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
| `admin.role.fire` | `role_id`, `place_id`, `assignments_removed` |
| `admin.account.remove` | `username`, `owned_places_removed` |

`ban_type` is mandatory on both ban events: `full` and `jail` are two different sentences
with two different contracts, and a later reader must be able to tell which one was handed
down without inferring it from the `ban` table. `admin.ban.remove` reads the before-state
inside the same transaction as the update, because afterwards the old status is gone.
`username` is kept on account removal because after the delete the id alone identifies
nobody.
