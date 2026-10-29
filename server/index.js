import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

import { setupTelegramAuth } from './telegramAuth.js';
import { resolveVideoUrl } from './resolver.js';
import { roomManager } from './rooms.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 7788;
const BASE_URL = process.env.BASE_URL || 'https://watch-together.nlpha.shop';
const SESSION_SECRET = process.env.SESSION_SECRET || 'wt_secret_watch_together_key_3821';

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// Configure Telegram Auth
setupTelegramAuth(app, {
  clientId: process.env.TELEGRAM_CLIENT_ID || '9156143559',
  clientSecret: process.env.TELEGRAM_CLIENT_SECRET || '',
  baseUrl: BASE_URL,
  sessionSecret: SESSION_SECRET
});

// Video resolver API
app.post('/api/resolve', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const videoData = await resolveVideoUrl(url);
    res.json({ ok: true, video: videoData });
  } catch (err) {
    console.error('[Resolver Error]', err.message);
    res.status(500).json({ error: 'Failed to resolve video URL: ' + err.message });
  }
});

// Proxy Embed endpoint (strips X-Frame-Options and CSP for movie player embeds)
app.get('/api/proxy-embed', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL is required');

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8'
      },
      responseType: 'text',
      timeout: 10000
    });

    let html = response.data;
    if (typeof html === 'string') {
      const baseTag = `<base href="${targetUrl}">`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else {
        html = baseTag + html;
      }
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Type', response.headers['content-type'] || 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.redirect(targetUrl);
  }
});

// Room verification / info API
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code;
  const snapshot = roomManager.getRoomSnapshot(code);
  if (!snapshot) {
    return res.json({ exists: false, code: code.toUpperCase() });
  }
  res.json({ exists: true, room: snapshot });
});

