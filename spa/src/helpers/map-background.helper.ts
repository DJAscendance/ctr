/**
 * Pure state and URL logic for the classic map background selector.
 *
 * The selector restores the blaxxun-era "Multimedia Wizard" background step
 * (`colonycity/templates/block/wizard/image.tmpl`), which offered one radio per
 * candidate image, marked the current choice, and saved on "Ok".
 *
 * Everything here is deliberately free of Vue and of the DOM so the SPA's
 * dependency-free test harness can exercise the real behaviour rather than a
 * rendered approximation. The component in
 * `components/PlaceMapBackgroundSelector.vue` is a thin view over these
 * functions.
 *
 * The server is authoritative. This module never derives a theme, an index
 * pool, or a filename - it only consumes what the MAP-1 endpoints return.
 */

/** One candidate background, exactly as the MAP-1 read endpoint reports it. */
export interface MapBackgroundOption {
  index: number;
  url: string;
}

/** The MAP-1 `GET /<place>/:id/map-background-options` response body. */
export interface MapBackgroundOptionsResponse {
  selectedIndex: number | null;
  effectiveIndex: number;
  effectiveUrl: string;
  options: MapBackgroundOption[];
}

/** Which place kind the selector is editing. MAP-2 only wires up "block". */
export type MapBackgroundPlaceType = "block" | "hood";

export type MapBackgroundStatus =
  | "loading"
  | "ready"
  | "saving"
  | "readFailed"
  | "forbidden";

export type MapBackgroundMessageKind = "" | "success" | "error";

export interface MapBackgroundState {
  status: MapBackgroundStatus;
  /** Whether the viewer may change the background at all. */
  canEdit: boolean;
  /** The raw stored value. `null` means the place never chose one. */
  selectedIndex: number | null;
  /** The index that actually renders. Never outside `options`. */
  effectiveIndex: number;
  /** The URL that actually renders. */
  effectiveUrl: string;
  options: MapBackgroundOption[];
  /** The radio the viewer currently has highlighted. */
  pendingIndex: number;
  message: string;
  messageKind: MapBackgroundMessageKind;
}

/**
 * The historical wizard drew each candidate at 160x80
 * (`image.tmpl`: `width=160 height=80`).
 */
export const MAP_BACKGROUND_THUMBNAIL_WIDTH = 160;
export const MAP_BACKGROUND_THUMBNAIL_HEIGHT = 80;

/** Proven historical strings, kept verbatim. */
export const MAP_BACKGROUND_PROMPT = "Choose a background image";
export const MAP_BACKGROUND_EMPTY_MESSAGE = "No images available!";
export const MAP_BACKGROUND_SUBMIT_LABEL = "Ok";

/** Short adapted messages. They never carry a server path or a raw error. */
export const MAP_BACKGROUND_READ_FAILED_MESSAGE =
  "The background images could not be loaded.";
export const MAP_BACKGROUND_SAVE_FAILED_MESSAGE =
  "The background image could not be saved.";
export const MAP_BACKGROUND_SAVED_MESSAGE = "Background image saved.";
export const MAP_BACKGROUND_FORBIDDEN_MESSAGE =
  "You cannot change the background image for this place.";

/** MAP-1 read endpoint for one place. */
export function mapBackgroundOptionsPath(
  placeType: MapBackgroundPlaceType,
  placeId: number | string,
): string {
  return `/${placeType}/${placeId}/map-background-options`;
}

/** MAP-1 write endpoint for one place. */
export function mapBackgroundSelectionPath(
  placeType: MapBackgroundPlaceType,
  placeId: number | string,
): string {
  return `/${placeType}/${placeId}/map-background-selection`;
}

/**
 * The write body. MAP-1 takes the bare integer index and canonicalises 0 to a
 * stored null itself, so the client sends the chosen index unchanged and never
 * invents a second "explicit zero" meaning.
 */
export function mapBackgroundSelectionPayload(index: number): { index: number } {
  return { index };
}

/** The historical admin template labelled each image `Map Index: <n>`. */
export function mapBackgroundAltText(index: number): string {
  return `Map Index: ${index}`;
}

