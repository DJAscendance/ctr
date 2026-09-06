'use strict';

/*
 * Deep scene access for the X_ITE 16.2.0 final gate run.
 *
 * X_ITE 16 hands the page a sealed SAI facade. Its prototype carries only the
 * two dozen X3DNode methods the specification requires, and none of them reach
 * the two places most of CTR's legacy content actually lives:
 *
 *   - inside an Inline's own scene, and
 *   - inside a PROTO instance's body.
 *
 * The Mall is the case that forces the issue. Its scene has ten root nodes, one
 * of which is an Inline and eleven of whose descendants are StoreFront PROTO
 * instances; a walk over the facade alone finds no TouchSensor, no clock hand
 * and no door, and would report a world with no controls in it as if that were
 * a finding rather than a limit of the reader.
 *
 * The facade keeps the concrete node on a symbol-keyed own property. There are
 * four such properties; the concrete node is the one whose prototype carries
 * `getInternalScene` (Inline and the other url objects) or `getBody` (every
 * PROTO instance). This module finds it by capability rather than by position,
 * because the position is a minifier artefact and would move on any rebuild,
 * while a class that stops exposing getBody has genuinely changed.
 *
 * Nothing here is used to *drive* the engine's behaviour under test - the
 * gates still move the avatar with real key presses and fire sensors through
 * their own routes. This is a reader, so that a gate can fail for the reason it
 * is about instead of because the reader could not see.
 *
 * Everything is a source string, serialised into the page by page.evaluate.
 * Installing it defines window.__ctr with the helpers the tools call.
 */

