/**
 * Load sequencing for the scoped place Update hubs.
 *
 * WHY THIS EXISTS. `PlaceUpdatePage` and `PlaceUpdateHub` are each ONE component
 * instance reused across every place of their tier: vue-router keeps the instance
 * and swaps the params, so `mounted()` runs once and a later navigation never
 * re-resolves. The page then keeps showing the first place it ever loaded - its
 * name, its tiles, its child list - and a failed first lookup keeps showing
 * "Insufficient access rights" for places the member may in fact administer.
 *
 * Two properties are needed, and neither is safe to leave in a component:
 *
 * 1. A RESET THAT CANNOT FORGET A FIELD. Clearing state field-by-field on each
 *    navigation is exactly the kind of code that rots - add a field to the hub,
 *    forget the reset, and one more scrap of the previous place survives. So the
 *    whole state object is REPLACED by a freshly built empty one. There is no
 *    field-by-field reset to keep in sync, and no way to add state that escapes
 *    it.
 *
 * 2. STALE-RESPONSE PROTECTION. Navigating A -> B -> C starts three loads that
 *    can settle in any order; A or B answering last must not overwrite C. Every
 *    load takes a token from a monotonic sequence and its result is discarded
 *    unless that token is still the newest. A watcher alone does not give this -
 *    it re-fires, but the in-flight older request still lands.
 *
 * Authorization is NOT decided here. Every capability comes from the server's
 * `GET /place/:id/update-hub` for the STORED place row; this module only decides
 * which answer is current. A discarded response is discarded in the safe
 * direction: the state stays empty (`loaded: false`), never "allowed".
 */
import { childListCapability } from "./place-update-hub.helper";

/** The place-id resolution owned by `PlaceUpdatePage`. */
export interface PlaceResolveState {
  placeId: number;
  unresolved: boolean;
}

/** Everything `PlaceUpdateHub` can render about a place. */
export interface HubState {
  loaded: boolean;
  denied: boolean;
  hub: any | null;
  children: any[];
}

/**
 * The injected HTTP client - the components pass their `$http`, tests pass a
 * double, so nothing here needs a network. Typed loosely to match how the
 * components already hold it.
 */
export type HubHttp = any;

/**
 * A monotonic token source. `begin()` starts a load and returns its token;
 * `isStale()` reports whether a newer load has started since.
 */
export class LoadSequence {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  isStale(token: number): boolean {
    return token !== this.current;
  }
}

/** The cleared resolve state. Nothing from a previous place survives it. */
export function emptyResolveState(): PlaceResolveState {
  return { placeId: 0, unresolved: false };
}

/** The cleared hub state. Nothing from a previous place survives it. */
export function emptyHubState(): HubState {
  return { loaded: false, denied: false, hub: null, children: [] };
}

/**
 * Whether a navigation changes which place an Update hub is showing.
 *
 * The tier is part of the answer, not just the id: `/neighborhood/5/update` and
 * `/block/5/update` share an id and are different places. Comparing the route
 * NAME covers that, and covers a param change within one tier.
 */
export function placeUpdateRouteChanged(
  to: { name?: string | null; params?: Record<string, string> },
  from: { name?: string | null; params?: Record<string, string> },
): boolean {
  const toParams = to.params || {};
  const fromParams = from.params || {};
  return to.name !== from.name || toParams.id !== fromParams.id;
}

/**
 * Resolves the route param to a place id.
 *
 * The tiers are addressed differently - `/neighborhood/:id` and `/block/:id`
 * carry a numeric place id, `/place/:id` carries a colony SLUG - so the colony
 * branch has to ask the server. `tier` comes from the route table, never from
 * the user, and grants nothing.
 */
async function resolve(
  param: string,
  tier: string,
  http: HubHttp,
): Promise<PlaceResolveState> {
  if (tier !== "colony") {
    const parsed = Number.parseInt(param, 10);
    if (Number.isNaN(parsed)) return { placeId: 0, unresolved: true };
    return { placeId: parsed, unresolved: false };
  }
  try {
    const response = await http.get(`/place/${param}`);
    const place = response.data && response.data.place;
    if (!place || !place.id) return { placeId: 0, unresolved: true };
    return { placeId: place.id, unresolved: false };
  } catch (e) {
    return { placeId: 0, unresolved: true };
  }
}

/**
 * The controller behind `PlaceUpdatePage`.
 *
 * `state` is replaced wholesale on every load, so a navigation cannot leave the
 * previous place's id addressable or a previous failure latched on screen.
 */
export function createPlaceResolver(http: HubHttp) {
  const sequence = new LoadSequence();
  const controller = {
    state: emptyResolveState(),
    async reload(param: string, tier: string): Promise<void> {
      const token = sequence.begin();
      // Cleared BEFORE the request starts, so nothing from the previous place is
      // on screen while the new one loads.
      controller.state = emptyResolveState();
      const next = await resolve(param, tier, http);
      if (sequence.isStale(token)) return;
      controller.state = next;
    },
  };
  return controller;
}

/**
 * The controller behind `PlaceUpdateHub`.
 *
 * `canOpen` is narrower than "the endpoint answered 200": the server grants it
 * only when a capability whose control lives IN the hub was granted, so a member
 * holding just tool-bar or moderation capabilities is refused rather than shown
 * an empty page. A tier mismatch is refused for the same reason - it means the
 * URL named the wrong tier for the stored row.
 */
export function createHubLoader(http: HubHttp) {
  const sequence = new LoadSequence();

  /**
   * Whether the answer warrants listing children. Decided against the hub being
   * loaded, never against whatever is currently on screen, and from the same
   * catalogue the tiles come from.
   */
  function wantsChildren(hub: any): boolean {
    const capability = childListCapability(hub.type);
    return !!capability && hub.capabilities.includes(capability);
  }

  async function fetchChildren(hub: any): Promise<any[]> {
    try {
      if (hub.type === "colony" && hub.slug) {
        const response = await http.get(`/colony/${hub.slug}/hoods`);
        return (response.data && response.data.hoods) || [];
      }
      if (hub.type === "hood") {
        const response = await http.get(`/hood/${hub.placeId}/blocks`);
        return (response.data && response.data.blocks) || [];
      }
    } catch (e) {
      // A failed child listing is not a refusal - the hub itself was authorized.
      return [];
    }
    return [];
  }

  const controller = {
    state: emptyHubState(),
    async reload(placeId: number, expectedType: string): Promise<void> {
      const token = sequence.begin();
      controller.state = emptyHubState();
      let next: HubState;
      try {
        const response = await http.get(`/place/${placeId}/update-hub`);
        const hub = response.data && response.data.hub;
        if (!hub || hub.type !== expectedType || hub.canOpen !== true) {
          next = { loaded: true, denied: true, hub: null, children: [] };
        } else {
          const children = wantsChildren(hub) ? await fetchChildren(hub) : [];
          next = { loaded: true, denied: false, hub, children };
        }
      } catch (e) {
        next = { loaded: true, denied: true, hub: null, children: [] };
      }
      if (sequence.isStale(token)) return;
      controller.state = next;
    },
  };
  return controller;
}
