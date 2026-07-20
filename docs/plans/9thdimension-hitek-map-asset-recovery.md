# 9th Dimension and Hi-Tek Map Asset Recovery — Findings

## Status

Research complete. No runtime theme changes made as a result of this pass — see decisions below.

## Method

Searched, as read-only archival evidence (no files copied into this repo, no binaries bundled into
this PR — consistent with the exclusions in `docs/plans/place-map-backgrounds.md` on the
`planning/place-map-backgrounds` branch):

- `campuscolony/ctgit-archive-master` — the actual on-disk source of the reverse-engineered
  `colony_maps/` and `page_templates/` trees referenced below.
- `wb-ct-scrape` — independent Wayback Machine capture of the live site, used to cross-verify
  every finding against a second, unrelated source.
- `blaxxun-cs-RE`, `blaxxun-cs-RE-graph-vault` — reverse-engineered server/protocol internals;
  searched but did not contain colony-specific asset directories.

Historical colony IDs: 9th Dimension = `0107000000000000`, Hi-Tek = `0110000000000000`.

## 9th Dimension — no change needed

`colony_maps/0107000000000000/block/Pimg2D000-004.gif`, `.../block/Picon2D*.gif`,
`.../block/Ficon2D000.gif`, and `.../neighbor/Pimg2D000-002.gif` are **byte-for-byte identical**
(SHA-256 match) to the runtime `spa/assets/img/map_themes/desert/block/` and `desert/hood/` assets
already shipped in this repo, confirmed against two independent archive sources.

The current `9thdimension → desert` theme mapping already *is* this colony's authentic historical
art. No integration work is needed or was performed.

One side note for future reference, not actionable now: the same colony ID (`0107000000000000`)
was previously branded "Morning Star" (`page_templates/community/present_morningstar
(unused-old).tmpl`, and `community.jpg` under that ID still reads "MORNING STAR"). The block/hood
map assets carried over through the rename and remain correct for 9th Dimension; only the
colony-level overview image (`community.jpg`, a different, out-of-scope subsystem from block/hood
map backgrounds) still shows the old branding.

## Hi-Tek — partial find, not integrated

Recovered and cross-verified against two independent sources:

- **Hood/neighborhood background** (`colony_maps/0110000000000000/neighbor/Pimg2D000.gif` and
  `Pimg2D008.gif`, 540×300, distinct circuit-board/PCB-grid artwork) — complete, authentic,
  confirmed not present in the current `grass` theme (zero hash overlap).
- **Block-level lot icons** (`colony_maps/0110000000000000/block/Picon2D*.gif`,
  `Ficon2D000.gif`) — complete, authentic, also not reflected in `grass`.
- **Block-level map background** (`colony_maps/0110000000000000/block/Pimg2D*.gif`) — **confirmed
  absent** in both the reverse-engineered server archive and the independent Wayback capture.
  This does not look like a preservation gap; the block-level background slot for Hi-Tek appears
  to have never been populated historically.

Because the block-level background is genuinely missing, a "Hi-Tek" runtime theme would be
incomplete — the hood level would show authentic Hi-Tek art while the block level would need to
silently fall back to a generic image, which the recovery spec for this work explicitly calls out
as something not to do without documenting the limitation. Given the added surface (new theme
directory, synchronized API/SPA theme-map changes, new tests, a fresh browser-QA pass) versus the
value of an admittedly incomplete result, this pass leaves `hitek_col → grass` unchanged and
records the find here for a future session that wants to pursue a hood-only partial integration
explicitly.

Also inventoried, not integrated: Hi-Tek's legacy "control panel" (`page_templates/hi-tek/control.tmpl`,
`action_hi-tek*.tmpl` across neighbor/block/community/property levels). This is a materially
different, broader admin-panel UI than map-background selection. The panel's *layout and button
set* are well documented by the surviving templates, but none of the referenced skin/button
binaries (`images/hi-tekcontx.gif`, `places/hi-tek/images/buttons/*.gif`) survive in either
archive searched. Not in scope for this feature; noted for a possible separate follow-up.

## Recovery leads for a future session

- Hi-Tek block background: no further leads found; likely never existed. Would need a third,
  currently unidentified source to overturn this.
- `images/hi-tekcontx.gif` and the `places/hi-tek/images/buttons/*` binaries: referenced by
  multiple template variants but absent from both archives searched. A targeted Wayback CDX query
  for these exact literal paths (not yet attempted) is the strongest remaining lead.
- 9th Dimension's `icon.jpg`/`icon2.jpg`/`icon3.jpg` (colony-list thumbnails, inferred role only)
  — no template was found in this pass that explicitly renders them; a future session could grep
  `page_templates/` for a colony-gallery template to confirm.