// SPA routing fallback
app.get(['/r/:code', '/room/:code'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Socket.IO real-time synchronization
io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentUser = null;

  // Clock sync ping
  socket.on('sync-ping', (clientTime) => {
    socket.emit('sync-pong', {
      clientTime,
      serverTime: Date.now()
    });
  });

  // Join Room
  socket.on('join-room', ({ code, userProfile }) => {
    if (!code) return;
    const cleanCode = String(code).trim().toUpperCase();

    // Leave any previous room
    if (currentRoomCode) {
      socket.leave(currentRoomCode);
      const res = roomManager.removeParticipant(currentRoomCode, socket.id);
      if (res) {
        io.to(currentRoomCode).emit('room-update', roomManager.getRoomSnapshot(currentRoomCode));
      }
    }

    currentRoomCode = cleanCode;
    currentUser = userProfile || { name: 'Гость' };

    socket.join(cleanCode);
    const { room, participant } = roomManager.addParticipant(cleanCode, socket.id, currentUser);

    // Send initial full snapshot to the joining user
    socket.emit('room-joined', {
      room: roomManager.getRoomSnapshot(cleanCode),
      self: participant
    });

    // Notify room of updated state
    io.to(cleanCode).emit('room-update', roomManager.getRoomSnapshot(cleanCode));
  });

  // Change Video URL
  socket.on('video-change', async ({ code, url }) => {
    if (!code || !url) return;
    const cleanCode = String(code).trim().toUpperCase();
    const room = roomManager.getRoom(cleanCode);
    if (!room) return;

    // Check hostOnly permission
    const participant = room.participants.get(socket.id);
    if (room.hostOnly && (!participant || !participant.isHost)) {
      socket.emit('error-msg', 'Только хост может переключать видео');
      return;
    }

    try {
      const videoData = await resolveVideoUrl(url);
      roomManager.updateVideo(cleanCode, videoData, participant?.name || 'Участник');
      io.to(cleanCode).emit('video-changed', {
        video: roomManager.getRoomSnapshot(cleanCode).video,
        messages: room.messages.slice(-5)
      });
      io.to(cleanCode).emit('room-update', roomManager.getRoomSnapshot(cleanCode));
    } catch (err) {
      socket.emit('error-msg', 'Не удалось загрузить видео: ' + err.message);
    }
  });

  // Synchronize playback (play / pause / seek)
  socket.on('playback-sync', ({ code, isPlaying, currentTime, playbackRate }) => {
    if (!code) return;
    const cleanCode = String(code).trim().toUpperCase();
    const room = roomManager.getRoom(cleanCode);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (room.hostOnly && (!participant || !participant.isHost)) {
      // Revert sender to server state
      socket.emit('playback-sync', {
        isPlaying: room.video.isPlaying,
        currentTime: roomManager.getCalculatedTime(room),
        playbackRate: room.video.playbackRate,
        serverTimestamp: Date.now()
      });
      return;
    }

    roomManager.updatePlaybackState(cleanCode, { isPlaying, currentTime, playbackRate }, participant?.name || 'Участник');

    // Broadcast playback update to everyone in room (including sender to confirm exact server timestamp)
    io.to(cleanCode).emit('playback-sync', {
      isPlaying: room.video.isPlaying,
      currentTime: roomManager.getCalculatedTime(room),
      playbackRate: room.video.playbackRate,
      serverTimestamp: Date.now(),
      senderSocketId: socket.id
    });
  });

  // Track / Quality change
  socket.on('track-change', ({ code, quality, audioTrack }) => {
    if (!code) return;
    const cleanCode = String(code).trim().toUpperCase();
    const room = roomManager.getRoom(cleanCode);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    roomManager.updateTrackSettings(cleanCode, { quality, audioTrack }, participant?.name || 'Участник');

    io.to(cleanCode).emit('track-changed', {
      quality: room.video.currentQuality,
      audioTrack: room.video.currentAudioTrack
    });
    io.to(cleanCode).emit('room-update', roomManager.getRoomSnapshot(cleanCode));
  });

  // Chat message
  socket.on('chat-message', ({ code, text }) => {
    if (!code || !text) return;
    const cleanCode = String(code).trim().toUpperCase();
    const room = roomManager.getRoom(cleanCode);
    if (!room) return;

    const participant = room.participants.get(socket.id) || {
      id: socket.id,
      name: 'Гость',
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`
    };

    const message = roomManager.addMessage(cleanCode, participant, text);
    if (message) {
      io.to(cleanCode).emit('new-message', message);
    }
  });

  // Quick emoji reaction
  socket.on('chat-reaction', ({ code, emoji }) => {
    if (!code || !emoji) return;
    const cleanCode = String(code).trim().toUpperCase();
    const room = roomManager.getRoom(cleanCode);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    io.to(cleanCode).emit('floating-reaction', {
      emoji,
      senderName: participant?.name || 'Участник',
      socketId: socket.id
    });
  });

  // Host Only toggle
  socket.on('set-host-only', ({ code, hostOnly }) => {
    if (!code) return;
    const cleanCode = String(code).trim().toUpperCase();
    const room = roomManager.getRoom(cleanCode);
    if (!room || room.hostId !== socket.id) return;

    room.hostOnly = Boolean(hostOnly);
    roomManager.addSystemMessage(
      room,
      room.hostOnly
        ? 'Хост включил режим «Только хост может управлять»'
        : 'Хост включил режим свободного управления для всех'
    );
    io.to(cleanCode).emit('room-update', roomManager.getRoomSnapshot(cleanCode));
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoomCode) {
      const res = roomManager.removeParticipant(currentRoomCode, socket.id);
      if (res && res.room) {
        io.to(currentRoomCode).emit('room-update', roomManager.getRoomSnapshot(currentRoomCode));
      }
    }
  });
});

// Periodic sync heartbeat to keep all clients perfectly aligned
setInterval(() => {
  for (const [code, room] of roomManager.rooms.entries()) {
    if (room.participants.size > 0 && room.video.isPlaying) {
      io.to(code).emit('sync-heartbeat', {
        currentTime: roomManager.getCalculatedTime(room),
        isPlaying: true,
        playbackRate: room.video.playbackRate,
        serverTimestamp: Date.now()
      });
    }
  }
}, 4000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Watch Together] Server running on port ${PORT}`);
  console.log(`[Watch Together] Base URL: ${BASE_URL}`);
});
