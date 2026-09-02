/**
 * Pure decision logic for the Blaxxun keyboard bridge - `Browser.eventMask`
 * and the `event_changed` eventOut. Kept free of X_ITE and of the DOM so the
 * dependency-free test harness can exercise it; `libs/x_ite_mods/bxx_events.js`
 * is the thin binding over this module.
 *
 * THE EVENT SHAPE IS PROVEN, THE MASK BITS ARE NOT.
 *
 * Proven, from `places/ne_game/vrml/ne_game.wrl` `function onEvent(e, t)`:
 *
 *   e.type      compared against 'keydown', 'keyup', 'mouseup'
 *   e.keyCode   compared against 65 (A) 68 (D) 87 (W) 88 (X) 90 (Z)
 *                                  71 (G) 32 (space) 70 (F) 69 (E) 83 (S)
 *   e.button    compared against 2 and 3, on 'mouseup'
 *   e.shiftKey  compared against 1
 *   e.ctrlKey   compared against 1
 *   e.returnValue  ASSIGNED 0 by the script to suppress the default action
 *
 * Not proven: which bit of `eventMask` enables which class of event. The world
 * only ever writes `m | (1<<5) | (1<<6) | (1<<4)` - all three at once, never
 * individually - so no surviving evidence separates them. Rather than guess an
 * assignment and silently drop events, `maskAllows` treats any of bits 4..6 as
 * "deliver input events". The named constants below record the assignment the
 * world implies without the bridge depending on it.
 */

/** Bits the historical world sets before it asks for events. */
export const BXX_EVENT_MASK_BIT_4 = 1 << 4;
export const BXX_EVENT_MASK_BIT_5 = 1 << 5;
export const BXX_EVENT_MASK_BIT_6 = 1 << 6;

/** The exact value `initialize()` ORs into the mask. */
export const BXX_INPUT_MASK_BITS =
  BXX_EVENT_MASK_BIT_4 | BXX_EVENT_MASK_BIT_5 | BXX_EVENT_MASK_BIT_6;

/** Event type strings the historical script compares against. */
export const BXX_EVENT_TYPES = ["keydown", "keyup", "mouseup"] as const;
export type BxxEventType = (typeof BXX_EVENT_TYPES)[number];

/** The object handed to the historical `onEvent(e, t)`. */
export interface BxxEvent {
  type: string;
  keyCode: number;
  button: number;
  shiftKey: number;
  ctrlKey: number;
  altKey: number;
  /** 1 by default; the script writes 0 to suppress the browser default. */
  returnValue: number;
}

/** The subset of a DOM event this bridge reads. */
export interface DomLikeEvent {
  type: string;
  keyCode?: number;
  which?: number;
  key?: string;
  button?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/**
 * True when the mask has any input bit set. See the note at the top: the
 * per-class bit assignment is not recoverable, so this deliberately does not
 * pretend to distinguish keydown from keyup.
 */
export function maskAllows(mask: number): boolean {
  if (!Number.isFinite(mask)) {
    return false;
  }
  return (mask & BXX_INPUT_MASK_BITS) !== 0;
}

/** Only the three types the historical script handles are worth delivering. */
export function isDeliverableType(type: string): type is BxxEventType {
  return (BXX_EVENT_TYPES as readonly string[]).includes(type);
}

const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

/**
 * The world grabs D, W, A and the space bar. CTR has chat and form fields on
 * the same page, so an event whose target is editable must never reach the
 * game. Without this the world eats every character the citizen types.
 */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) {
    return true;
  }
  if (typeof element.tagName !== "string") {
    return false;
  }
  return EDITABLE_TAGS.includes(element.tagName.toUpperCase());
}

/**
 * Converts a DOM event into the historical shape. `shiftKey` and `ctrlKey`
 * become 1/0 numbers because the script compares them with `== 1`. `button` is
 * passed through unmapped: the DOM reports 2 for the right button and the
 * script suppresses on `button == 2 || button == 3`, so the raw value already
 * satisfies the historical check and remapping could only break it.
 */
export function toBxxEvent(event: DomLikeEvent): BxxEvent {
  const keyCode =
    typeof event.keyCode === "number"
      ? event.keyCode
      : typeof event.which === "number"
        ? event.which
        : 0;
  return {
    type: event.type,
    keyCode,
    button: typeof event.button === "number" ? event.button : -1,
    shiftKey: event.shiftKey ? 1 : 0,
    ctrlKey: event.ctrlKey ? 1 : 0,
    altKey: event.altKey ? 1 : 0,
    returnValue: 1,
  };
}

/**
 * The script writes `e.returnValue = 0` to disable a key. Reading it back after
 * delivery is how the bridge decides to call `preventDefault()`.
 */
export function shouldPreventDefault(event: Pick<BxxEvent, "returnValue">): boolean {
  return Number(event.returnValue) === 0;
}

/**
 * True when this event should reach the historical script at all. Combines the
 * three independent reasons to drop one, so the binding stays a one-liner and
 * the rules stay testable.
 */
export function shouldDeliver(mask: number, event: DomLikeEvent, target: unknown): boolean {
  if (!maskAllows(mask)) {
    return false;
  }
  if (!isDeliverableType(event.type)) {
    return false;
  }
  if (isEditableTarget(target)) {
    return false;
  }
  return true;
}
