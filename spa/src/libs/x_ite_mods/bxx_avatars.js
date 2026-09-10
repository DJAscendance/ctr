/* global X3D */
(function () {

  /*
   * The avatar half of the blaxxun hit record.
   *
   * bxx_rayhit.js rebuilt `Browser.computeRayHit` and returns the historical
   * shape of the answer: a hit record carrying `hitPoint` and `hitPath`, the
   * nodes from the scene root down to the shape the segment struck. What it
   * cannot know is which of those nodes is a person.
   *
   * blaxxun could, because the community client put every other member in the
   * room into the scene as its own `Avatar` node. That is the whole basis of
   * shooting in Outlands: ne_game.wrl's fire() walks the hit path looking for
   * one -
   *
   *   for(i = 0; i < ray.hitPath.length; i++){
   *     if(ray.hitPath[i].getType() == 'Avatar'){ send_beamer(team + ray.hitPath[i].nickname); }
   *   }
   *
   * - and the member it names is the one the shot beams out. Without this the
   * ray still hits the other player's model, but nothing in the path answers to
   * 'Avatar', nobody is ever named, and no shot can ever land.
   *
   * CTR already puts remote members in the scene, as Inline root nodes created
   * by WorldBrowserPage.onAvatarAdded, and the socket message that creates each
   * one already carries the member's username. So the missing piece is only the
   * label: this patch lets the page say "this node is that member", and then
   * gives back the two things the historical Script asks a hit path entry for.
   *
   * The label is applied at the edge, on the way out of computeRayHit, rather
   * than by changing what X_ITE stores. `getType()` means something else to
   * X_ITE - an array of type constants, not a type name - and worlds that are
   * not Outlands go through the same ray code. Only nodes the page has actually
   * registered as members are dressed up, and every other entry in the path is
   * handed back exactly as bxx_rayhit built it.
   */

  X3D.require(['x_ite/Browser/X3DBrowser'], function (Browser) {
    var b = Browser.prototype

    function registry(browser) {
      if (!browser.blaxxunAvatars_) browser.blaxxunAvatars_ = new Map()
      return browser.blaxxunAvatars_
    }

    /*
     * Names the node that stands for a member in this room.
     *
     * The name has to be the one `Browser.myAvatarName` reports on the other
     * client, because that is the only comparison the historical beamer makes:
     * the shooter sends `team + nickname`, and every client in the room asks
     * whether the name is its own.
     */
    b.registerBlaxxunAvatar = function (node, nickname) {
      if (!node) return
      registry(this).set(node, String(nickname == null ? '' : nickname))
    }

    /*
     * Called when a member leaves. The registry is a strong Map, so a room that
     * never forgot anyone would hold every avatar node it had ever seen; this
     * is what keeps the entry count equal to the number of members present.
     */
    b.unregisterBlaxxunAvatar = function (node) {
      if (!node) return
      registry(this).delete(node)
    }

    /* Handy for the two-client gate to assert against. */
    b.blaxxunAvatarCount = function () {
      return registry(this).size
    }

    /*
     * The facade a registered node wears inside a hit path. A Proxy rather than
     * a copy, so anything the path is asked for that is not part of the blaxxun
     * avatar contract still reaches the real node.
     */
    function avatarFacade(node, nickname) {
      return new Proxy(node, {
        get: function (target, prop, receiver) {
          if (prop === 'nickname') return nickname
          if (prop === 'getType') return function () { return 'Avatar' }
          var value = Reflect.get(target, prop, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }

    var originalComputeRayHit = b.computeRayHit

    b.computeRayHit = function () {
      var hit = originalComputeRayHit.apply(this, arguments)
      if (!hit || !hit.hitPath || !hit.hitPath.length) return hit
      var avatars = this.blaxxunAvatars_
      if (!avatars || !avatars.size) return hit

      var path = hit.hitPath
      var dressed = null
      for (var i = 0; i < path.length; i += 1) {
        if (!avatars.has(path[i])) continue
        if (!dressed) dressed = path.slice()
        dressed[i] = avatarFacade(path[i], avatars.get(path[i]))
      }
      if (dressed) hit.hitPath = dressed
      return hit
    }

  })

})();
