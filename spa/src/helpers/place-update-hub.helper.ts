/**
 * The single catalogue of tools a scoped place Update hub can offer.
 *
 * One list, consumed by the Colony, Neighborhood and Block hubs alike, so the
 * three cannot drift into three near-copies. The original kept its wizard and its
 * public map identical by building them from the same frameset (blaxxun CS 4.0
 * templates/block/wizard/place.tmpl vs templates/block/place.tmpl); this is the
 * same idea applied to the tool list.
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
 * section 3. `origin` records whether the tool restores original Cybertown
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
    // record, gated by owneraccess.
    origin: "classic",
  },
  {
    key: "manage_access_rights",
    image: "/assets/img/homes/updright.jpg",
    // Named for what it actually does. The classic Owner Access axis assigns the
    // place's leader and up to eight deputies. It is NOT chat access, and must not
    // be labelled as such - see the matrix section 2.6.
    label: "Access Rights",
    description: "Assign this place's leader and deputies.",
    types: ["colony", "hood", "block"],
    kind: "route",
    routeNames: {
      colony: "worldAccessRights",
      hood: "neighborhoodAccessRights",
      block: "blockaccessrights",
    },
    // CS 4.0 common/updownerrights.{cfg,tmpl}: OWN + AS1-AS8. Archived in
    // production 13x against DTY=B.
    origin: "classic",
  },
  {
    key: "message_to_all",
    image: "/assets/img/homes/updpers.jpg",
    label: "Message to All",
    description: "Post one message to every place beneath this one.",
    types: ["colony", "hood", "block"],
    kind: "route",
    routeNames: {
      colony: "colonyMessageToAll",
      hood: "neighborhoodMessageToAll",
      block: "blockMessageToAll",
    },
    // CS 4.0 "Group Message": msb?ac=writegroup&DTY=C|N|B, gated by owneraccess.
    origin: "classic",
  },
  {
    key: "inbox_to_all",
    image: "/assets/img/homes/updpers.jpg",
    label: "Inbox to All",
    description: "Send one inbox message to every place beneath this one.",
    types: ["colony", "hood", "block"],
    kind: "route",
    routeNames: {
      colony: "colonyInboxToAll",
      hood: "neighborhoodInboxToAll",
      block: "blockInboxToAll",
    },
    // No CS 4.0 counterpart - the original's group tool posted to message boards.
    origin: "modern",
  },
  {
    key: "moderate_messageboard",
    image: "/assets/img/homes/updinfo.jpg",
    label: "Moderate Messages",
    description: "Read this place's message board and remove messages.",
    types: ["colony", "hood", "block"],
    kind: "window",
    hrefTemplate: "#/messageboard/{placeId}",
    origin: "classic",
  },
  {
    key: "moderate_inbox",
    image: "/assets/img/homes/updinfo.jpg",
    label: "Moderate Inbox",
    description: "Read this place's inbox and remove messages.",
    types: ["colony", "hood", "block"],
    kind: "window",
    hrefTemplate: "#/inbox/{placeId}",
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
    // CS 4.0 {block,neighbor}/wizard/image.tmpl. The live-overlay preview CTR adds
    // is an intentional enhancement over the original's blind thumbnails.
    origin: "classic",
  },
  {
    key: "check_images",
    image: "/assets/img/homes/updimage.jpg",
    label: "Check Images",
    description: "Review the home images displayed on this block.",
    types: ["block"],
    kind: "window",
    hrefTemplate: "#/home/image-check",
    // CS 4.0 block/action.tmpl's third owner tool: edit?...&TPL=block/plist.
    origin: "classic",
  },
];

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
