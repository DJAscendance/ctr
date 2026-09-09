(function () {

  /*
   * The two scalar VRML types a Script can still name.
   *
   * X_ITE hands a Script every field type that has an SAI object - SFVec3f,
   * SFRotation, MFString and the rest - but SFTime and SFFloat have none,
   * because X_ITE carries both as plain JavaScript numbers. blaxxun's
   * vrmlscript did have them, and worlds wrote what the VRML97 annex told them
   * to write:
   *
   *   we_time = new SFTime(ray.hitPoint.subtract(we_start).length() / mps);
   *
   * On X_ITE that is a ReferenceError, and in ne_game.wrl it lands in the
   * middle of fire() - after the ammunition has been spent and before the shot
   * is sent to the other players. So every Outlands weapon consumed a round and
   * then did nothing at all.
   *
   * X_ITE evaluates Script source in a scope that falls through to the page's
   * globals for names it does not define itself, so declaring the two here is
   * enough for a Script to find them. Each returns a boxed number, which is
   * what `new` on a constructor produces and what an SFTime or SFFloat field
   * accepts: assigning `new SFTime(2.5)` to a cycleInterval leaves 2.5 behind.
   *
   * Nothing else is added. These are the only two names the Script scope was
   * missing - checked against every type the recovered worlds construct - and
   * a shim that guessed at more would be inventing a browser.
   */

  if (typeof window === 'undefined') { return }

  if (typeof window.SFTime === 'undefined') {
    window.SFTime = function SFTime(value) {
      return new Number(Number(value) || 0)
    }
  }

  if (typeof window.SFFloat === 'undefined') {
    window.SFFloat = function SFFloat(value) {
      return new Number(Number(value) || 0)
    }
  }

})();
