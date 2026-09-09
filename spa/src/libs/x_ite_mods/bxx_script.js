/*eslint no-undef: 0*/
(function () {

  // Blaxxun VrmlScript "uninitialized function-local" compatibility.
  //
  // blaxxun Contact's script interpreter is not ECMAScript. Their own authoring
  // guide says an undeclared identifier is an implicitly declared, uninitialized
  // *function-local*, and their console reports "use of uninitialized variables"
  // as a warning. Reading one yielded `undefined` and the handler kept running.
  //
  // X_ITE still evaluates script source inside a `with` block over a sandbox
  // object. In 16.2.0 the evaluator is built as
  //   `new Function ("with (arguments [0]) { return eval (...sourceText...); }")`
  // (`assets/components/ScriptingComponent.min.js`). In that shape a free read
  // throws `ReferenceError`, so a handler blaxxun ran to completion dies on its
  // first statement. Measured on 16.2.0: a script reading an undeclared `v`
  // logs `JavaScript Error in Script 'S', in function 'initialize' ...
  // ReferenceError: v is not defined` and the handler stops. The whole
  // reasoning, the vendor citations and the exact rule are written up in
  // `helpers/bxx-script.helper.ts`.
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

  // WHY `X3D.ConcreteNodes` AND NOT `X3D.require`. The single-file CDN bundle
  // the SPA loads does not define the Scripting component up front - X_ITE
  // fetches `assets/components/ScriptingComponent.js` the first time a world
  // contains a Script node. Until then `X3D.Script` does not exist and
  // `X3D.ConcreteNodes.get("Script")` is undefined, so there is nothing to
  // require and asking for the module by id only makes X_ITE fetch a file that
  // is not there. `ConcreteNodes` is the core registry every component hands
  // its node classes to (`add (typeName, Type)`), so wrapping `add` catches the
  // real Script class at the moment the component arrives and needs nothing
  // that is not already loaded. It replaces `x_ite/Configuration/SupportedNodes`
  // and its `addType`/`getType` pair, which 16.2.0 no longer ships.
  const registry = X3D.ConcreteNodes;

  if (!registry || typeof registry.add !== "function" || typeof registry.get !== "function") {
    console.warn(
      "[bxx_script] X3D.ConcreteNodes is unavailable;" +
      " blaxxun uninitialized-local compatibility is not installed",
    );
    return;
  }

  function patch(Script) {
    if (!Script || !Script.prototype) return;

    const proto = Script.prototype;
    if (proto.bxxScriptCompat__) return;

    // The two seams this needs. 4.7.0 called them `getContext`/`getGlobal`;
    // 16.2.0 renamed them and, more importantly, changed the order - see below.
    // A runtime that has neither gets a warning and no patch, never a throw.
    if (typeof proto.initialize__ !== "function" ||
        typeof proto.createGlobalObject !== "function") {
      console.warn(
        "[bxx_script] Script.prototype.initialize__/createGlobalObject are missing;" +
        " blaxxun uninitialized-local compatibility is not installed",
      );
      return;
    }

    proto.bxxScriptCompat__ = true;

    const originalInitialize = proto.initialize__;
    const originalCreateGlobalObject = proto.createGlobalObject;

    // WHY `initialize__` AND NOT `createContext`. In 4.7.0 `getContext (text)`
    // called `getGlobal` itself, so the source text was always known by the time
    // the sandbox was built. 16.2.0 inverted that: `initialize__ (sourceText)`
    // runs `this.globalObject = this.createGlobalObject ()` *before*
    // `this.context = this.createContext (sourceText)`, so a `createContext`
    // wrapper decides too late and the sandbox is already built and cached.
    // `initialize__` is the one method that both receives the source text and
    // runs ahead of the sandbox, so the decision is taken there and carried
    // across on the node.
    proto.initialize__ = function (text) {
      try {
        this.bxxUninitializedLocals__ = compat.blaxxunUninitializedLocals(String(text));
      } catch (error) {
        // A source shape the scanner cannot read is a source that gets no
        // compatibility, never a script that fails to load.
        this.bxxUninitializedLocals__ = [];
      }

      return originalInitialize.apply(this, arguments);
    };

    proto.createGlobalObject = function () {
      const global = originalCreateGlobalObject.call(this);
      const names = this.bxxUninitializedLocals__;

      if (!global || !names || !names.length) return global;

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
  patch(registry.get("Script"));

  const originalAdd = registry.add;
  registry.add = function (typeName, Type) {
    const result = originalAdd.apply(this, arguments);
    if (typeName === "Script") patch(Type);
    return result;
  };
})();
