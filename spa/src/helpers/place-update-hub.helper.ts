/**
 * Where each scoped place-administration capability belongs, and the tile
 * catalogue for the ones that belong inside the Update hub.
 *
 * TWO SEPARATE QUESTIONS. Holding a capability says the server would honour the
 * action. It does NOT say the action belongs on the Update page. The original
 * drew that line and CTR keeps it: blaxxun CS 4.0's place action bars carried
 * Group Message and Access Rights as PERMANENT buttons
 * (templates/{community,neighbor,block}/action.tmpl), while the Update button
 * beside them opened a wizard whose own screens were a different, smaller set -
 * info, the child map, and the background (`strings neighbor.exe | grep wizard`
 * -> wizardinfo, wizardpresent, wizardimage, wizardplace, wizardsubmit).
 * Reproducing every capability as a tile would have invented an umbrella screen
 * the original never had.
 *
 * So CAPABILITY_PLACEMENT below is the authority on WHERE, and HUB_TILES holds
 * only the capabilities placed in the hub. A capability placed anywhere else has
 * no tile, deliberately, and place-update-hub.test asserts it stays that way.
 *
 * Entries are DATA, not callbacks: a tile names its route per tier and which
 * route parameter carries the place id, and the hub builds the target. That keeps
 * the catalogue readable as a table and lets a test assert every tier of every
 * tile resolves somewhere without rendering anything.
 *
 * A tile appears if and only if the SERVER returned its capability from
 * `GET /place/:placeId/update-hub`. Nothing here decides authorization - every
 * route and endpoint a tile points at is independently authorized, and a hidden
 * tile is never the access control.
 *
 * Every entry is documented in docs/research/classic-update-hierarchy-matrix.md
 * section 6. `origin` records whether the tool restores original Cybertown
 * behavior or is a modern composition, so a later reader does not mistake one for
 * the other.
 */

export type HubPlaceType = "colony" | "hood" | "block";

export type UpdateCapability =
  | "update_information"
  | "manage_access_rights"
  | "message_to_all"
  | "inbox_to_all"
  | "moderate_messageboard"
  | "moderate_inbox"
  | "check_images"
  | "manage_lots"
  | "manage_background"
  | "list_neighborhoods"
  | "list_blocks";

/**
 * Where a capability's control lives.
 *
 * - `toolbar`         - the permanent place tool bar, in its original position.
 * - `hub`             - inside the scoped Update hub.
 * - `moderation-page` - a dedicated moderation surface reached on its own; the
 *                       capability is real, but it is not an Update Wizard
 *                       function and must not be dressed as one.
 *
 * A fourth category exists in the docs but not in this type: structural actions
 * unavailable in CTR (colony map editing, block creation/withdrawal). Those have
 * no capability at all, so there is nothing here to place - see
 * docs/research/classic-update-hierarchy-matrix.md sections 6.4 and 6.6.
 */
export type CapabilityPlacement = "toolbar" | "hub" | "moderation-page";

export interface CapabilityPlacementEntry {
  placement: CapabilityPlacement;
  /** The surface that owns this control, named for a human reading a diff. */
  where: string;
}

export const CAPABILITY_PLACEMENT: Record<
  UpdateCapability,
  CapabilityPlacementEntry
> = {
  // --- inside the Update hub ------------------------------------------------
  update_information: {
    placement: "hub",
    where: "Update hub - CS 4.0 wizardinfo",
  },
  manage_lots: {
    placement: "hub",
    where: "Update hub - CS 4.0 block wizardpresent",
  },
  manage_background: {
    placement: "hub",
    where: "Update hub - CS 4.0 wizardimage",
  },
  list_neighborhoods: {
    placement: "hub",
    where: "Update hub - read-only navigation list",
  },
  list_blocks: {
    placement: "hub",
    where: "Update hub - read-only navigation list",
  },

  // --- permanent tool bar, in their original positions ----------------------
  // These were never wizard screens. Duplicating them as tiles would put the
  // same action in two places and make the hub look like an umbrella menu.
  message_to_all: {
    placement: "toolbar",
    where: "place tool bar - CS 4.0 Group Message (bgroupmesa.gif)",
  },
  inbox_to_all: {
    placement: "toolbar",
    where: "place tool bar - beside Message to All",
  },
  manage_access_rights: {
    placement: "toolbar",
    where: "place tool bar - CS 4.0 Access Rights (baccess.gif, #ifdef rightsaccess)",
  },
  check_images: {
    placement: "toolbar",
    where: "block tool bar - CS 4.0 block/action.tmpl third owner tool (TPL=block/plist)",
  },

  // --- their own moderation surfaces ---------------------------------------
  // Real capabilities, reached through the Messages and Inbox windows the tool
  // bar already opens. They are message-board and inbox moderation - NOT chat
  // moderation, and they must never be relabelled as such.
  moderate_messageboard: {
    placement: "moderation-page",
    where: "the place's Messages window",
  },
  moderate_inbox: {
    placement: "moderation-page",
    where: "the place's Inbox window",
  },
};

