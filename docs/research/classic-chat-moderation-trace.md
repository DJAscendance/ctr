# Classic Chat Moderation — trace, findings, and why implementation is blocked

Traced 2026-07-27 for the `fix/classic-place-admin-fidelity` lane, in answer to:
*"the missing function is a dedicated historical Chat Moderation Access or
equivalent chat-rights administration tool for Colony and Neighborhood."*

Evidence conventions match
[`classic-place-admin-re-evidence.md`](./classic-place-admin-re-evidence.md):
every claim cites a reverse-engineered source path and symbol, a Wayback
artifact, or both. Paths are relative to `~/Projects/cybertown/blaxxun-cs-RE/`
and `~/Projects/cybertown/wb-ct-scrape/`.

**Result in one line:** two distinct historical features were found, both real,
**neither of which existed at the Colony or Neighborhood tier**, and neither of
which CTR can implement without a new relation, a new socket authorization rule
and a moderator identity model. Design below; implementation deliberately not
started.

---

## 0. What this is NOT

Ruled out by direct comparison, not by assumption. Each of these is a separate
feature with its own template, action, storage and gate:

| Not this | Why it is different |
|---|---|
| **Owner Access** (`common/updownerrights`, `OWN` + `AS1`–`AS8` + `ORO`) | Assigns a place's leader and deputies. Already implemented in CTR as Access Rights. It *happens* to be the gate the moderation button read, but it is not the moderation tool. |
| **Home Chat Access** (`common/updwriterights` + `cht=1`, `DTY=I&KEY=h<homeID>`) | Governs who may SPEAK in one citizen's home. Already restored in CTR (`HomeChatAccessPage.vue`). Home-scoped by construction. |
| **Message-board moderation** (`msb`, `MTY=m`) | Deleting posts from a place's message board. Different store, different CGI, asynchronous. |
| **Inbox moderation** | Same, for the place inbox. |
| **Message to All** (`msb?ac=writegroup`) | Posting one message to every child place. A publishing action, not a moderation one. |
| **Inbox to All** | Same. |

Everything below is about the two things that are left.

---

## 1. Feature A — "Moderate Chat" (the live moderation console)

### 1.1 Page and template

| | 4.0 | 5.1 / 7.0 |
|---|---|---|
| Template | `install-4.0/csbin/community/templates/place/moderate.tmpl` | `.../templates/place/moderate.html` + `moderate.cfg` |
| Attribute file | none | `moderate.cfg`: `*GET <$DTY> ID <$ID> CHT CHTP` |
| Button art | `commserv/community/images/buttons/bmoderate.gif`, `ALT="Moderate Chat"` | `btnadm_moderate.gif` / `moderatbtn.gif` |

### 1.2 Entry point and CGI action

`place/action.tmpl:8-12` defines the opener, and `:67-72` the button:

```js
function moderate() {
  window.open('place<$g_exe>?ac=moderate&plc=<$place>','Moderator',
    'toolbar=no,...,width=800,height=600');
}
```

```html
<!-- #ifdef variable="owneraccess" -->
<a href="javascript:moderate()" target=_self>
<IMG SRC="<$g_HTMLRoot>/images/buttons/bmoderate.gif" BORDER=0 ALT="Moderate Chat"></a>
```

The same pair appears in `enter/action.tmpl:29-31,68-71` for the entry plaza.

**Only `place.exe` implements the action.** Confirmed against the shipped 4.0
binaries — this is the decisive tier check:

```
$ for f in community.exe neighbor.exe block.exe place.exe property.exe; do
    echo -n "$f: "; strings $f | grep -c '^moderate$'; done
community.exe: 0
neighbor.exe:  0
block.exe:     0
place.exe:     1
property.exe:  0
```

`grep -rli moderat install-4.0/csbin/community/templates/` returns exactly three
files: `place/moderate.tmpl`, `place/action.tmpl`, `enter/action.tmpl`. No
colony, neighborhood, block, home or club template references it.

### 1.3 Displayed wording

Button `ALT`: **"Moderate Chat"**. Page title: `<$g_title> - Moderation`.
Refusal, rendered in place of the applet:

> `Sorry <$NNM>, you don't have the right to moderate this chat.`

The console's own vocabulary, from the commented `LABEL_*`/`TXT_*` block that
5.1's `place/moderate.html` ships for translators (the single best inventory of
what the tool did):

