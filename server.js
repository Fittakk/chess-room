const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

function createRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      game: new Chess(),
      players: {
        white: null,
        black: null,
      },
      names: {},
    };
  }
}

function getRole(room, socketId) {
  if (room.players.white === socketId) return "white";
  if (room.players.black === socketId) return "black";
  return "spectator";
}

function getGameStatus(game) {
  if (game.isCheckmate()) {
    return game.turn() === "w"
      ? "Black wins by checkmate"
      : "White wins by checkmate";
  }

  if (game.isDraw()) {
    return "Draw";
  }

  if (game.isCheck()) {
    return game.turn() === "w"
      ? "White is in check"
      : "Black is in check";
  }

  return "In progress";
}

function sendRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("state", {
    fen: room.game.fen(),
    whiteName: room.players.white
      ? room.names[room.players.white] || "White"
      : "Waiting...",
    blackName: room.players.black
      ? room.names[room.players.black] || "Black"
      : "Waiting...",
    spectators: Object.keys(room.names)
      .filter(
        (id) => id !== room.players.white && id !== room.players.black
      )
      .map((id) => room.names[id]),
    status: getGameStatus(room.game),
    gameOver: room.game.isGameOver(),
  });
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, name }) => {
    roomId = (roomId || "default").trim();
    name = (name || "Guest").trim().slice(0, 20);

    createRoom(roomId);
    const room = rooms[roomId];

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    if (!room.players.white) {
      room.players.white = socket.id;
    } else if (!room.players.black) {
      room.players.black = socket.id;
    }

    room.names[socket.id] = name;

    const role = getRole(room, socket.id);
    socket.emit("role", role);

    io.to(roomId).emit("chat", `${name} joined as ${role}`);
    sendRoomState(roomId);
  });

  socket.on("move", (move) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const role = getRole(room, socket.id);
    const turn = room.game.turn() === "w" ? "white" : "black";

    if (role !== turn) return;
    if (room.game.isGameOver()) return;

    try {
      const result = room.game.move(move);
      if (!result) return;

      if (room.game.isCheckmate()) {
        const winner = room.game.turn() === "w" ? "Black" : "White";
        io.to(roomId).emit("chat", `Game over: ${winner} wins by checkmate`);
      } else if (room.game.isDraw()) {
        io.to(roomId).emit("chat", "Game over: Draw");
      } else if (room.game.isCheck()) {
        const side = room.game.turn() === "w" ? "White" : "Black";
        io.to(roomId).emit("chat", `${side} is in check`);
      }

      sendRoomState(roomId);
    } catch (error) {
      // invalid move - ignore
    }
  });

  socket.on("chat", (msg) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const text = String(msg || "").trim();
    if (!text) return;

    const sender = room.names[socket.id] || "Guest";
    io.to(roomId).emit("chat", `${sender}: ${text}`);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const name = room.names[socket.id] || "Guest";

    if (room.players.white === socket.id) room.players.white = null;
    if (room.players.black === socket.id) room.players.black = null;

    delete room.names[socket.id];

    io.to(roomId).emit("chat", `${name} left the room`);
    sendRoomState(roomId);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});