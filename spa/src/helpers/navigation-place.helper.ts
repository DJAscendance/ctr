/**
 * The place a navigation asked for may only be stored if that navigation lands.
 *
 * WHAT THIS SOLVES. `router.beforeEach` in `main.ts` fetches the place for the route
 * being navigated to and writes `appStore.data.place` from inside the guard. That fetch
 * is asynchronous, and vue-router never tells an in-flight `.then` that its navigation
 * has gone, so an answer for a place the citizen never reached could land on top of the
 * place they are standing in. A navigation goes two ways:
 *
 *   * a later navigation starts. `History.confirmTransition` sets `this.pending` to the
 *     new route, and the earlier navigation is cancelled the next time its queue touches
 *     a hook - which is when the earlier guard finally calls `next()`.
 *   * the citizen asks again for the route the app is still on. That is
 *     `isSameRoute(route, current)`, so vue-router aborts it as a duplicate - but it sets
 *     `this.pending` to that route FIRST, so the navigation already in flight is
 *     cancelled even though NO guard runs for the duplicate at all. Nothing re-fetches
 *     the place the citizen is standing in, so nothing corrects the store afterwards.
 *
 * THE RULE. A fetched place is STAGED against the navigation that asked for it, and is
 * committed only when vue-router confirms that same navigation.
 *
 * WHY THE ROUTE OBJECT IS THE IDENTITY. vue-router builds exactly one frozen `Route` per
 * navigation in `transitionTo` and hands that same object to every `beforeEach` hook and,
 * on success only, to every `afterEach` hook. Object identity therefore IS "this
 * navigation": it needs no counter of our own, and two navigations to the same path
 * cannot be confused for each other. A cancelled navigation is simply never confirmed, so
 * its staged place is never committed - no ordering assumption, no timer, no guess about
 * which callback finishes first.
 *
 * `afterEach` still runs before the citizen sees anything: vue-router calls it
 * synchronously right after `updateRoute()`, and Vue queues the re-render for the new
 * route to the next tick. So the store is correct before the new page is created, exactly
 * as it was when the guard wrote it directly.
 *
 * WHY A WeakMap. A navigation that never lands would otherwise keep its staged place
 * forever. Keyed weakly, the entry goes when vue-router drops the route object, so a
 * cancelled navigation leaves no permanent state behind. `Route` is frozen, so nothing
 * may be hung off the object itself instead.
 *
 * This module knows nothing about any particular place, and is deliberately free of
 * imports so the dependency-free SPA test harness can load it - the same reason every
 * other tested rule lives in `src/helpers`.
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

  /** Whether this navigation still has a value waiting. Read by the gates. */
  isStaged(navigation: Navigation): boolean {
    return this.staged.has(navigation);
  }
}
