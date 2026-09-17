const express = require("express");
const app = express();
const http = require("http").createServer(app);
const https = require("https");
const io = require("socket.io")(http, {
  pingInterval: 10000,
  pingTimeout: 30000,
});
const path = require("path");
const axios = require("axios");
const package = require("./package.json");
const badwords = require("badwords-list");
const fs = require("fs");
const {
  NOINDEX_DIRECTIVE,
  buildSiteConfig,
  buildRobotsTxt,
  decorateIndexHtml,
} = require("./site-config");
const { cityTimeVrml } = require("./city-time");
const { verifySessionToken } = require("./session-token");
const USERS = new Map();

// Read once at boot. The environment cannot change under a running process, and the built
// index.html cannot change either -- it is baked into the image.
const SITE_CONFIG = buildSiteConfig(process.env);
const ROBOTS_TXT = buildRobotsTxt(SITE_CONFIG);
const INDEX_HTML_PATH = path.join(__dirname, "/dist/index.html");

// Authoritative presence state, keyed by the logical presence key
// `memberId:presenceId` - never by socket id, which is replaceable
// transport metadata. One entry per (member, tab); two tabs on the same
// member get two entries.
const PRESENCE = new Map();

function presenceKey(memberId, presenceId) {
  return `${memberId}:${presenceId}`;
}

function roomPresenceSnapshot(room) {
  const snapshot = [];
  for (const presence of PRESENCE.values()) {
    if (presence.room === room) {
      const { memberId, presenceId, socketId, username, avatar, pos, rot } = presence;
      snapshot.push({ memberId, presenceId, socketId, username, avatar, pos, rot });
    }
  }
  return snapshot;
}

const API_URL = process.env.API_URL || "http://ct-api:3000/api";
/** How long a room's chat access status is cached before re-fetching. */
const CHAT_ACCESS_CACHE_MS = 15000;
const ROOM_CHAT_ACCESS = new Map();

/**
 * Gets whether a room (place) restricts chat to a specific citizen list, and if so, who's
 * on it. Backed by a short-lived cache per room so this isn't hit on every chat message.
 * Fails open (unrestricted) if the API can't be reached, so a network hiccup never locks
 * an entire room out of chat.
 */
async function getChatAccessStatus(room) {
  const cached = ROOM_CHAT_ACCESS.get(room);
  if (cached && Date.now() - cached.fetchedAt < CHAT_ACCESS_CACHE_MS) {
    return cached;
  }

  let status = { restricted: false, allowedUsernames: [] };
  try {
    const response = await axios.get(`${API_URL}/home/chat-access/status/${room}`);
    status = response.data;
  } catch (err) {
    console.error(`Failed to fetch chat access status for room ${room}:`, err.message);
  }

  const entry = { ...status, fetchedAt: Date.now() };
  ROOM_CHAT_ACCESS.set(room, entry);
  return entry;
}

/*
 * THE JAIL.
 *
 * Two rules live here, and both of them have to be server-side or they are not rules:
 *
 *  1. An inmate may not leave the Jail. The client already redirects a jailed citizen to
 *     /place/jail, but that is a courtesy, not a wall -- a JOIN is a socket message and a
 *     socket message can be sent by anything. The JOIN handler refuses the room instead.
 *     That is also the answer for beaming: every beam, Jump Gate, world link and direct
 *     route ends in the same JOIN, so there is one place to enforce and nothing to miss.
 *
 *  2. An inmate's chat does not reach ordinary visitors. Chat is normally a single
 *     `io.to(room).emit`, which is exactly the "general broadcast before filtering" that
 *     cannot be made private afterwards. For inmate speech the recipients are chosen first
 *     and the message is sent only to them.
 *
 * Standing is never taken from the client. It is read from the API against the caller's
 * own token, the same way session revocation and chat access already are, and cached for a
 * few seconds so a busy room does not re-ask on every keystroke. A socket cannot claim to
 * be staff: it can only present the token it authenticated with, and the API answers about
 * that member and no other.
 */
/** How long a citizen's Jail standing is cached before the API is asked again. */
const JAIL_STANDING_CACHE_MS = Number(process.env.JAIL_STANDING_CACHE_MS) || 15000;
/** How long the Jail's place id is cached. */
const JAIL_PLACE_CACHE_MS = 60000;
const JAIL_STANDING = new Map();
let JAIL_PLACE = null;

/**
 * The place id the Jail is served under, or null when it cannot be read.
 *
 * Null means "the Jail could not be identified", and every caller treats that as "this
 * room is not the Jail". That fails towards ordinary public behaviour rather than towards
 * locking the city down when the API is briefly unreachable, which is the same trade
 * getChatAccessStatus makes and for the same reason.
 */