const SCENE_ACCESS_SOURCE = `(() => {
  const api = {};

  api.canvas = () => document.querySelector('#world x3d-canvas')
    || document.querySelector('#objectModel x3d-canvas')
    || document.querySelector('x3d-canvas');

  api.browser = () => {
    const el = api.canvas();
    if (!el || typeof X3D === 'undefined') return null;
    try { return X3D.getBrowser(el); } catch (e) { return null; }
  };

  api.scene = () => {
    const b = api.browser();
    return b ? b.currentScene : null;
  };

  api.typeName = (node) => {
    try { return node.getNodeTypeName(); } catch (e) { return null; }
  };

  api.defName = (node) => {
    try { return node.getNodeName() || null; } catch (e) { return null; }
  };

  /* The concrete node behind the SAI facade, found by capability. */
  api.internal = (node) => {
    if (!node || typeof node !== 'object') return null;
    for (const symbol of Object.getOwnPropertySymbols(node)) {
      const value = node[symbol];
      if (!value || typeof value !== 'object') continue;
      const proto = Object.getPrototypeOf(value);
      if (!proto) continue;
      if (typeof value.getInternalScene === 'function') return value;
      if (typeof value.getBody === 'function') return value;
    }
    return null;
  };

  /* The scene an Inline loaded, or null for anything else. */
  api.inlineScene = (node) => {
    const concrete = api.internal(node);
    if (!concrete || typeof concrete.getInternalScene !== 'function') return null;
    try { return concrete.getInternalScene() || null; } catch (e) { return null; }
  };

  /* The body scene of a PROTO instance, or null for anything else. */
  api.protoBody = (node) => {
    const concrete = api.internal(node);
    if (!concrete || typeof concrete.getBody !== 'function') return null;
    try { return concrete.getBody() || null; } catch (e) { return null; }
  };

  api.fieldNames = (node) => {
    try { return Array.from(node.getFieldDefinitions()).map(d => d.name); } catch (e) { return []; }
  };

  api.field = (node, name) => {
    try { return node.getField(name); } catch (e) { return null; }
  };

  /*
   * Child nodes reachable through a node's own fields.
   *
   * MFNode fields are iterable and carry a length. An SFNode field *is* the
   * node - the field object answers getNodeTypeName() directly - so it is
   * tested for that before anything else. Calling getValue() on it instead
   * returns an internal holder with no node interface, which is how an earlier
   * version of this walk came to report a Mall containing 654 Shapes and no
   * geometry at all, and 31 Sound nodes with no AudioClip under any of them.
   */
  api.children = (node) => {
    const found = [];
    for (const name of api.fieldNames(node)) {
      const f = api.field(node, name);
      if (!f) continue;
      try {
        if (typeof f.length === 'number' && typeof f[Symbol.iterator] === 'function') {
          for (const item of f) {
            if (item && typeof item === 'object' && api.typeName(item)) found.push(item);
          }
        } else if (api.typeName(f)) {
          found.push(f);
        }
      } catch (e) { /* a field that will not read is not a child */ }
    }
    return found;
  };

  /*
   * Depth-first walk of a scene, descending through Inline scenes and PROTO
   * bodies. Bounded by a visited set and a node budget: legacy CTR PROTOs
   * reference their own bodies, so an unguarded walk does not terminate.
   */
  api.walk = (scene, visit, budget) => {
    const seen = new Set();
    let count = 0;
    const limit = budget || 200000;
    let truncated = false;

    const walkNode = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 80) return;
      if (seen.has(node)) return;
      seen.add(node);
      if (count >= limit) { truncated = true; return; }
      count += 1;
      visit(node, depth);

      const inline = api.inlineScene(node);
      if (inline && inline.rootNodes) {
        for (const root of Array.from(inline.rootNodes)) walkNode(root, depth + 1);
      }
      const body = api.protoBody(node);
      if (body && body.rootNodes) {
        for (const root of Array.from(body.rootNodes)) walkNode(root, depth + 1);
      }
      for (const child of api.children(node)) walkNode(child, depth + 1);
    };

    try {
      for (const root of Array.from(scene.rootNodes || [])) walkNode(root, 0);
    } catch (e) { /* reported by the caller through the count */ }
    return { count, truncated };
  };

  /* Every node of a type, anywhere in the world including Inlines and PROTOs. */
  api.findByType = (typeName, scene) => {
    const found = [];
    api.walk(scene || api.scene(), (node) => {
      if (api.typeName(node) === typeName) found.push(node);
    });
    return found;
  };

  /* Every node carrying a DEF name, keyed by that name. Later wins are kept as
   * a list, because the same DEF appears once per PROTO instance. */
  api.findByDef = (defName, scene) => {
    const found = [];
    api.walk(scene || api.scene(), (node) => {
      if (api.defName(node) === defName) found.push(node);
    });
    return found;
  };

  api.census = (scene) => {
    const census = {};
    const result = api.walk(scene || api.scene(), (node) => {
      const name = api.typeName(node);
      if (name) census[name] = (census[name] || 0) + 1;
    });
    return { census, total: result.count, truncated: result.truncated };
  };

  /* --- value readers ---------------------------------------------------- */

  api.vec3 = (field) => {
    if (!field) return null;
    try {
      const v = typeof field.getValue === 'function' ? field.getValue() : field;
      if (v && typeof v.x === 'number') return [v.x, v.y, v.z];
    } catch (e) {}
    try { return [field.x, field.y, field.z]; } catch (e) { return null; }
  };

  api.rot = (field) => {
    if (!field) return null;
    try {
      const v = typeof field.getValue === 'function' ? field.getValue() : field;
      if (v && typeof v.angle === 'number') return [v.x, v.y, v.z, v.angle];
    } catch (e) {}
    try {
      if (typeof field.angle === 'number') return [field.x, field.y, field.z, field.angle];
    } catch (e) {}
    return null;
  };

  api.scalar = (field) => {
    if (!field) return null;
    try {
      const v = typeof field.getValue === 'function' ? field.getValue() : field;
      return (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') ? v : null;
    } catch (e) { return null; }
  };

  api.strings = (field) => {
    if (!field) return null;
    try { return Array.from(field).map(String); } catch (e) { return null; }
  };

  api.numbers = (field) => {
    if (!field) return null;
    try { return Array.from(field).map(Number); } catch (e) { return null; }
  };

  api.readVec3 = (node, name) => api.vec3(api.field(node, name));
  api.readRot = (node, name) => api.rot(api.field(node, name));
  api.readScalar = (node, name) => api.scalar(api.field(node, name));

  window.__ctr = api;
  return true;
})()`;

module.exports = { SCENE_ACCESS_SOURCE };
