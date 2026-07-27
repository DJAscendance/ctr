# Classic Place Administration — TODO / follow-up lanes

Not for the `fix/classic-place-admin-fidelity` lane. Recorded here so proven original
capabilities are deferred deliberately rather than forgotten.

Evidence conventions match
[`classic-place-admin-re-evidence.md`](./classic-place-admin-re-evidence.md): every claim
cites a reverse-engineered source path and symbol, a Wayback artifact, or both. Paths are
relative to `~/Projects/cybertown/blaxxun-cs-RE/`.

---

## 1. The place "UPDATE" button was an umbrella Update Wizard

**Status: mostly missing in CTR.** CTR's place sidebar shows an `UPDATE` button, but it
leads to a much smaller tool than the original did. In blaxxun CS 4.0 that button opened a
per-place **Update Wizard** that managed the place's *children*, its background, its
information, and its access rights.

The button itself, gated on owner access:

- Block: `install-4.0/csbin/community/templates/block/action.tmpl:37-41`
  → `block?ac=wizardplace&ID=<id>`, `#ifdef owneraccess`
- Neighborhood: `install-4.0/csbin/community/templates/neighbor/action.tmpl:43-44`
  → `neighbor?ac=wizardplace&ID=<id>`, `#ifdef owneraccess`

Both CGIs implement the same action set (recovered from the shipped binaries):

```
$ strings install-4.0/csbin/community/neighbor.exe | grep -i '^wizard'
wizard  wizarderror002  wizarderror003  wizardimage  wizardimagesubmit
wizardinfo  wizardplace  wizardpresent  wizardsubmit

$ strings install-4.0/csbin/community/block.exe | grep -i '^wizard'
wizard  wizarderror002  wizarderror003  wizardimage  wizardimagesubmit
wizardinfo  wizardplace  wizardpresent  wizardpresentsubmit  wizardsubmit
```

> **Partly addressed 2026-07-27.** The Update *button* and its hub are now built for all
> three tiers — see
> [`classic-update-hierarchy-matrix.md`](./classic-update-hierarchy-matrix.md) §6. What
> remains deferred is only the **child-place management** described in §1a below.

### 1a. Neighborhood wizard — add / edit / remove blocks

`neighbor?ac=wizardplace` → `neighbor/wizard/place.tmpl` frameset →
`ac=wizardpresent` (the hood map) + `ac=wizardinfo` (controls).

- `neighbor/wizard/present.tmpl` — every map slot is a link
  `neighbor?ac=wizard&mode=<modeRRCC>&ID=<idRRCC>`. The **`mode`** parameter is what
  distinguishes "create a new block in this empty slot" from "edit the block already here".
- `neighbor/wizard/info.tmpl:20-25` — *"Click the \<BNM\> you want to update."* plus
  *"Change the background image for this \<ENM\>"* → `ac=wizardimage`.
- `neighbor/wizard/wizard.tmpl` — the per-child editor, and the important one:

  | Control | Field | Meaning |
  |---|---|---|
  | Usage radio | `<$PU2>` = `P` / `N` | **free for use** / **cannot be accessed** — this is how a block was added to or withdrawn from a neighborhood |
  | Name | `NAM`, `MAXLENGTH=32 SIZE=32` | the block's name |
  | Owner | `OWN`, `MAXLENGTH=16 SIZE=16` | assigns the block's owner by nickname |
  | 2D icon | `IC2` radio over `Picon2D<NNN>.gif` | the block's icon on the hood map |

  Submits `ac=wizardsubmit` with Ok / Cancel. Error strings: `wizarderror001` "could not be
  stored in the database", `wizarderror002` "A name has to be given!!!", `wizarderror003`
  "A 2D icon has to be selected!!!".

**CTR gap:** there is no way for a Neighborhood Leader or Deputy to create, rename,
re-icon, reassign or withdraw a block. The hood map is read-only apart from the background.

**Product decision recorded 2026-07-27** (the matrix §6.4 carries the full table): scoped
Colony Leaders, scoped Colony Deputies and Neighborhood Leaders may create a block;
**Neighborhood Deputies may not.** This settles the authorization question the RE corpus
could not answer — the original's gate was a single `owneraccess` bit whose value lived in
per-place ACL data that survives in no artifact.

Still to be designed before any code: slug generation, seeding the new block's 72 child
`map_location` lot rows, background and icon defaults, and rollback. `map_location(
parent_place_id, location, place_id, available)` already models the fixed slot and
`place.map_icon_index` the classic `IC2` icon.

### 1b. Colony wizard — **RETRACTED: no colony wizard existed**

> **This section previously claimed the colony wizard was "confirmed by the binary". That
> was wrong.** The claim rested on `ccgi_home_wizard*` symbols appearing in
> `community.exe`. Those symbols are a statically linked shared module present
> byte-identically in *every* CGI in the family — including `property.exe`, which
> unambiguously has no wizard. Symbol presence proves link-time inclusion, nothing more.
>
> Corrected and re-traced in
> [`classic-update-hierarchy-matrix.md`](./classic-update-hierarchy-matrix.md) §0.1–§0.3.
> Retained here so the retraction is visible rather than silently overwritten.

The real dispatch evidence is the **tier-specific** `<cgi>_wizard*` strings and the
`<tier>/wizard/*.tmpl` template references. Colony has neither:

```
$ strings install-4.0/csbin/community/community.exe | grep -o './log/[a-z_0-9]*\.log'
./log/ccgi_home_imageput.log  ./log/comm_action.log   ./log/comm_place.log
./log/community.log           ./log/comm_uplins.log   ./log/comm_uplinssubmit.log
./log/comm_upllist.log
```

