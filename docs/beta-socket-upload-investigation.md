# Does a Mall upload disconnect Chat for everybody?

**Answer: no — not by the mechanism that was suspected, and not by any upload path this
codebase has.** But the socket service *was* one `.js` write away from exactly that failure,
for a different reason, and that has been fixed.

Investigated 2026-08-29 against `beta-integration-2026-08`.

---

## What was suspected

Two hypotheses were on the table.

**A. X_ITE / presence coupling.** On `master`, `WorldBrowserPage.joinPlace()` — the only thing
that emits `JOIN`, and therefore the only thing that puts a client in the chat room — runs
*after* `await this.startX3D()`. Chat presence is downstream of the VRML scene loading.

**B. `nodemon` restarts the socket process when an uploaded file lands.** `docker-compose.yml`
runs `ct-socket` as `npm run dev-server` → `nodemon … server.js`, and mounts `./spa` into the
container. Mall objects are written into `spa/assets/object/`, inside that mount. If nodemon
watched them, one upload would restart the process and drop every connected client at once —
which looks exactly like "Chat died for everyone".

## What was measured

`nodemon --dump` with the repository's own config (there was no `nodemon.json`):

```
watching path(s): *.*
watching extensions: js,mjs,json
```

So the whole `spa/` tree was watched, but only for `js`, `mjs` and `json`.

Then, running the real `dev-server` command against the real asset tree:

| # | action | restarts | server PID |
|---|---|---|---|
| baseline | boot | – | 231298 |
| 1 | simulated Mall upload: `mkdir spa/assets/object/<dir>`, write `.wrl`, `.jpg`, `.gif` | **0** | 231298 (unchanged) |
| 2 | write one `.js` under `spa/dist/js/` (what an SPA rebuild does) | **1** | 231522 (**restarted**) |

Test 2 is the control: it proves the watcher was live and would have restarted the process had
the upload matched.

## Why an upload can never match

Every runtime write this codebase performs is extension-restricted at the controller, and none
of the permitted extensions is watched:

| path | writer | permitted extensions |
|---|---|---|
| `spa/assets/object/<dir>/` | `ObjectService.uploadObjectFiles` | `.wrl`, thumbnail `.jpg`/`.jpeg`, texture `.jpg`/`.jpeg`/`.gif`/`.png` |
| `spa/assets/avatars/<dir>/` | `AvatarService.uploadAvatarFiles` | same set |
| `spa/assets/homes-uploads/` | `HomeService.publishApprovedImage` | `.webp` (and a `.tmp-…webp` staging file) |
| `api/private-uploads/homes-pending/` | `HomeService` | `.webp`, and outside the watched tree entirely |

`fs.mkdirSync` of a new upload directory does not restart it either — test 1 created one.

**Hypothesis B is disproven for uploads.**

## The real defect it uncovered

The watcher was scoped to the entire `spa/` tree, which includes `spa/dist/**` — the SPA build
output. Any SPA rebuild, or any stray `.js`/`.json` written anywhere under `spa/`, restarted the
chat server and disconnected every client. On a public beta that is a live outage triggered by a
routine action, and it is the same visible symptom the report described.

Fixed in two places:

- **`spa/nodemon.json`** — the development watcher now watches `server.js` and `package.json`
  only. Verified: the upload simulation still causes 0 restarts, the `spa/dist` write now causes
  0 restarts (previously 1), and editing `server.js` still restarts.
- **`spa/package.json` → `npm start`** (`node -r dotenv/config server.js`) and
  **`docker-compose.beta.yml`**, which runs `ct-socket` under it. A publicly reachable
  environment runs no watcher at all.

## Hypothesis A is real, and is fixed separately

`joinPlace()` being gated behind `startX3D()` is genuine and is what upstream #412 was written
to remove. It does not need an upload to bite: any slow or failed world load leaves a client
connected to the socket but absent from the chat room. That coupling is removed by the
`#412` presence foundation and fork `#5` reconnect/resync, both integrated on this branch —
`JOIN` is now driven by `ReconnectCoordinator` against a logical presence key, and X_ITE
consumes presence rather than owning it.

Both fixes belong in beta. Uploads should not cause an outage (watcher fix); and when an outage
does happen for any other reason, clients should recover (presence + reconnect).

## Not established here

This was reproduced against the repository's configuration, not against the deployed beta host —
SSH to that host was unavailable in this lane. Confirming that the deployed `ct-socket` container
is in fact running `npm run dev-server`, and re-running tests 1 and 2 there, is still outstanding.
