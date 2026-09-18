# CTR admin security baseline

The rule every current and future administration surface in CTR is built to.

It exists because the admin backlog (roles, bans, avatars, places, objects, money,
account removal) is about to grow, and each of those items would otherwise invent
its own answer to "who may do this, and what may they see". This document is that
answer, written once.

**Status:** binding. A new administration route, screen or service method that
breaks a rule below has failed review, regardless of what else it achieves.

**Scope:** citizen administration — the `/api/admin/*` surface and
`spa/src/pages/admin/`. It does not govern deployment, infrastructure or database
operations, which are not reachable from a browser and are not administration.

---

## 1. The single sentence

An administrator reaches every approved operator result without ever seeing a
plaintext password, editing a secret in a browser, editing a raw server
configuration file, or naming an arbitrary filesystem path.

---

## 2. The four hard prohibitions

Absolute. No authority level, no feature flag and no "temporary" exception.

### 2.1 No plaintext passwords

No administrator, at any authority level, may see, retrieve, export, print or be
emailed a member's password or password hash through any surface CTR provides.
Password administration is **reset or replacement only**: the operator triggers a
reset, and the member sets the new value themselves.

No admin route may exist whose purpose is to view or set a password directly.

### 2.2 No browser secret editing

No administration screen accepts, displays or stores a service credential, API
secret, database password, private key, signing key or environment value.
Identity and deployment secrets live outside citizen administration entirely, in
the environment and in deployment configuration.

### 2.3 No raw config editing

No administration screen edits raw server configuration text. Where an operator
result genuinely needs configuration, it is reached through a typed, bounded
control with a known set of valid values — never a free-text blob that is parsed
and applied.

### 2.4 No arbitrary filesystem paths

No administration screen accepts a free-text filesystem path.

A **bounded asset identifier may be typed**, provided it cannot express a path at
all. See section 7 for the rule and `api/src/libs/asset-identifier.ts` for the
implementation.

Two limits on that, both absolute:

- The identifier is rejected **before it becomes path input** — at the server
  boundary, before any path is resolved and before any record is written.
- This is never read as "paths are allowed because the containment catches them
  later". The path-containment helpers stay, as defence in depth, **behind** the
  rejection, not instead of it.

---

## 3. The admin authorization boundary

**The server is the boundary. The SPA is not.**

Hiding a button is a courtesy to the operator, not a control. Every administrative
capability the UI expresses must be independently enforced by the route that backs
it, and the two must agree. A screen the UI hides but the API serves is a defect,
and so is a screen the UI offers but the API refuses.

Every `/api/admin/*` handler follows the same three steps, in this order:

1. **Identify.** `memberService.decryptSession(request, response)`. No session
   means the handler returns immediately; `decryptSession` answers the request
   itself.
2. **Authorize.** Resolve authority through a helper that fails closed
   (section 5), then branch.
3. **Validate.** Reject malformed input (section 7) **before** calling any
   service, resolving any path or writing any row.

Authorization precedes validation: a caller who is not entitled learns nothing
about whether their input was well formed.

---

## 4. Global authority versus resource-scoped authority

Historical Cybertown rights were not one global administrator role, and CTR must
not flatten them into one. Every administrative action names which layer it needs.

| layer | meaning | resolved by |
|---|---|---|
| **global role** | authority over the whole community, independent of any one resource | `getAccessLevel()` capability tags, `canAdmin()` |
| **resource-scoped right** | authority over one named resource, held because of a role attached to that resource | `canSecurityManageRole(roleId)` and its equivalents |
| **owner authority** | the member owns the resource | ownership lookup on the resource |
| **deputy authority** | delegated by an owner for one resource | delegation lookup on the resource |
| **job authority** | held while employed in a job, and lost when it ends | employment lookup |

Two rules follow:

- **A global role is never used as a shortcut for a scoped right.** `hireRole` and
  `fireRole` are the worked example: a global Admin may manage any role, and a
  security-role manager may manage only the roles their own role covers. The two
  paths are evaluated separately and neither widens the other.
- **A new admin action states its layer in writing** — in the handler's
  documentation and in this table's spirit — before it is implemented. "Admin can
  do it" is not a specification.