No `comm_wizard*`; no `community/wizard/*.tmpl` referenced anywhere in the binary. Nor is
there an Update button to reach one — `community/action.tmpl`'s entire `#ifdef owneraccess`
branch is a single Group Message link, where `neighbor/action.tmpl:43-44` and
`block/action.tmpl:37-41` both carry `bupdate.gif` → `ac=wizardplace`.

The colony CGI's only mutating family is `uplins` / `upload` / `upldel` — an asset upload
manager (`community/upl2di.tmpl`, `upl2dw`, `upl3di`, `upl3dw`) that stocks the media
library feeding the icon and background pickers. It is not a map editor.

Colony neighborhood placement was a **hard-coded HTML image map**: literal, hand-tuned
pixel coordinates in `community/present.tmpl` over a per-colony `community.jpg`. Changing
a colony's layout meant editing that template and the JPEG on the server — a filesystem
operation, not a product feature available to any role.

**No follow-up lane is needed.** Colony structural editing is not deferred work; it is
correctly classified *intentionally unavailable*, and this independently confirms Ryan's
product rule that Colony Leaders and Deputies must not alter colony map structure.

**CTR gap:** none. Colony-level neighborhood management should not be built.

---

## 2. Chat access for places, not only homes

The `UPDATE` / access-rights tooling carried chat access for **every** place, not just
homes. CTR currently has server-authoritative chat access for homes only.

- **CS 4.0** kept a place's chat ACL as a separate object and exposed it through the same
  8-slot forms: `common/updwriterights.tmpl` and `common/updreadrights.tmpl` with `cht=1`,
  reachable from `common/chatrights.tmpl` / `common/chatrightstop.tmpl`. The place-level
  owner form also links a "Chat Owner Access" variant when `isAdmin`
  (`common/updownerrights.tmpl`, the `#ifdef cht` branch).
- **CS 5.1** states it outright on the single unified rights page
  (`install/blaxxun interactive/Virtual Worlds Platform/csbin/community/templates/place/rights.html`):
  *"You can define an owner, owner deputies, and read and write access **for chat**."*
  It also pins the empty-set default in code: no read set ⇒ `RRO_BIT_0` + `RRO_BIT_1`; no
  write set ⇒ `WRO_BIT_1` (members may write, visitors may read).
- Archived Cybertown URLs confirm both axes were live in production, for homes
  (`DTY=I&KEY=h<homeID>&cht=1`) and for clubs (`DTY=CL&…&TPL=common/updwriterights`) —
  see the evidence report §0.

**Deferred from this lane** (recorded in `HomeChatAccessPage.vue` as well):

- **Job/role-wide chat grants** — the `WRO` 32-bit role bitmask. The original let an owner
  grant chat write access to whole jobs, with the documented shortcut *"checkmark only
  'Members' — this includes ALL other jobs, but not visitors."*
- **Chat Read Access** — the `RI1`–`RI8` + `RRO` axis. CTR has no "may see the chat but not
  speak" concept; adding one is a product decision, not a restoration defect.
- **Chat access on non-home places** — the item above. **Scope decided by Ryan
  2026-07-27: colony and neighborhood tiers only. You cannot chat in a block.** A block
  is a map of lots you pass through to reach a home, not a room, so it must get no
  chat-access surface at all. The block half is corroborated by the stock action bars —
  `community/action.tmpl:31-34` carries a 2D Chat button under `#ifdef chataccess` while
  `neighbor/action.tmpl` and `block/action.tmpl` carry none. That the *neighborhood* also
  had chat is Ryan's knowledge of Cybertown's own build rather than a stock behavior:
  stock CS 4.0 shows a chat entry at the colony tier only, and the generic ACL machinery
  (`common/chatrights.tmpl`, `DTY` as a parameter) would have supported any tier, so the
  corpus alone cannot settle where chat was meaningful.

Each is a new authorization surface and interacts with the scoped-role work landed in the
beta reconciliation lane. They want their own lane, with the same evidence standard.

---

## 3. Smaller items already recorded elsewhere

- **Home "my links" block** — `LL0`–`LL4` (labels) + `LD0`–`LD4` (destinations) alongside
  `TXT` on the home record (`install-4.0/csbin/community/templates/property/updateinfo.cfg`;
  5.1 writes the same set in one `*UPD` in `home/update.cfg`). Clearly classic, clearly out
  of scope for the place-information lane, and it adds a second user-supplied URL surface.
- **Shops and clubs for place information** — deliberately unsupported in the current lane.
  Shops have no place view and no scoped shop staff role (the shop Information window shows
  *Mall* staff); clubs would need their own evidence pass. See the evidence report §4.5,
  which records that no 4.0 shop/club `info` template rendering `TXT` was found.
- **`place/updateinfo` in 5.1/7.0 also carried auditorium settings** — a `CHT` flag pair
  ("Use Auditorium/Stage", "No chat in auditorium during moderation") and a stage password
  `SPW`. Not part of the 4.0 lineage Cybertown ran; noted only so the field is not mistaken
  for something missing.

---

## 4. Verification standard for any of the above

Same as the research lane: trace the original entry point, call path, permission check,
parameters, validation, storage, update/delete semantics, error and ignored-input
behaviour, and rendering — citing RE source paths and symbols and/or Wayback artifacts —
before proposing CTR code. Historical behaviour is the UX specification, never permission
to restore insecure code.
