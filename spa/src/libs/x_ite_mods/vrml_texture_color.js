// X_ITE publishes its runtime as the browser global X3D; it is loaded from the
// CDN in spa/public/index.html, not imported, so declare it for the linter.
/* global X3D */

(function () {

  /*
   * Restores the VRML97 colour-texture lighting rule.
   *
   * VRML97 (ISO/IEC 14772-1, 4.14 "Lighting model", table 4.5) says a texture
   * with three or four colour components REPLACES the material diffuse colour;
   * only a one or two component (intensity) texture MODULATES it. X3D dropped
   * that distinction: every texture multiplies diffuseColor. X_ITE renders our
   * .wrl worlds with the X3D rule, so `wood.jpg` under `diffuseColor 1 0 0`
   * comes out flat red instead of red-lit wood.
   *
   * That is not a corner case here. Scanning spa/assets finds 4329 textured
   * Appearance blocks: 1996 name a non-white diffuseColor, another 2226 leave
   * the field out and so inherit the VRML default 0.8 0.8 0.8, which darkens
   * every one of them by a fifth. Only 107 are explicitly white.
   *
   * This patch is deliberately narrow:
   *
   *   - it only fires for nodes whose execution context reports the VRML
   *     encoding, so .x3d / .glb / .gltf / .obj content keeps native X_ITE
   *     semantics even when it sits beside a legacy world;
   *   - it only fires for the VRML97 `Material` node, never PhysicalMaterial,
   *     UnlitMaterial or TwoSidedMaterial;
   *   - it only fires when the bound texture actually carries colour, so an
   *     intensity map still modulates as VRML97 requires;
   *   - it overwrites one uniform, x3d_DiffuseColor, after X_ITE has set all
   *     of them. Ambient, specular, emissive, shininess and transparency are
   *     left to the engine.
   *
   * It replaces spec_color.js, which did the same job on X_ITE 4 and 15 by
   * reimplementing Material.setShaderUniforms. That file was measured to be a
   * complete no-op on 16.2.0: it detected colour textures by overriding
   * X3DTexture2DNode.prototype.setTexture(width, height, transparent, data,
   * flipY), and 16.2.0 renamed that method's pixel-upload role to
   * setTextureData() while giving setTexture(texture) a different meaning, so
   * its `knownRgb` flag was never set and its white-diffuse branch never ran.
   */

  X3D.require([
    "x_ite/Components/Shape/Material",
    "x_ite/Components/Texturing/X3DSingleTextureNode",
    "x_ite/Components/Texturing/X3DTexture2DNode",
    "x_ite/Components/Shaders/ComposedShader",
  ], function (Material, X3DSingleTextureNode, X3DTexture2DNode, ComposedShader) {

    /* The diffuse colour a VRML97 colour texture is allowed to stand in for. */
    const WHITE = new Float32Array([1, 1, 1]);

    /*
     * Cap on how many pixels one scan looks at. Every texture we ship is at
     * most 256x256, so in practice this is a full scan; the stride only kicks
     * in for oversized images and for MovieTexture, which re-uploads a frame
     * at a time and would otherwise pay the scan on every frame.
     */
    const MAX_SAMPLES = 65536;

    /*
     * Decide whether decoded RGBA pixels carry colour.
     *
     * X_ITE decodes everything to four channels, so the VRML97 component count
     * is gone by this point. A texture whose R, G and B agree on every sampled
     * pixel is an intensity map and keeps the modulate rule; anything else is
     * treated as a colour texture and takes the replace rule.
     */
    function scanForColor (data) {
      const pixels = Math.floor(data.length / 4);
      const stride = Math.max(1, Math.floor(pixels / MAX_SAMPLES));

      for (let pixel = 0; pixel < pixels; pixel += stride) {
        const i = pixel * 4;
        if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) return true;
      }

      return false;
    }

    /*
     * Record the result on the texture node. `data` may be an HTMLImageElement
     * or a video rather than pixels, in which case there is nothing to scan
     * here - isImageTransparent() below sees the read-back pixels instead.
     *
     * The one-pixel upload from clearTexture() is ignored so the placeholder
     * cannot mask the real image.
     */
    function recordTextureColor (node, data) {
      if (!data || typeof data.length !== "number") return;
      if (data.length <= 4) return;

      node.vrmlColorTexture = scanForColor(data);
    }

    /*
     * Hook 1: the pixel upload. Covers PixelTexture and MovieTexture, which
     * hand setTextureData a typed array directly.
     */
    const originalSetTextureData = X3DTexture2DNode.prototype.setTextureData;
    X3DTexture2DNode.prototype.setTextureData =
      function (width, height, colorSpaceConversion, transparent, data) {
        const result = originalSetTextureData.apply(this, arguments);

        try {
          recordTextureColor(this, data);
        } catch (error) {
          /* A texture we cannot classify keeps the engine default. */
        }

        return result;
      };

    /*
     * Hook 2: the transparency test. ImageTexture uploads an <img>, then reads
     * the texture back and passes the RGBA bytes here, so this is where a
     * jpg / gif / png gets classified - for free, with no extra read-back.
     */
    const originalIsImageTransparent = X3DSingleTextureNode.prototype.isImageTransparent;
    X3DSingleTextureNode.prototype.isImageTransparent = function (data) {
      try {
        recordTextureColor(this, data);
      } catch (error) {
        /* As above. */
      }

      return originalIsImageTransparent.apply(this, arguments);
    };

    /** True when the node was parsed from VRML97 (classic .wrl encoding). */
    function isVRML (node) {
      try {
        const context = node.getExecutionContext();
        return !!context && context.encoding === "VRML";
      } catch (error) {
        return false;
      }
    }

    /*
     * Hook 3: the per-shape uniform pass. This is the only place that sees the
     * Appearance and its Material together, so it is where the rule is decided.
     * The answer is left on the Material for the next hook to consume, because
     * Material.setShaderUniforms is not given the Appearance.
     *
     * The hook goes on ComposedShader, not on X3DProgrammableShaderObject:
     * X_ITE builds every built-in material shader as a ComposedShader, and
     * ComposedShader.prototype is assembled by copying the shader-object
     * methods in rather than inheriting them, so a patch on the base class
     * would never be reached.
     */
    function markMaterial (renderContext, front) {
      const appearanceNode = renderContext && renderContext.appearanceNode;
      if (!appearanceNode) return;

      const materialNode = front === false
        ? appearanceNode.getBackMaterial()
        : appearanceNode.getMaterial();

      if (!materialNode) return;

      /* Mirror how X_ITE itself resolves the texture for this shape. */
      const textureNode = renderContext.textureNode || appearanceNode.getTexture();

      materialNode.vrmlColorTextureLighting =
        !!textureNode && textureNode.vrmlColorTexture === true && isVRML(materialNode);
    }

    const originalSetUniforms = ComposedShader.prototype.setUniforms;
    ComposedShader.prototype.setUniforms = function (gl, renderContext, geometryContext, front) {
      try {
        markMaterial(renderContext, front);
      } catch (error) {
        /* Fall through to the engine default for this shape. */
      }

      return originalSetUniforms.apply(this, arguments);
    };

    /*
     * Hook 4: the substitution. X_ITE has already written every material
     * uniform; we replace the diffuse colour with white so the fragment
     * shader's `diffuseColor * textureColor` product yields the texture colour
     * on its own, which is the VRML97 replace rule.
     *
     * The flag is cleared straight after use, so a Material reached by some
     * other path can never inherit a stale decision from the previous shape.
     */
    const originalMaterialUniforms = Material.prototype.setShaderUniforms;
    Material.prototype.setShaderUniforms = function (gl, shaderObject) {
      const result = originalMaterialUniforms.apply(this, arguments);

      if (this.vrmlColorTextureLighting) {
        this.vrmlColorTextureLighting = false;
        gl.uniform3fv(shaderObject.x3d_DiffuseColor, WHITE);
      }

      return result;
    };

  });
})();
