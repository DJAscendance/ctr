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

## Re-tested with real clients on the beta stack — 2026-08-29

The earlier run measured `nodemon` in isolation. This one ran the actual beta stack
(`docker compose -f docker-compose.yml -f docker-compose.beta.yml`, `ct-socket` under
`npm start`) with two real Socket.IO clients connected and joined to room 1, and drove ten real
Mall uploads through `POST /api/object/add` as a third account. Server PID was read from
`/proc` inside the container, not inferred.

| attempt | HTTP | server PID before → after | container RestartCount | client disconnects | re-JOIN / ROOM_STATE |
|---|---|---|---|---|---|
| 1–5 | 200 | 33 → 33 | 0 | 0 | none |
| 6 | 200 | 33 → 33 | 0 | 0 | none |
| 7 | 200 | 33 → 33 | 0 | 0 | none |
| 8 | 200 | 33 → 33 | 0 | 0 | none |
| 9 | 200 | 33 → 33 | 0 | 0 | none |
| 10 | 200 | 33 → 33 | 0 | 0 | none |

Liveness was proved rather than assumed: a third client joined room 1 afterwards and **both** A
and B received its `AV:new`, and the new client's `ROOM_STATE` listed 3 presences. A and B were
still connected, still in the room, and still receiving events after ten uploads.

`npm start` was confirmed to be what actually runs — the container's only node process was
`node -r dotenv/config server.js`. Writing a `.js` under `spa/dist` (the control that restarted
the process under the old unscoped watcher) caused **no** restart, and neither did touching
`server.js` itself, because the beta service runs no watcher at all.

**The reported mechanism does not reproduce on the beta stack.**

## But the transport was wrong, and that is worth knowing

Loading the SPA in a real browser showed the Socket.IO WebSocket handshake failing through nginx:

```
WebSocket connection to 'ws://localhost:8001/socket.io/?EIO=4&transport=websocket' failed:
Error during WebSocket handshake: Unexpected response code: 400
```

`docker/nginx/vhost.conf` put `proxy_http_version 1.1` and the `Upgrade`/`Connection` headers on
`location /api` — which proxies plain JSON and never upgrades — and omitted them from
`location /`, which is where Socket.IO actually lives. Every client therefore fell back to HTTP
long-polling. That is not the reported bug, and chat does work over polling, but it is the
transport most exposed to proxy read timeouts and the one most likely to drop a batch of clients
together under load. It is a plausible contributor to a "chat died for everyone" report in a way
the upload path is not, and it would have shipped to the public beta unnoticed.

Fixed in `docker/nginx/vhost.conf`; verified `101 Switching Protocols` through nginx, and the
browser console error is gone.

## Outage recovery, measured

Killing the socket server with two clients connected:

```
06:59:32  A, B  disconnect ("transport close")
06:59:33–36     connect_error ×2 each (backoff)
06:59:40  A     connect (new socket id) → ROOM_STATE room 1
06:59:41  B     connect (new socket id) → ROOM_STATE room 1, presences = 2
06:59:41  A     AV:new for B's new socket
```

Both clients recovered automatically in about eight seconds with a correct authoritative roster.
This exercises the server side of the recovery path and Socket.IO's own reconnection; the SPA's
`ReconnectCoordinator` is covered separately by `spa/tests/`.

Note that this only worked because a `restart: unless-stopped` policy was added during the same
lane. Before that, killing the socket process stopped the container permanently, and it stayed
stopped.

## Re-confirmed on the standalone beta stack — 2026-08-29

Repeated on the rebuilt beta stack (no bind mounts, no watcher, compiled API, one published
port). Two citizens in room 1 on real WebSocket transport, a third uploading five Mall objects
through nginx:

| upload | HTTP | socket PID | RestartCount | disconnects (A / B) | ROOM_STATE (A / B) |
| --- | --- | --- | --- | --- | --- |
| 1 | 200 | 38 | 0 | 0 / 0 | 1 / 1 |
| 2 | 200 | 38 | 0 | 0 / 0 | 1 / 1 |
| 3 | 200 | 38 | 0 | 0 / 0 | 1 / 1 |
| 4 | 200 | 38 | 0 | 0 / 0 | 1 / 1 |
| 5 | 200 | 38 | 0 | 0 / 0 | 1 / 1 |

Both clients received every chat message sent between uploads. One `ROOM_STATE` each for the whole
session means nothing forced a re-JOIN.

The class of failure is now structurally impossible rather than merely absent: the beta socket
container has no source bind mount at all, so nothing an editor or a build does on the host can
reach it. Touching `spa/server.js`, `spa/src/main.ts` and a file under `spa/dist` left the socket
PID and RestartCount unchanged.

## Not established here

Still not tested against a deployed beta host, because there is not one yet. The CTNG origin has
since been identified as `64.44.177.139` (`cybertownng.com`), and it runs an unused Coolify with
no application deployed — so there is no running `ct-socket` out there to confirm.
`172.67.219.16` is a Cloudflare edge address for `admin.cybertownng.com`, not a machine, and
`admin.cybertownng.com` is the Coolify dashboard rather than a CTR host. Confirming what a
deployed `ct-socket` runs is a deployment-lane step, not a QA gap.
