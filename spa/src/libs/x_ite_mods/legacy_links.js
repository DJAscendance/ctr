/*
 * Route the archived worlds' internal Cybertown links back into this
 * application.
 *
 * The 3D controls in the historical worlds navigate through Browser.loadURL(),
 * handing it URLs aimed at www.cybertown.com. Rather than rewriting the same
 * dead link form in every archived file, this patch translates it once, at the
 * point the browser is asked to follow it.
 *
 * Only links the resolver has evidence for are followed. A link that is
 * recognisably a legacy Cybertown link with no proven destination is refused
 * and reported, never guessed at; anything that is not a legacy Cybertown link
 * reaches the original loadURL() untouched, which is what keeps ordinary world
 * loading and genuinely external banners working.
 */
(function () {
  const legacyLinks = require("../legacy_links.js");

  X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
    const proto = Browser.prototype;
    const originalLoadURL = proto.loadURL;

    if (typeof originalLoadURL !== "function") {
      console.warn("[legacy_links] X3DBrowser has no loadURL; patch skipped");
      return;
    }

    proto.loadURL = function (url, parameter) {
      // MFString, plain array and bare string all reach this method.
      let candidates = [];
      if (typeof url === "string") {
        candidates = [url];
      } else if (url && typeof url.length === "number") {
        for (let i = 0; i < url.length; i += 1) {
          candidates.push(String(url[i]));
        }
      }

      for (let c = 0; c < candidates.length; c += 1) {
        const resolved = legacyLinks.resolveLegacyUrl(candidates[c]);
        if (!resolved) {
          continue;
        }
        if (resolved.route) {
          // A hash route keeps this inside the running application, so the
          // socket connection and the rest of the page survive the move.
          window.location.assign(resolved.route);
          return Promise.resolve();
        }
        console.warn(
          `[legacy_links] refusing legacy Cybertown link ` +
            `${candidates[c]}: ${resolved.unresolved}`,
        );
        return Promise.resolve();
      }

      return originalLoadURL.apply(this, arguments);
    };
  });
})();
