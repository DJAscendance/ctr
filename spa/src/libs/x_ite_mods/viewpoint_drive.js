/*eslint no-undef: 0*/
(function () {

  // A world that DRIVES a bound Viewpoint's position must actually move the
  // citizen there.
  //
  // THE PROVEN CASE. The Mall elevator (shopping/vrml/shopping.wrl, PROTO
  // Elevator). Pressing GO runs:
  //
  //   elevatorView.set_position = Browser.viewpointPosition;
  //   elevatorView.set_bind = true;
  //   ... ROUTE elev_interp.value_changed TO elev_script.set_position
  //   ... function set_position(v,t){ elevatorView.set_position = v; }
  //
  // so one PositionInterpolator carries the citizen from the atrium floor, into
  // the shaft, up, and out onto the balcony. There is no moving platform mesh:
  // the viewpoint IS the car.
  //
  // X_ITE reports the citizen at `position + positionOffset`, and WALK-mode
  // gravity accumulates into positionOffset. The shaft is open air, so while
  // the car crosses it gravity banks exactly one floor of fall. Measured on
  // 16.2.0 at the end of one ride:
  //
  //   elev_view._position       = (-11.625,  7.75, -11.625)   <- the car arrived
  //   elev_view._positionOffset = (      0, -6.00,       0)   <- gravity
  //   getUserPosition()         = (-11.625,  1.75, -11.625)   <- the citizen did not
  //
  // The citizen watched the ride and stayed on the ground floor. blaxxun Contact
  // had no such split: an authored viewpoint position was where the user was.
  // The balcony is not the problem - binding a viewpoint placed at the
  // elevator's own exit point lands there and holds for as long as you like.
  //
  // THE RULE. When a world writes `position` to a Viewpoint that is currently
  // BOUND, the navigation offset is cleared, so the written position is where
  // the citizen ends up. This is the same reset that binding a `jump TRUE`
  // viewpoint already performs; it is applied to the drive as well as the bind.
  //
  // WHAT THIS DOES NOT DO. Ordinary navigation is untouched: walking, turning
  // and gravity all write positionOffset and never write `position`, so no
  // callback fires and no offset is cleared. An UNBOUND viewpoint is left alone
  // - the Plaza sets its entry viewpoint's position before binding it
  // (enter/vrml/enter.wrl:529) and that keeps working unchanged. Gravity itself
  // is never switched off: the citizen still falls, still collides and still
  // lands, which is what holds them on the balcony once they arrive.

  X3D.require(["x_ite/Components/Navigation/Viewpoint"], function (Viewpoint) {
    if (!Viewpoint || !Viewpoint.prototype) { return; }
    if (Viewpoint.prototype.ctrViewpointDriveInstalled) { return; }

    const originalInitialize = Viewpoint.prototype.initialize;

    Viewpoint.prototype.initialize = function () {
      originalInitialize.call(this);

      const position = this._position;
      const offset = this._positionOffset;
      const bound = this._isBound;

      // X_ITE 4.x named these without the leading underscore. Nothing is wired
      // up when a field is missing, so the browser still starts either way.
      if (!position || !offset || !bound || !position.addFieldCallback) { return; }

      position.addFieldCallback("ctrViewpointDrive", function () {
        try {
          if (!bound.getValue()) { return; }
          if (offset.x === 0 && offset.y === 0 && offset.z === 0) { return; }
          offset.setValue(new X3D.SFVec3f(0, 0, 0));
        } catch (error) {
          // A scene mid-teardown answers by throwing; the next write retries.
        }
      });
    };

    Viewpoint.prototype.ctrViewpointDriveInstalled = true;
  });

})();
