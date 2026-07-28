# Classic Place Administration — Update Hierarchy Evidence Matrix

**Branch:** `fix/classic-place-admin-fidelity`
**Date:** 2026-07-27
**Status:** Phase 1 (trace) and Phase 2 (CTR authorization audit) complete.
**No implementation, no migration, no deployment.**

Companion to [`classic-place-admin-re-evidence.md`](./classic-place-admin-re-evidence.md)
(the approved behavioral spec) and [`classic-place-admin-followups.md`](./classic-place-admin-followups.md).
Same evidence standard: every claim cites an RE source path and symbol, a Wayback
artifact, or CTR source. RE paths are relative to `~/Projects/cybertown/blaxxun-cs-RE/`;
Wayback paths to `~/Projects/cybertown/wb-ct-scrape/`.

---

## 0. Headline results

Three findings decide most of this lane. All three are read from the shipped CS 4.0
binaries and templates, not inferred from screenshots or current UI labels.

### 0.1 Stock CS 4.0 had **no colony Update page at all**

`install-4.0/csbin/community/templates/community/action.tmpl` is the colony action bar.
Its entire `#ifdef owneraccess` branch is one button:

```html
<!-- #ifdef variable="owneraccess" -->
<a href="msb<$g_exe>?ac=writegroup&DTY=C&KTY=ID&KEY=<$ID>&MTY=m&TPL=msb/backurl&program=community" target="place">
<IMG SRC="<$g_HTMLRoot>/images/buttons/bgroupmesa.gif" BORDER=0 ALT="Group Message"></a>
<!-- #endif variable="owneraccess" -->
```

There is **no `bupdate.gif`, no `ac=wizardplace`, no wizard of any kind.** Compare the
same block in `neighbor/action.tmpl:43-44` and `block/action.tmpl:37-41`, which *both*
carry `<a href="…?ac=wizardplace&ID=<$ID>"><IMG SRC=".../bupdate.gif" ALT="Update">`.

The colony CGI's own dispatch table confirms it — the handler set is disjoint from the
neighborhood and block CGIs:

```
$ strings install-4.0/csbin/community/community.exe | grep -o './log/[a-z_0-9]*\.log'
./log/ccgi_home_imageput.log  ./log/comm_action.log   ./log/comm_place.log
./log/community.log           ./log/comm_uplins.log   ./log/comm_uplinssubmit.log
./log/comm_upllist.log
```

No `comm_wizard*`. No `community/wizard/*.tmpl` referenced anywhere in the binary. The
colony CGI's only mutating family is `uplins` / `upload` / `upldel` — an **asset upload
manager** (`community/upl2di.tmpl`, `upl2dw`, `upl3di`, `upl3dw` = upload 2D image, 2D
world, 3D image, 3D world) that stocks the media library feeding the icon and background
pickers. It is not a map editor.

### 0.2 **Correction to `classic-place-admin-followups.md` §1b**

That document asserts Ryan's recollection of colony-level neighborhood management is
"**confirmed by the binary**", citing:

```
$ strings community.exe | grep -i 'ccgi_home_'
… ccgi_home_wizard  ccgi_home_wizardloop  ccgi_home_wizardpresent  ccgi_home_wizardsubmit
```

**That inference is wrong, and the follow-ups doc is corrected accordingly.** Those
symbols are a statically linked shared module, present byte-identically in every CGI in
the family — including `property.exe`, which has no wizard whatsoever:

| Binary | `ccgi_home_wizard*` symbols | Own wizard dispatch strings | Own wizard templates |
|---|---|---|---|
| `community.exe` | **present** | **none** | **none** |
| `property.exe` | **present** | **none** | **none** |
| `neighbor.exe` | present | `neigh_wizard`, `neigh_wizardimage`, `neigh_wizardimagesubmit`, `neigh_wizardinfo`, `neigh_wizardplace`, `neigh_wizardpresent`, `neigh_wizardsubmit` | `neighbor/wizard/{place,present,info,image,wizard}.tmpl` |
| `block.exe` | present | `block_wizard`, `block_wizardimage`, `block_wizardimagesubmit`, `block_wizardinfo`, `block_wizardplace`, `block_wizardpresent`, `block_wizardpresentsubmit`, `block_wizardsubmit` | `block/wizard/{place,present,info,image,wizard}.tmpl` |

`property.exe` is the control case: it carries the identical `ccgi_home_wizard*` symbol
set and unambiguously has no wizard. Symbol presence therefore proves link-time
inclusion, nothing more. The **tier-specific** `<cgi>_wizard*` strings and the
`<tier>/wizard/*.tmpl` template references are the real dispatch evidence, and colony
has neither.

**This does not contradict Ryan's product rule — it independently confirms it.** The
requirement that Colony Leaders and Deputies must not alter colony map structure matches
stock CS 4.0 exactly: no such tool existed at the colony tier for anyone.

### 0.3 Colony neighborhood placement was **hard-coded template geometry**

`install-4.0/csbin/community/templates/community/present.tmpl` — the only template in
the 4.0 corpus containing `USEMAP`/`<AREA>` — is a literal HTML image map with pixel
coordinates baked into the file:

```html
<IMG SRC="<$g_HTMLRoot>/home/<$commid>/community.jpg" USEMAP="#map">
<MAP Name="map">
<!-- #ifdef variable="id0101" -->
<AREA Shape="rect" coords="135,80,160,101" HREF="neighbor<$g_exe>?ID=<$id0101>" ALT="<$name0101>">
<!-- #endif variable="id0101" -->
<!-- #ifdef variable="id0102" -->
<AREA Shape="rect" coords="180,80,210,101" HREF="neighbor<$g_exe>?ID=<$id0102>" …>
…
```

The coordinates are irregular and hand-tuned (`135,80,160,101` then `180,80,210,101`
then `230,80,265,101` — differing widths, one row even malformed: `id0108` reads
`coords="470,80,101"`, three values instead of four). They trace features drawn into
`community.jpg`. **Changing a colony's neighborhood layout meant editing this template
file and the JPEG on the server** — a filesystem/deployment operation, not a web action
available to any role at any privilege level.

Contrast the neighborhood and block tiers, which are uniform generated grids and
therefore *were* safely editable through a wizard:

| Tier | Template | Geometry | Slots | Editable in-product? |
|---|---|---|---|---|
| Colony | `community/present.tmpl` | irregular hand-authored `<AREA>` coords over `community.jpg` | variable | **No** — no CGI handler exists |
| Neighborhood | `neighbor/present.tmpl`, `neighbor/wizard/present.tmpl` | `table width=510 height=270`, cells `85×54`, icons `70×50` | 6 cols × 5 rows = **30** | Yes — `neighbor?ac=wizard&mode=<mode>&ID=<id>` |
| Block | `block/present.tmpl`, `block/wizard/present.tmpl` | `table width=480 height=240`, cells 40×40 | 12 cols × 6 rows = **72** | Yes — `block?ac=wizardpresent` |

