/**
 * OUTLANDS-1j - legacy Cybertown `Browser.loadURL` compatibility policy.
 *
 * WHAT THIS SOLVES. The shipped historical worlds still call `Browser.loadURL`
 * with absolute `http://www.cybertown.com/...` addresses. That domain no longer
 * resolves. X_ITE 4.7.0 does not treat such a call as a failed world load: its
 * `FileLoader.getTarget()` pulls `_top` out of the `target=_top` parameter and
 * `loadDocumentAsync` then hands the address to the browser's own
 * `function (url, target) { target ? window.open(url, target) : location = url; }`.
 * `window.open(url, "_top")` is a top-level navigation, so the whole CTR SPA is
 * replaced by a DNS error page. No fetch happens first and no same-origin check
 * applies, which is why the dead address cannot fail harmlessly.
 *
 * THE PROVEN OUTLANDS CASE. `assets/worlds/ne_game/vrml/ne_game.wrl:1159`:
 *
 *   if (team < 0) {
 *     Browser.loadURL(
 *       new MFString('http://www.cybertown.com/cgi-bin/cybertown/place?plc=ne_game'),
 *       new MFString('target=_top'));
 *     return;
 *   }
 *
 * `DEF teamTimer TimeSensor { cycleInterval 3 }` is routed to `battle.set_team`,
 * `team` starts at -1, and `set_team()` only clears it when `Browser.myAvatarURL`
 * equals one of five fixed historical avatar addresses. CTR registers no identity
 * provider yet, so `myAvatarURL` is the empty string, no team matches, and the
 * call fires about three seconds after the world starts.
 *
 * The historical destination is the Outlands entrance page - `enter.tmpl`, the
 * team-avatar picker - so the call means "no team avatar is set, go and pick
 * one". CTR has no such page yet. Mapping the address to `#/place/outlands`
 * would reload the same world, restart the same timer and loop forever, so this
 * module deliberately produces no route. Building the picker is OUTLANDS-2.
 *
 * WHAT THIS MODULE DOES. It classifies a URL string, and nothing else. It has no
 * DOM access, no X_ITE access, no router access and no side effects. The X_ITE
 * binding in `libs/x_ite_mods/bxx_url.js` is what acts on the classification.
 *
 * THE RULE, AND WHY IT IS THIS NARROW.
 *
 *   1. Only `http` and `https` are examined. Every other scheme passes through
 *      untouched. The historical worlds also carry `javascript:` arguments
 *      (`enter/vrml/enter.wrl:708`, `blackmarket/vrml/blackmarket.wrl:1757`,
 *      `000/home.wrl:501`); those keep their present behaviour exactly, and are
 *      never turned into an internal destination.
 *
 *   2. The host is parsed out of the address and compared for equality against
 *      the two historical Cybertown hosts. It is never matched as a substring,
 *      so `notcybertown.com`, `cybertown.com.example.org` and
 *      `http://example.com/?next=http://www.cybertown.com/` are all left alone.
 *      Userinfo is discarded before the comparison, so the deciding host in
 *      `http://www.cybertown.com@example.com/` is correctly `example.com`.
 *
 *   3. For those two hosts every path is legacy, not only `/cgi-bin/`. The whole
 *      domain is the dead artefact: the Outlands game-master branch
 *      (`ne_game.wrl:932`) navigates to `/places/ne_game/html/gmbeam.html` and
 *      the Plaza Avatar Boutique door (`enter/vrml/enter.wrl:886`) navigates to
 *      `/avatars/avlib_1.html`. Both destroy or pollute the session in exactly
 *      the same way, and neither is under `/cgi-bin/`.
 *
 *   4. A root-relative address is legacy only when it is inside the historical
 *      CGI namespace `/cgi-bin/`. The Mall's store doors
 *      (`shopping/vrml/shopping.wrl:2825-2828`) use that relative form. CTR
 *      itself serves nothing under `/cgi-bin/` - the SPA is hash-routed and the
 *      API is mounted under `/api` - so the namespace is unambiguous, and no
 *      ordinary CTR path can be caught by it.
 *
 * BOTH HOST FORMS ARE PROVEN. A scan of the shipped worlds finds 172 occurrences
 * of `//www.cybertown.com` and one of `//cybertown.com`
 * (`hitek_col/vrml/hi-tek.wrl:12394`), so both spellings are historical rather
 * than invented aliases. No other host is recognised.
 */

/** What the X_ITE binding should do with a `Browser.loadURL` call. */
export const PASS_THROUGH = "PASS_THROUGH";

/** At least one address in the call is a proven-dead legacy Cybertown address. */
export const SUPPRESS_LEGACY = "SUPPRESS_LEGACY";

export type LegacyUrlAction = typeof PASS_THROUGH | typeof SUPPRESS_LEGACY;

/**
 * The historical Cybertown hosts, lower case, compared for equality only.
 * Both spellings occur in the shipped worlds; nothing else is recognised.
 */
