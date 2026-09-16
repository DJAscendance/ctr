/**
 * `<router-link>` must render a real `<a href="#/...">`.
 *
 * WHAT IS BEING GUARDED. The Phase 3B release shipped with every `<router-link>` in the
 * app rendering as bare text: no `<a>`, no `href`, no click. The City Map's nine places,
 * the sidebar's Upload and Logout, the Login page's Sign Up - all unreachable. It escaped
 * QA because direct URLs still worked; only clicking did not. This suite renders the REAL
 * templates through the REAL router (see router-harness.ts) and counts anchors, so that
 * class of regression fails here before it reaches a browser.
 *
 * Three pages, chosen for what they proved in that incident:
 *
 *   1. CITY MAP  - nine `<router-link>`s to places, no other logic. The fast detector.
 *   2. LOGIN     - links rendered inside an ordinary page with its own state.
 *   3. TOOLS     - the Mall's Upload link, rendered inside the named "tools" router-view
 *                  slot, which is where the bug was first noticed.
 *
 * A direct URL test does not satisfy this; the anchor is what is asserted.
 */
import assert from "assert";

import { anchorsIn, renderPage } from "./router-harness";

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

const CITY_MAP_PLACES = [
  "funpark", "cityhall", "pool", "theatre", "mall", "enter", "postoffice", "stadium",
  "cafe",
];

async function run(): Promise<void> {
  console.log("\n1. CITY MAP");

  const cityMap = await renderPage("pages/CityMapPage.vue", "/citymap");
  const cityAnchors = anchorsIn(cityMap).filter(a => (a.href || "").startsWith("#/place/"));

  await test("the City Map renders 9 real <a> route links", () => {
    assert.strictEqual(cityAnchors.length, 9, `anchors found: ${JSON.stringify(cityAnchors)}`);
  });

  await test("each of the 9 has a valid hash href to its place", () => {
    const hrefs = cityAnchors.map(a => a.href);
    for (const slug of CITY_MAP_PLACES) {
      assert.ok(hrefs.includes(`#/place/${slug}`), `no anchor to #/place/${slug}`);
    }
  });

  await test("each link keeps its label inside the anchor", () => {
    for (const [index, label] of [
      "FUN PARK", "CITY HALL", "CITY POOL", "THEATER", "THE MALL", "THE PLAZA",
      "POST OFFICE", "CITY STADIUM", "LE CAFE",
    ].entries()) {
      assert.strictEqual(cityAnchors[index].text, label);
    }
  });

  await test("no place name is left as bare text outside an anchor", () => {
    // The bug rendered "THE MALL" as text with no element around it. Every place label
    // must sit inside an <a>; the map's plain <span> landmarks (LIBRARY, EPLEX...) are
    // the only text allowed outside one.
    const withoutAnchors = cityMap.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "");
    for (const label of ["FUN PARK", "CITY HALL", "THE MALL", "THE PLAZA"]) {
      assert.strictEqual(
        withoutAnchors.replace(/\s+/g, " ").includes(label), false,
        `${label} is rendered outside an anchor`,
      );
    }
  });

  await test("a router-link is never rendered as a <span> or <router-link> element", () => {
    assert.strictEqual(/<router-link/.test(cityMap), false, "unresolved <router-link>");
    assert.strictEqual(/<span[^>]*>\s*FUN\s+PARK/.test(cityMap), false, "link became a span");
  });

  console.log("\n2. LOGIN");

  const login = await renderPage("pages/LoginPage.vue", "/login", {
    username: "", password: "", showError: false, error: "", login: (): void => undefined,
  });
  const loginAnchors = anchorsIn(login);

  await test("the Login page's Sign Up link is a real anchor to #/signup", () => {
    assert.ok(
      loginAnchors.some(a => a.href === "#/signup"),
      `anchors: ${JSON.stringify(loginAnchors.map(a => a.href))}`,
    );
  });

  await test("the Login page's password-reset link is a real anchor to #/forgot", () => {
    assert.ok(loginAnchors.some(a => a.href === "#/forgot" && a.text === "here"));
  });

  await test("every router-link on the Login page produced an href", () => {
    const source = require("fs").readFileSync(
      require("path").join(__dirname, "../../../src/pages/LoginPage.vue"), "utf8",
    );
    const expected = (source.match(/<router-link/g) || []).length;
    const hashAnchors = loginAnchors.filter(a => (a.href || "").startsWith("#/"));
    assert.strictEqual(
      hashAnchors.length, expected, `${expected} links, ${hashAnchors.length} anchors`,
    );
  });

  console.log("\n3. WORLD TOOLS (named router-view slot)");

  const tools = await renderPage("pages/world-browser/WorldBrowserTools.vue", "/place/mall", {
    canAdmin: false, isMallStaff: false, opener: (): void => undefined,
  }, {
    $store: { data: { place: { slug: "mall", type: "shop", id: 2 }, user: {} } },
  });
  const toolAnchors = anchorsIn(tools);

  await test("the Mall's Upload link is a real anchor", () => {
    const upload = toolAnchors.find(a => a.text === "Upload");
    assert.ok(upload, `anchors: ${JSON.stringify(toolAnchors)}`);
    assert.ok((upload as { href: string }).href.startsWith("#/"), `href ${upload && upload.href}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
