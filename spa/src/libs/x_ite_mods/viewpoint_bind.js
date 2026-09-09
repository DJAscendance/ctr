(function () {
    // Viewpoint.bind to Viewpoint.set_bind as used in some scripts.
    //
    // X_ITE 4.x let us append a field definition at runtime. In X_ITE 15 the
    // FieldDefinitionArray is type-guarded and rejects externally constructed
    // X3DFieldDefinition objects, so the extra "bind" field cannot be added.
    // Registration is therefore attempted and allowed to fail: scenes that use
    // Viewpoint.bind lose that alias, but the browser still starts normally.
    X3D.require(["x_ite/Components/Navigation/Viewpoint", "x_ite/Fields/SFBool"], function (Viewpoint, SFBool) {
        var defs = X3D.fieldDefs(Viewpoint)
        if (!defs) return

        if (X3D.fieldDef(Viewpoint, "bind")) return // already present

        try {
            defs.add(new X3D.X3DFieldDefinition(X3D.X3DConstants.inputOnly, "bind", new SFBool()))
        } catch (error) {
            console.warn("[viewpoint_bind] this X_ITE build does not allow adding the 'bind' field, skipping:", error.message)
            return
        }

        var originalInitialize = Viewpoint.prototype.initialize
        Viewpoint.prototype.initialize = function () {
            this.bind_.addFieldInterest(this.set_bind_)
            originalInitialize.call(this)
        }
    });
})();
