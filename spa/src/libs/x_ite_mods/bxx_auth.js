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
        /*
         * The time the world now loaded started running.
         *
         * This used to return an undeclared `wst`, so every caller threw a
         * ReferenceError. Outlands is where that showed: ne_game.wrl's
         * initialize() calls getWorldStartTime() three times, the first of them
         * before it starts the timer whose deactivation runs set_team, so the
         * Script aborted and no member was ever put on a team - they stayed on
         * the viewpoint at y = -1000 that a teamless member is parked on.
         *
         * The value is captured per scene rather than per browser: a world
         * replacement has to reset it, or a Script in the second world would
         * schedule its timers against the first world's clock.
         */
        b.getWorldStartTime = function () {
            var scene = this.currentScene
            if (this.worldStartScene_ !== scene) {
                this.worldStartScene_ = scene
                this.worldStartTime_ = this.getCurrentTime()
            }
            return this.worldStartTime_
        }
        b.getTime = b.getCurrentTime;
        //Browser.prototype.getTime = function () { console.log('called gettime!'); return X3D.getBrowser.getCurrentTime() }

        /*
         * Avatar identity.
         *
         * blaxxun Contact took the member's avatar from the `vrmlmyavatar`
         * client parameter and published it as Browser.myAvatarURL. Cybertown
         * drove that parameter from the server: the Outlands entry template
         * ne_game/enter3D.tmpl writes
         *
         *   T_style 1 -> .../ne_game/vrml/avatars/redm.wrl
         *   T_style 2 -> .../redf.wrl      3 -> .../bluem.wrl
         *   T_style 4 -> .../bluef.wrl     CKSM. -> .../gm.wrl
         *
         * and ne_game.wrl reads Browser.myAvatarURL back to decide which team
         * the member is on. CTR has no client parameter, so the value is held
         * here and set from the member's chosen avatar when a world loads.
         *
         * Two writers, matching the two the historical client had: the page,
         * which sets it from the avatar the member is wearing, and a world,
         * through BlaxxunZone's set_myAvatarURL eventIn - the route the
         * historical place pickers used via sendEvent('change','set_avatar',...).
         */
        b.setMyAvatarURL = function (url) {
            this.myAvatarURL_ = (typeof url === 'string') ? url : ''
        }
        Object.defineProperty(b, 'myAvatarURL', {
            get: function () { return this.myAvatarURL_ || '' },
            set: function (url) { this.setMyAvatarURL(url) },
        });
        Object.defineProperty(b, 'myAvatarName', {
            get: function () { return this.myAvatarName_ || '' },
            set: function (name) { this.myAvatarName_ = (typeof name === 'string') ? name : '' },
        });

        b.setMyAvatar = function (node) { throw Error('UnimplementedBXXMethod') }
        b.showMyAvatar = function (flag) { throw Error('UnimplementedBXXMethod') }
        b.getThirdPersonView = function () { throw Error('UnimplementedBXXMethod') }

        // Sound
        b.setSoundEnabled = function (flag) { this.mute_ = flag }
        b.getSoundEnabled = function () { return this.mute_ }

        /*
         * Browser-sourced routes and the browser event mask.
         *
         * blaxxun let a Script route the browser's own input events to itself:
         *
         *   Browser.eventMask = Browser.eventMask | (1<<4) | (1<<5) | (1<<6)
         *   Browser.addRoute(Browser, 'event_changed', self, 'onEvent')
         *
         * X_ITE's addRoute expects two X3D nodes and rejects the browser with
         * "Bad ROUTE specification". That is what kept Outlands broken:
         * ne_game.wrl makes this call on the third line of its initialize(), so
         * the Script died before it could start the timer that puts a member on
         * a team, and every member stayed on the parked viewpoint at y = -1000.
         *
         * These routes are accepted and recorded so the calling Script survives
         * and the rest of its initialize() runs. Delivering the events is a
         * separate piece of work and is deliberately not faked here: in
         * Outlands the event route carries the weapon controls (D fires, W
         * changes weapon, A pans) and the suppression of the blaxxun client's
         * own shortcuts, none of which exist yet. A world that asks for browser
         * events currently gets none, rather than getting wrong ones.
         */
        var browserRoutesWarned = false

        /* The browser, not a node. Both carry getBrowser(), so that cannot
         * separate them; an X3DNode carries getNodeTypeName() and the browser
         * carries getVersion(), and neither carries the other's. */
        function isBrowserNode(node) {
            return !!node
                && typeof node.getNodeTypeName !== 'function'
                && typeof node.getVersion === 'function'
        }

        /*
         * addRoute and deleteRoute are not declared on X3DBrowser. A class
         * further along the browser's prototype chain owns them, and anything
         * defined here would simply be shadowed by it - which is exactly what
         * happened on the first attempt. So the shim goes on whichever
         * prototype actually owns the method, located from a live browser.
         * WorldBrowserPage calls this once per browser; the flag makes every
         * call after the first free.
         */
        b.installBlaxxunRouteShim = function () {
            var proto = Object.getPrototypeOf(this)
            while (proto && !Object.prototype.hasOwnProperty.call(proto, 'addRoute')) {
                proto = Object.getPrototypeOf(proto)
            }
            if (!proto || proto.blaxxunRouteShim_) { return }
            proto.blaxxunRouteShim_ = true

            var originalAddRoute = proto.addRoute
            var originalDeleteRoute = proto.deleteRoute

            proto.addRoute = function (fromNode, fromField, toNode, toField) {
                if (isBrowserNode(fromNode)) {
                    this.browserEventRoutes_ = this.browserEventRoutes_ || []
                    this.browserEventRoutes_.push({ field: fromField, node: toNode, eventIn: toField })
                    if (!browserRoutesWarned) {
                        browserRoutesWarned = true
                        console.warn(
                            '[bxx_auth] a world routed the browser event ' + fromField
                            + '; the route is recorded but browser events are not delivered yet',
                        )
                    }
                    return
                }
                return originalAddRoute.apply(this, arguments)
            }

            proto.deleteRoute = function (fromNode, fromField, toNode, toField) {
                if (isBrowserNode(fromNode)) {
                    var routes = this.browserEventRoutes_ || []
                    this.browserEventRoutes_ = routes.filter(function (r) {
                        return !(r.field === fromField && r.node === toNode && r.eventIn === toField)
                    })
                    return
                }
                return originalDeleteRoute.apply(this, arguments)
            }
        }

        Object.defineProperty(b, 'eventMask', {
            get: function () { return this.eventMask_ || 0 },
            set: function (mask) { this.eventMask_ = Number(mask) || 0 },
        });

        // Navigation
        b.setNavigationMode = function (mode) {
            if (this.viewer_ != mode) { // Added due to Jail calling this constantly
                this.viewer_ = mode
            }
        }
        b.getNavigationMode = function () { return navigationField(this, 'type') }
        /*
         * Avatar-versus-world collision, the setting the blaxxun client exposed
         * as the "Collision Test" context-menu item and the C key.
         *
         * X_ITE has no global switch for it - collision is decided by the
         * Collision nodes in the scene - so this records the flag rather than
         * enforcing it. That is enough for the content CTR serves: Outlands
         * calls setCollisionDetection(true) on every position tick to undo any
         * press of C, and true is already the behaviour, so a member sees
         * exactly what they saw historically. Throwing here did not: it killed
         * ne_game.wrl's set_position on its first run.
         *
         * A world that switched collision off would not be honoured. None in
         * the archive does, and adding it would mean a Collision-node override
         * rather than a browser flag.
         */
        b.setCollisionDetection = function (flag) { this.collisionDetection_ = !!flag }
        b.getCollisionDetection = function () {
            return this.collisionDetection_ === undefined ? true : this.collisionDetection_
        }
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
                var value = typeof vp.getUserPosition === 'function'
                    ? vp.getUserPosition()
                    : vp.userPosition
                if (!value) return new X3D.SFVec3f(0, 0, 0)
                /*
                 * As with viewpointOrientation: getUserPosition() returns
                 * X_ITE's internal Vector3, and its arithmetic returns more
                 * Vector3s. That is invisible until a world mixes the two
                 * families, which Outlands does on every shot -
                 *
                 *   we_start = Browser.viewpointPosition.add(...)
                 *   ray.hitPoint.subtract(we_start)
                 *
                 * - where hitPoint is an SAI SFVec3f and cannot subtract a
                 * Vector3. blaxxun only ever had the one kind of vector, so
                 * this returns the kind a Script can use everywhere.
                 */
                if (value instanceof X3D.SFVec3f) return value
                return new X3D.SFVec3f(value.x, value.y, value.z)
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
                var value = typeof vp.getUserOrientation === 'function'
                    ? vp.getUserOrientation()
                    : vp.userOrientation
                if (!value) return new X3D.SFRotation(0, 1, 0, 0)
                /*
                 * getUserOrientation() hands back X_ITE's internal Rotation4,
                 * which is a maths helper and not the SAI type. blaxxun handed
                 * a Script the SFRotation itself, and Outlands uses every part
                 * of it: fire() calls .multVec() to point the shot down the
                 * line of sight, and send_repulsor indexes [1] and [3]. Only
                 * the SAI value carries both.
                 */
                if (typeof value.multVec === 'function') return value
                var axis = typeof value.getAxis === 'function' ? value.getAxis() : value
                return new X3D.SFRotation(
                    axis.x !== undefined ? axis.x : axis[0],
                    axis.y !== undefined ? axis.y : axis[1],
                    axis.z !== undefined ? axis.z : axis[2],
                    value.angle,
                )
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