`canAdmin()` currently answers `true` for the Admin role **and** six Security
roles, so it is coarser than the table above. That is a known, documented
limitation, not a licence: splitting it is `CTBL-0026` plus the per-item work, and
until then no new action may rely on `canAdmin()` to mean "Admin only".

---

## 5. The fail-closed denial rule

**An authority value that is missing, empty, malformed or of an unexpected shape
denies. It never throws, and it never opens the gate.**

`MemberService.getAccessLevel()` resolves a `string[]` at runtime but is declared
wider, so a gate that reaches straight for `.includes(...)` is trusting a shape
TypeScript does not guarantee — and throws a 500 on `null` instead of refusing.
A 500 is not a refusal.

Therefore:

- Read capability tags only through `hasAccess()` / `accessCapabilities()` in
  `api/src/libs/access-level.ts`. They treat any non-array as "holds nothing".
- Never write `accessLevel.includes(...)` or `accessLevel.length` in a gate.
- A boolean authority helper must return a real boolean. `canAdmin()` returns
  `!!...`, so `if (admin)` is sound for it; a helper that could resolve a non-
  boolean must be compared explicitly.
- An empty access level (`[]`) is truthy in JavaScript. It means **holds
  nothing**, and must deny.

Every gate owes an automated test proving that `[]`, `null`, `undefined` and a
non-array value each deny without a 500.

---

## 6. The explicit refusal rule

**Every denial produces a visible, explicit response. Silence is not a refusal.**

A denied caller receives a `403` with a body. A handler whose deny path falls off
the end of the function — returning nothing, leaving the request hanging — is a
defect even though no protected work ran, because the operator cannot tell a
refusal from an outage.

An invalid input receives a `400` with a body, and the protected service is not
called.

The denial body carries a refusal and nothing else. It never reveals whether the
target exists, what authority would have been sufficient, or any part of the
record the caller could not reach.

---

## 7. The filesystem identifier rule

Where an administrative surface names a file-backed resource, it accepts an
**identifier**, never a path.

An identifier is **one segment**. The rule has two layers, and they are applied in
order.

### 7.1 Layer 1 — the reject floor. Never widened.

Reject the value if it:

- is not a string;
- is empty, or is only whitespace;
- exceeds the declared maximum length;
- contains `/` or `\`;
- contains `:` — this kills drive-letter paths (`C:\path`) and URI schemes
  (`file://x`);
- contains `..`, or is exactly `.` or `..`;
- begins with `.`;
- contains NUL or any other control character (`\u0000`–`\u001F`, `\u007F`).

Absolute paths, multi-segment syntax, drive letters and URI schemes are all
covered by the separator, colon and dot rules. No other check substitutes for
them.

A **stored** value that fails layer 1 is a data finding — stop and escalate. It is
never a reason to widen layer 1.

### 7.2 Layer 2 — the charset allow-list.