async function getJailPlaceId() {
  if (JAIL_PLACE && Date.now() - JAIL_PLACE.fetchedAt < JAIL_PLACE_CACHE_MS) {
    return JAIL_PLACE.id;
  }
  let id = null;
  try {
    const response = await axios.get(`${API_URL}/place/jail`);
    id = response.data && response.data.place ? response.data.place.id : null;
  } catch (err) {
    console.error("Failed to fetch the Jail place:", err.message);
    return JAIL_PLACE ? JAIL_PLACE.id : null;
  }
  JAIL_PLACE = { id, fetchedAt: Date.now() };
  return id;
}

/**
 * This token holder's Jail standing, as the API reports it.
 *
 * Fails CLOSED for staff and OPEN for inmate status: an error yields
 * `{ inmate: false, staff: false }`, which is an ordinary visitor. That asymmetry is
 * chosen. Guessing "staff" during an outage would hand inmate chat to whoever happened to
 * be in the room; guessing "inmate" would jail the whole city. A visitor is the only
 * answer that is wrong in a way nobody can exploit.
 */
async function getJailStanding(token) {
  if (!token) return { inmate: false, staff: false };
  const cached = JAIL_STANDING.get(token);
  if (cached && Date.now() - cached.fetchedAt < JAIL_STANDING_CACHE_MS) {
    return cached.standing;
  }
  let standing = { inmate: false, staff: false };
  try {
    const response = await axios.get(`${API_URL}/member/jail/standing`, {
      headers: { apitoken: token },
    });
    standing = {
      inmate: !!(response.data && response.data.inmate),
      staff: !!(response.data && response.data.staff),
    };
  } catch (err) {
    console.error("Failed to read jail standing:", err.message);
    return cached ? cached.standing : standing;
  }
  JAIL_STANDING.set(token, { standing, fetchedAt: Date.now() });
  return standing;
}

/*
 * The Outlands gameplay avatar, checked against the database before anybody is
 * told about it.
 *
 * Outlands decides a citizen's side from the avatar file they are wearing, so
 * the side has to reach the other clients in the room. It must NOT reach them
 * by way of the citizen's authentication token: that token is their identity,
 * it is what localStorage holds, and it is the same token in every other place.
 * So the client asks for a side by id, and this is where the id is turned into
 * an avatar - by the API, off the `avatar` table, exactly as the entrance did.
 *
 * A client may therefore lie about which of the four it wants and about nothing
 * else. It cannot name a private avatar, another member's avatar, the Game
 * Master's, or a row that does not exist, and it cannot wear one anywhere but
 * Outlands. That keeps the invariant the JOIN handler already had: a presence's
 * appearance is never taken from client-supplied data.
 */
/** How long the Outlands team rows and the Outlands place id are cached. */
const OUTLANDS_CACHE_MS = 60000;
let OUTLANDS_PLACE = null;
let OUTLANDS_AVATARS = null;

/** The place id Outlands is served under, or null when it cannot be read. */
async function getOutlandsPlaceId() {
  if (OUTLANDS_PLACE && Date.now() - OUTLANDS_PLACE.fetchedAt < OUTLANDS_CACHE_MS) {
    return OUTLANDS_PLACE.id;
  }
  let id = null;
  try {
    const response = await axios.get(`${API_URL}/place/outlands`);
    id = response.data && response.data.place ? response.data.place.id : null;
  } catch (err) {
    console.error("Failed to fetch the Outlands place:", err.message);
    return OUTLANDS_PLACE ? OUTLANDS_PLACE.id : null;
  }
  OUTLANDS_PLACE = { id, fetchedAt: Date.now() };
  return id;
}

/** The four playable team rows, as the API serves them to a citizen. */
async function getOutlandsTeamAvatars(apitoken) {
  if (OUTLANDS_AVATARS && Date.now() - OUTLANDS_AVATARS.fetchedAt < OUTLANDS_CACHE_MS) {
    return OUTLANDS_AVATARS.avatars;
  }
  let avatars = null;
  try {
    const response = await axios.get(`${API_URL}/avatar/outlands`, { headers: { apitoken } });
    avatars = response.data ? response.data.avatars : null;
  } catch (err) {
    console.error("Failed to fetch the Outlands team avatars:", err.message);
    return OUTLANDS_AVATARS ? OUTLANDS_AVATARS.avatars : null;
  }
  if (!Array.isArray(avatars)) return null;
  OUTLANDS_AVATARS = { avatars, fetchedAt: Date.now() };
  return avatars;
}

