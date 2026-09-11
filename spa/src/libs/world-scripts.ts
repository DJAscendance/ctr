/*
 * Releasing the outgoing world's Script nodes.
 *
 * X_ITE 16.2.0 registers `window.addEventListener("unload", this.shutdown,
 * { once: true })` for every Script that defines a `shutdown()` function
 * (`x_ite/Components/Scripting/Script.js`, `initialize__`). `replaceWorld()`
 * never disposes the outgoing scene or its nodes, so that registration is a
 * strong reference from the window to the Script, and from the Script to its
 * execution context - which is the whole world. Every world CTR replaced
 * therefore stayed alive for the life of the page. Measured on Outlands, whose
 * ne_game.wrl is the one asset CTR serves that has such a Script: one retained
 * world per visit, about 51 MB each.
 *
 * X_ITE's own release for that is `Script.dispose()`, which calls
 * `unloadData()`: it runs `shutdown()` - the behaviour X3D 29.2 asks for when
 * the world containing a Script is replaced - and then removes the listener.
 * So the rule here is the general one and mentions no world, file or node: when
 * CTR replaces a world, every Script the outgoing world owns is disposed once.
 * A world with no such Script (every other asset CTR serves) is unaffected.
 */

/* X_ITE publishes its runtime as the browser global X3D; it is loaded from the
 * CDN in spa/public/index.html, not imported. */
/* global X3D */

/* A node's execution context can only nest so far before something is wrong;
 * this stops a cyclic chain from spinning rather than expressing a real limit. */
const MAX_CONTEXT_DEPTH = 64;

/* Scenes whose Scripts have already been released. `releaseWorldScripts` is
 * called from every path that replaces a world, and two of them can run back to
 * back over the same scene; disposing a node twice is not defined. Weak, so
 * remembering a scene is not itself a reason to keep it. */
const released = new WeakSet<any>();

/*
 * The concrete node behind X_ITE 16's SFNode facade.
 *
 * `scene.rootNodes[i]` and the value of an SFNode field are facades: they carry
 * `getNodeTypeName()` and a `dispose()` that only forwards to the node when the
 * facade happens to be the canonical one for it, which is why disposing a scene
 * never reaches its Scripts. The node itself sits on one of the facade's
 * symbol-keyed own properties. Which one is a minifier artefact and would move
 * on any rebuild, so it is found by capability - `getExecutionContext()` is on
 * X3DBaseNode and on no facade. Same approach as `internalNode` in
 * `x_ite_mods/bxx_rayhit.js`.
 */
function concreteNode(value: any): any {
  if (!value || typeof value !== "object") return null;
  if (typeof value.getExecutionContext === "function"
    && typeof value.getTypeName === "function") {
    return value;
  }
  const symbols = Object.getOwnPropertySymbols(value);
  for (let i = 0; i < symbols.length; i += 1) {
    const held = (value as any)[symbols[i]];
    if (held && typeof held === "object"
      && typeof held.getExecutionContext === "function"
      && typeof held.getTypeName === "function") {
      return held;
    }
  }
  return null;
}

/*
 * The scene at the top of a node's execution-context chain, which is the world
 * that owns it.
 *
 * This is the ownership test, and it is the reason the walk can be as wide as
 * it is. X_ITE keeps a process-wide scene cache keyed by URL
 * (`FileLoader.sceneCache`) and hands the *same* scene object to a later
 * loader; EXTERNPROTO declarations and InlineGeometry are the two things that
 * use it. A Script inside such a scene is not the outgoing world's to dispose -
 * the next world would find its copy already torn down. Only a chain that ends
 * at the scene being released is in scope.
 */
function ownerScene(node: any): any {
  let context: any = null;
  try {
    context = node.getExecutionContext();
  } catch (error) {
    return null;
  }
  for (let depth = 0; context && depth < MAX_CONTEXT_DEPTH; depth += 1) {
    let parent: any = null;
    try {
      parent = typeof context.getExecutionContext === "function"
        ? context.getExecutionContext() : null;
    } catch (error) {
      break;
    }
    if (!parent || parent === context) break;
    context = parent;
  }
  return context;
}

