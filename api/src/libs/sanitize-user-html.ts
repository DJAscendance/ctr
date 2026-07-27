import sanitizeHtml from 'sanitize-html';

/**
 * The single allowlist CTR applies to user-authored HTML.
 *
 * This policy is not new. It is the exact allowlist that was already duplicated,
 * character for character, in MessageboardService.sanitize() and
 * InboxService.sanitize(); extracting it here is what makes it possible for a
 * third surface (place information) to reuse it instead of inventing a fourth
 * slightly-different copy.
 *
 * Deliberately NOT widened. Notably absent, and to stay absent:
 *   - <script>, <style>, <link>, <iframe>, <object>, <embed>
 *   - every event attribute (onclick, onerror, onload, ...)
 *   - the global `style` attribute, and `class` anywhere except <area>
 *   - `javascript:` and `data:` URLs, stripped by sanitize-html from the
 *     URL-bearing attributes below
 *
 * `disallowedTagsMode: 'discard'` means disallowed markup is silently removed
 * and the cleaned result is accepted, rather than the submission being rejected.
 * That is the behaviour the existing surfaces have always had.
 *
 * Historical note: the original Cybertown stored and rendered this text as raw,
 * unescaped HTML with no filtering layer anywhere in blaxxun CS 4.0, 5.1 or 7.0
 * (docs/research/classic-place-admin-re-evidence.md section 4.4). That is a
 * stored-XSS design and is deliberately not reproduced. This allowlist is the
 * closest safe approximation of "the author may write HTML".
 */
export const USER_HTML_POLICY: sanitizeHtml.IOptions = {
  allowedTags: [
    'address', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'hgroup', 'main', 'nav', 'section', 'blockquote', 'dd', 'div',
    'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'marquee', 'ol', 'p', 'pre',
    'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
    'em', 'i', 'kbd', 'mark', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp',
    'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'caption',
    'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'img',
    'font', 'center', 'map', 'area',
  ],
  disallowedTagsMode: 'discard',
  allowedAttributes: {
    a: ['href', 'name', 'target'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'usemap'],
    font: ['color', 'size'],
    map: ['name'],
    area: ['alt', 'title', 'href', 'coords', 'shape', 'target', 'class'],
    marquee: ['width', 'height', 'direction'],
  },
};

/**
 * Cleans user-authored HTML against {@link USER_HTML_POLICY}.
 *
 * Callers MUST sanitize on write and store the result, so that whatever is read
 * back is already safe. Sanitizing only at render time leaves the unsafe value in
 * the database for the next consumer that forgets.
 */
export function sanitizeUserHtml(uncleanHtml: string): string {
  return sanitizeHtml(uncleanHtml ?? '', USER_HTML_POLICY);
}