*Incoming Chat Requests · Chat Log · Moderator's Input · Remove · Reject ·
Publish · Modify · People List · **Mute** / **Unmute** · **Privilege** /
**Unprivilege** · Moderator · Scroll Lock · "Chat already moderated" ·
"Chat place not known at the server. Please enter the chat or contact your
system administrator to configure the place for moderation."*

### 1.4 Did it control who could moderate, who could speak, or both?

**Both — but only one of them was editable, and not through this tool.**

- *Who could moderate*: whoever satisfied `owneraccess` on the place, plus
  anyone holding the server-wide moderation password (§1.7). Not editable here.
- *Who could speak*: the moderator decided **live, per session, per person**
  via Mute/Unmute and Privilege/Unprivilege. Nothing was persisted — these were
  runtime states held by the moderation daemon for the duration of the scene.

So there was no stored "who may moderate" list anywhere. That is the single most
important finding in this document: **the thing being looked for as a
rights-administration screen did not exist as one.**

### 1.5 Target object, DTY / KEY

4.0 addressed the scene by slug: `place?ac=moderate&plc=<slug>` — no `DTY`, no
`ID`. 5.1/7.0 read `CHT`/`CHTP` off the place row (`moderate.cfg`) and passed the
scene URL to the applet:

```
modScene = <$g_HttpServer><$g_cgiRoot>/print?PLC=<$PLC>&DTY=<$DTY>&ID=<$T_CHATID><$audit>&TPL=3dchat.bxx
```

The target is a **chat scene**, keyed by the place's chat id — not an ACL row.

### 1.6 ACL axis, fields, nickname slots, job bitmask

**None. There is no moderation axis.** The complete CS 4.0 ACL surface is four
axes and nothing else, all four visible in `common/rightstop.tmpl`:

| Axis | Template | Fields |
|---|---|---|
| Owner Access | `common/updownerrights` | `OWN`, `AS1`–`AS8`, `ORO` (32-bit job mask) |
| Read Access | `common/updreadrights` | `RI1`–`RI8`, `RRO` |
| Action/Write Access | `common/updwriterights` | `WI1`–`WI8`, `WRO` |
| Change Rights | `common/updchangerights` | `CI1`–`CI8`, `CRO` |

There is no `MOD`/`MI1`–`MI8`/`MRO`. `grep -rn 'MI[1-8]\|MRO' install-4.0/csbin/`
returns nothing. So for Feature A specifically: **no nickname slots, no job
bitmask, no per-place row, nothing to edit.**

### 1.7 Who could grant it

Two ways, both outside the community UI:

1. **Be an owner of the place.** Change the place's Owner Access — the existing
   Access Rights screen. Moderation followed as a side effect.
2. **Hold the server-wide moderation password.** From
   `install-7.0/csadmbin/templates/admin/moderatecfg.html`, the csadmin
   "Moderation Configuration" screen, verbatim:

   > *Moderation password that can be used even if the moderator is not owner of
   > the place (**no password => only owners can moderate**)*

   Field `mdserverPassword`, `maxlength=16`, stored in `etc/mdserver.cfg`. The
   same screen warns *"Please Restart the Moderation Service **mdserver** for the
   settings to take effect."* In 4.0 the equivalent is `g_modPwd` in
   `csbin/community/config/global.cfg:50` (shipped value: `default`), rendered
   straight into the applet as `<PARAM name=modPwd value="<$pwd>">`.

That parenthesis is the authoritative statement of the whole authorization model:
**owners, or a shared server password. Nothing per-place, nothing per-role.**

### 1.8 Effect on the chat server

The applet did not talk to the community CGI at all. It connected directly to a
separate daemon:

```html
<APPLET code="blaxxun.moderator.applet.Moderator.class" archive=moderator.zip>
 <PARAM name=modHost value="<$g_CServer>">   <!-- 5.1: g_MdServer -->
 <PARAM name=modPort value="MDPORT">         <!-- 5.1: g_MdPort  -->
 <PARAM name=modGroup value="Public">
 <PARAM name=modPwd   value="<$pwd>">
</APPLET>
```

`mdserver` is a Community Server **apserver** process: it registers as an API
client, intercepts every chat text in the scenes assigned to it, and releases,
rewrites or drops each one. A scene was moderatable only if a server
administrator had said so in `etc/idserver.cfg` — `install-4.0/etc/idserver.cfg:45-56`:

```
# Sample entry for a scene featuring moderation
SCENE
  APISERVER localhost:MDPORT
  URL       http://THISHOSTPORT/csbin/community/placeCGIEXE?plc=enter*
ENDSCENE
```

