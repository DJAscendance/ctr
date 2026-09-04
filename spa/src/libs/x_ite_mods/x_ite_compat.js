/*
 * X_ITE compatibility shim.
 *
 * Older patches in this folder were written against the X_ITE 4.x AMD surface:
 *   X3D.require([...ids], function (...modules) { ... })
 * and reached into `Klass.prototype.fieldDefinitions`.
 *
 * X_ITE 15 exposes node/field classes directly on the global `X3D` object and
 * moved `fieldDefinitions` onto the constructor (static). This file normalises
 * both differences so the existing patches keep working on either version, and
 * makes a missing symbol a console warning instead of a thrown exception.
 */
(function () {
  if (typeof X3D === "undefined" || !X3D) {
    console.warn("[x_ite_compat] global X3D is not available; shim skipped");
    return;
  }

  // Map legacy AMD module ids to the names exported on the global X3D object.
  // Only the tail of the id matters: "x_ite/Fields/SFBool" -> "SFBool".
  function resolveModule(id) {
    if (typeof id !== "string") return undefined;
    var name = id.split("/").pop();
    return X3D[name];
  }

  var nativeRequire =
    typeof X3D.require === "function" ? X3D.require.bind(X3D) : null;

  /*
   * Synchronous/AMD translation wrapper.
   *
   * Accepts the legacy async AMD call shape and resolves it synchronously
   * against the global X3D namespace. If every id resolves, the callback runs
   * immediately. If any id is missing we warn and skip the callback entirely
   * rather than invoking it with `undefined` arguments, which would throw.
   * When a real X3D.require exists and our resolution fails, we defer to it.
   */
  X3D.require = function (ids, callback) {
    // Passthrough for any call shape we do not recognise.
    if (!Array.isArray(ids) || typeof callback !== "function") {
      if (nativeRequire) return nativeRequire.apply(null, arguments);
      console.warn("[x_ite_compat] unsupported X3D.require call", ids);
      return undefined;
    }

    var modules = [];
    var missing = [];

    for (var i = 0; i < ids.length; i++) {
      var mod = resolveModule(ids[i]);
      if (mod === undefined) missing.push(ids[i]);
      modules.push(mod);
    }

    if (missing.length) {
      if (nativeRequire) {
        // The installed X_ITE still has a working loader; let it try.
        return nativeRequire(ids, callback);
      }
      console.warn(
        "[x_ite_compat] skipping patch, unresolved X_ITE symbols:",
        missing.join(", "),
      );
      return undefined;
    }

    try {
      return callback.apply(null, modules);
    } catch (error) {
      console.warn("[x_ite_compat] patch callback failed:", error);
      return undefined;
    }
  };

  /*
   * fieldDefinitions fallback.
   *
   * Returns the FieldDefinitionArray for a node class, whether the installed
   * X_ITE keeps it on the prototype (4.x) or on the constructor (15.x).
   * Returns undefined and warns if neither is present.
   */
  X3D.fieldDefs = function (Klass) {
    if (!Klass) {
      console.warn("[x_ite_compat] fieldDefs called without a class");
      return undefined;
    }

    if (Klass.prototype && Klass.prototype.fieldDefinitions) {
      return Klass.prototype.fieldDefinitions;
    }

    if (Klass.fieldDefinitions) {
      return Klass.fieldDefinitions;
    }

    console.warn(
      "[x_ite_compat] no fieldDefinitions found on",
      Klass.name || Klass,
    );
    return undefined;
  };
})();
