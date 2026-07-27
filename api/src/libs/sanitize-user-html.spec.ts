import { USER_HTML_POLICY, sanitizeUserHtml } from './sanitize-user-html';

/**
 * Two jobs.
 *
 * First, a REGRESSION guard: this policy was extracted from two identical
 * copies that lived in MessageboardService.sanitize() and
 * InboxService.sanitize(). The allowlist asserted here is that exact set, so an
 * accidental widening or narrowing during or after the extraction fails loudly.
 * Message-board and inbox behaviour is a property of this policy now, so pinning
 * the policy pins them.
 *
 * Second, the attack surface: the place-information feature renders its stored
 * value as HTML, which is only safe because everything below is removed on
 * write.
 */
describe('sanitizeUserHtml', () => {
  describe('the extracted policy matches what messageboard and inbox had', () => {
    const EXPECTED_TAGS = [
      'address', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hgroup', 'main', 'nav', 'section', 'blockquote', 'dd', 'div',
      'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'marquee', 'ol', 'p', 'pre',
      'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn',
      'em', 'i', 'kbd', 'mark', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp',
      'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'caption',
      'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'img',
      'font', 'center', 'map', 'area',
    ];

    it('allows exactly the 75 tags the duplicated allowlists allowed', () => {
      const actual = [...(USER_HTML_POLICY.allowedTags as string[])].sort();
      expect(actual).toEqual([...EXPECTED_TAGS].sort());
      expect(new Set(actual).size).toBe(75);
    });

    it('keeps the per-element attribute lists unchanged', () => {
      expect(USER_HTML_POLICY.allowedAttributes).toEqual({
        a: ['href', 'name', 'target'],
        img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'usemap'],
        font: ['color', 'size'],
        map: ['name'],
        area: ['alt', 'title', 'href', 'coords', 'shape', 'target', 'class'],
        marquee: ['width', 'height', 'direction'],
      });
    });

    it('discards disallowed markup rather than rejecting the submission', () => {
      expect(USER_HTML_POLICY.disallowedTagsMode).toBe('discard');
    });
  });

  describe('preserves the formatting an author is entitled to use', () => {
    it('keeps paragraphs and line breaks', () => {
      expect(sanitizeUserHtml('<p>First</p><p>Second<br>line</p>'))
        .toBe('<p>First</p><p>Second<br />line</p>');
    });

    it('keeps bold and italic in both spellings', () => {
      expect(sanitizeUserHtml('<b>b</b><strong>s</strong><i>i</i><em>e</em>'))
        .toBe('<b>b</b><strong>s</strong><i>i</i><em>e</em>');
    });

    it('keeps ordered and unordered lists', () => {
      expect(sanitizeUserHtml('<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>'))
        .toBe('<ul><li>a</li><li>b</li></ul><ol><li>c</li></ol>');
    });

    it('keeps safe links', () => {
      expect(sanitizeUserHtml('<a href="https://cybertown.com">CT</a>'))
        .toBe('<a href="https://cybertown.com">CT</a>');
      expect(sanitizeUserHtml('<a href="/mall">Mall</a>'))
        .toBe('<a href="/mall">Mall</a>');
    });

    it('keeps headings, tables and the classic font tag', () => {
      expect(sanitizeUserHtml('<h3>Hours</h3>')).toBe('<h3>Hours</h3>');
      expect(sanitizeUserHtml('<table><tr><td>x</td></tr></table>'))
        .toBe('<table><tr><td>x</td></tr></table>');
      expect(sanitizeUserHtml('<font color="#FFFF00">gold</font>'))
        .toBe('<font color="#FFFF00">gold</font>');
    });

    it('keeps plain text untouched', () => {
      expect(sanitizeUserHtml('Open daily. Ask for Ruby.'))
        .toBe('Open daily. Ask for Ruby.');
    });
  });

  describe('removes or neutralizes attacks', () => {
    it('discards script elements and their contents', () => {
      expect(sanitizeUserHtml('<p>hi</p><script>alert(1)</script>'))
        .toBe('<p>hi</p>');
      expect(sanitizeUserHtml('<SCRIPT>alert(1)</SCRIPT>')).toBe('');
    });

    it('strips event attributes', () => {
      expect(sanitizeUserHtml('<p onclick="alert(1)">hi</p>')).toBe('<p>hi</p>');
      expect(sanitizeUserHtml('<img src="x" onerror="alert(1)">'))
        .toBe('<img src="x" />');
      expect(sanitizeUserHtml('<b ONMOUSEOVER="alert(1)">hi</b>'))
        .toBe('<b>hi</b>');
    });

    it('removes javascript: and data: URLs', () => {
      expect(sanitizeUserHtml('<a href="javascript:alert(1)">x</a>'))
        .toBe('<a>x</a>');
      expect(sanitizeUserHtml('<a href="JaVaScRiPt:alert(1)">x</a>'))
        .toBe('<a>x</a>');
      expect(sanitizeUserHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'))
        .toBe('<a>x</a>');
    });

    it('discards embedded objects and frames', () => {
      expect(sanitizeUserHtml('<iframe src="https://evil.example"></iframe>')).toBe('');
      expect(sanitizeUserHtml('<object data="x.swf"></object>')).toBe('');
      expect(sanitizeUserHtml('<embed src="x.swf">')).toBe('');
      expect(sanitizeUserHtml('<form action="/x"><input name="p"></form>')).toBe('');
    });

    it('strips inline styles, classes and stylesheet injection', () => {
      expect(sanitizeUserHtml('<p style="position:fixed;top:0">hi</p>'))
        .toBe('<p>hi</p>');
      expect(sanitizeUserHtml('<div class="ct-admin">hi</div>'))
        .toBe('<div>hi</div>');
      expect(sanitizeUserHtml('<style>body{display:none}</style>')).toBe('');
      expect(sanitizeUserHtml('<link rel="stylesheet" href="//evil.example/x.css">'))
        .toBe('');
    });

    it('does not let malformed nesting reconstruct a script tag', () => {
      // The classic "the sanitizer removed one layer for me" trick.
      expect(sanitizeUserHtml('<scr<script>ipt>alert(1)</scr</script>ipt>'))
        .not.toMatch(/<script/i);
      expect(sanitizeUserHtml('<<SCRIPT>alert(1);//<</SCRIPT>'))
        .not.toMatch(/<script/i);
      expect(sanitizeUserHtml('<p><p><script>alert(1)</script></p>'))
        .not.toMatch(/<script/i);
    });

    it('does not resurrect markup from encoded input', () => {
      const encoded = sanitizeUserHtml('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(encoded).not.toMatch(/<script/i);
      // Re-running the sanitizer must not decode it into live markup either.
      expect(sanitizeUserHtml(encoded)).not.toMatch(/<script/i);
    });

    it('is idempotent, so storing a cleaned value and re-cleaning is stable', () => {
      const dirty = '<p onclick="x()">a<script>b</script><b>c</b></p>';
      const once = sanitizeUserHtml(dirty);
      expect(sanitizeUserHtml(once)).toBe(once);
    });

    it('treats null and undefined as empty rather than throwing', () => {
      expect(sanitizeUserHtml(null as unknown as string)).toBe('');
      expect(sanitizeUserHtml(undefined as unknown as string)).toBe('');
    });
  });
});