export const LEGACY_HOSTS: readonly string[] = ["www.cybertown.com", "cybertown.com"];

/** The historical CGI namespace, used only to judge root-relative addresses. */
export const LEGACY_RELATIVE_PREFIX = "/cgi-bin/";

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The host of an absolute or protocol-relative address, lower case, without
 * userinfo and without a port. Returns an empty string when there is no
 * authority component to read.
 */
export function readHost(url: string): string {
  const trimmed = String(url).trim();
  let rest = "";

  if (trimmed.slice(0, 2) === "//") {
    rest = trimmed.slice(2);
  } else {
    const scheme = SCHEME.exec(trimmed);
    if (!scheme) { return ""; }
    const afterScheme = trimmed.slice(scheme[0].length);
    if (afterScheme.slice(0, 2) !== "//") { return ""; }
    rest = afterScheme.slice(2);
  }

  // The authority ends at the first delimiter of the path, query or fragment.
  const end = rest.search(/[/?#]/);
  let authority = end === -1 ? rest : rest.slice(0, end);

  // Userinfo is everything before the LAST "@"; the host is what follows it.
  const at = authority.lastIndexOf("@");
  if (at !== -1) { authority = authority.slice(at + 1); }

  // A bracketed IPv6 literal keeps its brackets; otherwise drop any port.
  if (authority.slice(0, 1) === "[") {
    const close = authority.indexOf("]");
    if (close !== -1) { return authority.slice(0, close + 1).toLowerCase(); }
    return authority.toLowerCase();
  }
  const colon = authority.indexOf(":");
  if (colon !== -1) { authority = authority.slice(0, colon); }

  return authority.toLowerCase();
}

/** The scheme of an address, lower case, or an empty string when it has none. */
export function readScheme(url: string): string {
  const scheme = SCHEME.exec(String(url).trim());
  return scheme ? scheme[1].toLowerCase() : "";
}

/**
 * True when this one address is a proven-dead legacy Cybertown destination.
 * Everything else - including every other host, every other scheme and every
 * ordinary CTR path - is false.
 */
export function isLegacyCybertownUrl(url: string): boolean {
  const trimmed = url === null || url === undefined ? "" : String(url).trim();
  if (trimmed === "") { return false; }

  const protocolRelative = trimmed.slice(0, 2) === "//";
  const scheme = readScheme(trimmed);

  if (scheme !== "" || protocolRelative) {
    // A scheme this module does not navigate over is never reclassified.
    if (!protocolRelative && scheme !== "http" && scheme !== "https") { return false; }
    return LEGACY_HOSTS.indexOf(readHost(trimmed)) !== -1;
  }

  // Root-relative only, and only inside the historical CGI namespace.
  return trimmed.slice(0, LEGACY_RELATIVE_PREFIX.length) === LEGACY_RELATIVE_PREFIX;
}

/**
 * X_ITE's own reading of the parameter list, reproduced for the diagnostic
 * notice: `FileLoader.getTarget()` returns the value of the first `target=...`
 * entry, or an empty string. This never affects the decision.
 */
export function readTarget(parameters: readonly string[]): string {
  for (let i = 0; i < parameters.length; i += 1) {
    const parts = String(parameters[i]).split("=");
    if (parts.length === 2 && parts[0] === "target") { return parts[1]; }
  }
  return "";
}

export interface LegacyLoadUrlDecision {
  /** `PASS_THROUGH` when the call carries no legacy address at all. */
  action: LegacyUrlAction;
  /** The addresses that survive, in their original order. */
  keptUrls: string[];
  /** The addresses that were recognised as dead legacy destinations. */
  legacyUrls: string[];
  /** The `target=` value X_ITE would have used, for the notice only. */
  target: string;
}

/**
 * Classify one whole `Browser.loadURL(url, parameter)` call.
 *
 * `Browser.loadURL` takes an MFString: X_ITE tries the first address and falls
 * back to the next one on failure. The legacy entries are therefore removed
 * from that list rather than the whole call being dropped, so a mixed list keeps
 * its documented fallback behaviour. When nothing survives, the binding makes no
 * call at all and the current world stays exactly as it is.
 */
export function classifyLegacyLoadUrl(
  urls: readonly string[],
  parameters: readonly string[],
): LegacyLoadUrlDecision {
  const keptUrls: string[] = [];
  const legacyUrls: string[] = [];

  for (let i = 0; i < urls.length; i += 1) {
    const url = String(urls[i]);
    if (isLegacyCybertownUrl(url)) {
      legacyUrls.push(url);
    } else {
      keptUrls.push(url);
    }
  }

  return {
    action: legacyUrls.length === 0 ? PASS_THROUGH : SUPPRESS_LEGACY,
    keptUrls,
    legacyUrls,
    target: readTarget(parameters),
  };
}