Hence the applet's error string *"Chat place not known at the server … contact
your system administrator to configure the place for moderation."* Moderation was
**per-scene server configuration plus a daemon**, not a per-place setting.

`mdserver.cfg` also carried the bad-words filter (`none|log|email|replace|reject|
ignore`), the replacement and rejection strings, the auditorium stage messages and
`mdStageFilter`.

### 1.9 Cybertown production evidence

Archived, from `wb-ct-scrape/manifests/cdx_all.jsonl`:

```
http://www.cybertown.com/cgi-bin/cybertown/place?ac=moderate&plc=beach&TKT=…
http://www.cybertown.com/cgi-bin/cybertown/place?ac=moderate&plc=fleamarket&TKT=…
http://www.cybertown.com/cgi-bin/cybertown/place?ac=moderate&plc=jail&TKT=…
http://www.cybertown.com/cgi-bin/cybertown/place?ac=moderate&plc=nightclub&TKT=…
```

Four distinct public places, several captures each, plus the login-redirect forms
(`place?NNM=Visitor&login=true&plc=nightclubac=moderate`). Cybertown ran this
feature in production.

**Every archived instance is `plc=<slug>` — a public place.** A sweep of all
280,363 CDX rows across every Cybertown host manifest returns **zero**
`community?…ac=moderate`, `neighbor?…ac=moderate` or `block?…ac=moderate`.

### 1.10 Colony and Neighborhood tiers, and their Deputies

**The tool did not exist at those tiers**, in stock CS 4.0 or in Cybertown's
build — `community.exe` and `neighbor.exe` carry no `moderate` action string, no
colony or neighborhood template references one, and no production URL was ever
archived.

The Deputy question therefore has no historical answer, and it is worth being
precise about why the corpus *cannot* be stretched into one: had the button
existed there, its gate would have been the same single `#ifdef owneraccess` bit,
which `AS1`–`AS8` deputies satisfy identically to the `OWN` holder. The original
had no vocabulary for "leader but not deputy" on any axis. **Any Deputy rule CTR
adopts is a new product decision, not a restoration.**

---

## 2. Feature B — "Chat Write / Chat Read Access" (the chat-rights screen)

This is the chat-**rights** administration tool, and it is a real, separate
screen. It is what CTR restored for homes.

### 2.1 Page, entry point, action

`common/chatrights.tmpl` — a two-frame set reached as:

```
place?ac=print&tpl=common/chatrights&DTY=<type>&KTY=ID&KEY=<id>&PRI=<…>
```

Top frame `common/chatrightstop.tmpl` offers exactly two icons:

| Icon | ALT | Target |
|---|---|---|
| `icon_rightsread.gif` | **Chat Read Access** | `edit?ac=read&DTY=…&KEY=…&cht=1&TPL=common/updreadrights` |
| `icon_rightsaction.gif` | **Chat Write Access** | `edit?ac=read&DTY=…&KEY=…&cht=1&TPL=common/updwriterights` |

`cht=1` is the whole switch: the same two templates render the generic Read/Action
axes without it, and the chat wording with it
(`common/updwriterights.tmpl:19-30`).

### 2.2 Displayed wording (`cht=1` branch)

> **Update Write Access for Chat**
> *Here you define citizens, who are allowed to chat with you at this place.*
> If no nickname is defined and no job is checkmarked, usually all members are
> allowed to be active!
> You can define **up to 8 citizens** with **write access**.
> *Note: If a nickname does not exist, it is ignored without notification.*
> Additionally all citizens having **checkmarked jobs** have write access, too.
> If you want to give write access to all citizens, simply checkmark only
> 'Members' — this includes ALL other jobs, but not visitors.

Buttons: `Update` (`name=editrolem`) / `Cancel` (`name=read`).

### 2.3 Which question it answers

**Who could SPEAK. Not who could moderate.** There is no overlap with Feature A:
Feature A had no stored list, Feature B has no moderator concept.

### 2.4 Target object, ACL axis, fields

- **Write axis** (`common/updwriterights.cfg`, section `[ROL]`):
  `WI1`–`WI8` each `r -> M ID NNM` (member lookup by nickname), plus
  `WRO rw 32 BITMASK`.
- **Read axis** (`updreadrights.cfg`): `RI1`–`RI8` + `RRO`, same shape.
- **Nickname slots**: 8, `MAXLENGTH=16 SIZE=16`, rendered 4 across in two rows.
  An `isAdmin` viewer additionally gets a Group/Member radio per slot; a
  non-admin sees group entries as read-only text.
