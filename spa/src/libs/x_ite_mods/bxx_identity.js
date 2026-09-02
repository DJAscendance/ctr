/*eslint no-undef: 0*/
(function () {

  // Blaxxun `Browser.myAvatarURL`, `Browser.myAvatarName` and
  // `Browser.set_myAvatarGesture`. X_ITE has none of them and `bxx_auth.js`
  // threw for the neighbouring avatar calls, so a historical script that
  // reads its own identity errors out today.
  //
  // SCOPE. This lane supplies the API SURFACE only. It does NOT decide what
  // the values are. The Outlands game avatar - the thing that actually picks
  // Red, Blue or Game Master - is OUTLANDS-2's job, and nothing here derives
  // a team, reads the citizen's normal avatar, or names a world file.
  //
  // Until a provider is registered the properties read as the empty string.
  // That is the correct pre-OUTLANDS-2 state: `ne_game.wrl`'s set_team()
  // matches the empty string against no team and takes its own documented
  // "no valid team" branch instead of crashing.

  window.X3D = window.X3D || {};
  X3D.bxx = X3D.bxx || {};

  // Registration seam. OUTLANDS-2 calls
  //   X3D.bxx.setIdentityProvider(() => ({ avatarURL, avatarName }))
  // and may call setGestureSink() to forward the firing animation.
  X3D.bxx.identityProvider = X3D.bxx.identityProvider || null;
  X3D.bxx.gestureSink = X3D.bxx.gestureSink || null;
  X3D.bxx.lastGesture = 0;

  X3D.bxx.setIdentityProvider = function (provider) {
    X3D.bxx.identityProvider = typeof provider === "function" ? provider : null;
  };

  X3D.bxx.setGestureSink = function (sink) {
    X3D.bxx.gestureSink = typeof sink === "function" ? sink : null;
  };

  function identity() {
    if (!X3D.bxx.identityProvider) { return {}; }
    try {
      return X3D.bxx.identityProvider() || {};
    } catch (error) {
      console.warn("bxx_identity: provider failed", error);
      return {};
    }
  }

  X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
    const b = Browser.prototype;

    Object.defineProperty(b, "myAvatarURL", {
      get: function () {
        const value = identity().avatarURL;
        return typeof value === "string" ? value : "";
      },
      set: function (value) {
        // Blaxxun allowed a write; the place definition's
        // `protectavatarurl 1` is what actually forbids it in Outlands.
        // Honour the write only when a provider accepts it.
        const provider = X3D.bxx.identityProvider;
        if (provider && typeof provider.setAvatarURL === "function") {
          provider.setAvatarURL(String(value));
        }
      },
    });

    Object.defineProperty(b, "myAvatarName", {
      get: function () {
        const value = identity().avatarName;
        return typeof value === "string" ? value : "";
      },
    });

    // The historical script assigns this rather than calling it:
    //   Browser.set_myAvatarGesture = 7;
    // so it has to be a settable property, not a method. The world also
    // routes the same value into SharedZone.set_myAvatarGesture, which CTR
    // already carries, so with no sink registered this is a recorded no-op
    // and the gesture still reaches other players by the existing path.
    Object.defineProperty(b, "set_myAvatarGesture", {
      get: function () { return X3D.bxx.lastGesture; },
      set: function (value) {
        const gesture = Number(value) || 0;
        X3D.bxx.lastGesture = gesture;
        if (X3D.bxx.gestureSink) {
          try {
            X3D.bxx.gestureSink(gesture);
          } catch (error) {
            console.warn("bxx_identity: gesture sink failed", error);
          }
        }
      },
    });
  });

})();
