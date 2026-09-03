/**
 * The web tier's deployment policy: which environment this is, whether it says so, and
 * whether it asks to be indexed.
 *
 * Most of what is asserted here is what happens when NOTHING is configured, because that is
 * the promise this makes to every existing CTR deployment: an unset environment is an
 * ordinary, indexable, unlabelled production site, exactly as before.
 *
 * `spa/site-config.js` is plain CommonJS -- server.js is run directly by node and is never
 * compiled -- so it is pulled in with `require` rather than `import`.
 *
 * Six parts:
 *
 *   1. DEFAULTS   - an unconfigured deployment.
 *   2. BETA MODE  - what SITE_MODE=beta turns on, and that each piece is overridable.
 *   3. ROBOTS.TXT - the crawl policy for both modes.
 *   4. HTML       - the meta tag, the injected config and the title label.
 *   5. SECRETS    - what must never reach the page.
 *   6. ESCAPING   - the injected JSON cannot break out of its <script>.
 */
import assert from "assert";

const path = require("path");

// Compiled output lands in tests/.compiled/tests/, so the module is resolved from the spa
// directory rather than relative to this file - the same way server-presence.test.ts finds
// server.js.
const SPA_DIR = path.resolve(__dirname, "../../..");
const {
  NOINDEX_DIRECTIVE,
  buildSiteConfig,
  buildRobotsTxt,
  decorateIndexHtml,
} = require(path.join(SPA_DIR, "site-config.js"));

const INDEX_HTML = [
  "<!DOCTYPE html><html><head>",
  "<meta charset=\"utf-8\">",
  "<title>Cybertown</title>",
  "</head><body><div id=\"app\"></div></body></html>",
].join("");

let passed = 0;
let failed = 0;

