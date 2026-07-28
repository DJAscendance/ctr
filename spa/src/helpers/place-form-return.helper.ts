/**
 * Where the shared place forms go when Cancel is pressed.
 *
 * Message to All and Inbox to All are ONE component each, mounted under three
 * different parents as a named child with an empty path:
 *
 *   /place/:id        (colony and the public places)  ->  world-browser
 *   /neighborhood/:id                                 ->  neighborhoodpage
 *   /block/:id                                        ->  blockmap
 *
 * An empty child path means the form's own URL is identical to its parent place
 * view's URL, so the two routes ALIAS one path and `{ path }` cannot express
 * which is wanted: vue-router answers with the FIRST empty-path child declared.
 * The place view is declared first today, so the previous Cancel worked - by
 * declaration order rather than by intent. Reordering those siblings, an edit
 * with no visible connection to Cancel, would make the same push resolve back to
 * the form and Cancel would silently do nothing.
 *
 * (A review reported this as a duplicate-navigation abort. That does not
 * reproduce on vue-router 3.5.2 - verified against the pre-fix bundle in the
 * running preview, where Cancel moved the active route from `colonyInboxToAll`
 * to `world-browser`. The ordering fragility is the real defect.)
 *
 * Naming the destination removes the ambiguity, so this maps each form route to
 * its parent place view by name. Route names, not the place type in the store,
 * because the name is what the router already resolved and is available before
 * any data loads - Cancel works on a form entered directly, with no history
 * behind it.
 */

/** Form route name -> the parent place view's route name. */
export const PLACE_FORM_PARENT_ROUTE: Readonly<Record<string, string>> = {
  colonyMessageToAll: "world-browser",
  colonyInboxToAll: "world-browser",
  neighborhoodMessageToAll: "neighborhoodpage",
  neighborhoodInboxToAll: "neighborhoodpage",
  blockMessageToAll: "blockmap",
  blockInboxToAll: "blockmap",
};

/**
 * Last-resort destination: The Plaza, which every citizen can reach and which
 * needs no parameter from the form's own route. Used only if a form is mounted
 * under a parent that nobody added to the map above - a wrong-but-harmless
 * landing beats staying stuck on the form, which is the bug being fixed.
 */
export const PLACE_FORM_FALLBACK = Object.freeze({
  name: "world-browser",
  params: { id: "enter" },
});

export interface PlaceFormReturnTarget {
  name: string;
  params?: Record<string, string>;
}

/**
 * The Vue Router target Cancel should push, given the form's own route.
 *
 * The parent's parameters are reused unchanged: the parent place view takes the
 * same `:id` the form was mounted under, so this returns to *that* place rather
 * than to some default one.
 */
export function placeFormReturnTarget(
  routeName: string | null | undefined,
  params: Record<string, string> = {},
): PlaceFormReturnTarget {
  const parent = routeName ? PLACE_FORM_PARENT_ROUTE[routeName] : undefined;
  if (!parent) {
    return { name: PLACE_FORM_FALLBACK.name, params: { ...PLACE_FORM_FALLBACK.params } };
  }
  return { name: parent, params: { ...params } };
}
