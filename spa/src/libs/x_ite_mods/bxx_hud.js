/*eslint no-undef: 0*/
(function () {

  // Blaxxun `HUD`. A built-in grouping node of blaxxun Contact 4.0 and later
  // whose children are drawn in the viewer's coordinate system. X_ITE has no
  // equivalent - no Layer, no LayerSet, no ScreenGroup in the 16.2.0 bundle the
  // SPA loads - so a world that writes `HUD { ... }` dies in the parser with
  // "Unkown node type or proto 'HUD'" before any of it runs.
  //
  // The field list and the behaviour both come from files already in this
  // repository: `assets/worlds/externprotos/shared_xite.wrl` declares the
  // interface, and `assets/worlds/externprotos/nodes_xite.wrl` carries the
  // "# CC3D 4.0" PROTO fallback that emulates it with a ProximitySensor routed
  // into a Transform, inside `Collision { collide FALSE }`. See
  // `helpers/bxx-hud.helper.ts` for the full transcription and the reasoning.
  //
  // WHY A REAL NODE AND NOT A PROTO. The historical worlds split into two
  // groups. Worlds like the Plaza declare `EXTERNPROTO HUD` and get the
  // fallback. `ne_game.wrl` declares nothing, because Contact had the node
  // built in. Only a registered node type serves both, and registering one
  // restores blaxxun's own resolution order: X_ITE's parser tries a built-in
  // before a PROTO, exactly as Contact resolved the blaxxun urn to its native
  // node ahead of the .wrl fallback.
  //
  // THE NEAR PLANE. X_ITE sizes the near clipping plane from the avatar rather
  // than from the content - `NavigationInfo.getNearValue()` is half the
  // collision radius, so CTR's default 0.25 puts it at 0.125 - and blaxxun did
  // not, so historical HUD geometry drawn nearer than that is thrown away.
  // `traverse()` below corrects for it with a uniform scale about the eye,
  // measured per node from that node's own bounding box. See
  // `hudNearClearanceScale()` in `helpers/bxx-hud.helper.ts`.
  //
  // NOT DONE HERE. Nothing in this file knows about Outlands. There is no world
  // name, no team, no score and no weapon logic - a HUD is a HUD. The clearance
  // scale is measured, never hard-coded, so a HUD that already clears the plane
  // is left untouched.
  //
  // X_ITE 16 PORT. Two things moved between 4.7.0 and 16.2.0 and nothing else
  // in this file had to change:
  //
  //   1. `x_ite/Configuration/SupportedNodes` was REMOVED. The registry is now
  //      the global `X3D.ConcreteNodes`, and `ConcreteNodes.add(name, Klass)`
  //      replaces `SupportedNodes.addType(name, Klass)`. It also does the work
  //      the old call did not: it derives `X3DConstants.HUD` from the class's
  //      static `typeName`, and registers the type with the HTML parser. The
  //      module id is dropped from the require list below rather than resolved
  //      to null.
  //   2. Class metadata moved from the PROTOTYPE to STATIC properties on the
  //      constructor. `X3DObject.prototype.getTypeName()` now returns
  //      `this.constructor.typeName`, `X3DNode.prototype.getContainerField()`
  //      returns `this.constructor.containerField`, and `X3DBaseNode` reads
  //      `this.constructor.fieldDefinitions` when it builds the node's fields.
  //      The old prototype `getTypeName`/`getComponentName`/`getContainerField`
  //      are therefore gone: `getComponentName` no longer exists anywhere in
  //      16 (it is `getComponentInfo`), and the other two would only shadow the
  //      base implementations with the same answers the statics already give.

  // The near-plane clearance arithmetic lives in the pure helper so the shipped
  // rule and the unit-tested rule are literally the same function. `bxx_rayhit.js`
  // already requires this module the same way.
  const hud = require("../../helpers/bxx-hud.helper");

  window.X3D = window.X3D || {};

  X3D.require([
    "x_ite/Fields",
    "x_ite/Basic/X3DFieldDefinition",
    "x_ite/Basic/FieldDefinitionArray",
    "x_ite/Components/Grouping/X3DGroupingNode",
    "x_ite/Bits/X3DConstants",
    "x_ite/Bits/TraverseType",
    "standard/Math/Numbers/Matrix4",
    "standard/Math/Numbers/Vector3",
    "standard/Math/Geometry/Box3",
  ], function (
    Fields,
    X3DFieldDefinition,
    FieldDefinitionArray,
    X3DGroupingNode,
    X3DConstants,
    TraverseType,
    Matrix4,
    Vector3,
    Box3,
  ) {

    // The registry every X_ITE 16 browser copies at construction time. This
    // patch runs from `App.vue` `mounted()`, before any `X3D.createBrowser()`,
    // so the copy each browser takes already carries HUD.
    const concreteNodes = X3D.ConcreteNodes;
    if (!concreteNodes || typeof concreteNodes.add !== "function") {
      console.warn("[bxx_hud] X3D.ConcreteNodes is unavailable; HUD not registered");
      return;
    }

    // Idempotent: `App.vue` requires this module once, but a hot reload or a
    // second import must not register the type twice - `ConcreteNodesArray.add`
    // throws on a duplicate key rather than replacing it.
    const registered = typeof concreteNodes.has === "function"
      ? concreteNodes.has("HUD")
      : Boolean(typeof concreteNodes.get === "function" && concreteNodes.get("HUD"));
    if (registered) { return; }

    // The numeric TraverseType constants, keyed back to the names the pure
    // helper reasons about.
    const KINDS = {};
    KINDS[TraverseType.POINTER] = "POINTER";
    KINDS[TraverseType.CAMERA] = "CAMERA";
    KINDS[TraverseType.PICKING] = "PICKING";
    KINDS[TraverseType.COLLISION] = "COLLISION";
    KINDS[TraverseType.SHADOW] = "SHADOW";
    KINDS[TraverseType.DISPLAY] = "DISPLAY";

    // COLLISION is dropped, CAMERA runs in plain camera space, and everything
    // else runs in camera space with the near-plane clearance scale. The rule
    // and the evidence for it live in `hudTraversal()`; this only maps X_ITE's
    // numeric constants onto the names that function reasons about.
    function traversal(type) {
      return hud.hudTraversal(KINDS[type]);
    }

    // Scratch objects. The traversal runs every frame, for every HUD, so none
    // of these are allocated inside it.
    const scratchBox = new Box3();
    const scratchMin = new Vector3(0, 0, 0);
    const scratchMax = new Vector3(0, 0, 0);
    const scratchScale = new Vector3(1, 1, 1);

    // The NavigationInfo that owns the near plane. The render object is the
    // layer during an ordinary traversal, but a StaticGroup or a shadow pass
    // hands down something else, so the active layer is the fallback.
    function navigationInfoOf(node, renderObject) {
      try {
        if (renderObject && typeof renderObject.getNavigationInfo === "function") {
          const fromRenderObject = renderObject.getNavigationInfo();
          if (fromRenderObject) { return fromRenderObject; }
        }
      } catch (error) { /* fall through to the active layer */ }
      try {
        const layer = node.getBrowser().getActiveLayer();
        return layer ? layer.getNavigationInfo() : null;
      } catch (error) {
        return null;
      }
    }

    // How much this HUD's own children must be pushed out to clear the near
    // plane. 1 means "already clear", and 1 is what every HUD that is not in
    // trouble gets - the measurement is per node, from that node's own bbox.
    function nearClearanceScale(node, renderObject) {
      try {
        const navigationInfo = navigationInfoOf(node, renderObject);
        if (!navigationInfo) { return 1; }

        const bbox = node.getBBox(scratchBox, false);
        if (!bbox || bbox.isEmpty()) { return 1; }

        bbox.getExtents(scratchMin, scratchMax);

        return hud.hudNearClearanceScale(
          { empty: false, maxZ: scratchMax.z },
          navigationInfo.getNearValue(),
        );
      } catch (error) {
        // A HUD that cannot be measured is left exactly where the world put it.
        return 1;
      }
    }

    // Camera space -> world. The active viewpoint already maintains exactly
    // this matrix for the renderer, so the HUD reads it rather than rebuilding
    // one from position and orientation.
    function cameraSpaceMatrix(node) {
      try {
        const layer = node.getBrowser().getActiveLayer();
        if (!layer) { return null; }
        const viewpoint = layer.getViewpoint();
        if (!viewpoint) { return null; }
        return viewpoint.getCameraSpaceMatrix();
      } catch (error) {
        return null;
      }
    }

    // X_ITE 16 node classes are still ES5 constructor functions, so the base
    // call is unchanged from 4.7.
    function HUD(executionContext) {
      X3DGroupingNode.call(this, executionContext);

      // Read lazily, never captured at require time: the constant does not
      // exist until `ConcreteNodes.add` below derives it from `HUD.typeName`,
      // and that happens after this function is defined. A HUD is only ever
      // constructed by a world, long after registration, so this is satisfied
      // in practice - the guard is here for the case where it is not.
      const type = X3D.X3DConstants && X3D.X3DConstants.HUD;
      if (type === undefined) {
        console.warn("[bxx_hud] X3DConstants.HUD is undefined; HUD type not added");
      } else {
        this.addType(type);
      }

      this.bxxMatrix = new Matrix4();
    }

    HUD.prototype = Object.assign(Object.create(X3DGroupingNode.prototype), {
      constructor: HUD,

      // Read by the `computeRayHit` walk in `bxx_rayhit.js`. It means "my
      // matrix replaces the accumulated one", which keeps a nested HUD - such
      // as the turret panel in `ne_game.wrl`, which sits under a Transform
      // inside a Switch - in camera space for picking as well as for drawing.
      // `isViewRelative()` in `helpers/bxx-hud.helper.ts` is the reader.
      bxxViewRelative: true,

      // The camera-space matrix, exposed under the name the ray walk already
      // probes for on Transform-like nodes.
      //
      // DELIBERATELY UNSCALED. The near-plane clearance scale below is a
      // rendering correction for X_ITE's projection; it is not part of the
      // world. `computeRayHit` measures historical distances - `ne_game.wrl`
      // sets its weapon range from a backstop quad at exactly z -100 - so the
      // ray walk must see the coordinates the world actually wrote. Scaling
      // about the eye never changes ray DIRECTION, only distance along it, so
      // the two views agree on what is hit and differ only on how far away it
      // is, which is the one number the historical script cares about.
      getMatrix: function () {
        const matrix = cameraSpaceMatrix(this);
        if (!matrix) { return this.bxxMatrix.identity(); }
        return this.bxxMatrix.assign(matrix);
      },

      traverse: function (type, renderObject) {
        const plan = traversal(type);
        if (!plan.visit) { return; }

        const modelViewMatrix = renderObject.getModelViewMatrix();

        modelViewMatrix.push();
        try {
          // The model-view stack is seeded with the view matrix, so clearing it
          // leaves the children in the viewer's own frame - the whole point of
          // the node.
          if (plan.cameraSpace) {
            modelViewMatrix.identity();

            // With the stack at the identity the eye is at the origin, so this
            // scale is about the eye: it holds every child on the same pixels
            // at the same apparent size and only pushes it past the near plane.
            // It is 1, and therefore a no-op, for any HUD already clear of it.
            if (plan.nearClearance) {
              const scale = nearClearanceScale(this, renderObject);
              if (scale !== 1) {
                modelViewMatrix.scale(scratchScale.set(scale, scale, scale));
              }
            }
          }
          X3DGroupingNode.prototype.traverse.call(this, type, renderObject);
        } finally {
          modelViewMatrix.pop();
        }
      },
    });

    // STATIC class metadata, the X_ITE 16 shape. `typeName` is what
    // `getTypeName()` returns - and therefore what the SFNode facade's
    // `getNodeTypeName()` returns, which is the string `bxx_rayhit.js` tests
    // when it skips HUD subtrees while picking. `fieldDefinitions` must be
    // static too: `X3DBaseNode` reads `this.constructor.fieldDefinitions`, so a
    // prototype copy would be ignored and the node would get no fields at all.
    HUD.typeName = "HUD";
    HUD.componentInfo = { name: "Grouping", level: 1 };
    HUD.containerField = "children";
    HUD.specificationRange = { from: "2.0", to: "Infinity" };

    // The five historical fields, plus the three every X_ITE grouping node
    // needs from its base classes (`metadata`, `visible`, `bboxDisplay`).
    // Those three are machinery, not restored blaxxun surface: no historical
    // world sets them, because blaxxun's HUD never had them. The list and its
    // order are identical to X_ITE 16's own `Group.fieldDefinitions`.
    HUD.fieldDefinitions = new FieldDefinitionArray([
      new X3DFieldDefinition(X3DConstants.inputOutput, "metadata", new Fields.SFNode()),
      new X3DFieldDefinition(X3DConstants.inputOutput, "visible", new Fields.SFBool(true)),
      new X3DFieldDefinition(X3DConstants.inputOutput, "bboxDisplay", new Fields.SFBool()),
      new X3DFieldDefinition(
        X3DConstants.initializeOnly, "bboxSize", new Fields.SFVec3f(-1, -1, -1),
      ),
      new X3DFieldDefinition(X3DConstants.initializeOnly, "bboxCenter", new Fields.SFVec3f()),
      new X3DFieldDefinition(X3DConstants.inputOnly, "addChildren", new Fields.MFNode()),
      new X3DFieldDefinition(X3DConstants.inputOnly, "removeChildren", new Fields.MFNode()),
      new X3DFieldDefinition(X3DConstants.inputOutput, "children", new Fields.MFNode()),
    ]);

    // Registration. This is also what creates `X3DConstants.HUD`, from
    // `HUD.typeName` - so every static above must be in place before it runs.
    try {
      concreteNodes.add("HUD", HUD);
    } catch (error) {
      console.warn("[bxx_hud] could not register the HUD node type", error);
      return;
    }

    // Exposed so a test or a later lane can reach the constructor without
    // re-deriving it from the parser.
    X3D.bxx = X3D.bxx || {};
    X3D.bxx.HUD = HUD;
  });

})();
