/**
 * The place a navigation asked for may only be stored if that navigation lands.
 *
 * WHAT THIS SOLVES. `router.beforeEach` in `main.ts` fetches `/place/<id>` for the
 * route being navigated to and puts the answer in `appStore.data.place`. The fetch
 * is asynchronous and can outlive its own navigation, and vue-router never tells an
 * in-flight `.then` that its navigation is gone. Two ways it goes:
 *
 *   * a later navigation starts. `History.confirmTransition` sets `this.pending` to
 *     the new route, and the earlier navigation is cancelled the next time its queue
 *     touches a hook - which is when the earlier guard finally calls `next()`.
 *   * the citizen goes back to the route the app is still on. That is
 *     `isSameRoute(route, current)`, so vue-router aborts it as a duplicate - but it
 *     sets `this.pending` to that route FIRST, so the pending navigation is cancelled
 *     even though no guard runs for the duplicate at all.
 *
 * The second one is the proven Outlands failure: standing in Outlands, a no-wait
 * Plaza/Outlands pair cancels the Plaza navigation and never runs a guard for the
 * return, so nothing re-fetched Outlands and nothing corrected the store. The Plaza
 * fetch then resolved into a store whose route, socket room and loaded world were all
 * Outlands. `applyAvatarIdentity()` reads that store, so `Browser.myAvatarName` fell
 * back from the presence key to the username and `Browser.myAvatarURL` fell back from
 * the historical address to the real asset - which breaks the Beamer's target test
 * and trips `ne_game.wrl`'s own anti-avatar-swap line.
 *
 * THE RULE. A fetched place is STAGED against the navigation that asked for it, and
 * is committed only when vue-router confirms that same navigation.
 *
 * WHY THE ROUTE OBJECT IS THE IDENTITY. vue-router builds exactly one frozen `Route`
 * per navigation in `transitionTo` and hands that same object to every `beforeEach`
 * hook and, on success only, to every `afterEach` hook. So object identity IS "this
 * navigation", it needs no counter of our own, and it cannot be confused by two
 * navigations to the same path. A cancelled navigation is simply never confirmed, so
 * its staged place is never committed - there is no ordering assumption, no timer and
 * no guess about which callback usually finishes first.
 *
 * `afterEach` still runs before the citizen sees anything: vue-router calls it
 * synchronously right after `updateRoute()`, and Vue's re-render of the new route is
 * queued to the next tick. So the store is correct before the page for the new route
 * is created, exactly as it was when the guard wrote it directly.
 *
 * WHY A WeakMap. A navigation that never lands keeps its staged place forever
 * otherwise. Keyed weakly, the entry goes when vue-router drops the route object.
 * `Route` is frozen, so nothing may be hung off the object itself.
 *
 * This module knows nothing about any particular place. Outlands is where the damage
 * showed up; the broken contract is the generic one, and so is the fix.
 */

/**
 * A navigation, identified only by the identity of the object vue-router made for it.
 * Deliberately not typed as `Route`: this module never reads a field off it.
 */
export type Navigation = object;

/**
 * What to do with a value whose navigation landed. The base `no-unused-vars` rule
 * misreads the parameter name of a TS function type as a real binding, so the rule is
 * turned off for this declaration only - the same way `bxx-ray.helper.ts` does it.
 */
// eslint-disable-next-line no-unused-vars
export type CommitNavigationValue<TValue> = (value: TValue) => void;

/** Stages a fetched value against a navigation and commits it if that navigation lands. */
export class NavigationScopedValue<TValue> {
  private readonly staged = new WeakMap<Navigation, TValue>();

  private readonly commit: CommitNavigationValue<TValue>;

  /** @param commit what to do with a value whose navigation was confirmed. */
  constructor(commit: CommitNavigationValue<TValue>) {
    this.commit = commit;
  }

  /**
   * Record what a navigation fetched. Safe to call for a navigation that is already
   * cancelled - a cancelled navigation is never confirmed, so this can never be read
   * back. A second call for the same navigation replaces the first.
   */
  stage(navigation: Navigation, value: TValue): void {
    this.staged.set(navigation, value);
  }

  /**
   * Called for a navigation vue-router confirmed. Commits that navigation's own staged
   * value and nothing else, so a value staged by some other navigation - superseded,
   * cancelled, or still in flight - cannot ride in on this one.
   *
   * @returns whether this navigation had a staged value to commit.
   */
  confirm(navigation: Navigation): boolean {
    if (!this.staged.has(navigation)) {
      return false;
    }
    const value = this.staged.get(navigation) as TValue;
    this.staged.delete(navigation);
    this.commit(value);
    return true;
  }

  /** Whether this navigation has a value waiting. Exists for the gates; nothing reads it. */
  isStaged(navigation: Navigation): boolean {
    return this.staged.has(navigation);
  }
}
