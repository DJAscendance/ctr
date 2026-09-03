/*eslint no-undef: 0*/
(function () {

  // Blaxxun `new SFNode()` NULL-constructor compatibility.
  //
  // A historical script clears a node reference by constructing an empty
  // SFNode. blaxxun's own authoring guide recommends the practice, and the
  // idiom appears in an unrelated blaxxun site as well, so it is a platform
  // behaviour and not one world's typo. X_ITE 4.7.0 instead hands scripts an
  // `SFNode` that can only parse a string, so the missing argument becomes the
  // text `undefined`, reaches `createX3DFromString`, and the handler dies with
  // `Couldn't parse x3d syntax.`. The reasoning, the vendor citations and the
  // exact rule are written up in `helpers/bxx-sfnode.helper.ts`.
  //
  // WHAT IS RESTORED. `new SFNode()` and `new SFNode(undefined)` return a NULL
  // SFNode, built by X_ITE's own `x_ite/Fields/SFNode` - the class that already
  // stores `null` when it is called with nothing. Nothing is invented and no
  // placeholder node is created.
  //
  // WHY `getGlobal` AND WHY THE SANDBOX MUST BE REBUILT. X_ITE defines the
  // script-facing `SFNode` inside `Script.getGlobal` as a closure, and installs
  // it with the bare descriptor `{ value: SFNode }` - non-writable and
  // non-configurable. It cannot be reached from outside and it cannot be
  // redefined in place, so the helper carries every own descriptor across to a
  // fresh sandbox and swaps that one entry. `getContext` is `getGlobal`'s only
  // caller in X_ITE 4.7.0, so the new identity is seen by nothing else.
  //
  // WHY `SupportedNodes` AND NOT `X3D.require(["...Scripting/Script"])`. The
  // single-file CDN bundle does not define the Scripting component up front -
  // X_ITE fetches it the first time a world contains a Script node. Requiring
  // the component by module id makes X_ITE try to fetch a file that does not
  // exist and poisons its own later load. `SupportedNodes` and
  // `x_ite/Fields/SFNode` are both core modules, always present, so neither
  // require can do that. This is the same seam `bxx_script.js` uses.
  //
  // WHAT IS NOT TOUCHED.
  //   * `window.SFNode`, `SFNode.prototype`, and every X_ITE vendor file. The
  //     sandbox declares its own `SFNode`, which shadows `window`, so a global
  //     assignment in the style of `allow_sf_string.js` would never be reached.
  //   * The parser. `createX3DFromString` is unchanged and is not called at all
  //     for a NULL construction.
  //   * Strings. `new SFNode("Group{}")` still goes through X_ITE's own sandbox
  //     constructor. `new SFNode("")` keeps X_ITE's current behaviour.
  //   * `bxx_script.js`. Its `getGlobal` wrapper is left alone; this one nests
  //     around it, so the uninitialized-local names it adds are carried across.
  //
  // NOT DONE HERE. No world name, no function name, no game knowledge, and no
  // historical `.wrl` file is modified.

  const compat = require("../../helpers/bxx-sfnode.helper");

  window.X3D = window.X3D || {};

  const MODULES = ["x_ite/Configuration/SupportedNodes", "x_ite/Fields/SFNode"];

  X3D.require(MODULES, function (SupportedNodes, NativeSFNode) {

    function patch(Script) {
      if (!Script || !Script.prototype || Script.prototype.bxxNullSFNodeCompat__) return;
      Script.prototype.bxxNullSFNodeCompat__ = true;

      const originalGetGlobal = Script.prototype.getGlobal;

      Script.prototype.getGlobal = function () {
        return compat.installBlaxxunNullSFNode(originalGetGlobal.call(this), NativeSFNode);
      };
    }

    // Already registered - another mod may have pulled the component in first.
    patch(SupportedNodes.getType("Script"));

    const originalAddType = SupportedNodes.addType;
    SupportedNodes.addType = function (typeName, Type) {
      const result = originalAddType.apply(this, arguments);
      if (typeName === "Script") patch(Type);
      return result;
    };
  });
})();