/*
 * Whether a value a client put in a JOIN payload is usable as a row id.
 *
 * A socket payload is structured data, so the type the client chose arrives
 * intact and is evidence. Coercing it away is what let a malformed value in:
 * `Number([13])` is `13` and `Number("13")` is `13`, so the comparison this
 * guard replaces answered an ARRAY with a real Outlands team avatar. Only a
 * primitive number that is a safe integer above zero is an id here; an array,
 * an object, a numeric string, a boolean, a fraction and a magnitude past
 * 2^53 - 1 are all refused as they arrived, with no second guess at what the
 * client meant. `Number.isSafeInteger` covers NaN, both infinities, fractions
 * and unsafe magnitudes on its own, and accepts `13.0`, which IS `13`.
 *
 * The API keeps the same rule for its own HTTP boundary in
 * `api/src/libs/client-id.ts`, named `isClientId` there too. The two servers
 * are separate packages and cannot share a module, so they share a name and a
 * test table instead. Change one and change the other.
 */
function isClientId(raw) {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0;
}

/*
 * The avatar a presence in `room` should be shown with.
 *
 * Fails CLOSED, in both directions: an id that is not one of the four playable
 * rows, a room that is not Outlands, or an API that cannot be reached all give
 * back the citizen's own avatar out of their verified token. A member is never
 * left invisible and never silently dressed as something the database did not
 * hand over.
 */
async function resolvePresenceAvatar(tokenData, room, outlandsAvatarId, apitoken) {
  // Covers "no override asked for" (null / undefined / absent) and "the override
  // is not an id at all" with one answer: the citizen's own verified avatar.
  if (!isClientId(outlandsAvatarId)) return tokenData.avatar;
  const outlandsPlaceId = await getOutlandsPlaceId();
  if (outlandsPlaceId === null || `${outlandsPlaceId}` !== `${room}`) return tokenData.avatar;
  const avatars = await getOutlandsTeamAvatars(apitoken);
  if (!avatars) return tokenData.avatar;
  const chosen = avatars.find(avatar => avatar.id === outlandsAvatarId);
  return chosen || tokenData.avatar;
}

function webhookMessage(from, message) {
  return;
  if (!process.env.CHAT_WEBHOOK_URL) return;
  const body = JSON.stringify({
    username: from,
    content: message,
  });
  const req = https.request(process.env.CHAT_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  });
  req.write(body);
  req.end();
}

/*
 * The token check, now the same contract the API applies.
 *
 * Two things changed and both matter. The algorithm is pinned, so a token can no longer
 * nominate how it will be examined. And an expiry claim is required, so the permanent
 * sessions minted before this release stop connecting - jwt.verify on its own reads a
 * missing `exp` as "valid forever", which is the defect, not a compatibility feature.
 *
 * This is still only half the job: it answers "was this token issued to somebody", never
 * "is that somebody still allowed in". A ban handed down after the token was signed changes
 * nothing about the signature. isSessionRevoked below asks the other half.
 */
function validJwt(token) {
  try {
    return verifySessionToken(token, process.env.JWT_SECRET);
  } catch (err) {
    return false;
  }
}

/*
 * How long a citizen's standing is cached before the API is asked again.
 *
 * This is the delay between an administrator pressing Ban and a connected citizen losing
 * their session, and it is a cost-of-lookup trade rather than a security one: without it a
 * busy room re-asks the API about every member on every sweep. Fifteen seconds is short
 * enough that a ban is felt immediately by anyone watching, and the test stack turns it down
 * so a suite does not have to sit through it.
 */
const SESSION_STANDING_CACHE_MS = Number(process.env.SESSION_STANDING_CACHE_MS) || 15000;
/** How often every connected socket is re-checked against current standing. */
const SESSION_SWEEP_MS = Number(process.env.SESSION_SWEEP_MS) || 30000;
const SESSION_STANDING = new Map();

/*
 * Whether this session has been revoked - a ban applied after the token was signed.
 *
 * The socket server has no database, so it asks the one process that does, exactly as it
 * already does for chat access and the Outlands roster. GET /api/member/session/status is
 * behind the API's own session-revocation guard, so the ANSWER IS THE STATUS CODE: 200 means
 * the guard let the request through and the session is good, 403 means the guard refused it.
 * No ban reason crosses this boundary, and none is wanted here.
 *
 * Fails OPEN on a network or server error, and says so plainly. That is the weaker of the
 * two choices and it is deliberate: the alternative disconnects every citizen in the city
 * the moment the API restarts, turning a routine deploy into a mass logout. The window it
 * leaves is one sweep wide for a citizen banned during an API outage, and it closes by
 * itself as soon as the API answers again. A cached verdict is reused rather than guessed
 * when one is available, so a "revoked" answer already learned is never softened by a later
 * outage.
 */
