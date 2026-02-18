const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId }) => {
    socket.join(roomId);

    // Notify others in room
    socket.to(roomId).emit("user-joined", { socketId: socket.id });

    // WebRTC signaling relay
    socket.on("webrtc-offer", ({ roomId, offer, to }) => {
      io.to(to).emit("webrtc-offer", { offer, from: socket.id });
    });

    socket.on("webrtc-answer", ({ roomId, answer, to }) => {
      io.to(to).emit("webrtc-answer", { answer, from: socket.id });
    });

    socket.on("webrtc-ice-candidate", ({ roomId, candidate, to }) => {
      io.to(to).emit("webrtc-ice-candidate", { candidate, from: socket.id });
    });

    // Chat relay (to entire room)
    socket.on("chat-message", ({ roomId, name, message }) => {
      io.to(roomId).emit("chat-message", { name, message });
    });

    socket.on("disconnecting", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.to(room).emit("user-left", { socketId: socket.id });
        }
      }
    });
  });
});

// Important for LAN testing (phone + laptop)
server.listen(3000, "0.0.0.0", () => {
  console.log("Server running on http://localhost:3000");
});