export interface HubContext {
  placeId: number;
  type: HubPlaceType;
  slug: string | null;
}

export interface HubTile {
  /** Stable key, matching the server capability. Used for :key and for tests. */
  key: UpdateCapability;
  label: string;
  /**
   * Tile art, from the classic Update Wizard set the home Update page already
   * uses (assets/img/homes/upd*.jpg - the originals recovered in updall.gif).
   * Places reuse that vocabulary rather than inventing a second one, so a Place
   * Update page reads as the same screen as Update your Home.
   */
  image: string;
  /** One line shown under the label. Says what the tool does, not who may use it. */
  description: string;
  /** Place types this tile can appear on at all. */
  types: HubPlaceType[];
  /**
   * "route" navigates in-app; "window" opens the classic popup, matching how the
   * existing Tools components already open Information, Inbox and Messages.
   */
  kind: "route" | "window";
  /** Route name per place type. Present when kind === "route". */
  routeNames?: Partial<Record<HubPlaceType, string>>;
  /**
   * Which route parameter carries the place id, when the target route needs one.
   * Omitted for routes that reuse the current URL's parameters unchanged.
   */
  paramKey?: "id" | "placeId";
  /** Hash target with `{placeId}` substituted. Present when kind === "window". */
  hrefTemplate?: string;
  /**
   * "classic" - restores a tool the original Cybertown/CS 4.0 place administration
   * actually had. "modern" - a CTR addition with no CS 4.0 counterpart.
   */
  origin: "classic" | "modern";
}

/**
 * The Update Wizard's own screens, and nothing else.
 *
 * This list is short on purpose. CS 4.0's neighborhood and block wizards had
 * exactly three: the information form, the child map, and the background picker.
 * Everything a place administrator could also do lived on the permanent action
 * bar beside the Update button, and still does.
 */
export const HUB_TILES: HubTile[] = [
  {
    key: "update_information",
    image: "/assets/img/homes/updinfo.jpg",
    label: "Update Information",
    description: "Edit the staff notice shown on this place's Information window.",
    types: ["colony", "hood", "block"],
    kind: "route",
    routeNames: {
      colony: "place-update-information",
      hood: "place-update-information",
      block: "place-update-information",
    },
    paramKey: "placeId",
    // CS 4.0 place/updateinfo.{cfg,tmpl} - a single TXT attribute on the place
    // record, gated by owneraccess. The wizard reached it as ac=wizardinfo.
    origin: "classic",
  },
  {
    key: "manage_lots",
    image: "/assets/img/homes/updhome.jpg",
    label: "Lot Availability",
    description: "Choose which lots on this block members may settle on.",
    types: ["block"],
    kind: "route",
    routeNames: { block: "blockwizard" },
    paramKey: "id",
    // CS 4.0 block/wizard/present.tmpl - 72 checkboxes over the block map,
    // submitted as an old-vs-new diff. Archived as ac=wizardpresent.
    origin: "classic",
  },
  {
    key: "manage_background",
    image: "/assets/img/homes/updimage.jpg",
    label: "Map Background",
    description: "Choose the scenery drawn behind this place's map.",
    types: ["hood", "block"],
    kind: "route",
    routeNames: {
      hood: "neighborhoodmapbackground",
      block: "blockmapbackground",
    },
    paramKey: "id",
    // CS 4.0 {block,neighbor}/wizard/image.tmpl, reached as ac=wizardimage. The
    // live-overlay preview CTR adds is an intentional enhancement over the
    // original's blind thumbnails.
    origin: "classic",
  },
];

