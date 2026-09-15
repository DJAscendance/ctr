/**
 * A small typed event emitter.
 *
 * Vue 2 let any component instance double as an event bus through `$on`, `$off` and
 * `$emit`; Vue 3 removed that instance API. The two buses this app relied on - the modal
 * service and the root instance - now use this instead. It is the whole of what they need:
 * subscribe, unsubscribe, emit. Handlers are held in a `Set`, so subscribing the same
 * handler twice keeps one copy, which is what makes a remount safe.
 */
// eslint-disable-next-line no-unused-vars
type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    const set = this.handlers.get(event);
    if (set) set.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy first so a handler that unsubscribes itself cannot disturb this delivery.
    Array.from(set).forEach(handler => handler(payload));
  }

  /** How many handlers an event has. Exists for tests and leak checks. */
  listenerCount(event: keyof Events): number {
    const set = this.handlers.get(event);
    return set ? set.size : 0;
  }
}

/**
 * Application-wide events that used to travel over `this.$root.$emit(...)`.
 */
export interface AppEvents extends Record<string, unknown> {
  /** The Outlands entrance has put an avatar on the citizen; the world can now be joined. */
  "outlands-team-selected": unknown;
}

export const appEvents = new EventBus<AppEvents>();
