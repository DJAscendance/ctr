/* global X3D */
(function () {
    // Viewpoint.bind as an alias for Viewpoint.set_bind, as blaxxun Contact
    // accepted it. The Mall declares PROTO TransformView with
    // `Viewpoint{bind IS bind}` (shopping/vrml/shopping.wrl:1578); without the
    // alias X_ITE refuses the field and the PROTO body fails to parse:
    //   Parser error at line 1578: Unknown field 'bind' in class 'Viewpoint'.
    //
    // X_ITE 4.x let a field definition be appended at runtime with a single
    // argument. X_ITE 15/16 keeps the definitions in a FieldDefinitionArray
    // whose add() is a MAP insert and takes (key, value):
    //   add(e, t) { if (this[..].has(e)) throw ...;
    //               if (!(t instanceof this[..])) throw
    //                 `value for key '${e}' has wrong type` ... }
    // Calling it with one argument put the definition in the KEY slot and left
    // the value undefined, which is why the old code always reported
    // "value for key '[object X3DFieldDefinition]' has wrong type" and gave up.
    //
    // The instance fields moved too: X_ITE 16 names them `_position`-style with
    // a LEADING underscore, so the interest is wired through `_bind` and
    // `_set_bind`, not the 4.x `bind_` / `set_bind_`.
    X3D.require(["x_ite/Components/Navigation/Viewpoint", "x_ite/Fields/SFBool"], function (Viewpoint, SFBool) {
        var defs = X3D.fieldDefs(Viewpoint)
        if (!defs) return

        if (X3D.fieldDef(Viewpoint, "bind")) return // already present

        try {
            defs.add("bind", new X3D.X3DFieldDefinition(X3D.X3DConstants.inputOnly, "bind", new SFBool()))
        } catch (error) {
            console.warn("[viewpoint_bind] this X_ITE build does not allow adding the 'bind' field, skipping:", error.message)
            return
        }

        var originalInitialize = Viewpoint.prototype.initialize
        Viewpoint.prototype.initialize = function () {
            // `bind_` / `set_bind_` on X_ITE 4.x, `_bind` / `_set_bind` on 15+.
            var source = this._bind || this.bind_
            var target = this._set_bind || this.set_bind_
            if (source && target) source.addFieldInterest(target)
            originalInitialize.call(this)
        }
    });
})();
