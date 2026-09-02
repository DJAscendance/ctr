/*eslint no-undef: 0*/
(function () {

  // Blaxxun `SFNode.getName()` compatibility - the node view historical world
  // scripts were written against.
  //
  // Blaxxun's authoring guide documents `getName()` as an extension to the
  // *SFNode object*, returning "nodes DEF name if available". X_ITE 4.7.0 has
  // one `getName()`, inherited from `X3DObject`, and it returns the *field's*
  // name. A node reached through a script is not a declared field, so its name
  // is `""` and every historical DEF lookup matches nothing. The reasoning, the
  // vendor citation and the exact rule are in `helpers/bxx-node.helper.ts`.
  //
  // WHERE THIS HOOKS, AND WHY IT IS THE NARROWEST PLACE. X_ITE routes every
  // node that leaves its internals for script or API code through one object:
  // `SFNodeCache`. `SFNode.prototype.valueOf` returns `SFNodeCache.get(base)`,
  // and `valueOf` is what `field SFNode shared` and `shared.events[i]` both
  // resolve to - the first from `Script.getGlobal`, the second from
  // `X3DObjectArrayField`'s proxy. The cache instance is created fresh per base
  // node and is never a declared field, so it is never named or bound by X_ITE.
  // Marking it is therefore invisible to X_ITE and visible to every world.
  //
  // WHAT IS NOT TOUCHED.
  //   * `SFNode.prototype`. Not read, not written. X_ITE binds every script
  //     sandbox variable with `field.getName()`, so replacing the prototype
  //     method makes `field SFNode shared` bind under the node's DEF name and
  //     every SFNode field disappear from its own script. That failure was
  //     measured on a live browser, not guessed at.
  //   * Field objects. A declared field keeps its own name, so `shared` still
  //     binds as `shared` and X_ITE's field machinery is unchanged.
  //   * Base nodes. `X3DBaseNode.getName()` already returned the DEF name and
  //     is what everything internal - routes, bindables, the VRML generator -
  //     actually uses.
  //   * Every other SFNode method. `getType`, `getTypeName`, `getNodeName`,
  //     `getValue`, `valueOf`, `toString`, field access and event routing all
  //     resolve exactly as before.
  //
  // NOT DONE HERE. No world name, no node type, no game knowledge. The rule is
  // a property of blaxxun's language binding, so it applies to every node in
  // every world, and no historical `.wrl` file is modified.

  const compat = require("../../helpers/bxx-node.helper");

  window.X3D = window.X3D || {};

  // `x_ite/Fields/SFNodeCache` is a core module - `x_ite/Fields/SFNode` depends
  // on it at define time, so it is present in the single-file CDN bundle the
  // SPA loads. Unlike the Scripting component it is never fetched lazily, so
  // requiring it cannot poison a later component load.
  X3D.require(["x_ite/Fields/SFNodeCache"], function (SFNodeCache) {
    compat.installBlaxxunNodeView(SFNodeCache);
  });
})();
