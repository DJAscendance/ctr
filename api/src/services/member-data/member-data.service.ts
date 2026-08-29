import { Service } from 'typedi';

import { MemberDataRepository } from '../../repositories';

/**
 * Named per-member attributes, with the CS 4.x attribute names kept in one place.
 *
 * Callers should use these methods rather than passing raw attribute names around, so
 * what 'IMS' and 'BU3' mean is defined here and nowhere else.
 */
@Service()
export class MemberDataService {
  /**
   * The hide-yourself privacy flag.
   *
   * A single checkbox in the original (message/config.html) and that is the ENTIRE privacy
   * model -- no per-buddy blocking, no appear-offline-to-some, no ignore list. The
   * simplicity is the design, so resist growing it.
   */
  public static readonly HIDDEN = 'IMS';

  /** Buddy slot prefix. Exactly ten slots, BU0..BU9, holding nicknames. */
  public static readonly BUDDY_PREFIX = 'BU';
  public static readonly BUDDY_SLOTS = 10;

  constructor(private memberDataRepository: MemberDataRepository) {}

  /** True if the member has chosen to appear offline. */
  public async isHidden(memberId: number): Promise<boolean> {
    if (!memberId) return false;
    return (await this.memberDataRepository.get(memberId, MemberDataService.HIDDEN)) === '1';
  }

  /** Sets or clears the hide-yourself flag. */
  public async setHidden(memberId: number, hidden: boolean): Promise<void> {
    await this.memberDataRepository.set(
      memberId,
      MemberDataService.HIDDEN,
      hidden ? '1' : null,
    );
  }

  /**
   * The member's buddy nicknames, by slot index.
   *
   * Sparse on purpose: slot 3 being empty does not shift slots 4..9 down, because the slot
   * index is part of the original's model. Index is the array position; empty slots are
   * null.
   *
   * Read-only here. Managing the list (adding, removing, the "buddy entered" notification)
   * is a separate task.
   */
  public async getBuddySlots(memberId: number): Promise<(string | null)[]> {
    const slots: (string | null)[] = new Array(MemberDataService.BUDDY_SLOTS).fill(null);
    if (!memberId) return slots;

    const stored = await this.memberDataRepository
      .getByPrefix(memberId, MemberDataService.BUDDY_PREFIX);
    for (const [name, value] of Object.entries(stored)) {
      const suffix = name.slice(MemberDataService.BUDDY_PREFIX.length);
      // Exactly one digit, matched as text before any numeric conversion. A prefix match is
      // not a slot name: Number('') is 0, so a bare 'BU' would otherwise land in slot 0, and
      // Number() also accepts 'BU01' and 'BU1e0' as 1, colliding with BU1. Any future BU*
      // attribute that is not a slot would be silently read as one too.
      if (!/^[0-9]$/.test(suffix)) continue;
      const index = Number(suffix);
      if (index < MemberDataService.BUDDY_SLOTS) {
        slots[index] = value;
      }
    }
    return slots;
  }

  /**
   * The member's buddy nicknames lowercased, for membership tests.
   *
   * Buddies are stored by NICKNAME, not id, so comparison has to be case-insensitive --
   * the original's own field set includes NNK, a lowercased nickname, precisely because
   * nicknames are matched case-insensitively.
   */
  public async getBuddyNameSet(memberId: number): Promise<Set<string>> {
    const slots = await this.getBuddySlots(memberId);
    return new Set(
      slots.filter((name): name is string => !!name).map(name => name.toLowerCase()),
    );
  }
}