- **Job bitmask**: `WRO_BIT_<n>` checkboxes generated from the `roles` loop, with
  the documented shortcut that checking only *Members* covers every job but not
  visitors.
- **Target**: whatever `DTY`/`KEY` the caller passed. The templates are generic.

### 2.5 Cybertown production evidence, by DTY

Every archived Cybertown use of `cht=1`:

```
edit?ac=read&DTY=I&KTY=ID&KEY=h0103040201020105&cht=1&TPL=common/updwriterights&PRI=P
edit?ac=read&DTY=I&KTY=ID&KEY=h0103040401010602&cht=1&TPL=common/updwriterights&PRI=P
edit?ac=read&DTY=I&KTY=ID&KEY=h0103040404030312&cht=1&TPL=common/updreadrights&PRI=P
edit?ac=read&DTY=I&KTY=ID&KEY=h0105050103020306&cht=1&TPL=common/updwriterights&PRI=P
edit?ac=read&DTY=I&KTY=ID&KEY=h0105050103020306&cht=1&TPL=common/updreadrights&PRI=P
```

**All five are `DTY=I&KEY=h<homeID>` — the home chat sub-object.** Not one
`DTY=C` (colony) or `DTY=N` (neighborhood) capture exists with `cht=1`, on any
host, in any year. Clubs appear on the plain Read/Write axes (`DTY=CL`, no
`cht=1`), and blocks only on Owner Access (`DTY=B`, `common/updownerrights` and
`common/rightstop`).

So: the machinery was tier-agnostic, but the only tier Cybertown ever pointed it
at was the home. CS 5.1's unified `place/rights.html` does say *"You can define an
owner, owner deputies, and read and write access **for chat**"* — evidence the
platform intended it for places — but intent in a later version's documentation
is not evidence that Cybertown's 4.0-lineage build exposed it.

### 2.6 Who could edit it, and Deputies

Reached from `common/rights` / `common/chatrights`, which the action bars gate on
`#ifdef rightsaccess` — the change-rights bit, held by the owner and by whoever
Change Rights (`CI1`–`CI8`, `CRO`) named. Deputies (`AS1`–`AS8`) satisfy
`owneraccess`, and in every archived Cybertown place the Access Rights button sat
behind `rightsaccess`, so the honest statement is: **the corpus does not separate
leader from deputy on this axis either.** Same conclusion as §1.10 — a CTR Deputy
rule is a product decision.

---

## 3. What CTR has today