async function isSessionRevoked(token) {
  const cached = SESSION_STANDING.get(token);
  if (cached && Date.now() - cached.fetchedAt < SESSION_STANDING_CACHE_MS) {
    return cached.revoked;
  }
  let revoked;
  try {
    await axios.get(`${API_URL}/member/session/status`, { headers: { apitoken: token } });
    revoked = false;
  } catch (err) {
    const status = err.response ? err.response.status : null;
    if (status === 403) {
      revoked = true;
    } else {
      console.error("Failed to read session standing:", err.message);
      return cached ? cached.revoked : false;
    }
  }
  SESSION_STANDING.set(token, { revoked, fetchedAt: Date.now() });
  return revoked;
}

/*
 * Ends a socket's authenticated work.
 *
 * The client is told WHY before the socket goes, so it can clear its stored session and show
 * the ban notice instead of silently trying to reconnect with a token that will be refused
 * every time. `disconnect(true)` closes the underlying connection rather than only the
 * namespace, so nothing survives to keep emitting.
 */
function revokeSocket(socket, reason) {
  socket.emit("SESSION:revoked", { reason });
  socket.disconnect(true);
}

// The HTTP half of the search-engine policy, and the only half a crawler is guaranteed to
// see: a header applies to every response including the static bundle, an image and a
// redirect, none of which can carry a <meta> tag. Registered before express.static so it
// covers those too. Costs nothing and does nothing when the deployment is indexable.
if (SITE_CONFIG.noindex) {
  app.use((req, res, next) => {
    res.setHeader("X-Robots-Tag", NOINDEX_DIRECTIVE);
    next();
  });
}

// Served explicitly rather than left to the catch-all, which would answer with index.html:
// an HTML page returned for /robots.txt is not a crawl policy, it is a 200 that says
// nothing. This is a request to well-behaved crawlers and NOT an access control - anything
// reachable without a login stays reachable to anyone who ignores it.
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(ROBOTS_TXT);
});

// City Time for the Mall's own clocks. The shape, the timezone and the reason
// the answer is City Time minus two hours all live in spa/city-time.js.
//
// No caching: the point is that a citizen who re-enters the Mall gets the time
// now, not the time the first visitor saw.
app.get("/citytime.wrl", (req, res) => {
  res
    .type("model/vrml")
    .set("Cache-Control", "no-store")
    .send(cityTimeVrml(new Date()));
});

// `index: false` matters. express.static answers a directory request by serving the
// directory's index.html straight from disk, so with the default it -- not the catch-all
// below -- handled "/", the single most-requested path on the site. The site's own front
// page would then be the ONLY page served without the deployment's identity stamped into
// it: no robots meta tag, no injected config, no label in the title. Static assets are
// unaffected; only the implicit index lookup is turned off.
app.use(express.static("dist", { index: false }));

// serves the SPA for any non-static, non-API path so direct links to client-side
// routes (e.g. /beta) don't 404 before Vue Router ever loads. The path is rewritten into
// the hash client-side, after this exact path has already served the app.
//
// The HTML is decorated rather than sent straight from disk so the deployment's own
// identity - beta or not, indexable or not, which bug tracker, which bot-challenge site key
// - is present in the first bytes the browser and any crawler receive, instead of being
// discovered by the SPA after mount. Read and transformed once, then held: this is the
// hottest route on the server.
let indexHtml = null;
app.get("*", (req, res) => {
  if (indexHtml === null) {
    indexHtml = decorateIndexHtml(fs.readFileSync(INDEX_HTML_PATH, "utf8"), SITE_CONFIG);
  }
  res.type("html").send(indexHtml);
});

/**
 * Delivers one chat message when the speaker is an inmate in the Jail.
 *
 * Returns true when it has taken responsibility for the message, false when the ordinary
 * room broadcast should happen instead. The caller must respect that: sending anyway is
 * the leak.
 *
 * Who receives it:
 *
 *  * the SPEAKER, always, so their own line appears in their own chat exactly as it does
 *    everywhere else in the city. Chat is unusable otherwise.
 *  * JAIL AND SECURITY STAFF, which is the requirement -- supervising the Jail means
 *    hearing it. Their own replies are ordinary public chat and reach the inmate through
 *    the normal broadcast, so a conversation still works in both directions without a
 *    second messaging system.
 *  * OTHER INMATES. The historical record does not settle whether one prisoner could hear
 *    another -- the visitor and prisoner worlds ship identical geometry and differ only in
 *    where the viewer is held, which proves one shared Jail and settles nothing about the
 *    chat server behind it. Rather than invent a policy, this preserves what CTR does
 *    today: a citizen in the room hears the room. Nothing about that choice weakens the
 *    rule that actually matters, which is the visitor.
 *
 * Everyone else in the room -- ordinary visitors -- receives nothing. Not a redacted
 * message, not a placeholder: no event.
 */
