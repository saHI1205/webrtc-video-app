const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", async ({ roomId, name }) => {
    try {
      // Leave previous room first if any
      if (socket.data.roomId) {
        socket.leave(socket.data.roomId);
      }

      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.name = name || "User";

      const socketsInRoom = await io.in(roomId).fetchSockets();

      const others = socketsInRoom
        .filter((s) => s.id !== socket.id)
        .map((s) => ({
          socketId: s.id,
          name: s.data.name || "User"
        }));

      socket.emit("room-users", { users: others });

      socket.to(roomId).emit("user-joined", {
        socketId: socket.id,
        name: socket.data.name
      });

      console.log(`${socket.data.name} joined room ${roomId}`);
    } catch (err) {
      console.error("join-room error:", err);
    }
  });

  socket.on("webrtc-offer", ({ to, offer }) => {
    io.to(to).emit("webrtc-offer", {
      from: socket.id,
      offer,
      name: socket.data.name || "User"
    });
  });

  socket.on("webrtc-answer", ({ to, answer }) => {
    io.to(to).emit("webrtc-answer", {
      from: socket.id,
      answer,
      name: socket.data.name || "User"
    });
  });

  socket.on("webrtc-ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("webrtc-ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  socket.on("chat-message", ({ roomId, name, message }) => {
    io.to(roomId).emit("chat-message", { name, message });
  });

  socket.on("leave-room", () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit("user-left", { socketId: socket.id });
      socket.leave(roomId);
      console.log(`${socket.data.name || socket.id} left room ${roomId}`);
    }
    socket.data.roomId = null;
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit("user-left", { socketId: socket.id });
      console.log(`User disconnected: ${socket.id} from room ${roomId}`);
    } else {
      console.log(`User disconnected: ${socket.id}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});