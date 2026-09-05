(function () {

    X3D.require(["x_ite/Components/Shape/Appearance", "x_ite/Components/Shape/Material", "x_ite/Components/Texturing/X3DTexture2DNode"], function (Appearance, Material, X3DTexture2DNode) {

        let originalTraverse = Appearance.prototype.traverse;
        Appearance.prototype.traverse = function (type, renderObject) {
            if (this.materialNode) {
                this.materialNode.white = !!(this.textureNode && this.textureNode.knownRgb);
            }
            return originalTraverse.call(this, type, renderObject);
        }

        // Scratch buffers. setShaderUniforms runs once per shape per frame, so
        // we reuse these instead of allocating a Float32Array every call.
        const DIFFUSE = new Float32Array(3);
        const SPECULAR = new Float32Array(3);
        const EMISSIVE = new Float32Array(3);

        // Used only when a colour cannot be read at all. Black is the safe
        // neutral: it is a valid sequence, so WebGL never throws.
        const BLACK = new Float32Array(3);

        // Diffuse forced to white by the Appearance.traverse patch above, so a
        // colour-bearing texture supplies the hue (Blaxxun look-alike).
        const WHITE = new Float32Array([1, 1, 1]);

        /**
         * Copy an X_ITE colour value into a plain Float32Array of 3 floats.
         *
         * Why this exists: X_ITE 15 changed how a Material exposes its colours
         * at render time. `this.diffuseColor` is now `undefined` on the
         * internal render node, and passing that straight to `uniform3fv`
         * throws "The provided value cannot be converted to a sequence" on
         * every frame. X_ITE 15 instead keeps a prepared `diffuseColorArray`
         * plus the raw SFColor field at `_diffuseColor`.
         *
         * We try each known representation, cheapest first:
         *   1. already array-like (X_ITE 15 `*ColorArray`, or a plain array)
         *   2. `getValue()` returning an array-like (X_ITE field accessor)
         *   3. the `.r` / `.g` / `.b` component accessors on SFColor
         *
         * @param {*} color          value read off the Material node
         * @param {Float32Array} out scratch buffer of length 3 to fill
         * @returns {Float32Array}   `out`, or BLACK if nothing converted
         */
        function toColor3 (color, out) {
            if (color === null || color === undefined) {
                return BLACK;
            }

            // 1. Already a sequence of numbers.
            if (typeof color.length === "number" && color.length >= 3) {
                return copy3(color, out);
            }

            // 2. Field accessor. In X_ITE a field's getValue() returns the
            //    underlying storage, which is normally array-like.
            if (typeof color.getValue === "function") {
                const value = color.getValue();

                if (value && typeof value.length === "number" && value.length >= 3) {
                    return copy3(value, out);
                }

                // getValue() may also hand back an SFColor; use it below.
                if (value && typeof value.r === "number") {
                    color = value;
                }
            }

            // 3. SFColor component accessors.
            if (typeof color.r === "number") {
                out[0] = color.r;
                out[1] = color.g;
                out[2] = color.b;
                return guard(out);
            }

            // Nothing matched: do not hand WebGL a value it will reject.
            return BLACK;
        }

        /** Copy the first three entries of an array-like into `out`. */
        function copy3 (source, out) {
            out[0] = +source[0];
            out[1] = +source[1];
            out[2] = +source[2];
            return guard(out);
        }

        /**
         * Final safety net: a Float32Array can hold NaN, and NaN colours
         * produce undefined shading rather than an exception. Fall back to
         * black so a bad material cannot corrupt the frame.
         */
        function guard (out) {
            return isFinite(out[0] + out[1] + out[2]) ? out : BLACK;
        }

        /**
         * Read a scalar field (SFFloat or plain number) as a JS number.
         * Returns `fallback` when the value is missing or not finite.
         */
        function toFloat (value, fallback) {
            if (value !== null && value !== undefined && typeof value.getValue === "function") {
                value = value.getValue();
            }

            const number = typeof value === "number" ? value : Number(value);
            return isFinite(number) ? number : fallback;
        }

        /**
         * Resolve one Material colour, preferring the X_ITE 15 prepared array
         * (`<name>ColorArray`), then the raw field (`_<name>Color`), then the
         * scripting-API property (`<name>Color`) used by X_ITE 4.
         */
        function materialColor (material, name, out) {
            const prepared = material[name + "ColorArray"];
            if (prepared !== null && prepared !== undefined) {
                const value = toColor3(prepared, out);
                if (value !== BLACK) return value;
            }

            const field = material["_" + name + "Color"];
            if (field !== null && field !== undefined) {
                const value = toColor3(field, out);
                if (value !== BLACK) return value;
            }

            return toColor3(material[name + "Color"], out);
        }

        Material.prototype.setShaderUniforms = function (gl, shaderObject) {
            // `white` is set by the Appearance.traverse patch above.
            const diffuse = this.white ? WHITE : materialColor(this, "diffuse", DIFFUSE);

            gl.uniform1i(shaderObject.x3d_SeparateBackColor, false);
            gl.uniform1f(shaderObject.x3d_AmbientIntensity, toFloat(this.ambientIntensity, 0));
            gl.uniform3fv(shaderObject.x3d_DiffuseColor, diffuse);
            gl.uniform3fv(shaderObject.x3d_SpecularColor, materialColor(this, "specular", SPECULAR));
            gl.uniform3fv(shaderObject.x3d_EmissiveColor, materialColor(this, "emissive", EMISSIVE));
            gl.uniform1f(shaderObject.x3d_Shininess, toFloat(this.shininess, 0));
            gl.uniform1f(shaderObject.x3d_Transparency, toFloat(this.transparency, 0));
        }

        let originalSetTexture = X3DTexture2DNode.prototype.setTexture;
        X3DTexture2DNode.prototype.setTexture = function (width, height, transparent, data, flipY) {
            this.knownRgb = false;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) {
                    this.knownRgb = true;
                    break;
                }
            }

            return originalSetTexture.call(this, width, height, transparent, data, flipY);
        };
    });
})();
