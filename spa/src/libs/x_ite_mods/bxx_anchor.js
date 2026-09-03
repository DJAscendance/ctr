/*eslint no-undef: 0*/
(function () {

  // LEGACY-LINKS-1 - the second navigation seam: `Anchor`.
  //
  // WHY A SECOND SEAM IS NEEDED. `bxx_url.js` wraps `Browser.loadURL`, which is
  // how a Script node navigates. It is NOT how an `Anchor` node navigates.
  // Verified against the exact bundle the SPA loads (x_ite 4.7.0):
  // `Anchor.requestAsyncLoad` calls
  // `new FileLoader(this).createX3DFromURL(this.url_, this.parameter_, ...)`
  // directly, with its own navigate callback. It never reaches `loadURL`. The
  // shipped worlds hold 63 such nodes, including the Adventure colony's link to
  // Inner Realms, the Flea Market's hidden Black Market booth, the Plaza map
  // sign and the Bank exit door.
  //
  // WHY `createX3DFromURL` AND NOT `loadDocumentAsync`. X_ITE decides whether a
  // request may navigate by whether a `foreign` callback was handed to
  // `createX3DFromURL`:
  //
  //   loadDocumentAsync: this.target.length && "_self" !== this.target
  //                        && this.foreign  ->  this.foreign(url, target)
  //
  // and `foreign` is set in exactly one place - the fifth argument of
  // `createX3DFromURL`. Only two call sites in the whole of X_ITE pass one:
  // `Anchor.requestAsyncLoad` and `Browser.loadURL`. Every other user of
  // `FileLoader` - `Inline`, `createVrmlFromURL`, `createX3DFromURL` on the
  // Browser object, textures, scripts, binary documents - passes `null` for the
  // parameter list and no `foreign` at all.
  //
  // So the presence of `foreign` IS the navigation signature, and gating on it
  // means ordinary scene and asset loading is untouched by construction rather
  // than by a rule that could be got wrong. The Theatre's stage-set fetch, City
  // Hall's dynamic content fetch and the Entertainment colony's map `Inline`
  // are all still classified exactly as they were, because this wrapper never
  // even looks at them.
  //
  // WHAT THIS DOES. For a navigation-capable request it asks the same pure
  // classifier `bxx_url.js` uses, and then either forwards the call verbatim,
  // makes no call at all, or hands a fixed literal CTR route to the navigator
  // in `bxx_route.js`. This file holds no navigation API of its own, so
  // world-authored text cannot reach the router through it.
  //
  // WHAT HAPPENS TO A SUPPRESSED ANCHOR. No request is made. The node keeps its
  // in-progress load state, which nothing reads, and a later click calls
  // `requestAsyncLoad` again, so the door is not made permanently dead. This
  // replaces the present behaviour, which was to fetch a dead address as if it
  // were a scene and fail quietly some seconds later.

  const policy = require("../../helpers/legacy-destination.helper");
  const routes = require("./bxx_route.js");

  X3D.require(["x_ite/InputOutput/FileLoader"], function (FileLoader) {
    const f = FileLoader.prototype;

    const originalCreateX3DFromURL = f.createX3DFromURL;

    f.createX3DFromURL = function (url, parameter, callback, bindViewpoint, foreign) {
      if (typeof foreign !== "function") {
        // Not a navigation-capable request. Scene and asset loading is never
        // examined, never delayed and never reclassified.
        return originalCreateX3DFromURL.apply(this, arguments);
      }

      const decision = policy.classifyLegacyNavigation(
        policy.readFieldStrings(url),
        policy.readFieldStrings(parameter),
      );

      if (decision.action === policy.PASS_THROUGH) {
        // Hard regression gate: the original call is forwarded verbatim.
        return originalCreateX3DFromURL.apply(this, arguments);
      }

      if (decision.action === policy.MAP_TO_CTR_ROUTE) {
        console.info(
          `[bxx_anchor] restored legacy navigation (${decision.reason}, ` +
          `target=${decision.target})`,
        );
        routes.goToLegacyRoute(decision.route);
        return undefined;
      }

      for (let i = 0; i < decision.legacyUrls.length; i += 1) {
        console.warn(
          `[bxx_anchor] suppressed legacy Cybertown navigation: ${decision.legacyUrls[i]}` +
          ` (target=${decision.target})`,
        );
      }

      if (decision.keptUrls.length === 0) {
        // Nothing left to request. Make no call at all.
        return undefined;
      }

      // A mixed list keeps its fallback behaviour, minus the dead entries.
      return originalCreateX3DFromURL.call(
        this,
        new X3D.MFString(...decision.keptUrls),
        parameter,
        callback,
        bindViewpoint,
        foreign,
      );
    };
  });

})();
