/**
 * The deployment's public configuration, as stamped into index.html by the express server
 * (see spa/site-config.js).
 *
 * Read synchronously at import time rather than fetched, so the very first render already
 * knows whether it is a beta -- there is no frame in which the site shows itself as
 * production and then corrects itself.
 *
 * Everything here is public by construction: it is in the page source of every visitor.
 * Nothing secret may be added to it. The bot-challenge SITE key belongs here; the secret
 * key exists only in the API's environment.
 */

/** Shape of the configuration the server injects. */
export interface SiteConfig {
  /** "beta" or "production". */
  mode: string;
  /** Whether this deployment is a beta and should say so. */
  isBeta: boolean;
  /** Short badge text, e.g. "BETA". Empty when the deployment wants no label. */
  label: string;
  /** Whether this deployment asks search engines not to index it. */
  noindex: boolean;
  /** Where to send bug reports, or empty when this deployment offers no link. */
  bugReportUrl: string;
  /** Cloudflare Turnstile site key, or empty when no bot challenge is configured. */
  turnstileSiteKey: string;
}

/**
 * The values a deployment gets when the server injected nothing -- an ordinary, indexable,
 * unlabelled production site. This is what `npm run serve` and the unit tests see, and it
 * is deliberately the same answer CTR behaved as before any of this existed.
 */
const DEFAULTS: SiteConfig = {
  mode: "production",
  isBeta: false,
  label: "",
  noindex: false,
  bugReportUrl: "",
  turnstileSiteKey: "",
};

const injected = (window as any).__CTR_SITE_CONFIG__ || {};

const siteConfig: SiteConfig = {
  ...DEFAULTS,
  ...injected,
};

export default siteConfig;
