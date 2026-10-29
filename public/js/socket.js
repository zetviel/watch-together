/**
 * WatchTogether — WebSocket Client & Real-time Protocol
 */

class SocketClient {
  constructor() {
    this.socket = null;
    this.serverTimeOffset = 0; // ms difference between client & server clocks
    this.latency = 0;
    this.connected = false;

    // Callbacks
    this.onRoomJoined = null;
    this.onRoomUpdate = null;
    this.onVideoChanged = null;
    this.onPlaybackSync = null;
    this.onSyncHeartbeat = null;
    this.onTrackChanged = null;
    this.onNewMessage = null;
    this.onFloatingReaction = null;
    this.onErrorMsg = null;
  }

  connect() {
    this.socket = window.io();

    this.socket.on('connect', () => {
      this.connected = true;
      this.measureClockOffset();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
    });

    // Clock offset measurement
    this.socket.on('sync-pong', ({ clientTime, serverTime }) => {
      const now = Date.now();
      this.latency = (now - clientTime) / 2;
      this.serverTimeOffset = serverTime - (now - this.latency);
    });

    // Protocol Events
    this.socket.on('room-joined', (data) => {
      if (this.onRoomJoined) this.onRoomJoined(data);
    });

    this.socket.on('room-update', (data) => {
      if (this.onRoomUpdate) this.onRoomUpdate(data);
    });

    this.socket.on('video-changed', (data) => {
      if (this.onVideoChanged) this.onVideoChanged(data);
    });

    this.socket.on('playback-sync', (data) => {
      if (this.onPlaybackSync) this.onPlaybackSync(data);
    });

    this.socket.on('sync-heartbeat', (data) => {
      if (this.onSyncHeartbeat) this.onSyncHeartbeat(data);
    });

    this.socket.on('track-changed', (data) => {
      if (this.onTrackChanged) this.onTrackChanged(data);
    });

    this.socket.on('new-message', (data) => {
      if (this.onNewMessage) this.onNewMessage(data);
    });

    this.socket.on('floating-reaction', (data) => {
      if (this.onFloatingReaction) this.onFloatingReaction(data);
    });

    this.socket.on('error-msg', (msg) => {
      if (this.onErrorMsg) this.onErrorMsg(msg);
    });

    // Measure latency periodically
    setInterval(() => {
      this.measureClockOffset();
    }, 15000);
  }

  measureClockOffset() {
    if (this.connected && this.socket) {
      this.socket.emit('sync-ping', Date.now());
    }
  }

  joinRoom(code, userProfile) {
    if (!this.socket) return;
    this.socket.emit('join-room', { code, userProfile });
  }

  sendVideoChange(code, url) {
    if (!this.socket) return;
    this.socket.emit('video-change', { code, url });
  }

  sendPlaybackSync(code, isPlaying, currentTime, playbackRate) {
    if (!this.socket) return;
    this.socket.emit('playback-sync', { code, isPlaying, currentTime, playbackRate });
  }

  sendTrackChange(code, quality, audioTrack) {
    if (!this.socket) return;
    this.socket.emit('track-change', { code, quality, audioTrack });
  }

  sendChatMessage(code, text) {
    if (!this.socket) return;
    this.socket.emit('chat-message', { code, text });
  }

  sendReaction(code, emoji) {
    if (!this.socket) return;
    this.socket.emit('chat-reaction', { code, emoji });
  }

  setHostOnly(code, hostOnly) {
    if (!this.socket) return;
    this.socket.emit('set-host-only', { code, hostOnly });
  }
}

window.SocketClient = SocketClient;