This is the mechanical reason Ryan's rule exists, and it is a stronger justification than
policy alone: the colony map was not data, it was source.

---

## 1. Traced symbols, templates and actions

### 1.1 Entry points, by tier

| Tier | Action-bar gate | Update entry | Access Rights entry |
|---|---|---|---|
| Colony | `#ifdef owneraccess` → Group Message **only** (`community/action.tmpl`) | **absent** | `#ifdef rightsaccess` → `place?ac=print&tpl=common/rights&DTY=C&KTY=ID&KEY=<ID>` |
| Neighborhood | `#ifdef owneraccess` → Group Message + **Update** (`neighbor/action.tmpl:43-44`) | `neighbor?ac=wizardplace&ID=<ID>` | `…&DTY=N&…` |
| Block | `#ifdef owneraccess` → Group Message + **Update** + **Check Images** (`block/action.tmpl:37-41`) | `block?ac=wizardplace&ID=<ID>` | `…&DTY=B&…` |

Note the block tier's third owner tool, not previously recorded:
`edit?DTY=P&KTY=ID&KEY=&ac=list&TPL=block/plist&KFT=<ID>&KFM=CRCCNRNCBRBC*` — "Check
Images", a moderation review of the home images on that block. CTR already ships the
analogue (`BlockTools.vue` → `#/home/image-check`).

### 1.2 The neighborhood wizard — what "create a block" actually was

`neighbor?ac=wizardplace` → `neighbor/wizard/place.tmpl` (frameset) →
`ac=wizardpresent` (map) + `ac=wizardinfo` (controls).

`neighbor/wizard/present.tmpl` makes **every one of the 30 fixed slots** a link:

```html
<a href="neighbor<$g_exe>?ac=wizard&mode=<$mode0101>&ID=<$id0101>">
  <img src="…/neighbor/<$img0101>.gif" width=70 height=50 ALT="<$name0101>"></a>
```

`neighbor/wizard/info.tmpl:20-25`: *"Click the **\<BNM\>** you want to update."* plus
*"Change the background image for this **\<ENM\>**."*

`neighbor/wizard/wizard.tmpl` is the per-slot editor. Its complete field set:

| Control | Field | Values | Meaning |
|---|---|---|---|
| Usage radio | `<$PU2>` | `P` / `N` | "free for use" / "cannot be accessed" |
| Name | `NAM` | `MAXLENGTH=32 SIZE=32` | block name |
| Owner | `OWN` | `MAXLENGTH=16 SIZE=16` | block owner **by nickname** |
| 2D icon | `IC2` | radio over `Picon2D<NNN>.gif` | icon on the hood map |

Submits `ac=wizardsubmit` (hidden `ID`, `parenttype`) with `Ok`/`Cancel`. Errors:
`wizarderror001` "could not be stored in the database", `wizarderror002` "A name has to
be given!!!", `wizarderror003` "A 2D icon has to be selected!!!".

**The decisive semantic:** there is no "create" and no "delete". The 30 slots are a
fixed grid that always exists. The public map (`neighbor/present.tmpl`) renders a slot
**only** when `#ifdef variable="id01xx"` holds. So what the brief calls "create a block"
was **populating a pre-existing empty slot**, and "remove a block" was setting usage to
`N` — structurally identical to how block-tier lot availability works. Blocks were never
added to or removed from a neighborhood's map; the map never changed size.

### 1.3 The permission gate is a single bit, and its data is not in the corpus

Every tier gates its Update entry on exactly one flag: `#ifdef owneraccess`. Per the
evidence report §1.3, `owneraccess` is granted when the actor is `OWN`, occupies an
`AS1`–`AS8` slot, **or** the actor's role mask intersects the object's `ORO` bitmask.

Leader and Deputy are ordinary role bits, not tiers (Block Leader=`30`, Block
Deputy=`42`, Neighborhood Leader=`20`, Neighborhood Deputy=`41`, District Leader=`10`,
District Deputy=`40` — `re-artifacts/7.0/cgi/01-cgi-window-spec.md` §4). Whether a
Neighborhood **Deputy** could create blocks therefore depends entirely on whether bit
`41` was set in each neighborhood record's `ORO` value **in Cybertown's production
database** — which is per-place data, not code, and is **not present in any RE or
Wayback artifact**.

> **This question is unresolvable from the available evidence.** It is not that the
> trace was incomplete; the answer was never in the code. It requires Ryan's product
> decision. The brief's instruction — "Do not grant Neighborhood Deputies creation
> rights without evidence or explicit product approval" — resolves to: **approval, or
> not at all.**

### 1.4 Wayback production evidence

Complete set of archived Cybertown wizard URLs across the whole CDX index
(`wb-ct-scrape/manifests/cdx_all.jsonl`, 8 captures):

```
6 ×  cgi-bin/cybertown/block?ac=wizardpresent&ID=<id>
1 ×  cgi-bin/cybertown/block?ac=wizardplace&ID=<id>
1 ×  cgi-bin/cybertown/block?ac=wizardinfo&ID=<id>
1 ×  cgi-bin/colonycity/block?ac=wizardinfo&ID=<id>
```

**All block. No `neighbor?ac=wizard*`. No `community?ac=wizard*`.** Every capture is a
login wall (evidence report §0), so this proves the URL existed, not what it rendered.

Absence here is weak evidence on its own — authenticated admin pages are rarely
crawled — but it is *consistent with*, and adds nothing against, the strong code result
in §0.1.

Archived ACL traffic, by data type:

| Template | `DTY=B` (block) | `DTY=I` (chat obj) | `DTY=CL` (club) | `DTY=C` (colony) | `DTY=N` (hood) |
|---|---|---|---|---|---|
| `common/updownerrights` (16) | 13 | — | 3 | 0 | 0 |
| `common/updwriterights` (5) | — | 3 | 2 | 0 | 0 |
| `common/updreadrights` | — | ✓ | — | 0 | 0 |

No archived colony- or hood-scoped rights URL exists. `DTY=C` (821) and `DTY=N` (18)
appear only on ordinary `community?`/`neighbor?` navigation and message-board URLs.

Two Cybertown-custom templates appear in the CDX that have **no stock 4.0 counterpart**,
confirming Cybertown forked the template set: `TPL=block/textlist` (23 captures) and
`TPL=community/colonies` (3). Neither is an administrative mutation surface.

---

## 2. Current CTR authorization — audited, not assumed

Server-side methods, read from source. Client `$store.data.user.can_admin` is **not**
relied on anywhere below.

### 2.1 Scoped `canAdmin` — the hierarchy is already correct

