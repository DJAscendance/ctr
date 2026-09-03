/*eslint no-undef: 0*/
(function () {

  // OUTLANDS-1j - legacy Cybertown `Browser.loadURL` compatibility.
  // LEGACY-LINKS-1 - proven fixed-route restoration on the same seam.
  //
  // The shipped historical worlds still navigate to dead historical addresses.
  // X_ITE 4.7.0 does not treat such a call as a failed world load: it reads
  // `target=_top` out of the parameter list and hands the address to
  // `window.open(url, "_top")`, which replaces the whole CTR SPA with a DNS
  // error page. `ne_game.wrl:1159` does this about three seconds after Outlands
  // starts, because no identity provider is registered yet and so no historical
  // team avatar matches.
  //
  // WHAT THIS DOES NOW. It asks the pure classifier what the call means and
  // then does one of three things:
  //
  //   PASS_THROUGH      forward the caller's own arguments, untouched.
  //   SUPPRESS_LEGACY   drop the dead addresses; if nothing is left, make no
  //                     call at all, so the world that is playing survives.
  //   MAP_TO_CTR_ROUTE  hand a fixed literal CTR route to the navigator in
  //                     `bxx_route.js`, and make no X_ITE call.
  //
  // WHAT THIS DOES NOT DO.
  //   * No identity. Nothing here reads, sets or guesses an avatar or a team.
  //     The Outlands team picker is OUTLANDS-2.
  //   * No routing of world text. This file holds no navigation API at all.
  //     The only value it can pass to the navigator is a route the classifier
  //     read out of a fixed table, and the navigator checks it again against
  //     that same table before acting. World-authored text is matched and then
  //     discarded, never navigated to. This is the safety gate.
  //   * No general navigation blocking. Anything the classifier does not
  //     recognise reaches the original `Browser.loadURL` with its arguments
  //     untouched.
  //   * No vendor edit. X_ITE is not patched; only `Browser.loadURL` is
  //     wrapped, which is the same seam `bxx_auth.js` and `bxx_events.js`
  //     already use.
  //
  // WHY THIS MUST WRAP LAST. `bxx_auth.js` wraps `loadURL` to clear its cached
  // world start time and `bxx_events.js` wraps it to drop the previous world's
  // Browser event listeners. Both are correct for a real world change and both
  // are wrong for a suppressed or re-routed call - running them would tear down
  // the world that is supposed to survive. The require of this file in
  // `App.vue` therefore comes after both, which makes this the outermost
  // wrapper, so such a call reaches neither of them.
  //
  // The match rule itself lives in `helpers/legacy-url.helper.ts` and
  // `helpers/legacy-destination.helper.ts`, with the evidence for every clause.
  // Both are pure and unit tested.

  const policy = require("../../helpers/legacy-destination.helper");
  const routes = require("./bxx_route.js");

  X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
    const b = Browser.prototype;

    const originalLoadURL = b.loadURL;

    b.loadURL = function (url, parameter) {
      const decision = policy.classifyLegacyNavigation(
        policy.readFieldStrings(url),
        policy.readFieldStrings(parameter),
      );

      if (decision.action === policy.PASS_THROUGH) {
        // Hard regression gate: the original call is forwarded verbatim, so a
        // non-legacy address keeps its exact URL list and parameter list.
        return originalLoadURL.apply(this, arguments);
      }

      if (decision.action === policy.MAP_TO_CTR_ROUTE) {
        console.info(
          `[bxx_url] restored legacy navigation (${decision.reason}, ` +
          `target=${decision.target})`,
        );
        routes.goToLegacyRoute(decision.route);
        return undefined;
      }

      for (let i = 0; i < decision.legacyUrls.length; i += 1) {
        console.warn(
          `[bxx_url] suppressed legacy Cybertown navigation: ${decision.legacyUrls[i]}` +
          ` (target=${decision.target})`,
        );
      }

      if (decision.keptUrls.length === 0) {
        // Nothing left to load. Make no call at all, so the wrappers below this
        // one never run and the world that is playing right now survives.
        return undefined;
      }

      // A mixed list keeps its fallback behaviour, minus the dead entries.
      return originalLoadURL.call(
        this,
        new X3D.MFString(...decision.keptUrls),
        parameter,
      );
    };
  });

})();