/*
 * Every Script node the given scene owns, in every execution context under it.
 *
 * `scene.rootNodes` alone is not enough - it finds ne_game.wrl's `battle`, but
 * not the Scripts inside its weapons and turrets - so this walks the SFNode and
 * MFNode fields of every node it reaches, and steps into the two kinds of
 * nested execution context X_ITE has: an Inline's loaded scene
 * (`getInternalScene`) and a PROTO instance's body (`getBody`). Neither is
 * reachable through a field. Both are found by capability rather than by node
 * type name, so a node type that gains a body is covered without a change here.
 *
 * Exported for the QA gate, which counts what it would dispose.
 */
export function collectWorldScripts(scene: any): any[] {
  const scripts: any[] = [];
  /* Identity, not name: the same node is reachable through more than one path
   * (a DEF/USE pair is one node), and Outlands has fourteen Scripts that all
   * answer "ammo_script" or "turret_script". */
  const seenNodes = new Set<any>();
  const seenContexts = new Set<any>();

  function visitContext(context: any): void {
    if (!context || typeof context !== "object" || seenContexts.has(context)) return;
    seenContexts.add(context);
    let roots: any = null;
    try {
      roots = context.rootNodes;
    } catch (error) {
      return;
    }
    if (!roots) return;
    for (let i = 0; i < roots.length; i += 1) visitNode(roots[i]);
  }

  function visitNode(value: any): void {
    const node = concreteNode(value);
    if (!node || seenNodes.has(node)) return;
    seenNodes.add(node);

    let typeName: string | null = null;
    try {
      typeName = node.getTypeName();
    } catch (error) {
      typeName = null;
    }
    if (typeName === "Script" && typeof node.dispose === "function"
      && ownerScene(node) === scene) {
      scripts.push(node);
    }

    /* A body that never loaded has no scene, and asking for one throws. */
    try {
      if (typeof node.getInternalScene === "function") visitContext(node.getInternalScene());
    } catch (error) { /* nothing to walk */ }
    try {
      if (typeof node.getBody === "function") visitContext(node.getBody());
    } catch (error) { /* nothing to walk */ }

    let fields: any = null;
    try {
      fields = node.getFields();
    } catch (error) {
      return;
    }
    if (!fields) return;
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i];
      let type: any = null;
      try {
        type = field.getType();
      } catch (error) {
        continue;
      }
      if (type === X3D.X3DConstants.SFNode) {
        let child: any = null;
        try {
          child = field.getValue();
        } catch (error) {
          continue;
        }
        if (child) visitNode(child);
      } else if (type === X3D.X3DConstants.MFNode) {
        for (let k = 0; k < field.length; k += 1) {
          try {
            visitNode(field[k]);
          } catch (error) { /* one unreadable entry is not the rest of the field */ }
        }
      }
    }
  }

  visitContext(scene);
  return scripts;
}

/*
 * Disposes the Scripts of a world that is about to be replaced, and answers how
 * many were disposed.
 *
 * Called with the scene still current, before whatever replaces it: after
 * `replaceWorld` the browser is holding the next scene and this one can no
 * longer be named. Never called with the incoming scene - the caller is the
 * outgoing-world release path, and a scene is only released once.
 */
export function releaseWorldScripts(scene: any): number {
  if (!scene || typeof scene !== "object" || released.has(scene)) return 0;
  released.add(scene);

  let scripts: any[];
  try {
    scripts = collectWorldScripts(scene);
  } catch (error) {
    console.warn("could not enumerate the previous world's scripts", error);
    return 0;
  }

  let disposed = 0;
  for (let i = 0; i < scripts.length; i += 1) {
    /* One Script that refuses to go is not a reason to keep the other forty
     * three, and their listener is what holds the world. */
    try {
      scripts[i].dispose();
      disposed += 1;
    } catch (error) {
      console.warn("could not release a script from the previous world", error);
    }
  }
  return disposed;
}
