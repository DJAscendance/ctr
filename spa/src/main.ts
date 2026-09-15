import Vue from "vue";
import VueRouter, { Route } from "vue-router";
import VueGtag, { pageview } from "vue-gtag";

import App from "./App.vue";
import api from "./api";
import appStore, { Place, User } from "./appStore";
import * as filters from "./helpers/fiters";
import { NavigationScopedValue } from "./helpers/navigation-place.helper";
import routes from "./routes";
import siteConfig from "./site-config";
import socket from "./socket";
import "./assets/index.scss";

Vue.config.productionTip = false;

// register global utilities/filters
Object.keys(filters).forEach(key => {
  Vue.filter(key, filters[key]);
});
Vue.prototype.$http = api;
Vue.prototype.$store = appStore;
Vue.prototype.$socket = socket;

document.querySelector("html").classList.add("dark");

// The app uses hash-based routing, so a direct link like /beta-register only ever
// serves the app shell - the real route lives in the hash. This has to run before
// `new VueRouter(...)`: its hash-mode history normalizes an empty hash to "#/"
// synchronously in its own constructor, so checking window.location.hash after
// construction always sees "/", never the true empty-hash cold-load state. Doing
// it here also resets the pathname to "/", so the URL ends up "/#/beta-register"
// like every other route on the site, not the duplicated-looking
// "/beta-register#/beta-register".
if (window.location.hash === "" && window.location.pathname !== "/") {
  history.replaceState(null, "", `/#${  window.location.pathname}`);
}

const router = new VueRouter({ routes });
Vue.use(VueRouter);

/**
 * Routes a visitor may reach with no session at all.
 *
 * Was an inline array inside the guard; named here because the beta's public front door had
 * to join it and a list this load-bearing should be readable. Adding a name to it makes
 * that page PUBLIC - nothing else on the site is affected.
 */
const PUBLIC_ROUTE_NAMES = [
  "login", "logout", "signup", "forgot", "password_reset",
  "about", "privacypolicy", "rulesandregulations", "constitution", "banned",
  "beta_signup", "beta_landing",
];

/** Suffix appended to every document title on a labelled deployment, e.g. " (BETA)". */
const TITLE_SUFFIX = siteConfig.label ? ` (${siteConfig.label})` : "";

/**
 * The place a navigation fetched, held until vue-router says that navigation landed.
 *
 * The guard below fetches the place for the route it is asked about, and that fetch can
 * finish after its own navigation is gone - superseded by a later one, or cancelled by a
 * return to the route the app is still on, which vue-router rejects as a duplicate before
 * any guard runs for it. Writing the store from the guard therefore let a place the citizen
 * never reached land on top of the place they are standing in. Staging it here and
 * committing it from `afterEach` means only the navigation that actually landed can write
 * the store. See `helpers/navigation-place.helper.ts` for why the route object is the
 * navigation's identity.
 */
const navigationPlace = new NavigationScopedValue<Place>(place => {
  appStore.methods.setPlace(place);
});

