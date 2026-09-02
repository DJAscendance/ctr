/*eslint no-undef: 0*/
(function () {

  // Blaxxun `HUD`. A built-in grouping node of blaxxun Contact 4.0 and later
  // whose children are drawn in the viewer's coordinate system. X_ITE has no
  // equivalent - no Layer, no LayerSet, no ScreenGroup in the 4.7.0 bundle the
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

  // The near-plane clearance arithmetic lives in the pure helper so the shipped
  // rule and the unit-tested rule are literally the same function. `bxx_ray.js`
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
    "x_ite/Configuration/SupportedNodes",
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
    SupportedNodes,
    Matrix4,
    Vector3,
    Box3,
  ) {

    // Idempotent: `App.vue` requires this module once, but a hot reload or a
    // second import must not register the type twice.
    if (SupportedNodes.getType("HUD")) { return; }

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

    function HUD(executionContext) {
      X3DGroupingNode.call(this, executionContext);
      this.addType(X3DConstants.HUD);
      this.bxxMatrix = new Matrix4();
    }

    HUD.prototype = Object.assign(Object.create(X3DGroupingNode.prototype), {
      constructor: HUD,

      // The five historical fields, plus the three every X_ITE grouping node
      // needs from its base classes (`metadata`, `visible`, `bboxDisplay`).
      // Those three are machinery, not restored blaxxun surface: no historical
      // world sets them, because blaxxun's HUD never had them.
      fieldDefinitions: new FieldDefinitionArray([
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
      ]),

      getTypeName: function () { return "HUD"; },
      getComponentName: function () { return "Grouping"; },
      getContainerField: function () { return "children"; },

      // Read by the `computeRayHit` walk in `bxx_ray.js`. It means "my matrix
      // replaces the accumulated one", which keeps a nested HUD - such as the
      // turret panel in `ne_game.wrl`, which sits under a Transform inside a
      // Switch - in camera space for picking as well as for drawing.
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

    SupportedNodes.addType("HUD", HUD);

    // Exposed so a test or a later lane can reach the constructor without
    // re-deriving it from the parser.
    X3D.bxx = X3D.bxx || {};
    X3D.bxx.HUD = HUD;
  });

})();
