const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  pingInterval: 20000, // send heartbeat every 20s
  pingTimeout: 60000,  // allow up to 60s for response
});

const crypto = require("crypto");

// ---------- helpers ----------
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function genRoomId() { return b64url(crypto.randomBytes(12)); }
function genAccessCode() {
  return parseInt(crypto.randomBytes(4).toString("hex"), 16).toString(36).slice(0, 6);
}

// ---------- middleware ----------
app.use(express.static("public"));
app.use(express.json()); // needed for POST body

// ---------- in-memory rooms ----------
const rooms = new Map(); // roomId -> { codes:Set, participants:Set, ttl, timeout }

function createRoom(ttlSeconds = 3600) {
  const roomId = genRoomId();
  const codes = new Set([genAccessCode(), genAccessCode()]); // two one-time codes
  const meta = { codes, participants: new Set(), ttl: ttlSeconds, timeout: null };
  meta.timeout = setTimeout(() => rooms.delete(roomId), ttlSeconds * 1000);
  rooms.set(roomId, meta);
  return { roomId, codes: [...codes], ttl: ttlSeconds };
}

// ---------- room creation endpoints ----------
app.post("/create-room", (req, res) => {
  const ttl = Math.max(60, Math.min(24 * 3600, Number(req.body?.ttl) || 3600));
  res.json(createRoom(ttl));
});

// GET fallback so you can test in the address bar: /create-room?ttl=3600
app.get("/create-room", (req, res) => {
  const ttl = Math.max(60, Math.min(24 * 3600, Number(req.query.ttl) || 3600));
  res.json(createRoom(ttl));
});

// ---------- socket.io ----------
io.on("connection", (socket) => {
  socket.on("join", ({ roomId, code }, cb) => {
    const meta = rooms.get(roomId);
    if (!meta) return cb?.({ ok: false, reason: "room_not_found" });
    if (meta.participants.size >= 2) return cb?.({ ok: false, reason: "room_full" });
    if (!code || !meta.codes.has(code)) return cb?.({ ok: false, reason: "bad_code" });

    // consume one-time code
    meta.codes.delete(code);
    meta.participants.add(socket.id);
    socket.join(roomId);

    // cleanup
    socket.once("disconnect", () => {
      const m = rooms.get(roomId);
      if (!m) return;
      m.participants.delete(socket.id);
      if (m.participants.size === 0) {
        clearTimeout(m.timeout);
        rooms.delete(roomId);
      }
    });

    cb?.({ ok: true, participants: meta.participants.size, remainingCodes: meta.codes.size });
    io.to(roomId).emit("system", { txt: "Participant joined", count: meta.participants.size });
  });

  socket.on("chat message", (msg) => {
    if (!msg || !msg.roomId) return;
    io.to(msg.roomId).emit("chat message", msg);
  });
});

// ---------- start ----------
http.listen(3000, () => {
  console.log("Listening on *:3000");
});

