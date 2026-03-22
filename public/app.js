const socket = io();
const chess = new Chess();

let selected = null;
let possibleMoves = [];
let lastMove = [];
let role = "spectator";
let roomId = new URLSearchParams(window.location.search).get("room") || "grupi-shahut";
let playerName = prompt("Shkruaj emrin tënd:", "Guest") || "Guest";

let clientId = localStorage.getItem("chessClientId");
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem("chessClientId", clientId);
}

let gameOverState = null;

function playSound(type) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  switch(type) {
    case 'move':
      oscillator.frequency.setValueAtTime(523, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.05); // E5
      gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
      break;
    case 'capture':
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4
      oscillator.frequency.setValueAtTime(330, audioContext.currentTime + 0.05); // E4
      oscillator.frequency.setValueAtTime(262, audioContext.currentTime + 0.1); // C4
      gainNode.gain.setValueAtTime(0.12, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.15);
      break;
    case 'check':
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
      oscillator.frequency.setValueAtTime(1109, audioContext.currentTime + 0.1); // C#6
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime + 0.2); // A5
      oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.3); // E5
      gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.4);
      break;
    case 'checkmate':
      oscillator.frequency.setValueAtTime(523, audioContext.currentTime); // C5
      oscillator.frequency.setValueAtTime(392, audioContext.currentTime + 0.2); // G4
      oscillator.frequency.setValueAtTime(294, audioContext.currentTime + 0.4); // D4
      oscillator.frequency.setValueAtTime(220, audioContext.currentTime + 0.6); // A3
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.8);
      break;
  }
}

document.getElementById("roomText").innerText = "Room: " + roomId;

socket.emit("joinRoom", {
  roomId,
  name: playerName,
  clientId
});

socket.on("role", (r) => {
  role = r;
  document.getElementById("role").innerText = "You are: " + r;
  render();
});

socket.on("state", (data) => {
  const previousFen = chess.fen();
  chess.load(data.fen);
  document.getElementById("whiteName").innerText = data.whiteName;
  document.getElementById("blackName").innerText = data.blackName;

  const spectatorsText = data.spectators.length
    ? data.spectators.join(", ")
    : "none";

  document.getElementById("spectators").innerText = "Spectators: " + spectatorsText;

  if (document.getElementById("gameStatus")) {
    document.getElementById("gameStatus").innerText = "Game status: " + (data.status || "In progress");
  }

  if (chess.isCheckmate()) {
    gameOverState = chess.turn() === "w" ? "black" : "white";
    playSound("checkmate");
  } else if (chess.isCheck()) {
    playSound("check");
  } else if (previousFen !== data.fen) {
    // Check if a piece was captured
    const prevBoard = new Chess(previousFen).board();
    const currBoard = chess.board();
    let captured = false;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if (prevBoard[i][j] && !currBoard[i][j]) {
          captured = true;
          break;
        }
      }
      if (captured) break;
    }
    playSound(captured ? "capture" : "move");
  }

  render();
});

socket.on("chat", (msg) => {
  const box = document.getElementById("chatBox");
  box.innerHTML += `<div>${msg}</div>`;
  box.scrollTop = box.scrollHeight;
});

function startNewGame() {
  socket.emit("newGame");
  selected = null;
  possibleMoves = [];
  lastMove = [];
}

function render() {
  const board = document.getElementById("board");
  board.innerHTML = "";

  const boardData = chess.board();

  for (let displayRow = 0; displayRow < 8; displayRow++) {
    for (let displayCol = 0; displayCol < 8; displayCol++) {
      let realRow, realCol;

      if (role === "black") {
        realRow = 7 - displayRow;
        realCol = 7 - displayCol;
      } else {
        realRow = displayRow;
        realCol = displayCol;
      }

      const square = boardData[realRow][realCol];
      const file = "abcdefgh"[realCol];
      const rank = 8 - realRow;
      const squareName = file + rank;

      const div = document.createElement("div");
      div.classList.add("square");
      div.classList.add((displayRow + displayCol) % 2 === 0 ? "white" : "black");

      div.style.outline = "";
      div.style.backgroundColor = "";

      if (selected === squareName) {
        div.style.outline = "3px solid yellow";
      }

      if (lastMove.includes(squareName)) {
        div.style.backgroundColor = "#f7ec59";
      }

      if (possibleMoves.includes(squareName)) {
        const dot = document.createElement("div");
        dot.classList.add("move-dot");
        div.appendChild(dot);
      }

      if (square) {
        const img = document.createElement("img");
        img.src = `pieces/${square.color}${square.type}.svg`;
        img.classList.add("piece-img");
        img.draggable = false;

        if (gameOverState && square.type === "k" && square.color === (gameOverState === "white" ? "b" : "w")) {
          img.classList.add("fallen");
        }

        div.appendChild(img);
      }

      div.onclick = () => handleClick(squareName);
      board.appendChild(div);
    }
  }
}

function handleClick(square) {
  if (role === "spectator") return;
  if (chess.isGameOver()) return;

  const turn = chess.turn() === "w" ? "white" : "black";
  if (role !== turn) return;

  const piece = chess.get(square);

  if (!selected) {
    if (!piece) return;

    if (role === "white" && piece.color !== "w") return;
    if (role === "black" && piece.color !== "b") return;

    selected = square;
    possibleMoves = chess.moves({ square, verbose: true }).map((m) => m.to);
    render();
    return;
  }

  if (selected === square) {
    selected = null;
    possibleMoves = [];
    render();
    return;
  }

  if (possibleMoves.includes(square)) {
    lastMove = [selected, square];

    socket.emit("move", {
      from: selected,
      to: square,
      promotion: "q",
    });

    selected = null;
    possibleMoves = [];
    return;
  }

  if (piece) {
    if (
      (role === "white" && piece.color === "w") ||
      (role === "black" && piece.color === "b")
    ) {
      selected = square;
      possibleMoves = chess.moves({ square, verbose: true }).map((m) => m.to);
      render();
      return;
    }
  }

  selected = null;
  possibleMoves = [];
  render();
}

function sendMsg() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  socket.emit("chat", text);
  input.value = "";
}