| Service | Grants to | Source |
|---|---|---|
| `ColonyService.canAdmin(colonyId, memberId)` | `Admin` (global); `ColonyLeader`/`ColonyDeputy` scoped to `colonyId` | `api/src/services/colony/colony.service.ts:141` |
| `HoodService.canAdmin(hoodId, memberId)` | `Admin`; `ColonyLeader`/`ColonyDeputy` scoped to the parent colony; `NeighborhoodLeader`/`NeighborhoodDeputy` scoped to `hoodId` | `api/src/services/hood/hood.service.ts:204` |
| `BlockService.canAdmin(blockId, memberId)` | `Admin`; colony leadership scoped to the grandparent colony; hood leadership scoped to the parent hood; `BlockLeader`/`BlockDeputy` scoped to `blockId` | `api/src/services/block/block.service.ts:243` |
| `PlaceService.canAdmin(slug, placeId, memberId)` | per-place staff roles | `api/src/services/place/place.service.ts` |

Scoped-superior inheritance is genuine and walks the real parent chain
(`BlockService.canAdmin` resolves hood → `mapLocationRepository.findPlaceIdMapLocation`
→ colony). This is a faithful analogue of the classic hierarchy and needs no change.

### 2.2 A second, narrower tier already exists

`canManageAccess` is **not** an alias of `canAdmin`. At colony tier
(`colony.service.ts:164`) it admits `Admin` and `ColonyLeader` **but not
`ColonyDeputy`** — a precedent that "may open the Update page" and "may perform this
action" are already separable in CTR. Any new tool tile should reuse this pattern rather
than widening `canAdmin`.

### 2.3 Defect found: `ColonyRepresentative` is a dead clause

`ColonyService.canAdmin`, `canManageAccess`, `HoodService.canAdmin` and
`BlockService.canAdmin` all test `this.roleRepository.roleMap.ColonyRepresentative`.

`roleMap` keys are role names with whitespace stripped
(`role.repository.ts:28` — `role.name.replace(/\s/g, '')`), built from
`api/db/seed_data/roles_data.json`. That file contains **74 roles and no
"Colony Representative"**. The lookup is therefore `undefined`, and
`[Admin, undefined].includes(assignment.role_id)` can never match a numeric `role_id`.

**Fails closed, so not a security hole** — but it is dead code that reads as an active
grant, and anyone adding a role literally named "Colony Representative" would silently
activate a *global, unscoped* colony-admin grant across all three tiers. Recorded here;
not fixed in this lane because it is outside the brief and changing it alters
authorization.

### 2.4 Global technical role — present in data, absent in code

`roles_data.json` contains `Founder`, `Com tech` (→ `roleMap.Comtech`), `Tech CD`,
`City Architect`, `Master World Builder`, `HTML Tech Support`.

**No service method references any of them.** The only global check is
`MemberService.canAdmin` (`member.service.ts:56`), which admits `Admin` plus the five
Security roles — a *security/moderation* set, not a technical one.

