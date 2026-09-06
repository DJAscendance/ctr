(function () {

  /*
   * Delivery of the blaxxun browser event route.
   *
   * bxx_auth.js accepts `Browser.addRoute(Browser, 'event_changed', script,
   * 'onEvent')` and records it, so a world that asks for browser events no
   * longer dies on the call. It deliberately stopped there: a route that
   * carries no events is honest, a route that carries wrong ones is not. This
   * patch carries the events.
   *
   * Outlands is the world that needs it. ne_game.wrl's `battle` Script is
   * driven entirely from this route - D fires the weapon, W changes it, A pans
   * - and it also uses the route to suppress the blaxxun client's own
   * single-key shortcuts so they cannot fight the game.
   *
   *
   * WHY THE EVENT IS A NODE
   *
   * The historical eventIn is declared `eventIn SFNode onEvent`, not SFString
   * or SFInt32, and the handler both reads fields off the value (`e.type`,
   * `e.keyCode`, `e.button`, `e.shiftKey`, `e.ctrlKey`) and writes one back
   * (`e.returnValue = 0` to swallow the key). That is a node with exposed
   * fields, which is why blaxxun could pass it and read the answer out again.
   *
   * X_ITE's SFNode field agrees: its setter tests `value.getType()` and stores
   * null for anything that is not an X3DNode, so a plain JavaScript object
   * never reaches the Script. The event below is therefore a real node, built
   * once per browser from a PROTO whose exposed fields are exactly the ones the
   * historical handlers read, and re-used for every event. `returnValue` is
   * read back after the Script has run, which is how a world still gets to
   * cancel a key.
   *
   *
   * THE EVENT MASK
   *
   * blaxxun gated delivery on `Browser.eventMask`. Only one bit is documented
   * by the recovered evidence: object/preview.wrl and adm/image.wrl both set
   * `m = m | (1<<4) ; // up` and then handle nothing but `mouseup`. ne_game.wrl
   * sets `(1<<4) | (1<<5) | (1<<6)` and handles exactly mouseup, keydown and
   * keyup, so bits 5 and 6 are the two key events. The mapping below is the
   * only one consistent with every world in the evidence.
   */

  X3D.require(['x_ite/Browser/X3DBrowser'], function (Browser) {
    var b = Browser.prototype

    var MASK_MOUSEUP = 1 << 4
    var MASK_KEYDOWN = 1 << 5
    var MASK_KEYUP = 1 << 6

    function maskFor(type) {
      if (type === 'keydown') return MASK_KEYDOWN
      if (type === 'keyup') return MASK_KEYUP
      if (type === 'mouseup') return MASK_MOUSEUP
      return 0
    }

    /*
     * The event node's interface. Every field here is read by a recovered
     * handler; nothing is added on speculation. `returnValue` starts at 1 -
     * "not cancelled" - and a Script sets it to 0 to swallow the key, which is
     * the sense ne_game.wrl uses it in.
     */
    var EVENT_WORLD = '#VRML V2.0 utf8\n'
      + 'PROTO BlaxxunBrowserEvent [\n'
      + '  exposedField SFString type ""\n'
      + '  exposedField SFInt32  keyCode 0\n'
      + '  exposedField SFInt32  button 0\n'
      + '  exposedField SFInt32  shiftKey 0\n'
      + '  exposedField SFInt32  ctrlKey 0\n'
      + '  exposedField SFInt32  altKey 0\n'
      + '  exposedField SFInt32  returnValue 1\n'
      + '] { Group {} }\n'
      + 'DEF bxxEvent BlaxxunBrowserEvent {}\n'

    function eventNode(browser) {
      if (browser.blaxxunEventNode_) return browser.blaxxunEventNode_
      try {
        var nodes = browser.createVrmlFromString(EVENT_WORLD)
        browser.blaxxunEventNode_ = nodes && nodes[0] ? nodes[0] : null
      } catch (error) {
        console.warn('[bxx_events] could not build the browser event node', error)
        browser.blaxxunEventNode_ = null
      }
      return browser.blaxxunEventNode_
    }

    /*
     * blaxxun numbered the mouse buttons from one; the recovered right-click
     * suppressions test `e.button == 2`, and DOM numbers the same button 2 from
     * zero. Adding one would move right-click to 3, which ne_game.wrl also
     * suppresses, so either mapping silences the same menu - but preview.wrl
     * tests 2 alone, and that pins it.
     */
    function buttonOf(domEvent) {
      return typeof domEvent.button === 'number' ? domEvent.button : 0
    }

    /*
     * A world only owns the keyboard while the 3D screen owns the focus.
     *
     * The historical instructions say as much - "click on the 3D screen to
     * restore keyboard control" - and CTR needs it for a second reason blaxxun
     * did not have: the world shares a page with chat, with forms and with the
     * password box, and a member typing "dwa" into any of them must not empty
     * their weapon.
     *
     * Binding to the canvas rather than the document is most of the answer,
     * since a focused text field takes the key events away by itself. The test
     * below is the rest of it, for the case where a control is focused but the
     * key still bubbles to the canvas.
     */
    function textEntryHasFocus() {
      var active = document.activeElement
      if (!active) return false
      if (active.isContentEditable) return true
      var tag = active.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    function deliver(browser, domEvent, type) {
      var routes = browser.browserEventRoutes_
      if (!routes || !routes.length) return
      if (!(browser.eventMask & maskFor(type))) return
      if (textEntryHasFocus()) return

      var node = eventNode(browser)
      if (!node) return

      node.type = type
      node.keyCode = typeof domEvent.keyCode === 'number' ? domEvent.keyCode : 0
      node.button = type === 'mouseup' ? buttonOf(domEvent) : 0
      node.shiftKey = domEvent.shiftKey ? 1 : 0
      node.ctrlKey = domEvent.ctrlKey ? 1 : 0
      node.altKey = domEvent.altKey ? 1 : 0
      node.returnValue = 1

      /*
       * A Script whose scene has already been replaced throws when its eventIn
       * is written. Dropping the route on the first throw is what keeps the
       * list from growing across world changes even if a world never reached
       * its shutdown().
       */
      var live = []
      for (var i = 0; i < routes.length; i += 1) {
        var route = routes[i]
        if (route.field !== 'event_changed') { live.push(route); continue }
        try {
          route.node[route.eventIn] = node
          live.push(route)
        } catch (error) {
          console.warn('[bxx_events] dropping a dead browser event route', error)
        }
      }
      browser.browserEventRoutes_ = live

      if (node.returnValue === 0) {
        domEvent.preventDefault()
        domEvent.stopPropagation()
      }
    }

    /*
     * Installed once per browser element. WorldBrowserPage keeps one browser
     * for the whole session and replaces the world inside it, so binding here
     * rather than per world is what keeps the listener count flat across the
     * hundred-transition memory run.
     */
    b.installBlaxxunEventDelivery = function () {
      if (this.blaxxunEventHandlers_) return
      var element = this.getElement()
      if (!element) return
      var browser = this

      /* Key events only reach an element that can hold focus. */
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0')

      var handlers = {
        element: element,
        keydown: function (e) { deliver(browser, e, 'keydown') },
        keyup: function (e) { deliver(browser, e, 'keyup') },
        mouseup: function (e) { deliver(browser, e, 'mouseup') },
        /* "Click on the 3D screen to restore keyboard control." */
        pointerdown: function () {
          if (typeof element.focus === 'function') element.focus({ preventScroll: true })
        },
      }
      element.addEventListener('keydown', handlers.keydown)
      element.addEventListener('keyup', handlers.keyup)
      element.addEventListener('mouseup', handlers.mouseup)
      element.addEventListener('pointerdown', handlers.pointerdown)
      this.blaxxunEventHandlers_ = handlers
    }

    b.removeBlaxxunEventDelivery = function () {
      var handlers = this.blaxxunEventHandlers_
      if (!handlers) return
      handlers.element.removeEventListener('keydown', handlers.keydown)
      handlers.element.removeEventListener('keyup', handlers.keyup)
      handlers.element.removeEventListener('mouseup', handlers.mouseup)
      handlers.element.removeEventListener('pointerdown', handlers.pointerdown)
      this.blaxxunEventHandlers_ = null
    }

  })

})();
