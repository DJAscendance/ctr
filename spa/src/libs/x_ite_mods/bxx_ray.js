/*eslint no-undef: 0*/
(function () {

  // Blaxxun `Browser.computeRayHit(start, end)`. X_ITE has no equivalent, and
  // `bxx_auth.js` left it commented out, so every Outlands weapon was a no-op.
  //
  // This walks the live scene graph in WORLD space and reuses X_ITE's own
  // `X3DGeometryNode.intersectsLine`, the same routine the pointing device
  // picker uses. It deliberately does NOT go through `browser.touch()`:
  // that picks along a ray from the camera through a screen point, which is
  // right for `fire()` but wrong for `receive_repulsor()`, whose ray starts
  // at the receiving player and runs along the *shooter's* orientation.
  //
  // All decision logic lives in `src/helpers/bxx-ray.helper.ts` so it can be
  // unit tested without a browser. This file is the X_ITE binding only.

  const helper = require("../../helpers/bxx-ray.helper");

  // Registration seam for later lanes. OUTLANDS-2 pushes an adapter here to
  // make remote players answer getType() === "Avatar" and carry a nickname.
  // Nothing Outlands-specific belongs in this file.
  window.X3D = window.X3D || {};
  X3D.bxx = X3D.bxx || {};
  X3D.bxx.nodeAdapters = X3D.bxx.nodeAdapters || [];

  let warned = false;
  function warnOnce(error) {
    if (warned) { return; }
    warned = true;
    console.warn("computeRayHit: traversal degraded, reporting a miss", error);
  }

  X3D.require([
    "x_ite/Browser/X3DBrowser",
    "standard/Math/Numbers/Matrix4",
    "standard/Math/Numbers/Vector3",
    "standard/Math/Geometry/Line3",
  ], function (Browser, Matrix4, Vector3, Line3) {

    function toTriple(value) {
      if (!value) { return [0, 0, 0]; }
      if (Array.isArray(value)) { return [value[0] || 0, value[1] || 0, value[2] || 0]; }
      return [value.x || 0, value.y || 0, value.z || 0];
    }

    // The historical script treats hitPoint as a real SFVec3f - it calls
    // .add(), .subtract() and feeds it to new MFVec3f() - so the plain
    // triples the pure helper works in are converted back at this boundary.
    function toSceneResult(result) {
      return {
        hitPoint: new X3D.SFVec3f(result.hitPoint[0], result.hitPoint[1], result.hitPoint[2]),
        hitNormal: new X3D.SFVec3f(result.hitNormal[0], result.hitNormal[1], result.hitNormal[2]),
        hitPath: result.hitPath,
      };
    }

    // `scene.rootNodes` and every MFNode field hand back SFNode WRAPPERS, not
    // the base nodes. The wrapper answers getName() with "" and getTypeName()
    // with "SFNode", and carries neither getMatrix nor getGeometry, so reading
    // a wrapper looks like a node with no name, no type and no geometry.
    // Everything below therefore unwraps first.
    function unwrap(node) {
      try {
        if (node && typeof node.getValue === "function") {
          const value = node.getValue();
          if (value) { return value; }
        }
      } catch (error) { /* already a base node */ }
      return node;
    }

    function typeNameOf(node) {
      if (!node) { return undefined; }
      if (typeof node.getTypeName === "function") { return node.getTypeName(); }
      return undefined;
    }

    function nameOf(node) {
      try {
        if (node && typeof node.getName === "function") { return node.getName() || ""; }
      } catch (error) { /* an unnamed node throws in X_ITE; empty is correct */ }
      return "";
    }

    // Wraps a live X_ITE node in the Blaxxun-shaped view the historical
    // scripts expect. X_ITE's own node.getType() returns an array of
    // numeric type constants and the renderer dispatches on it, so it is
    // never patched globally - the string form exists only out here.
    function viewOf(node) {
      const base = unwrap(node);
      const view = {
        getName: function () { return nameOf(base); },
        getType: function () {
          return helper.resolveNodeType(base, X3D.bxx.nodeAdapters, function () {
            return typeNameOf(base);
          });
        },
      };
      Object.defineProperty(view, "children", {
        get: function () { return childrenOf(base).map(viewOf); },
      });
      Object.defineProperty(view, "nickname", {
        get: function () { return helper.resolveNodeNickname(base, X3D.bxx.nodeAdapters); },
      });
      return view;
    }

    // Grouping nodes, Inline sub-scenes and PROTO instances, in that order of
    // specificity. `getField("children")` is the generic accessor - the bare
    // `.children` property only exists on the SFNode wrapper, not on the base
    // node, and X3DGroupingNode covers Group, Transform, Switch, Anchor,
    // Billboard, Collision and LOD alike.
    function childrenOf(node) {
      const base = unwrap(node);
      if (!base) { return []; }
      try {
        if (typeof base.getInternalScene === "function") {
          const scene = base.getInternalScene();
          return scene ? Array.from(scene.rootNodes).map(unwrap) : [];
        }
      } catch (error) { /* not an Inline */ }
      try {
        if (typeof base.getInnerNode === "function") {
          const inner = base.getInnerNode();
          if (inner && inner !== base) { return [unwrap(inner)]; }
        }
      } catch (error) { /* not a PROTO instance */ }
      try {
        if (typeof base.getField === "function") {
          return Array.from(base.getField("children")).map(unwrap);
        }
      } catch (error) { /* no children field */ }
      return [];
    }

    function matrixOf(base) {
      try {
        if (base && typeof base.getMatrix === "function") { return base.getMatrix(); }
      } catch (error) { /* not a transform */ }
      return null;
    }

    function geometryOf(base) {
      try {
        if (base && typeof base.getGeometry === "function") { return unwrap(base.getGeometry()); }
      } catch (error) { /* not a shape */ }
      return null;
    }

    // Depth-first walk. `chain` is accumulated root-first, which is the
    // order the historical hitPath reads in.
    function collect(candidate, modelMatrix, chain, ray, worldLine, out, depth) {
      const node = unwrap(candidate);
      if (!node || depth > 64) { return; }

      const local = matrixOf(node);
      let matrix = modelMatrix;
      if (local) {
        matrix = new Matrix4();
        matrix.assign(local);
        matrix.multRight(modelMatrix);
      }

      const nextChain = chain.concat([node]);
      const geometry = geometryOf(node);

      if (geometry && typeof geometry.intersectsLine === "function") {
        try {
          const inverse = new Matrix4();
          inverse.assign(matrix).inverse();

          const localLine = new Line3(new Vector3(0, 0, 0), new Vector3(0, 0, 1));
          localLine.assign(worldLine);
          localLine.multLineMatrix(inverse);

          const intersections = [];
          if (geometry.intersectsLine(localLine, [], matrix, intersections)) {
            for (let i = 0; i < intersections.length; ++i) {
              const point = intersections[i].point;
              const normal = intersections[i].normal;
              matrix.multVecMatrix(point);
              const world = toTriple(point);
              out.push({
                point: world,
                normal: toTriple(normal),
                distance: helper.length(helper.subtract(world, ray.origin)),
                chain: nextChain,
              });
            }
          }
        } catch (error) {
          warnOnce(error);
        }
      }

      const children = childrenOf(node);
      for (let c = 0; c < children.length; ++c) {
        collect(children[c], matrix, nextChain, ray, worldLine, out, depth + 1);
      }
    }

    Browser.prototype.computeRayHit = function (startPoint, endPoint) {
      const start = toTriple(startPoint);
      const end = toTriple(endPoint);
      const ray = helper.rayFromPoints(start, end);

      let rootNodes = [];
      try {
        rootNodes = Array.from(this.currentScene.rootNodes).map(unwrap);
      } catch (error) {
        warnOnce(error);
      }

      // hitPath[0].children is a documented dependency of the Ammo and
      // Turret PROTOs, so the root view is built even for a miss.
      const root = {
        getName: function () { return ""; },
        getType: function () { return "Group"; },
        children: rootNodes.map(viewOf),
      };

      if (ray.length === 0) {
        return toSceneResult(helper.buildRayHit(ray, null, root, viewOf));
      }

      let hits = [];
      try {
        const worldLine = new Line3(
          new Vector3(ray.origin[0], ray.origin[1], ray.origin[2]),
          new Vector3(ray.direction[0], ray.direction[1], ray.direction[2]),
        );
        const identity = new Matrix4();
        for (let r = 0; r < rootNodes.length; ++r) {
          collect(rootNodes[r], identity, [], ray, worldLine, hits, 0);
        }
      } catch (error) {
        warnOnce(error);
        hits = [];
      }

      return toSceneResult(helper.buildRayHit(ray, helper.nearestHit(ray, hits), root, viewOf));
    };
  });

})();
