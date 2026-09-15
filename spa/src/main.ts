import { createApp } from "vue";
import {
  createRouter,
  createWebHashHistory,
  RouteLocationNormalized,
  RouteLocationRaw,
} from "vue-router";
import { createGtag } from "vue-gtag";

import App from "./App.vue";
import api from "./api";
import appStore, { Place, User } from "./appStore";
import { NavigationScopedValue } from "./helpers/navigation-place.helper";
import routes from "./routes";
import siteConfig from "./site-config";
import socket from "./socket";
import "./assets/index.scss";

/**
 * Vue Router 4 and 5 install onto an application instance - they provide the router to the
 * tree and register RouterLink/RouterView on the app - so the app is created here, first,
 * and everything that used to hang off the global `Vue` is installed on it instead.
 */
const app = createApp(App);

app.config.globalProperties.$http = api;
app.config.globalProperties.$store = appStore;
app.config.globalProperties.$socket = socket;

document.querySelector("html").classList.add("dark");

// The app uses hash-based routing, so a direct link like /beta-register only ever
// serves the app shell - the real route lives in the hash. This has to run before
// `createWebHashHistory()`: with no explicit base it derives one from the pathname it
// finds, so a cold load of "/beta-register" would otherwise become the base of every
// route and the true empty-hash state could never be told apart from "#/". Doing it
// here also resets the pathname to "/", so the URL ends up "/#/beta-register" like every
// other route on the site, not the duplicated-looking "/beta-register#/beta-register".
if (window.location.hash === "" && window.location.pathname !== "/") {
  history.replaceState(null, "", `/#${  window.location.pathname}`);
}

/**
 * Hash history keeps the public URL contract this app has always had: every route lives
 * behind "/#/", so bookmarks, legacy links and the login `redirect` query all keep working.
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
app.use(router);

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

/**
 * Vue Router 3's guard `next()` could be called any number of times; only the first call
 * counted. Router 4 and 5 take the guard's return value instead, so the session check
 * below collects its first decision through this helper and returns it once, keeping
 * "first decision wins" exactly as it was.
 */
type GuardDecision = RouteLocationRaw | boolean;

/**
 * Vue Router 3 turned a `next(location)` that arrived AFTER its guard had already
 * resolved into a plain `router.push(location)`. The club and message-board membership
 * checks below rely on that: they answer from a request the guard does not await. This
 * is that same late redirect, stated as what it always was.
 */
function redirectLate(location: RouteLocationRaw): void {
  router.push(location);
}

router.beforeEach(async (to: RouteLocationNormalized): Promise<GuardDecision> => {
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
    return { name: "beta_landing" };
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
              redirectLate(`/clubdoor/${Data.place.id}`);
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
                    redirectLate(`/clubdoor/${Data.place.id}`);
                  }
                });
              }
              if (!member && to.fullPath.includes("/inbox/")) {
                api.post<any>("/inbox/getadmininfo/", {
                  place_id: Data.place.id,
                  type: Data.place.type,
                }).then(response => {
                  if (!response.data.admin) {
                    redirectLate("/clubdoor/${Data.place.id}");
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

  if (PUBLIC_ROUTE_NAMES.includes(to.name as string)) {
    return true;
  }

  let decision: GuardDecision | undefined;
  const decide = (choice: GuardDecision): void => {
    if (decision === undefined) decision = choice;
  };

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
          decide("/restricted");
        } else if (to.fullPath === "/restricted") {
          decide(true);
        } else if (to.fullPath !== "/place/jail" && banInfo.type === "jail") {
          // The redirect below is a navigation of its own, and it matches "/place/",
          // so the guard runs again for it and fetches the jail through the ordinary
          // path above. Staging it against THIS navigation - the one being redirected
          // away from, which will never land - is what keeps the rule single: a place
          // is committed by the navigation that landed, never by one that did not.
          decide("/place/jail");
          api.get<any>("/place/jail")
            .then(response => {
              const Data = response.data;
              const place = { ...Data.place };
              navigationPlace.stage(to, place);
            });
        } else if (to.fullPath === "/place/jail") {
          decide(true);
        } else {
          appStore.methods.destroySession();
          // Router 3 carried these two values as route params that were not part of the
          // path. Router 4 and 5 drop such params, so they travel in the history state -
          // the same in-memory, lost-on-reload lifetime they always had.
          decide({
            name: "banned",
            state: {
              reason: banInfo.reason,
              enddate: banInfo.end_date,
            },
          });
        }
      }
      appStore.methods.setUser(user);
      appStore.data.isUser = true;
      decide(true);
    }).catch(() => {
      appStore.methods.destroySession();
      if (to.name !== "home") {
        decide({
          name: "login",
          query: { redirect: to.fullPath },
        });
      } else {
        decide(true);
      }
    });

  return decision;
});

/**
 * vue-router runs this only for a navigation it CONFIRMED, and runs it synchronously right
 * after the route is updated - before Vue re-renders for the new route on the next tick. So
 * the store still holds the right place by the time the new page is created, and a
 * navigation that was cancelled never gets here at all.
 *
 * Router 4 and 5 differ from Router 3 in one way here: a navigation that did NOT land - a
 * duplicate of the current route, or one a guard aborted - also reaches `afterEach`, with
 * the failure as the third argument. Those are skipped, so the rule above still holds.
 */
router.afterEach((to, from, failure) => {
  if (failure) return;
  navigationPlace.confirm(to);
});

/**
 * Analytics: same Google tag, one page_view per landed navigation, same payload.
 *
 * vue-gtag 3 tracks Vue Router 4/5 natively: it waits for `router.isReady()`, sends one
 * page_view for the route the app opened on, then one per `afterEach` whose path differs
 * from the one it left - the same rule the Router 3 bridge this replaces had restated by
 * hand. Its default template would title each page_view with the route NAME; the template
 * below keeps sending the document title the guard above sets, as this app always has.
 */
/** The routes WorldBrowserPage titles after the place it shows, once it has rendered. */
const WORLD_ROUTE_NAMES = ["world-browser", "user-home", "club-page"];

/**
 * The title a page_view carries. It is the document title the guard set, except on a world
 * route, where WorldBrowserPage sets `"<place> - Cybertown"` one tick later than vue-gtag
 * tracks the navigation; the same string is built here from the place that navigation
 * landed, which `afterEach` above has already committed to the store by this point.
 */
function pageTitleFor(route: RouteLocationNormalized): string {
  const { name } = appStore.data.place;
  if (WORLD_ROUTE_NAMES.includes(route.name as string) && name) {
    return `${name} - Cybertown`;
  }
  return document.title;
}

app.use(createGtag({
  tagId: "G-BCMREM3LDH",
  pageTracker: {
    router,
    template: route => ({
      page_title: pageTitleFor(route),
      page_path: route.path,
    }),
  },
}));

app.mount("#app");
