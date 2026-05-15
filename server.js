const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const BOARD_SIZE = 10;
const SHIPS = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 }
];

function generateCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 5; i++) r += c[Math.floor(Math.random() * c.length)];
  return r;
}

function emptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function createPlayer(id, nickname) {
  return { id, nickname, board: emptyBoard(), shots: emptyBoard(), ships: [], ready: false, shipsRemaining: SHIPS.length };
}

function getShipCells(s) {
  const cells = [];
  for (let i = 0; i < s.size; i++) cells.push([s.horizontal ? s.x + i : s.x, s.horizontal ? s.y : s.y + i]);
  return cells;
}

function shipsAdjacent(s1, s2) {
  const c1 = getShipCells(s1), c2 = getShipCells(s2);
  for (const [x1, y1] of c1) for (const [x2, y2] of c2) if (Math.abs(x1 - x2) <= 1 && Math.abs(y1 - y2) <= 1) return true;
  return false;
}

function validateShips(ships) {
  if (ships.length !== SHIPS.length) return false;
  const s1 = [...SHIPS].sort((a, b) => b.size - a.size);
  const s2 = [...ships].sort((a, b) => b.size - a.size);
  for (let i = 0; i < s1.length; i++) if (s2[i].size !== s1[i].size) return false;
  const board = emptyBoard();
  for (const s of ships) {
    for (let i = 0; i < s.size; i++) {
      const cx = s.horizontal ? s.x + i : s.x, cy = s.horizontal ? s.y : s.y + i;
      if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) return false;
      if (board[cy][cx] !== 0) return false;
      board[cy][cx] = 1;
    }
  }
  for (let i = 0; i < ships.length; i++) for (let j = i + 1; j < ships.length; j++) if (shipsAdjacent(ships[i], ships[j])) return false;
  return true;
}

function buildBoard(ships) {
  const board = emptyBoard();
  for (const s of ships) for (let i = 0; i < s.size; i++) { const cx = s.horizontal ? s.x + i : s.x, cy = s.horizontal ? s.y : s.y + i; board[cy][cx] = 1; }
  return board;
}

function isShipSunk(ship, shots) {
  for (let i = 0; i < ship.size; i++) { const cx = ship.horizontal ? ship.x + i : ship.x, cy = ship.horizontal ? ship.y : ship.y + i; if (shots[cy][cx] !== 2) return false; }
  return true;
}

function getPlayersInfo(room) { return room.players.map(p => ({ nickname: p.nickname })); }