| identifier | grammar | max |
|---|---|---:|
| asset directory | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` | 64 |
| asset filename | `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` | 128 |

Layer 2 may be widened only by a recorded decision that names the real stored
value which forced it, and only after re-running the verification in section 7.4.

### 7.3 Where it is enforced

- `api/src/libs/asset-identifier.ts` — pure, no I/O, fails closed.
- The controller rejects with `400` **before** the service call, before
  `path.resolve`, and before any database write.
- `resolveAssetPath`, `resolveRealAssetPath` and `resolveWithinUploadPath` are
  unchanged and remain as defence in depth behind it.
- The SPA may mirror the rule for immediate feedback. **The SPA is never the
  boundary.**

### 7.4 Verification obligation before widening or deploying

Before a grammar change ships, list — read-only — every distinct stored value the
grammar would reject, on the development database and on the target deployment.
Report counts and character classes only; never a real asset value belonging to a
member.

---

## 8. The credential projection rule

**No admin response is ever built from a whole repository row.**

Admin responses that include member data name their fields explicitly. A handler
that returns a repository record as-is inherits every column that record grows
later — which is how a password hash reaches a browser without anyone deciding it
should.

Write the projection at the point the response is built, list the fields, and add
to that list deliberately.

---

## 9. The secret boundary

**No response from any administration surface carries a credential.**

Never present in an admin response, at any authority level, in any field, in any
error message and in any log line an operator can read:

- a password or password hash;
- a password-reset token;
- a session token or JWT;
- an API key or service credential;
- a private or signing key;
- an environment value.

An error is a secret boundary too: a stack trace or a raw driver error can carry a
connection string. Admin error responses carry a message, not an exception.

---

## 10. The configuration boundary

Configuration reachable from citizen administration is limited to values that are
**part of the community**, not part of the deployment: prices, limits, quantities,
statuses, role definitions, world and place metadata.

Anything that changes how the service runs — hosts, ports, credentials, feature
switches affecting security, file locations — is deployment configuration. It is
set in the environment, reviewed like code, and is not editable from a browser at
any authority level.

---

## 11. The audit-event obligation

**Every administrative action that changes state owes an audit event.**

This document defines the obligation and the redaction rule. The store that
receives the events is **`CTBL-0025`**, which depends on this item. CTBL-0032 adds
no audit table, repository, service or UI.

The store is now built. See `docs/ADMIN_AUDIT_TRAIL.md` for the table, the event
registry, the transaction contract, and which of the actions below are covered
so far.

An audit event records:

| field | meaning |
|---|---|
| `actor` | the member id that performed the action |
| `authority` | the authority layer relied on (section 4) |
| `action` | the administrative action, named |
| `target` | the entity acted on, by id and type |
| `time` | UTC timestamp |
| `result` | allowed / denied / failed |
| `before` / `after` | the changed values, where safe (section 12) |
| `reason` | required for bans, role changes and account removal |
| `source` | request origin, where safe to record |

**Refusals are audited too.** A denied administrative attempt is exactly the event
an operator most needs later.

Actions that owe an event today: ban add, ban delete, role hire, role fire, avatar
approve, avatar reject, place update, object update, donor change (if ever
enabled), account removal.

Read-only administrative reads do not owe a change event, but reads of another
member's private content — chat history above all — owe an access event, because
"who read this" is the question that matters there.

---

## 12. The audit redaction rule

An audit record is itself an admin-readable surface, so section 9 applies to it in
full.

**Never logged, in any field, including `before` / `after`:**

- a password or password hash, in any form, including "changed from" markers that
  reveal the old value;
- a reset token, session token or API key;
- an environment value;
- the body of a private message or chat line — log that it was read, and its
  identifier, never its content;
- an email address in a field readable by an authority level that could not
  otherwise see it.

`before` / `after` are recorded only for fields the acting authority was already
entitled to read. Where a value cannot be recorded safely, record that it changed,
not what it changed to.

---

## 13. Applying this to a new admin item

Before writing the route:

1. Name the operator result in one sentence.
2. Name the authority layer from section 4, and say why a narrower layer is not
   enough.
3. Confirm none of the four prohibitions is touched. If one is, the design is
   wrong — change the design, not the rule.
4. Name the audit event from section 11 and the fields redacted under section 12.
5. List the response fields explicitly (section 8).

Then write it, with a gate that fails closed (section 5), an explicit refusal
(section 6) and, where a file-backed resource is named, a bounded identifier
(section 7).

Every new gate ships with an automated test that fails if the gate stops failing
closed. The table-driven pattern in
`api/src/controllers/admin.controller.authorization.spec.ts` is the shape to
extend — adding a row, not writing a bespoke test.

---

## 14. What this baseline does not deliver

Stated so an absence is not read as a failure:

- It does not build the operator audit store — `CTBL-0025`.
- It does not clean up the duplicate role rows — `CTBL-0026`.
- It does not add expiry or revocation to the session token — `CTBL-0013`.
- It does not split `canAdmin()` into per-role authority.
- It does not enable any currently unreachable administration feature. In
  particular `addDonor` and `getDonor` compare a `string[]` to the string
  `'admin'`, have therefore never been reachable, and stay that way; enabling
  donor administration is a separate backlog item.
- It does not add rate limiting, CSRF middleware or transport hardening.
