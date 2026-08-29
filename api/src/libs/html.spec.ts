import { escapeHtml } from './html';

/**
 * The escaping that stands between a Bank transfer memo and the Inbox's `v-html`.
 *
 * Independent QA proved a memo of `<img src=x onerror=...>` executed when the recipient
 * opened their receipt. These are the cases that must never again produce markup, plus the
 * ones that must survive unchanged -- an escaper that mangles ordinary punctuation is its
 * own kind of defect, and the citizen's text has to read back as what they typed.
 */
describe('escapeHtml', () => {
  describe('payloads that must not become markup', () => {
    it.each([
      ['<script>alert(1)</script>'],
      ['<img src=x onerror=alert(1)>'],
      ['<svg onload=alert(1)>'],
      ['<b>bold</b>'],
      ['<iframe src="javascript:alert(1)">'],
      ['"><script>alert(1)</script>'],
      ['\'-alert(1)-\''],
      ['<marquee>scroll</marquee>'],
      ['<a href="http://example.invalid">link</a>'],
    ])('leaves no angle bracket or quote unescaped in %p', payload => {
      const escaped = escapeHtml(payload);

      // The whole safety property in two assertions: nothing that could open a tag or
      // close an attribute survives.
      expect(escaped).not.toMatch(/[<>"']/);
      // And the escaping is not achieved by throwing the content away.
      expect(escaped.length).toBeGreaterThanOrEqual(payload.length);
    });
  });

  describe('what it produces', () => {
    it('escapes each of the five significant characters', () => {
      expect(escapeHtml('&')).toBe('&amp;');
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('>')).toBe('&gt;');
      expect(escapeHtml('"')).toBe('&quot;');
      expect(escapeHtml('\'')).toBe('&#39;');
    });

    it('escapes an ampersand once, not twice', () => {
      // A two-pass implementation that replaced `<` and then `&` would turn `<` into
      // `&amp;lt;`, which displays as the literal text "&lt;" rather than "<".
      expect(escapeHtml('<')).toBe('&lt;');
      expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    });

    it('escapes a comparison so it reads back as one', () => {
      expect(escapeHtml('5 < 10')).toBe('5 &lt; 10');
    });

    it('escapes an ampersand in an ordinary name', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('escapes both kinds of quote', () => {
      expect(escapeHtml('quotes " \'')).toBe('quotes &quot; &#39;');
    });
  });

  describe('text it must leave alone', () => {
    it.each([
      ['for the pizza'],
      ['happy birthday!'],
      ['rent (March)'],
      ['50% off'],
      ['a-b_c.d'],
      ['non-ascii: café 日本語'],
      [''],
    ])('returns %p unchanged', text => {
      expect(escapeHtml(text)).toBe(text);
    });
  });

  describe('values that are not strings', () => {
    it('treats null and undefined as empty rather than printing them', () => {
      // Coerced rather than rejected: an unexpected type must not be able to reach a
      // template by failing a `typeof` check somewhere upstream, and "null" appearing in a
      // citizen's receipt would be its own small bug.
      expect(escapeHtml(null as unknown as string)).toBe('');
      expect(escapeHtml(undefined as unknown as string)).toBe('');
    });

    it('escapes the string form of a non-string', () => {
      expect(escapeHtml(42 as unknown as string)).toBe('42');
      expect(escapeHtml({ toString: () => '<x>' } as unknown as string)).toBe('&lt;x&gt;');
    });
  });
});