io.on('connection', (socket) => {
  socket.on('create-room', (data, cb) => {
    if (typeof data === 'function') { cb = data; data = {}; }
    const nickname = (data && data.nickname) || 'Oyuncu 1';
    let code = generateCode();
    while (rooms.has(code)) code = generateCode();
    rooms.set(code, { code, players: [createPlayer(socket.id, nickname)], currentTurn: null, phase: 'waiting', winner: null });
    socket.join(code); socket.roomCode = code; socket.playerIndex = 0;
    cb({ success: true, code, playerIndex: 0 });
  });

  socket.on('join-room', (data, cb) => {
    if (typeof data === 'string') data = { code: data };
    const code = data.code, nickname = data.nickname || 'Oyuncu 2';
    const room = rooms.get(code);
    if (!room) return cb({ success: false, error: 'Oda bulunamadı.' });
    if (room.players.length >= 2) return cb({ success: false, error: 'Oda dolu.' });
    if (room.phase !== 'waiting') return cb({ success: false, error: 'Oyun başlamış.' });
    room.players.push(createPlayer(socket.id, nickname));
    room.phase = 'placement';
    socket.join(code); socket.roomCode = code; socket.playerIndex = 1;
    cb({ success: true, code, playerIndex: 1 });
    io.to(code).emit('phase-change', { phase: 'placement', ships: SHIPS, players: getPlayersInfo(room) });
  });

  socket.on('place-ships', (shipsData, cb) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'placement') return cb({ success: false, error: 'Geçersiz durum.' });
    const player = room.players[socket.playerIndex];
    if (player.ready) return cb({ success: false, error: 'Zaten yerleştirildi.' });
    if (!validateShips(shipsData)) return cb({ success: false, error: 'Geçersiz yerleşim.' });
    player.ships = shipsData; player.board = buildBoard(shipsData); player.ready = true;
    cb({ success: true });
    const oppIdx = socket.playerIndex === 0 ? 1 : 0;
    const opp = room.players[oppIdx];
    if (opp) io.to(opp.id).emit('opponent-ready');
    if (room.players.length === 2 && room.players.every(p => p.ready)) {
      room.phase = 'battle'; room.currentTurn = Math.random() < 0.5 ? 0 : 1;
      io.to(room.code).emit('phase-change', { phase: 'battle', currentTurn: room.currentTurn, players: getPlayersInfo(room) });
    }
  });

  socket.on('fire', ({ x, y }, cb) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'battle') return cb({ success: false, error: 'Geçersiz.' });
    if (room.currentTurn !== socket.playerIndex) return cb({ success: false, error: 'Sıra sende değil.' });
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return cb({ success: false, error: 'Geçersiz koordinat.' });
    const oppIdx = socket.playerIndex === 0 ? 1 : 0;
    const opp = room.players[oppIdx], atk = room.players[socket.playerIndex];
    if (atk.shots[y][x] !== 0) return cb({ success: false, error: 'Zaten ateş edildi.' });
    const hit = opp.board[y][x] === 1;
    atk.shots[y][x] = hit ? 2 : 1;
    let sunkShip = null, gameOver = false;
    if (hit) {
      for (const s of opp.ships) { if (!s.sunk && isShipSunk(s, atk.shots)) { s.sunk = true; sunkShip = { name: s.name, size: s.size, x: s.x, y: s.y, horizontal: s.horizontal }; opp.shipsRemaining--; } }
      if (opp.shipsRemaining <= 0) { gameOver = true; room.phase = 'finished'; room.winner = socket.playerIndex; }
    }
    if (!gameOver && !hit) room.currentTurn = oppIdx;
    const result = { x, y, hit, sunkShip, gameOver, currentTurn: room.currentTurn };
    cb({ success: true, ...result });
    io.to(opp.id).emit('opponent-fired', result);
    if (gameOver) io.to(room.code).emit('game-over', { winner: socket.playerIndex });
  });

  socket.on('chat-message', (msg) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.playerIndex === undefined) return;
    const p = room.players[socket.playerIndex];
    if (!p) return;
    io.to(room.code).emit('chat-message', { nickname: p.nickname, message: String(msg).substring(0, 100), playerIndex: socket.playerIndex });
  });

  socket.on('rematch', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'finished') return;
    const p = room.players[socket.playerIndex];
    if (p) p.wantsRematch = true;

    if (room.players.every(player => player && player.wantsRematch)) {
      room.players.forEach((player, i) => { room.players[i] = createPlayer(player.id, player.nickname); });
      room.phase = 'placement'; room.currentTurn = null; room.winner = null;
      io.to(room.code).emit('phase-change', { phase: 'placement', ships: SHIPS, players: getPlayersInfo(room) });
    } else {
      socket.emit('waiting-rematch');
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomCode);
    if (room) {
      // Only notify the OTHER player(s), not the disconnecting socket itself
      room.players.forEach((p, i) => {
        if (p.id !== socket.id) {
          const s = io.sockets.sockets.get(p.id);
          if (s && s.connected) s.emit('opponent-disconnected');
        }
      });
      // Clean up room after grace period if both players gone
      setTimeout(() => {
        const r = rooms.get(socket.roomCode);
        if (r && !r.players.some(p => io.sockets.sockets.get(p.id)?.connected)) {
          rooms.delete(socket.roomCode);
        }
      }, 30000);
    }
  });
});

setInterval(() => { for (const [code, room] of rooms) if (!room.players.some(p => io.sockets.sockets.get(p.id)?.connected)) rooms.delete(code); }, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
