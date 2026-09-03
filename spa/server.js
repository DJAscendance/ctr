const express = require("express");
const app = express();
const http = require("http").createServer(app);
const https = require("https");
const io = require("socket.io")(http, {
    pingInterval: 10000,
    pingTimeout: 30000
    });
const path = require("path");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const package = require("./package.json");
const badwords = require("badwords-list");
const USERS = new Map();

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

function validJwt(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return false;
    }
}

app.use(express.static("dist"));

// serves the SPA for any non-static, non-API path so direct links to client-side
// routes (e.g. /beta-register) don't 404 before Vue Router ever loads
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "/dist/index.html"));
});

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
        const existingForKey = PRESENCE.get(key);
        let pos = [0, 0, 0];
        let rot = [0, 1, 0, 0];
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

        user.avatar = tokenData.avatar;
        user.room = room;
        user.username = tokenData.username;
        user.presenceKey = key;

        PRESENCE.set(key, {
            memberId,
            presenceId,
            socketId: socket.id, // transport metadata - rebinds to the current socket
            username: tokenData.username,
            avatar: tokenData.avatar,
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
                avatar: tokenData.avatar,
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
            `${tokenData.username} entered room \`${room}\``
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

    socket.on('update-object', function(object) {
        socket.broadcast.emit('update-object', {
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
    socket.on('security-alert', function(data) {
        socket.broadcast.emit('new-security-alert', {
            data:data,
        });
    });

    //handle community moderation
    socket.on('moderation', function(data) {
        socket.broadcast.emit('moderation_event', {
            data:data,
        });
    });

    //handle chat messages
    socket.on("CHAT", async (chatData) => {
        console.log("chat message...");
        if (!chatData || !chatData.msg || typeof chatData.msg !== "string")
            return;
        const user = USERS.get(socket);
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

                io.to(user.room).emit("CHAT", {
                    username: user.username,
                    id: chatData.msg_id,
                    msg: chatData.msg,
                    role: chatData.role,
                    new: true,
                    exp: chatData.exp,
                });
            }
        }
    });

    socket.on("unsubscribe", () => {
        const user = USERS.get(socket);
        if (!user?.room) {
            // Nothing to leave - e.g. unsubscribe called without a prior
            // successful JOIN.
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

const port = process.env.WEBSOCKET_PORT || 8000;
http.listen(port);
console.log(`listening on port:${port}`);
