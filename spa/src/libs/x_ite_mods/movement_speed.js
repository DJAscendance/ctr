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
   *
   * This file also hands the provider the bound `NavigationInfo.speed`, the
   * very term X_ITE is about to multiply the answer by. The provider divides
   * it back out (normalisedSpeedFactor) so one dial setting means one pace in
   * every world - those authored values range from 1 to 10 across CTR's worlds
   * and a bare multiplier scaled that discrepancy instead of removing it.
   * Reading it is all that happens here; the arithmetic stays in the helper.
   */

  window.X3D = window.X3D || {};
  X3D.bxx = X3D.bxx || {};

  X3D.bxx.speedMultiplierProvider = X3D.bxx.speedMultiplierProvider || null;

  X3D.bxx.setSpeedMultiplierProvider = function (provider) {
    X3D.bxx.speedMultiplierProvider = typeof provider === "function" ? provider : null;
  };

  function speedMultiplier(authoredWorldSpeed) {
    if (!X3D.bxx.speedMultiplierProvider) return 1;
    try {
      var value = X3D.bxx.speedMultiplierProvider(authoredWorldSpeed);
      return typeof value === "number" && isFinite(value) ? value : 1;
    } catch (error) {
      console.warn("movement_speed: provider failed", error);
      return 1;
    }
  }

  /*
   * The `NavigationInfo.speed` X_ITE is about to multiply this factor by.
   *
   * It is read from the BOUND NavigationInfo rather than from the scene's
   * first one: a world may carry several (enter.wrl has `nav` and
   * `nav_flythrough`) and X_ITE multiplies by whichever is bound, so anything
   * else would divide out a term that is not in the product. Returning null
   * when it cannot be read leaves the provider to pass the dial through
   * unchanged, which is the behaviour from before normalisation.
   */
  function authoredWorldSpeed(viewpoint) {
    try {
      const browser = viewpoint.getBrowser && viewpoint.getBrowser();
      const nav = browser && browser.getActiveNavigationInfo && browser.getActiveNavigationInfo();
      if (!nav) return null;
      /* X_ITE 16 keeps fields on underscore-prefixed internals; the public
       * name is kept as a fallback so this does not break on a version bump. */
      const speed = nav._speed && nav._speed.getValue ? nav._speed.getValue() : nav.speed;
      return typeof speed === "number" && isFinite(speed) ? speed : null;
    } catch (error) {
      return null;
    }
  }

  X3D.require(["x_ite/Components/Navigation/X3DViewpointNode"], function (ViewpointNode) {
    ViewpointNode.prototype.getSpeedFactor = function () {
      return speedMultiplier(authoredWorldSpeed(this));
    };
  });

})();
