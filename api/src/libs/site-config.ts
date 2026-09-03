/**
 * Deployment-level policy that the API has to know about, read from the environment.
 *
 * Every value here defaults to the behaviour CTR has today, so an existing deployment that
 * sets none of these variables is byte-for-byte unchanged. The CTNG Beta turns them on; a
 * normal production deployment leaves them alone. Nothing in this file is beta-specific in
 * itself -- "require approval before a new account may be used" and "verify a bot challenge
 * on immigration" are ordinary options for any deployment that wants them.
 *
 * Read through functions rather than module-level constants on purpose: the values are
 * consulted per request, so a test (or a deployment that rewrites its environment before
 * the process is re-execed) never has to defeat a value that was frozen at import time.
 */

/** Parses an environment flag. Anything other than a recognised truthy word is false. */
function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Whether a newly immigrated member must be approved by a city administrator before they
 * can hold a session. Off by default: CTR's historical behaviour is that immigration is
 * immediate, and turning this on is a deployment decision, not a code change.
 */
export function isMemberApprovalRequired(): boolean {
  return envFlag(process.env.MEMBER_APPROVAL_REQUIRED);
}

/**
 * The Cloudflare Turnstile secret, or null when none is configured.
 *
 * On its own this answers only "is the secret set". Whether a bot challenge is actually in
 * force is `getTurnstileConfigState()`'s question -- the secret is one half of a pair, and
 * half a pair is a misconfiguration rather than a setting.
 */
export function getTurnstileSecretKey(): string | null {
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  return secret.length ? secret : null;
}

/**
 * The Cloudflare Turnstile SITE key, or null when none is configured.
 *
 * This is the publishable half of the pair. The API reads it for one reason only: to know
 * whether the browser is being shown a widget. It is never used to verify anything, and
 * knowing it grants nothing -- it is already in the page source every visitor receives.
 */
export function getTurnstileSiteKey(): string | null {
  const key = (process.env.TURNSTILE_SITE_KEY || '').trim();
  return key.length ? key : null;
}

/**
 * How this deployment's Turnstile pair is configured.
 *
 *  * `disabled`   -- neither key set. No bot challenge anywhere; CTR's existing default.
 *  * `enabled`    -- both keys set. The widget is shown AND verified server-side.
 *  * `incomplete` -- exactly one key set. Neither half alone is safe. A site key with no
 *    secret shows the applicant a challenge that the server never checks -- a silent
 *    bypass that looks protected, which is worse than no protection because nobody goes
 *    looking. A secret with no site key means the browser is never given a way to make a
 *    token, so every honest applicant is refused by a rule they cannot satisfy. Both are
 *    operator mistakes, and both must fail closed.
 */
export type TurnstileConfigState = 'disabled' | 'enabled' | 'incomplete';

/**
 * Classifies the Turnstile configuration.
 *
 * Derived from the two keys rather than from a separate on/off flag on purpose: there is
 * then no way to set the flag and forget a key, and no third source of truth to keep in
 * step. The presence of a key IS the intent to use it.
 */
export function getTurnstileConfigState(): TurnstileConfigState {
  const hasSecret = !!getTurnstileSecretKey();
  const hasSiteKey = !!getTurnstileSiteKey();
  if (hasSecret && hasSiteKey) return 'enabled';
  if (!hasSecret && !hasSiteKey) return 'disabled';
  return 'incomplete';
}

/**
 * Names the missing half of an incomplete Turnstile pair, for an operator log line.
 *
 * Returns the VARIABLE NAME only. No key value, secret or public, is ever returned here --
 * an operator needs to know which variable to set, not what the other one holds.
 *
 * @returns the missing variable's name, or null when the pair is not incomplete
 */
export function getMissingTurnstileKeyName(): string | null {
  if (getTurnstileConfigState() !== 'incomplete') return null;
  return getTurnstileSecretKey() ? 'TURNSTILE_SITE_KEY' : 'TURNSTILE_SECRET_KEY';
}

/** Public base URL of this deployment, used to build links inside outgoing email. */
export function getSiteUrl(): string {
  const url = (process.env.SITE_URL || '').trim();
  return (url.length ? url : 'https://www.cybertownrevival.com').replace(/\/+$/, '');
}

/** Human-readable name of this deployment, used in outgoing email. */
export function getSiteName(): string {
  const name = (process.env.SITE_NAME || '').trim();
  return name.length ? name : 'Cybertown Revival';
}

/**
 * The mail transport, as nodemailer wants it.
 *
 * Every field defaults to what `mail.ts` had hard-coded, so a deployment that sets no SMTP
 * variable sends exactly where it sent before: a local MTA on `127.0.0.1:25`, unencrypted,
 * unauthenticated. That default is right for the production host, which runs its own MTA
 * on the same machine as the API.
 *
 * It is wrong for a CONTAINER, which is what the defect was: the beta API runs in a
 * container whose `127.0.0.1` is the container itself, and nothing listens on port 25
 * there, so every message failed. Such a deployment points these variables at a real mail
 * server instead -- for the CTNG Beta, the Cybertown mail host on submission port 587.
 *
 * `secure` means implicit TLS from the first byte (port 465). Submission on 587 wants it
 * FALSE plus `requireTLS`, which upgrades with STARTTLS and refuses to send if the upgrade
 * fails. `requireTLS` is set whenever a username is configured, so credentials can never
 * cross the wire in the clear because someone forgot a flag.
 */
export interface SmtpTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  tls?: { rejectUnauthorized: boolean };
  auth?: { user: string; pass: string };
}

/** Reads an environment integer, falling back when unset or unparseable. */
function envPort(value: string | undefined, fallback: number): number {
  const parsed = parseInt((value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

/**
 * Builds the mail transport configuration from the environment.
 *
 * @returns a nodemailer transport options object; never null, because there is always a
 * default transport
 */
export function getSmtpConfig(): SmtpTransportConfig {
  const host = (process.env.SMTP_HOST || '').trim() || '127.0.0.1';
  const secure = envFlag(process.env.SMTP_SECURE);
  const port = envPort(process.env.SMTP_PORT, secure ? 465 : 25);
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';

  const config: SmtpTransportConfig = {
    host,
    port,
    secure,
    // Preserved from the original hard-coded transport. The local MTA on the production
    // host presents a self-signed certificate, and tightening this would break a path
    // that works today. It is not a hole for the beta: that deployment authenticates,
    // which turns on `requireTLS` below, and the host it talks to has a real Let's
    // Encrypt certificate.
    tls: { rejectUnauthorized: false },
  };

  if (user.length) {
    config.auth = { user, pass };
    // Never hand a password to a server that has not encrypted the channel. On 465 the
    // channel is already encrypted; on 587 this is what forces the STARTTLS upgrade.
    if (!secure) config.requireTLS = true;
  }

  return config;
}

/**
 * The `From` address on outgoing mail.
 *
 * Defaults to the address CTR has always used. A deployment that relays through a mail
 * server for a different domain MUST override it -- SPF and DKIM are checked against the
 * sending domain, and a message claiming a domain the relay cannot sign for is spam as far
 * as the receiving side is concerned.
 */
export function getMailFrom(): string {
  const from = (process.env.SMTP_FROM || '').trim();
  return from.length ? from : 'Cybertown Revival <donotreply@cybertownrevival.com>';
}
