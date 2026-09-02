/**
 * Pure decision logic for the Blaxxun `Browser.computeRayHit` compatibility
 * call. Kept free of X_ITE and of the DOM so the SPA's dependency-free test
 * harness can exercise it directly; `libs/x_ite_mods/bxx_ray.js` is the thin
 * X_ITE binding over this module.
 *
 * The contract below is read off the surviving Outlands world, not invented.
 * `places/ne_game/vrml/ne_game.wrl` calls it in exactly three shapes:
 *
 *   fire()             ray = Browser.computeRayHit(start, end);
 *                      ... ray.hitPoint ... ray.hitPath[i].getType() ...
 *   receive_repulsor() ray = Browser.computeRayHit(a, b); ray.hitPoint
 *   Ammo / Turret      Browser.computeRayHit(start, end).hitPath[0].children
 *                      ... children[i].getName() / .getType()
 *
 * So the result must always carry a usable `hitPoint`, an array `hitPath`
 * ordered root-first, and `hitPath[0].children` must expose the scene's root
 * nodes with Blaxxun-style `getName()` / `getType()`. `fire()` divides by
 * `hitPoint` to get a projectile travel time, so a miss must still return a
 * finite point - see `MISS_USES_SEGMENT_END`.
 */

/** A point in world space, as the three ordered components. */
export type Vec3 = [number, number, number];

/** One geometry intersection, already converted to world space. */
export interface RayIntersection {
  /** World-space intersection point. */
  point: Vec3;
  /** World-space surface normal at `point`. */
  normal: Vec3;
  /** Distance from the ray origin along the ray. */
  distance: number;
  /** Traversal chain that reached the hit shape, leaf-last. */
  chain: unknown[];
}

/** The ray a traversal walks, derived from the historical start/end pair. */
export interface Ray {
  origin: Vec3;
  /** Unit vector from `origin` towards the segment end. */
  direction: Vec3;
  /** Length of the original start -> end segment. */
  length: number;
}

/**
 * A node as the historical scripts see it. Blaxxun exposed `getName()` (the
 * DEF name) and `getType()` (a type *string*). X_ITE's own `getType()` returns
 * an array of numeric type constants and is load-bearing inside the renderer,
 * so it is never overridden globally - these adapters are handed out only as
 * `hitPath` entries.
 */
export interface BxxNodeView {
  getName(): string;
  getType(): string;
  /** Present on grouping nodes; `hitPath[0].children` depends on it. */
  children?: BxxNodeView[];
  /** Supplied by a later lane for remote players. Undefined here. */
  nickname?: string;
}

/** The object `computeRayHit` hands back to the historical script. */
export interface BxxRayHit {
  hitPoint: Vec3;
  hitNormal: Vec3;
  hitPath: BxxNodeView[];
}

/**
 * A node adapter lets a later lane describe nodes the generic ray engine
 * cannot classify by itself - specifically the remote-player avatars that
 * OUTLANDS-2 must make answer `getType() === "Avatar"` and carry `nickname`.
 * Returning `null` means "not mine, ask the next adapter".
 */
// The base no-unused-vars rule misreads a parameter name in a TS function type.
// eslint-disable-next-line no-unused-vars
export type BxxNodeAdapter = (candidate: unknown) => { type?: string; nickname?: string } | null;

/**
 * On a miss the historical caller still divides by `hitPoint`, so returning
 * the segment end keeps `we_time` finite instead of producing NaN.
 */
export const MISS_USES_SEGMENT_END = true;

/** Normal reported when nothing was hit. Straight up, so it is never a zero vector. */
export const MISS_NORMAL: Vec3 = [0, 1, 0];

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

/**
 * Builds the traversal ray from the historical start/end pair. A degenerate
 * segment yields a zero direction and zero length; callers must treat that as
 * "hits nothing" rather than dividing by it.
 */
export function rayFromPoints(start: Vec3, end: Vec3): Ray {
  const delta = subtract(end, start);
  const len = length(delta);
  if (len === 0) {
    return { origin: [start[0], start[1], start[2]], direction: [0, 0, 0], length: 0 };
  }
  return {
    origin: [start[0], start[1], start[2]],
    direction: [delta[0] / len, delta[1] / len, delta[2] / len],
    length: len,
  };
}

