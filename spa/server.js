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

// serves the SPA
app.get("/", (req, res) => {
    console.log(req);
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

    socket.on("JOIN", (data) => {
        const tokenData = validJwt(data.token);
        if (!tokenData) {
            console.error("invalid token!");
            socket.emit("JOIN:error", { reason: "invalid_token" });
            return;
        }
        const presenceId = data.presenceId;
        const MAX_PRESENCE_ID_LENGTH = 128;
        if (
            typeof presenceId !== "string" ||
            presenceId.length === 0 ||
            presenceId.length > MAX_PRESENCE_ID_LENGTH
        ) {
            console.error("JOIN has invalid presenceId!");
            socket.emit("JOIN:error", { reason: "invalid_presence_id" });
            return;
        }

        const { room } = data;
        // memberId, username, and avatar are derived only from the verified
        // JWT - never from client-supplied data - so presenceId can be
        // freely client-chosen without letting a client impersonate another
        // account's identity.
        const memberId = tokenData.id;
        const key = presenceKey(memberId, presenceId);
        const defaultPos = [0, 0, 0];
        const defaultRot = [0, 1, 0, 0];
        const user = USERS.get(socket);

        // Defensively leave any previously tracked room for this socket
        // before joining the new one - guarantees one room per socket even
        // if a client ever calls JOIN without a preceding unsubscribe.
        if (user.room && user.room !== room) {
            const oldPresence = user.presenceKey ? PRESENCE.get(user.presenceKey) : null;
            socket.leave(user.room);
            socket.to(user.room).emit("AV:del", {
                id: socket.id,
                memberId: oldPresence?.memberId,
                presenceId: oldPresence?.presenceId,
                username: user.username,
            });
            if (user.presenceKey && oldPresence?.socketId === socket.id) {
                PRESENCE.delete(user.presenceKey);
            }
        }

        const isNewPresence = !PRESENCE.has(key);

        user.avatar = tokenData.avatar;
        user.room = room;
        user.username = tokenData.username;
        user.presenceKey = key;

        PRESENCE.set(key, {
            memberId,
            presenceId,
            socketId: socket.id,
            username: tokenData.username,
            avatar: tokenData.avatar,
            pos: defaultPos,
            rot: defaultRot,
            room,
        });

        socket.join(room);

        // Give the joining client one authoritative snapshot of everyone
        // currently in the room (including itself) instead of an ad-hoc
        // AV:new/AV replay loop. Chat and the X_ITE avatar layer reconcile
        // against this by logical presence key, independent of readiness.
        socket.emit("ROOM_STATE", { room, presences: roomPresenceSnapshot(room) });

        // Only announce a genuinely new presence - repeating JOIN for the
        // same room/presence (e.g. a redundant client call) must not spam
        // peers with another "someone joined" broadcast.
        if (isNewPresence) {
            socket.to(room).emit("AV:new", {
                id: socket.id,
                memberId,
                presenceId,
                avatar: tokenData.avatar,
                username: tokenData.username,
            });
        }

        console.log(`User '${tokenData.username}' entered room ${room}`);
        webhookMessage(
            "System",
            `${tokenData.username} entered room \`${room}\``
        );
    });

    //handle avatar related calls.
    socket.on("AV", function(msg) {
        msg.id = socket.id;
        const user = USERS.get(socket);
        if (user?.presenceKey) {
            const presence = PRESENCE.get(user.presenceKey);
            if (presence) {
                msg.memberId = presence.memberId;
                msg.presenceId = presence.presenceId;
                if (msg.pos) presence.pos = msg.pos;
                if (msg.rot) presence.rot = msg.rot;
            }
        }
        if (user?.room) {
            socket.to(user.room).emit("AV", msg);
        }
        if (user) {
            if (msg.pos) {
                USERS.get(socket).pos = msg.pos;
            }
            if (msg.rot) {
                USERS.get(socket).rot = msg.rot;
            }
        }
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
    socket.on("CHAT", (chatData) => {
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
        socket.to(room).emit("AV:del", {
            id: socket.id,
            memberId: presence?.memberId,
            presenceId: presence?.presenceId,
            username: user.username,
        });
        if (user.presenceKey) {
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
        io.to(user?.room).emit("AV:del", {
            id: socket.id,
            memberId: presence?.memberId,
            presenceId: presence?.presenceId,
            username: user?.username,
        });
        // Only remove the presence record if this socket is still the one
        // it's bound to - guards against a stale/delayed disconnect from an
        // old socket clobbering a newer connection for the same presence.
        if (user?.presenceKey && presence?.socketId === socket.id) {
            PRESENCE.delete(user.presenceKey);
        }
        USERS.delete(socket);
        console.log(`User '${user?.username}' disconnected`);
    });
});

const port = process.env.WEBSOCKET_PORT || 8000;
http.listen(port);
console.log(`listening on port:${port}`);
