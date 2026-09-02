/**
 * OUTLANDS-1f - blaxxun `SFNode.getName()` Script-view compatibility.
 *
 * WHAT THIS SOLVES. blaxxun Contact put `getName()` on the *node* object. Its
 * own vendor documentation (blaxxun Contact 3D Authoring Guide,
 * `3dscripting7.html`, "Extensions to vrmlscript SFNode object") states:
 *
 *   "string getName() - Returns nodes DEF name if available. Node name is not
 *    available if node is part of a PROTO and the node in this instance was
 *    copied."
 *
 * The same page lists `getType()` and `toString()` as extensions to *field*
 * objects, separately. blaxxun therefore kept the two namings apart: a field
 * answered with its own name, a node answered with its DEF name.
 *
 * X_ITE 4.7.0 has only one `getName()`. `SFNode` inherits it from `X3DObject`
 * (`src/x_ite/Base/X3DObject.js`), where it returns `this._name` - the *field's*
 * name. A node handed to a script is never a declared field, so `_name` is `""`
 * and every historical `node.getName()` reads empty. The DEF name is reachable,
 * but only through X_ITE's own `getNodeName()`, which no 1999 world knows about.
 *
 * WHY THAT MATTERS BEYOND ONE WORLD. The pattern `node.getName() == 'SomeDEF'`
 * appears in 111 files of the historical corpus - shared-event lookups, cell
 * lookups, ray-hit lookups, avatar lookups. Every one of them silently matched
 * nothing. This is a general blaxxun compatibility gap, not a world defect.
 *
 * THE SEAM. X_ITE has exactly one place where a node crosses from its own
 * internals into script and API code: `SFNodeCache`. Reading `field SFNode x`
 * calls `field.valueOf()`; reading `mfnode[i]` calls `array[i].valueOf()`;
 * `SFNode.prototype.valueOf` returns `SFNodeCache.get(baseNode)`. The cache
 * hands back a dedicated `SFNode` instance per base node - never a declared
 * field object, and never anything X_ITE names or binds by. Marking those
 * instances, and only those, restores the blaxxun contract without touching a
 * single prototype.
 *
 * WHAT IS DELIBERATELY NOT DONE. `SFNode.prototype.getName` is not replaced.
 * X_ITE binds every script sandbox variable with `field.getName()`
 * (`Components/Scripting/Script.js`), so a prototype override makes
 * `field SFNode shared` bind under the node's DEF name and every SFNode field
 * vanishes from its own script. That was measured, not assumed.
 */

/** The base node behind an `SFNode`. Only the name is needed here. */
export interface BaseNodeLike {
  getName?: () => string;
}

/** The `SFNode` shape this module needs. Nothing else is touched. */
export interface NodeLike {
  getValue?: () => BaseNodeLike | null | undefined;
}

/**
 * Marks an `SFNode` that already carries the blaxxun view. Non-enumerable, and
 * read with `getOwnPropertyDescriptor` so the lookup never goes through
 * `SFNode`'s proxy handler and never becomes a field probe.
 */
export const BLAXXUN_NODE_VIEW = "bxxNodeView__";

/**
 * The blaxxun `SFNode.getName()` value for a node: its DEF name.
 *
 * `""` is returned for a null node and for a node with no DEF name - which is
 * exactly what X_ITE returns for those today, and is the documented blaxxun
 * caveat for a node copied inside a PROTO instance. No name is ever invented.
 */
export function blaxxunNodeName(node: NodeLike | null | undefined): string {
  try {
    if (!node || typeof node.getValue !== "function") return "";

    const base = node.getValue();
    if (!base || typeof base.getName !== "function") return "";

    const name = base.getName();
    return typeof name === "string" ? name : "";
  } catch (error) {
    // A node whose value cannot be read has no name to report. It must not
    // take a historical script down on the way.
    return "";
  }
}

/**
 * Gives one script-facing `SFNode` the blaxxun `getName()`.
 *
 * The method is an OWN property of that one instance. `SFNode.prototype` is not
 * read, not written and not otherwise involved, so X_ITE's field naming - and
 * with it every script sandbox binding - is bit-for-bit what it was.
 *
 * Idempotent: applying it twice is applying it once.
 */
export function applyBlaxxunNodeView<T>(node: T): T {
  if (!node || typeof node !== "object") return node;

  try {
    if (Object.getOwnPropertyDescriptor(node, BLAXXUN_NODE_VIEW)) return node;

    Object.defineProperty(node, BLAXXUN_NODE_VIEW, {
      value: true,
      writable: false,
      enumerable: false,
      configurable: true,
    });

    Object.defineProperty(node, "getName", {
      value: function getName(): string {
        return blaxxunNodeName(node as unknown as NodeLike);
      },
      writable: true,
      enumerable: false,
      configurable: true,
    });
  } catch (error) {
    // A frozen or exotic object keeps X_ITE's own behaviour. Compatibility is
    // never worth failing a node over.
    return node;
  }

  return node;
}

/**
 * Wraps an X_ITE `SFNodeCache` so every node it hands out carries the blaxxun
 * view. `add` and `get` are the cache's whole surface.
 *
 * The view is applied on every call, not only on a cache miss, so instances the
 * cache already held before this ran are covered too.
 */
export function installBlaxxunNodeView(cache: Record<string, unknown>): boolean {
  if (!cache || typeof cache !== "object") return false;
  if (cache[BLAXXUN_NODE_VIEW]) return false;

  let installed = false;

  for (const method of ["add", "get"]) {
    const original = cache[method];
    if (typeof original !== "function") continue;

    cache[method] = function (this: unknown, ...values: unknown[]): unknown {
      return applyBlaxxunNodeView(original.apply(this, values));
    };

    installed = true;
  }

  if (installed) cache[BLAXXUN_NODE_VIEW] = true;

  return installed;
}
