const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// Queue of waiting socket IDs
let waitingQueue = [];

// Map of socketId -> profile: { nickname, avatar, language, interests: [] }
const profiles = {};

// Map of socketId -> partnerId
const pairs = {};

function broadcastOnlineCount() {
  io.emit('online-count', io.sockets.sockets.size);
}

function getPartner(socketId) {
  return pairs[socketId] || null;
}

function cleanupPair(socketId) {
  const partnerId = pairs[socketId];
  if (partnerId) {
    delete pairs[partnerId];
    // Notify partner they are disconnected
    io.to(partnerId).emit('partner-left');
  }
  delete pairs[socketId];
  waitingQueue = waitingQueue.filter(id => id !== socketId);
}

function findBestMatch(myId) {
  const myProfile = profiles[myId];
  if (!myProfile) return null;

  // 1. Match by Same Language AND Shared Interests
  for (let i = 0; i < waitingQueue.length; i++) {
    const oppId = waitingQueue[i];
    if (oppId === myId) continue;
    const oppProfile = profiles[oppId];
    if (!oppProfile) continue;

    if (oppProfile.language === myProfile.language) {
      const hasSharedInterest = oppProfile.interests.some(interest =>
        myProfile.interests.includes(interest)
      );
      if (hasSharedInterest) return oppId;
    }
  }

  // 2. Match by Same Language Only
  for (let i = 0; i < waitingQueue.length; i++) {
    const oppId = waitingQueue[i];
    if (oppId === myId) continue;
    const oppProfile = profiles[oppId];
    if (!oppProfile) continue;

    if (oppProfile.language === myProfile.language) return oppId;
  }

  return null;
}

io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);
  broadcastOnlineCount();

  // --- MATCHMAKING ---
  socket.on('find-partner', (profile) => {
    // Clean up first
    cleanupPair(socket.id);

    // Save profile
    profiles[socket.id] = profile || {
      nickname: 'Anonymous',
      avatar: '👤',
      language: 'en',
      interests: []
    };

    // Attempt to match
    const partnerId = findBestMatch(socket.id);

    if (partnerId) {
      // Pair them
      pairs[socket.id] = partnerId;
      pairs[partnerId] = socket.id;

      // Remove partner from queue
      waitingQueue = waitingQueue.filter(id => id !== partnerId);

      // Notify both sockets
      socket.emit('matched', { initiator: true, partner: profiles[partnerId] });
      io.to(partnerId).emit('matched', { initiator: false, partner: profiles[socket.id] });

      console.log(`[~] Paired (Interests): ${socket.id} <-> ${partnerId}`);
    } else {
      // Add to queue
      waitingQueue.push(socket.id);
      socket.emit('searching');
      console.log(`[?] Waiting: ${socket.id} (${profiles[socket.id].nickname})`);

      // Fallback: After 5 seconds, pair with ANY user in the queue
      setTimeout(() => {
        if (waitingQueue.includes(socket.id) && !pairs[socket.id]) {
          const fallbackPartnerId = waitingQueue.find(id => id !== socket.id);
          if (fallbackPartnerId) {
            pairs[socket.id] = fallbackPartnerId;
            pairs[fallbackPartnerId] = socket.id;

            waitingQueue = waitingQueue.filter(id => id !== socket.id && id !== fallbackPartnerId);

            socket.emit('matched', { initiator: true, partner: profiles[fallbackPartnerId] });
            io.to(fallbackPartnerId).emit('matched', { initiator: false, partner: profiles[socket.id] });

            console.log(`[~] Paired (Fallback): ${socket.id} <-> ${fallbackPartnerId}`);
          }
        }
      }, 5000);
    }
  });

  // --- WebRTC SIGNALING RELAY ---
  socket.on('offer', (data) => {
    const partner = getPartner(socket.id);
    if (partner) io.to(partner).emit('offer', data);
  });

  socket.on('answer', (data) => {
    const partner = getPartner(socket.id);
    if (partner) io.to(partner).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    const partner = getPartner(socket.id);
    if (partner) io.to(partner).emit('ice-candidate', data);
  });

  // --- TEXT CHAT RELAY ---
  socket.on('chat-message', (msg) => {
    const partner = getPartner(socket.id);
    if (partner) {
      io.to(partner).emit('chat-message', {
        text: msg.text,
        sender: 'partner'
      });
    }
  });

  // --- SKIP / END ---
  socket.on('skip', () => {
    cleanupPair(socket.id);
    socket.emit('idle');
  });

  socket.on('end-call', () => {
    cleanupPair(socket.id);
    socket.emit('idle');
  });

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    console.log(`[-] Disconnected: ${socket.id}`);
    cleanupPair(socket.id);
    delete profiles[socket.id];
    broadcastOnlineCount();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔊 Random Call Server running at http://localhost:${PORT}`);
});
