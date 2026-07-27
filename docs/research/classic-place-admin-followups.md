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

### 1b. Colony wizard — add / edit / remove neighborhoods

Ryan's recollection that colony leaders and deputies could add neighborhoods to a colony is
**confirmed by the binary**, even though this 4.0 install ships no colony wizard templates
(`install-4.0/csbin/community/templates/community/` has `action`, `error`, `index`, `info`,
`mapinfo`, `place`, `present`, `rolem` — no `wizard/` directory; Cybertown supplied its own):

```
$ strings install-4.0/csbin/community/community.exe | grep -i 'ccgi_home_'
ccgi_home_action        ccgi_home_checkread   ccgi_home_imageput
ccgi_home_present       ccgi_home_printmedia  ccgi_home_wizard
ccgi_home_wizardloop    ccgi_home_wizardpresent  ccgi_home_wizardsubmit

$ strings install-4.0/csbin/community/community.exe | grep -i neighbor
list neighborhood keys: id=%s
```

So `community.exe` — the colony/community CGI — carries the same
`wizard` / `wizardpresent` / `wizardsubmit` handler family as `neighbor.exe` and
`block.exe`, and enumerates neighborhood keys. The colony tier of the same wizard existed;
only its templates are absent from this corpus.

**Follow-up needed:** recover the colony wizard's template shape, either from a Cybertown
Wayback capture of `/cgi-bin/cybertown/community?ac=wizard*` (the CDX index in
`wb-ct-scrape/manifests/` is the place to look) or by decompiling `ccgi_home_wizard` /
`ccgi_home_wizardpresent` in `community.exe`. Do not implement from the neighborhood
template by analogy without checking — the colony map geometry differs.

**CTR gap:** no colony-level management of neighborhoods at all.

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
- **Chat access on non-home places** — the item above.

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
