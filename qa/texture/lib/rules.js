'use strict';

/*
 * The VRML97 colour-texture lighting rule, as a table.
 *
 * ISO/IEC 14772-1 (VRML97) 4.14 "Lighting model", table 4.5 makes the material
 * diffuse colour depend on how many components the texture has:
 *
 *   1 component  (intensity)        diffuse x texture intensity   MODULATE
 *   2 components (intensity+alpha)  diffuse x texture intensity   MODULATE
 *   3 components (RGB)              texture colour                REPLACE
 *   4 components (RGBA)             texture colour                REPLACE
 *
 * X3D removed the split: every texture modulates. X_ITE implements the X3D
 * rule, so legacy .wrl content needs the table above put back. That is what
 * spa/src/libs/x_ite_mods/vrml_texture_color.js does at runtime.
 *
 * Nothing here talks to a browser. It is the shared statement of the rule, so
 * the pure-logic tests and the runtime check cannot drift apart.
 */

const REPLACE = 'replace';
const MODULATE = 'modulate';

/** VRML97 encoding name as X_ITE reports it on an execution context. */
const VRML_ENCODING = 'VRML';

/**
 * How a texture of `components` channels combines with diffuseColor.
 *
 * @param {number} components 1..4
 * @returns {string} REPLACE or MODULATE
 */
function vrml97DiffuseMode (components) {
  if (!Number.isInteger(components) || components < 1 || components > 4) {
    throw new Error(`texture component count out of range: ${components}`);
  }

  return components >= 3 ? REPLACE : MODULATE;
}

/**
 * Whether the compatibility rule applies to one shape.
 *
 * All three conditions are required, and each one is a guard we depend on:
 * the encoding keeps modern content on modern semantics, the presence of a
 * texture keeps plain materials alone, and the colour test keeps intensity
 * maps modulating.
 *
 * @param {object} shape
 * @param {string} shape.encoding    execution-context encoding of the Material
 * @param {boolean} shape.hasTexture a texture is bound to the Appearance
 * @param {boolean} shape.colorTexture the texture carries colour, not intensity
 * @returns {boolean}
 */
function usesLegacyTextureColor (shape) {
  return shape.encoding === VRML_ENCODING &&
    !!shape.hasTexture &&
    !!shape.colorTexture;
}

/**
 * Classify decoded RGBA bytes as a colour or an intensity texture.
 *
 * X_ITE decodes every texture to four channels, so the VRML97 component count
 * is gone by the time pixels reach the GPU. A texture whose R, G and B agree
 * everywhere is an intensity map; anything else carries colour. This mirrors
 * the scan in vrml_texture_color.js.
 *
 * @param {ArrayLike<number>} rgba
 * @returns {boolean} true when the texture carries colour
 */
function isColorTexture (rgba) {
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    if (rgba[i] !== rgba[i + 1] || rgba[i + 1] !== rgba[i + 2]) return true;
  }

  return false;
}

module.exports = {
  REPLACE,
  MODULATE,
  VRML_ENCODING,
  vrml97DiffuseMode,
  usesLegacyTextureColor,
  isColorTexture,
};
