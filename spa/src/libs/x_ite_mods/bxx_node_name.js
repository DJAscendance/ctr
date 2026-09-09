'use strict';

/*
 * blaxxun Contact's SFNode.getName().
 *
 * Contact documented getName() as an extension on the *node* view:
 *
 *   "string getName() - Returns nodes DEF name if available."
 *   (csadmin/doc/3dauthoring/3dscripting7.html, "Extensions to vrmlscript
 *    SFNode object")
 *
 * X_ITE has no such extension. SFNode inherits getName() from X3DObject, where
 * it answers the *field's* own name. A field a Script declares - `field SFNode
 * shared` - is named, so it answers "shared". But an SFNode handed back by
 * dereferencing something else is anonymous, so it answers "".
 *
 * That is the whole of the Outlands turret failure. ne_game.wrl's turret
 * Script finds its shared events by DEF name:
 *
 *   lockName = new SFString('turret_lock_' + id);
 *   for (i = 0; i < shared.events.length; i++)
 *     if (shared.events[i].getName() == lockName) { lock = shared.events[i]; }
 *
 * `shared.events[i]` reaches the sandbox through MFNode's proxy, which returns
 * `array[i].valueOf()`, which is an anonymous SFNode out of X_ITE's SFNodeCache.
 * Its getName() is "" for all 24 events, the loop matches nothing, `lock` keeps
 * its declared `Group {}` default, and the first route the Script builds -
 * lock_turret -> lock.set_string - fails, because a Group has no set_string.
 * Measured on X_ITE 16.2.0: getName() "" x24, getNodeName() the correct DEF
 * name, set_string present on every SharedEvent.
 *
 * The lookup keys on the DEF name (turret_lock_0), not on the SharedEvent's
 * `name` field (turretlock_0). Those differ in ne_game.wrl and only the DEF
 * name is what getName() ever returned.
 *
 * The fix is deliberately name-aware rather than a blanket override. Replacing
 * getName() outright breaks X_ITE: it binds a Script's sandbox variables under
 * each field's getName(), so a named `field SFNode shared` would bind under the
 * DEF name of the node it holds and vanish from its own Script. Answering the
 * DEF name *only when the field has no name of its own* leaves every named
 * field exactly as it was, and changes only the anonymous wrappers - which is
 * precisely the case Contact's extension described.
 */

(function () {
    var SFNode = X3D && X3D.SFNode

    if (!SFNode || !SFNode.prototype) { return }
    if (SFNode.prototype.ctrBlaxxunNodeName_) { return }

    var inherited = SFNode.prototype.getName

    if (typeof inherited !== 'function') { return }

    Object.defineProperty(SFNode.prototype, 'getName', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: function () {
            var own = inherited.call(this)

            /* A field that has its own name keeps it. Only the anonymous
             * wrappers - MFNode elements, SFNode field values, anything out of
             * SFNodeCache - fall through to the node's DEF name. */
            if (own) { return own }

            /* getNodeName() throws rather than returning "" for a NULL node,
             * so an empty answer stays the answer in that case. */
            try { return this.getNodeName() || own } catch (err) { return own }
        },
    })

    Object.defineProperty(SFNode.prototype, 'ctrBlaxxunNodeName_', {
        configurable: true,
        enumerable: false,
        value: true,
    })
})();