| Needed | CTR today | Verdict |
|---|---|---|
| Per-place chat-rights storage | **partly present, and better than expected.** Home chat access is not a bespoke table: it is `role_assignment` rows for a place-scoped `'Home Chat Guest'` role (`HomeService.CHAT_GUEST_ROLE`, `MAX_CHAT_GUESTS = 8` — the original's eight slots). The relation is already `(place_id, member_id, role_id)`, so it generalizes to any place id. | reusable shape, but home-named and home-gated |
| Job/role-wide grants (the `WRO` bitmask half) | none — grants are per member only | **absent** |
| Chat-access enforcement | `HomeService.canChatInPlace` — which short-circuits `return true` for any place whose `type !== 'home'`. Called by `MessageController.addMessage` and by the socket's `canChat()` via `GET /home/chat-access/can-chat/:room` (`spa/server.js:39-64`) | home-only by construction |
| Moderator identity | none. `role_assignment` carries leaders/deputies; `member` carries the global `security` access level | **absent** |
| Live moderation transport | none. `spa/server.js:345-349` has a `moderation` socket event, but it is a **blind rebroadcast**: it takes an arbitrary payload from any connected socket and echoes it to everyone as `moderation_event`, with no token check and no authorization. It is used by the admin ban and chat-message screens (`pages/admin/user/BanAdd.vue:105`, `ChatMessages.vue:173`) as a notification ping. | **not a moderation backend** |
| Mute / suppress a speaker | none. `ban` is global and account-level; there is no per-place, per-session suppression | **absent** |
| Bad-words handling | `badwords-list` regex, applied in `MessageController` and `spa/server.js:357-361` | partial, unrelated to moderation rights |

> **Recorded, not fixed in this lane:** the unauthenticated `moderation` socket
> relay above is a latent authorization gap in its own right — any client can
> forge a `moderation_event`. It is pre-existing, untouched by this branch, and
> belongs in the same security cleanup lane as the dormant
> `ColonyRepresentative` clause (`classic-update-hierarchy-matrix.md` §2.3). It
> is named here because it is exactly the kind of "unrelated endpoint" a
> cosmetic Chat Moderation tile would have been wired to.

---

## 4. Design, if and when it is approved

Two separable features. Neither should be started without a decision on §4.3.

### 4.1 Colony / Neighborhood **Chat Access** (who may speak) — the smaller one

Extends what already exists rather than inventing a model.

- **Storage**: `role_assignment(place_id, member_id, role_id)` already has the
  right shape — home chat access uses it with a `'Home Chat Guest'` role. Colony
  and neighborhood chat need their own role rows (a home guest must not become a
  colony speaker by accident), so: **a seed migration for the new roles**, and
  either a second relation or a bitmask column for the job-wide `WRO` half, which
  has no model at all today. Payroll must exclude the new roles the way it
  already excludes `Home Chat Guest`
  (`role-assignment.repository.ts:163`).
- **Semantics, from §2.2**: empty set ⇒ everyone may speak; a non-empty set is
  the authoritative allowlist; unknown nicknames are dropped silently; the form
  submits the whole set as a replacement.
- **Enforcement**: `PlaceChatAccessService.canChatInPlace(placeId, memberId)`,
  called from `MessageController.addMessage` **and** from the socket's `canChat()`
  — the socket must not be allowed to diverge. `canChat()` already caches per
  `room:member`; the TTL becomes a revocation-latency decision.
- **Tiers**: colony and neighborhood only. **No block chat surface at all** — a
  block is a map of lots you pass through, not a room
  (`classic-place-admin-followups.md` §2).
- **Authorization to edit**: Ryan's standing requirement is that Colony Deputies
  must eventually manage Colony Chat Access. That is deliberately NOT derivable
  from `canManageAccess`, which excludes each tier's own deputy for the Owner
  axis — see `classic-update-hierarchy-matrix.md` §6.5a. This feature needs its
  own predicate.

### 4.2 Chat **Moderation** (a live console) — the larger one

There is no way to restore this cheaply, because the original was a daemon.

- **Moderator identity**: who is a moderator of place X. Neither `role_assignment`
  nor the global `security` level answers it. **New relation.**
- **Socket authorization**: a real, token-verified moderator channel replacing the
  blind `moderation` rebroadcast — join a place's moderation room, receive its
  chat stream, act on it.
- **Suppression model**: per-place, per-session mute with an explicit lifetime,
  plus the Privilege/Unprivilege distinction if the queued-and-released mode is
  wanted (the original's Remove / Reject / Publish / Modify flow).
- **Persistence and audit**: none of the original's runtime state survived a
  restart. CTR should decide deliberately whether mutes persist, and log
  moderator actions — a capability the original had no answer for.

### 4.3 The open product question

Feature A (a live console) and Feature B (a stored allowlist) are different
products that both get called "chat moderation". §1 and §2 show the original
shipped both, at neither of the tiers in question. **Which one is wanted at Colony
and Neighborhood is a product decision, and it is the decision this lane is
blocked on** — not a research gap.

---

## 5. Why nothing was implemented in this branch

Per the standing instruction: *"If implementing the real Chat Moderation Access
requires a new relation, migration, socket authorization rule, or moderator
identity model, stop after producing the design and evidence. Do not create a
cosmetic tile backed by an unrelated endpoint."*

It requires **all four**. So:

- no Chat tile appears on the Colony, Neighborhood or Block Update hub;
- no capability named for chat exists in `PlaceUpdateHubService`;
- `moderate_messageboard` / `moderate_inbox` keep their own names and their own
  windows and are **not** relabelled as chat moderation;
- both exclusions are pinned by test — `spa/tests/place-update-hub.test.ts`
  ("no tile offers Chat Access or Chat Moderation at any tier", "Colony and
  Neighborhood show no chat tile before a real backend exists") and
  `api/src/services/place/place-update-hub.service.spec.ts`
  ("never grants a chat or chat-moderation capability at any tier").

---

## 6. Verification standard

Re-run before relying on any table above:

```bash
cd ~/Projects/cybertown/blaxxun-cs-RE
for f in community.exe neighbor.exe block.exe place.exe property.exe; do
  echo -n "$f "; strings install-4.0/csbin/community/$f | grep -c '^moderate$'; done
grep -rli moderat install-4.0/csbin/community/templates/

cd ~/Projects/cybertown/wb-ct-scrape/manifests
grep -hoiE '"[^"]*(moderat|chatright|cht=1)[^"]*"' cdx_all*.jsonl | sort -u
```
