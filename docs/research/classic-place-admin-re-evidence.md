# Classic Place Administration — Reverse-Engineered Behavior Evidence Report

**Branch:** `fix/classic-place-admin-fidelity` (from `origin/beta` @ `76cb514`)
**Date:** 2026-07-27
**Status:** Research phase. No implementation, no deployment.

Primary authority for this report is the reverse-engineered blaxxun Community Server
code and shipped template/config corpus. Wayback artifacts are used to determine
*which* version and configuration Cybertown actually exposed. Screenshots are used
only to confirm wording and presentation. Current CTR code is cited last, only to
state the delta.

---

## 0. Corpus, versions, and one correction to the brief

The RE corpus contains **three** server generations, not two:

| Label | On-disk root | Provenance |
|---|---|---|
| **CS 4.0** | `blaxxun-cs-RE/install-4.0/` | Extracted from `Bxcommserv4.exe` (InstallShield V3, Feb 1999) — `HANDOFF-4.0-5.1.md` §1 |
| **CS 5.1** (Virtual Worlds Platform 5.1) | `blaxxun-cs-RE/install/blaxxun interactive/Virtual Worlds Platform/` | Live configured install pulled from the `winxp` VM — `README.md` |
| **CS 7.0** | `blaxxun-cs-RE/install-7.0/` | Extracted from `cs-7-0-win-full.exe` — `HANDOFF-4.0-5.1.md` §0 |

The deep CGI/permission decompile (`re-artifacts/7.0/cgi/01-cgi-window-spec.md`) was
done against **7.0** binaries. 5.1 and 7.0 share the same CGI engine generation and
the same template family, so that decompile is load-bearing for 5.1 as well; where I
rely on it for 5.1 I say so explicitly. 4.0 is a genuinely different engine and its
behavior below is read from 4.0's own binaries' templates and `.cfg` schemas.

### The headline finding

**Cybertown ran the CS 4.0-lineage web/CGI window layer, not the 5.1/7.0 one.**

Proof is direct, from archived production URLs in the Wayback CDX index
(`wb-ct-scrape/manifests/cdx_all.jsonl`, `manifests/cdx_chunks/chunk_00020.json`):

```
http://www.cybertown.com:80/cgi-bin/cybertown/edit?ac=read&DTY=I&KTY=ID
    &KEY=h0103040201020105&cht=1&TPL=common/updwriterights&PRI=P
http://www1.cybertown.com:80/cgi-bin/cybertown/edit?ac=read&DTY=I&KTY=ID
    &KEY=h0105050103020306&cht=1&TPL=common/updreadrights&PRI=P
http://www.cybertown.com:80/cgi-bin/cybertown/edit?ac=read&DTY=B&KTY=ID
    &KEY=0102020601010000&TPL=common/updownerrights&PRI=B
http://www.cybertown.com:80/cgi-bin/cybertown/edit?ac=read&DTY=CL&KTY=ID
    &KEY=CL000000000017be&TPL=common/updwriterights&PRI=CL
```

`common/updwriterights`, `common/updreadrights` and `common/updownerrights` exist
**only in 4.0** (`install-4.0/csbin/community/templates/common/`). In 5.1 and 7.0
they are gone, replaced by a single unified `place/rights*.html`. Likewise the block
Update Wizard URLs are archived as real Cybertown pages —
`wb-ct-scrape/html/cgi-bin/cybertown/block/ac=wizardpresent/ID=*.html`,
`ac=wizardinfo`, `ac=wizardplace` — and `ac=wizard*` exists **only in 4.0**
(`install-4.0/csbin/community/templates/block/wizard/`); 5.1 and 7.0 have no block
wizard, no lot grid and no block background at all.

