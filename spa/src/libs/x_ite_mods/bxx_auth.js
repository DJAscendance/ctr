(function () {

    // Below are additions from the Blaxxun Authoring guide and were not available on the X_ITE browser
    X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
        let b = Browser.prototype;

        // Time
    // `wst` was never assigned - the only line that would have set it is
    // the commented-out one below - so this returned undefined on every
    // call. The Outlands world seeds three timers from it, so undefined
    // poisoned all of them. The stamp is now taken once per loaded world
    // and stays stable until the next load.
        //var wst = X3D.getBrowser().getCurrentTime();
    b.getWorldStartTime = function () {
      if (typeof this._bxxWorldStartTime !== "number") {
        this._bxxWorldStartTime = this.getCurrentTime();
      }
      return this._bxxWorldStartTime;
    };
        b.getTime = b.getCurrentTime;

    const originalLoadURLForTime = b.loadURL;
    b.loadURL = function () {
      this._bxxWorldStartTime = undefined;
      return originalLoadURLForTime.apply(this, arguments);
    };
        //Browser.prototype.getTime = function () { console.log('called gettime!'); return X3D.getBrowser.getCurrentTime() }

        // Avatar
        b.setMyAvatar = function (node) { throw Error('UnimplementedBXXMethod') }
        b.showMyAvatar = function (flag) { throw Error('UnimplementedBXXMethod') }
        b.getThirdPersonView = function () { throw Error('UnimplementedBXXMethod') }

        // Sound
        b.setSoundEnabled = function (flag) { this.mute_ = flag }
        b.getSoundEnabled = function () { return this.mute_ }

        // Navigation
    //
    // Blaxxun modes seen in the Outlands world are WALK, PAN and NONE.
    // X_ITE offers EXAMINE, WALK, FLY, LOOKAT and NONE - there is no PAN
    // viewer, so PAN maps to FLY, the nearest free-look mode. That is an
    // approximation and is recorded as such; OUTLANDS-4 judges whether it
    // is close enough for the turret and beam-out cases.
    const BXX_NAVIGATION_MODES = {
      WALK: "WALK",
      PAN: "FLY",
      NONE: "NONE",
      FLY: "FLY",
      EXAMINE: "EXAMINE",
    };
    b.setNavigationMode = function (mode) {
      const requested = String(mode).toUpperCase();
      // Added due to Jail calling this constantly
      if (this._bxxNavigationMode === requested) { return; }
      this._bxxNavigationMode = requested;
      this.viewer_ = mode;
      const mapped = BXX_NAVIGATION_MODES[requested];
      if (!mapped) { return; }
      try {
        this.activeNavigationInfo_.type = [mapped];
      } catch (error) {
        console.warn(`setNavigationMode: could not apply ${requested}`, error);
      }
    };
        b.getNavigationMode = function () { return this.activeNavigationInfo_.type }
    // X_ITE has no independent collision toggle. The closest faithful lever
    // is the NavigationInfo collision distance - avatarSize[0] - which is
    // what actually stops the viewer entering geometry. Setting it to 0
    // lets the avatar pass through; restoring the remembered value turns
    // collision back on. LIMITATION: this changes the collision *distance*
    // rather than disabling the collision system, so a zero-distance avatar
    // can still be stopped by a coincident surface. It is a real behaviour
    // change, not a no-op, but it is not full Blaxxun fidelity.
    b.setCollisionDetection = function (flag) {
      const enabled = !!flag;
      try {
        const size = this.activeNavigationInfo_.avatarSize;
        if (enabled) {
          if (typeof this._bxxCollisionDistance === "number") {
            size[0] = this._bxxCollisionDistance;
          }
        } else {
          if (size[0] !== 0) { this._bxxCollisionDistance = size[0]; }
          size[0] = 0;
        }
        this._bxxCollisionDetection = enabled;
      } catch (error) {
        console.warn(`setCollisionDetection: could not apply ${enabled}`, error);
      }
    };
    b.getCollisionDetection = function () {
      return this._bxxCollisionDetection !== false;
    };
        b.setGravity = function (flag) { (flag) ? this.browserOptions.Gravity_ = 15 : this.browserOptions.Gravity_ = 0 }
        b.getGravity = function () { return (this.browserOptions.Gravity_ == 0) ? false : true }
        //b.setHeadlight = function(flag) { this.activeNavigationInfo_.headlight = flag }
        //b.getHeadlight = function() { return this.activeNavigationInfo_.headlight }
        b.setViewpointAnimation = function (flag) { throw Error('UnimplementedBXXMethod') }
        b.getViewpointAnimation = function () { throw Error('UnimplementedBXXMethod') }
        b.setAvatarHeight = function (height) { this.activeNavigationInfo_.avatarSize[1] = height }
        b.getAvatarHeight = function () { return this.activeNavigationInfo_.avatarSize[1] }
        b.setStepOverSize = function (size) { this.activeNavigationInfo_.avatarSize[2] = size }
        b.getStepOverSize = function () { return this.activeNavigationInfo_.avatarSize[2] }
        b.setCollisionDistance = function (distance) { this.activeNavigationInfo_.avatarSize[0] = distance }
        b.getCollisionDistance = function () { return this.activeNavigationInfo_.avatarSize[0] }
        b.setVisibilityLimit = function (limit) { this.activeNavigationInfo_.visibilityLimit = limit }
        b.getVisibilityLimit = function () { return this.activeNavigationInfo_.visibilityLimit }
        // TODO: Should we multiply the walkspeed to match Blaxxun?
        b.setWalkSpeed = function (speed) { navWalk.speed = this.activeNavigationInfo_.speed }
        b.getWalkSpeed = function () { return this.activeNavigationInfo_.speed }
        b.setViewpointByValue = function (position, orientation, mode) { throw Error('UnimplementedBXXMethod') }
        b.getViewpointByValue = function (position, orientation, mode) { throw Error('UnimplementedBXXMethod') }

        // UserInterface
        b.mouseSelect = function (startPoint) { throw Error('UnimplementedBXXMethod') }

        // URL
        b.getWorldBaseURL = function () { throw Error('UnimplementedBXXMethod') } //C:\ComputerCare\playground\playground\htdocs\merged\places\enter\vrml\
        b.getBaseURL = function () { throw Error('UnimplementedBXXMethod') } // C:\ComputerCare\playground\playground\htdocs\merged\places\enter\vrml\
        b.loadURLrel = function (URL, params) { throw Error('UnimplementedBXXMethod') }

        // Rendering
        b.setRenderMode = function (mode) { throw Error('UnimplementedBXXMethod') }
        b.getZNear = function () { throw Error('UnimplementedBXXMethod') } // BS Contact 8.0 = 0.25
        b.getZFar = function () { return this.activeNavigationInfo_.visibilityLimit }

        // VRML Browser window
        b.getWindowSizeX = function () { return this.getElement().width() }
        b.getWindowSizeY = function () { return this.getElement().height() }
        b.getWindowAspect = function () { return this.getElement().width() / this.getElement().height() }

        // Client System
        // Likely will simply mimic values from Contact
        b.getCap = function (what) {
            switch (what) {
                case 2: return true;// transparency?
                    break;
                default:
                    console.log('unknown getcap: ' + what);
                    throw Error('UnimplementedBXXMethod')
            }
        } // Don't think i'll implement this one
        b.getInstallDirectory = function () { return 'C:\\Users\\owner\\AppData\\Local\\Bitmanagement Software\\BS Contact\\x64\\' }
        b.setOption = function (option, val) { throw Error('UnimplementedBXXMethod') } // To implement, See page 38
        b.getOption = function (option) { throw Error('UnimplementedBXXMethod') }
        b.setUnloadMode = function (minNotActiveInlines, percentageFactorToPurve) { throw Error('UnimplementedBXXMethod') }

        /* VRML Scene, Likely will not implement these
        b.getScript = function() { throw Error('UnimplementedBXXMethod') }
        b.setBspMode = function(order) { throw Error('UnimplementedBXXMethod') }
        b.setBspLoadingMode = function(order) { throw Error('UnimplementedBXXMethod') }
        b.computeRayHit = function(startPoint, endPoint, optionalStartingNode) { throw Error('UnimplementedBXXMethod') }
        b.computeCollision = function(sourceNode, sourceMatrix, targetScenegraph, targetMatrix) { throw Error('UnimplementedBXXMethod') }
        */


        // Gah this is ugly.... It should also be routable as a definitionfield
        Object.defineProperty(b, 'viewpointPosition', {
            get: function () { return this.activeViewpoint_._value.userPosition },
            set: function (val) {
                this.activeViewpoint_._value.position_ = val;
                this.activeViewpoint_._value.positionOffset_[0] = 0;
                this.activeViewpoint_._value.positionOffset_[1] = 0;
                this.activeViewpoint_._value.positionOffset_[2] = 0;
            }
        });
        Object.defineProperty(b, 'viewpointOrientation', {
            get: function () { return this.activeViewpoint_._value.userOrientation },
            set: function (val) {
                this.activeViewpoint_._value.orientation_ = val;
                this.activeViewpoint_._value.orientationOffset_.angle = 0
            }
        });
        Object.defineProperty(b, 'boundViewpoint', {
            get: function () {
                var _this = this;
                return {
                    get position() { return _this.viewpointPosition },
                    //set position(val) { _this.viewpointPosition = val },
                    get orientation() { return _this.viewpointOrientation },
                    //set orientation(val) { _this.viewpointOrientation = val }
                };
            }
        });



        //fields
        //boundViewpoint
        //viewpoints
        //boundViewpointStack

    })

})();
