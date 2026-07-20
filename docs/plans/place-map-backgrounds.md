# Restore Block and Neighborhood Map Background Management

## Status

Planned follow-up lane. Keep independent from PR #410 and the home-image moderation work.

Suggested implementation branch when work begins:

```text
upstream/place-map-backgrounds
```

Start from the latest upstream `master`, not from `home-image-upload`.

## Problem

The Block Update Wizard still contains a literal legacy template link:

```html
<a href="block<$g_exe>?ac=wizardimage&ID=<$ID>">
```

In the modern SPA, those original server-template tokens are never expanded. The browser percent-encodes them and navigates to a broken URL such as:

```text
https://www.cybertownrevival.com/block%3C$g_exe%3E?ac=wizardimage&ID=%3C$ID%3E
```

This is not only a bad hyperlink. It points to a historically supported Cybertown feature that has not yet been restored: authorized staff could change block and neighborhood map backgrounds.

Current CTR map pages still use colony-theme defaults directly (`Pimg2D000.gif`). The `Place` model already contains suggestive fields including `map_background_icon` and `map_icon_index`, but their historical meanings must be verified before reuse.

## Phase 1 — Recover the historical contract

Inspect the reverse-engineered server and the Wayback scrape as read-only evidence.

Search for:

```text
wizardimage
ac=wizardimage
Pimg2D
Picon2D
map_background_icon
map_icon_index
background image
block templates
neighborhood templates
hood templates
```

Use the reverse-engineered material to recover server behavior and authorization. Use `wb-ct-scrape` to recover Cybertown's actual rendered forms, assets, wording, and customization differences.

Before implementation, document:

- Whether the feature uploaded arbitrary images, selected predefined themes, or supported both
- Exact block background dimensions
- Exact neighborhood background dimensions
- Accepted formats and historical size limits
- Historical meaning of `map_background_icon`
- Historical meaning of `map_icon_index`
- Authorization hierarchy
- Reset-to-default behavior
- Historical file naming and storage rules
- Whether custom images replaced `Pimg2D000.gif` or were stored per place
- Whether original custom backgrounds survive in the scrape

Likely dimensions from current layouts, to be verified rather than assumed:

- Block map: `480 x 240`
- Neighborhood map: `540 x 300`

## Phase 2 — Modern CTR implementation

### Data model

Prefer a clear nullable place-level custom-background reference usable by both blocks and neighborhoods, plus a revision/version value for cache invalidation if needed.

Do not repurpose `map_background_icon` unless historical research proves that is its intended meaning.

### Storage and image handling

- Server-derived filenames only
- Numeric place IDs
- Decode and normalize with `sharp`
- Strict file-size and pixel-dimension limits
- Atomic temporary-file replacement
- No client-controlled filesystem paths
- Runtime uploads excluded from Git
- Versioned public URL or equivalent cache invalidation

Possible structure:

```text
/assets/map-backgrounds/block/<placeId>-<revision>.webp
/assets/map-backgrounds/hood/<placeId>-<revision>.webp
```

These are authorized place-management images and should not reuse the homeowner moderation queue unless historical or product requirements specifically demand moderation.

### API

Potential shape:

```text
GET    /api/block/:id/map-background
POST   /api/block/:id/map-background
DELETE /api/block/:id/map-background

GET    /api/hood/:id/map-background
POST   /api/hood/:id/map-background
DELETE /api/hood/:id/map-background
```

Authorization must be place-specific:

- Blocks: established `BlockService.canAdmin(blockId, memberId)` hierarchy
- Neighborhoods: established hood/neighborhood administration path
- Global administrator override only through existing authorization rules

Do not authorize changes merely through broad `canStaff` membership.

### UI

Replace the dead legacy link in `BlockWizardPage.vue` with a real Vue route/action.

The management UI should provide:

- Current background preview
- Upload or historical-theme selection, based on research
- Apply/update action
- Reset to colony default
- Validation messages
- Busy state preventing duplicate submission
- Clear dimensions and format requirements

Add equivalent access through Neighborhood Tools for authorized neighborhood staff.

### Rendering fallback

Update the relevant map pages so background resolution is:

```text
place-specific custom background
        -> colony map-theme default Pimg2D000.gif
```

At minimum inspect or update:

- `spa/src/pages/block/BlockWizardPage.vue`
- `spa/src/pages/block/BlockMapPage.vue`
- `spa/src/pages/neighborhood/NeighborhoodMapPage.vue`

Missing or failed custom files must safely fall back to the colony default.

## Phase 3 — QA

### Authorization matrix

Verify:

- Correct Block Leader
- Block Deputy
- Correct Neighborhood Leader/Deputy
- Supported hierarchical superior
- Global administrator
- Unrelated staff member
- Ordinary citizen
- Unauthenticated request

Direct API calls against another block or neighborhood must fail even when the UI link is hidden.

### Image validation

Test:

- Correct image
- Wrong dimensions
- Invalid image bytes
- Oversized file
- Unsupported format
- Animated input
- Transparent input
- Very large decompression dimensions
- Duplicate submission
- Replacement
- Reset to default

### Behavior

Verify:

- Wizard preview updates
- Public block map updates
- Public neighborhood map updates
- Cache invalidation works
- Failed replacement leaves the prior image intact
- Old-file cleanup cannot delete the active revision
- Theme fallback remains functional
- Plot and block links remain clickable over the background
- Existing home `map_icon_index` behavior is unchanged

Use the established `agy` browser-QA workflow for screenshots and UI verification.

## PR exclusions

Do not include:

- Home-image moderation changes
- CodeRabbit or agent skill files
- General reverse-engineering documentation
- Wayback scrape contents
- Historical server binaries
- Bulk recovered assets without separate review

## Recommended order

1. Finish and push the cleaned PR #410 revision.
2. Allow the existing PRs to complete review.
3. Branch `upstream/place-map-backgrounds` from current upstream `master`.
4. Complete the reverse-engineering and Wayback evidence pass.
5. Review the recovered historical contract.
6. Implement block and neighborhood support together as one coherent feature PR.
