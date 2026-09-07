'use strict';

/*
 * blaxxun shared-event list compatibility.
 *
 * A historical world may declare its zone's event list as an explicit NULL:
 *
 *   exposedField MFNode events NULL
 *
 * shopping.wrl (the Mall) does exactly that on line 138. blaxxun Contact read
 * that as an empty list. X_ITE 16 reads it as a one-item MFNode holding a null
 * entry, so `events.length` is 1 and `events[0]` has no node interface at all.
 *
 * Callers walk the list to register field callbacks, so the null entry throws
 * and takes the whole place startup down with it. This filter keeps every real
 * node and drops entries that cannot answer the node API, so a NULL-declared
 * list behaves like the empty list Contact gave.
 *
 * It does not invent a replacement node for the null entry: a world that
 * declares no events genuinely has none.
 */
function sharedEventNodes(events) {
  if (!events) {
    return [];
  }
  return Array.from(events).filter(isSharedEventNode);
}

function isSharedEventNode(eventNode) {
  return !!eventNode && typeof eventNode.addFieldCallback === 'function';
}

module.exports = {
  sharedEventNodes: sharedEventNodes,
  isSharedEventNode: isSharedEventNode,
};