So for all three target features, **CS 4.0 is the specification and CS 5.1 is the
counter-example**. Cybertown clearly forked and heavily customized the 4.0 template
set (the `property`→`home` naming, colony structure and art are Cybertown's own), but
the mechanism, parameter names and permission model are 4.0's.

Note also `g_exe = CGIEXE` (`install-4.0/csbin/community/config/global.cfg:58`) — a
substitution token that resolves to `.exe` or empty. Cybertown's archived URLs are
`/cgi-bin/cybertown/edit`, `/cgi-bin/cybertown/block` with no extension, i.e. a Unix
build with the token empty. Two communities were served from one install:
`/cgi-bin/cybertown/` and `/cgi-bin/colonycity/`.

### Honest limitation on Wayback

Every archived capture of an *authenticated* admin page in the scrape is a login
wall. I checked `ac=wizardpresent/ID=0104030601060000.html` and
`ac=present/ID=0101020201010000.html` directly: both contain the login form
(`name="NNM" size="16" maxlength="16"`) and an empty `<BODY BACKGROUND="">`, not the
map. Therefore **Wayback proves the URLs, parameters and version lineage, but supplies
no rendered admin markup.** Rendered structure below comes from the 4.0 templates
themselves; rendered *geometry* is independently confirmed from archived production
image assets (§3.2), which is the strongest available cross-check.

---

## 1. The permission model (applies to all three features)

### 1.1 Access bits

Access-right bit convention, from the engine decompile
(`re-artifacts/7.0/cgi/01-cgi-window-spec.md` §2, header of "Shared engine
semantics"):

```
owner = 0x1    write = 0x2    read = 0x4    change-rights = 0x8
```

### 1.2 The ACL record

Every access-controlled object carries the same rights schema. Declared side, 4.0
(`install-4.0/csbin/community/templates/common/updownerrights.cfg`,
`updreadrights.cfg`, `updwriterights.cfg`, `updchangerights.cfg`):

| Axis | Nickname slots | Role bitmask | 4.0 template |
|---|---|---|---|
| Owner | `OWN`, `AS1`–`AS8` | `ORO` (32-bit) | `common/updownerrights` |
| Read | `RI1`–`RI8` | `RRO` (32-bit) | `common/updreadrights` |
| Write | `WI1`–`WI8` | `WRO` (32-bit) | `common/updwriterights` |
| Change-rights | `CI1`–`CI8` | `CRO` (32-bit) | `common/updchangerights` |

Each slot is declared `AS1 r -> M ID NNM`, i.e. **the stored value is a member ID; the
form displays and accepts a nickname**, and the engine resolves nickname → ID on write.
That resolution step is exactly where the "ignored without notification" behavior lives.

### 1.3 Resolver semantics

From `chDBCheckRights` @`0x004510ae` via `ccgiaccess_check` @`0x0043a2d5`
(`re-artifacts/7.0/cgi/01-cgi-window-spec.md` §2.3), resolution order:

1. Resolve missing id/nick/role. **Unknown nickname ⇒ deny.**
2. `type==3` ⇒ grant all requested bits (superuser bypass).
3. Parse role string → 128-bit mask; force the baseline role bit on for
   member (bit 0) / visitor (bit 1) — every authenticated user carries an implicit baseline.
4. Public/"anyone" access-name ⇒ read-only (`neededBits & 4`).
5. Per-bit eval in `chdb_access_value` @`0x00451cc8`, which fetches the object's
   **41 rights attributes** in one `chDBMgetCached`. A bit is granted iff the actor
   **is `OWN`** (⇒ `|= 7`, i.e. owner+read+write implicitly), **occupies an `AS`/`CI`
   slot**, or the actor's **role mask intersects** `ORO`/`RRO`/`WRO` for that op.
6. `roleaccess%2x` exported per set role-bit so templates can gate on a specific job.
7. **Hierarchical change-rights (bit 8): if not granted at the object, recurse to the
   parent object.** A place owner thereby holds change-rights over every board, album
   and sub-object beneath it.
8. `CITY_OWN`/`CITY_WRITE` recurse against the CITY object for the citizen baseline.
   Exposes `isAdmin`/`isMember`/`isOwner`/`isVisitor`/`deleteaccess`.
9. **Chat rights = a second check with `neededBits=6`**: `&4` → `chataccess` +
   `chatreadaccess`; `&2` → `chatwriteaccess`.

**Admin override:** in the `*INS/*UPD/*DEL` mutation path, a failed rights check still
proceeds when the actor ∈ `g_Admins` or the `type==3` bypass holds, logging *"Gaining
access although user doesn't have sufficient rights at object!"*. The spec flags that
the exact override predicate inside `edit_docfg` was **not line-traced** — treat as
"admin or rights-disabled ⇒ force-allow-and-log" and re-verify before relying on the
audit trail. **I am not proposing CTR reproduce this override.**

This answers the brief's "permission inheritance by owner, job, leader, deputy, or
administrator" question directly: inheritance is **(a) implicit owner grant, (b) explicit
8-slot membership, (c) job/role bitmask intersection, (d) parent-object recursion for
change-rights only, (e) city-baseline recursion, (f) admin override.** Leader/Deputy are
not special-cased in the resolver — they are ordinary role bits in the 32-bit masks
(role IDs decoded in `re-artifacts/7.0/cgi/01-cgi-window-spec.md` §4: Block Leader=`30`,
Block Deputy=`42`, Neighborhood Leader=`20`, Deputy=`41`, District Leader=`10`, Deputy=`40`).

### 1.4 The `PRI` parameter

Archived URLs carry `PRI=P` for homes, `PRI=B` for blocks, `PRI=CL` for clubs. In the
4.0 templates `PRI` is threaded through every rights form as a hidden field and used by
`common/rights.tmpl` as `PRI=<$DTY>`. It names the **primary/parent data type** used for
the hierarchical recursion in step 7. `DTY=P` is 4.0's `Property` (a home);
`DTY=B` Block; `DTY=CL` Club; `DTY=I` the chat/info sub-object (§2.1).

### 1.5 Anti-CSRF

4.0 rights forms carry no ticket. 5.1/7.0 add `TKT` — a 16-hex token split into
`[memberId, timestamp]`, valid iff length `0x10`, embedded member-id == current
`g_MemberId` (`ticketerr003`), and timestamp within **28800 s / 8 h** (`ticketerr002`),
checked by `ccgi_TicketCheck` @`0x00414594` (§2.5). **This is a case where the later
version is the safer model; CTR's existing session/CSRF posture should not be relaxed
toward 4.0.**

---

## 2. Home Chat Access

### 2.1 Entry point and object identity — **the decisive result**

4.0's home Update Wizard, `install-4.0/csbin/community/templates/property/update.tmpl`,
renders six tiles. The sixth is:

```html
<a href="edit<$g_exe>?ac=read&DTY=I&KTY=ID&KEY=h<$ID>&PLC=cht
        &TPL=common/chatrights&ac=read&PRI=P">
<IMG SRC="<$g_HTMLRoot>/home/images/updright.jpg" ALT="Chat Access Rights">
<br><b>Chat Access Rights</b></a>
```

`common/chatrights.tmpl` is a two-row frameset:

```html
<frameset rows="140,*">
  <frame name="overview" src="place?ac=print&tpl=common/chatrightstop&DTY=&KTY=&KEY=&PRI=">
  <frame name="detail"   src="edit?ac=read&DTY=&KTY=&KEY=&cht=1
                              &TPL=common/updwriterights&PRI=">
</frameset>
```

and `common/chatrightstop.tmpl` offers exactly two tools plus a help link:
`common/updreadrights` (ALT "Chat Read Access") and `common/updwriterights`
(ALT "Chat Write Access", the frameset default).

**Therefore, proven from the RE code and corroborated by the archived production URLs
in §0:**

- Chat Access was **not** a separate tool. It was the **same generic 4-axis ACL system**,
  applied to a **different object**: data type `I`, key `"h" + <home/property ID>`.
  The home itself is `DTY=P` with key `<ID>`; its chat ACL is a distinct sibling record.
- Cybertown's "Home Chat Access" is specifically the **Write axis** (`WI1`–`WI8` + `WRO`)
  of that chat object, rendered by `common/updwriterights` with `cht=1`.
- A **Chat Read Access** axis (`RI1`–`RI8` + `RRO`) also existed and was reachable from
  the same top bar — archived: `...KEY=h0105050103020306&cht=1&TPL=common/updreadrights`.
- An **Owner Access for Chat** variant also existed (`updownerrights.tmpl` renders the
  heading "Update Owner Access ... for Chat" under `#ifdef cht`), but was only linked
  from the *place* owner-rights page and only when `isAdmin`.

So the answer to the brief's explicit question — separate tools, separate roles sharing
a form, modes of one system, or version-specific? — is: **different axes and a different
target object within one access-control system**, with the *form* shared and the *copy*
switched by the `cht` flag. It is not a version artifact; 4.0 is where all of it lives.

### 2.2 Why the Owner Access screenshot must not be transplanted

The supplied "Update Owner Access for Psychology" screenshot corresponds to
`common/updownerrights.tmpl` with `cht` **absent**, on a place object. Its own copy
states the scope:

> "Here you define citizens, who have full access to everything at this place, e.g.
> read the inbox, update the place, change access rights and delete things."

The chat write form's copy is materially narrower:

> "Here you define citizens, who are allowed to chat with you at this place."

They share the 8-slot shape because **every axis of the ACL record has 8 slots** (§1.2),
not because they are the same tool. The archived URL set confirms Owner Access was used
against `DTY=B` (blocks) and `DTY=CL` (clubs) with `PRI=B`/`PRI=CL`, while chat access
was used against `DTY=I&KEY=h…` with `PRI=P`. **Owner-access permissions must not be
assigned to Home Chat guests.** The brief's caution is correct and the code confirms it.

### 2.3 Exact form behavior — `common/updwriterights.tmpl` with `cht=1`

| Element | Original |
|---|---|
| Heading | `Update **Write Access** for **Chat**` (yellow `#FFFF00` on black) |
| Lead | "Here you define citizens, who are allowed to chat with you at this place." |
| Default rule | "If no nickname is defined and no job is checkmarked, usually all members are allowed to be active!" |
| Cap | "You can define **up to 8 citizens** with **write access**." |
| Fields | `WI1_NNM`…`WI8_NNM`, `MAXLENGTH=16 SIZE=16`, laid out **two rows of four** in a `<table border=0>` |
| Unknown names | "*Note: If a nickname does not exist, it is ignored without notification.*" (rendered `<small><i>`, "Note:" underlined) |
| Jobs | Per-role checkboxes `WRO_BIT_<n>`, 4 per row; "If you want to give write access to all citizens, simply checkmark only 'Members' — this includes ALL other jobs, but not visitors." |
| Buttons | `<input type=submit name="editrolem" value=Update>` and `<input type=submit name="read" value=Cancel>` |
| Success | `common/updateok.tmpl` → "Data successfully updated." in red + a back button (`history.go(-2)`) |
| Denied | `editerror003` → "Insufficient access rights." in red |
| Form target | `target="detail"` (posts back into the same frameset pane) |
| Owner field | **Absent.** Only `updownerrights` carries `OWN_NNM`. |

Two further mechanics worth recording:

- **Non-admin viewers see a locked view.** Where a slot resolves to a *group* (`CHK_G`)
  and the viewer is not `isAdmin`, the template prints the name as text instead of an
  input, and re-submits the type as a hidden field. Group-vs-Member radio buttons
  (`WI<n>TYP` = `G`/`M`) are rendered **only** for `isAdmin`.
- **The form always submits all eight slots.** There is no per-row delete; the submitted
  set is the complete authoritative list. Blanking a field clears the slot.

### 2.4 Storage and update semantics

Storage is 8 fixed member-ID columns on the ACL record plus one 32-bit role bitmask —
**not** a join table and **not** ordered. `*UPD` (`i_in2Update` @`0x0041f848`) writes the
attrs back and explicitly "handles BITMASK set/clear" (§2.2). Deletion is expressed as
writing an empty slot. Maximum is a hard structural 8. There is **no public endpoint that
lists another member's guest list** anywhere in the 4.0 template set — the list is only
ever rendered inside the rights editor, which is itself rights-gated.

### 2.5 CS 4.0 vs CS 5.1 vs CS 7.0

| | 4.0 | 5.1 | 7.0 |
|---|---|---|---|
| Chat ACL location | **Separate object** `DTY=I`, `KEY=h<homeID>` | Folded into the place's own ACL | Folded into the place's own ACL |
| UI | 4 separate templates + frameset, `cht=1` flag | One page `place/rights.html` | One page `place/rights*.html` |
| Chat wording | "Update Write Access for Chat" | "You can define an owner, owner deputies, and read and write access **for chat**." | same family |
| Change-rights axis | Own template (`updchangerights`) | Folded in as a checkbox mirroring `AS<n>` → `CI<n>` | same |
| Slot sizing | `MAXLENGTH=16 SIZE=16` | `maxlength=16 size=12` | same |
| Default when empty | "usually all members are allowed to be active" | Explicit: no read set ⇒ `RRO_BIT_0`+`RRO_BIT_1`; no write set ⇒ `WRO_BIT_1` (members write, visitors read) | same |
| CSRF | none | `TKT` | `TKT` |

5.1's `place/rights.html` is worth reading in full for one reason: it states the empty-set
default explicitly in code, whereas 4.0 only states it in prose. Both agree: **empty list
⇒ everyone may chat.**

### 2.6 Delta against current CTR

CTR's current implementation
(`api/src/services/home/home.service.ts:172-330`,
`spa/src/pages/home/HomeChatAccessPage.vue`) is behaviorally faithful on every point the
prior lane locked down — owner-only management, cap of 8, owner implicit and unstored,
unknown usernames ignored, blank/duplicate normalization, no public guest-list endpoint,
server-authoritative API + Socket.IO enforcement, visitors may still enter but not talk.
**None of that contradicts the RE evidence; all of it is confirmed by it.** Storage
differs (a `Home Chat Guest` scoped role assignment rather than 8 columns) — that is an
implementation choice, not a fidelity defect, and it is strictly better.

The gaps are presentational and one substantive omission:

| # | Item | Original | CTR now | Correction |
|---|---|---|---|---|
| C1 | Heading | "Update Write Access for Chat" | "Chat Access Rights" | Restore classic heading/subheading pair |
| C2 | Field layout | 8 fields, **two rows of four** | 8 fields, single vertical column | Two-row × four-column grid |
| C3 | Field sizing | `maxlength=16` | `maxlength=32`, `size=20` | Align to 16 (matches CTR's own login `NNM maxlength=16` seen in archived markup) |
| C4 | Unknown-name note | "If a nickname does not exist, it is ignored without notification." | Not stated | Add the note verbatim |
| C5 | Empty-list rule | "If no nickname is defined … all members are allowed" | Stated, differently worded | Keep CTR's clearer wording; it is accurate |
| C6 | Buttons | Update / Cancel | Save / Cancel | Rename to **Update** |
| C7 | **Job/role grants** | `WRO` 32-bit role bitmask — grant chat write to whole jobs | **Absent** | See below |

**C7 is the one real behavioral gap, and I recommend deferring it.** Granting chat access
by job is genuinely part of the original model, but it is a new authorization surface, it
interacts with the scoped-role work the previous lane just landed, and nothing in the
brief asks for it. Recommend: document it, do not build it in this PR, and revisit as its
own lane. Flagging rather than silently dropping it.

There is no evidence for or against a separate **Chat Read Access** in CTR. The original
had it (§2.1). CTR has no concept of "may see the chat but not speak," and adding one
would be a product decision, not a restoration defect. Recommend leaving it out and
recording it here.

---

## 3. Block Update Wizard and background selection

### 3.1 The original mechanism — traced end to end

Entry is gated on `owneraccess`
(`install-4.0/csbin/community/templates/block/action.tmpl:37-41`):

```html
<!-- #ifdef variable="owneraccess" -->
<a href="block<$g_exe>?ac=wizardplace&ID=<$ID>" target="place">
  <IMG SRC=".../images/buttons/bupdate.gif" ALT="Update"></a>
<!-- #endif variable="owneraccess" -->
```

`ac=wizardplace` → `block/wizard/place.tmpl`, a nested frameset:

```html
<frameset rows="255,*">
 <frameset cols="*,500,*">
  <frame name="dummy1" src="/blank.html">
  <frame name="presentation" src="block?ac=wizardpresent&ID=<$ID>">
  <frame name="dummy2" src="/blank.html">
 </frameset>
 <frame name="info" src="block?ac=wizardinfo&ID=<$ID>">
</frameset>
```

This is byte-for-byte the same frame geometry as the *public* block map,
`block/place.tmpl` (`rows="255,*"`, `cols="*,500,*"`, `ac=present` + `ac=mapinfo`).
**The wizard is the public map with checkboxes substituted for free lots.** That is the
original's own answer to "how do we keep the wizard and the map from drifting apart" —
they were the same layout by construction.

`ac=wizardpresent` → `block/wizard/present.tmpl`:

```html
<BODY BACKGROUND="<$g_HTMLRoot>/home/<$pathblock>block/<$imgblock>.gif" BGCOLOR="#000000" …>
<form name="postit" method=post action="<$selfurl>" target="place">
<input type=hidden name="ac" value="wizardpresentsubmit">
<input type=hidden name="ID" value="<$ID>">
<input type=hidden name="o0101" value="<$chk0101>">   … o0102 … o0612 (72 total)
<table width=480 height=240 border=0 cellpadding=0 cellspacing=0>
<tr>
  <td width=37 height=37 align=center>
    <!-- #ifdef variable="free0101" -->
      <input type="checkbox" align="middle" name="n0101" <$chk0101>>
    <!-- #endif variable="free0101" -->
    <!-- #ifdef variable="lock0101" -->
      <img src="…/block/<$img0101>.gif" width=37 height=37 border=0 ALT="<$name0101>">
    <!-- #endif variable="lock0101" -->
  </td>  <!-- position 1 -->
  … 12 cells per row, 6 rows …
```

**So the composition mechanism is settled, and it is none of the exotic options:**

- The candidate background is **not** a server-composed image.
- It is **not** a re-parameterized map template.
- It is a plain **HTML `<body background>` on the map page**, with a fully transparent
  `<table>` of 6 rows × 12 columns laid on top of it. Occupied lots render a 40×40
  transparent GIF house icon; free lots render a bare checkbox.

`ac=wizardinfo` → `block/wizard/info.tmpl` is the lower control frame:

> "Checkmark the **\<PNM\>** where you want members to settle down."
> `[Update]` (JS `parent.presentation.submitit()`) `[Cancel]` (→ `block?ac=place&ID=`)
> "Change the [background image](block?ac=wizardimage&ID=) for this **\<BNM\>**."

The two hidden-vs-checkbox field pairs are the update semantics: `oRRCC` carries the
**old** state and `nRRCC` the **new** state for every position, so the submit handler
diffs them rather than replacing wholesale.

### 3.2 Authoritative lot geometry — confirmed from production assets

The template writes `width=37 height=37` cells inside a `width=480 height=240` table,
which is internally inconsistent (12 × 37 = 444, not 480). The production art resolves it.
Measured directly from archived Cybertown assets in `wb-ct-scrape`:

| Asset | Path | Actual size |
|---|---|---|
| Block background | `html/home/0102000000000000/block/Pimg2D002.gif` | **480 × 240** |
| Block background | `worlds-raw/home/0104000000000000/block/Pimg2D001.gif` | **480 × 240** |
| House icon | `hi-tek-colony/block-neighbor-community-pages/Picon2D001.gif` | **40 × 40** |
| Free-lot icon | `hi-tek-colony/block-neighbor-community-pages/Ficon2D000.gif` | **40 × 40** |
| Hood background | `html/home/0101000000000000/neighbor/Pimg2D004.gif` | **540 × 300** |

480 / 40 = **12 columns**; 240 / 40 = **6 rows**; **72 lots**. The HTML-4 table stretched
the declared 37 px cells to fill 480 × 240, landing on 40 × 40 — which is exactly the
icon size. The `37` is vestigial.

**Consequence for the brief's "do not hardcode an approximate lot overlay":** the
authoritative lot coordinates *are* a uniform 12 × 6 grid of 40 × 40 cells over a
480 × 240 background. CTR's existing `BlockMapPage.vue` grid
(`spa/src/pages/block/BlockMapPage.vue:5-13` — `480px × 240px`, `grid-cols-12`,
`v-for index in 72`, `height:40px`) is **already the correct geometry**, arrived at
independently. It is not an approximation. The correction needed is not new coordinates —
it is that the background selector must **reuse this same renderer** instead of showing
bare thumbnails.

Position numbering: the original names positions `oRRCC` = row 01–06, column 01–12,
i.e. **row-major**. CTR's `location` 1…72 in a 12-column grid is row-major too, so
`location = (row - 1) * 12 + col`. Naming aligns without a mapping table.

Asset naming also matches: original `<$g_HTMLRoot>/home/<colonyID>/block/Pimg2D<NNN>.gif`,
`Picon2D<NNN>.gif`, `Ficon2D000.gif`; CTR uses
`/assets/img/map_themes/<theme>/block/` with the same filenames. Only the directory
keying changed (per-colony-ID → per-theme).

### 3.3 The background chooser — `ac=wizardimage`

`block/wizard/image.tmpl`, heading **"Multimedia Wizard - \<BNM\>"**:

```html
<form method=post action="block<$g_exe>" target="place">
<input type=hidden name="ac" value="wizardimagesubmit">
<input type=hidden name="ID" value="<$ID>">
<td valign=top><b>Choose a<br> background image</b></td>
<!--#for loopname="2dimages" loopvars="index2d" -->
  <input type="Radio" name="IM2" value="<$index2d>" <$chk2d>>
  <img src=".../home/<$path>block/<$prefix2d><$index2d>.gif"
       width=160 height=80 border=0 ALT="<$name2d>"><br>
<!--#endfor -->
<!-- #ifndef variable="index2d0" --> No images available! <!-- #endif -->
<input type=submit name="yes" value=Ok>
<input type=submit name="no" value=Cancel>
```

Error path: `wizarderror001` → "Data for \<PNM\> '\<NAM\>' could not be stored in the
database."

**Traced answers to the brief's Apply-versus-preview question:**

- The original had **no preview stage at all.** A radio selection plus `Ok` posted
  `ac=wizardimagesubmit` and persisted immediately; `Cancel` discarded.
- The original showed **160 × 80 thumbnails** (half scale) with **no house/lot overlay**.
  A leader could *not* see whether scenery landed under an occupied lot.
- The original had **no "Restore Default"** control. Index `000` was simply one of the
  radio options.
- Selecting a radio button mutated nothing; only `Ok` did. So "no persistence on
  selection" is original behavior, trivially.

This is the one place where the brief asks for something the original did not do. The
requested behavior — render the candidate background behind the live lot overlay, preview
before Apply — is a **deliberate improvement over the original**, not a restoration. It
is well-founded (the original's blind thumbnail picker is exactly the defect being fixed),
and it is achievable *using* the original's own mechanism, because the original's overlay
was already a transparent table over a swappable `<body background>`. Recommend building
it and labelling it in the PR as an intentional enhancement rather than a fidelity fix,
so the distinction survives in the history.

### 3.4 CS 4.0 vs 5.1 vs 7.0

**5.1 and 7.0 deleted the entire feature.** In both, `templates/block/` contains only
`hcheck`, `hlist`, `info`, `update` — no `wizard/` directory, no lot grid, no background
chooser. `block/update.html` (7.0; 5.1 equivalent) is a plain form: Name, Information
textarea, "Maximum Number of Homes", and a single 40 × 40 uploaded image. Blocks became
hierarchical ID-masked containers over a `Home` table (`*GET H ID <$ID> … MASK=????????????----`)
with an HTML list of homes and a "Settle Down" button
(`install-7.0/csbin/community/templates/block/info.html`).

So the 2D block map with positioned lots and swappable scenery backgrounds — the thing
Cybertown is remembered for — is **CS 4.0 behavior that Cybertown kept and blaxxun
abandoned.** There is no 5.1 or 7.0 evidence to reconcile because there is no 5.1 or 7.0
implementation.

### 3.5 Delta against current CTR

| # | Item | Original | CTR now | Correction |
|---|---|---|---|---|
| B1 | Overlay in chooser | none (blind thumbnails) | none (bare thumbnails, `PlaceMapBackgroundSelector.vue:31-56`) | **Enhancement:** render candidate behind the live 12×6 lot overlay |
| B2 | Renderer sharing | wizard and map were the same frameset by construction | two independent components; `BlockMapPage.vue` has the grid, the selector does not | Extract the grid into a shared component so they cannot drift |
| B3 | Occupied/free distinction | house icon vs checkbox | present in `BlockMapPage`, absent in selector | Selector must show occupied houses and free lots |
| B4 | Preview without persistence | n/a (no preview) | selection is already local-only; `submit()` only on Apply | Already correct — preserve |
| B5 | Restore Default | did not exist | exists | **Keep.** Modern addition, no fidelity conflict |
| B6 | Selected indication | radio `<$chk2d>` | `ring-2 ring-green-500` + radio | Already correct |
| B7 | Authorization | `#ifdef owneraccess` on the entry link only | `GET /block/:id/can_admin` on mount + server-side check on PUT | CTR is **stricter** than the original — preserve exactly, do not relax |
| B8 | Fallback | none | layered CSS `url(selected), url(default)` in `BlockMapPage.vue:103` | Keep; carry into the shared component |

Note on B7: the original gated only the *link*. `ac=wizardimagesubmit` itself relied on
the generic `*UPD` rights check. CTR's explicit route-level authorization is the correct
modern posture and PR #411's behavior must be preserved verbatim.

---

## 4. Place "Update Info"

### 4.1 Storage — one free-text attribute named `TXT`

Declared in 4.0 at `install-4.0/csbin/community/templates/place/updateinfo.cfg`:

```
ID	r
NAM r
TXT	rw
```

Three attributes; exactly one writable. The same `TXT` attribute appears on every place
family — `block/info.tmpl`, `neighbor/info.tmpl`, `property/updateinfo.cfg`,
and in 5.1/7.0 `place/updateinfo.cfg`, `block/update.cfg`, `home/update.cfg`. It is a
**single attribute on the place record**, not a separate table, not a markup-typed field,
and not versioned.

The home/property variant carries more: `property/updateinfo.cfg` declares `TXT rw` plus
five link pairs `LL0`–`LL4` (labels) and `LD0`–`LD4` (destinations) — the classic "my
links" block. 5.1's `home/update.cfg` writes the same set in one `*UPD`. **Places got
`TXT` only; homes got `TXT` + 5 links.**

### 4.2 The editor and its permission check

4.0 entry, from `place/updateinfo.tmpl`, reached via `edit<$g_exe>` with
`DTY=<$DTY>&KTY=<$KTY>&KEY=<$KEY>&TPL=place/updateinfo&ac=read`. The form is minimal:

```html
<p align=center><b>Update the Information for <$NAM></b></p>
<font color=#ff0000>
<!-- #ifdef variable="editerror003" --> Insufficient access rights. <!-- #endif -->
</font>
<form method=post action="<$selfurl>" target="place">
<h3>Information<br>
<textarea name="TXT" cols="50" rows="12"><$TXT></textarea></h3>
<input type=hidden name="DTY" …><input type=hidden name="KTY" …>
<input type=hidden name="KEY" …>
<input type=hidden name="TPL" value="place/updateinfo">
<input type=submit name="edit" value=Update>
```

The permission check is **not** in the template — it is the generic `*UPD` rights check
of §1.3, surfaced as `editerror003` → "Insufficient access rights." The write bit
required is owner (`0x1`) via `i_in2Update`; the entry link in the surrounding place UI
is gated on `owneraccess` (see `block/action.tmpl` above, and 7.0's `block/info.html`
which gates `btnadm_edit.gif` on `#ifdef owneraccess`).

**So: Owner Access did implicitly grant Update Info rights.** That is the brief's
question answered directly — anyone in `OWN`, any `AS1`–`AS8` slot, or any job whose bit
is set in `ORO` could edit the place information. There was no separate "may edit info"
right.

For blocks and neighborhoods the practical effect is that the **Block Leader / Neighborhood
Leader** job bit set in `ORO` is what granted the tool, with **Deputies** granted the same
way when their bit was set — they are ordinary role bits (§1.3 step 5), not a distinct tier.

### 4.3 Rendering location — above Leader and Deputies, confirmed

`install-4.0/csbin/community/templates/block/info.tmpl`:

```html
<H3 align=center>Welcome to the <$BNM> '<$NAM>'</H3>
<p>
<$TXT>
</p>
<!-- #include virtual="<$g_Templates>common/inforoles.tmpl" -->
```

`install-4.0/csbin/community/templates/neighbor/info.tmpl`:

```html
<H3 align=center>Welcome to the <$ENM> '<$NAM>'.</H3>
<p>
<!-- #ifdef variable="TXT" --> <$TXT> <!-- #endif -->
<!-- #ifndef variable="TXT" --> Welcome to the <$ENM> '<$NAM>' ... <!-- #endif -->
</p>
<!-- #include virtual="<$g_Templates>common/inforoles.tmpl" -->
<br>
<b><$BNM>:</b>
… [List] <$BNM> Leaders   … [List] <$BNM> Deputies …
```

`common/inforoles.tmpl` renders `Owner:` then `Assistant:` (`ASR1`–`ASR8`), each linking
to `/home/<nick>`, with the empty-state strings "no owner defined" / "no assistant
defined". The neighborhood template then renders the **Leaders** and **Deputies** list
buttons (`ROLNAM` 14 and 15) *below* that.

So the exact order is: **heading → `TXT` → Owner/Assistants → Leaders → Deputies.** The
brief's description ("above Leader and Deputies") is confirmed, with the added detail that
Owner/Assistants also sit between them. Empty `TXT` on a neighborhood falls back to a
generated "Welcome to the …" line; on a block it renders an empty paragraph.

### 4.4 Markup format — **raw, unescaped HTML**

`<$TXT>` is substituted directly into the page body by the SSI printer
(`ghsPrintTemplateRec`, §2.1) with no escaping and no filtering step anywhere in the
`.cfg` DSL or the template. Stored as typed; rendered as HTML. **Not BBCode, not a
restricted subset, not escaped plain text.**

Corroborating evidence that this was intentional and used: the field is edited in a
`cols=50 rows=12` textarea (a plain-text control — no editor), and `neighbor/info.tmpl`
wraps it in `<p>…</p>` expecting the author to supply their own inline markup. The 5.1/7.0
successors keep exactly the same shape (`textarea name="TXT" cols="32" rows="8"
wrap=physical`) with no sanitizer introduced.

I found **no** allowlist, escaping routine, or tag filter for `TXT` in any of 4.0, 5.1
or 7.0. The bad-word filter that does exist (`mdserver` + `mdwords.cfg`, per
`FEATURE-MAP.md`) is a chat-moderation path, not an HTML sanitizer, and is not wired to
`TXT`.

**This is a stored-XSS design and must not be reproduced.** The brief already says so;
the evidence confirms there is nothing subtler to preserve — the original simply had no
filtering layer to model.

### 4.5 Which place types had it

| Place type | 4.0 evidence | Had `TXT` editor |
|---|---|---|
| Block | `block/info.tmpl` renders `<$TXT>`; `block/action.tmpl` gates Update on `owneraccess` | Yes |
| Neighborhood | `neighbor/info.tmpl` renders `<$TXT>` with fallback | Yes |
| Generic place (`place.exe`) | `place/updateinfo.cfg` + `.tmpl`, `DTY` passed in | Yes |
| Home / property | `property/updateinfo.cfg` — `TXT` **+ `LL0`–`LL4` / `LD0`–`LD4`** | Yes, extended |
| Club | 7.0 `place/rights-c.cfg` (`DTY=CL`) exists; archived Cybertown club rights URLs exist | Rights yes; `TXT` editor not separately evidenced in 4.0 |
| Shop / fleamarket / hall / mayor | 7.0-only template dirs; no 4.0 equivalents | Not evidenced for the 4.0 lineage Cybertown ran |

`place/updateinfo` takes `DTY` as a **parameter**, so the same editor served whatever place
type the caller passed. There is no per-type branching in the template. Differences between
place types are therefore **not** in the editor — they are in (a) whether the surrounding
place UI linked to it, and (b) what the type's `info` template did with `TXT`. I did not
find a 4.0 shop/club `info` template that renders `TXT`, so I am **not** claiming those had
it; that remains open.

### 4.6 CS 4.0 vs 5.1 vs 7.0

| | 4.0 | 5.1 / 7.0 |
|---|---|---|
| Editor | `place/updateinfo.tmpl`, `TXT` only | `place/updateinfo.html`: `NAM` + `TXT` + auditorium `CHT` flags + `SPW` stage password |
| Block editor | via generic place editor | dedicated `block/update.html`: `NAM`, `TXT`, `MHO` (max homes), image upload |
| Textarea | `cols=50 rows=12` | `cols=32 rows=8 wrap=physical` |
| Escaping | none | none |
| CSRF | none | `TKT` |
| Post-save | inline "Data successfully updated." | JS `setTimeout` redirect back to the info window after 1800–2000 ms |
| Activity log | none | `*LOG AL M<$MEM_ID>bu` / `*LOG AL P<$DID>…bu` (7.0) |

### 4.7 Delta against current CTR

CTR **already has the storage field**: `place.description`, written by
`HomeService.updateHomeInformation` / read by `getHomeInformation`
(`api/src/services/home/home.service.ts:485-521`), with
`INFORMATION_MAX_LENGTH = 1000`, banned-word checking in
`api/src/controllers/home.controller.ts:131`, and a UI at
`spa/src/pages/home/HomeUpdateInformationPage.vue`. That is the home case, shipped in
the previous lane.

**What is missing is the place case.** There is no "Update Info" tool for blocks,
neighborhoods or staffed places, and `BlockPage.vue` / `NeighborhoodPage.vue` render no
description at all. Restoring it means:

1. Reuse `place.description` — the column exists; no migration needed for blocks/hoods
   if they are `place` rows (verify before implementing).
2. Gate the editor on the **existing scoped place authorization** (the `can_admin` path
   PR #411 established), which is the faithful analogue of `owneraccess`.
3. Render it **between the place heading and the Leader/Deputy listing**, matching §4.3.
4. **Do not** store or render raw HTML. CTR already has a proven sanitizer pattern —
   `sanitize-html` with a 75-tag allowlist, `disallowedTagsMode: 'discard'`, no `style`,
   no `class`, no `script`, no event attributes — used by `MessageboardService.sanitize()`
   and `InboxService.sanitize()` (documented in
   `~/Projects/cybertown/CTR-HTML-RULES-FINDINGS.md`, 2026-07-25). Reusing that exact
   allowlist gives the closest achievable match to "raw HTML" while preserving the
   security boundary, and keeps one sanitizer policy across the app rather than inventing
   a third.
5. Note the rendering-side risk: message-board and inbox bodies are rendered with Vue
   `v-html`. If place info follows that pattern it inherits the same trust assumption, so
   the sanitizer must be applied **on write** (as the existing services do) and the
   allowlist must not be widened for this feature.

**Open item I am not resolving here:** whether the 5-link block (`LL0`–`LL4` / `LD0`–`LD4`)
should also be restored for homes. It is clearly evidenced (§4.1) and clearly classic, but
it is out of the brief's scope and adds a second user-supplied URL surface. Recorded, not
proposed.

---

## 5. Consolidated evidence matrix

| Feature | Original URL / template | CS 4.0 evidence | CS 5.1 evidence | CS 7.0 evidence | Wayback evidence | Permission model | Storage | UI | Current CTR | Required correction | Security to retain |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Home Chat Access** | `edit?ac=read&DTY=I&KTY=ID&KEY=h<homeID>&cht=1&TPL=common/updwriterights&PRI=P` | `templates/common/updwriterights.{cfg,tmpl}`, `chatrights.tmpl`, `chatrightstop.tmpl`, `property/update.tmpl` | Folded into `place/rights.html` (single page, "read and write access for chat") | Same as 5.1 (`place/rights-h.cfg`) | CDX: `…KEY=h0103040201020105&cht=1&TPL=common/updwriterights&PRI=P` (+ `updreadrights` variant) | Write bit `0x2` on chat object; owner implicit (`OWN` ⇒ `|=7`); `WI1`–`WI8` slots; `WRO` role bitmask; unknown nick ⇒ deny/ignore | 8 member-ID columns + 1×32-bit mask on `DTY=I` record keyed `h<homeID>` | 8 fields in 2 rows × 4 cols, `maxlength=16`, Update/Cancel, "ignored without notification" note, job checkbox matrix | `Home Chat Guest` scoped role, cap 8, owner implicit, unknown ignored, no public list, socket-enforced | Classic heading, 2×4 grid, `maxlength=16`, add the note, rename Save→Update. **Defer job-based grants (C7).** | Server-authoritative API + Socket.IO enforcement; private guest list; no public endpoint; owner-only management |
| **Block background / lots** | `block?ac=wizardplace` → `ac=wizardpresent` + `ac=wizardinfo`; chooser `block?ac=wizardimage` → `ac=wizardimagesubmit` | `templates/block/wizard/{place,present,info,image}.tmpl`; `block/action.tmpl:37` `#ifdef owneraccess` | **Feature absent** — `templates/block/` = hcheck/hlist/info/update only | **Feature absent**; blocks are ID-masked `Home` containers with a text list | CDX + files: `html/cgi-bin/cybertown/block/ac=wizardpresent/ID=*.html`, `ac=wizardinfo`, `ac=wizardplace` (captures are login walls) | Entry gated `#ifdef owneraccess`; submit relies on generic `*UPD` check | `IM2` background index on the block record; per-lot occupancy on the property records; `oRRCC`/`nRRCC` old-vs-new diff | `<body background>` 480×240 + transparent `<table>` 6 rows × 12 cols; occupied = 40×40 icon, free = checkbox; chooser = 160×80 radio thumbnails, Ok/Cancel, **no preview, no Restore Default** | Correct geometry in `BlockMapPage.vue`; selector shows bare thumbnails with no overlay | Extract shared 12×6 renderer; render candidate background behind live occupied/free overlay; keep local-only preview; keep Restore Default (modern) | PR #411 authorization (`can_admin` + server-side PUT check) and persistence — **stricter than original, do not relax** |
| **Place Update Info** | `edit?DTY=<type>&KTY=ID&KEY=<id>&TPL=place/updateinfo&ac=read` | `templates/place/updateinfo.{cfg,tmpl}`; rendered by `block/info.tmpl`, `neighbor/info.tmpl` above `common/inforoles.tmpl` | `place/updateinfo.html` + dedicated `block/update.html` (adds `MHO`, image, `TKT`) | Same as 5.1 + `*LOG` activity log | Not directly captured (admin pages are login walls); place-type lineage confirmed via the 4.0-only `common/updownerrights` URLs | Generic `*UPD` owner bit `0x1`; **Owner Access implicitly granted it**; Leader/Deputy are ordinary `ORO` role bits; failure ⇒ `editerror003` | Single `TXT` attribute on the place record (homes additionally `LL0`–`LL4`, `LD0`–`LD4`) | `<textarea name="TXT" cols=50 rows=12>`, single `Update` submit; rendered **raw/unescaped** between heading and Owner/Assistants/Leaders/Deputies | `place.description` exists and is wired for **homes only**; no block/hood/place editor or display | Add place-scoped editor + display in the classic position, reusing `place.description` and the existing `can_admin` gate | **Do not** reproduce raw HTML. Reuse the existing `sanitize-html` allowlist (`disallowedTagsMode: 'discard'`, no `style`/`class`/`script`/event attrs), sanitize on write, do not widen the allowlist |

---

## 6. What is proven, what is inferred, what is open

**Proven from RE source + Wayback:**
- Cybertown ran the CS 4.0-lineage CGI/template layer (§0).
- Home Chat Access is the Write axis of a separate ACL object `DTY=I`, `KEY=h<homeID>`,
  not the Owner Access tool (§2.1, archived URLs).
- Chat Read Access also existed (§2.1, archived URL).
- Block background = `<body background>` + transparent 6×12 table; no server compositing,
  no preview, no Restore Default (§3.1, §3.3).
- Authoritative lot geometry is 12 × 6 cells of 40 × 40 over 480 × 240, row-major,
  confirmed by measured production GIFs (§3.2).
- Place Update Info is one `TXT` attribute, rendered raw, above Owner/Assistants/Leaders/
  Deputies, gated by Owner Access (§4.1–§4.4).
- 5.1 and 7.0 deleted the block wizard entirely and merged chat rights into the place ACL
  (§2.5, §3.4).

**Inferred (stated as such):**
- The `width=37` cells rendering at 40 px — arithmetic from table width plus icon size,
  not observed in a captured page.
- The 7.0 rights decompile applying to 5.1 — same engine generation and template family,
  but the decompile itself was run on 7.0 binaries.

**Open / not resolved:**
- Whether shops and clubs rendered `TXT` in their info pages under the 4.0 lineage (§4.5).
- The exact admin-override predicate inside `edit_docfg` (§1.3) — flagged as un-line-traced
  by the existing spec; not needed for this work.
- Whether to restore job/role-based chat grants (C7) and the home 5-link block (§4.7) —
  both evidenced, both out of scope, both recorded rather than dropped.

---

## 7. Recommended PR shape (for review, not yet built)

One PR, `fix/classic-place-admin-fidelity`, with scoped commits:

1. `refactor: extract the shared block lot-map renderer` — pull the 12×6 / 40 px grid out
   of `BlockMapPage.vue` into a component both the map and the background selector consume
   (addresses B2, prevents drift).
2. `feat: preview candidate block backgrounds behind the live lot overlay` — B1/B3;
   local-only until Apply; keep Restore Default and PR #411 authorization untouched.
3. `fix: restore the classic Home Chat Access presentation` — C1–C6; **no backend change**,
   the existing server-authoritative enforcement is already correct.
4. `feat: staff-managed place information` — §4.7 items 1–5, sanitized on write via the
   existing allowlist.

Validation per the brief: targeted automated tests plus playwright-cli against empty /
partly occupied / heavily occupied blocks, every available background, preview-without-
persistence, Apply, Restore Default, and direct-route authorization; and for chat access,
classic layout at desktop and current CTR width, eight fields, owner omission, unknown-name
behavior, Update/Cancel, with the existing API and Socket.IO enforcement suites still green.

No deployment until Ryan reviews this report and the implementation plan.

---

CLASSIC PLACE ADMIN RE BEHAVIOR TRACED
