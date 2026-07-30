import { Service } from 'typedi';

import { MemberDataRepository, MemberRepository } from '../../repositories';
import { MemberDataService } from '../member-data/member-data.service';

/** One visible occupant of the roster. */
export interface RosterEntry {
  id: number;
  username: string;
  /** The viewer has this nickname in one of their ten buddy slots. */
  isBuddy: boolean;
  /** This entry is the viewer. Rendered as plain text, not a link. */
  isSelf: boolean;
}

export interface RosterView {
  /** How many members are visibly online. */
  count: number;
  /**
   * The occupants, or null for a visitor.
   *
   * null rather than [] on purpose: an empty array says "nobody is online", whereas null
   * says "you may not see who is online". The count still comes back either way.
   */
  entries: RosterEntry[] | null;
}

/**
 * Builds the online roster, applying the original's visibility rules.
 *
 * Three rules, all from the shipped 4.1 templates:
 *
 * 1. Visitors get the COUNT and nothing else. message/count.html emits the roster link
 *    only when NNM != "Visitor", so an unauthenticated caller learns how many people are
 *    online and no more. CTR previously gated the whole endpoint on a session, so visitors
 *    got nothing at all -- not even the count they were meant to see.
 *
 * 2. Buddies render bold. The BU_ loop flag in message/list.html gates a <B> wrapper, and
 *    that bold name was the entire visual buddy affordance in the classic UI. Exposed here
 *    as isBuddy so the client decides the markup.
 *
 * 3. The viewer's own name is plain text, not a link. Exposed as isSelf.
 *
 * And the privacy flag (IMS): a hidden member appears OFFLINE, so they are excluded from
 * the entries AND from the count. Excluding them from the list but still counting them
 * would leak their presence -- the count would exceed the visible names and reveal that
 * someone is hiding. The viewer always sees themselves regardless of their own flag, so
 * turning "hide me" on does not make you vanish from your own roster.
 */
@Service()
export class RosterService {
  constructor(
    private memberRepository: MemberRepository,
    private memberDataRepository: MemberDataRepository,
    private memberDataService: MemberDataService,
  ) {}

  /**
   * @param viewerMemberId the signed-in member, or null/0 for a visitor
   * @param activeWithin how recently a member must have been seen to count as online
   */
  public async getRoster(
    viewerMemberId: number | null,
    activeWithin: Date,
  ): Promise<RosterView> {
    const online: { id: number; username: string }[] =
      await this.memberRepository.findOnlineUsers(activeWithin);

    // One batched read rather than a per-member lookup.
    const hiddenFlags = await this.memberDataRepository.getForMembers(
      online.map(member => member.id),
      MemberDataService.HIDDEN,
    );
    const visible = online.filter(
      member =>
        hiddenFlags.get(member.id) !== '1' ||
        (!!viewerMemberId && member.id === viewerMemberId),
    );

    if (!viewerMemberId) {
      return { count: visible.length, entries: null };
    }

    const buddies = await this.memberDataService.getBuddyNameSet(viewerMemberId);
    return {
      count: visible.length,
      entries: visible.map(member => ({
        id: member.id,
        username: member.username,
        // Buddies are stored by nickname, so match case-insensitively.
        isBuddy: buddies.has((member.username || '').toLowerCase()),
        isSelf: member.id === viewerMemberId,
      })),
    };
  }
}
