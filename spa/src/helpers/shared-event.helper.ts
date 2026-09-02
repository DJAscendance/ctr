/**
 * OUTLANDS-1h - the blaxxun `SharedEvent` wire codecs.
 *
 * WHAT A SHARED EVENT IS. blaxxun Contact carried a small set of typed values
 * between everybody standing in the same world. A world declares a
 * `SharedEvent` PROTO node, writes a value into `<type>ToServer`, and every
 * client in that place - the sender included - receives it back on
 * `<type>FromServer`. The PROTO itself holds no network code; the browser did
 * the transport. CTR reproduces that transport over Socket.io, so this module
 * is the only place where an X_ITE field becomes JSON and JSON becomes an
 * X_ITE field again.
 *
 * WHY IT LIVES HERE. The table used to sit inline in `WorldBrowserPage.vue`,
 * where nothing could reach it. It is a pure value mapping with no Vue, no
 * socket and no world knowledge, so it belongs beside the other blaxxun
 * compatibility helpers, where the dependency-free test harness can prove it.
 * `WorldBrowserPage.vue` calls `createSharedEventCodecs(X3D)` and keeps the
 * result in `this.TYPES` exactly as before.
 *
 * THE DEFECT THIS FIXES. The `vec3f` receive codec built an `X3D.SFVec2f` from
 * three components. `SFVec2f` takes two, and X_ITE 4.7.0 answers a third
 * argument with `Error: Invalid arguments.` - so the receive threw inside
 * `onSharedEvent` and the event never reached the world at all. Outlands
 * routes a real `SFVec3f` through it:
 *
 *   battle.beamOut_sent            (SFVec3f, the beamed-out player's position)
 *     -> beamOut_event.set_vec3f   (DEF beamOut_event SharedEvent "BeamOutEvent")
 *     -> vec3fToServer  -> socket  -> vec3fFromServer
 *     -> vec3f_changed
 *     -> battle.receive_beamOut    -> beamOutPosition_changed
 *
 * `receive_beamOut` places the remote beam-out wave at that position, so no
 * remote beam-out was ever seen. The send side was always correct and is
 * unchanged.
 *
 * The `X3D` namespace is passed in rather than read from the global, so the
 * table can be built against X_ITE's real field classes in the browser and
 * against faithful stand-ins in the test.
 */

/**
 * One wire codec: an X_ITE field value out, a plain JSON value back in.
 *
 * The base `no-unused-vars` rule is on for this project, and it reads the
 * parameter name of a type signature as a real binding. There is nothing to
 * use in a declaration, so the two names below are reported no matter what
 * they are called. The rule is turned off for the declaration only.
 */
/* eslint-disable no-unused-vars */
export interface SharedEventCodec {
  toJSON(value: any): any;
  fromJSON(value: any): any;
}
/* eslint-enable no-unused-vars */

/** The codec table, keyed by the blaxxun `SharedEvent` type name. */
export interface SharedEventCodecs {
  [type: string]: SharedEventCodec;
}

/**
 * Builds the `SharedEvent` codec table against a given X_ITE namespace.
 *
 * The scalar types (`bool`, `float`, `int32`, `string`, `time`) cross the wire
 * as themselves and need no conversion. The compound types are taken apart
 * into their named components on the way out and rebuilt on the way in, so the
 * world always receives the same X_ITE field type it sent.
 */
export function createSharedEventCodecs(x3d: any): SharedEventCodecs {
  return {
    bool: {
      toJSON: (e) => e,
      fromJSON: (e) => e,
    },
    color: {
      toJSON: (color) => ({
        r: color.r,
        g: color.g,
        b: color.b,
      }),
      fromJSON: (color) => new x3d.SFColor(color.r, color.g, color.b),
    },
    float: {
      toJSON: (e) => e,
      fromJSON: (e) => e,
    },
    int32: {
      toJSON: (e) => e,
      fromJSON: (e) => e,
    },
    rotation: {
      toJSON: (rotation) => ({
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        angle: rotation.angle,
      }),
      fromJSON: (rotation) =>
        new x3d.SFRotation(
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.angle,
        ),
    },
    string: {
      toJSON: (e) => e,
      fromJSON: (e) => e,
    },
    time: {
      toJSON: (e) => e,
      fromJSON: (e) => e,
    },
    vec2f: {
      toJSON: (vec2f) => ({ x: vec2f.x, y: vec2f.y }),
      fromJSON: (vec2f) => new x3d.SFVec2f(vec2f.x, vec2f.y),
    },
    vec3f: {
      toJSON: (vec3f) => ({
        x: vec3f.x,
        y: vec3f.y,
        z: vec3f.z,
      }),
      fromJSON: (vec3f) => new x3d.SFVec3f(vec3f.x, vec3f.y, vec3f.z),
    },
  };
}
