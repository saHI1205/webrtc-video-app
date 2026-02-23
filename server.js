const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("join-room", async ({ roomId, name }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name || "User";

    const socketsInRoom = await io.in(roomId).fetchSockets();
    const others = socketsInRoom
      .filter((s) => s.id !== socket.id)
      .map((s) => ({ socketId: s.id, name: s.data.name || "User" }));

    socket.emit("room-users", { users: others });
    socket.to(roomId).emit("user-joined", { socketId: socket.id, name: socket.data.name });
  });

  // ✅ Register signaling handlers ONCE per socket
  socket.on("webrtc-offer", ({ to, offer }) => {
    io.to(to).emit("webrtc-offer", { from: socket.id, offer, name: socket.data.name });
  });

  socket.on("webrtc-answer", ({ to, answer }) => {
    io.to(to).emit("webrtc-answer", { from: socket.id, answer, name: socket.data.name });
  });

  socket.on("webrtc-ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("webrtc-ice-candidate", { from: socket.id, candidate });
  });

  socket.on("chat-message", ({ roomId, name, message }) => {
    io.to(roomId).emit("chat-message", { name, message });
  });

  // ✅ NEW: Leave room
  socket.on("leave-room", () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit("user-left", { socketId: socket.id });
      socket.leave(roomId);
    }
    socket.data.roomId = null;
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit("user-left", { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});