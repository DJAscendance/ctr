# Scene-cache regression tests

These guard `spa/src/libs/x_ite_mods/scene_cache.js`, the patch that stopped the
Mall returning an empty world on a second in-app visit.

The defect lived in X_ITE's one process-wide `FileLoader.sceneCache`. A loader
inserts its cache entry *before* it fetches, and an EXTERNPROTO with a url list
abandons that entry when its first url fails: the loader walks to the next url,
which installs a new entry and overwrites `this.resolve`. The first entry stays
pending forever, and the next scene that asks for the same url awaits it and
never finishes loading.

`lib/fake_file_loader.js` reproduces exactly that contract, copied from
`FileLoader.loadDocumentAsync` / `loadDocumentError` in X_ITE 15.1.12. The tests
load the real patch file into it, so they need no browser, no network and no
X_ITE build, and they do not depend on any temporary QA harness.

One test deliberately runs the fake **unpatched** and requires the second load to
stall, so the suite is proven able to fail. Every wait is bounded at 200 ms.

Run it on the pinned Node 14:

```shell
node qa/scene-cache/test/run.js
```

## Live check

`tools/check-mall-return.js` is the browser counterpart. It walks
Mall → shop → Mall and Mall → Plaza → Mall inside **one** page session and
requires every Mall load to report `rootNodes > 0`.

Navigating by `location.hash` matters: a `page.goto` builds a fresh X_ITE
runtime with an empty scene cache, so it cannot reproduce the defect at all.

It needs the QA frontend described in `qa/placement/README.md`:

```shell
NODE_PATH=$(npm root -g)/@playwright/cli/node_modules \
  node qa/scene-cache/tools/check-mall-return.js
```
