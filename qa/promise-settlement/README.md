# qa/promise-settlement

Guards one property: **every `startX3D()` run settles exactly once.**

## The defect

X_ITE 16.2.0 reports a world load on two independent channels.

| Channel | Lifetime |
|---|---|
| `addBrowserCallback(this, …)` | one slot, keyed by the component. A newer load replaces it. |
| the promise `loadURL()` returns | private to that one call. |

`startX3D()` listened on the callback only and dropped the `loadURL()` promise.
During rapid navigation the second run replaced the callback slot before the
first world reported `INITIALIZED_EVENT`, so the first run had no way out left:
its `startX3D()` promise stayed pending for the life of the page, and so did
the `loadAndJoinPlace()` awaiting it. `Plaza -> Mall -> Plaza` at a 150 ms gap
stranded three promises.

X_ITE was not silent about it. `X3DBrowser.loadURL` keeps one current
`FileLoader`; a second `loadURL` installs its own, and the superseded load then
rejects with `Loading of X3D file aborted.` — on the promise nobody held.

## The contract

`startX3D()` now owns that promise and carries a settle-once guard. Exactly one
of three things happens per run:

* **resolve** — from `INITIALIZED_EVENT`, unchanged, with the browser.
* **reject** — a real load failure, unchanged, still raised to the caller.
* **quiet cancellation** — resolve with `null`, and *only* when the rejection
  proves both halves: X_ITE's own `Loading of X3D file aborted.` message, and a
  generation a later run has already claimed. `loadAndJoinPlace()`'s existing
  generation guard then stops the obsolete run before any product work.

An abort reported while the run is still the current generation is not a
supersession. It is recorded on `window.ctrUnexpectedWorldLoadAbort` and
re-raised.

Nothing is swallowed globally, and a superseded run never calls
`removeBrowserCallback` — the slot it would clear belongs to the live run.

## Running it

```shell
node qa/promise-settlement/test/check-promise-settlement.js
```

Pure logic, no browser and no stack. The real `startX3D()` and
`supersededWorldLoad()` are cut out of `WorldBrowserPage.vue` and run against a
fake browser that supersedes the way `X3DBrowser.js` does. The last block is a
negative control: the shipped method is rewritten back into the old
dropped-promise shape and must strand the first run.
