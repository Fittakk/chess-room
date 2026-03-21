const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const DISCONNECT_GRACE_MS = 30000;

function createRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      game: new Chess(),
      seats: {
        white: null,
        black: null,
      },
      spectators: {},
    };
  }
}

function makeSeat(clientId, socketId, name) {
  return {
    clientId,
    socketId,
    name,
    disconnectTimer: null,
  };
}

function clearSeatTimer(seat) {
  if (seat && seat.disconnectTimer) {
    clearTimeout(seat.disconnectTimer);
    seat.disconnectTimer = null;
  }
}

function getRoleBySocket(room, socketId) {
  if (room.seats.white && room.seats.white.socketId === socketId) return "white";
  if (room.seats.black && room.seats.black.socketId === socketId) return "black";
  return "spectator";
}

function getRoleByClientId(room, clientId) {
  if (room.seats.white && room.seats.white.clientId === clientId) return "white";
  if (room.seats.black && room.seats.black.clientId === clientId) return "black";
  return "spectator";
}

function roomStatus(room) {
  if (room.game.isCheckmate()) {
    return room.game.turn() === "w"
      ? "Black wins by checkmate"
      : "White wins by checkmate";
  }

  if (room.game.isDraw()) {
    return "Draw";
  }

  if (room.game.isCheck()) {
    return room.game.turn() === "w"
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
    whiteName: room.seats.white ? room.seats.white.name : "Waiting...",
    blackName: room.seats.black ? room.seats.black.name : "Waiting...",
    spectators: Object.values(room.spectators).map((s) => s.name),
    status: roomStatus(room),
    gameOver: room.game.isGameOver(),
  });
}

function attachSeat(room, role, clientId, socketId, name) {
  const seat = room.seats[role];
  if (seat) {
    clearSeatTimer(seat);
    seat.clientId = clientId;
    seat.socketId = socketId;
    seat.name = name;
  } else {
    room.seats[role] = makeSeat(clientId, socketId, name);
  }
}

function removeSpectatorBySocket(room, socketId) {
  for (const key of Object.keys(room.spectators)) {
    if (room.spectators[key].socketId === socketId) {
      delete room.spectators[key];
      return;
    }
  }
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, name, clientId }) => {
    roomId = (roomId || "default").trim();
    name = (name || "Guest").trim().slice(0, 20);
    clientId = String(clientId || "").trim();

    if (!clientId) return;

    createRoom(roomId);
    const room = rooms[roomId];

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.clientId = clientId;
    socket.data.name = name;

    let role = getRoleByClientId(room, clientId);

    if (role === "white") {
      attachSeat(room, "white", clientId, socket.id, name);
    } else if (role === "black") {
      attachSeat(room, "black", clientId, socket.id, name);
    } else if (!room.seats.white) {
      attachSeat(room, "white", clientId, socket.id, name);
      role = "white";
    } else if (!room.seats.black) {
      attachSeat(room, "black", clientId, socket.id, name);
      role = "black";
    } else {
      room.spectators[clientId] = {
        socketId: socket.id,
        name,
      };
      role = "spectator";
    }

    removeSpectatorBySocket(room, socket.id);
    if (role === "spectator") {
      room.spectators[clientId] = {
        socketId: socket.id,
        name,
      };
    }

    socket.emit("role", role);
    io.to(roomId).emit("chat", `${name} joined as ${role}`);
    sendRoomState(roomId);
  });

  socket.on("move", (move) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const role = getRoleBySocket(room, socket.id);
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
      // invalid move
    }
  });

  socket.on("newGame", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const role = getRoleBySocket(room, socket.id);

    if (role !== "white" && role !== "black") return;

    room.game = new Chess();
    io.to(roomId).emit("chat", "New game started");
    sendRoomState(roomId);
  });

  socket.on("chat", (msg) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const text = String(msg || "").trim();
    if (!text) return;

    const name = socket.data.name || "Guest";
    io.to(roomId).emit("chat", `${name}: ${text}`);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const clientId = socket.data.clientId;
    const name = socket.data.name || "Guest";

    if (room.seats.white && room.seats.white.socketId === socket.id) {
      room.seats.white.socketId = null;
      clearSeatTimer(room.seats.white);
      room.seats.white.disconnectTimer = setTimeout(() => {
        if (room.seats.white && room.seats.white.clientId === clientId && !room.seats.white.socketId) {
          room.seats.white = null;
          sendRoomState(roomId);
        }
      }, DISCONNECT_GRACE_MS);
    } else if (room.seats.black && room.seats.black.socketId === socket.id) {
      room.seats.black.socketId = null;
      clearSeatTimer(room.seats.black);
      room.seats.black.disconnectTimer = setTimeout(() => {
        if (room.seats.black && room.seats.black.clientId === clientId && !room.seats.black.socketId) {
          room.seats.black = null;
          sendRoomState(roomId);
        }
      }, DISCONNECT_GRACE_MS);
    } else {
      if (room.spectators[clientId]) {
        delete room.spectators[clientId];
      } else {
        removeSpectatorBySocket(room, socket.id);
      }
    }

    io.to(roomId).emit("chat", `${name} left the room`);
    sendRoomState(roomId);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});