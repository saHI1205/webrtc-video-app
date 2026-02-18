const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server);

app.use(express.static("public"));

io.on("connection", socket => {
  socket.on("join-room", roomId => {
    socket.join(roomId);
    socket.to(roomId).emit("user-connected", socket.id);

    socket.on("message", message => {
      io.to(roomId).emit("createMessage", message);
    });
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