/**
 * Blaxxun's `computeRayHit` takes a bounded start -> end segment, so an
 * intersection behind the origin or past the end is not a hit. A small
 * tolerance keeps a hit that sits exactly on the origin or the end point.
 */
export const SEGMENT_TOLERANCE = 1e-6;

export function isOnSegment(ray: Ray, intersection: RayIntersection): boolean {
  if (ray.length === 0) {
    return false;
  }
  if (!Number.isFinite(intersection.distance)) {
    return false;
  }
  const along = dot(subtract(intersection.point, ray.origin), ray.direction);
  return along >= -SEGMENT_TOLERANCE && along <= ray.length + SEGMENT_TOLERANCE;
}

/**
 * Nearest hit first. The historical script reads only the single nearest
 * result, but `hitPath` is built from it, so the ordering is what decides
 * which shape the game thinks it shot.
 */
export function orderHits(hits: RayIntersection[]): RayIntersection[] {
  return hits.slice().sort((a, b) => a.distance - b.distance);
}

export function nearestHit(ray: Ray, hits: RayIntersection[]): RayIntersection | null {
  const onSegment = hits.filter(hit => isOnSegment(ray, hit));
  if (onSegment.length === 0) {
    return null;
  }
  return orderHits(onSegment)[0];
}

/**
 * Resolves the Blaxxun type string for a node. Adapters run first so a later
 * lane can claim a node (remote avatars), then the node's own X3D type name is
 * used, then a safe constant. Never throws - it runs inside the fire path.
 */
export function resolveNodeType(
  node: unknown,
  adapters: BxxNodeAdapter[],
  fallbackTypeName?: () => string | undefined,
): string {
  for (const adapter of adapters) {
    let described = null;
    try {
      described = adapter(node);
    } catch {
      described = null;
    }
    if (described && typeof described.type === "string" && described.type !== "") {
      return described.type;
    }
  }
  if (fallbackTypeName) {
    try {
      const name = fallbackTypeName();
      if (typeof name === "string" && name !== "") {
        return name;
      }
    } catch {
      /* fall through to the constant below */
    }
  }
  return "Node";
}

/** Same adapter chain as `resolveNodeType`, for the remote-player nickname. */
export function resolveNodeNickname(node: unknown, adapters: BxxNodeAdapter[]): string | undefined {
  for (const adapter of adapters) {
    let described = null;
    try {
      described = adapter(node);
    } catch {
      described = null;
    }
    if (described && typeof described.nickname === "string") {
      return described.nickname;
    }
  }
  return undefined;
}

/**
 * The historical `hitPath` reads root-first: `hitPath[0]` is the top of the
 * scene and `hitPath[hitPath.length - 1]` is the shape that was hit. A
 * traversal naturally collects the chain in that same order, so this exists to
 * pin the direction down in a test rather than to reorder anything clever.
 */
export function buildHitPath(root: BxxNodeView, chain: BxxNodeView[]): BxxNodeView[] {
  return [root, ...chain];
}

/**
 * Assembles the final result. Split out from the traversal so the miss
 * behaviour - the part `fire()` actually depends on - is testable on its own.
 */
export function buildRayHit(
  ray: Ray,
  hit: RayIntersection | null,
  root: BxxNodeView,
  // The base no-unused-vars rule misreads a parameter name in a TS function type.
  // eslint-disable-next-line no-unused-vars
  viewOf: (hitNode: unknown) => BxxNodeView,
): BxxRayHit {
  if (!hit) {
    const end: Vec3 = [
      ray.origin[0] + ray.direction[0] * ray.length,
      ray.origin[1] + ray.direction[1] * ray.length,
      ray.origin[2] + ray.direction[2] * ray.length,
    ];
    return { hitPoint: end, hitNormal: MISS_NORMAL, hitPath: buildHitPath(root, []) };
  }
  return {
    hitPoint: hit.point,
    hitNormal: hit.normal,
    hitPath: buildHitPath(root, hit.chain.map(viewOf)),
  };
}