function test(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(error as Error).message}`);
  }
}

/* ------------------------------------------------- 1. DEFAULTS ---- */
console.log("\n1. DEFAULTS");

test("an empty environment is an ordinary production site", () => {
  const config = buildSiteConfig({});
  assert.strictEqual(config.mode, "production");
  assert.strictEqual(config.isBeta, false);
  assert.strictEqual(config.label, "");
  assert.strictEqual(config.noindex, false);
  assert.strictEqual(config.bugReportUrl, "");
  assert.strictEqual(config.turnstileSiteKey, "");
});

test("a missing environment object is treated as an empty one", () => {
  assert.strictEqual(buildSiteConfig(undefined).mode, "production");
});

test("an unrecognised SITE_MODE is production, not a third mode", () => {
  const config = buildSiteConfig({ SITE_MODE: "staging" });
  assert.strictEqual(config.mode, "production");
  assert.strictEqual(config.isBeta, false);
});

/* ------------------------------------------------ 2. BETA MODE ---- */
console.log("\n2. BETA MODE");

test("SITE_MODE=beta turns on the label and the noindex policy together", () => {
  const config = buildSiteConfig({ SITE_MODE: "beta" });
  assert.strictEqual(config.isBeta, true);
  assert.strictEqual(config.label, "BETA");
  assert.strictEqual(config.noindex, true);
});

test("SITE_MODE is case- and whitespace-insensitive", () => {
  assert.strictEqual(buildSiteConfig({ SITE_MODE: " BeTa " }).isBeta, true);
});

test("the label can be overridden", () => {
  assert.strictEqual(
    buildSiteConfig({ SITE_MODE: "beta", SITE_LABEL: "TEST CITY" }).label,
    "TEST CITY",
  );
});

test("an EMPTY label on a beta still shows BETA, because compose cannot omit a key", () => {
  // `SITE_LABEL: ${SITE_LABEL:-}` in docker-compose.beta.yml passes "" whenever the
  // operator set nothing, so "" has to mean "not set" rather than "no badge please".
  assert.strictEqual(buildSiteConfig({ SITE_MODE: "beta", SITE_LABEL: "" }).label, "BETA");
  assert.strictEqual(buildSiteConfig({ SITE_MODE: "beta", SITE_LABEL: "   " }).label, "BETA");
});

test("an empty label on production is still no label", () => {
  assert.strictEqual(buildSiteConfig({ SITE_LABEL: "" }).label, "");
});

test("a production deployment can still ask for a label", () => {
  assert.strictEqual(buildSiteConfig({ SITE_LABEL: "STAGING" }).label, "STAGING");
});

test("noindex can be switched off on a beta", () => {
  assert.strictEqual(
    buildSiteConfig({ SITE_MODE: "beta", SITE_NOINDEX: "false" }).noindex,
    false,
  );
});

test("noindex can be switched on outside a beta", () => {
  assert.strictEqual(buildSiteConfig({ SITE_NOINDEX: "true" }).noindex, true);
});

test("an empty SITE_NOINDEX falls back to the mode rather than to false", () => {
  assert.strictEqual(buildSiteConfig({ SITE_MODE: "beta", SITE_NOINDEX: "" }).noindex, true);
});

test("the bug-report URL and Turnstile site key come through trimmed", () => {
  const config = buildSiteConfig({
    BUG_REPORT_URL: " https://github.com/DJAscendance/ctr/issues ",
    TURNSTILE_SITE_KEY: " 0xSITEKEY ",
  });
  assert.strictEqual(config.bugReportUrl, "https://github.com/DJAscendance/ctr/issues");
  assert.strictEqual(config.turnstileSiteKey, "0xSITEKEY");
});

/* ----------------------------------------------- 3. ROBOTS.TXT ---- */
console.log("\n3. ROBOTS.TXT");

test("a beta disallows every crawler from everything", () => {
  const body = buildRobotsTxt(buildSiteConfig({ SITE_MODE: "beta" }));
  assert.ok(/^User-agent: \*$/m.test(body), body);
  assert.ok(/^Disallow: \/$/m.test(body), body);
});

test("production serves a real allow-all file, not a disallow", () => {
  const body = buildRobotsTxt(buildSiteConfig({}));
  assert.ok(/^User-agent: \*$/m.test(body), body);
  assert.ok(/^Disallow:$/m.test(body), body);
  assert.ok(!/^Disallow: \/$/m.test(body), body);
});

/* ------------------------------------------------------ 4. HTML ---- */
console.log("\n4. HTML");

test("a beta's HTML carries the robots meta tag", () => {
  const html = decorateIndexHtml(INDEX_HTML, buildSiteConfig({ SITE_MODE: "beta" }));
  assert.ok(
    html.includes(`<meta name="robots" content="${NOINDEX_DIRECTIVE}">`),
    html,
  );
  assert.strictEqual(NOINDEX_DIRECTIVE, "noindex, nofollow, noarchive");
});

test("production's HTML carries NO robots meta tag", () => {
  const html = decorateIndexHtml(INDEX_HTML, buildSiteConfig({}));
  assert.strictEqual(html.indexOf("name=\"robots\""), -1, html);
});

test("the meta tag lands inside <head>, where a crawler reads it", () => {
  const html = decorateIndexHtml(INDEX_HTML, buildSiteConfig({ SITE_MODE: "beta" }));
  assert.ok(html.indexOf("name=\"robots\"") < html.indexOf("</head>"), html);
});

test("the config is injected for every deployment, beta or not", () => {
  const html = decorateIndexHtml(INDEX_HTML, buildSiteConfig({}));
  assert.ok(html.includes("window.__CTR_SITE_CONFIG__="), html);
});

test("the injected config round-trips as JSON", () => {
  const html = decorateIndexHtml(
    INDEX_HTML,
    buildSiteConfig({ SITE_MODE: "beta", BUG_REPORT_URL: "https://example.test/issues" }),
  );
  const match = html.match(/window\.__CTR_SITE_CONFIG__=(\{.*?\});<\/script>/);
  assert.ok(match, "no injected config found");
  const parsed = JSON.parse(match[1]);
  assert.strictEqual(parsed.isBeta, true);
  assert.strictEqual(parsed.label, "BETA");
  assert.strictEqual(parsed.bugReportUrl, "https://example.test/issues");
});

test("the label is folded into the document title", () => {
  const html = decorateIndexHtml(INDEX_HTML, buildSiteConfig({ SITE_MODE: "beta" }));
  assert.ok(html.includes("<title>Cybertown (BETA)</title>"), html);
});

test("an unlabelled deployment's title is untouched", () => {
  const html = decorateIndexHtml(INDEX_HTML, buildSiteConfig({}));
  assert.ok(html.includes("<title>Cybertown</title>"), html);
});

test("HTML with no <head> still receives the config rather than losing it", () => {
  const html = decorateIndexHtml("<div id=\"app\"></div>", buildSiteConfig({}));
  assert.ok(html.includes("window.__CTR_SITE_CONFIG__="), html);
});

/* --------------------------------------------------- 5. SECRETS ---- */
console.log("\n5. SECRETS");

test("no secret-looking environment variable reaches the page", () => {
  const config = buildSiteConfig({
    SITE_MODE: "beta",
    TURNSTILE_SITE_KEY: "0xSITEKEY",
    TURNSTILE_SECRET_KEY: "0xSECRETKEY",
    JWT_SECRET: "jwt-secret-value",
    DB_PASS: "db-password-value",
    // The mail credentials. They belong to the API service alone. This file must not read
    // them even by accident -- and on a host where both services are started from one
    // environment file, they are sitting right here in this same process environment.
    SMTP_USER: "smtp-user-value",
    SMTP_PASS: "smtp-password-value",
  });
  const html = decorateIndexHtml(INDEX_HTML, config);

  // The SITE key is public by design and must be there; nothing else may be.
  assert.ok(html.includes("0xSITEKEY"), "the public site key should be injected");
  [
    "0xSECRETKEY",
    "jwt-secret-value",
    "db-password-value",
    "smtp-user-value",
    "smtp-password-value",
  ].forEach(secret => {
    assert.strictEqual(html.indexOf(secret), -1, `${secret} leaked into the page`);
  });
});

test("the injected object carries only the known public fields", () => {
  const config = buildSiteConfig({ SITE_MODE: "beta" });
  (config as Record<string, unknown>).internalOnly = "must-not-ship";
  const html = decorateIndexHtml(INDEX_HTML, config);
  assert.strictEqual(html.indexOf("must-not-ship"), -1, html);
});

/* -------------------------------------------------- 6. ESCAPING ---- */
console.log("\n6. ESCAPING");

test("a value containing </script> cannot close the injected element", () => {
  const config = buildSiteConfig({
    BUG_REPORT_URL: "https://x.test/</script><script>alert(1)</script>",
  });
  const html = decorateIndexHtml(INDEX_HTML, config);
  assert.strictEqual(html.indexOf("</script><script>alert(1)"), -1, html);
  assert.ok(html.includes("\\u003c"), html);
});

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
