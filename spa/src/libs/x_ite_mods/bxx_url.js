/*eslint no-undef: 0*/
(function () {

  // OUTLANDS-1j - legacy Cybertown `Browser.loadURL` compatibility.
  //
  // The shipped historical worlds still navigate to `http://www.cybertown.com/...`.
  // That domain is dead, and X_ITE 4.7.0 does not treat the call as a failed
  // world load: it reads `target=_top` out of the parameter list and hands the
  // address to `window.open(url, "_top")`, which replaces the whole CTR SPA with
  // a DNS error page. `ne_game.wrl:1159` does this about three seconds after
  // Outlands starts, because no identity provider is registered yet and so no
  // historical team avatar matches.
  //
  // WHAT THIS DOES. It recognises a proven-dead legacy address and does not pass
  // it on. The current world keeps running, untouched.
  //
  // WHAT THIS DOES NOT DO.
  //   * No identity. Nothing here reads, sets or guesses an avatar or a team.
  //     The Outlands team picker is OUTLANDS-2.
  //   * No routing. A suppressed address never reaches `router.push`, `location`
  //     or any other CTR destination. World-authored text is classified and then
  //     discarded, never navigated to. This is the safety gate.
  //   * No general navigation blocking. Anything that is not one of the two
  //     historical Cybertown hosts, or the historical `/cgi-bin/` namespace,
  //     reaches the original `Browser.loadURL` with its arguments untouched.
  //   * No vendor edit. X_ITE is not patched; only `Browser.loadURL` is wrapped,
  //     which is the same seam `bxx_auth.js` and `bxx_events.js` already use.
  //
  // WHY THIS MUST WRAP LAST. `bxx_auth.js` wraps `loadURL` to clear its cached
  // world start time and `bxx_events.js` wraps it to drop the previous world's
  // Browser event listeners. Both are correct for a real world change and both
  // are wrong for a suppressed call - running them would tear down the world
  // that is supposed to survive. The require of this file in `App.vue` therefore
  // comes after both, which makes this the outermost wrapper, so a suppressed
  // call reaches neither of them.
  //
  // The match rule itself lives in `helpers/legacy-url.helper.ts`, with the
  // evidence for every clause. It is pure and unit tested.

  const policy = require("../../helpers/legacy-url.helper");

  // `Browser.loadURL` takes MFStrings, but CTR's own callers pass a plain
  // string parameter (`WorldBrowserPage.vue` calls `loadURL(mfstring, "")`).
  // Read either shape without changing the caller's object.
  function toStringArray(value) {
    if (value === null || value === undefined) { return []; }
    if (typeof value === "string") { return value === "" ? [] : [value]; }
    if (typeof value.length === "number") {
      const out = [];
      for (let i = 0; i < value.length; i += 1) { out.push(String(value[i])); }
      return out;
    }
    return [String(value)];
  }

  X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
    const b = Browser.prototype;

    const originalLoadURL = b.loadURL;

    b.loadURL = function (url, parameter) {
      const decision = policy.classifyLegacyLoadUrl(
        toStringArray(url),
        toStringArray(parameter),
      );

      if (decision.action === policy.PASS_THROUGH) {
        // Hard regression gate: the original call is forwarded verbatim, so a
        // non-legacy address keeps its exact URL list and parameter list.
        return originalLoadURL.apply(this, arguments);
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
