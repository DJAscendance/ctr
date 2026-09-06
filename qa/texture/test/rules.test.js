'use strict';

/*
 * The VRML97 texture rule as pure logic.
 *
 * The runtime check next door proves the rule reaches the screen. These prove
 * the rule itself is stated correctly, without needing a GPU, so a mistake in
 * the table shows up on any machine.
 */

const assert = require('assert');
const {
  REPLACE,
  MODULATE,
  VRML_ENCODING,
  vrml97DiffuseMode,
  usesLegacyTextureColor,
  isColorTexture,
} = require('../lib/rules');

const vrml = { encoding: VRML_ENCODING, hasTexture: true, colorTexture: true };

module.exports = [
  {
    name: 'one and two component textures modulate diffuseColor',
    fn () {
      assert.strictEqual(vrml97DiffuseMode(1), MODULATE);
      assert.strictEqual(vrml97DiffuseMode(2), MODULATE);
    },
  },
  {
    name: 'three and four component textures replace diffuseColor',
    fn () {
      assert.strictEqual(vrml97DiffuseMode(3), REPLACE);
      assert.strictEqual(vrml97DiffuseMode(4), REPLACE);
    },
  },
  {
    name: 'a component count outside 1..4 is rejected rather than guessed',
    fn () {
      assert.throws(() => vrml97DiffuseMode(0), /out of range/);
      assert.throws(() => vrml97DiffuseMode(5), /out of range/);
      assert.throws(() => vrml97DiffuseMode(3.5), /out of range/);
    },
  },
  {
    name: 'a VRML97 shape with a colour texture uses the legacy rule',
    fn () {
      assert.strictEqual(usesLegacyTextureColor(vrml), true);
    },
  },
  {
    name: 'a VRML97 shape with no texture keeps diffuseColor',
    fn () {
      assert.strictEqual(
        usesLegacyTextureColor({ ...vrml, hasTexture: false, colorTexture: false }),
        false,
      );
    },
  },
  {
    name: 'a VRML97 shape with an intensity texture keeps diffuseColor',
    fn () {
      assert.strictEqual(usesLegacyTextureColor({ ...vrml, colorTexture: false }), false);
    },
  },
  {
    name: 'modern encodings never take the legacy rule',
    fn () {
      ['XML', 'JSON', 'GLTF', 'OBJ', 'STL', 'X3D', ''].forEach((encoding) => {
        assert.strictEqual(
          usesLegacyTextureColor({ ...vrml, encoding }),
          false,
          `${encoding || '(empty)'} must keep native X_ITE semantics`,
        );
      });
    },
  },
  {
    name: 'grey pixels read as an intensity texture',
    fn () {
      const grey = [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255];
      assert.strictEqual(isColorTexture(grey), false);
    },
  },
  {
    name: 'a single off-grey pixel is enough to read as colour',
    fn () {
      const almostGrey = [128, 128, 128, 255, 128, 129, 128, 255];
      assert.strictEqual(isColorTexture(almostGrey), true);
    },
  },
  {
    name: 'alpha alone does not make a texture a colour texture',
    fn () {
      const greyWithAlpha = [64, 64, 64, 0, 200, 200, 200, 128];
      assert.strictEqual(isColorTexture(greyWithAlpha), false);
    },
  },
  {
    name: 'an empty texture is not a colour texture',
    fn () {
      assert.strictEqual(isColorTexture([]), false);
    },
  },
];
