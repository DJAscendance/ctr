/*eslint no-undef: 0*/
(function () {

  // Blaxxun VrmlScript "uninitialized function-local" compatibility.
  //
  // blaxxun Contact's script interpreter is not ECMAScript. Their own authoring
  // guide says an undeclared identifier is an implicitly declared, uninitialized
  // *function-local*, and their console reports "use of uninitialized variables"
  // as a warning. Reading one yielded `undefined` and the handler kept running.
  //
  // X_ITE 4.7.0 evaluates script source as `with (global) { eval (text) }`
  // (`x_ite/Browser/Scripting/evaluate.js`). In that shape a free read throws
  // `ReferenceError`, so a handler blaxxun ran to completion dies on its first
  // statement. The whole reasoning, the vendor citations and the exact rule are
  // written up in `helpers/bxx-script.helper.ts`.
  //
  // WHAT IS RESTORED. For a script that qualifies, the names it reads as
  // uninitialized locals are defined on that script's own sandbox object with
  // the value `undefined` - the value blaxxun produced. Not the event value, and
  // not the timestamp: binding either would change historical behaviour, because
  // guards like `if (v) { return; }` were always false under Contact.
  //
  // WHAT IS NOT TOUCHED.
  //   * `window`. The names go on the object X_ITE hands to `with`, nothing else.
  //   * Declared parameters. `function set_position(v,t)` binds v and t in
  //     function scope, which always shadows a `with` object, so the twenty-four
  //     working handlers keep receiving the real value and timestamp.
  //   * Free assignment. `m = Browser.eventMask` still creates a real global
  //     exactly as before - the static rule refuses any name that is ever freely
  //     assigned, so such a name is never put on the sandbox to intercept it.
  //   * Unknown identifiers in general. A name qualifies only when the same
  //     script declares it as a parameter somewhere else, which is the evidence
  //     that a parameter list was omitted. A typo has no such twin and still
  //     throws `ReferenceError`.
  //   * Fields. A name already present on the sandbox - a `field`,
  //     `exposedField` or `eventOut` - is left alone.
  //
  // NOT DONE HERE. No world name, no function name, no game knowledge. The rule
  // is a property of blaxxun's language, so it is applied to any script whose
  // source shows the pattern, and no historical `.wrl` file is modified.

  const compat = require("../../helpers/bxx-script.helper");

  window.X3D = window.X3D || {};

  // WHY `SupportedNodes` AND NOT `X3D.require(["...Scripting/Script"])`.
  // The single-file CDN bundle the SPA loads does not define the Scripting
  // component up front - X_ITE fetches it the first time a world contains a
  // Script node. Asking requirejs for `x_ite/Components/Scripting/Script`
  // therefore makes it try to fetch a file that does not exist, and the failed
  // module id then poisons X_ITE's own load of the component: the world dies
  // with `Couldn't load URL '...': Script error for "..."`. `SupportedNodes` is
  // in the core bundle, and `addType` is where the component hands its Script
  // class over, so wrapping it catches the real class at the right moment and
  // needs nothing that is not already loaded.
  X3D.require(["x_ite/Configuration/SupportedNodes"], function (SupportedNodes) {

    function patch(Script) {
      if (!Script || !Script.prototype || Script.prototype.bxxScriptCompat__) return;
      Script.prototype.bxxScriptCompat__ = true;

      const originalGetContext = Script.prototype.getContext;
      const originalGetGlobal = Script.prototype.getGlobal;

      // `getContext` is the only place that sees the source text, and it calls
      // `getGlobal` itself. Carry the decision across on the node so the sandbox
      // is only ever extended for the source it was computed from.
      Script.prototype.getContext = function (text) {
        try {
          this.bxxUninitializedLocals__ = compat.blaxxunUninitializedLocals(String(text));
        } catch (error) {
          // A source shape the scanner cannot read is a source that gets no
          // compatibility, never a script that fails to load.
          this.bxxUninitializedLocals__ = [];
        }

        try {
          return originalGetContext.call(this, text);
        } finally {
          this.bxxUninitializedLocals__ = null;
        }
      };

      Script.prototype.getGlobal = function () {
        const global = originalGetGlobal.call(this);
        const names = this.bxxUninitializedLocals__;

        if (!names || !names.length) return global;

        for (let i = 0; i < names.length; i += 1) {
          // `in` walks the prototype chain, so this also declines to shadow
          // anything X_ITE installed on `Object.prototype`.
          if (names[i] in global) continue;

          Object.defineProperty(global, names[i], {
            value: undefined,
            writable: true,
            enumerable: false,
            configurable: true,
          });
        }

        return global;
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