/** The capabilities whose control lives inside the hub, tile or not. */
export const HUB_PLACED_CAPABILITIES: UpdateCapability[] = (
  Object.keys(CAPABILITY_PLACEMENT) as UpdateCapability[]
).filter((key) => CAPABILITY_PLACEMENT[key].placement === "hub");

/**
 * Tiles to render, in catalogue order, for a place of `type` given the
 * capabilities the server granted.
 *
 * Both filters matter. `types` keeps a tool off a tier it does not belong to even
 * if a capability were somehow granted there, and the capability check keeps a
 * tool hidden unless the server said so.
 */
export function visibleTiles(
  type: HubPlaceType,
  capabilities: UpdateCapability[],
): HubTile[] {
  const granted = new Set(capabilities);
  return HUB_TILES.filter(
    (tile) => tile.types.includes(type) && granted.has(tile.key),
  );
}

/** The Vue Router target for a route tile, or null when it has none for this tier. */
export function tileRoute(
  tile: HubTile,
  context: HubContext,
): Record<string, unknown> | null {
  const name = tile.routeNames && tile.routeNames[context.type];
  if (!name) {
    return null;
  }
  if (!tile.paramKey) {
    return { name };
  }
  return { name, params: { [tile.paramKey]: String(context.placeId) } };
}

/** The popup target for a window tile. */
export function tileHref(tile: HubTile, context: HubContext): string {
  return (tile.hrefTemplate || "").replace("{placeId}", String(context.placeId));
}

/** The capability that lists a place's children, or null for a tier with none. */
export function childListCapability(
  type: HubPlaceType,
): UpdateCapability | null {
  if (type === "colony") return "list_neighborhoods";
  if (type === "hood") return "list_blocks";
  return null;
}

/**
 * The words and the destination an Update hub shows, as pure functions.
 *
 * They live here rather than as computeds in the component so they can be tested
 * by CALLING them: this harness has no .vue compiler, so anything left in the
 * component can only be checked by reading its source, which proves the text
 * exists somewhere in a file rather than that the right text is produced for a
 * given place.
 *
 * There is deliberately no branch for a public place. Public places have no
 * Update hub - they are administered through MANAGE on their Information window
 * - so a heading for one would be a branch no route can reach, and an earlier
 * version of this code carried exactly that, tested by a case that could never
 * run in the product.
 */

/** What a tier is called in a heading. */
export function tierNoun(type: HubPlaceType): string {
  if (type === "colony") return "colony";
  if (type === "hood") return "neighborhood";
  return "block";
}

/** `Update the neighborhood 'The Shadows'` */
export function hubHeading(type: HubPlaceType, name: string): string {
  return `Update the ${tierNoun(type)} '${name}'`;
}

/**
 * The lead line. A hub offering ONE tool cannot honestly invite a choice, and
 * the line it replaced ("...information and more ...!") promised a "more" that
 * several hubs do not have.
 */
export function hubIntro(type: HubPlaceType, tileCount: number): string {
  const verb = tileCount <= 1 ? "Use the option" : "Choose an option";
  return `${verb} below to update this ${tierNoun(type)}.`;
}

/** `Back to Dark Paradise`, or plain `Back` when no place is known. */
export function hubBackLabel(name?: string | null): string {
  return name ? `Back to ${name}` : "Back";
}

/**
 * Where Back actually goes. A label naming a destination must not depend on
 * history: after direct entry or a refresh the stack points somewhere the label
 * never mentioned.
 *
 * Returns null when there is nothing to name - a denied hub knows no place - and
 * the caller falls back to history, matching the plain "Back" label.
 */
export function hubBackRoute(
  hub: { type: HubPlaceType; placeId: number; slug?: string | null } | null,
): Record<string, unknown> | null {
  if (!hub) return null;
  if (hub.type === "colony") {
    // A colony's own page is the parent route `/place/:id`, addressed by SLUG,
    // and it is unnamed - so it is targeted by path.
    return hub.slug ? { path: `/place/${hub.slug}` } : null;
  }
  if (hub.type === "hood") {
    return { name: "neighborhoodpage", params: { id: String(hub.placeId) } };
  }
  if (hub.type === "block") {
    return { name: "blockmap", params: { id: String(hub.placeId) } };
  }
  return null;
}
