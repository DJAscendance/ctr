/* global X3D */
(function () {

  X3D.require(["x_ite/Browser/Navigation/WalkViewer"], function (WalkViewer) {
    let originalInitialize = WalkViewer.prototype.initialize;

    WalkViewer.prototype.keydown = function (e) {
      if (e.keyCode > 36 && e.keyCode < 41 || e.keyCode == 17) {
        if (this.keyx == 0 && this.keyy == 0) {
          this.fromVector.set(0, 0, 0);
          this.toVector.assign(this.fromVector);
          this.getFlyDirection(this.fromVector, this.toVector, this.direction);
          this.getBrowser().setCursor("MOVE");
          this.addFly();
        }
        if (e.keyCode == 37) this.keyx = -50;  // Left
        if (e.keyCode == 38) this.keyy = -100; // Up
        if (e.keyCode == 39) this.keyx = 50;   // Right
        if (e.keyCode == 40) this.keyy = 100;  // Down
        if (this.getBrowser().getControlKey())
          this.toVector.set(this.keyx, this.keyy / 4, 0);
        else
          this.toVector.set(this.keyx, 0, this.keyy);
        this.getFlyDirection(this.fromVector, this.toVector, this.direction);
      }
    }

    WalkViewer.prototype.keyup = function (e) {
      if (e.keyCode == 37 || e.keyCode == 39) this.keyx = 0;
      if (e.keyCode == 38 || e.keyCode == 40) this.keyy = 0;
      if (this.keyx == 0 && this.keyy == 0) {
        e.preventDefault();
        this.event = null;
        this.button = -1;
        this.disconnect();
        this.getBrowser().setCursor("DEFAULT");
        // X_ITE 4's WalkViewer had removeCollision(); X_ITE 15 dropped it and
        // tears the collision test down in disconnect() instead, so calling it
        // unconditionally threw on every key release.
        if (typeof this.removeCollision === "function") this.removeCollision();
        this.isActive_ = false;
      } else {
        this.toVector.set(this.keyx, 0, this.keyy);
        this.getFlyDirection(this.fromVector, this.toVector, this.direction);
      }
    }

    let originalDispose = WalkViewer.prototype.dispose;

    /*
     * Each viewer keeps its own bound handlers.
     *
     * X_ITE creates a WalkViewer per bound viewpoint, so replacing a world
     * builds a new one, and every one of them binds on the same element. The
     * pair below is stored on the viewer so dispose() removes exactly the
     * handlers this viewer added, never a live sibling's.
     *
     * X_ITE 15 returned a jQuery-like wrapper from getElement(), so this used
     * namespaced .on()/.off(). X_ITE 16 returns the plain <x3d-canvas>
     * element, which has only addEventListener/removeEventListener.
     */
    WalkViewer.prototype.initialize = function () {
      var browser = this.getBrowser();
      var element = browser.getElement();
      this.keyx = 0;
      this.keyy = 0;
      this._arrowKeysHandlers = {
        element: element,
        keydown: this.keydown.bind(this),
        keyup: this.keyup.bind(this),
      };
      element.addEventListener('keydown', this._arrowKeysHandlers.keydown);
      element.addEventListener('keyup', this._arrowKeysHandlers.keyup);
      originalInitialize.call(this);
    }

    /*
     * Releases the handlers this patch installed.
     *
     * Every X_ITE viewer binds under a namespace and drops it again in
     * dispose(); this patch bound and never unbound. Because the handlers are
     * `this.keydown.bind(this)`, each one holds its WalkViewer, and they were
     * attached to the single <x3d-canvas> that lives for the whole session.
     * So every world's viewer stayed reachable - and with it the browser, the
     * viewpoint it drove, and that viewpoint's scene. Loading a new world kept
     * the old one alive, which is what killed the tab at around fifty loads.
     *
     * A bare X_ITE control measured this at roughly 18 MB retained per world
     * replacement with only this patch loaded, and under 1 MB without it.
     */
    WalkViewer.prototype.dispose = function () {
      var bound = this._arrowKeysHandlers;
      if (bound && bound.element) {
        bound.element.removeEventListener('keydown', bound.keydown);
        bound.element.removeEventListener('keyup', bound.keyup);
      }
      this._arrowKeysHandlers = null;
      if (typeof originalDispose === 'function') originalDispose.call(this);
    }

  })
})();