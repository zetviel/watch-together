/**
 * In-memory room manager for synchronized video playback & chat
 */

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  getRoom(rawCode) {
    if (!rawCode) return null;
    const code = String(rawCode).trim().toUpperCase();
    return this.rooms.get(code) || null;
  }

  getOrCreateRoom(rawCode, initialHost = null) {
    if (!rawCode) return null;
    const code = String(rawCode).trim().toUpperCase();

    if (!this.rooms.has(code)) {
      this.rooms.set(code, {
        code,
        createdAt: Date.now(),
        hostId: initialHost ? initialHost.socketId : null,
        hostOnly: false,
        video: {
          type: 'none',
          url: '',
          title: 'Видео не загружено',
          duration: 0,
          currentTime: 0,
          isPlaying: false,
          playbackRate: 1.0,
          lastUpdateTimestamp: Date.now(),
          qualities: ['Auto'],
          audioTracks: ['Default'],
          currentQuality: 'Auto',
          currentAudioTrack: 'Default'
        },
        participants: new Map(),
        messages: [],
        cleanTimeout: null
      });
    }

    const room = this.rooms.get(code);
    if (room.cleanTimeout) {
      clearTimeout(room.cleanTimeout);
      room.cleanTimeout = null;
    }

    return room;
  }

  addParticipant(code, socketId, userProfile) {
    const room = this.getOrCreateRoom(code);
    if (!room) return null;

    const isFirst = room.participants.size === 0;
    if (isFirst || !room.hostId) {
      room.hostId = socketId;
    }

    const participant = {
      socketId,
      id: userProfile.id || socketId,
      name: userProfile.name || 'Гость',
      username: userProfile.username || '',
      avatar: userProfile.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${socketId}`,
      isTelegram: Boolean(userProfile.isTelegram),
      isHost: room.hostId === socketId,
      joinedAt: Date.now()
    };

    room.participants.set(socketId, participant);

    // Add system message
    this.addSystemMessage(room, `${participant.name} вошел в комнату`);

    return { room, participant };
  }

  removeParticipant(code, socketId) {
    const room = this.getRoom(code);
    if (!room) return null;

    const participant = room.participants.get(socketId);
    if (!participant) return null;

    room.participants.delete(socketId);
    this.addSystemMessage(room, `${participant.name} покинул комнату`);

    // Elect new host if the host left
    if (room.hostId === socketId) {
      const nextParticipant = room.participants.values().next().value;
      if (nextParticipant) {
        room.hostId = nextParticipant.socketId;
        nextParticipant.isHost = true;
        this.addSystemMessage(room, `${nextParticipant.name} теперь хост комнаты`);
      } else {
        room.hostId = null;
      }
    }

    // Schedule cleanup if room is empty
    if (room.participants.size === 0) {
      room.cleanTimeout = setTimeout(() => {
        this.rooms.delete(code);
      }, 60 * 60 * 1000); // 1 hour
    }

    return { room, participant };
  }

  getCalculatedTime(room) {
    if (!room || !room.video) return 0;
    const v = room.video;
    if (!v.isPlaying) {
      return v.currentTime;
    }
    const elapsedSeconds = (Date.now() - v.lastUpdateTimestamp) / 1000;
    const calcTime = v.currentTime + elapsedSeconds * (v.playbackRate || 1.0);
    return Math.max(0, calcTime);
  }

  updateVideo(code, videoData, actorName = 'Участник') {
    const room = this.getRoom(code);
    if (!room) return null;

    room.video = {
      ...room.video,
      ...videoData,
      currentTime: 0,
      isPlaying: false,
      lastUpdateTimestamp: Date.now(),
      currentQuality: videoData.qualities?.[0] || 'Auto',
      currentAudioTrack: videoData.audioTracks?.[0] || 'Default'
    };

    this.addSystemMessage(room, `${actorName} включил видео: "${room.video.title || room.video.url}"`);
    return room;
  }

  updatePlaybackState(code, { isPlaying, currentTime, playbackRate }, actorName = 'Участник') {
    const room = this.getRoom(code);
    if (!room) return null;

    const prevPlaying = room.video.isPlaying;
    const prevTime = room.video.currentTime;

    room.video.isPlaying = Boolean(isPlaying);
    if (typeof currentTime === 'number' && !isNaN(currentTime)) {
      room.video.currentTime = Math.max(0, currentTime);
    }
    if (typeof playbackRate === 'number' && playbackRate > 0) {
      room.video.playbackRate = playbackRate;
    }
    room.video.lastUpdateTimestamp = Date.now();

    // Log user actions in chat if significant
    if (prevPlaying !== room.video.isPlaying) {
      const stateStr = room.video.isPlaying ? 'запустил воспроизведение' : 'поставил на паузу';
      const timeStr = this.formatTime(room.video.currentTime);
      this.addSystemMessage(room, `${actorName} ${stateStr} (${timeStr})`);
    } else if (Math.abs(prevTime - (currentTime || 0)) > 3) {
      const timeStr = this.formatTime(room.video.currentTime);
      this.addSystemMessage(room, `${actorName} перемотал на ${timeStr}`);
    }

    return room;
  }

  updateTrackSettings(code, { quality, audioTrack }, actorName = 'Участник') {
    const room = this.getRoom(code);
    if (!room) return null;

    if (quality) {
      room.video.currentQuality = quality;
      this.addSystemMessage(room, `${actorName} выбрал качество: ${quality}`);
    }
    if (audioTrack) {
      room.video.currentAudioTrack = audioTrack;
      this.addSystemMessage(room, `${actorName} выбрал озвучку/аудиодорожку: ${audioTrack}`);
    }

    return room;
  }

  addMessage(code, sender, text) {
    const room = this.getRoom(code);
    if (!room) return null;

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user: {
        id: sender.id,
        name: sender.name,
        username: sender.username,
        avatar: sender.avatar,
        isTelegram: sender.isTelegram,
        isHost: sender.isHost
      },
      text: String(text).trim().slice(0, 500),
      timestamp: Date.now(),
      isSystem: false
    };

    room.messages.push(message);
    if (room.messages.length > 200) {
      room.messages.shift();
    }

    return message;
  }

  addSystemMessage(room, text) {
    const message = {
      id: `sys_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user: {
        name: 'Система',
        avatar: '',
        isSystem: true
      },
      text,
      timestamp: Date.now(),
      isSystem: true
    };

    room.messages.push(message);
    if (room.messages.length > 200) {
      room.messages.shift();
    }

    return message;
  }

  getRoomSnapshot(code) {
    const room = this.getRoom(code);
    if (!room) return null;

    return {
      code: room.code,
      hostId: room.hostId,
      hostOnly: room.hostOnly,
      video: {
        ...room.video,
        currentTime: this.getCalculatedTime(room)
      },
      participants: Array.from(room.participants.values()),
      messages: room.messages.slice(-50),
      serverTimestamp: Date.now()
    };
  }

  formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const remM = m % 60;
    const remS = s % 60;
    if (h > 0) {
      return `${h}:${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
    }
    return `${String(remM).padStart(2, '0')}:${String(remS).padStart(2, '0')}`;
  }
}

export const roomManager = new RoomManager();
