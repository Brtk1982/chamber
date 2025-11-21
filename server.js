const express = require("express");
const app = express();
const rateLimit = require("express-rate-limit");

// Limit each IP to 30 create-room requests per hour
const createRoomLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { error: "Too many rooms created from this IP. Try again later." },
});

// Apply only to the /create-room route
app.use("/create-room", createRoomLimiter);

const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  pingInterval: 30000, // send heartbeat every 30s
  pingTimeout: 150000,  // allow up to 2.5min for response
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
  const codes = new Set([genAccessCode(), genAccessCode()]);
  const meta = { codes, participants: new Set(), ttl: ttlSeconds, timeout: null };

  // Calculate expiry time
  const expiresAt = Date.now() + ttlSeconds * 1000;

  // Schedule automatic cleanup
  meta.timeout = setTimeout(() => {
    io.to(roomId).emit("system", { txt: "Room expired. Connection closed." });
    io.to(roomId).emit("expire");
    io.socketsLeave(roomId);
    for (const id of meta.participants) {
      const s = io.sockets.sockets.get(id);
      if (s) s.disconnect(true);
    }
    rooms.delete(roomId);
  }, ttlSeconds * 1000);

  rooms.set(roomId, meta);
  return { roomId, codes: [...codes], ttl: ttlSeconds, expiresAt };
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


// Global join attempts memory (shared by all sockets)
const joinAttempts = {};
const LIMIT = 10;          // max 10 join attempts
const WINDOW = 60 * 1000;  // within 1 minute

io.on("connection", (socket) => {
  console.log("A user connected");

  // --- JOIN ROOM ---
  socket.on("join", ({ roomId, code }, cb) => {
    const ip = socket.handshake.address;
    const now = Date.now();

    // --- RATE LIMITING ---
    if (!joinAttempts[ip]) joinAttempts[ip] = [];
    joinAttempts[ip] = joinAttempts[ip].filter(t => now - t < WINDOW);
    joinAttempts[ip].push(now);

    if (joinAttempts[ip].length > LIMIT) {
      return cb?.({ ok: false, reason: "too_many_attempts" });
    }

    // --- JOIN LOGIC ---
    const meta = rooms.get(roomId);
    if (!meta) return cb?.({ ok: false, reason: "room_not_found" });
    if (meta.participants.size >= 2) return cb?.({ ok: false, reason: "room_full" });
    if (!code || !meta.codes.has(code)) return cb?.({ ok: false, reason: "bad_code" });

    meta.codes.delete(code);
    meta.participants.add(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.code = code;

    const count = meta.participants.size;
    io.to(roomId).emit("system", { txt: "Participant joined", count });
    io.to(roomId).emit("count", count);

    cb?.({ ok: true, participants: count, remainingCodes: meta.codes.size });

    socket.once("disconnect", () => {
      const m = rooms.get(roomId);
      if (!m) return;
      m.participants.delete(socket.id);
      const newCount = m.participants.size;

      io.to(roomId).emit("count", newCount);
      if (newCount > 0) {
        io.to(roomId).emit("system", { txt: "Your chat partner has left the room.", count: newCount });
      }

      if (newCount === 0) {
        clearTimeout(m.timeout);
        rooms.delete(roomId);
      }
      console.log("User disconnected");
    });
  });

  // --- RELAY CHAT MESSAGES ---
  socket.on("chat message", (msg) => {
    if (!msg || !msg.roomId) return;
    io.to(msg.roomId).emit("chat message", msg);
  });
});

// ---------- start ----------
http.listen(3000, () => {
  console.log("Listening on *:3000");
});

