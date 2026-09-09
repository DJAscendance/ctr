/*eslint no-undef: 0*/
(function () {

  // Blaxxun `new SFNode()` NULL-constructor compatibility.
  //
  // A historical script clears a node reference by constructing an empty
  // SFNode. blaxxun's own authoring guide recommends the practice, and the
  // idiom appears in an unrelated blaxxun site as well, so it is a platform
  // behaviour and not one world's typo. X_ITE instead hands scripts an `SFNode`
  // that can only parse a string, so the missing argument becomes the text
  // `undefined` and the handler dies. Measured on 16.2.0, the sandbox
  // constructor is
  //
  //   function SFNode (vrmlSyntax) {
  //     const node = new SFNode ();
  //     node .fromString (vrmlSyntax, script () .getExecutionContext ());
  //     if (node .getValue ()) return getNode (node .getValue ());
  //     throw new Error ("SFNode.new: invalid argument.");
  //   }
  //
  // so `new SFNode ()` parses the nine-character text `undefined`, the parser
  // warns `Unknown node type or proto 'undefined'`, and the script dies with
  // `Couldn't read value for field ''.` - 4.7.0 phrased the same failure
  // `Couldn't parse x3d syntax.`. The reasoning, the vendor citations and the
  // exact rule are written up in `helpers/bxx-sfnode.helper.ts`.
  //
  // WHAT IS RESTORED. `new SFNode()` and `new SFNode(undefined)` return a NULL
  // SFNode, built by X_ITE's own `SFNode` field class - the class that already
  // stores `null` when it is called with nothing. Nothing is invented and no
  // placeholder node is created. Assigning it to an `SFNode` field clears the
  // field, which is what the historical code was written to do.
  //
  // WHY `createGlobalObject` AND WHY THE SANDBOX MUST BE REBUILT. X_ITE defines
  // the script-facing `SFNode` inside the sandbox builder as a closure, and
  // installs it with the bare descriptor `{ value: SFNode }`. Verified on
  // 16.2.0: the own descriptor reads back `writable: false, configurable: false,
  // enumerable: false`. It cannot be reached from outside and it cannot be
  // redefined in place, so the helper carries every own descriptor across to a
  // fresh sandbox and swaps that one entry. The sandbox builder is called once
  // per script load, from `initialize__`, and the result is memoised on the node
  // (`this.globalObject ??= this.createGlobalObject ()`), so the new identity is
  // seen by nothing else.
  //
  // WHY `X3D.ConcreteNodes` AND NOT `X3D.require`. The single-file CDN bundle
  // does not define the Scripting component up front - X_ITE fetches it the
  // first time a world contains a Script node, and until then there is no Script
  // class to reach. `ConcreteNodes` is the core registry the component hands its
  // node classes to, so wrapping `add` catches the class at the right moment.
  // `x_ite/Configuration/SupportedNodes` and its `addType`/`getType` pair, which
  // the 4.7.0 version of this file used, are gone in 16.2.0. This is the same
  // seam `bxx_script.js` uses.
  //
  // WHAT IS NOT TOUCHED.
  //   * `window.SFNode`, `SFNode.prototype`, and every X_ITE vendor file. The
  //     sandbox declares its own `SFNode`, which shadows `window`, so a global
  //     assignment in the style of `allow_sf_string.js` would never be reached.
  //   * The parser. `fromString` is unchanged and is not called at all for a
  //     NULL construction.
  //   * Strings. `new SFNode("Group{}")` still goes through X_ITE's own sandbox
  //     constructor. `new SFNode("")` keeps X_ITE's current behaviour.
  //   * `bxx_script.js`. Its sandbox wrapper is left alone; this one nests
  //     around it, so the uninitialized-local names it adds are carried across.
  //
  // NOT DONE HERE. No world name, no function name, no game knowledge, and no
  // historical `.wrl` file is modified.

  const compat = require("../../helpers/bxx-sfnode.helper");

  window.X3D = window.X3D || {};

  // X_ITE 16 exports the field classes straight off the global `X3D`, and this
  // is the very class the sandbox constructor closes over: verified on 16.2.0,
  // the sandbox `SFNode.prototype === X3D.SFNode.prototype`, and
  // `new X3D.SFNode ()` yields an `SFNode` whose value is `null`.
  const NativeSFNode = X3D.SFNode;
  const registry = X3D.ConcreteNodes;

  if (typeof NativeSFNode !== "function") {
    console.warn(
      "[bxx_sfnode] X3D.SFNode is unavailable;" +
      " blaxxun NULL SFNode compatibility is not installed",
    );
    return;
  }

  if (!registry || typeof registry.add !== "function" || typeof registry.get !== "function") {
    console.warn(
      "[bxx_sfnode] X3D.ConcreteNodes is unavailable;" +
      " blaxxun NULL SFNode compatibility is not installed",
    );
    return;
  }

  function patch(Script) {
    if (!Script || !Script.prototype) return;

    const proto = Script.prototype;
    if (proto.bxxNullSFNodeCompat__) return;

    // 4.7.0 called this `getGlobal`. A runtime that has neither name gets a
    // warning and no patch, never a throw.
    if (typeof proto.createGlobalObject !== "function") {
      console.warn(
        "[bxx_sfnode] Script.prototype.createGlobalObject is missing;" +
        " blaxxun NULL SFNode compatibility is not installed",
      );
      return;
    }

    proto.bxxNullSFNodeCompat__ = true;

    const originalCreateGlobalObject = proto.createGlobalObject;

    proto.createGlobalObject = function () {
      return compat.installBlaxxunNullSFNode(
        originalCreateGlobalObject.call(this),
        NativeSFNode,
      );
    };
  }

  // Already registered - another mod may have pulled the component in first.
  patch(registry.get("Script"));

  const originalAdd = registry.add;
  registry.add = function (typeName, Type) {
    const result = originalAdd.apply(this, arguments);
    if (typeName === "Script") patch(Type);
    return result;
  };
})();
