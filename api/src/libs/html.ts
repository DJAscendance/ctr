/**
 * Escaping for text that is about to be embedded in markup.
 *
 * CTR's Inbox renders a message body with `v-html` (spa/src/pages/Inbox.vue), so anything
 * stored in `inbox.message` is parsed as HTML when a citizen opens it. That is the sink
 * this module exists for: a Bank transfer memo is text the SENDER typed, filed into the
 * RECIPIENT's inbox, and rendered later -- textbook stored XSS if it reaches the sink raw.
 * Independent QA proved it with `<img src=x onerror=...>`, which executed on open.
 *
 * WHY NOT A SANITISER. `InboxService.sanitize` is an allowlist that deliberately PERMITS
 * tags -- anchors, bold, marquee -- because messages citizens write to each other are meant
 * to carry some markup. A Bank receipt is not that. It is a system-generated notice with a
 * fixed shape, and the only citizen-controlled parts of it are plain text that should be
 * displayed literally. An allowlist would be the wrong tool: it answers "which tags are
 * safe", and the correct answer here is "none, because none were ever intended".
 *
 * WHERE THIS BELONGS. At the sink, and only at the sink. The stored financial record --
 * `transaction.memo` -- keeps the citizen's literal text, so a memo of `5 < 10` reads back
 * as `5 < 10` and not as `5 &lt; 10`. Escaping the ledger instead of the markup would
 * corrupt a financial record to work around a rendering decision made three layers away,
 * and would double-escape the moment anything else consumed it.
 */

/**
 * The five characters that can change the meaning of surrounding HTML.
 *
 * `&` is replaced first, and the map is applied in a single pass, so an already-escaped
 * entity cannot be produced by escaping the `&` of one this function itself just wrote.
 * `'` is escaped as `&#39;` rather than `&apos;` because the latter is not defined in
 * HTML 4 and older parsers render it literally.
 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
};

/**
 * Renders arbitrary text safe to interpolate into an HTML document.
 *
 * Escapes `& < > " '` and nothing else: the result is the same text, displayed literally,
 * with no element or attribute boundary a caller did not write themselves.
 * @param value text to escape. A non-string is coerced, so an unexpected type cannot
 * silently bypass escaping by failing a `typeof` check somewhere upstream
 * @returns the escaped text
 */
export function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}
