/**
 * The public URL contract of the SPA, checked against the REAL route table on the REAL
 * hash history the app ships (see router-harness.ts).
 *
 * WHAT IS BEING GUARDED. Every route lives behind "/#/", and the URLs below are the ones
 * bookmarks, legacy links, the login `redirect` query and outside pages point at. A router
 * migration that dropped hash history, renamed a route or let two records share a name
 * would break them silently; each is pinned here.
 *
 * Vue Router 4/5 rule that Router 3 did not have: a record added under a name that already
 * exists REPLACES the earlier record. `/club/:id`'s page was a second "world-browser", which
 * would have deleted `/place/:id`; the table is checked for uniqueness so that cannot
 * return.
 */
import assert from "assert";
import * as fs from "fs";
import * as path from "path";

import { SRC, buildAppRouter, flattenRoutes, loadRoutes } from "./router-harness";

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

const MAIN = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");

/** URL -> the route name it must reach, and the params it must carry. */
const CONTRACT: Array<{ url: string; name: string; params?: Record<string, string> }> = [
  { url: "/login", name: "login" },
  { url: "/signup", name: "signup" },
  { url: "/logout", name: "logout" },
  { url: "/citymap", name: "city_map" },
  { url: "/mall/rules", name: "mall-rules" },
  { url: "/mall/upload", name: "mall-upload" },
  { url: "/place/mall", name: "world-browser", params: { id: "mall" } },
  { url: "/place/enter", name: "world-browser", params: { id: "enter" } },
  { url: "/place/outlands", name: "world-browser", params: { id: "outlands" } },
  { url: "/club/3", name: "club-page", params: { id: "3" } },
  { url: "/rulesandregulations", name: "rulesandregulations" },
  { url: "/beta-register", name: "beta_signup" },
];

async function run(): Promise<void> {
  const router = buildAppRouter();
  const records = flattenRoutes(loadRoutes());

  console.log("\n1. HASH HISTORY");

  await test("main.ts builds the router on createWebHashHistory()", () => {
    assert.ok(/createWebHashHistory\(\)/.test(MAIN), "the app must keep hash history");
    assert.strictEqual(/createWebHistory\(/.test(MAIN), false, "clean URLs would break every link");
  });

  await test("every route resolves to an href behind /#/", () => {
    for (const { url } of CONTRACT) {
      assert.strictEqual(router.resolve(url).href, `#${url}`, `href for ${url}`);
    }
  });

  await test("the Router 3 RouterLink shim is gone from main.ts", () => {
    assert.strictEqual(/router-link-compat|__ctrAnchorFix|\$hasNormal/.test(MAIN), false);
  });

  console.log("\n2. ROUTE CONTRACT");

  for (const { url, name, params } of CONTRACT) {
    await test(`${url} reaches "${name}"`, () => {
      const resolved = router.resolve(url);
      assert.strictEqual(resolved.name, name, `${url} resolved to ${String(resolved.name)}`);
      assert.ok(resolved.matched.length > 0, `${url} matched no record`);
      for (const [key, value] of Object.entries(params || {})) {
        assert.strictEqual(resolved.params[key], value, `${url} param ${key}`);
      }
    });
  }

  await test("a named navigation to a place builds the same URL a link would", () => {
    const resolved = router.resolve({ name: "world-browser", params: { id: "mall" } });
    assert.strictEqual(resolved.fullPath, "/place/mall");
    assert.strictEqual(resolved.href, "#/place/mall");
  });

  await test("an unknown URL matches nothing, and is not silently sent elsewhere", () => {
    const resolved = router.resolve("/no/such/page");
    assert.strictEqual(resolved.matched.length, 0);
  });

  console.log("\n3. ROUTE TABLE");

  await test("the table still has its 110 records", () => {
    assert.strictEqual(records.length, 110);
  });

  await test("no two records share a name", () => {
    const names = records.map(record => record.name).filter(Boolean);
    const dupes = names.filter((name, index) => names.indexOf(name) !== index);
    assert.deepStrictEqual(dupes, [], `duplicate names: ${dupes.join(", ")}`);
  });

  await test("every public route the session guard exempts exists", () => {
    const listed = (MAIN.match(/const PUBLIC_ROUTE_NAMES = \[([\s\S]*?)\];/) || [])[1];
    assert.ok(listed, "PUBLIC_ROUTE_NAMES must stay a literal list in main.ts");
    const names = new Set(records.map(record => record.name));
    for (const name of listed.match(/"([^"]+)"/g) || []) {
      assert.ok(names.has(name.slice(1, -1)), `${name} is exempted but is not a route`);
    }
  });

  await test("the pages that title themselves keep their titles", () => {
    const titled: Record<string, string> = {
      login: "Login", city_map: "City Map", "mall-rules": "Mall Rules",
      banned: "Banned Notice", rulesandregulations: "Rules and Regulations",
    };
    for (const [name, title] of Object.entries(titled)) {
      const record = records.find(entry => entry.name === name);
      assert.ok(record, `no route named ${name}`);
      assert.strictEqual(record.meta && record.meta.title, title, `title of ${name}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
