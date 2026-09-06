'use strict';

/*
 * The in-page survey used by the X_ITE 16.2.0 final gate run.
 *
 * The memory run's probe (qa/memory/lib/probe.js) watches counters that must
 * not grow. This one answers a different question: what did the engine
 * actually build out of a world file? It reads the live scene graph and
 * reports a node-type census, the sensors and bindables the compatibility
 * gates turn on, the PROTO and EXTERNPROTO load states, and the canvas size.
 *
 * Like that probe it is serialised into the page by page.evaluate, so it may
 * not close over anything from Node, and every read is defensive: an
 * unrecognised shape is reported as null so the run records the field as
 * unavailable instead of inventing a number.
 */

/*
 * Node traversal has to be bounded. Legacy CTR worlds contain PROTO instances
 * whose bodies point back at their own scene, so an unguarded walk does not
 * terminate; the visited set is what makes the census finite rather than an
 * optimisation.
 */
const SURVEY_SOURCE = `(() => {
  const out = {
    ok: true,
    error: null,
    engine: null,
    rootNodes: null,
    worldURL: null,
    canvasCount: document.querySelectorAll('x3d-canvas').length,
    worldCanvasCount: document.querySelectorAll('#world x3d-canvas').length,
    canvas: null,
    census: null,
    censusTotal: null,
    censusTruncated: false,
    proximitySensors: null,
    navigationInfo: null,
    viewpoint: null,
    protos: null,
    externprotos: null,
    namedNodes: null,
  };

  const canvasEl = document.querySelector('#world x3d-canvas')
    || document.querySelector('#objectModel x3d-canvas')
    || document.querySelector('x3d-canvas');
  if (!canvasEl) { out.ok = false; out.error = 'no x3d-canvas'; return out; }

  /* X_ITE 16 builds <x3d-canvas> as a custom element and puts the real <canvas>
   * inside its shadow root, so a light-DOM query finds nothing and a run that
   * only looked there would report the size as unavailable rather than reading
   * the 300x150 default the sizing rule in index.scss exists to prevent. */
  const inner = (canvasEl.shadowRoot && canvasEl.shadowRoot.querySelector('canvas'))
    || canvasEl.querySelector('canvas');
  out.canvas = {
    hostWidth: canvasEl.clientWidth,
    hostHeight: canvasEl.clientHeight,
    drawWidth: inner ? inner.width : null,
    drawHeight: inner ? inner.height : null,
    cssWidth: inner ? inner.clientWidth : null,
    cssHeight: inner ? inner.clientHeight : null,
    fromShadowRoot: !!(canvasEl.shadowRoot && canvasEl.shadowRoot.querySelector('canvas')),
  };

  if (typeof X3D === 'undefined') { out.ok = false; out.error = 'no X3D global'; return out; }

  let browser = null;
  try { browser = X3D.getBrowser(canvasEl); } catch (e) { out.error = String(e); }
  if (!browser) { out.ok = false; out.error = out.error || 'no browser'; return out; }

  try { out.engine = browser.getVersion ? String(browser.getVersion()) : null; } catch (e) {}

  const scene = browser.currentScene;
  if (!scene) { out.ok = false; out.error = 'no currentScene'; return out; }

  try { out.rootNodes = scene.rootNodes ? scene.rootNodes.length : null; } catch (e) {}
  try { out.worldURL = String(scene.worldURL); } catch (e) {}

  /* --- node-type census ------------------------------------------------- */

  const census = {};
  const proximity = [];
  const named = [];
  const visited = new Set();
  let total = 0;
  const LIMIT = 60000;

  function typeNameOf(node) {
    try {
      if (typeof node.getNodeTypeName === 'function') return node.getNodeTypeName();
    } catch (e) {}
    try {
      if (node.constructor && node.constructor.typeName) return node.constructor.typeName;
    } catch (e) {}
    return null;
  }

  function vecOf(value) {
    if (!value) return null;
    const raw = value._value !== undefined ? value._value : value;
    if (raw && typeof raw.x === 'number') return [raw.x, raw.y, raw.z];
    if (raw && typeof raw.length === 'number' && raw.length >= 3) {
      return [raw[0], raw[1], raw[2]];
    }
    try {
      if (typeof value.getValue === 'function') {
        const g = value.getValue();
        if (g && typeof g.x === 'number') return [g.x, g.y, g.z];
      }
    } catch (e) {}
    return null;
  }

  function rotOf(value) {
    if (!value) return null;
    try {
      const v = value._value !== undefined ? value._value : value;
      if (v && typeof v.x === 'number' && typeof v.angle === 'number') {
        return [v.x, v.y, v.z, v.angle];
      }
    } catch (e) {}
    return null;
  }

  function scalarOf(field) {
    try {
      if (!field) return null;
      const v = field._value !== undefined ? field._value : field.valueOf();
      return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
        ? v : null;
    } catch (e) { return null; }
  }

  function record(node) {
    const name = typeNameOf(node);
    if (!name) return;
    census[name] = (census[name] || 0) + 1;
    if (name === 'ProximitySensor') {
      proximity.push({
        index: proximity.length,
        enabled: scalarOf(node.getField ? safeField(node, 'enabled') : null),
        size: vecOf(safeField(node, 'size')),
        center: vecOf(safeField(node, 'center')),
        position: vecOf(safeField(node, 'position_changed')),
        orientation: rotOf(safeField(node, 'orientation_changed')),
        isActive: scalarOf(safeField(node, 'isActive')),
      });
    }
  }

  function safeField(node, name) {
    try { return node.getField(name); } catch (e) { return null; }
  }

  function walk(node, depth) {
    if (!node || depth > 64) return;
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);
    if (total >= LIMIT) { out.censusTruncated = true; return; }
    total += 1;
    record(node);

    let fields = [];
    try {
      fields = typeof node.getFieldDefinitions === 'function'
        ? node.getFieldDefinitions().map(d => d.name)
        : (typeof node.getFields === 'function' ? node.getFields().map(f => f.getName()) : []);
    } catch (e) { fields = []; }

    for (const fname of fields) {
      const field = safeField(node, fname);
      if (!field) continue;
      let value = null;
      try { value = field._value !== undefined ? field._value : null; } catch (e) { continue; }
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeNameOf(item)) walk(item, depth + 1);
        }
      } else if (typeof value === 'object' && typeNameOf(value)) {
        walk(value, depth + 1);
      }
    }
  }

  try {
    const roots = scene.rootNodes || [];
    for (const root of roots) walk(root, 0);
  } catch (e) { out.error = out.error || String(e); }

  out.census = census;
  out.censusTotal = total;
  out.proximitySensors = proximity;

  /* --- bindables -------------------------------------------------------- */

  try {
    const nav = browser.activeNavigationInfo || null;
    if (nav) {
      out.navigationInfo = {
        type: (function () {
          const f = safeField(nav, 'type');
          try { return f && f._value ? Array.from(f._value).map(String) : null; } catch (e) { return null; }
        })(),
        avatarSize: (function () {
          const f = safeField(nav, 'avatarSize');
          try { return f && f._value ? Array.from(f._value).map(Number) : null; } catch (e) { return null; }
        })(),
        speed: scalarOf(safeField(nav, 'speed')),
        visibilityLimit: scalarOf(safeField(nav, 'visibilityLimit')),
        headlight: scalarOf(safeField(nav, 'headlight')),
      };
    }
  } catch (e) {}

  try {
    const vp = browser.getActiveViewpoint ? browser.getActiveViewpoint() : null;
    if (vp) {
      out.viewpoint = {
        typeName: typeNameOf(vp),
        description: scalarOf(safeField(vp, 'description')),
        position: vecOf(safeField(vp, 'position')),
        orientation: rotOf(safeField(vp, 'orientation')),
      };
    }
  } catch (e) {}

  /* --- PROTO / EXTERNPROTO --------------------------------------------- */

  function declList(container) {
    if (!container) return null;
    const items = [];
    try {
      const iterable = typeof container.values === 'function' ? container.values() : container;
      for (const decl of iterable) {
        if (!decl) continue;
        const entry = { name: null, url: null, loadState: null };
        try { entry.name = decl.getName ? decl.getName() : (decl.name || null); } catch (e) {}
        try {
          const u = decl.getField ? decl.getField('url') : null;
          if (u && u._value) entry.url = Array.from(u._value).map(String);
        } catch (e) {}
        try {
          entry.loadState = decl.getLoadState ? decl.getLoadState() : null;
        } catch (e) {}
        items.push(entry);
      }
    } catch (e) { return null; }
    return items;
  }

  try { out.protos = declList(scene.protos); } catch (e) {}
  try { out.externprotos = declList(scene.externprotos); } catch (e) {}

  try {
    const nn = scene.getNamedNodes ? scene.getNamedNodes() : null;
    if (nn) {
      const names = [];
      const it = typeof nn.keys === 'function' ? nn.keys() : Object.keys(nn);
      for (const k of it) names.push(String(k));
      out.namedNodes = names;
    }
  } catch (e) {}

  return out;
})()`;

module.exports = { SURVEY_SOURCE };