async function deliverJailChat(senderSocket, user, payload) {
  const jailPlaceId = await getJailPlaceId();
  if (jailPlaceId === null || `${user.room}` !== `${jailPlaceId}`) return false;

  const senderStanding = await getJailStanding(user.token);
  if (!senderStanding.inmate) return false;

  const clientsInRoom = io.sockets.adapter.rooms.get(user.room);
  if (!clientsInRoom) {
    senderSocket.emit("CHAT", payload);
    return true;
  }

  for (const clientId of clientsInRoom) {
    const clientSocket = io.sockets.sockets.get(clientId);
    if (!clientSocket) continue;
    if (clientId === senderSocket.id) {
      clientSocket.emit("CHAT", payload);
      continue;
    }
    const recipient = USERS.get(clientSocket);
    if (!recipient || !recipient.token) continue;
    const standing = await getJailStanding(recipient.token);
    if (standing.staff || standing.inmate) {
      clientSocket.emit("CHAT", payload);
    }
  }
  return true;
}

io.on("connection", async function(socket) {
  console.log("a user connected");
  webhookMessage("System", `${socket.id} connected.`);

  //setup socket's default AVATAR map reference
  USERS.set(socket, {
    pos: [0, 0, 0],
    rot: [0, 1, 0, 0],
  });

  // inform the client about the server's version number
  socket.emit("VERSION", { version: package.version });

  socket.on("JOIN", async (data) => {
    // Never throw on a malformed or missing payload - a bad client must
    // not be able to crash the socket handler.
    if (!data || typeof data !== "object") {
      socket.emit("JOIN:error", { room: undefined, joinId: undefined, reason: "invalid_payload" });
      return;
    }
    const { room, joinId } = data;
    const tokenData = validJwt(data.token);
    if (!tokenData) {
      console.error("invalid token!");
      socket.emit("JOIN:error", { room, joinId, reason: "invalid_token" });
      return;
    }
    // A signature proves who was issued this token, never that they are still welcome.
    // Asked before any presence is recorded, so a banned citizen never enters the room and
    // is never announced to the people in it - including on a reconnect, which is an
    // ordinary JOIN and is refused by this same line.
    if (await isSessionRevoked(data.token)) {
      console.error("revoked session attempted to JOIN");
      socket.emit("JOIN:error", { room, joinId, reason: "session_revoked" });
      return;
    }
    // The wall around the Jail. Asked before any presence is recorded, so a jailed citizen
    // who beams, follows a world link, edits the URL or hand-crafts a JOIN never enters the
    // room and is never announced in it. There is no allowance for "the client said it was
    // fine": the room id is compared against the Jail's own place id, read from the API.
    const jailPlaceId = await getJailPlaceId();
    if (jailPlaceId !== null && `${room}` !== `${jailPlaceId}`) {
      const standing = await getJailStanding(data.token);
      if (standing.inmate) {
        console.error(`jailed member ${tokenData.id} attempted to JOIN room ${room}`);
        socket.emit("JOIN:error", { room, joinId, reason: "jailed" });
        return;
      }
    }
    const presenceId = data.presenceId;
    const MAX_ID_LENGTH = 128;
    if (
      typeof presenceId !== "string" ||
            presenceId.length === 0 ||
            presenceId.length > MAX_ID_LENGTH
    ) {
      console.error("JOIN has invalid presenceId!");
      socket.emit("JOIN:error", { room, joinId, reason: "invalid_presence_id" });
      return;
    }
    // The joinId correlates this attempt with its authoritative response so
    // a stale/superseded reply can never settle a newer client attempt.
    if (typeof joinId !== "string" || joinId.length === 0 || joinId.length > MAX_ID_LENGTH) {
      console.error("JOIN has invalid joinId!");
      // Echo the client's raw joinId back (not undefined) so the client can
      // still correlate and fail this attempt fast instead of timing out.
      socket.emit("JOIN:error", { room, joinId: data.joinId, reason: "invalid_join_id" });
      return;
    }
    if (room === undefined || room === null || `${room}`.length === 0) {
      socket.emit("JOIN:error", { room, joinId, reason: "invalid_room" });
      return;
    }

    // memberId, username, and avatar are derived only from the verified
    // JWT - never from client-supplied data - so presenceId can be
    // freely client-chosen without letting a client impersonate another
    // account's identity.
    const memberId = tokenData.id;
    const key = presenceKey(memberId, presenceId);
    const user = USERS.get(socket);

    // (A) Tear down a DIFFERENT logical presence this socket previously
    // owned (e.g. the same socket re-JOINing with a different presenceId).
    // Only if this socket still owns that record - never clobber a presence
    // a newer socket now owns.
    if (user.presenceKey && user.presenceKey !== key) {
      const oldOwned = PRESENCE.get(user.presenceKey);
      if (oldOwned && oldOwned.socketId === socket.id) {
        socket.to(oldOwned.room).emit("AV:del", {
          id: socket.id,
          room: oldOwned.room,
          memberId: oldOwned.memberId,
          presenceId: oldOwned.presenceId,
          username: oldOwned.username,
        });
        PRESENCE.delete(user.presenceKey);
      }
    }

    // (B) The target logical presence (key). If a record for it already
    // exists in a DIFFERENT room, the presence is relocating: announce its
    // departure from the old room and drop the stale record so it re-enters
    // the new room as a fresh presence. If it exists in the SAME room, this
    // is a rebind (reconnect / redundant JOIN) - preserve its transform so a
    // restarted socket server (or a reconnecting client) doesn't snap the
    // avatar back to the origin, and don't re-announce it.
    //
    // A presence that has never reported a world-space transform is stored
    // with NO pos/rot at all, rather than a fabricated origin. "No valid
    // position yet" and "standing at [0,0,0]" are different facts, and only
    // the first one is true here: the client has not yet bound a viewpoint,
    // and where it will appear is decided by the world's own Viewpoint, which
    // this server knows nothing about. Writing [0,0,0] turns the unknown into
    // a confident lie that every consumer then believes - a remote citizen
    // rendered at the world origin, a collision wrapper parked in a doorway,
    // and an Outlands ray that "hits" a member who is not there. Absent stays
    // absent until a real AV transform arrives; `[0,0,0]` sent as a genuine
    // authored position is stored normally, because then it is true.
    const existingForKey = PRESENCE.get(key);
    let pos;
    let rot;
    if (existingForKey) {
      if (`${existingForKey.room}` === `${room}`) {
        pos = existingForKey.pos;
        rot = existingForKey.rot;
      } else {
        socket.to(existingForKey.room).emit("AV:del", {
          id: existingForKey.socketId,
          room: existingForKey.room,
          memberId: existingForKey.memberId,
          presenceId: existingForKey.presenceId,
          username: existingForKey.username,
        });
        PRESENCE.delete(key);
      }
    }

    // (C) This socket's own room membership: leave the prior room if the
    // socket is moving to a different one.
    if (user.room && `${user.room}` !== `${room}`) {
      socket.leave(user.room);
    }

    const isNewPresence = !PRESENCE.has(key);

    /*
     * Identity still comes only from the verified token. The one thing a client
     * may ask to change is the avatar it is PLAYING as, and only inside
     * Outlands - resolvePresenceAvatar validates that against the database and
     * falls back to the token's own avatar for anything else.
     */
    const avatar = await resolvePresenceAvatar(
      tokenData, room, data.outlandsAvatarId, data.token,
    );

    user.avatar = avatar;
    user.room = room;
    user.username = tokenData.username;
    user.presenceKey = key;
    // Held so the sweep below can re-ask about a session that is ALREADY connected. The
    // client sends this string on every JOIN anyway; keeping the latest one is what lets a
    // ban reach a citizen who is standing still and never sends another.
    user.token = data.token;

    PRESENCE.set(key, {
      memberId,
      presenceId,
      socketId: socket.id, // transport metadata - rebinds to the current socket
      username: tokenData.username,
      avatar,
      pos,
      rot,
      room,
    });

    socket.join(room);

    // Give the joining client one authoritative snapshot of everyone
    // currently in the room (including itself) instead of an ad-hoc
    // AV:new/AV replay loop. Chat and the X_ITE avatar layer reconcile
    // against this by logical presence key, independent of readiness. The
    // joinId is echoed so the client can correlate it with its attempt.
    socket.emit("ROOM_STATE", { room, joinId, presences: roomPresenceSnapshot(room) });

    // Only announce a genuinely new presence - a rebind/redundant JOIN for
    // the same room/presence must not spam peers with "someone joined".
    if (isNewPresence) {
      socket.to(room).emit("AV:new", {
        id: socket.id,
        room,
        memberId,
        presenceId,
        avatar,
        username: tokenData.username,
      });
    }

    // Let everyone in the room (including the joining socket) know whether it's
    // chat-restricted, and if so who's allowed to chat. This is awaited last, after
    // presence and ROOM_STATE have already been settled, so a slow or failing API
    // lookup can never delay or reorder the authoritative presence handshake.
    const chatAccess = await getChatAccessStatus(room);
    io.to(room).emit("CHAT_ACCESS", {
      restricted: chatAccess.restricted,
      allowedUsernames: chatAccess.allowedUsernames,
    });

    console.log(`User '${tokenData.username}' entered room ${room}`);
    webhookMessage(
      "System",
      `${tokenData.username} entered room \`${room}\``,
    );
  });

  //handle avatar related calls.
  socket.on("AV", function(msg) {
    if (!msg || typeof msg !== "object") return;
    const user = USERS.get(socket);
    if (!user || !user.room) return;
    const presence = user.presenceKey ? PRESENCE.get(user.presenceKey) : null;
    // Only the socket that currently owns the logical presence may move or
    // relay it - a stale/replaced socket must not broadcast under this key.
    if (!presence || presence.socketId !== socket.id) return;
    // Reject AV tagged for a room other than the socket's current
    // authoritative room (e.g. an offline-buffered event flushed after a
    // room change) so it can't mutate the new room.
    if (msg.room !== undefined && `${msg.room}` !== `${user.room}`) return;
    msg.id = socket.id;
    msg.room = user.room; // authoritative room tag for the broadcast
    msg.memberId = presence.memberId;
    msg.presenceId = presence.presenceId;
    if (msg.pos) presence.pos = msg.pos;
    if (msg.rot) presence.rot = msg.rot;
    socket.to(user.room).emit("AV", msg);
    if (msg.pos) user.pos = msg.pos;
    if (msg.rot) user.rot = msg.rot;
  });

  //handle shared events
  socket.on("SE", function(msg) {
    console.log(msg);
    io.to(USERS.get(socket).room).emit("SE", msg);
  });

  socket.on("update-object", function(object) {
    socket.broadcast.emit("update-object", {
      obj_id: object.obj_id,
      place_id: object.place_id,
      member_username: object.member_username,
      buyer_username: object.buyer_username,
    });
  });

  //handle shared events
  socket.on("SO", function(msg) {
    console.log(msg);
    const user = USERS.get(socket);

    if (user?.room) {
      const clientsInRoom = io.sockets.adapter.rooms.get(user.room);
      for (const clientId of clientsInRoom) {
        if (clientId === socket.id) continue;
        const clientSocket = io.sockets.sockets.get(clientId);
        const user = USERS.get(clientSocket);
        if (user) {
          clientSocket.emit("SO", msg);
        }
      }
    }
  });

  //handle notifications
  socket.on("security-alert", function(data) {
    socket.broadcast.emit("new-security-alert", {
      data:data,
    });
  });

  //handle community moderation
  socket.on("moderation", function(data) {
    socket.broadcast.emit("moderation_event", {
      data:data,
    });
  });

  //handle chat messages
  socket.on("CHAT", async (chatData) => {
    console.log("chat message...");
    if (!chatData || !chatData.msg || typeof chatData.msg !== "string")
      return;
    const user = USERS.get(socket);
    if (!user) return;
    // Checked ahead of the word filter and the room's own chat list: a banned citizen must
    // not be able to speak into a room even once, and this is the loudest authenticated
    // action the socket offers. The sweep catches them within SESSION_SWEEP_MS regardless;
    // this closes the gap between the ban and the next sweep for the one action that would
    // reach every other citizen present.
    if (user.token && await isSessionRevoked(user.token)) {
      revokeSocket(socket, "session_revoked");
      return;
    }
    const bannedwords = badwords.regex;
    if(chatData.msg.match(bannedwords)){
      console.log(`${user.username} used a banned word in ${user.room}`);
      return;
    } else {
      if (user?.room) {
        const chatAccess = await getChatAccessStatus(user.room);
        if (
          chatAccess.restricted &&
                    !chatAccess.allowedUsernames.includes(user.username)
        ) {
          console.log(`${user.username} is muted in room ${user.room}`);
          socket.emit("CHAT", {
            type: "system",
            msg: "You don't have chat access at this home.",
          });
          return;
        }

        const payload = {
          username: user.username,
          id: chatData.msg_id,
          msg: chatData.msg,
          role: chatData.role,
          new: true,
          exp: chatData.exp,
        };

        // Inmate speech never touches the room broadcast. deliverJailChat picks its
        // recipients first and emits to each of them; if it handled the message there is
        // no second send, and an ordinary visitor's socket is never written to at all.
        if (await deliverJailChat(socket, user, payload)) return;

        io.to(user.room).emit("CHAT", payload);
      }
    }
  });

  socket.on("unsubscribe", (data) => {
    const user = USERS.get(socket);
    if (!user?.room) {
      // Nothing to leave - e.g. unsubscribe called without a prior
      // successful JOIN.
      return;
    }
    // The client's teardown is room-scoped (`unsubscribe { room }`), so honour
    // that scope. SocketManager.leaveRoom emits this unconditionally while its
    // intent-side guard (clearRoomIntent) is room-checked, so during a rapid
    // A -> B navigation a late teardown for A can still arrive after the socket
    // has already joined B. Applying it room-blind would remove the member from
    // B while the client still believes it is present there: no AV:del reaches
    // the departed member, peers stop seeing them, and the member sees a room
    // they are no longer in. A teardown for a room this socket is not currently
    // in is therefore ignored. A payload-less unsubscribe keeps the old
    // behaviour, so no existing caller changes meaning.
    if (data && data.room !== undefined && `${data.room}` !== `${user.room}`) {
      return;
    }
    const room = user.room;
    const presence = user.presenceKey ? PRESENCE.get(user.presenceKey) : null;
    socket.leave(room);
    // Only announce the departure and delete the record if this socket
    // still owns the logical presence - a stale/replaced socket must not
    // remove or announce a presence a newer socket now owns.
    if (presence && presence.socketId === socket.id) {
      socket.to(room).emit("AV:del", {
        id: socket.id,
        room,
        memberId: presence.memberId,
        presenceId: presence.presenceId,
        username: user.username,
      });
      PRESENCE.delete(user.presenceKey);
    }
    // Clear so a later disconnect (without a rejoin in between) sees
    // "no room" instead of stale room/presenceKey and re-announcing a
    // departure that was already sent above.
    user.room = null;
    user.presenceKey = null;

    console.log(`User '${user.username}' left ${room}`);
    webhookMessage("System", `${user.username} left ${room}`);
  });

  //handle disconnection from the socket.
  socket.on("disconnect", function() {
    const user = USERS.get(socket);
    const presence = user?.presenceKey ? PRESENCE.get(user.presenceKey) : null;
    // Announce the departure and remove the record only if this socket was
    // still in a room AND still owns the logical presence. Guarding BOTH on
    // socketId (not just the delete) means a stale/delayed disconnect from
    // an old socket can neither delete nor broadcast AV:del for a presence a
    // newer reconnected socket now owns.
    if (user?.room && presence && presence.socketId === socket.id) {
      io.to(user.room).emit("AV:del", {
        id: socket.id,
        room: user.room,
        memberId: presence.memberId,
        presenceId: presence.presenceId,
        username: user?.username,
      });
      PRESENCE.delete(user.presenceKey);
    }
    USERS.delete(socket);
    console.log(`User '${user?.username}' disconnected`);
  });
});

