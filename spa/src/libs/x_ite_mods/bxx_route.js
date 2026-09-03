/*eslint no-undef: 0*/
/**
 * LEGACY-LINKS-1 - the one place a restored historical link becomes an SPA move.
 *
 * WHY THIS IS ITS OWN MODULE. The two X_ITE bindings that classify a legacy
 * link (`bxx_url.js` for `Browser.loadURL`, `bxx_anchor.js` for `Anchor`) must
 * stay free of any navigation API at all, so that reading either file is enough
 * to see that world-authored text cannot reach the router. All the navigating
 * happens here instead, behind a gate that only accepts a route the fixed
 * mapping tables can actually produce.
 *
 * THE GATE. `goToLegacyRoute` compares its argument against
 * `LEGACY_ROUTES` - the sorted list of every literal route written into
 * `helpers/legacy-destination.helper.ts` - and refuses anything else. The
 * classifier already guarantees this, so the check is a second, independent
 * barrier: even a future bug that let world text through the classifier still
 * could not steer the SPA.
 *
 * NO ROUTER OF ITS OWN. `App.vue` hands the live router in during `mounted`,
 * which is the only place in the SPA that has one. Until it does, and if it
 * never does, the fallback writes the same fixed literal into the hash, which
 * is the form this router already uses.
 */
const policy = require("../../helpers/legacy-destination.helper");

let router = null;

/** Register the live vue-router instance. Called once, from `App.vue`. */
function setRouter(instance) {
  router = instance || null;
}

/**
 * Move the SPA to one of the fixed literal routes. Returns `true` when the move
 * was accepted, `false` when the route was refused.
 */
function goToLegacyRoute(route) {
  if (typeof route !== "string" || policy.LEGACY_ROUTES.indexOf(route) === -1) {
    console.warn("[bxx_route] refused a route that is not in the fixed mapping table");
    return false;
  }

  if (router) {
    const current = router.currentRoute;
    if (current && current.path === route) {
      // Already there. vue-router 3 rejects a duplicate push, and re-entering
      // the same place would restart the world that just asked to leave it.
      return true;
    }
    const pending = router.push(route);
    if (pending && typeof pending.catch === "function") {
      // vue-router 3 rejects on a redirected or aborted navigation. That is a
      // routing outcome, not an error worth breaking the running world over.
      pending.catch(function () { });
    }
    return true;
  }

  // No router registered. The literal below is the same table value, written
  // into the hash this router reads.
  window.location.hash = `#${route}`;
  return true;
}

module.exports = { goToLegacyRoute, setRouter };
