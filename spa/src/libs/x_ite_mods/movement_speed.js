/* global X3D */
(function () {

  /*
   * Movement speed multiplier seam.
   *
   * X_ITE's WalkViewer computes every keyboard/mouse step as
   * `NavigationInfo.speed * Viewpoint.getSpeedFactor() * SPEED_FACTOR * dt`
   * (x_ite/Browser/Navigation/WalkViewer.js, fly()/pan()). NavigationInfo.speed
   * is VRML-authored per world and stays untouched - CTR does not edit worlds
   * to change pace. getSpeedFactor() has no VRML-authored meaning at all (the
   * base X3DViewpointNode just returns 1), so it is the seam CTR's own speed
   * system owns.
   *
   * Same provider-seam shape as bxx_identity.js: this file supplies the API
   * surface only and answers 1 (X_ITE's own default - no change in behaviour)
   * until Vue-land registers a provider. The provider itself lives in
   * WorldBrowserPage.vue's applyMovementSpeed(), which resolves world
   * override / user preference / application default via
   * helpers/movement-speed.helper.ts - kept out of this file so the
   * precedence logic stays testable without a browser.
   */

  window.X3D = window.X3D || {};
  X3D.bxx = X3D.bxx || {};

  X3D.bxx.speedMultiplierProvider = X3D.bxx.speedMultiplierProvider || null;

  X3D.bxx.setSpeedMultiplierProvider = function (provider) {
    X3D.bxx.speedMultiplierProvider = typeof provider === "function" ? provider : null;
  };

  function speedMultiplier() {
    if (!X3D.bxx.speedMultiplierProvider) return 1;
    try {
      var value = X3D.bxx.speedMultiplierProvider();
      return typeof value === "number" && isFinite(value) ? value : 1;
    } catch (error) {
      console.warn("movement_speed: provider failed", error);
      return 1;
    }
  }

  X3D.require(["x_ite/Components/Navigation/X3DViewpointNode"], function (ViewpointNode) {
    ViewpointNode.prototype.getSpeedFactor = function () {
      return speedMultiplier();
    };
  });

})();
