/* global X3D */
/*
 * X_ITE compatibility shim.
 *
 * Older patches in this folder were written against the X_ITE 4.x AMD surface:
 *   X3D.require([...ids], function (...modules) { ... })
 * and reached into `Klass.prototype.fieldDefinitions`.
 *
 * X_ITE 15 differs in three ways:
 *   - `X3D.require` takes a SINGLE module id string and returns the module
 *     synchronously (passing an array throws "t.match is not a function").
 *   - Node and field classes are exported directly on the global `X3D`.
 *   - `fieldDefinitions` lives on the constructor, not the prototype.
 *
 * This file normalises all three so the existing patches keep working on
 * either version, and turns a missing symbol into a console warning instead
 * of an exception that aborts the patch.
 */
(function () {
  if (typeof X3D === "undefined" || !X3D) {
    console.warn("[x_ite_compat] global X3D is not available; shim skipped");
    return;
  }

  // Legacy ids whose module was renamed in X_ITE 15. The generic VRML parser
  // used to be "Parser"; it is now "VRMLParser".
  var ALIASES = {
    Parser: "VRMLParser",
  };

  var nativeRequire =
    typeof X3D.require === "function" ? X3D.require.bind(X3D) : null;

  /*
   * Resolve one legacy AMD id to a module.
   *
   * Only the tail of the id matters: "x_ite/Fields/SFBool" -> "SFBool".
   * Tries the global X3D namespace first (X_ITE 15), then the native loader
   * with a SINGLE STRING argument - never an array, which v15 rejects.
   */
  function resolveModule(id) {
    if (typeof id !== "string") return undefined;

    var name = id.split("/").pop();
    if (ALIASES[name]) name = ALIASES[name];

    if (X3D[name]) return X3D[name];

    if (nativeRequire) {
      // Try the aliased short name, then the original id. Each call is
      // guarded: v4.x throws on a string, v15 throws on anything unknown.
      var candidates = [name, id];
      for (var i = 0; i < candidates.length; i++) {
        try {
          var mod = nativeRequire(candidates[i]);
          if (mod) return mod;
        } catch (error) {
          /* try the next candidate */
        }
      }

      // X_ITE 4.x only resolves asynchronously via the array form.
      try {
        var resolved;
        nativeRequire([id], function (mod) { resolved = mod; });
        if (resolved) return resolved;
      } catch (error) {
        /* fall through to "not found" */
      }
    }

    return undefined;
  }

  /*
   * Synchronous/AMD translation wrapper.
   *
   * Accepts the legacy async AMD call shape. If every id resolves the callback
   * runs immediately; if any id is missing we warn and skip rather than call
   * the patch with `undefined` arguments. Resolution and the callback both run
   * inside try/catch so a failing patch can never abort page startup.
   */
  X3D.require = function (ids, callback) {
    // Single-string form: this is the native X_ITE 15 signature, pass it through.
    if (typeof ids === "string" && callback === undefined) {
      try {
        return resolveModule(ids);
      } catch (error) {
        console.warn("[x_ite_compat] require failed for", ids, error);
        return undefined;
      }
    }

    if (!Array.isArray(ids) || typeof callback !== "function") {
      console.warn("[x_ite_compat] unsupported X3D.require call", ids);
      return undefined;
    }

    var modules = [];
    var missing = [];

    try {
      for (var i = 0; i < ids.length; i++) {
        var mod = resolveModule(ids[i]);
        if (mod === undefined) missing.push(ids[i]);
        modules.push(mod);
      }
    } catch (error) {
      console.warn("[x_ite_compat] unresolved, patch skipped:", ids, error);
      return undefined;
    }

    if (missing.length) {
      console.warn(
        "[x_ite_compat] unresolved, patch skipped:",
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

  /*
   * Look one field definition up by name.
   *
   * X_ITE 4.x exposed a `.index` map keyed by field name. X_ITE 15 dropped it,
   * so scan the array instead. Returns undefined if the field is absent.
   */
  X3D.fieldDef = function (Klass, name) {
    var defs = X3D.fieldDefs(Klass);
    if (!defs) return undefined;

    if (defs.index && defs.index[name]) return defs.index[name];

    for (var i = 0; i < defs.length; i++) {
      if (defs[i] && defs[i].name === name) return defs[i];
    }

    return undefined;
  };
})();
