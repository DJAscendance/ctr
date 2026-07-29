import {
  INFORMATION_MAX_LENGTH,
  canonicalizeInformation,
} from './canonical-information';
import { sanitizeUserHtml } from './sanitize-user-html';

/**
 * The 3,500-character contract, pinned as the invariant rather than as a number.
 *
 * THE BUG. The limit used to be measured on the RAW submission. The sanitizer
 * can GROW a value - `<br>` normalizes to `<br />` - so 875 raw `<br>` tags is
 * exactly 3,500 characters on the way in and 5,250 on the way out. That value
 * was accepted and stored, and then could not be saved again unchanged: loading
 * it into the editor and pressing Update failed the limit. QA classified it
 * blocking, correctly - it is a value the product will not let you keep.
 *
 * The property worth testing is therefore not "3,501 is refused" but:
 *
 *     anything successfully stored can be re-saved unchanged
 *
 * which is what `re-saving a stored value always succeeds` below asserts, over
 * every interesting shape at once.
 */
describe('canonicalizeInformation', () => {
  const ok = (input: string): string => {
    const result = canonicalizeInformation(input);
    if (result.status !== 'ok') {
      throw new Error(`expected acceptance, got ${result.status} (${result.length})`);
    }
    return result.value;
  };

  it('publishes 3500 as the limit', () => {
    expect(INFORMATION_MAX_LENGTH).toEqual(3500);
  });

  describe('length boundaries, measured on the canonical value', () => {
    const cases: Array<[string, number, boolean]> = [
      ['empty', 0, true],
      ['1,000', 1000, true],
      ['1,001', 1001, true],
      ['3,499', 3499, true],
      ['exactly 3,500', 3500, true],
      ['3,501', 3501, false],
    ];

    for (const [label, length, accepted] of cases) {
      it(`${accepted ? 'accepts' : 'refuses'} ${label} plain characters`, () => {
        const result = canonicalizeInformation('a'.repeat(length));
        expect(result.status).toEqual(accepted ? 'ok' : 'too_long');
        if (result.status === 'ok') {
          expect(result.value.length).toEqual(length);
        }
      });
    }
  });

  describe('the case that was broken', () => {
    it('refuses 875 raw <br> tags, because they canonicalize to 5,250 characters',
      () => {
        const input = '<br>'.repeat(875);
        expect(input.length).toEqual(3500);
        expect(sanitizeUserHtml(input).length).toEqual(5250);

        const result = canonicalizeInformation(input);
        expect(result.status).toEqual('too_long');
        if (result.status === 'too_long') {
          expect(result.length).toEqual(5250);
        }
      });

    it('accepts the largest number of <br> tags that canonicalizes within the limit',
      () => {
        // 583 tags -> 3,498 canonical characters; 584 -> 3,504.
        expect(ok('<br>'.repeat(583)).length).toEqual(3498);
        expect(canonicalizeInformation('<br>'.repeat(584)).status).toEqual('too_long');
      });

    it('accepts a canonical value of exactly 3,500 built from growing markup', () => {
      // 582 tags = 3,492 canonical, plus 8 plain characters = exactly 3,500.
      const value = ok(`${'<br>'.repeat(582)}12345678`);
      expect(value.length).toEqual(3500);
    });

    it('refuses a canonical value of 3,501', () => {
      const result = canonicalizeInformation(`${'<br>'.repeat(582)}123456789`);
      expect(result.status).toEqual('too_long');
      if (result.status === 'too_long') {
        expect(result.length).toEqual(3501);
      }
    });
  });

  describe('the invariant', () => {
    const shapes: Array<[string, string]> = [
      ['plain text at the limit', 'a'.repeat(3500)],
      ['growing markup at the limit', `${'<br>'.repeat(582)}12345678`],
      ['allowed formatting', '<p>Welcome to <b>my</b> home.</p>'],
      ['markup the sanitizer removes', '<p>hi</p><script>alert(1)</script>'],
      ['attributes the sanitizer normalizes', '<a href=/citymap target=_top>map</a>'],
      ['an unclosed tag the sanitizer closes', '<p>dangling'],
      ['multiline poetry', 'roses are red\n\nviolets are blue\n  indented\n'],
      ['unicode', 'Καλημέρα — こんにちは — café naïve'],
      ['emoji', '🏠🎉'.repeat(50)],
      ['combining characters', 'é'.repeat(200)],
      ['emoji filling the budget', '🏠'.repeat(1750)],
    ];

    for (const [label, input] of shapes) {
      it(`re-saving a stored value always succeeds: ${label}`, () => {
        const stored = ok(input);

        // Load it back and submit it unchanged, exactly as the editor does.
        const again = canonicalizeInformation(stored);
        expect(again.status).toEqual('ok');
        if (again.status === 'ok') {
          // ...and it is byte-identical, so the editor is not silently rewriting
          // the member's text on every save either.
          expect(again.value).toEqual(stored);
        }
      });
    }
  });

  describe('shape and safety', () => {
    it('produces exactly the shared policy output, with no second normalization',
      () => {
        const input = '<p>Hi</p><marquee>go</marquee><script>bad()</script>';
        expect(ok(input)).toEqual(sanitizeUserHtml(input));
      });

    it('drops scripts, event attributes and unsafe URLs silently', () => {
      const value = ok(
        '<a href="javascript:alert(1)">x</a>'
        + '<img src="data:text/html;base64,PHNjcmlwdD4=">'
        + '<div onclick="steal()">y</div>',
      );
      expect(value).not.toContain('javascript:');
      expect(value).not.toContain('onclick');
      expect(value).not.toContain('data:text/html');
    });

    it('never truncates - an over-limit value is refused whole', () => {
      const result = canonicalizeInformation('a'.repeat(5000));
      expect(result.status).toEqual('too_long');
      expect(result).not.toHaveProperty('value');
    });

    it('treats a non-string as empty rather than throwing', () => {
      expect(ok(undefined as any)).toEqual('');
      expect(ok(null as any)).toEqual('');
      expect(ok(42 as any)).toEqual('');
    });

    it('counts UTF-16 code units, which is what the SPA counter counts', () => {
      // One astral-plane emoji is 2 code units; the documented unit for 3,500.
      expect('🏠'.length).toEqual(2);
      expect(ok('🏠'.repeat(1750)).length).toEqual(3500);
      expect(canonicalizeInformation('🏠'.repeat(1751)).status).toEqual('too_long');
    });
  });
});