So CTR has **no global technical-role authorization check today.** Per the brief
("Do not hardcode those role names until the current role model is inspected" and "If no
safe structural editor exists, omit the action and document the restriction"), no
structural colony control is implemented and none is gated. Building the check would be
speculative: there is no structural endpoint for it to protect.

### 2.5 Chat access is home-scoped, by construction

`HomeService.canChatInPlace(placeId, memberId)` (`home.service.ts:308`) is the single
enforcement point, used by `message.controller.ts:52` and the Socket.IO path. It grants
the home owner implicitly and otherwise requires a **`Home Chat Guest`** role assignment
scoped to that home's place id (`home.service.ts:175`).

There is **no place-tier chat ACL** — no storage, no service, no route, at colony, hood,
block or public-place tier. CTR's `getAccessInfo`/`postAccessInfo` at those tiers is
**not** chat access (§3.1).

### 2.6 What "Access Rights" is in CTR today

`ColonyService.getAccessInfoByUsername` / `postAccessInfo`
(`colony.service.ts:31`, `:41`) read and write **`ColonyLeader` (owner) + up to 8
`ColonyDeputy` role assignments** scoped to the place. Hood and block have the exact
parallel.

That is a faithful implementation of CS 4.0's **Owner Access axis**
(`common/updownerrights` — `OWN` + `AS1`–`AS8`), and it is the tool archived 13× against
`DTY=B` in production. It is **not** the Write/chat axis. The evidence report §2.2
warning — *"Owner-access permissions must not be assigned to Home Chat guests"* — applies
in reverse here too: these two must not be conflated in the UI.

---

## 3. Required evidence matrix

Columns per the brief. Classification vocabulary: **implement now** · **already
implemented** · **link or gate only** · **admin-only** · **intentionally unavailable** ·
**future lane** · **unresolved**.

### 3.1 Colony tier

| Tool or action | Stock CS4 | Cybertown production evidence | Required original permission | Cybertown customization / restriction | Current CTR authorization | CTR decision |
|---|---|---|---|---|---|---|
| **Colony Update page** | **Does not exist** — `community/action.tmpl` has no Update button; `community.exe` has no wizard dispatch | No `community?ac=wizard*` in CDX | n/a | Ryan's rule: CL/CD get a scoped colony admin area | `ColonyService.canAdmin` (CL/CD scoped, Admin global) | **implement now** — as a hub over *existing* tools only. Note it is a **modern composition**, not a restoration; stock had none |
| Colony Information | `place/updateinfo.tmpl`, single `TXT` attr, generic `*UPD` owner check | `TPL=property/updateinfo` archived (home variant); place variant not captured | `owneraccess` (bit `0x1`) | — | `PlaceInformationService.canEdit` + `GET/PUT /place/:placeId/information`, type read from stored row | **already implemented** (commit `7a59c9f`) — link from hub |
| Colony Chat Access | Write axis of a separate ACL object, `cht=1` | Archived only for `DTY=I` (homes) and `DTY=CL` (clubs) | write bit `0x2` on the chat object | — | **None.** `canChatInPlace` is home-only; no place-tier chat storage | **future lane** — needs a new authorization model + Socket.IO enforcement. Brief's stop condition. Do **not** ship a client-only page |
| Colony moderation | Group Message (`msb?ac=writegroup&DTY=C`) | — | `owneraccess` | — | Message to All / Inbox to All routes; messageboard + inbox delete gated by `ColonyService.canAdmin` | **already implemented** — link only |
| List existing neighborhoods | `community/present.tmpl` renders `<AREA>` per `id01xx` | `community?ac=place&ID=…` archived | read | — | `GET /colony/:slug/hoods` | **implement now** — read-only navigation list |
| **Create neighborhood** | **No handler exists** in `community.exe` | none | — | Ryan: forbidden to CL/CD | no endpoint | **intentionally unavailable** — no UI, no route |
| **Remove neighborhood** | **No handler exists** | none | — | Ryan: forbidden to CL/CD | no endpoint | **intentionally unavailable** |
| **Reposition neighborhood** | Hand-authored `<AREA coords>` in `community/present.tmpl` | none | server filesystem access | Ryan: forbidden to CL/CD | no endpoint | **intentionally unavailable** — was a source edit, not a product feature |
| **Modify colony image map** | Editing `community.jpg` + the template | `comm_uplins`/`upload`/`upldel` uploaded *assets*, not maps | server filesystem access | Ryan: forbidden to CL/CD | no endpoint | **intentionally unavailable** |

### 3.2 Neighborhood tier

| Tool or action | Stock CS4 | Cybertown production evidence | Required original permission | Customization / restriction | Current CTR authorization | CTR decision |
|---|---|---|---|---|---|---|
| **Neighborhood Update page** | `neighbor?ac=wizardplace` → frameset (`neighbor/wizard/place.tmpl`) | No `neighbor?ac=wizard*` captured (login-walled) | `#ifdef owneraccess` | — | `HoodService.canAdmin` (NL/ND scoped, colony leadership scoped, Admin) | **implement now** — hub replacing today's "Update" → background-only link |
| Neighborhood Information | `neighbor/info.tmpl` renders `<$TXT>` with generated fallback | — | `owneraccess` | — | `PlaceInformationService`, `hood` type supported | **already implemented** — link from hub |
| Neighborhood Chat Access | Write axis, `cht=1` | not captured for `DTY=N` | write bit `0x2` | — | **None** | **future lane** — same stop condition as §3.1 |
| Neighborhood moderation | Group Message (`msb?…DTY=N`) | — | `owneraccess` | — | Message/Inbox to All; board+inbox delete via `HoodService.canAdmin` | **already implemented** — link only |
| List existing blocks | `neighbor/present.tmpl`, `#ifdef id01xx` over 30 fixed slots | `neighbor?ac=action&ID=…` archived | read | — | `GET /hood/:id/blocks` | **implement now** — read-only list |
| Neighborhood background | `neighbor?ac=wizardimage` → `wizardimagesubmit`, 160×80 radio thumbnails, no preview | — | `owneraccess` | — | `GET/PUT /hood/:id/map-background-*`, `NeighborhoodMapBackgroundPage.vue` | **already implemented** — link from hub |
| **Create block** | Populate a fixed empty slot: `NAM`, `OWN`, `IC2`, usage `P`/`N` → `ac=wizardsubmit` | none | `#ifdef owneraccess` — a single bit; NL vs ND depends on per-place `ORO` **data not in the corpus** | — | **No endpoint.** `map_location(parent_place_id, location, place_id, available)` could model the slot and `place.map_icon_index` the `IC2` icon, but creation semantics (slug generation, seeding the new block's 72 lot rows, defaults, rollback) are **untraced in CTR** | **unresolved** → **BLOCKED**. See §4.1 |
| **Edit block** (name / owner / icon) | same editor, existing slot | none | as above | — | no endpoint | **unresolved** → blocked with the above |
| **Remove block** | usage radio → `N` ("cannot be accessed"); record retained | none | as above | — | `map_location.available` is the natural analogue; no endpoint | **unresolved** → blocked with the above |

### 3.3 Block tier

| Tool or action | Stock CS4 | Cybertown production evidence | Required original permission | Customization / restriction | Current CTR authorization | CTR decision |
|---|---|---|---|---|---|---|
| **Block Update page** | `block?ac=wizardplace` → frameset | **`block?ac=wizardplace` archived** (+ `wizardpresent` ×6, `wizardinfo` ×2) | `#ifdef owneraccess` | — | `BlockService.canAdmin` | **implement now** — hub; today `BlockTools` links "Update" straight to the lot wizard |
| Block Information | `block/info.tmpl` renders `<$TXT>` above `common/inforoles.tmpl` | `TPL=block/textlist` (Cybertown-custom, 23×) | `owneraccess` | — | `PlaceInformationService`, `block` type supported | **already implemented** (`7a59c9f`) |
| Block Chat Access | Write axis, `cht=1` | not captured for `DTY=B` chat object | write bit `0x2` | — | **None** | **future lane** |
| Block moderation | Group Message (`msb?…DTY=B`) + **Check Images** (`TPL=block/plist`) | — | `owneraccess` | — | Message/Inbox to All; `#/home/image-check`; board+inbox delete via `BlockService.canAdmin` | **already implemented** — link only |
| Lot availability | `block/wizard/present.tmpl`, 72 checkboxes, `oRRCC`/`nRRCC` old-vs-new diff → `ac=wizardpresentsubmit` | `block?ac=wizardpresent` ×6 archived | `owneraccess` | — | `GET/POST /block/:id/locations`, `BlockWizardPage.vue` | **already implemented** — link from hub |
| Background selection | `block?ac=wizardimage` → `wizardimagesubmit`; **no preview, no Restore Default** | — | `owneraccess` (entry link only; submit relied on generic `*UPD`) | — | `GET/PUT /block/:id/map-background-*` + PR #411 server-side check; preview is an **intentional enhancement** (commit `08d12e2`) | **already implemented** — link from hub; do not relax PR #411 |
| Block deletion / structural editing | Owned by the **parent hood's** wizard, never the block's own | none | hood-tier `owneraccess` | — | no endpoint | **unresolved** → blocked with §3.2 |

### 3.4 Cross-cutting

| Item | Classification | Note |
|---|---|---|
| Update tile visible only when the actor has ≥1 applicable capability | **implement now** | Server-authorized per action regardless; hidden links are never the gate |
| Shared/data-driven tool list across the three hubs | **implement now** | Prevents the three hubs drifting, mirroring how CS 4.0 kept wizard and public map identical by frameset construction |
| Job/role-wide `WRO` chat grants | **future lane** | Evidence report C7 |
| Chat Read Access axis | **future lane** | Evidence report §2.1 |
| `ColonyRepresentative` dead clause | **unresolved** | §2.3 — fails closed; outside this brief |
| Colony structural controls for a global technical role | **intentionally unavailable** | §2.4 — no check exists and no endpoint to protect |

---

## 4. Stop conditions reached

Three of the brief's eight stop conditions are met. Each is recorded with the smallest
unblocking step.

### 4.1 Block creation requires unverified schema assumptions — **and an unresolvable authorization question**

Two independent blockers:

1. **Authorization is not derivable from the RE corpus.** §1.3: the gate is one
   `owneraccess` bit whose Neighborhood-Deputy answer lived in per-place `ORO` data that
   no RE or Wayback artifact contains. The brief forbids assuming it. This needs Ryan's
   product decision, not more tracing.
2. **CTR creation semantics are untraced.** The schema *could* carry it
   (`map_location(parent_place_id, location, place_id, available)` for the slot,
   `place.map_icon_index` for `IC2`), but creating a block also requires slug generation,
   seeding the new block's 72 child `map_location` lot rows, background/icon defaults,
   and rollback behavior — none of which is specified anywhere, and all of which is a
   structural mutation of live map data.

**Smallest next step:** a scoped design note answering (a) may Neighborhood Deputies
create blocks — yes/no, product decision; (b) the exact create/withdraw transaction
including lot seeding and rollback; (c) whether "remove" sets `map_location.available =
false` (faithful to usage `N`, record retained) or deletes. Then implement behind
`HoodService.canAdmin` plus whatever narrower tier (b) selects.

### 4.2 Neighborhood creation would require editing custom image maps

Confirmed mechanically in §0.3, not merely by policy. **No further work needed** — the
action is correctly classified *intentionally unavailable* and no endpoint or UI should
exist. Recorded so a later lane does not "restore" it.

### 4.3 Place Chat Access needs a new storage model

§2.5: chat access exists only as `Home Chat Guest` assignments scoped to a home, enforced
at `canChatInPlace`. Extending it to colony/hood/block/public tiers means a new
authorization surface plus Socket.IO enforcement per tier. The brief's own instruction
covers the interim: *"place a Chat Access tile only where a safe existing implementation
exists and leave other tiers documented for the next authorization lane."*

**Smallest next step:** a design pass deciding whether one role can model all place types
or each tier needs its own, whether the owner/implicit rule differs from homes, and who
is implicitly allowed to chat at each tier — presented before any implementation.

### 4.4 Divergence between the brief's premise and stock CS 4.0 — recorded, not blocking

The brief states as product requirement that Colony Leaders and Deputies "could access the
Colony **Update** area" including "Colony Chat Access". Stock CS 4.0 had **no colony
Update page at all** (§0.1), and no colony-scoped chat ACL is archived.

This is not a contradiction of Ryan's *restriction* rules — those are confirmed — but the
positive half of the colony requirement has no CS 4.0 precedent. A Colony Update hub is
therefore a **modern composition of existing CTR tools**, and should be labelled as such
in code and history, exactly as the block background preview was labelled an intentional
enhancement rather than a restoration.

---

## 5. What is proven, inferred, and open

**Proven from RE source (+ Wayback where noted):**
- Stock CS 4.0 has no colony Update page, no colony wizard dispatch, and no colony wizard
  templates (§0.1).
- `ccgi_home_wizard*` symbol presence proves nothing about tier capability;
  `property.exe` is the control case (§0.2). Corrects follow-ups §1b.
- Colony neighborhood placement was hand-authored `<AREA>` coordinates over a JPEG (§0.3).
- Neighborhood block slots are a fixed 6×5 grid; "create" meant populating an existing
  slot and "remove" meant usage `N` (§1.2).
- The only archived Cybertown wizard URLs are block-tier (§1.4).
- CTR's `Access Rights` is the Owner axis (leader + 8 deputies), not chat (§2.6).
- CTR has no place-tier chat ACL and no global technical-role check (§2.4, §2.5).

**Inferred, stated as such:**
- That Cybertown did not add a colony Update page in its own fork. The template set was
  forked and customized (`block/textlist`, `community/colonies` are Cybertown-only), so a
  custom colony admin page cannot be excluded — only that no stock mechanism and no
  archived URL supports one.

**Open / unresolved:**
- CTR block create/withdraw transaction semantics (§6.4).
- Place-tier chat access model (§6.5).
- The `ColonyRepresentative` dead clause (§2.3).

*(Resolved since first writing: whether Neighborhood Deputies may create blocks. Ryan's
product decision is recorded in §6.4 — they may not.)*

---

## 6. Implemented — the scoped Update hubs

Built on this branch after Ryan approved the hubs on 2026-07-27. Everything below has a
real backend, a server-authoritative scoped check, and a test.

### 6.1 What was built, and what it is

| Tier | Route | Component | Restoration or composition? |
|---|---|---|---|
| Colony | `/place/:slug/update` (`colonyUpdate`) | `PlaceUpdatePage` → `PlaceUpdateHub` | **Modern composition.** Stock CS 4.0's colony action bar had no Update button and `community.exe` no wizard dispatch (§0.1). The *tools* inside are authentic; the screen is new. |
| Neighborhood | `/neighborhood/:id/update` (`neighborhoodUpdate`) | same | **Restoration.** `neighbor/action.tmpl:43-44` → `ac=wizardplace`. |
| Block | `/block/:id/update` (`blockUpdate`) | same | **Restoration.** `block/action.tmpl:37-41` → `ac=wizardplace`; archived in production. |

One component serves all three. The tool list is data, in
`spa/src/helpers/place-update-hub.helper.ts`, so the tiers cannot drift into three
near-copies — the same property the original got by building its wizard and its public
map from one frameset.

### 6.2 Authorization

`GET /place/:placeId/update-hub` → `PlaceUpdateHubService.getHub`
(`api/src/services/place/place-update-hub.service.ts`).

- The **only** client input is the place id. Type, slug and the parent chain are read
  from the stored row, so no client-supplied type, slug, colony, hood or block id can
  steer which scoped check runs.
- Capabilities are resolved **individually**, not from one `canAdmin` boolean.
- "Unsupported place type" and "no capability here" return an identical `403` with an
  identical body, so an unauthorized caller cannot enumerate which places have scoped
  administration.
- The endpoint is **advisory, for rendering only.** Every tool it advertises is
  independently authorized by its own endpoint. Hiding a tile is never the access control.

Capability → server-side decision:

| Capability | Decided by | Colony | Hood | Block |
|---|---|---|---|---|
| `update_information` | `PlaceInformationService.canEdit` (same method that gates the `PUT`) | ✓ | ✓ | ✓ |
| `manage_access_rights` | `<tier>Service.canManageAccess` | ✓ | ✓ | ✓ |
| `message_to_all`, `inbox_to_all`, `moderate_messageboard`, `moderate_inbox` | `<tier>Service.canAdmin` **or** `MemberService.getAccessLevel` includes `security` | ✓ | ✓ | ✓ |
| `list_neighborhoods` | `ColonyService.canAdmin` | ✓ | — | — |
| `list_blocks`, `manage_background` | `HoodService.canAdmin` | — | ✓ | — |
| `manage_lots`, `manage_background`, `check_images` | `BlockService.canAdmin` | — | — | ✓ |

**`canManageAccess` is not an alias for `canAdmin`.** At every tier it admits the same
superiors but excludes *that tier's own deputy*. So a Colony Deputy opens the hub and
edits Information, but does not see Access Rights. "May open the Update page" genuinely
does not grant every action within it.

`security` is a real global moderation authority in CTR — the messageboard and inbox
controllers already honour it on every scoped path (`MessageboardController.adminCheck`).
It is modelled here so the tile list and the endpoint behind it agree. It deliberately
does **not** confer the place-shaping tools.

This table answers **who may**. It does not answer **where the control lives** — that is
§6.3, and the two must not be collapsed: several capabilities above are granted and
deliberately have no tile.

### 6.3 Where each control lives — placement, which is not authorization

**Corrected 2026-07-27** after Ryan's manual review found the hubs duplicating
permanent tool-bar actions and carrying two invented moderation tiles.

Holding a capability says the server would honour the action. It does **not** say the
action belongs on the Update page. The original drew that line and CTR now follows it:
CS 4.0's action bars carried Group Message and Access Rights as permanent buttons
(`community/action.tmpl:48-56`, `neighbor/action.tmpl:40-50`, `block/action.tmpl:37-41`),
while the Update button *beside* them opened a wizard whose own screens were a different,
smaller set:

```
$ strings install-4.0/csbin/community/neighbor.exe | grep -i '^wizard'
wizard  wizarderror002  wizarderror003  wizardimage  wizardimagesubmit
wizardinfo  wizardplace  wizardpresent  wizardsubmit
```

Information, the child map, the background. Nothing else. Reproducing every capability as
a tile invented an umbrella screen the original never had, and put the same action in two
places.

Four categories, and every capability is in exactly one:

| Category | Capabilities | Surface |
|---|---|---|
| **Permanent place tool bar** | `message_to_all`, `inbox_to_all`, `manage_access_rights`, `check_images` | The bar, in its original position and order. Unchanged by this branch. |
| **Inside the Update hub** | `update_information`, `manage_lots`, `manage_background`, `list_neighborhoods`, `list_blocks` | The wizard's own screens. |
| **A dedicated moderation page** | `moderate_messageboard`, `moderate_inbox` | The place's own Messages and Inbox windows, which already carry their delete controls. These are message-board and inbox moderation and are **never** relabelled as chat moderation. |
| **Structural, unavailable in CTR** | *(no capability exists)* | Colony map editing (§6.6), block creation/withdrawal (§6.4). Enforced by absence, not by a hidden flag. |

The table is `CAPABILITY_PLACEMENT` in `spa/src/helpers/place-update-hub.helper.ts`, with
the hub-placed subset duplicated as `HUB_PLACED_CAPABILITIES` in
`place-update-hub.service.ts` so the server — not the client — decides `canOpen`.

**`canOpen`.** The endpoint returns the *full* capability list, because the tool bars need
it to gate their own buttons. `canOpen` is the narrower answer: true only when a
hub-placed capability was granted. A Security role holds four capabilities and `canOpen:
false` — it gets its bar buttons and no Update button, rather than an empty wizard.

#### Tile inventory

Every tile. None is a placeholder; a tool without an authoritative backend is not listed
at all, and no tile is a second route to something the bar already offers.

| Label | Capability | Route / target | Backend endpoint | Server-side authorization | Place types | Origin |
|---|---|---|---|---|---|---|
| Update Information | `update_information` | `place-update-information` | `GET/PUT /place/:placeId/information` | `PlaceInformationService.canEdit` (type from stored row) | colony, hood, block | **classic** — `place/updateinfo.{cfg,tmpl}`, wizard `ac=wizardinfo` |
| Lot Availability | `manage_lots` | `blockwizard` | `GET/POST /block/:id/locations` | `BlockService.canAdmin` | block | **classic** — `block/wizard/present.tmpl`, 72 checkboxes, `ac=wizardpresent` |
| Map Background | `manage_background` | `neighborhoodmapbackground` / `blockmapbackground` | `GET/PUT /<tier>/:id/map-background-*` | `<tier>Service.canAdmin` (PR #411) | hood, block | **classic** — `wizard/image.tmpl`, `ac=wizardimage`; the live-overlay preview is a CTR enhancement |

So: **Colony** = Update Information + the neighborhood list. **Neighborhood** = Update
Information + Map Background + the block list. **Block** = Update Information + Lot
Availability + Map Background. That is the CS 4.0 wizard action set exactly, minus the
child-creation half deferred in §6.4.

Children are listed for **navigation only** (`GET /colony/:slug/hoods`,
`GET /hood/:id/blocks`). Listing a child confers no authority over it; each child's own
Update page re-checks the actor.

#### Tool-bar inventory — unchanged, and asserted to stay that way

| Label | Capability | Route | Backend endpoint | Authorization |
|---|---|---|---|---|
| Message to All | `message_to_all` | `colonyMessageToAll` / `neighborhoodMessageToAll` / `blockMessageToAll` | `POST /messageboard/postmessageall` | `MessageboardController.adminCheck` → `<tier>Service.canAdmin` or security |
| Inbox to All | `inbox_to_all` | `colonyInboxToAll` / `neighborhoodInboxToAll` / `blockInboxToAll` | `POST /inbox/postinboxall` | `InboxController.adminCheck` → same scoped set |
| Access Rights | `manage_access_rights` | `worldAccessRights` / `neighborhoodAccessRights` / `blockaccessrights` | `GET /<tier>/:id/getAccessInfo`, `POST /<tier>/:id/postAccessInfo` | `<tier>Service.canManageAccess` on the POST |
| Check (Images) | `check_images` | popup `#/home/image-check` | existing home image-check page | `BlockService.canAdmin` for the button |
| Information / Inbox / Messages | *(ungated)* | popups | existing | each window authorizes its own actions |

**Check Images is a bar tool, not a wizard screen.** It is `block/action.tmpl`'s third
owner tool (`edit?…&TPL=block/plist`), and it is absent from the block wizard's action
list above. It stays on the bar, where it has always been, and is asserted absent from the
hub.

"Moderation" is not used as a category anywhere — the moderation-ish tools are named
individually, and each maps to a specific endpoint.

#### Public Information windows are display-only

**Corrected 2026-07-27.** `spa/src/pages/Information.vue` previously offered an
`Update Info` link when `GET /place/:id/information/can_edit` said yes. That link is gone
from the Colony, Neighborhood, Block and public/Mall Information windows, and the page no
longer calls `can_edit` at all — it offers no editor, so the answer would decide nothing.

The window now shows heading → sanitized information → Leader/Deputy staffing, and
nothing else. This matches the original: `place/info.tmpl` and the block/neighbor
equivalents rendered `<$TXT>` and the roles list, while every editor lived behind the
action bar's Update button on the authenticated page.

`PUT /place/:placeId/information` is unchanged and still independently authorized —
removing the link removed a link, not a gate.

> **Consequence, flagged rather than worked around:** public places (Mall, and every other
> `type = 'public'` place) have **no Update hub** — `PlaceUpdateHubService` supports
> colony, hood and block only. With the link gone, public/Mall information has no UI entry
> point on this branch. The endpoint, its authorization and any stored value are untouched;
> what is missing is a route to reach it. Building a public-place hub would be a new
> feature, which this branch is explicitly not to add. **Deferred, and listed in §6.9.**

### 6.4 Block creation — decided, deliberately not built

**Ryan's product decision, 2026-07-27**, recorded here for the future lane:

| Role | May create a block in a neighborhood? |
|---|---|
| Colony Leader, scoped to that colony | **Yes** |
| Colony Deputy, scoped to that colony | **Yes** |
| Neighborhood Leader, scoped to that neighborhood | **Yes** |
| **Neighborhood Deputy** | **No** |
| Leadership scoped elsewhere | No |
| Ordinary member | No |

This resolves the question §1.3 showed to be unanswerable from evidence — the original's
gate was a single `owneraccess` bit whose value lived in per-place ACL data that survives
in no artifact.

**Not implemented on this branch.** No `create_block`, `remove_block` or `delete_block`
capability exists, and `place-update-hub.service.spec.ts` asserts the granted set against
an allowlist so that adding one later fails a test rather than shipping silently. Still
open before it can be built: slug generation, seeding the new block's 72 child
`map_location` lot rows, background and icon defaults, and rollback. Note
`map_location(parent_place_id, location, place_id, available)` already models the fixed
slot and `place.map_icon_index` the classic `IC2` icon, so the schema is closer than the
gap suggests.

### 6.5 Chat Access and Chat Moderation — traced, deferred, and still absent

Both were traced in full on 2026-07-27 —
[`classic-chat-moderation-trace.md`](./classic-chat-moderation-trace.md) is the evidence
document; the headline findings are:

- The original had **two** distinct features, not one. **Moderate Chat** was a live
  console: a Java applet (`place/moderate.tmpl`) talking to a separate `mdserver` daemon,
  gated on `owneraccess` or a server-wide `mdserverPassword`, with **no stored
  "who may moderate" list anywhere**. **Chat Write/Read Access** was the rights screen
  (`common/chatrights` → `updwriterights&cht=1`), 8 nickname slots plus a job bitmask.
- **Neither existed at the colony or neighborhood tier.** Only `place.exe` carries the
  `moderate` action — `community.exe`, `neighbor.exe` and `block.exe` carry none — and
  every archived Cybertown moderation URL is `place?ac=moderate&plc=<public slug>`
  (beach, fleamarket, jail, nightclub). Every archived `cht=1` rights URL targets
  `DTY=I&KEY=h<homeID>`, a home.
- Building either in CTR needs a new relation, a migration, a socket authorization rule
  and a moderator identity model — **all four**. Per the standing instruction, the design
  was produced and implementation stopped there.

So no Chat or Chat Moderation tile exists at any tier, and tests assert it at both layers:
no tile's key, label or description contains "chat"
(`spa/tests/place-update-hub.test.ts`), and no chat-named capability is ever granted
(`place-update-hub.service.spec.ts`). `HomeService.canChatInPlace` is home-scoped by
construction (§2.5); a place-tier tile would be a button with nothing behind it.

**`moderate_messageboard` and `moderate_inbox` are not it.** They are message-board and
inbox moderation, they keep their own names and their own windows, and they were removed
from the Update hubs on 2026-07-27 rather than relabelled — a chat tile pointing at
`#/messageboard/<id>` would have been exactly the cosmetic tile the brief forbade.

**Product constraint for that future lane, from Ryan, 2026-07-27:** in the homesteading
hierarchy **you cannot chat in a block.** Chat exists at the **colony** and
**neighborhood** tiers only. A block is a map of lots you pass through to reach a home,
not a room.

This narrows the deferred work usefully, and the block half is corroborated by the stock
action bars. Verified directly:

| Template | Chat entry |
|---|---|
| `community/action.tmpl:31-34` | **2D Chat** (`b2dchat.gif` → `ac=place&force=s`) under `#ifdef chataccess` |
| `neighbor/action.tmpl` | **none** |
| `block/action.tmpl` | **none** |

So stock CS 4.0 gave a chat entry at the **colony tier only** of the three. That the
*neighborhood* also had chat is Ryan's product knowledge of Cybertown's own build, not a
stock behavior — recorded as such rather than claimed from the corpus. The generic ACL
machinery would have supported any tier (`common/chatrights.tmpl` takes `DTY` as a
parameter), so stock code alone cannot settle where chat was meaningful.

When place-tier chat is built: **colony and neighborhood only; a block gets no
chat-access surface at all.**

Access Rights is labelled and described as assigning **leaders and deputies**, never as
chat — a test pins that too, because conflating the Owner axis with the chat Write axis is
exactly the error the evidence report §2.2 warns against in the other direction.

### 6.5a Owner/Access Rights is NOT Chat Access — the Colony Deputy case

Two different things share the word "access", and conflating them would quietly cancel a
product requirement. Stated explicitly so it survives review:

| | **Owner / Access Rights** (`manage_access_rights`) | **Chat Access** (deferred) |
|---|---|---|
| Classic axis | **Owner** axis — `common/updownerrights`, `OWN` + `AS1`–`AS8` | **Write** axis on a *separate* chat object — `common/updwriterights` with `cht=1`, `DTY=I` |
| What it does | Assigns the place's leader and deputies | Says who may speak in the place's chat |
| In CTR today | Implemented, shipped, gated by `<tier>Service.canManageAccess` | **Not implemented** |

**The Colony Deputy is excluded from `manage_access_rights` only.** That is CTR's existing
`ColonyService.canManageAccess` contract — a Deputy may not appoint the colony's leadership —
and this lane did not introduce it; it merely stopped drawing a button whose POST was already
being refused.

**It says nothing about Chat Access.** Ryan's requirement that Colony Deputies eventually be
able to manage **Colony Chat Access** is unaffected and still stands. When the place-chat lane
is built it must decide its own permission set from scratch, and the expected answer there is
that Colony Deputies **are** included. Do not derive the chat permission set from
`canManageAccess`, and do not reuse `manage_access_rights` to model it.

### 6.6 Colony map structure — enforced by absence

There is no structural colony endpoint, so there is nothing to gate and no
technical-role check was invented. `Founder` and `Com tech` exist as role rows and remain
unreferenced by any service (§2.4). `ColonyRepresentative` was left exactly as found —
dead, failing closed — for a separate security cleanup.

The hub states the restriction in the UI rather than only in these docs, so nobody hunts
for a missing button:

> The colony map's layout is fixed. Adding, removing or repositioning a neighborhood is
> not done from this page.

### 6.7 Final capability matrix

Rows are CTR role names with their scope. "own" = the assignment's `place_id` is the place
being acted on; "parent"/"ancestor" = scoped to a superior place on the same chain.

`Not implemented — deferred` means the capability is a real product intention with no code
yet — **not** a denial. `Unavailable` means it will not be built for anyone.

Note the **Security roles** column: they are a global *moderation* authority, not place
administrators. They get the four message/inbox capabilities everywhere and nothing else —
no Information, no Owner/Access Rights, no lots, no background, no image check, no child
listing. Pinned by `place-update-hub.service.spec.ts`.

The **open Update hub** row follows `canOpen`, not "the endpoint answered 200": it is true
only when a capability whose control lives *inside* the hub was granted (§6.3). That is why
Security roles — who hold four real capabilities — get **No**. Their bar buttons are
unaffected.

| Capability | Admin (global) | Security roles (global) | Colony Leader (own colony) | Colony Deputy (own colony) | Neighborhood Leader (own hood) | Neighborhood Deputy (own hood) | Block Leader (own block) | Block Deputy (own block) | Member / unrelated staff | Anonymous |
|---|---|---|---|---|---|---|---|---|---|---|
| **open Update hub** | Yes | **No** — moderation authority, no wizard screen | Yes (colony, + descendants) | Yes (colony, + descendants) | Yes (hood, + its blocks) | Yes (hood, + its blocks) | Yes (block) | Yes (block) | No | No |
| **update Information** | Yes | No | Yes | Yes | Yes | Yes | Yes | Yes | No | No |
| **manage Owner/Access Rights** | Yes | No | Yes | **No** (see §6.5a — unrelated to Chat Access) | Yes | **No** at own hood; Yes at blocks beneath it | Yes | **No** | No | No |
| **use Message to All** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No |
| **use Inbox to All** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No |
| **check images** | Yes (block) | **No** | Yes (blocks beneath) | Yes (blocks beneath) | Yes (blocks beneath) | Yes (blocks beneath) | Yes | Yes | No | No |
| **list subordinate places** | Yes | No | Yes (neighborhoods) | Yes (neighborhoods) | Yes (blocks) | Yes (blocks) | n/a — a block has none | n/a | No | No |
| **change lots** | Yes (block) | No | Yes (blocks beneath) | Yes (blocks beneath) | Yes (blocks beneath) | Yes (blocks beneath) | Yes | Yes | No | No |
| **change background** | Yes (hood, block) | No | Yes (beneath) | Yes (beneath) | Yes (own hood + blocks) | Yes (own hood + blocks) | Yes | Yes | No | No |
| **create neighborhoods** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** | **Unavailable** |
| **create blocks** | *Not implemented — deferred* | *Not implemented — deferred* | *Not implemented — deferred* (intended: **Yes**) | *Not implemented — deferred* (intended: **Yes**) | *Not implemented — deferred* (intended: **Yes**) | *Not implemented — deferred* (intended: **No**) | *Not implemented — deferred* (intended: No) | *Not implemented — deferred* (intended: No) | No | No |
| **manage Chat Access** | *Not implemented — deferred* | *Not implemented — deferred* | *Not implemented — deferred* (colony: future lane) | *Not implemented — deferred* (colony: future lane, **Ryan requires Deputies included**) | *Not implemented — deferred* (hood: future lane) | *Not implemented — deferred* (hood: future lane) | **Not planned** — blocks have no chat | **Not planned** — blocks have no chat | No | No |
| **manage Chat Moderation** | *Not implemented — deferred* | *Not implemented — deferred* | *Not implemented — deferred* (colony: future lane) | *Not implemented — deferred* (colony: future lane) | *Not implemented — deferred* (hood: future lane) | *Not implemented — deferred* (hood: future lane) | **Not planned** — blocks have no chat | **Not planned** — blocks have no chat | No | No |
| **moderate message board / inbox** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No |

The last row is deliberately adjacent to the two above it: it is a real, shipped capability
reached from the place's Messages and Inbox windows, and it is **not** chat moderation.

**Explicit product record:**

- **Colony Chat Access** — future lane. Colony Deputies are required to be included; §6.5a
  explains why the Owner-axis exclusion does not carry over.
- **Neighborhood Chat Access** — future lane.
- **Block Chat Access** — **intentionally not planned.** You cannot chat in a block (§6.5).
- **Colony / Neighborhood Chat Moderation** — future lane, blocked on a product decision
  between the original's two different features (a live console vs. a stored allowlist).
  Traced in full: `classic-chat-moderation-trace.md`. Neither existed at these tiers
  historically, so the permission set must be decided, not recovered.
- **Block Chat Moderation** — **intentionally not planned**, for the same reason as Block
  Chat Access.
- **Block creation** — future lane. Colony Leader **yes**, Colony Deputy **yes**,
  Neighborhood Leader **yes**, Neighborhood Deputy **no** (§6.4).
- **Colony structural map editing** — **unavailable** to every role including Admin (§6.6).
- **`ColonyRepresentative` latent authorization clause** — separate security-cleanup lane
  (§2.3). Fails closed today; do not seed a role with that name.

### 6.8 Behavior changes worth reviewing

Four, in the order a reviewer will meet them.

1. **The scoped tool bars are unchanged.** Message to All, Inbox to All, Access Rights and
   Check keep their positions and routes. An intermediate iteration of this branch moved
   them into the hub; that was wrong, was reverted, and is now asserted against by test
   (`the permanent tool bars keep their original buttons and routes`).

2. **The public Information windows no longer offer `Update Info`.** Colony, Neighborhood,
   Block and public/Mall Information are display-only. Editing is reached from the Update
   hub's Update Information tile. See §6.3 — including the flagged consequence that
   public/Mall information now has no UI entry point at all.

3. **A tool bar's Update button follows `canOpen`.** A member who holds only tool-bar or
   moderation capabilities — a Security role is exactly that — sees their bar buttons and
   no Update button, instead of an Update button leading to an empty page.

4. **A Colony Deputy no longer sees an Access Rights button.** It falls out of using the
   real capability: `canManageAccess` excludes them, so the POST was already being refused.
   Nothing they could actually do has been removed.

### 6.9 Deferred out of this branch, deliberately

| Item | Why | Where recorded |
|---|---|---|
| Colony / Neighborhood **Chat Access** | Needs a new relation, migration and socket rule | `classic-chat-moderation-trace.md` §4.1 |
| **Chat Moderation** console | Needs all of the above plus a moderator identity model | same, §4.2 |
| **Block creation / withdrawal** | Schema and rollback design open | §6.4 |
| **Public/Mall Information editing UI** | Public places have no Update hub, and adding one is a new feature this branch must not add. Endpoint and authorization untouched | §6.3 |
| Job-wide `WRO` chat grants; Chat **Read** Access | No model in CTR at all | `classic-place-admin-followups.md` §2 |
| `ColonyRepresentative` dead clause | Fails closed today; belongs to a security lane | §2.3 |
| Unauthenticated `moderation` socket rebroadcast (`spa/server.js:345-349`) | Pre-existing, untouched by this branch; same security lane | `classic-chat-moderation-trace.md` §3 |
