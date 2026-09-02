/**
 * Pure decision logic for the Blaxxun `HUD` node. Kept free of X_ITE and of the
 * DOM so the SPA's dependency-free test harness can exercise it directly;
 * `libs/x_ite_mods/bxx_hud.js` is the thin X_ITE binding over this module.
 *
 * WHAT `HUD` IS. It is a built-in grouping node of blaxxun Contact 4.0 and
 * later, not a PROTO. Its children are drawn in the viewer's own coordinate
 * system, so they follow the camera and read as a screen overlay.
 *
 * THE CONTRACT IS NOT INVENTED. Two surviving files in this repository declare
 * it, and they agree:
 *
 *   assets/worlds/externprotos/shared_xite.wrl
 *     # HUD built-in with Contact 4.0 or higher
 *     EXTERNPROTO HUD [
 *       field SFVec3f bboxSize
 *       field SFVec3f bboxCenter
 *       exposedField MFNode children
 *       eventIn MFNode addChildren
 *       eventIn MFNode removeChildren
 *     ] ["urn:inet:blaxxun.com:node:HUD", "nodes_xite.wrl#HUD"]
 *
 *   assets/worlds/externprotos/nodes_xite.wrl   (the "# CC3D 4.0" fallback)
 *     PROTO HUD [ ...same five fields... ] {
 *       Collision {
 *         collide FALSE
 *         children [
 *           DEF UserPosition ProximitySensor { center 0 0 0 size 1e36 1e36 1e36 }
 *           DEF HUD Transform { children IS children ... }
 *         ]
 *       }
 *       ROUTE UserPosition.position_changed    TO HUD.translation
 *       ROUTE UserPosition.orientation_changed TO HUD.rotation
 *     }
 *
 * That fallback body is the behavioural specification, and three facts fall out
 * of it directly:
 *
 *   1. The children track BOTH the viewer position and the viewer orientation.
 *   2. `collide FALSE` - HUD children never block navigation.
 *   3. A ProximitySensor reports the viewer in the SENSOR's own coordinate
 *      system, so the emulation stays correct however deeply the HUD is nested.
 *      The node is therefore absolutely view-relative: an enclosing Transform
 *      must not move it. `ne_game.wrl` relies on this - its second HUD sits
 *      under a Transform, inside a Switch.
 *
 * WHAT OUTLANDS ACTUALLY USES is a strict subset: `children`, and nothing else.
 * Every HUD instance in every world shipped here is written `HUD { children [
 * ... ] }`. No world DEFs a HUD, USEs one, routes to one, or reads one from a
 * script. The other four fields are declared for contract fidelity, not because
 * a world exercises them.
 */

/** The historical field names, in the order the EXTERNPROTO declares them. */
export const HUD_FIELD_NAMES = [
  "bboxSize",
  "bboxCenter",
  "children",
  "addChildren",
  "removeChildren",
] as const;

/** VRML97 access categories, spelled as the historical declaration spells them. */
export type HudAccess = "field" | "exposedField" | "eventIn";

/** One entry of the historical `HUD` interface. */
export interface HudField {
  name: string;
  access: HudAccess;
  type: string;
}

/**
 * The Blaxxun `HUD` interface, transcribed from `shared_xite.wrl`. This is the
 * whole node - blaxxun exposed no visibility, layer, depth or ordering field on
 * it, so none is reconstructed here.
 */
export const HUD_FIELDS: readonly HudField[] = [
  { name: "bboxSize", access: "field", type: "SFVec3f" },
  { name: "bboxCenter", access: "field", type: "SFVec3f" },
  { name: "children", access: "exposedField", type: "MFNode" },
  { name: "addChildren", access: "eventIn", type: "MFNode" },
  { name: "removeChildren", access: "eventIn", type: "MFNode" },
];

/** The type name the historical worlds write, and the parser must resolve. */
export const HUD_TYPE_NAME = "HUD";

/**
 * The traversal kinds X_ITE distinguishes. Named rather than numbered so this
 * module never has to import `x_ite/Bits/TraverseType`; the binding maps the
 * numeric constants onto these names.
 */
export type TraverseKind =
  | "POINTER"
  | "CAMERA"
  | "PICKING"
  | "COLLISION"
  | "SHADOW"
  | "DISPLAY";

/** What the binding should do for one traversal of a `HUD` node. */
export interface HudTraversal {
  /** Whether the children are visited at all. */
  visit: boolean;
  /**
   * Whether the accumulated model-view matrix is reset to the identity first,
   * which is what places the children in camera space.
   */
  cameraSpace: boolean;
  /**
   * Whether the near-plane clearance scale of `hudNearClearanceScale()` is
   * applied on top of camera space. Only the traversals that actually rasterize
   * or hit-test need it; see that function for why the scale is safe.
   */
  nearClearance: boolean;
}

/**
 * Decide one traversal.
 *
 * COLLISION is the only kind that is skipped, and it is skipped because the
 * historical fallback wraps the whole node in `Collision { collide FALSE }`.
 * A crosshair 0.1 units in front of the eye would otherwise pin the avatar in
 * place the moment the world loaded.
 *
 * Every other kind is visited in camera space - including POINTER and PICKING.
 * That is deliberate and it is evidenced twice in `ne_game.wrl`:
 *
 *   - the first HUD ends with a transparent "Backstop" quad at z -100 whose own
 *     comment reads "set translation to set weapon range", i.e. the historical
 *     weapon ray is expected to hit HUD geometry;
 *   - the crosshair drawn 0.1 units ahead is built from four separate arms with
 *     an OPEN centre, so the ray fired straight down the view axis passes
 *     through the hole. Geometry shaped around the ray is only necessary if the
 *     ray can hit it.
 *
 *   - the second HUD carries `DEF release_button TouchSensor`, which needs
 *     POINTER traversal to fire at all.
 */