/*
 * The part that actually ends a session already in progress.
 *
 * Guarding JOIN and CHAT is not enough on its own, and stopping there would be the quiet
 * downgrade of this fix to "blocked on reconnect". A citizen who is simply STANDING in a
 * room sends neither: they emit AV transforms, they receive everyone else's, and they stay
 * visible and present in the world indefinitely. A ban has to reach them where they are.
 *
 * So every connected socket that has completed a JOIN is re-checked on a timer, against the
 * two things that can change under it - the token's own expiry, and the citizen's standing.
 * Either failing ends the connection through the ordinary disconnect path, so presence is
 * torn down and AV:del is announced to the room exactly as it is for someone who left.
 *
 * Standing answers are cached for SESSION_STANDING_CACHE_MS and keyed by token, so a room of
 * fifty citizens is not fifty API calls per sweep - it is one per distinct session, and only
 * when its cached answer has gone stale.
 *
 * `unref` so this timer never holds the process open by itself.
 */
const sessionSweep = setInterval(async () => {
  for (const [socket, user] of USERS) {
    if (!user || !user.token || !user.room) continue;
    if (!socket.connected) continue;
    if (!validJwt(user.token)) {
      revokeSocket(socket, "session_expired");
      continue;
    }
    try {
      if (await isSessionRevoked(user.token)) revokeSocket(socket, "session_revoked");
    } catch (err) {
      // isSessionRevoked already fails open and logs; this only stops one bad socket from
      // ending the sweep for everybody else in the city.
      console.error("Session sweep failed for one socket:", err.message);
    }
  }
}, SESSION_SWEEP_MS);
sessionSweep.unref();

const port = process.env.WEBSOCKET_PORT || 8000;
http.listen(port);
console.log(`listening on port:${port}`);
