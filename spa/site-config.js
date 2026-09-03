/**
 * Deployment policy for the web tier, derived from the environment.
 *
 * The SPA is a static bundle built once, inside a Docker image, so anything the browser
 * needs to know about WHICH deployment it is talking to cannot come from the build --
 * a build-time constant would mean one image per environment, and would put the answer
 * in the wrong place besides. Instead the express server that already serves index.html
 * reads its own environment per boot and stamps the answer into the HTML it sends.
 *
 * That also solves the search-engine half of the problem properly. A `<meta name="robots">`
 * written by Vue after mount is a tag a crawler may never wait for; a tag present in the
 * bytes of the response is not.
 *
 * Every default here is the behaviour CTR has today, so a deployment that sets none of
 * these variables is unchanged: production mode, no label, indexable, no bug-report link,
 * no bot challenge.
 *
 * Kept as plain CommonJS with no dependencies because server.js is plain CommonJS and is
 * run directly by node -- it is never compiled. The pure functions are exported so the test
 * suite can assert on them without booting a server or a browser.
 */

/** Parses an environment flag. Anything other than a recognised truthy word is false. */
function envFlag(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

/** Parses an environment flag that may be absent, in which case `fallback` is used. */
function envFlagOr(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return envFlag(value);
}

/**
 * Escapes the characters that could close the inline <script> the config is embedded in.
 *
 * JSON.stringify alone is not enough: a value containing "</script>" would terminate the
 * element early and everything after it would be parsed as markup. These are configuration
 * values set by whoever runs the deployment rather than by a visitor, so this is defence in
 * depth rather than a live hole -- but the escape costs nothing and the alternative is
 * trusting that no operator ever pastes something odd into an environment variable.
 */
function toScriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Builds the public site configuration from an environment object.
 *
 * PUBLIC is the operative word: everything returned here is shipped to every browser that
 * loads the page. The Turnstile SITE key belongs here (it is designed to be published and
 * is useless without the secret); the Turnstile SECRET key lives only in the API's
 * environment and is never read by this file at all.
 *
 * @param {object} env process.env, or a stand-in
 * @returns {{mode: string, isBeta: boolean, label: string, noindex: boolean,
 *   bugReportUrl: string, turnstileSiteKey: string}}
 */
function buildSiteConfig(env) {
  env = env || {};
  const mode = (env.SITE_MODE || "production").trim().toLowerCase();
  const isBeta = mode === "beta";
  return {
    mode: isBeta ? "beta" : "production",
    isBeta,
    // A beta says so by default; any deployment can override the wording, and production
    // has no label at all unless one is asked for.
    //
    // An EMPTY value counts as "not set", not as "no label". Compose has no way to leave a
    // key out conditionally, so `SITE_LABEL: ${SITE_LABEL:-}` hands this an empty string
    // whenever the operator has not set one -- and treating that as a deliberate blank
    // would strip the BETA badge off the beta deployment, silently, in the one case where
    // showing it matters most. A deployment that genuinely wants no badge is one that is
    // not in beta mode.
    label: String(env.SITE_LABEL || "").trim() || (isBeta ? "BETA" : ""),
    // Beta deployments are not for the index. Deliberately still overridable both ways:
    // this is a request to crawlers, not an access control, and the operator owns it.
    noindex: envFlagOr(env.SITE_NOINDEX, isBeta),
    bugReportUrl: (env.BUG_REPORT_URL || "").trim(),
    turnstileSiteKey: (env.TURNSTILE_SITE_KEY || "").trim(),
  };
}

/** The robots policy a noindex deployment asks for. */
const NOINDEX_DIRECTIVE = "noindex, nofollow, noarchive";

/**
 * Builds the body of /robots.txt for a configuration.
 *
 * Note that the non-noindex case returns a real permissive file rather than nothing. Before
 * this existed the SPA's catch-all answered /robots.txt with index.html -- an HTML page with
 * a 200, which is not a valid robots file and which some crawlers treat as "no rules I can
 * read". An explicit allow-all is both correct and unambiguous.
 */
function buildRobotsTxt(config) {
  if (config.noindex) {
    return "User-agent: *\nDisallow: /\n";
  }
  return "User-agent: *\nDisallow:\n";
}

/**
 * Stamps the deployment's configuration into the served index.html.
 *
 * Three edits, all inside <head> so they are seen before any script runs:
 *
 *   1. the robots meta tag, when this deployment asks not to be indexed;
 *   2. the public config, as a global the SPA reads synchronously at boot -- no extra
 *      round trip, and no window where the app has rendered but does not yet know whether
 *      it is a beta;
 *   3. the label folded into <title>, so a tab or a bookmark shows it too.
 *
 * Idempotent in the sense that matters: it is applied once to the file read from disk, and
 * the result is cached by the caller.
 *
 * @param {string} html the built index.html
 * @param {object} config output of buildSiteConfig
 * @returns {string} the html to serve
 */
function decorateIndexHtml(html, config) {
  const injected = [];
  if (config.noindex) {
    injected.push(`<meta name="robots" content="${NOINDEX_DIRECTIVE}">`);
  }
  // Only the public fields, listed explicitly rather than spread, so that adding a private
  // field to the config object in future cannot leak it into the page by accident.
  const publicConfig = {
    mode: config.mode,
    isBeta: config.isBeta,
    label: config.label,
    noindex: config.noindex,
    bugReportUrl: config.bugReportUrl,
    turnstileSiteKey: config.turnstileSiteKey,
  };
  injected.push(
    `<script>window.__CTR_SITE_CONFIG__=${toScriptSafeJson(publicConfig)};</script>`,
  );

  let out = html;
  if (config.label) {
    out = out.replace(
      /<title>([^<]*)<\/title>/i,
      (match, title) => `<title>${title} (${config.label})</title>`,
    );
  }

  if (out.includes("</head>")) {
    return out.replace("</head>", `${injected.join("")}</head>`);
  }
  // No <head> to extend: prepend rather than silently drop the configuration, which would
  // leave the SPA thinking it was an ordinary production deployment.
  return injected.join("") + out;
}

module.exports = {
  NOINDEX_DIRECTIVE,
  buildSiteConfig,
  buildRobotsTxt,
  decorateIndexHtml,
};
