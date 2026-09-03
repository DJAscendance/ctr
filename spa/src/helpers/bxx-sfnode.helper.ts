/**
 * OUTLANDS-1l - blaxxun `new SFNode()` NULL-constructor Script compatibility.
 *
 * WHAT THIS SOLVES. blaxxun Contact let a script clear a node reference by
 * constructing an empty `SFNode`. Its own vendor documentation says so - blaxxun
 * Virtual Worlds Platform, 3D authoring guide, "Known Bugs"
 * (`install-7.0/csadmin/doc/3dauthoring/3dmisc6.html`):
 *
 *   "Circular node references are resulting in memory leaks. Workarounds are to
 *    null SFNode values in the shutdown() function of a script or better
 *    restructuring the nodes to avoid loops."
 *
 * `new SFNode()` is how a 1999 author wrote that. It is not a Cybertown idiom:
 * the historical corpus has nine occurrences, and one of them is in an
 * unrelated blaxxun deployment (`dinamis.fh-nuertingen.de`, `abnet.wrl:401`,
 * `loadedAVS[i] = new SFNode();`). Two independent authors, two independent
 * sites, the same "clear this slot" meaning.
 *
 * X_ITE 4.7.0 gives scripts a different `SFNode`. `Script.getGlobal`
 * (`src/x_ite/Components/Scripting/Script.js`) builds a local function that can
 * only parse a string:
 *
 *   function SFNode (vrmlSyntax) {
 *     var scene = browser .createX3DFromString (String (vrmlSyntax)), ...
 *   }
 *
 * and installs it on the sandbox as `SFNode: { value: SFNode }`. With no
 * argument, `String (undefined)` is the nine-character text `undefined`, all
 * three parse handlers reject it, and the script dies with
 * `Couldn't parse x3d syntax.`. `SFNode` is the only field type X_ITE wraps this
 * way - every other sandbox entry points straight at the real internal class.
 *
 * WHAT IS RESTORED. The no-argument call, and the identical explicit
 * `new SFNode(undefined)`, return a NULL `SFNode`. The value is built by X_ITE's
 * own `x_ite/Fields/SFNode`, which already carries exactly blaxxun's meaning:
 *
 *   function SFNode (value) {
 *     if (value) { value .addParent (this); X3DField .call (this, value); }
 *     else       { X3DField .call (this, null); }      // <- the NULL node
 *   }
 *
 * X_ITE builds a NULL node the same way itself, in `SFNode.prototype.copy`. No
 * placeholder and no stand-in `Group` is invented here.
 *
 * WHAT IS NOT TOUCHED.
 *   * `window.SFNode`, `SFNode.prototype` and every X_ITE vendor file. The
 *     sandbox declares its own `SFNode`, which shadows `window`, so a global
 *     assignment would not even reach the historical call. Nothing global is
 *     written.
 *   * The parser. `createX3DFromString` and the XML, JSON and classic-VRML
 *     handlers are unchanged. The parser was never defective; the wrong value
 *     simply must not arrive. For a NULL call it is never invoked at all.
 *   * Strings. `new SFNode("Group{}")` still runs through X_ITE's own sandbox
 *     constructor, argument untouched, and none of its parsing is copied here.
 *   * `new SFNode("")`. An empty string is a string, not a missing argument. It
 *     keeps X_ITE's current behaviour, because no historical world uses that
 *     form and nothing justifies reinterpreting it as NULL.
 *   * Any general `"undefined"` -> null rewrite. The rule is tied to the
 *     constructor call shape, never to text.
 *
 * NOT DONE HERE. No world name, no node type, no game knowledge. The rule is a
 * property of blaxxun's language binding, so it applies to every script in every
 * world, and no historical `.wrl` file is modified.
 */

/** Marks a sandbox that already carries the blaxxun NULL constructor. */
export const BLAXXUN_NULL_SFNODE = "bxxNullSFNode__";

/**
 * The script-facing `SFNode` constructor, in the shape X_ITE installs it.
 *
 * Typed as a plain callable, because only two things are ever asked of it here:
 * it is delegated to with `apply`, and its `prototype` is read.
 */
export type SFNodeConstructor = Function;

/** X_ITE's internal `x_ite/Fields/SFNode`, called with no argument for NULL. */
export type NativeSFNodeConstructor = new () => unknown;

/**
 * Is this the historical NULL construction?
 *
 * Only two shapes qualify, and they are the same statement written two ways:
 * `new SFNode()` and `new SFNode(undefined)`. Anything else - a string, a node,
 * `null`, or more than one argument - is somebody else's call and is delegated
 * untouched. `""` deliberately does not qualify.
 */
export function isBlaxxunNullSFNodeCall(values: ArrayLike<unknown> | null | undefined): boolean {
  if (!values) return false;
  if (values.length === 0) return true;

  return values.length === 1 && values[0] === undefined;
}

/**
 * Builds the script-facing constructor that adds blaxxun's NULL case.
 *
 * The wrapper keeps `original.prototype`, so a delegated call constructs `this`
 * against exactly the object X_ITE would have used and every `instanceof`
 * answers as before.
 */
export function makeBlaxxunSFNodeConstructor(
  original: SFNodeConstructor,
  NativeSFNode: NativeSFNodeConstructor,
): SFNodeConstructor {
  function SFNode(this: unknown, ...values: unknown[]): unknown {
    if (isBlaxxunNullSFNodeCall(values)) return new NativeSFNode();

    return original.apply(this, values);
  }

  SFNode.prototype = original.prototype;

  return SFNode;
}

/**
 * Returns a script sandbox whose `SFNode` carries the blaxxun NULL case.
 *
 * X_ITE builds the sandbox with `Object.create (Object.prototype, global)` and
 * the `SFNode` entry is the bare descriptor `{ value: SFNode }`, so it is
 * non-writable AND non-configurable - it cannot be redefined in place. The
 * sandbox is therefore rebuilt: every own descriptor is carried across
 * unchanged, including the getter/setter pairs X_ITE binds for the script's own
 * fields, and only `SFNode` is swapped. The object exists for one
 * `evaluate (global, text)` call and `Script.getGlobal` has no other caller, so
 * nothing observes the new identity.
 *
 * Idempotent, and safe by construction: if X_ITE ever stops shipping a function
 * under `SFNode`, or anything here throws, the caller gets X_ITE's own sandbox
 * back untouched. Compatibility is never worth failing a world over.
 */
export function installBlaxxunNullSFNode<T extends object>(
  global: T,
  NativeSFNode: NativeSFNodeConstructor | unknown,
): T {
  if (!global || typeof global !== "object") return global;
  if (typeof NativeSFNode !== "function") return global;

  try {
    if (Object.getOwnPropertyDescriptor(global, BLAXXUN_NULL_SFNODE)) return global;

    const current = Object.getOwnPropertyDescriptor(global, "SFNode");
    if (!current || typeof current.value !== "function") return global;

    const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(global);

    descriptors.SFNode = Object.assign({}, current, {
      value: makeBlaxxunSFNodeConstructor(
        current.value as SFNodeConstructor,
        NativeSFNode as NativeSFNodeConstructor,
      ),
    });

    descriptors[BLAXXUN_NULL_SFNODE] = {
      value: true,
      writable: false,
      enumerable: false,
      configurable: true,
    };

    return Object.create(Object.getPrototypeOf(global), descriptors) as T;
  } catch (error) {
    return global;
  }
}
