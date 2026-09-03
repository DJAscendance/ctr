import * as https from 'https';

import {
  getMissingTurnstileKeyName,
  getTurnstileConfigState,
  getTurnstileSecretKey,
} from './site-config';

/** Cloudflare's Turnstile server-side verification endpoint. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long to wait for Cloudflare before giving up on a verification. */
const VERIFY_TIMEOUT_MS = 8000;

/** The outcome of a bot-challenge check. */
export interface BotChallengeResult {
  /** Whether the request may proceed. */
  passed: boolean;
  /**
   * Why it may not, for logging. Never returned to the client verbatim -- a caller that
   * echoed Cloudflare's error codes back would be handing an attacker a tuning signal.
   */
  reason?: string;
  /** True when this deployment has no challenge configured, so nothing was checked. */
  skipped?: boolean;
  /**
   * True when the deployment set exactly one of the two Turnstile keys.
   *
   * Kept separate from an ordinary failure because it is not the applicant's fault and
   * they cannot fix it by trying again. The caller uses this to choose a different public
   * message and to log an operator-facing line.
   */
  misconfigured?: boolean;
}

/** The shape of the response Cloudflare returns from siteverify. */
interface SiteVerifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

/**
 * Posts a form-encoded body to Cloudflare and resolves with the parsed JSON reply.
 *
 * Split out so tests can drive `verifyBotChallenge` without network access, and so the
 * timeout/abort handling lives in one place. Rejects on transport failure; it never
 * resolves with a fabricated success.
 */
export type SiteVerifyTransport = (body: string) => Promise<SiteVerifyResponse>;

const httpsTransport: SiteVerifyTransport = (body: string) =>
  new Promise((resolve, reject) => {
    const request = https.request(
      SITEVERIFY_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: VERIFY_TIMEOUT_MS,
      },
      response => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (raw += chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error('Unparseable siteverify response'));
          }
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('siteverify timed out')));
    request.on('error', reject);
    request.write(body);
    request.end();
  });

/**
 * Verifies a Turnstile token server-side.
 *
 * The deployment's TWO keys decide what happens, not the secret alone. Reading only the
 * secret was the defect this replaces: a deployment that set the SITE key and forgot the
 * secret showed every applicant a challenge widget and then verified nothing, so the
 * protection existed only in the browser -- exactly where an automated caller is free to
 * ignore it. That state now fails closed instead of passing silently.
 *
 * Four outcomes, one per configuration state:
 *
 *  * neither key set -> `{ passed: true, skipped: true }`. The deployment has no bot
 *    challenge at all. This is every existing CTR deployment and the local test stack.
 *  * both keys set, token verified by Cloudflare -> `{ passed: true }`.
 *  * both keys set and ANYTHING else -- missing token, rejected token, Cloudflare
 *    unreachable, malformed reply -> `{ passed: false }`. Fails closed on purpose: a
 *    deployment that asked for a bot challenge does not quietly stop having one because
 *    the verifier is having a bad day.
 *  * exactly one key set -> `{ passed: false, misconfigured: true }`. No network call is
 *    made; there is nothing sensible to ask Cloudflare.
 *
 * The client-side widget's own result is never consulted; only this reply is.
 *
 * @param token the `cf-turnstile-response` value submitted by the client
 * @param remoteIp the caller's IP, passed through to Cloudflare when known
 * @param transport override for the HTTPS call, for tests
 */
export async function verifyBotChallenge(
  token: unknown,
  remoteIp?: string,
  transport: SiteVerifyTransport = httpsTransport,
): Promise<BotChallengeResult> {
  const state = getTurnstileConfigState();
  if (state === 'disabled') {
    return { passed: true, skipped: true };
  }
  if (state === 'incomplete') {
    return {
      passed: false,
      misconfigured: true,
      reason: `turnstile-misconfigured: ${getMissingTurnstileKeyName()} is not set`,
    };
  }

  // Non-null once the state is `enabled`; the state check above is what proves it.
  const secret = getTurnstileSecretKey();

  if (typeof token !== 'string' || !token.trim().length) {
    return { passed: false, reason: 'missing-token' };
  }

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (remoteIp) params.append('remoteip', remoteIp);

  try {
    const result = await transport(params.toString());
    if (result && result.success === true) {
      return { passed: true };
    }
    return {
      passed: false,
      reason: (result && result['error-codes'] || []).join(',') || 'rejected',
    };
  } catch (error) {
    return { passed: false, reason: `verifier-unreachable: ${error.message}` };
  }
}
