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
   * never reaches the Script. The event is therefore a real node, built from a
   * PROTO whose exposed fields are exactly the ones the historical handlers
   * read. `returnValue` is read back after the write, which is how a world
   * still gets to cancel a key.
   *
   *
   * WHY THERE IS A POOL AND NOT ONE NODE
   *
   * This patch used to build that node once per browser and mutate it for
   * every event. blaxxun could do that because it ran the receiving Script
   * inside the DOM handler; X_ITE 16 does not. Writing a Script eventIn only
   * queues the event, and the Script reads the SFNode it was handed on a later
   * X_ITE tick.
   *
   * One node therefore loses events. A tapped key sends `keydown` and `keyup`
   * inside the same tick, both writes land on the same node, and the Script
   * wakes up to find `type` already overwritten to "keyup". In Outlands that
   * is exactly why a tapped D never fired and a tapped W never changed weapon,
   * while holding either key worked: the hold put a tick between the two
   * events. Both events were always delivered and always in order - only their
   * values were lost.
   *
   * So each delivered event gets a node of its own, taken from a pool. A node
   * goes back to the pool three animation frames after it was handed over, by
   * which time X_ITE has processed the tick that read it.
   *
   * The pool is what keeps this from trading an overwrite bug for a leak. It
   * grows only as far as the number of events genuinely in flight at once -
   * two, for a tapped key - and never past MAX_EVENT_NODES. A source that
   * outruns that cap has its newest event refused rather than being allowed to
   * take a node back off an event still waiting to be delivered, because that
   * is the very corruption this patch exists to stop. No ROUTE and no DOM
   * listener is created per event; both counts are unchanged.
   *
   *
   * WHY THERE IS ALSO A QUEUE
   *
   * A node each is necessary and not sufficient. The Script's eventIn is one
   * field, and X_ITE keeps one pending value for it: two writes inside one
   * X_ITE tick leave the second, and the Script is invoked once. Giving the
   * two events separate nodes stops them corrupting each other but does not
   * stop the second write from replacing the first before the tick runs.
   *
   * That is observable in ne_game.wrl, whose onEvent() acts on the keydown -
   * D fires, W changes weapon, A engages PAN - and on the keyup only to leave
   * PAN again. With both writes in one tick the Script sees the keyup alone:
   * a tapped A reports WALK and never PAN, a tapped W never changes weapon,
   * and a tapped D fires only when the two happened to straddle a frame.
   *
   * So delivery is paced. The first event of a burst is written straight
   * through, which is what keeps the returnValue answer readable inside the
   * DOM handler that raised it. Anything that arrives before the next X_ITE
   * tick is queued in order and written one per pair of animation frames -
   * a pair, because a single frame does not guarantee that X_ITE's own
   * callback has run in between, and a write that overtakes it lands in the
   * tick it was meant to follow.
   *
   * The queue holds events, never routes or listeners, and it drains on its
   * own. It is empty again within a frame or two of the last key.
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

    /*
     * The ceiling on events in flight at once.
     *
     * Delivery is paced at one event per two frames, so a real keyboard - a
     * fast typist reaches perhaps twenty events a second - never puts more
     * than two or three in the queue. The cap is set far above that so that
     * only a synthetic flood can reach it, and it costs one empty Group each.
     */
    var MAX_EVENT_NODES = 256

    function newEventNode(browser) {
      try {
        var nodes = browser.createVrmlFromString(EVENT_WORLD)
        return nodes && nodes[0] ? nodes[0] : null
      } catch (error) {
        console.warn('[bxx_events] could not build a browser event node', error)
        return null
      }
    }

    /*
     * Hands out a node that no Script is still reading.
     *
     * `free_` holds the nodes known to be finished with. `all_` holds every
     * node ever built for this browser, so the count can be seen from a test
     * and so the cap has something to count.
     */
    function eventPool(browser) {
      if (!browser.blaxxunEventPool_) {
        browser.blaxxunEventPool_ = { free_: [], all_: [] }
      }
      return browser.blaxxunEventPool_
    }

    function acquireEventNode(browser) {
      var pool = eventPool(browser)
      if (pool.free_.length) return pool.free_.pop()
      if (pool.all_.length < MAX_EVENT_NODES) {
        var node = newEventNode(browser)
        if (!node) return null
        pool.all_.push(node)
        return node
      }
      /*
       * Cap reached. Every node the pool owns is still carrying an event that
       * has not been read yet, so there is nothing to hand out: taking one
       * back would overwrite an event that is still queued. Refusing the new
       * event keeps everything already accepted correct, and only a source
       * flooding faster than any keyboard can get here.
       */
      console.warn('[bxx_events] browser event dropped: ' + MAX_EVENT_NODES + ' already in flight')
      return null
    }

    /* One animation frame, or the nearest thing to it on a page that has none. */
    function afterFrames(count, fn) {
      var step = function () {
        count -= 1
        if (count <= 0) return fn()
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step)
        else setTimeout(step, 16)
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(step)
      else setTimeout(step, 16)
    }

    /*
     * X_ITE reads the SFNode on its own tick, so the node cannot be recycled
     * in this turn of the event loop. Three frames is one full X_ITE tick with
     * slack either side, and one frame more than the queue's own pacing, so a
     * node can never be handed out again while the Script that was given it is
     * still to run.
     */
    function releaseEventNode(browser, node) {
      afterFrames(3, function () {
        var pool = eventPool(browser)
        if (pool.free_.indexOf(node) === -1 && pool.all_.indexOf(node) !== -1) {
          pool.free_.push(node)
        }
      })
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

    /*
     * Hands one event to every browser event route, in the order they were
     * registered.
     *
     * A Script whose scene has already been replaced throws when its eventIn
     * is written. Dropping the route on the first throw is what keeps the list
     * from growing across world changes even if a world never reached its
     * shutdown().
     */
    function writeToRoutes(browser, node) {
      var routes = browser.browserEventRoutes_ || []
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
    }

    function eventQueue(browser) {
      if (!browser.blaxxunEventQueue_) {
        browser.blaxxunEventQueue_ = { items_: [], pacing_: false }
      }
      return browser.blaxxunEventQueue_
    }

    /*
     * Writes the next queued event a clear X_ITE tick after the last one, and
     * stops pacing once nothing is waiting. Re-entered from its own frame
     * callback, so there is only ever one of these in flight per browser.
     */
    function drainEventQueue(browser) {
      var queue = eventQueue(browser)
      afterFrames(2, function () {
        var node = queue.items_.shift()
        if (!node) { queue.pacing_ = false; return }
        writeToRoutes(browser, node)
        releaseEventNode(browser, node)
        drainEventQueue(browser)
      })
    }

    function deliver(browser, domEvent, type) {
      var routes = browser.browserEventRoutes_
      if (!routes || !routes.length) return
      if (!(browser.eventMask & maskFor(type))) return
      if (textEntryHasFocus()) return

      var node = acquireEventNode(browser)
      if (!node) return

      node.type = type
      node.keyCode = typeof domEvent.keyCode === 'number' ? domEvent.keyCode : 0
      node.button = type === 'mouseup' ? buttonOf(domEvent) : 0
      node.shiftKey = domEvent.shiftKey ? 1 : 0
      node.ctrlKey = domEvent.ctrlKey ? 1 : 0
      node.altKey = domEvent.altKey ? 1 : 0
      node.returnValue = 1

      /* Another event is already occupying this tick; take a place in line. */
      var queue = eventQueue(browser)
      if (queue.pacing_) {
        queue.items_.push(node)
        return
      }

      writeToRoutes(browser, node)

      /*
       * Read straight back, which is the historical contract: a Script that
       * answers inside the write - as a synchronous handler does - still gets
       * to swallow the key it was asked about.
       */
      if (node.returnValue === 0) {
        domEvent.preventDefault()
        domEvent.stopPropagation()
      }

      releaseEventNode(browser, node)
      queue.pacing_ = true
      drainEventQueue(browser)
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

    /*
     * Drops everything the world being replaced left on the BROWSER.
     *
     * A blaxxun world claims two pieces of browser-level state in initialize():
     * the event mask, and a route from the browser's own `event_changed` into
     * one of its Scripts. Both are meant to be given back by shutdown(), and
     * X_ITE does not run a VRML97 Script's shutdown() when the world it lives
     * in is replaced, so both would otherwise outlive the world.
     *
     * writeToRoutes() already drops a dead route the first time it throws, so
     * nothing GROWS without bound - but that is lazy: it needs a key press to
     * happen, which means the world after Outlands starts holding a route into
     * a scene that is gone, and the Outlands mask. This is the eager half, and
     * it is what makes "old Script callbacks cannot affect the next world" true
     * at the moment of the change rather than at the next key press.
     *
     * The DOM listeners are deliberately NOT touched: they belong to the
     * canvas, not to the world, and are installed once per browser.
     */
    b.releaseBlaxxunWorldState = function () {
      this.browserEventRoutes_ = [];
      this.eventMask = 0;
      const queue = this.blaxxunEventQueue_;
      if (queue) { queue.items_.length = 0; }
    };

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