/** Starting state, before the first read completes. */
export function initialMapBackgroundState(): MapBackgroundState {
  return {
    status: "loading",
    canEdit: false,
    selectedIndex: null,
    effectiveIndex: 0,
    effectiveUrl: "",
    options: [],
    pendingIndex: 0,
    message: "",
    messageKind: "",
  };
}

/**
 * Records the viewer's edit authority. The server is still the security
 * boundary; this only decides whether an active control is offered.
 */
export function applyEditAuthority(
  state: MapBackgroundState,
  canEdit: boolean,
): MapBackgroundState {
  return { ...state, canEdit };
}

/**
 * Adopts a successful read. The highlighted radio starts on what actually
 * renders, so a stale stored index never pre-selects a missing image.
 */
export function applyLoaded(
  state: MapBackgroundState,
  response: MapBackgroundOptionsResponse,
): MapBackgroundState {
  return {
    ...state,
    status: "ready",
    selectedIndex: response.selectedIndex,
    effectiveIndex: response.effectiveIndex,
    effectiveUrl: response.effectiveUrl,
    options: response.options,
    pendingIndex: response.effectiveIndex,
    message: "",
    messageKind: "",
  };
}

/** A failed read leaves no options and no editing control. */
export function applyReadFailure(state: MapBackgroundState): MapBackgroundState {
  return {
    ...state,
    status: "readFailed",
    options: [],
    message: MAP_BACKGROUND_READ_FAILED_MESSAGE,
    messageKind: "error",
  };
}

/** Highlights one candidate. Only an offered index is accepted. */
export function chooseIndex(
  state: MapBackgroundState,
  index: number,
): MapBackgroundState {
  if (state.status !== "ready" || !state.canEdit) {
    return state;
  }
  if (!state.options.some(option => option.index === index)) {
    return state;
  }
  return { ...state, pendingIndex: index, message: "", messageKind: "" };
}

/**
 * True when "Ok" may be pressed. The highlighted radio must differ from what
 * already renders, so a no-op save is never sent.
 */
export function canSaveMapBackground(state: MapBackgroundState): boolean {
  return (
    state.status === "ready" &&
    state.canEdit &&
    state.options.length > 0 &&
    state.pendingIndex !== state.effectiveIndex
  );
}

/** True while no control may be operated. */
export function mapBackgroundControlsDisabled(state: MapBackgroundState): boolean {
  return state.status !== "ready" || !state.canEdit;
}

/** True when the read succeeded but the place's theme ships no candidates. */
export function hasNoMapBackgroundOptions(state: MapBackgroundState): boolean {
  return state.status === "ready" && state.options.length === 0;
}

/** Enters the in-flight save state. Refuses when a save is not allowed. */
export function beginSave(state: MapBackgroundState): MapBackgroundState {
  if (!canSaveMapBackground(state)) {
    return state;
  }
  return { ...state, status: "saving", message: "", messageKind: "" };
}

/**
 * Adopts a successful save. The write endpoint returns only `selectedIndex`,
 * so the effective values stay untouched here and the caller re-reads to get
 * them. Nothing else may report success.
 */
export function applySaveSuccess(
  state: MapBackgroundState,
  selectedIndex: number | null,
): MapBackgroundState {
  return {
    ...state,
    status: "ready",
    selectedIndex,
    message: MAP_BACKGROUND_SAVED_MESSAGE,
    messageKind: "success",
  };
}

/**
 * Adopts a failed save. A 403 withdraws the control entirely; anything else
 * returns to a usable form with a short error. Neither reports success.
 */
export function applySaveFailure(
  state: MapBackgroundState,
  status?: number,
): MapBackgroundState {
  if (status === 401 || status === 403) {
    return {
      ...state,
      status: "forbidden",
      canEdit: false,
      message: MAP_BACKGROUND_FORBIDDEN_MESSAGE,
      messageKind: "error",
    };
  }
  return {
    ...state,
    status: "ready",
    message: MAP_BACKGROUND_SAVE_FAILED_MESSAGE,
    messageKind: "error",
  };
}
