(function () {

    // Below are additions from the Blaxxun Authoring guide and were not available on the X_ITE browser
    X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
        let b = Browser.prototype;

    /*
     * X_ITE 4 exposed the bound NavigationInfo as `activeNavigationInfo_` and
     * let its fields be read straight off the node. X_ITE 15 renamed the
     * property and prefixes every field with an underscore, so the accessors
     * below go through getField() instead. Reaching the node this way keeps
     * these Blaxxun methods working on either version.
     *
     * The Mall elevator is what needs this: its Script calls
     * Browser.getAvatarHeight() on every floor change, and the old property
     * name made that throw before the car could move.
     */
    function navigationInfo(browser) {
        if (typeof browser.getActiveNavigationInfo === 'function') {
            return browser.getActiveNavigationInfo()
        }
        return browser.activeNavigationInfo_
    }

    function navigationField(browser, name) {
        let info = navigationInfo(browser)
        if (!info) { throw Error('no NavigationInfo is bound') }
        return typeof info.getField === 'function' ? info.getField(name) : info[name]
    }

    // Single-valued fields have to be unwrapped; multi-valued ones are indexed
    // directly by the callers below.
    function navigationValue(browser, name) {
        let field = navigationField(browser, name)
        return field && typeof field.getValue === 'function' ? field.getValue() : field
    }


        // Time
        //var wst = X3D.getBrowser().getCurrentTime();
        b.getWorldStartTime = function () { return wst }
        b.getTime = b.getCurrentTime;
        //Browser.prototype.getTime = function () { console.log('called gettime!'); return X3D.getBrowser.getCurrentTime() }

        // Avatar
        b.setMyAvatar = function (node) { throw Error('UnimplementedBXXMethod') }
        b.showMyAvatar = function (flag) { throw Error('UnimplementedBXXMethod') }
        b.getThirdPersonView = function () { throw Error('UnimplementedBXXMethod') }

        // Sound
        b.setSoundEnabled = function (flag) { this.mute_ = flag }
        b.getSoundEnabled = function () { return this.mute_ }

        // Navigation
        b.setNavigationMode = function (mode) {
            if (this.viewer_ != mode) { // Added due to Jail calling this constantly
                this.viewer_ = mode
            }
        }
        b.getNavigationMode = function () { return navigationField(this, 'type') }
        b.setCollisionDetection = function (flag) { throw Error('UnimplementedBXXMethod'); }
        b.getCollisionDetection = function () { throw Error('UnimplementedBXXMethod'); }
        /*
         * Blaxxun's setGravity is a plain on/off switch; X_ITE carries gravity as
         * the numeric "Gravity" browser option (metres per second squared,
         * 9.80665 by default). X_ITE 4 kept that value on a `browserOptions`
         * property, which X_ITE 16 no longer exposes, so these go through the
         * public setBrowserOption/getBrowserOption pair instead.
         *
         * Switching gravity back on restores the value the world was loaded
         * with rather than a constant, so a Script that lifts a member and then
         * releases them leaves the world exactly as it found it. The remembered
         * value lives on the browser, so unloading a world mid-lift cannot leak
         * a disabled state into the next one.
         */
        var DEFAULT_GRAVITY = 9.80665

        b.setGravity = function (flag) {
            if (flag) {
                var restored = this.ctrGravityWhenEnabled_
                this.setBrowserOption('Gravity',
                    typeof restored === 'number' && restored > 0 ? restored : DEFAULT_GRAVITY)
                return
            }
            var current = this.getBrowserOption('Gravity')
            if (typeof current === 'number' && current > 0) { this.ctrGravityWhenEnabled_ = current }
            this.setBrowserOption('Gravity', 0)
        }
        b.getGravity = function () { return this.getBrowserOption('Gravity') !== 0 }
        //b.setHeadlight = function(flag) { this.activeNavigationInfo_.headlight = flag }
        //b.getHeadlight = function() { return this.activeNavigationInfo_.headlight }
        b.setViewpointAnimation = function (flag) { throw Error('UnimplementedBXXMethod') }
        b.getViewpointAnimation = function () { throw Error('UnimplementedBXXMethod') }
        b.setAvatarHeight = function (height) { navigationField(this, 'avatarSize')[1] = height }
        b.getAvatarHeight = function () { return navigationField(this, 'avatarSize')[1] }
        b.setStepOverSize = function (size) { navigationField(this, 'avatarSize')[2] = size }
        b.getStepOverSize = function () { return navigationField(this, 'avatarSize')[2] }
        b.setCollisionDistance = function (distance) { navigationField(this, 'avatarSize')[0] = distance }
        b.getCollisionDistance = function () { return navigationField(this, 'avatarSize')[0] }
        b.setVisibilityLimit = function (limit) { navigationInfo(this).visibilityLimit = limit }
        b.getVisibilityLimit = function () { return navigationValue(this, 'visibilityLimit') }
        // TODO: Should we multiply the walkspeed to match Blaxxun?
        b.setWalkSpeed = function (speed) { navWalk.speed = this.activeNavigationInfo_.speed }
        b.getWalkSpeed = function () { return navigationValue(this, 'speed') }
        b.setViewpointByValue = function (position, orientation, mode) { throw Error('UnimplementedBXXMethod') }
        b.getViewpointByValue = function (position, orientation, mode) { throw Error('UnimplementedBXXMethod') }

        // UserInterface
        b.mouseSelect = function (startPoint) { throw Error('UnimplementedBXXMethod') }

        // URL
        b.getWorldBaseURL = function () { throw Error('UnimplementedBXXMethod') } //C:\ComputerCare\playground\playground\htdocs\merged\places\enter\vrml\
        // X_ITE 15 ships a real getBaseURL() and calls it internally during
        // loadURL(). Only install the Blaxxun stub when the browser has no
        // implementation of its own (X_ITE 4), otherwise every world load throws.
        if (typeof b.getBaseURL !== 'function') {
            b.getBaseURL = function () { throw Error('UnimplementedBXXMethod') } // C:\ComputerCare\playground\playground\htdocs\merged\places\enter\vrml\
        }
        b.loadURLrel = function (URL, params) { throw Error('UnimplementedBXXMethod') }

        // Rendering
        b.setRenderMode = function (mode) { throw Error('UnimplementedBXXMethod') }
        b.getZNear = function () { throw Error('UnimplementedBXXMethod') } // BS Contact 8.0 = 0.25
        b.getZFar = function () { return navigationValue(this, 'visibilityLimit') }

        // VRML Browser window
        // X_ITE 15's getElement() returned a jQuery-like wrapper with width()
        // and height(); X_ITE 16 returns the plain <x3d-canvas> element, so
        // the size comes from its client box instead.
        b.getWindowSizeX = function () { return this.getElement().clientWidth }
        b.getWindowSizeY = function () { return this.getElement().clientHeight }
        b.getWindowAspect = function () {
            var element = this.getElement()
            return element.clientHeight ? element.clientWidth / element.clientHeight : 0
        }

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
        //
        // X_ITE 4 exposed the bound viewpoint as browser.activeViewpoint_._value.
        // X_ITE 15 removed that property and offers getActiveViewpoint() instead,
        // so the old chain threw "Cannot read properties of undefined (reading
        // '_value')" on every read. It is also legitimately empty while a world is
        // being replaced, so callers must tolerate there being no viewpoint at all.
        function activeViewpoint(browser) {
            if (typeof browser.getActiveViewpoint === 'function') {
                return browser.getActiveViewpoint()
            }
            var legacy = browser.activeViewpoint_
            return legacy && legacy._value
        }

        Object.defineProperty(b, 'viewpointPosition', {
            get: function () {
                var vp = activeViewpoint(this)
                if (!vp) return new X3D.SFVec3f(0, 0, 0)
                return typeof vp.getUserPosition === 'function'
                    ? vp.getUserPosition()
                    : vp.userPosition
            },
            set: function (val) {
                var vp = activeViewpoint(this)
                if (!vp) return
                try {
                    vp.position = val
                    vp.positionOffset = new X3D.SFVec3f(0, 0, 0)
                } catch (err) {
                    console.warn('could not set viewpointPosition', err)
                }
            }
        });
        Object.defineProperty(b, 'viewpointOrientation', {
            get: function () {
                var vp = activeViewpoint(this)
                if (!vp) return new X3D.SFRotation(0, 1, 0, 0)
                return typeof vp.getUserOrientation === 'function'
                    ? vp.getUserOrientation()
                    : vp.userOrientation
            },
            set: function (val) {
                var vp = activeViewpoint(this)
                if (!vp) return
                try {
                    vp.orientation = val
                    vp.orientationOffset = new X3D.SFRotation(0, 1, 0, 0)
                } catch (err) {
                    console.warn('could not set viewpointOrientation', err)
                }
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