export function hudTraversal(kind: TraverseKind): HudTraversal {
  if (kind === "COLLISION") {
    return { visit: false, cameraSpace: false, nearClearance: false };
  }
  // CAMERA collects the bindable stacks - viewpoints, navigation info,
  // backgrounds, fogs. Nothing is drawn and nothing is hit-tested, so the
  // clearance scale would be measured against a NavigationInfo that is still
  // being resolved for no gain. Camera space alone is enough there.
  if (kind === "CAMERA") {
    return { visit: true, cameraSpace: true, nearClearance: false };
  }
  return { visit: true, cameraSpace: true, nearClearance: true };
}

/**
 * How far past the near plane the clearance scale places HUD geometry, as a
 * multiple of the near distance. Anything greater than 1 clears the plane; the
 * margin exists so a float rounding difference between our own multiply and the
 * one inside the projection matrix cannot put the geometry back on the plane.
 */
export const HUD_NEAR_MARGIN = 1.05;

/**
 * The camera-space depth extent of one HUD subtree, as the binding measures it
 * from the node's own bounding box. The HUD's local space IS camera space, so
 * no conversion is needed before this is read.
 */
export interface HudExtent {
  /** True when the subtree bounding box is empty - no drawable children. */
  empty: boolean;
  /**
   * The largest z of that bounding box. The viewer looks down -z, so this is
   * the face CLOSEST to the eye, and `-maxZ` is its distance in front of it.
   */
  maxZ: number;
}

/**
 * The uniform scale a HUD subtree needs so that none of it falls inside the
 * near clipping plane. Returns exactly 1 when no correction is needed.
 *
 * THE DEFECT THIS SOLVES. X_ITE derives the near distance from the avatar, not
 * from the content: `NavigationInfo.getNearValue()` is `getCollisionRadius() /
 * 2`, and CTR's collision radius is the X_ITE default `0.25`, so the near plane
 * sits at `0.125`. The Outlands crosshair is drawn at `z -0.1`. It is therefore
 * nearer than the plane and is lost twice over - the frustum cull in
 * `addDisplayShape` rejects it before it is ever submitted, and the pointer ray
 * of `ViewVolume.unProjectRay` starts AT the near plane, so it could not be
 * touched either. The HUD messages at `z -0.2` and the turret panel at `z
 * -0.199` are past the plane and were always visible, which is exactly the
 * split QA reported.
 *
 * WHY A SCALE, AND WHY IT IS SAFE. In camera space the eye is at the origin, so
 * a perspective projection divides by -z. Scaling a point uniformly about that
 * origin multiplies x, y and z by the same factor, and the division cancels it:
 * the geometry lands on exactly the same pixels at exactly the same apparent
 * size. Only the depth changes, and it changes monotonically, so HUD children
 * keep their order - the crosshair stays in front of the messages behind it.
 * A translation would not do this; it would move and resize the overlay.
 *
 * WHY IT IS SCOPED TO THE ONE HUD THAT NEEDS IT. The scale is computed from the
 * node's own bounding box, so a HUD whose content already clears the plane gets
 * 1 and is not touched at all. The Plaza's HUD content sits at `z -0.5` and the
 * Outlands turret HUD at `z -0.199`; both are already clear, so both render
 * byte-for-byte as before. Nothing here knows which world it is in.
 *
 * The guards return 1 rather than guessing, because no scale about the origin
 * can rescue geometry that straddles or sits behind the eye.
 */
export function hudNearClearanceScale(extent: HudExtent, nearValue: number): number {
  if (extent.empty) {
    return 1;
  }
  if (!Number.isFinite(extent.maxZ) || !Number.isFinite(nearValue)) {
    return 1;
  }
  if (nearValue <= 0) {
    return 1;
  }

  const nearest = -extent.maxZ;

  // At or behind the eye: unfixable by scaling, and not a case any historical
  // HUD exercises.
  if (nearest <= 0) {
    return 1;
  }

  // Already clear of the plane. Equality counts as clipped, because geometry
  // exactly on the near plane is not reliably drawn.
  if (nearest > nearValue) {
    return 1;
  }

  return (nearValue * HUD_NEAR_MARGIN) / nearest;
}

/**
 * A node that positions itself against the camera rather than against its
 * parent. The binding marks `HUD` instances with this flag, and the ray walk in
 * `bxx_ray.js` reads it so that a HUD nested under a Transform is not dragged
 * out of camera space.
 */
export interface ViewRelativeNode {
  bxxViewRelative?: unknown;
}

/** Whether a candidate node replaces, rather than extends, its parent matrix. */
export function isViewRelative(node: unknown): boolean {
  if (!node || typeof node !== "object") {
    return false;
  }
  return (node as ViewRelativeNode).bxxViewRelative === true;
}

/**
 * Which matrix a node's children inherit during the `computeRayHit` walk.
 *
 * `"local"`    - the node's own matrix replaces everything above it (a HUD).
 * `"compose"`  - the node's matrix is applied on top of its parent's (Transform).
 * `"inherit"`  - the node has no matrix of its own (Group, Switch, Shape).
 */
export type MatrixMode = "local" | "compose" | "inherit";

/** Pick the matrix mode for one node of the ray walk. */
export function matrixMode(node: unknown, hasLocalMatrix: boolean): MatrixMode {
  if (!hasLocalMatrix) {
    return "inherit";
  }
  return isViewRelative(node) ? "local" : "compose";
}
