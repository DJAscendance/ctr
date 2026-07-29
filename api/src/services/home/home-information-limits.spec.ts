import { PlaceRepository } from '../../repositories';
import { sanitizeUserHtml } from '../../libs';
import { HomeService } from './home.service';

/**
 * Home Information: the 3,500-character bound and the silent-sanitize contract.
 *
 * TWO PROPERTIES, deliberately tested together because they interact.
 *
 *   LENGTH is measured on the SUBMITTED text, before sanitizing. Measuring after
 *   would let someone post an arbitrarily large blob of disallowed markup that
 *   happens to clean down to something short - the size the server has to carry
 *   is what arrived, not what survived.
 *
 *   SANITIZING IS SILENT. Disallowed markup is dropped and the save SUCCEEDS.
 *   There is no rejection, no warning, no "your HTML was changed" channel - a
 *   home behaves exactly like a message board post. So the assertions below are
 *   always "accepted, and what was stored is the sanitizer's output", never
 *   "raised an error".
 *
 * Nothing is ever truncated: a value over the limit is refused whole by the
 * controller, and a value under it is stored whole.
 */
describe('HomeService home information limits and sanitizing', () => {
  let placeRepository: any;
  let service: HomeService;

  beforeEach(() => {
    placeRepository = {
      findHomeByMemberId: jest.fn().mockResolvedValue({ id: 42 }),
      updateHomeByMemberId: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
    } as unknown as PlaceRepository;
    service = new HomeService(
      placeRepository, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any, null as any,
    );
  });

  const stored = (): string =>
    placeRepository.updateHomeByMemberId.mock.calls[0][1].information;

  it('publishes 3500 as the limit', () => {
    expect(HomeService.INFORMATION_MAX_LENGTH).toEqual(3500);
  });

  describe('length', () => {
    it('accepts an empty value as an intentional clear', async () => {
      await service.updateHomeInformation(5, '');
      expect(stored()).toEqual('');
    });

    it('accepts the old 1000-character limit, which is no longer a boundary',
      async () => {
        const text = 'a'.repeat(1000);
        await service.updateHomeInformation(5, text);
        expect(stored()).toEqual(text);
      });

    it('accepts 1001 characters, which the old limit refused', async () => {
      const text = 'a'.repeat(1001);
      await service.updateHomeInformation(5, text);
      expect(stored()).toEqual(text);
    });

    it('accepts exactly 3500 characters and stores every one of them', async () => {
      const text = 'a'.repeat(3500);
      await service.updateHomeInformation(5, text);
      expect(stored()).toEqual(text);
      expect(stored().length).toEqual(3500);
    });

    it('never truncates a value it accepts', async () => {
      const text = `${'b'.repeat(3499)}!`;
      await service.updateHomeInformation(5, text);
      expect(stored().endsWith('!')).toBe(true);
    });
  });

  describe('content', () => {
    it('keeps allowed formatting', async () => {
      await service.updateHomeInformation(
        5, '<p>Welcome to <b>my</b> home.</p>',
      );
      expect(stored()).toEqual('<p>Welcome to <b>my</b> home.</p>');
    });

    it('drops a script silently and still succeeds', async () => {
      await service.updateHomeInformation(
        5, '<p>hi</p><script>alert(1)</script>',
      );
      expect(stored()).toEqual('<p>hi</p>');
      expect(placeRepository.updateHomeByMemberId).toHaveBeenCalled();
    });

    it('drops event attributes and unsafe URLs silently', async () => {
      await service.updateHomeInformation(
        5,
        '<a href="javascript:alert(1)">x</a>'
        + '<img src="data:text/html;base64,PHNjcmlwdD4=">'
        + '<div onclick="steal()">y</div>',
      );
      const result = stored();
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('onclick');
      expect(result).not.toContain('data:text/html');
    });

    it('produces exactly the shared policy output, with no home-only variant',
      async () => {
        const input = '<p>Hi</p><marquee>go</marquee><script>bad()</script>';
        await service.updateHomeInformation(5, input);
        expect(stored()).toEqual(sanitizeUserHtml(input));
      });

    it('preserves multiline text and its blank lines', async () => {
      const poem = 'roses are red\n\nviolets are blue\n  indented line\n';
      await service.updateHomeInformation(5, poem);
      expect(stored()).toEqual(poem);
    });

    it('preserves Unicode and emoji byte for byte', async () => {
      const text = 'Καλημέρα — こんにちは — 🏠🎉 café naïve';
      await service.updateHomeInformation(5, text);
      expect(stored()).toEqual(text);
    });

    it('counts characters, not bytes, so emoji do not shrink the budget',
      async () => {
        // 3500 astral-plane characters is 14000 bytes; the column is TEXT
        // (65535 bytes), so this must still be accepted whole.
        const text = '🏠'.repeat(1750);
        expect(text.length).toEqual(3500);
        await service.updateHomeInformation(5, text);
        expect(stored()).toEqual(text);
      });
  });

  describe('repeated edits', () => {
    it('replaces the previous value rather than accumulating', async () => {
      await service.updateHomeInformation(5, '<p>first</p>');
      await service.updateHomeInformation(5, '<p>second</p>');
      await service.updateHomeInformation(5, '');

      const written = placeRepository.updateHomeByMemberId.mock.calls
        .map((call: any[]) => call[1].information);
      expect(written).toEqual(['<p>first</p>', '<p>second</p>', '']);
    });
  });

  describe('reading back', () => {
    it('serves the information column of a home', async () => {
      placeRepository.findById.mockResolvedValue({
        id: 42, type: 'home', information: '<p>Welcome</p>', description: null,
      });

      await expect(service.getHomeInformation(42)).resolves
        .toEqual('<p>Welcome</p>');
    });

    it('never serves a non-home place through the home route', async () => {
      placeRepository.findById.mockResolvedValue({
        id: 7, type: 'block', information: '<p>Block notice</p>',
      });

      await expect(service.getHomeInformation(7)).resolves.toEqual('');
    });
  });
});
