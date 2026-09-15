/**
 * A club page must stand on ONE WorldBrowserPage.
 *
 * WHAT IS BEING GUARDED. `App.vue` keeps a single, always-mounted `<world-browser-page>`
 * beside its `<router-view>` and picks between the two by route name: the world route
 * shows the singleton and withholds the router-view; every other route does the opposite.
 * The singleton is the only one that may exist - it owns `#world`, the X_ITE canvas, the
 * chat panel and the socket handlers underneath them.
 *
 * Under Vue Router 3 both `/place/:id` and `/club/:id` named their world child
 * "world-browser", so both took the singleton branch. Router 4 and 5 drop the earlier of
 * two records that share a name, so the club child was renamed "club-page" - and the gate
 * in `App.vue`, which lists route names one by one, was not told about the new name. The
 * result: on a club the singleton is hidden AND the router-view renders WorldPage, whose
 * own nested `<router-view>` builds a SECOND WorldBrowserPage. Two `#world` containers,
 * two canvases, two chat panels, two sets of socket handlers.
 *
 * HOW IT IS PROVED. The REAL `App.vue` template is rendered through the REAL route table
 * (see router-harness.ts), with WorldBrowserPage swapped for a marker that carries the
 * same three identities the real page owns, and WorldPage kept as its real template so its
 * nested `<router-view>` is the app's own. The suite then COUNTS what came out.
 *
 * Asserting `route.name === "club-page"` does not satisfy this. The name was correct
 * throughout the defect; what was wrong was how many pages that name produced.
 */
import assert from "assert";

import { buildAppRouter, flattenRoutes, loadRoutes, templateOf } from "./router-harness";

/* eslint-disable @typescript-eslint/no-var-requires */
const Vue = require("vue");
const { compile } = require("@vue/compiler-dom");
const { renderToString } = require("@vue/server-renderer");
/* eslint-enable @typescript-eslint/no-var-requires */

let passed = 0;
let failed = 0;

function test(name: string, body: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1;
      console.log(`  ok   ${name}`);
    })
    .catch((error: Error) => {
      failed += 1;
      console.log(`  FAIL ${name}`);
      console.log(`       ${error.message}`);
    });
}

/** A component built from one SFC's real `<template>`, with no script behind it. */
function fromTemplate(file: string, name: string): any {
  const { code } = compile(templateOf(file), {
    mode: "function", hoistStatic: false, onWarn: (): void => undefined,
  });
  // eslint-disable-next-line no-new-func
  return { name, render: new Function("Vue", code)(Vue) };
}

/**
 * Stands in for WorldBrowserPage, carrying the three things only one of may exist: the
 * `#world` container X_ITE draws into, the canvas it creates there, and the chat panel
 * that subscribes to the room's socket events.
 */
const WORLD_BROWSER_PAGE = {
  name: "WorldBrowserPage",
  render(): unknown {
    return Vue.h("div", { class: "world-browser-page" }, [
      Vue.h("div", { id: "world" }),
      Vue.h("canvas", { class: "x3d-canvas" }),
      Vue.h("div", { class: "chat-panel" }),
    ]);
  },
};

/** The app's own route table, with the two world components made real. */
function stagedRoutes(): any[] {
  const worldPage = fromTemplate("pages/world-browser/WorldPage.vue", "WorldPage");
  const swap = (component: any): any => {
    if (!component) return component;
    if (component.name === "WorldBrowserPage") return WORLD_BROWSER_PAGE;
    if (component.name === "WorldPage") return worldPage;
    return component;
  };
  const routes = loadRoutes();
  for (const record of flattenRoutes(routes)) {
    if (record.component) record.component = swap(record.component);
    if (record.components) {
      for (const slot of Object.keys(record.components)) {
        record.components[slot] = swap(record.components[slot]);
      }
    }
  }
  return routes;
}