router.beforeEach(async (to, from, next) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - Cybertown${TITLE_SUFFIX}`;
  } else {
    document.title = `Cybertown${TITLE_SUFFIX}`;
  }

  // On a beta deployment the front page for someone with no session is the beta landing,
  // not the classic city home page - a stranger must be told what this site is before it
  // asks anything of them. Gated on `isBeta` so an ordinary production deployment keeps the
  // home page it has always had, and skipped once a session exists so a returning citizen
  // is never bounced back out to the front door.
  if (siteConfig.isBeta && to.name === "home" && !appStore.data.isUser
    && !appStore.data.user.token) {
    next({ name: "beta_landing" });
    return;
  }
  if (to.fullPath.includes("/place/")) {
    await api.get<any>(`/place/${to.params.id}`)
      .then(response => {
        const Data = response.data;
        const place = { ...Data.place };
        navigationPlace.stage(to, place);
      });
  } else if (to.fullPath.includes("/club/")) {
    await api.get<any>(`/place/by_id/${to.params.id}`)
      .then(response => {
        const Data = response.data;
        //check if user is a member of the club
        api.get<any>(`/club/ismember?clubId=${Data.place.id}`)
          .then(response => {
            const member = response.data.isMember;
            if (!member) {
              next(`/clubdoor/${Data.place.id}`);
            }
          });
        const place = {
          ...Data.place,
          assets_dir: "club/vrml/",
          world_filename: "vrml.wrl",
        };
        navigationPlace.stage(to, place);
      });
  } else if (to.fullPath.includes("/inbox/") || to.fullPath.includes("/messageboard/")) {
    await api.get<any>(`/place/by_id/${to.params.place_id}`)
      .then(response => {
        const Data = response.data;
        if (Data.place.type === "club" && Data.place.private) {
          api.get<any>(`/club/ismember?clubId=${Data.place.id}`)
            .then(response => {
              const member = response.data.isMember;
              if (!member && to.fullPath.includes("/messageboard/")) {
                api.post<any>("/messageboard/getadmininfo/", {
                  place_id: Data.place.id,
                  type: Data.place.type,
                }).then(response => {
                  if (!response.data.admin) {
                    next(`/clubdoor/${Data.place.id}`);
                  }
                });
              }
              if (!member && to.fullPath.includes("/inbox/")) {
                api.post<any>("/inbox/getadmininfo/", {
                  place_id: Data.place.id,
                  type: Data.place.type,
                }).then(response => {
                  if (!response.data.admin) {
                    next("/clubdoor/${Data.place.id}");
                  }
                });
              }
            });
        }
      });
  } else if (to.fullPath.includes("/clubdoor/")) {
    await api.get<any>(`/place/by_id/${to.params.id}`)
      .then(response => {
        const Data = response.data;
        navigationPlace.stage(to, Data.place);
      });
  } else if (to.fullPath.includes("/home/")) {
    await api.get<any>(`/home/${to.params.username}`)
      .then(response => {
        const Data = response.data;
        const place = {
          ...Data.homeData,
          assets_dir: Data.homeDesignData ?
            (`${Data.homeDesignData.id}/`) : null,
          world_filename: "home.wrl",
          slug: "home",
          block: Data.blockData,
        };
        navigationPlace.stage(to, place);
      });
  }

  if (!PUBLIC_ROUTE_NAMES.includes(to.name)) {
    await api.get<{
      user: User,
      status: number,
      roleName: string,
      banned: boolean,
      banInfo: any,
    }>("/member/session")
      .then(response => {
        const { user } = response.data;
        const { banInfo, banned } = response.data;
        if (banned) {
          if (
            banInfo.type === "jail" &&
            to.fullPath.includes("/messageboard/") ||
            to.fullPath.includes("/inbox/") ||
            to.fullPath.includes("/information/")
          ) {
            next("/restricted");
          } else if (to.fullPath === "/restricted") {
            next();
          } else if (to.fullPath !== "/place/jail" && banInfo.type === "jail") {
            // The redirect below is a navigation of its own, and it matches "/place/",
            // so the guard runs again for it and fetches the jail through the ordinary
            // path above. Staging it against THIS navigation - the one being redirected
            // away from, which will never land - is what keeps the rule single: a place
            // is committed by the navigation that landed, never by one that did not.
            next("/place/jail");
            api.get<any>("/place/jail")
              .then(response => {
                const Data = response.data;
                const place = { ...Data.place };
                navigationPlace.stage(to, place);
              });
          } else if (to.fullPath === "/place/jail") {
            next();
          } else {
            appStore.methods.destroySession();
            next({
              name: "banned",
              params: {
                reason: banInfo.reason,
                enddate: banInfo.end_date,
              },
            });
          }
        }
        appStore.methods.setUser(user);
        appStore.data.isUser = true;
        next();
      }).catch(() => {
        appStore.methods.destroySession();
        if (to.name !== "home") {
          next({
            name: "login",
            query: { redirect: to.fullPath },
          });
        } else {
          next();
        }
      });
  } else {
    next();
  }
});

/**
 * vue-router runs this only for a navigation it CONFIRMED, and runs it synchronously right
 * after the route is updated - before Vue re-renders for the new route on the next tick. So
 * the store still holds the right place by the time the new page is created, and a
 * navigation that was cancelled never gets here at all.
 */
router.afterEach(to => {
  navigationPlace.confirm(to);
});

/**
 * Analytics: same Google tag, same one page_view per landed navigation, same payload.
 *
 * The router is deliberately NOT handed to vue-gtag. vue-gtag 2 - the first release that
 * accepts Vue 3 - tracks routes through Vue Router 4 only: it calls `router.isReady()` and
 * reads `router.currentRoute.value`, and this app runs Router 3, which has neither. Passing
 * the router threw "isReady is not a function" during `Vue.use` and the app never mounted.
 *
 * Its route tracker is small, so it is restated below against Router 3's own `onReady` and
 * `afterEach`, keeping vue-gtag's `pageTrackerSkipSamePath` default. That is the whole of
 * what `pageTrackerTemplate` and the third argument used to do, and it costs a Router major
 * upgrade instead of avoiding one.
 */
Vue.use(VueGtag, {
  config: { id: "G-BCMREM3LDH" },
});

/** One page_view for a route, titled with what the `beforeEach` guard already set. */
function trackPageView(to: Route): void {
  pageview({
    page_title: document.title,
    page_path: to.path,
  });
}

router.onReady(() => {
  trackPageView(router.currentRoute);

  router.afterEach((to, from) => {
    // vue-gtag skips a navigation that lands on the path it started from; so does this.
    if (to.path === from.path) return;
    Vue.nextTick(() => trackPageView(to));
  });
});

new Vue({
  router,
  render: h => h(App),
}).$mount("#app");
