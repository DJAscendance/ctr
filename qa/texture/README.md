# VRML97 Colour-Texture Semantics

The ruler for `spa/src/libs/x_ite_mods/vrml_texture_color.js`.

Control runtime: **X_ITE 16.2.0**, as pinned in `spa/public/index.html`.

## The rule

VRML97 (ISO/IEC 14772-1, 4.14 *Lighting model*, table 4.5) makes the diffuse
term depend on how many components a texture has:

| components | meaning | diffuse term |
|---|---|---|
| 1 | intensity | `diffuseColor` × intensity |
| 2 | intensity + alpha | `diffuseColor` × intensity |
| 3 | RGB | texture colour |
| 4 | RGBA | texture colour |

X3D dropped the three-and-four-component case: there, every texture multiplies
`diffuseColor`. X_ITE implements the X3D rule for all content, including `.wrl`.

## Why it matters here

A scan of `spa/assets` finds **4329** Appearance blocks that bind a texture:

| | count |
|---|---|
| explicit non-white `diffuseColor` | 1996 |
| no `diffuseColor`, so the VRML default `0.8 0.8 0.8` | 2226 |
| explicit `1 1 1` | 107 |

Under the X3D rule the first group is tinted and the second is darkened by a
fifth. Adventure (`ad_col`) is the clearest case: `wood.jpg` under
`diffuseColor 1 0 0` renders flat red instead of red-lit wood.

## What the fix is not

It is not a data change. No world file, texture or `diffuseColor` is edited; the
rule is applied at render time and only to content whose execution context
reports the VRML encoding. `.x3d`, `.glb`, `.gltf` and `.obj` content keeps
native X_ITE semantics, which is what makes mixed legacy and modern formats
possible later.

It is also not a global shader change. `Material.setShaderUniforms` runs to
completion first; the patch then rewrites one uniform, `x3d_DiffuseColor`.
Ambient, specular, emissive, shininess and transparency are the engine's.

## Running it

Pure logic, no browser:

```shell
node qa/texture/test/run.js
```

Runtime proof, needs Playwright and network access to the pinned CDN:

```shell
NODE_PATH=<dir containing playwright> node qa/texture/tools/check-texture-semantics.js
NODE_PATH=<dir containing playwright> node qa/texture/tools/check-texture-semantics.js --no-patch
```

The second form loads the bare engine. It must fail: that is the defect, and a
version of this check that passes without the patch is not guarding anything.

## The fixture cases

| id | scene | asserts |
|---|---|---|
| a | VRML97, colour texture, `diffuseColor 1 0 0` | renders the same as `b` |
| b | VRML97, colour texture, `diffuseColor 1 1 1` | the control |
| c | VRML97, no texture, `diffuseColor 1 0 0` | still red |
| d | **X3D XML**, same content as `a` | still multiplied |
| e | VRML97, one-component `PixelTexture` | still multiplied |
| f | VRML97, colour texture, `transparency 0.5` | half of `b` |
| g | VRML97, colour texture, specular + emissive | red channel matches `b`, blue exceeds it |

`a`, `b`, `d`, `f` and `g` point at a real shipped texture,
`spa/assets/worlds/ad_col/vrml/wood.jpg`, so the thing under test is the content
we serve rather than a stand-in.

Cases `a` and `e` also cover both detection paths: an `ImageTexture` is
classified from the pixels X_ITE reads back for its transparency test, a
`PixelTexture` from the array handed straight to `setTextureData`.
