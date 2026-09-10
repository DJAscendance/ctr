/* global X3D */
(function () {

  /*
   * Restores the VRML97 default navigation type.
   *
   * VRML97 defines NavigationInfo.type as ["WALK","ANY"]; X3D changed that
   * default to ["EXAMINE","ANY"]. X_ITE applies the X3D default to VRML97
   * content, so any .wrl that leaves the field out drops the member into
   * EXAMINE - the world spins under the mouse and the arrow keys do nothing,
   * because no WalkViewer is ever built.
   *
   * That is 49 of the 85 worlds carrying a NavigationInfo, including Hi-Tek,
   * the Flea Market, Adventure colony and every member home. The 36 that do
   * name a type all name WALK (one names FLY); none of them ask for EXAMINE.
   * So a VRML97 scene sitting on the X3D default is always an unstated WALK.
   *
   * Verified identical on X_ITE 15.1.12 and 16.2.0 with bare X_ITE, so this
   * is long-standing legacy compatibility, not an engine regression.
   */

  X3D.require(["x_ite/Components/Navigation/NavigationInfo"], function (NavigationInfo) {

    var originalInitialize = NavigationInfo.prototype.initialize;

    /* The X3D default this patch is allowed to override, and nothing else. */
    function isX3DDefault(type) {
      return type.length === 2 && type[0] === "EXAMINE" && type[1] === "ANY";
    }

    NavigationInfo.prototype.initialize = function () {
      originalInitialize.call(this);

      try {
        var context = this.getExecutionContext();
        if (!context || context.encoding !== "VRML") return;

        var type = this.getField("type");
        if (!isX3DDefault(Array.from(type))) return;

        /*
         * Assigning the whole field rather than mutating it, so the change
         * goes through the node's own set_type__ handler and the active
         * viewer is rebuilt.
         */
        type.setValue(["WALK", "ANY"]);
      } catch (error) {
        /* A world that cannot report its encoding keeps the engine default. */
      }
    };

  });
})();
