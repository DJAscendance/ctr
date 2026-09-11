'use strict';

/**
 * CTR Object Placement Invariance Contract.
 *
 * Describes how CTR persists and renders object placement, and defines the
 * tolerances used when comparing an X_ITE 15.1.12 baseline against a later
 * candidate capture. See ../README.md for the full data-flow write-up.
 */

/** Engine version this contract was measured against. */
const CONTROL_ENGINE_VERSION = '15.1.12';

/** Commit the control baseline was captured from. */
const CONTROL_COMMIT = 'ee238a61867554916aa9336655469b7395b09c6d';

/**
 * Persisted placement columns.
 *
 * Both tables store placement as JSON in a MySQL TEXT column. There is no
 * scale column and the SharedObject PROTO exposes no scale field, so scale is
 * structurally fixed at 1 1 1 and is recorded as such rather than measured.
 */
const STORED_FIELDS = {
  object_instance: {
    table: 'object_instance',
    identity: 'id',
    place: 'place_id',
    owner: 'member_id',
    position: { column: 'position', type: 'text', json: ['x', 'y', 'z'] },
    rotation: { column: 'rotation', type: 'text', json: ['x', 'y', 'z', 'angle'] },
    scale: null,
  },
  mall_object: {
    table: 'mall_object',
    identity: 'id',
    place: 'place_id',
    owner: null,
    position: { column: 'position', type: 'text', json: ['x', 'y', 'z'] },
    rotation: { column: 'rotation', type: 'text', json: ['x', 'y', 'z', 'angle'] },
    scale: null,
  },
};

/**
 * Comparison tolerances.
 *
 * Stored values are compared exactly: the upgrade must not rewrite user data.
 * Rendered values come out of the live X_ITE scene graph and are allowed a
 * small float-32 round-trip margin only.
 */
const TOLERANCES = {
  storedPosition: 0,
  storedRotation: 0,
  renderedPosition: 0.0001,
  renderedRotationAxis: 0.0001,
  renderedRotationAngle: 0.0001,
  renderedScale: 0.0001,
};

/** Default scale for every CTR object; CTR never persists or renders another. */
const IMPLIED_SCALE = { x: 1, y: 1, z: 1 };

/** Parses a stored placement TEXT column exactly as WorldBrowserPage does. */
function parseStoredPosition(raw) {
  if (raw === null || raw === undefined) {
    return { x: 0, y: 0, z: 0 };
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** Parses a stored rotation TEXT column exactly as WorldBrowserPage does. */
function parseStoredRotation(raw) {
  if (raw === null || raw === undefined) {
    return { x: 0, y: 0, z: 0, angle: 0 };
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

module.exports = {
  CONTROL_ENGINE_VERSION,
  CONTROL_COMMIT,
  STORED_FIELDS,
  TOLERANCES,
  IMPLIED_SCALE,
  parseStoredPosition,
  parseStoredRotation,
};
