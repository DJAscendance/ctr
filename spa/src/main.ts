import Vue from "vue";
import VueRouter from "vue-router";
import VueGtag from "vue-gtag";

import App from "./App.vue";
import api from "./api";
import appStore, { User } from "./appStore";
import * as filters from "./helpers/fiters";
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
        appStore.methods.setPlace(place);
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
        appStore.methods.setPlace(place);
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
        appStore.methods.setPlace(Data.place);
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
        appStore.methods.setPlace(place);
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
            next("/place/jail");
            api.get<any>("/place/jail")
              .then(response => {
                const Data = response.data;
                const place = { ...Data.place };
                appStore.methods.setPlace(place);
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

Vue.use(VueGtag, {
  pageTrackerTemplate(to) {
    return {
      page_title: document.title,
      page_path: to.path,
    };
  },
  config: { id: "G-BCMREM3LDH" },
}, router);

new Vue({
  router,
  render: h => h(App),
}).$mount("#app");
