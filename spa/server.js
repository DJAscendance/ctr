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

  // OUTLANDS-2B. A scheduled match joins "<placeId>:outlands-match-1", which is
  // not a place id, so this endpoint would 400 on every join and every message.
  // A match session is never chat restricted; answer without the round trip.
  if (!/^\d+$/.test(String(room))) return { ...status, fetchedAt: Date.now() };

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

    socket.on("JOIN", async (data) => {
        const tokenData = validJwt(data.token);
        if (tokenData) {
            const { room } = data;
            USERS.get(socket).avatar = tokenData.avatar;
            USERS.get(socket).room = room;
            USERS.get(socket).username = tokenData.username;

            // inform other members of the room that someone joined
            socket.to(room).emit("AV:new", {
                id: socket.id,
                avatar: tokenData.avatar,
                username: tokenData.username,
            });

            socket.join(room);

            // let everyone in the room (including the joining socket) know whether it's
            // chat-restricted, and if so who's allowed to chat
            const chatAccess = await getChatAccessStatus(room);
            io.to(room).emit("CHAT_ACCESS", {
                restricted: chatAccess.restricted,
                allowedUsernames: chatAccess.allowedUsernames,
            });
            // provide the new user with data about the current users in the room
            const clientsInRoom = io.sockets.adapter.rooms.get(room);
            for (const clientId of clientsInRoom) {
                if (clientId === socket.id) continue;
                const clientSocket = io.sockets.sockets.get(clientId);
                const user = USERS.get(clientSocket);
                if (user) {
                    const { avatar, pos, rot, username } = user;
                    socket.emit("AV:new", {
                        avatar,
                        id: clientId,
                        username,
                    });
                    socket.emit("AV", {
                        id: clientId,
                        pos,
                        rot,
                    });
                }
            }

            console.log(`User '${tokenData.username}' entered room ${room}`);
            webhookMessage(
                "System",
                `${tokenData.username} entered room \`${room}\``
            );
        } else {
            console.error("invalid token!");
        }
    });

    //handle avatar related calls.
    socket.on("AV", function(msg) {
        msg.id = socket.id;
        const user = USERS.get(socket);
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
        socket.leave(user.room);
        socket.to(user.room).emit("AV:del", {
            id: socket.id,
            username: user.username,
        });

        console.log(`User '${user.username}' left ${user.room}`);
        webhookMessage("System", `${user.username} left ${user.room}`);
    });

    //handle disconnection from the socket.
    socket.on("disconnect", function() {
        const user = USERS.get(socket);
        io.to(user?.room).emit("AV:del", {
            id: socket.id,
            username: user.username,
        });
        USERS.delete(socket);
        console.log(`User '${user?.username}' disconnected`);
    });
});

const port = process.env.WEBSOCKET_PORT || 8000;
http.listen(port);
console.log(`listening on port:${port}`);
