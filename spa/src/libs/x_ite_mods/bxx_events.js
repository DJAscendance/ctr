/*eslint no-undef: 0*/
(function () {

  // Blaxxun `Browser.eventMask` and the `event_changed` eventOut. The
  // historical world wires itself to the keyboard like this:
  //
  //   m = Browser.eventMask;
  //   oldMask = m;
  //   m = m | (1<<5) | (1<<6) | (1<<4);
  //   Browser.eventMask = m;
  //   Browser.addRoute(Browser, 'event_changed', self, 'onEvent');
  //
  // ...and unwires itself the same way in shutdown(). X_ITE has neither the
  // property nor a routable Browser, and its own addRoute demands two
  // SFNodes, so the historical call throws today.
  //
  // The route is intercepted rather than made real: `event_changed` is
  // registered as a direct delivery target. Everything else falls through to
  // X_ITE untouched, so other CTR worlds are not affected.
  //
  // Decision logic lives in `src/helpers/bxx-key.helper.ts`. This file is the
  // X_ITE and DOM binding only.

  const helper = require("../../helpers/bxx-key.helper");

  // The carrier the historical script reads as `e`. Built as a real PROTO
  // instance so that `e.type`, `e.keyCode` and `e.returnValue = 0` behave the
  // way every other VRML script in this world already expects fields to.
  const EVENT_PROTO = "#VRML V2.0 utf8\n"
    + "PROTO BxxEvent [\n"
    + " exposedField SFString type \"\"\n"
    + " exposedField SFInt32 keyCode 0\n"
    + " exposedField SFInt32 button -1\n"
    + " exposedField SFInt32 shiftKey 0\n"
    + " exposedField SFInt32 ctrlKey 0\n"
    + " exposedField SFInt32 altKey 0\n"
    + " exposedField SFInt32 returnValue 1\n"
    + "]{}\n"
    + "BxxEvent{}\n";

  X3D.require(["x_ite/Browser/X3DBrowser"], function (Browser) {
    const b = Browser.prototype;

    function state(browser) {
      if (!browser._bxxEvents) {
        browser._bxxEvents = {
          mask: 0, targets: [], listeners: null, element: null, carrier: null,
        };
      }
      return browser._bxxEvents;
    }

    Object.defineProperty(b, "eventMask", {
      get: function () { return state(this).mask; },
      set: function (value) {
        state(this).mask = Number(value) || 0;
        syncListeners(this);
      },
    });

    function carrierOf(browser) {
      const s = state(browser);
      if (s.carrier) { return s.carrier; }
      try {
        const nodes = browser.createVrmlFromString(EVENT_PROTO);
        s.carrier = nodes && nodes.length ? nodes[0] : null;
      } catch (error) {
        console.warn("bxx_events: could not build the event carrier node", error);
        s.carrier = null;
      }
      return s.carrier;
    }

    // Historical delivery: set the fields, hand the node to the script's
    // eventIn, then read returnValue back to decide on preventDefault.
    function deliver(browser, domEvent) {
      const s = state(browser);
      if (s.targets.length === 0) { return; }
      if (!helper.shouldDeliver(s.mask, domEvent, domEvent.target)) { return; }

      const carrier = carrierOf(browser);
      if (!carrier) { return; }

      const payload = helper.toBxxEvent(domEvent);
      try {
        carrier.type = payload.type;
        carrier.keyCode = payload.keyCode;
        carrier.button = payload.button;
        carrier.shiftKey = payload.shiftKey;
        carrier.ctrlKey = payload.ctrlKey;
        carrier.altKey = payload.altKey;
        carrier.returnValue = 1;
      } catch (error) {
        console.warn("bxx_events: could not populate the event carrier", error);
        return;
      }

      // The eventIn accessor lives on the SFNode WRAPPER, not on the base node
      // getValue() returns - the same asymmetry that hides `children` from a
      // base node. Assign to the wrapper first, and only fall back to the base.
      for (let i = 0; i < s.targets.length; ++i) {
        const target = s.targets[i];
        try {
          target.node[target.field] = carrier;
        } catch (error) {
          try {
            const base = typeof target.node.getValue === "function"
              ? target.node.getValue()
              : null;
            if (base) { base[target.field] = carrier; }
          } catch (innerError) {
            console.warn(`bxx_events: delivery to ${ target.field } failed`, innerError);
          }
        }
      }

      try {
        if (helper.shouldPreventDefault({ returnValue: Number(carrier.returnValue) })
          && typeof domEvent.preventDefault === "function") {
          domEvent.preventDefault();
        }
      } catch (error) { /* carrier field read failed; leave the default alone */ }
    }

    // Listeners are bound to the X_ITE element, never to window or
    // document, so they cannot outlive the canvas or reach CTR's own forms.
    function elementOf(browser) {
      try {
        const element = browser.getElement();
        if (!element) { return null; }
        if (element[0]) { return element[0]; }
        if (typeof element.get === "function") { return element.get(0); }
        return element;
      } catch (error) {
        return null;
      }
    }

    function syncListeners(browser) {
      const s = state(browser);
      const wanted = s.targets.length > 0 && helper.maskAllows(s.mask);
      if (wanted && !s.listeners) { attach(browser); }
      if (!wanted && s.listeners) { detach(browser); }
    }

    function attach(browser) {
      const s = state(browser);
      const element = elementOf(browser);
      if (!element || typeof element.addEventListener !== "function") { return; }

      // A canvas only receives key events when it can hold focus.
      if (element.tabIndex === undefined || element.tabIndex < 0) { element.tabIndex = 0; }

      const handler = function (domEvent) { deliver(browser, domEvent); };
      s.listeners = { keydown: handler, keyup: handler, mouseup: handler };
      s.element = element;
      element.addEventListener("keydown", s.listeners.keydown);
      element.addEventListener("keyup", s.listeners.keyup);
      element.addEventListener("mouseup", s.listeners.mouseup);
    }

    function detach(browser) {
      const s = state(browser);
      if (!s.listeners || !s.element) { s.listeners = null; s.element = null; return; }
      s.element.removeEventListener("keydown", s.listeners.keydown);
      s.element.removeEventListener("keyup", s.listeners.keyup);
      s.element.removeEventListener("mouseup", s.listeners.mouseup);
      s.listeners = null;
      s.element = null;
    }

    // Route interception. Only the Browser-as-source `event_changed` case is
    // claimed; every other call goes to X_ITE unchanged.
    const originalAddRoute = b.addRoute;
    const originalDeleteRoute = b.deleteRoute;

    function isBrowserEventRoute(browser, fromNode, fromEventOut) {
      return fromNode === browser && String(fromEventOut) === "event_changed";
    }

    b.addRoute = function (fromNode, fromEventOut, toNode, toEventIn) {
      if (!isBrowserEventRoute(this, fromNode, fromEventOut)) {
        return originalAddRoute.call(this, fromNode, fromEventOut, toNode, toEventIn);
      }
      const s = state(this);
      const field = String(toEventIn);
      const already = s.targets.some(function (t) {
        return t.node === toNode && t.field === field;
      });
      if (!already) { s.targets.push({ node: toNode, field: field }); }
      syncListeners(this);
      return undefined;
    };

    b.deleteRoute = function (fromNode, fromEventOut, toNode, toEventIn) {
      if (!isBrowserEventRoute(this, fromNode, fromEventOut)) {
        return originalDeleteRoute.call(this, fromNode, fromEventOut, toNode, toEventIn);
      }
      const s = state(this);
      const field = String(toEventIn);
      s.targets = s.targets.filter(function (t) {
        return !(t.node === toNode && t.field === field);
      });
      syncListeners(this);
      return undefined;
    };

    // A world reload must not leave the previous world's listeners behind.
    const originalLoadURL = b.loadURL;
    b.loadURL = function () {
      const s = state(this);
      detach(this);
      s.targets = [];
      s.carrier = null;
      return originalLoadURL.apply(this, arguments);
    };
  });

})();
