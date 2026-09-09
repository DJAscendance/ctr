// X_ITE publishes its runtime as the browser global X3D; it is loaded from the
// CDN in spa/public/index.html, not imported, so declare it for the linter.
/* global X3D */

(function () {

    /*
     * Browser.computeRayHit(start, end) - the blaxxun Contact ray cast.
     *
     * Two pieces of restored Cybertown content call this and nothing else can
     * stand in for it:
     *
     *   - the VWP 5.1 object-move HUD, whose collision checkbox casts a ray
     *     along each movement step and refuses the step when the ray hits
     *     anything, and
     *   - the Outlands Turret Script, which casts a ray straight down through
     *     the world to find the `battle` Script and the `SharedZone` node
     *     without knowing where in the file they sit.
     *
     * X_ITE 16.2.0 has no equivalent. The shipped build carries no picking
     * component, exposes no ray API on the browser, and the geometry-level
     * `intersectsLine` methods belong to the drag-sensor maths helpers rather
     * than to geometry nodes. So this is a compatibility layer, not a mapping.
     *
     * It works in two phases, which is also how the historical HUD behaved: a
     * cheap axis-aligned bounding-box pass over every Shape in the scene, then
     * a triangle pass over only the shapes whose box the segment entered. The
     * broad phase is what keeps a 1956-node world affordable; the narrow phase
     * is what stops a large wall mesh blocking movement across the whole room
     * its bounding box happens to span.
     *
     * Blaxxun returned null for a miss and a hit record otherwise. Callers use
     * two things from that record: its truthiness, and `hitPath`, an array of
     * the nodes from the scene root down to the shape that was hit. Both are
     * reproduced here.
     */

    /* The concrete node behind X_ITE 16's sealed SAI facade.
     *
     * The facade prototype carries only the two dozen methods X3DNode is
     * required to have, and none of them reach a bounding box, a geometry or a
     * PROTO body. The concrete node sits on one of four symbol-keyed own
     * properties. Which one is a minifier artefact and would move on any
     * rebuild, so it is found by capability instead of by position. */
    function internalNode(node) {
        if (!node || typeof node !== 'object') { return null }
        var symbols = Object.getOwnPropertySymbols(node)
        for (var i = 0; i < symbols.length; i += 1) {
            var value = node[symbols[i]]
            if (!value || typeof value !== 'object') { continue }
            if (typeof value.getBBoxSize === 'function') { return value }
            if (typeof value.getInternalScene === 'function') { return value }
            if (typeof value.getBody === 'function') { return value }
        }
        return null
    }

    function fieldValue(node, name) {
        try {
            var field = node.getField(name)
            if (!field) { return null }
            return typeof field.getValue === 'function' ? field.getValue() : field
        } catch (err) {
            return null
        }
    }

    /*
     * A node's type name, whichever of X_ITE's two node forms it arrives in.
     *
     * Nodes walked out of `children` arrive as the SAI facade and answer
     * getNodeTypeName(); a node read out of a field - a Shape's `geometry`
     * above all - arrives as the concrete node behind the facade and answers
     * getTypeName() instead. Both must be asked, in that order, or no geometry
     * is ever recognised and the whole pass degrades to bounding boxes.
     */
    function typeName(node) {
        try { return node.getNodeTypeName() } catch (err) { /* concrete node */ }
        try { return node.getTypeName() } catch (err) { /* not a node */ }
        return ''
    }

    /* ---- 4x4 matrices, row-major, applied as row-vector * matrix ---- */

    function identity() {
        return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    }

    function multiply(a, b) {
        var out = new Array(16)
        for (var r = 0; r < 4; r += 1) {
            for (var c = 0; c < 4; c += 1) {
                out[r * 4 + c] = a[r * 4] * b[c]
                    + a[r * 4 + 1] * b[4 + c]
                    + a[r * 4 + 2] * b[8 + c]
                    + a[r * 4 + 3] * b[12 + c]
            }
        }
        return out
    }

    function transformPoint(m, p) {
        return [
            p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
            p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
            p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14],
        ]
    }

    function translationMatrix(t) {
        var m = identity()
        m[12] = t[0]; m[13] = t[1]; m[14] = t[2]
        return m
    }

    function scaleMatrix(s) {
        var m = identity()
        m[0] = s[0]; m[5] = s[1]; m[10] = s[2]
        return m
    }

    /* Axis-angle to matrix. A zero-length axis means no rotation, which VRML
     * files do contain - `rotation 0 0 0 0` is common in generated content. */
    function rotationMatrix(r) {
        var x = r[0], y = r[1], z = r[2], angle = r[3]
        var length = Math.sqrt(x * x + y * y + z * z)
        if (!length || !angle) { return identity() }
        x /= length; y /= length; z /= length
        var c = Math.cos(angle), s = Math.sin(angle), t = 1 - c
        var m = identity()
        m[0] = t * x * x + c;     m[1] = t * x * y + s * z; m[2] = t * x * z - s * y
        m[4] = t * x * y - s * z; m[5] = t * y * y + c;     m[6] = t * y * z + s * x
        m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c
        return m
    }

    function vec3(value, fallback) {
        if (!value) { return fallback }
        var x = value.x, y = value.y, z = value.z
        if (typeof x !== 'number') { x = value[0]; y = value[1]; z = value[2] }
        if (typeof x !== 'number') { return fallback }
        return [x, y, z]
    }

    function vec4(value, fallback) {
        if (!value) { return fallback }
        var x = value.x, y = value.y, z = value.z, a = value.angle
        if (typeof x !== 'number') { x = value[0]; y = value[1]; z = value[2]; a = value[3] }
        if (typeof x !== 'number') { return fallback }
        return [x, y, z, a]
    }

    /* The local matrix of a Transform, built in the order VRML97 specifies:
     * T * C * R * SR * S * -SR * -C. */
    function transformMatrix(node) {
        var translation = vec3(fieldValue(node, 'translation'), [0, 0, 0])
        var rotation = vec4(fieldValue(node, 'rotation'), [0, 0, 1, 0])
        var scale = vec3(fieldValue(node, 'scale'), [1, 1, 1])
        var center = vec3(fieldValue(node, 'center'), [0, 0, 0])
        var scaleOrientation = vec4(fieldValue(node, 'scaleOrientation'), [0, 0, 1, 0])

        /* Row-vector composition applies the left factor first, so the chain
         * is written in application order: -C, -SR, S, SR, R, C, T. The old
         * version wrote it in the spec's column order, which applied the
         * translation before the rotation and scale - every unrotated
         * Transform hid it, and any rotated-and-translated one moved its
         * geometry to the wrong place. */
        var m = translationMatrix([-center[0], -center[1], -center[2]])
        m = multiply(m, rotationMatrix([
            scaleOrientation[0], scaleOrientation[1], scaleOrientation[2], -scaleOrientation[3],
        ]))
        m = multiply(m, scaleMatrix(scale))
        m = multiply(m, rotationMatrix(scaleOrientation))
        m = multiply(m, rotationMatrix(rotation))
        m = multiply(m, translationMatrix(center))
        m = multiply(m, translationMatrix(translation))
        return m
    }

    /* ---- intersection tests ---- */

    /* Slab test of a segment against an axis-aligned box. The segment is the
     * ray restricted to 0..1, because a blaxxun ray cast is bounded by its end
     * point rather than infinite. */
    /* Returns where along the segment the box is entered, 0..1, or -1 for a
     * miss. It used to return a bare boolean, and the caller then measured
     * box-only hits in metres while triangle hits were measured as a fraction
     * of the segment - two different scales compared against each other, so
     * which shape won was arbitrary. The entry parameter is on the same scale
     * as a triangle hit, so both can be ordered together. */
    function segmentHitsBox(origin, direction, min, max) {
        var enter = 0
        var exit = 1
        for (var axis = 0; axis < 3; axis += 1) {
            var d = direction[axis]
            if (Math.abs(d) < 1e-12) {
                if (origin[axis] < min[axis] || origin[axis] > max[axis]) { return -1 }
                continue
            }
            var t1 = (min[axis] - origin[axis]) / d
            var t2 = (max[axis] - origin[axis]) / d
            if (t1 > t2) { var swap = t1; t1 = t2; t2 = swap }
            if (t1 > enter) { enter = t1 }
            if (t2 < exit) { exit = t2 }
            if (enter > exit) { return -1 }
        }
        return enter
    }

    /* Moller-Trumbore, restricted to the 0..1 segment. Returns the distance
     * along the segment or -1. Back faces count: a VRML wall is routinely a
     * one-sided IndexedFaceSet and the member can approach it from either
     * side, so ignoring back faces would let objects pass through half the
     * walls in the world. */
    function segmentHitsTriangle(origin, direction, a, b, c) {
        var e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        var e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        var p = [
            direction[1] * e2[2] - direction[2] * e2[1],
            direction[2] * e2[0] - direction[0] * e2[2],
            direction[0] * e2[1] - direction[1] * e2[0],
        ]
        var det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
        if (Math.abs(det) < 1e-12) { return -1 }
        var inv = 1 / det
        var t = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]]
        var u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inv
        if (u < 0 || u > 1) { return -1 }
        var q = [
            t[1] * e1[2] - t[2] * e1[1],
            t[2] * e1[0] - t[0] * e1[2],
            t[0] * e1[1] - t[1] * e1[0],
        ]
        var v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inv
        if (v < 0 || u + v > 1) { return -1 }
        var distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv
        return (distance >= 0 && distance <= 1) ? distance : -1
    }

    /* ---- geometry reading ---- */

    /* A multi-value field read for element access, not for its value.
     *
     * getValue() on an MF field hands back X_ITE's internal storage - for
     * MFVec3f a padded flat Float32Array whose layout is a renderer detail -
     * so it must never be read that way here. The field object itself is the
     * scene-graph representation: SAI array access, `field.length` for the
     * logical count and `field[i]` for a typed element, is stable public
     * behaviour and is what this reader uses. */
    function mfField(node, name) {
        try { return node.getField(name) } catch (err) { return null }
    }

    /* Coordinates and triangles of the geometries CTR content actually uses.
     * Anything else falls back to its bounding box, which is the same answer
     * the historical HUD gave for geometry it could not tessellate. */
    function triangles(geometry) {
        var type = typeName(geometry)
        var coordNode = fieldValue(geometry, 'coord')
        if (!coordNode) { return null }
        var pointField = mfField(coordNode, 'point')
        if (!pointField || !pointField.length) { return null }

        var points = []
        for (var i = 0; i < pointField.length; i += 1) {
            /* A vertex that cannot be read is a reason to refuse the mesh,
             * never a zero vector - a mesh of origins swallows every ray. */
            var pv = vec3(pointField[i], null)
            if (!pv) { return null }
            points.push(pv)
        }

        var faces = []
        if (type === 'IndexedFaceSet') {
            var index = mfField(geometry, 'coordIndex')
            if (!index || !index.length) { return null }
            var polygon = []
            for (var j = 0; j < index.length; j += 1) {
                var value = typeof index[j] === 'number' ? index[j] : Number(index[j])
                if (value < 0) {
                    /* Fan-triangulate. VRML97 faces are planar and convex in
                     * practice, which is what a fan assumes. */
                    for (var k = 2; k < polygon.length; k += 1) {
                        faces.push([polygon[0], polygon[k - 1], polygon[k]])
                    }
                    polygon = []
                    continue
                }
                if (points[value]) { polygon.push(points[value]) }
            }
            for (var k2 = 2; k2 < polygon.length; k2 += 1) {
                faces.push([polygon[0], polygon[k2 - 1], polygon[k2]])
            }
            return faces
        }

        if (type === 'IndexedTriangleSet') {
            var ti = mfField(geometry, 'index')
            if (!ti || !ti.length) { return null }
            for (var t = 0; t + 2 < ti.length; t += 3) {
                var p0 = points[ti[t]], p1 = points[ti[t + 1]], p2 = points[ti[t + 2]]
                if (p0 && p1 && p2) { faces.push([p0, p1, p2]) }
            }
            return faces
        }

        if (type === 'TriangleSet') {
            for (var s = 0; s + 2 < points.length; s += 3) {
                faces.push([points[s], points[s + 1], points[s + 2]])
            }
            return faces
        }

        return null
    }

    /* ---- scene walk ---- */

    var MAX_DEPTH = 24

    function collectShapes(node, matrix, path, depth, out, skip) {
        if (!node || depth > MAX_DEPTH || out.length > 20000) { return }
        if (skip && skip.has(node)) { return }

        var type = typeName(node)

        /*
         * The HUD is the member's own overlay and is not part of the world.
         *
         * blaxxun drew HUD children in screen space, after the scene, so a ray
         * cast through the world never met them. X_ITE has no such pass - the
         * HUD PROTO is an ordinary subtree pinned to the viewpoint - so without
         * this every Outlands shot struck the weapon model held in front of the
         * shooter's own camera, a hundredth of a metre away, and no shot ever
         * reached anything else.
         */
        if (type === 'HUD') { return }

        var nextMatrix = matrix
        if (type === 'Transform') {
            nextMatrix = multiply(transformMatrix(node), matrix)
        }
        var nextPath = path.concat([node])

        if (type === 'Shape') {
            out.push({ node: node, matrix: nextMatrix, path: nextPath })
            return
        }

        /* Inline and PROTO instances hide their content behind the facade. */
        var concrete = internalNode(node)
        if (concrete) {
            var inner = null
            try {
                if (typeof concrete.getInternalScene === 'function') { inner = concrete.getInternalScene() }
                else if (typeof concrete.getBody === 'function') { inner = concrete.getBody() }
            } catch (err) { inner = null }
            if (inner && inner.rootNodes) {
                for (var r = 0; r < inner.rootNodes.length; r += 1) {
                    collectShapes(inner.rootNodes[r], nextMatrix, nextPath, depth + 1, out, skip)
                }
            }
        }

        var children = fieldValue(node, 'children')
        if (children && children.length) {
            for (var c = 0; c < children.length; c += 1) {
                collectShapes(children[c], nextMatrix, nextPath, depth + 1, out, skip)
            }
        }

        /* Switch, LOD and Billboard keep their content elsewhere; only the
         * branch that is actually displayed should be solid. */
        if (type === 'Switch') {
            var choice = fieldValue(node, 'choice')
            var which = fieldValue(node, 'whichChoice')
            if (choice && typeof which === 'number' && which >= 0 && choice[which]) {
                collectShapes(choice[which], nextMatrix, nextPath, depth + 1, out, skip)
            }
        }
        if (type === 'LOD') {
            var levels = fieldValue(node, 'level') || fieldValue(node, 'children')
            if (levels && levels.length) {
                collectShapes(levels[0], nextMatrix, nextPath, depth + 1, out, skip)
            }
        }
    }

    function shapeBounds(shape) {
        var concrete = internalNode(shape.node)
        if (!concrete || typeof concrete.getBBoxSize !== 'function') { return null }
        var size, center
        try {
            size = vec3(concrete.getBBoxSize(), null)
            center = vec3(concrete.getBBoxCenter(), null)
        } catch (err) {
            return null
        }
        if (!size || !center) { return null }
        /* An empty geometry reports a negative size; it is not solid. */
        if (size[0] < 0 || size[1] < 0 || size[2] < 0) { return null }

        /* The local box corners, carried into world space. An oriented box
         * becomes a larger axis-aligned one, which only ever makes the broad
         * phase more permissive - the triangle pass is what decides. */
        var half = [size[0] / 2, size[1] / 2, size[2] / 2]
        var min = [Infinity, Infinity, Infinity]
        var max = [-Infinity, -Infinity, -Infinity]
        for (var i = 0; i < 8; i += 1) {
            var corner = transformPoint(shape.matrix, [
                center[0] + ((i & 1) ? half[0] : -half[0]),
                center[1] + ((i & 2) ? half[1] : -half[1]),
                center[2] + ((i & 4) ? half[2] : -half[2]),
            ])
            for (var a = 0; a < 3; a += 1) {
                if (corner[a] < min[a]) { min[a] = corner[a] }
                if (corner[a] > max[a]) { max[a] = corner[a] }
            }
        }
        return { min: min, max: max }
    }

    X3D.require(['x_ite/Browser/X3DBrowser'], function (Browser) {
        var b = Browser.prototype

        /* Nodes the caller has asked to be treated as not solid. The move HUD
         * hid the object it was moving before casting; letting a caller name
         * the node instead avoids a visible flicker on every drag step. */
        b.setRayHitIgnore = function (nodes) {
            this.ctrRayHitIgnore_ = (nodes && nodes.length) ? new Set(nodes) : null
        }

        b.computeRayHit = function (start, end) {
            var scene = this.currentScene
            if (!scene || !scene.rootNodes) { return null }

            var origin = vec3(start, null)
            var target = vec3(end, null)
            if (!origin || !target) { return null }
            var direction = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]]
            if (!direction[0] && !direction[1] && !direction[2]) { return null }

            var shapes = []
            var skip = this.ctrRayHitIgnore_ || null
            for (var i = 0; i < scene.rootNodes.length; i += 1) {
                collectShapes(scene.rootNodes[i], identity(), [], 0, shapes, skip)
            }

            var best = null
            for (var s = 0; s < shapes.length; s += 1) {
                var bounds = shapeBounds(shapes[s])
                if (!bounds) { continue }
                var entry = segmentHitsBox(origin, direction, bounds.min, bounds.max)
                if (entry < 0) { continue }

                var geometry = fieldValue(shapes[s].node, 'geometry')
                var faces = geometry ? triangles(geometry) : null

                if (!faces) {
                    /* A box that already contains the ray's origin says nothing
                     * about where its surface is, so it is not an answer. The
                     * Outlands arena is ringed by a 20000-metre Cylinder whose
                     * box holds every player in the world; counted as a hit it
                     * put every shot at the shooter's own feet and stopped the
                     * game dead. */
                    if (entry <= 0) { continue }

                    /* No readable triangles: the bounding box is the answer,
                     * and the point is where the segment enters it. The old
                     * fallback reported the shape's own origin instead, which
                     * is not on the ray at all - an Outlands shot fired down
                     * -Z came back with a hit point behind the shooter. */
                    if (!best || entry < best.distance) {
                        best = {
                            distance: entry,
                            shape: shapes[s],
                            point: [
                                origin[0] + direction[0] * entry,
                                origin[1] + direction[1] * entry,
                                origin[2] + direction[2] * entry,
                            ],
                        }
                    }
                    continue
                }

                for (var f = 0; f < faces.length; f += 1) {
                    var a = transformPoint(shapes[s].matrix, faces[f][0])
                    var b2 = transformPoint(shapes[s].matrix, faces[f][1])
                    var c = transformPoint(shapes[s].matrix, faces[f][2])
                    var hit = segmentHitsTriangle(origin, direction, a, b2, c)
                    if (hit < 0) { continue }
                    if (!best || hit < best.distance) {
                        best = {
                            distance: hit,
                            shape: shapes[s],
                            point: [
                                origin[0] + direction[0] * hit,
                                origin[1] + direction[1] * hit,
                                origin[2] + direction[2] * hit,
                            ],
                        }
                    }
                }
            }

            if (!best) { return null }

            var point = best.point || [
                (best.shape.matrix[12]), (best.shape.matrix[13]), (best.shape.matrix[14]),
            ]
            return {
                hitPoint: new X3D.SFVec3f(point[0], point[1], point[2]),
                hitNormal: new X3D.SFVec3f(0, 1, 0),
                /* Root-first, as Contact returned it: the Outlands Turret reads
                 * hitPath[0].children to find its siblings. */
                hitPath: best.shape.path,
                hitObject: best.shape.node,
            }
        }
    })

})();
