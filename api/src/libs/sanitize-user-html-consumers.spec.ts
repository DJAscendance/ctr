import * as fs from 'fs';
import * as path from 'path';

import { InboxService } from '../services/inbox/inbox.service';
import { MessageboardService } from '../services/messageboard/messageboard.service';
import { PlaceInformationService } from '../services/place/place-information.service';
import { sanitizeUserHtml } from './sanitize-user-html';

/**
 * Cross-consumer guard for the single user-HTML allowlist.
 *
 * sanitize-user-html.spec.ts pins WHAT the policy allows. This suite pins that
 * all three surfaces which accept author-written HTML actually go through it,
 * and produce byte-identical output for the same input:
 *
 *   - message board posts   (MessageboardService)
 *   - inbox messages        (InboxService)
 *   - place information     (PlaceInformationService)
 *
 * The failure this exists to catch is a fourth, slightly-different copy of the
 * allowlist appearing behind one of them - which is exactly the state the
 * codebase was in before the policy was extracted, when the message board and
 * the inbox each carried their own duplicate. A divergence there is a security
 * bug, not a formatting difference: place information is the one value CTR
 * renders as HTML.
 */

const API_SRC = path.resolve(__dirname, '..');

/**
 * Representative input: one item from each class of thing the policy decides
 * about, so a widened OR narrowed allowlist changes this string's cleaned form.
 */
const REPRESENTATIVE_INPUT = [
  '<p>Welcome to <b>our place</b>.</p>',
  '<center>Meetings <i>Sundays</i>, 8pm</center>',
  '<font color="lime" size="2">Notices</font>',
  '<ul><li>See the <a href="/citymap" target="_top">city map</a></li></ul>',
  '<img src="/assets/img/logo.gif" alt="logo" width="80" height="40">',
  '<table><tr><td>cell</td></tr></table>',
  '<marquee direction="left" width="200">scrolling</marquee>',
  // Everything below must be removed, whichever surface it arrives at.
  '<script>alert(1)</script>',
  '<style>body{display:none}</style>',
  '<iframe src="https://example.invalid"></iframe>',
  '<object data="x"></object><embed src="x">',
  '<a href="javascript:alert(1)">js url</a>',
  '<img src="data:text/html;base64,PHNjcmlwdD4=">',
  '<div onclick="steal()" onerror="steal()" style="position:fixed">evented</div>',
  '<b class="not-allowed-here">classy</b>',
].join('\n');

describe('the user-HTML allowlist is shared by every consumer', () => {
  const expected = sanitizeUserHtml(REPRESENTATIVE_INPUT);

  it('cleans a representative input identically through all three services', async () => {
    const messageboard = await new MessageboardService(
      null as any,
    ).sanitize(REPRESENTATIVE_INPUT);
    const inbox = await new InboxService(
      null as any,
    ).sanitize(REPRESENTATIVE_INPUT);

    // PlaceInformationService sanitizes inside updateInformation, after its
    // authorization checks, so it is driven through that path with stubs that
    // authorize - proving the value that reaches the database is the shared
    // policy's output and not something cleaned a second, different way.
    const place = { id: 7, type: 'block', description: '' };
    const placeRepository = {
      findById: jest.fn().mockResolvedValue(place),
      updateDescription: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PlaceInformationService(
      placeRepository as any, null as any, null as any, null as any, null as any,
    );
    jest.spyOn(service as any, 'canEdit').mockResolvedValue(true);

    const result = await service.updateInformation(
      place.id, 1, REPRESENTATIVE_INPUT,
    );

    // UpdateInformationResult is a discriminated union; narrow before reading
    // the success-only field.
    expect(result.status).toEqual('success');
    if (result.status !== 'success') {
      throw new Error(`expected a successful update, got ${result.status}`);
    }
    expect(result.description).toEqual(expected);
    expect(placeRepository.updateDescription).toHaveBeenCalledWith(place.id, expected);
    expect(messageboard).toEqual(expected);
    expect(inbox).toEqual(expected);
    // Stated positively as well, so a future change that made all three equally
    // WRONG would still have to face the policy spec.
    expect(messageboard).toEqual(inbox);
  });

  it('removes every dangerous construct from that input, not merely most', () => {
    for (const forbidden of [
      '<script', '<style', '<iframe', '<object', '<embed',
      'onclick', 'onerror', 'javascript:', 'data:text/html',
      'position:fixed', 'class="not-allowed-here"',
    ]) {
      expect(expected).not.toContain(forbidden);
    }
    // And the author's legitimate formatting survives, so "safe" did not become
    // "stripped to plain text".
    for (const kept of ['<b>', '<center>', '<font', '<marquee', '<table>', 'href="/citymap"']) {
      expect(expected).toContain(kept);
    }
  });

  it('has exactly one allowlist in the codebase', () => {
    // A second `allowedTags` anywhere is the duplicate-policy regression itself.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
          continue;
        }
        if (full === path.join(API_SRC, 'libs', 'sanitize-user-html.ts')) {
          continue;
        }
        if (/allowedTags|disallowedTagsMode/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(API_SRC, full));
        }
      }
    };
    walk(API_SRC);
    expect(offenders).toEqual([]);
  });

  it('routes each consumer through the shared helper rather than sanitize-html directly', () => {
    for (const consumer of [
      'services/inbox/inbox.service.ts',
      'services/messageboard/messageboard.service.ts',
      'services/place/place-information.service.ts',
    ]) {
      const source = fs.readFileSync(path.join(API_SRC, consumer), 'utf8');
      expect(source).toContain('sanitizeUserHtml');
      expect(source).not.toContain("from 'sanitize-html'");
    }
  });
});
