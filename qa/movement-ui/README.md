# movement-ui

Guards **where** the walk-speed control lives, **how** a citizen opens it, and
whether one dial setting means **one pace in every world**.

The sibling gate `qa/movement` measures how fast the avatar actually moves. The
placement half of this gate exists because the control shipped once in the wrong
place, and the unit tests of the day encoded that wrong placement as the
contract.

## The contract

- The legacy right-hand rail carries **no** walk-speed control. `WorldBrowserTools.vue`
  is byte-identical to its pre-movement version.
- A right-click inside `#world` opens **X_ITE's own** context menu, which now
  carries a `Walk Speed` entry between *Texture Quality* and *Browser Timings*.
  The entry is registered through X_ITE 16's supported extension point,
  `browser.getContextMenu().setUserMenu(fn)` - nothing here builds a menu.
- `Walk Speed` opens `WalkSpeedPanel.vue`: slider, number box and Reset, all
  bound to the one store value, positioned at the pointer and clamped inside
  the world box.
- The native browser menu keeps working everywhere except the canvas, where
  X_ITE already suppressed it before this change.

## The other contract: one dial, one pace

`NavigationInfo.speed` is authored per world with no consistency - `shop.wrl`
says 2.25, `shopping.wrl` says 1, `enter.wrl` and `carshowcase.wrl` say 10,
`largeitems.wrl` omits the field entirely. X_ITE multiplies our factor by that
term, so a bare dial *scaled* the discrepancy instead of removing it: measured
at the 2.5 default, the Car Showcase ran at 17.48 units/s against the Large
Item Shop's 1.75.

The factor now divides the authored speed back out, anchored on `shop.wrl` -
the reference the owner picked from real play. Every world lands on the pace
that one walks at.

`jail.wrl` is deliberately exempt. `WORLD_SPEED_OVERRIDES` entries are raw
X_ITE factors where `1` means "the engine default, untouched", and they exist
because the world cannot use the dial at all. Normalising them would speed the
cell *up*.

> The jail pin still applies to everyone in `jail.wrl`, not only to inmates.
> Narrowing it needs the jail system, which is not finished.

## Running

Both tools need a live stack and a real GPU. Playwright itself needs Node 20+;
the SPA build and the SPA unit suite stay on the repo-pinned Node 14.18.1.

```shell
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

# 43 runtime checks, exits non-zero on any failure
DISPLAY=:0 CTR_QA_URL=http://localhost:8001 \
  node qa/movement-ui/tools/check-walk-speed-ui.js

# before/after screenshots + a machine-readable summary line
DISPLAY=:0 CTR_QA_URL=http://localhost:8001 \
  node qa/movement-ui/tools/capture-ui.js artifacts/movement-ui/after [placeSlug] [world]

# walks seven worlds and checks they agree; ~25 min, it is a real walk each time
DISPLAY=:0 CTR_QA_URL=http://localhost:8001 \
  node qa/movement-ui/tools/check-speed-parity.js artifacts/movement-ui/parity
```

`check-speed-parity.js` takes `CTR_QA_DIAL` (default 2.5) to check a different
dial setting. It asserts on the live **engine product** (`authored x factor`),
which is exact, and corroborates with the walked distance inside a deliberately
generous 25% band - a walk is measured against real collision, so a world with
a wall in the way legitimately covers less ground. The defect it guards against
was a factor of ten.

`CTR_QA_USER` / `CTR_QA_PASS` default to `testqa` / `testqa`. The account needs
`chatdefault = 1` (or the gate's own `setView3d(true)` call, which it makes) or
`#world` stays `display:none` and never gets a canvas.

## Things that cost time once, so they are written down

- **The X_ITE menu is in a shadow root.** It lives on the `x3d-canvas` element's
  open `shadowRoot` as `ul.context-menu-root`. A sibling `div.context-menu-layer`
  carries the same `x_ite-private-menu` class, so matching on that class returns
  the backdrop - which has no `li` - and the menu reads as empty.
- **`offsetParent` is always `null` for `position: fixed`.** The panel is fixed
  on purpose, so an `offsetParent` visibility test reports an open panel as
  hidden. Visibility here is measured from `getBoundingClientRect()`, which
  collapses to 0x0 under `v-show`'s `display: none`.
- **A sideways drag does not move the avatar.** In WALK mode it turns. A
  navigation check has to drag *forward*, or it fails whether or not pointer
  input survived.
- **Read position from `WorldBrowserPage.position`**, the app's own
  ProximitySensor feed - the same source `qa/movement` uses.
  `currentViewpoint.getPosition()` returns nothing through X_ITE 16's sealed SAI
  facade, which makes a movement check silently vacuous rather than failing.
- **Playwright evaluates a string argument as an expression.** Passing
  `"() => {...}"` hands back the function object, not its result.
