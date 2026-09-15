/**
 * Loads the SPA's REAL route table and REAL page templates into plain Node, so a suite can
 * build the app's own router and render its own `<router-link>`s without a browser.
 *
 * Three things stand between `src/routes.ts` and Node:
 *
 *   1. It imports `.vue` files. Every one is replaced with a stub component here - the
 *      route table needs the records, not the pages.
 *   2. It imports through the `@/` alias. A resolver hook maps that to `src/`.
 *   3. `createWebHashHistory()` reads `window.location`, `window.history` and asks
 *      `document` for a `<base>` tag. A minimal shim of the three is installed BEFORE
 *      vue-router loads, so the router builds the same "#/..." hrefs it builds in the
 *      browser. Nothing here renders into a DOM: `@vue/server-renderer` produces a string.
 *
 * Templates are compiled with `@vue/compiler-dom` straight from the `.vue` source, so the
 * `<router-link>`s a suite renders are the ones the citizen gets.
 */
import * as fs from "fs";
import Module from "module";
import * as path from "path";

export const SPA = path.resolve(__dirname, "../../..");
export const SRC = path.join(SPA, "src");

/* --------------------------------------------------- 3. the window shim */

// Vue's DOM renderer decides whether a document exists when its module loads, and would
// try to use the stub below if it found one. Loading Vue and the server renderer FIRST
// pins them to "no DOM"; only vue-router, loaded later, sees the shim.
/* eslint-disable @typescript-eslint/no-var-requires */
require("vue");
require("@vue/server-renderer");
require("@vue/compiler-dom");
/* eslint-enable @typescript-eslint/no-var-requires */

const location = {
  host: "127.0.0.1",
  hostname: "127.0.0.1",
  protocol: "http:",
  pathname: "/",
  search: "",
  hash: "",
  href: "http://127.0.0.1/",
  origin: "http://127.0.0.1",
  replace(): void { /* never reached: pushState below cannot fail */ },
};
const history = {
  state: null as unknown,
  pushState(state: unknown): void { history.state = state; },
  replaceState(state: unknown): void { history.state = state; },
};
const documentShim = {
  querySelector(): null { return null; },
  addEventListener(): void { /* no DOM events here */ },
  removeEventListener(): void { /* see above */ },
};
const windowShim = {
  location,
  history,
  document: documentShim,
  addEventListener(): void { /* popstate / beforeunload are never fired here */ },
  removeEventListener(): void { /* see above */ },
};
const g = globalThis as any;
if (typeof g.window === "undefined") {
  g.window = windowShim;
  g.location = location;
  g.history = history;
  g.document = documentShim;
}

/* ------------------------------------------- 1 + 2. the module hooks */

const moduleAny = Module as any;
const originalResolve = moduleAny._resolveFilename;
moduleAny._resolveFilename = function resolve(request: string, ...rest: unknown[]): string {
  if (request.endsWith(".vue")) {
    const relative = request.startsWith("@/") ? request.slice(2) : request;
    return path.resolve(SRC, relative);
  }
  if (request.startsWith("@/")) {
    return originalResolve.call(this, path.resolve(SRC, request.slice(2)), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

(Module as any)._extensions[".vue"] = function stubVue(module: any, filename: string): void {
  module.exports = {
    __esModule: true,
    default: { name: path.basename(filename, ".vue"), render: (): null => null },
  };
};

/* ------------------------------------------------------- the helpers */

// Loaded lazily, after the hooks above are in place.
export function loadRoutes(): any[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../src/routes").default;
}

/** Every record in the table, parents and children alike, in declaration order. */
export function flattenRoutes(records: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]): void => {
    for (const record of list) {
      out.push(record);
      if (record.children) walk(record.children);
    }
  };
  walk(records);
  return out;
}

/** The app's router, on the app's own hash history, over the app's own route table. */
export function buildAppRouter(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRouter, createWebHashHistory } = require("vue-router");
  return createRouter({ history: createWebHashHistory(), routes: loadRoutes() });
}

/** The outer `<template>` block of an SFC, as written. */
export function templateOf(file: string): string {
  const source = fs.readFileSync(path.join(SRC, file), "utf8");
  const start = source.indexOf("<template>");
  const end = source.lastIndexOf("</template>");
  if (start < 0 || end < 0) throw new Error(`${file} has no <template> block`);
  return source.slice(start + "<template>".length, end);
}

/**
 * Renders one page's real template to HTML through the app's router, standing on `route`.
 * `data` is whatever state the template reads; `globals` stands in for what `main.ts` puts
 * on every component (`$store` and friends). The page's own script is not loaded.
 */
export async function renderPage(
  file: string,
  route: string,
  data: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
): Promise<string> {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const Vue = require("vue");
  const { compile } = require("@vue/compiler-dom");
  const { renderToString } = require("@vue/server-renderer");
  /* eslint-enable @typescript-eslint/no-var-requires */

  // `onWarn` swallows the compiler's HTML-nesting notes (<tr> straight under <table>); the
  // app's pages have that debt and it is not what these suites measure.
  const { code } = compile(templateOf(file), {
    mode: "function", hoistStatic: false, onWarn: (): void => undefined,
  });
  // eslint-disable-next-line no-new-func
  const render = new Function("Vue", code)(Vue);
  // A function in `data` is a method the template calls; everything else is state.
  const methods: Record<string, unknown> = {};
  const state: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    (typeof value === "function" ? methods : state)[key] = value;
  }
  const page = { name: path.basename(file, ".vue"), data: () => ({ ...state }), methods, render };

  const router = buildAppRouter();
  const app = Vue.createSSRApp(page);
  // Legacy tags such as <font> and <center> are unknown to the compiler and warned about
  // in the browser too; that noise is not what these suites measure.
  app.config.warnHandler = (): void => undefined;
  Object.assign(app.config.globalProperties, globals);
  app.use(router);
  await router.push(route);
  await router.isReady();
  return renderToString(app);
}

/** Every `<a ...>` in `html`, as `{ href, text }`. */
export function anchorsIn(html: string): Array<{ href: string | null; text: string }> {
  const anchors: Array<{ href: string | null; text: string }> = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = (match[1].match(/\bhref="([^"]*)"/) || [])[1];
    anchors.push({
      href: href === undefined ? null : href,
      text: match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return anchors;
}