/** `App.vue`'s real template, standing on `route`, rendered to HTML. */
async function renderAppAt(route: string): Promise<string> {
  const app = Vue.createSSRApp({
    ...fromTemplate("App.vue", "App"),
    data: () => ({
      siteLabel: "", bugReportUrl: "", outlandsEntrance: false,
      isVotingOpen: false, liveEvent: { enabled: false, place: null },
      jumpGate: "", jumpGateData: [], accessLevel: "none",
    }),
    methods: {
      openWindow: (): void => undefined,
      openCitizenOnlineModal: (): void => undefined,
      openDirectoryModal: (): void => undefined,
      openHowDoIModal: (): void => undefined,
      openInfoModal: (): void => undefined,
      changeJumpGate: (): void => undefined,
    },
  });
  app.config.warnHandler = (): void => undefined;
  Object.assign(app.config.globalProperties, {
    $store: {
      data: { isUser: false, place: {}, user: {}, view3d: true },
      methods: { setView3d: (): void => undefined },
    },
  });
  // The singleton is registered on App.vue itself in the app; here it is global, which is
  // the same tag resolving to the same component.
  app.component("world-browser-page", WORLD_BROWSER_PAGE);

  const router = buildAppRouter(stagedRoutes());
  app.use(router);
  await router.push(route);
  await router.isReady();
  return renderToString(app);
}

function count(html: string, needle: RegExp): number {
  return (html.match(needle) || []).length;
}

const WORLD = /id="world"/g;
const CANVAS = /class="x3d-canvas"/g;
const CHAT = /class="chat-panel"/g;
const PAGE = /class="world-browser-page"/g;

async function run(): Promise<void> {
  console.log("\n1. CLUB - the route that lost the gate");

  const club = await renderAppAt("/club/42");

  await test("a club page renders exactly 1 WorldBrowserPage", () => {
    assert.strictEqual(count(club, PAGE), 1, `world-browser-page count: ${count(club, PAGE)}`);
  });

  await test("a club page renders exactly 1 #world container", () => {
    assert.strictEqual(count(club, WORLD), 1, `#world count: ${count(club, WORLD)}`);
  });

  await test("a club page renders exactly 1 X_ITE canvas", () => {
    assert.strictEqual(count(club, CANVAS), 1, `canvas count: ${count(club, CANVAS)}`);
  });

  await test("a club page renders exactly 1 chat panel", () => {
    assert.strictEqual(count(club, CHAT), 1, `chat panel count: ${count(club, CHAT)}`);
  });

  console.log("\n2. THE OTHER TWO WORLD ROUTES - unchanged controls");

  for (const [label, route] of [["place", "/place/mall"], ["user home", "/home/somebody"]]) {
    const html = await renderAppAt(route);
    await test(`a ${label} page renders exactly 1 WorldBrowserPage`, () => {
      assert.strictEqual(count(html, PAGE), 1, `world-browser-page count: ${count(html, PAGE)}`);
    });
    await test(`a ${label} page renders exactly 1 #world container`, () => {
      assert.strictEqual(count(html, WORLD), 1, `#world count: ${count(html, WORLD)}`);
    });
  }

  console.log("\n3. A PAGE THAT IS NOT A WORLD - the singleton stays hidden, not doubled");

  const cityMap = await renderAppAt("/citymap");

  await test("the City Map still holds only the one hidden singleton", () => {
    assert.strictEqual(
      count(cityMap, PAGE), 1, `world-browser-page count: ${count(cityMap, PAGE)}`,
    );
  });

  await test("the City Map's singleton is hidden with display:none", () => {
    assert.ok(/display:none/.test(cityMap), "the singleton is not hidden off a world route");
  });

  console.log("\n4. THE GATE ITSELF - every world route name is listed in App.vue");

  const template = templateOf("App.vue");
  const worldRouteNames = flattenRoutes(loadRoutes())
    .filter(record => {
      const component = record.component || (record.components || {}).default;
      return Boolean(component) && component.name === "WorldBrowserPage";
    })
    .map(record => record.name);

  await test("the route table still names 3 WorldBrowserPage routes", () => {
    assert.strictEqual(
      worldRouteNames.length, 3, `world route names: ${JSON.stringify(worldRouteNames)}`,
    );
  });

  for (const name of worldRouteNames) {
    await test(`App.vue's gate names the "${name}" route`, () => {
      assert.ok(template.includes(`'${name}'`), `"${name}" is missing from App.vue's gate`);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
