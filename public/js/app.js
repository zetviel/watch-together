/**
 * WatchTogether — Application Entry Point & Orchestrator
 */

document.addEventListener('DOMContentLoaded', () => {
  // Instances
  const player = new window.UniversalPlayer();
  const chat = new window.ChatManager();
  const socketClient = new window.SocketClient();

  // App State
  let currentUser = null;
  let currentRoomCode = null;
  let isHost = false;

  // DOM Elements
  const viewHome = document.getElementById('view-home');
  const viewRoom = document.getElementById('view-room');
  const roomNavBadge = document.getElementById('room-nav-badge');
  const roomNavCode = roomNavBadge.querySelector('.room-nav-code');
  const userProfileHeader = document.getElementById('user-profile-header');

  const roomCodeInput = document.getElementById('room-code-input');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const btnCreateRoom = document.getElementById('btn-create-room');

  const roomCodeDisplay = document.getElementById('room-code-display');
  const btnCopyRoomLink = document.getElementById('btn-copy-room-link');
  const btnShareRoom = document.getElementById('btn-share-room');
  const btnLeaveRoom = document.getElementById('btn-leave-room');
  const btnToggleHostOnly = document.getElementById('btn-toggle-hostonly');
  const hostOnlyStatusText = document.getElementById('hostonly-status-text');

  const videoUrlInput = document.getElementById('video-url-input');
  const btnLoadVideo = document.getElementById('btn-load-video');
  const btnSpinner = btnLoadVideo.querySelector('.btn-spinner');
  const btnText = btnLoadVideo.querySelector('.btn-text');

  const authModal = document.getElementById('auth-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const guestLoginForm = document.getElementById('guest-login-form');
  const guestNameInput = document.getElementById('guest-name-input');
  const btnTelegramOauth = document.getElementById('btn-telegram-oauth');

  // Initialize
  initApp();

  async function initApp() {
    await checkAuth();
    socketClient.connect();
    setupSocketCallbacks();
    setupPlayerCallbacks();
    setupChatCallbacks();
    setupUIListeners();
    checkUrlForRoom();
  }

  // 1. Check Authentication state
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      if (data && data.user) {
        currentUser = data.user;
      } else {
        currentUser = {
          id: 'guest_' + Math.floor(Math.random() * 100000),
          name: 'Гость ' + Math.floor(100 + Math.random() * 900),
          avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=guest${Date.now()}`,
          isTelegram: false
        };
      }
      renderHeaderUser();
      chat.setCurrentUser(currentUser);
    } catch {
      currentUser = {
        id: 'guest_' + Math.floor(Math.random() * 100000),
        name: 'Гость',
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=guest`,
        isTelegram: false
      };
      renderHeaderUser();
      chat.setCurrentUser(currentUser);
    }
  }

  function renderHeaderUser() {
    if (!currentUser) return;

    if (currentUser.isTelegram) {
      userProfileHeader.innerHTML = `
        <div class="user-card-pill" title="Авторизован через Telegram">
          <img class="user-avatar-small" src="${currentUser.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=tg'}" alt="Avatar" />
          <span class="user-meta-name">${escapeHtml(currentUser.name)}</span>
          <span class="badge-tg">✈️</span>
        </div>
        <button id="btn-logout" class="btn btn-sm btn-ghost" title="Выйти">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </button>
      `;
      document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
    } else {
      userProfileHeader.innerHTML = `
        <div class="user-card-pill" id="btn-open-auth-modal" style="cursor: pointer;" title="Войти через Telegram">
          <img class="user-avatar-small" src="${currentUser.avatar}" alt="Avatar" />
          <span class="user-meta-name">${escapeHtml(currentUser.name)}</span>
        </div>
        <button id="btn-header-login" class="btn btn-sm btn-telegram">
          <svg class="tg-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .37z"></path></svg>
          Войти
        </button>
      `;
      document.getElementById('btn-open-auth-modal')?.addEventListener('click', openAuthModal);
      document.getElementById('btn-header-login')?.addEventListener('click', openAuthModal);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      showToast('Вы вышли из профиля');
      await checkAuth();
    } catch {}
  }

  // 2. Setup Socket.IO Event Handlers
  function setupSocketCallbacks() {
    socketClient.onRoomJoined = ({ room, self }) => {
      currentRoomCode = room.code;
      isHost = self.isHost;
      switchView('room');

      roomCodeDisplay.textContent = room.code;
      roomNavCode.textContent = room.code;
      roomNavBadge.classList.remove('hidden');

      updateHostControls(room.hostOnly, isHost);
      chat.renderParticipants(room.participants);
      chat.renderMessages(room.messages);

      if (room.video && room.video.url) {
        player.syncWithRoomState(room);
      }
      showToast(`Вы вошли в комнату ${room.code}`);
    };

    socketClient.onRoomUpdate = (room) => {
      if (!room) return;
      chat.renderParticipants(room.participants);

      const me = room.participants.find((p) => p.socketId === socketClient.socket?.id || p.id === currentUser?.id);
      if (me) isHost = me.isHost;

      updateHostControls(room.hostOnly, isHost);

      if (room.video && room.video.url) {
        player.syncWithRoomState(room);
      }
    };

    socketClient.onVideoChanged = ({ video, messages }) => {
      showToast(`Загружено видео: ${video.title || video.url}`);
      player.loadVideo(video);
      if (messages) {
        messages.forEach((m) => chat.addMessage(m));
      }
    };

    socketClient.onPlaybackSync = (data) => {
      // Synchronize player with room state
      player.syncWithRoomState({ video: data });
    };

    socketClient.onSyncHeartbeat = (data) => {
      // Periodic zero-drift sync
      if (player.isPlaying) {
        player.syncWithRoomState({ video: data });
      }
    };

    socketClient.onTrackChanged = ({ quality, audioTrack }) => {
      if (quality) player.setQuality(quality, false);
      if (audioTrack) player.setAudioTrack(audioTrack, false);
    };

    socketClient.onNewMessage = (msg) => {
      chat.addMessage(msg);
    };

    socketClient.onFloatingReaction = ({ emoji }) => {
      chat.showFloatingReaction(emoji);
    };

    socketClient.onErrorMsg = (msg) => {
      showToast(msg, true);
    };
  }

  // 3. Player Events
  function setupPlayerCallbacks() {
    // When local user plays, pauses, or seeks
    player.onUserPlaybackChange = (isPlaying, currentTime, playbackRate) => {
      if (!currentRoomCode) return;
      socketClient.sendPlaybackSync(currentRoomCode, isPlaying, currentTime, playbackRate);
    };

    // When local user changes quality or audio track
    player.onUserTrackChange = (quality, audioTrack) => {
      if (!currentRoomCode) return;
      socketClient.sendTrackChange(currentRoomCode, quality, audioTrack);
    };

    // Re-sync button click
    const btnResync = document.getElementById('ctrl-resync-btn');
    btnResync?.addEventListener('click', () => {
      if (!currentRoomCode) return;
      fetch(`/api/room/${currentRoomCode}`)
        .then((r) => r.json())
        .then((data) => {
          if (data && data.room) {
            player.syncWithRoomState(data.room);
            showToast('Плеер синхронизирован с комнатой');
          }
        });
    });
  }

  // 4. Chat Events
  function setupChatCallbacks() {
    chat.onSendMessage = (text) => {
      if (!currentRoomCode) return;
      socketClient.sendChatMessage(currentRoomCode, text);
    };

    chat.onSendReaction = (emoji) => {
      if (!currentRoomCode) return;
      socketClient.sendReaction(currentRoomCode, emoji);
    };
  }

  // 5. UI Listeners
  function setupUIListeners() {
    // Join room button
    btnJoinRoom.addEventListener('click', () => {
      const code = roomCodeInput.value.trim().toUpperCase();
      if (!code) {
        showToast('Пожалуйста, введите код комнаты', true);
        roomCodeInput.focus();
        return;
      }
      joinRoom(code);
    });

    roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnJoinRoom.click();
      }
    });

    // Create room button
    btnCreateRoom.addEventListener('click', () => {
      const randomCode = 'WT-' + Math.floor(100 + Math.random() * 900);
      joinRoom(randomCode);
    });

    // Load video button
    btnLoadVideo.addEventListener('click', () => {
      const url = videoUrlInput.value.trim();
      if (!url) {
        showToast('Введите ссылку на видео', true);
        videoUrlInput.focus();
        return;
      }
      loadVideoUrl(url);
    });

    videoUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnLoadVideo.click();
      }
    });

    // Quick demo chip links
    document.querySelectorAll('.chip-link').forEach((chip) => {
      chip.addEventListener('click', () => {
        const url = chip.dataset.url;
        videoUrlInput.value = url;
        loadVideoUrl(url);
      });
    });

    // Copy room link
    btnCopyRoomLink.addEventListener('click', () => {
      copyRoomLink();
    });

    // Share room button
    btnShareRoom.addEventListener('click', () => {
      const shareUrl = `${window.location.origin}/r/${currentRoomCode}`;
      if (navigator.share) {
        navigator.share({
          title: 'WatchTogether Room',
          text: `Присоединяйтесь к просмотру в комнате ${currentRoomCode}!`,
          url: shareUrl
        }).catch(() => {});
      } else {
        copyRoomLink();
      }
    });

    // Leave room
    btnLeaveRoom.addEventListener('click', () => {
      leaveRoom();
    });

    // Toggle Host-Only mode
    btnToggleHostOnly.addEventListener('click', () => {
      if (!isHost) {
        showToast('Только хост может переключать этот режим', true);
        return;
      }
      const newMode = !btnToggleHostOnly.classList.contains('active');
      socketClient.setHostOnly(currentRoomCode, newMode);
    });

    // Auth Modal handling
    modalCloseBtn.addEventListener('click', closeAuthModal);
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) closeAuthModal();
    });

    guestLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = guestNameInput.value.trim();
      if (!name) return;

      try {
        const res = await fetch('/api/auth/guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.ok && data.user) {
          currentUser = data.user;
          renderHeaderUser();
          chat.setCurrentUser(currentUser);
          closeAuthModal();
          showToast(`Добро пожаловать, ${currentUser.name}!`);
        }
      } catch {
        showToast('Ошибка при входе', true);
      }
    });
  }

  function joinRoom(code) {
    if (!code) return;
    const cleanCode = code.trim().toUpperCase();
    currentRoomCode = cleanCode;

    // Update URL without page reload
    window.history.pushState({}, '', `/r/${cleanCode}`);

    // Update returnTo in Telegram OAuth link
    btnTelegramOauth.href = `/api/auth/telegram?returnTo=${encodeURIComponent('/r/' + cleanCode)}`;

    socketClient.joinRoom(cleanCode, currentUser);
  }

  function leaveRoom() {
    currentRoomCode = null;
    window.history.pushState({}, '', '/');
    switchView('home');
    roomNavBadge.classList.add('hidden');
    roomCodeInput.value = '';
    showToast('Вы покинули комнату');
  }

  function loadVideoUrl(url) {
    if (!currentRoomCode) return;
    btnSpinner.classList.remove('hidden');
    btnText.textContent = 'Загрузка...';

    socketClient.sendVideoChange(currentRoomCode, url);

    setTimeout(() => {
      btnSpinner.classList.add('hidden');
      btnText.textContent = 'Загрузить';
      videoUrlInput.value = '';
    }, 1500);
  }

  function copyRoomLink() {
    const link = `${window.location.origin}/r/${currentRoomCode}`;
    navigator.clipboard.writeText(link).then(() => {
      showToast('Ссылка на комнату скопирована в буфер обмена!');
    }).catch(() => {
      showToast(link);
    });
  }

  function updateHostControls(hostOnly, userIsHost) {
    if (hostOnly) {
      btnToggleHostOnly.classList.add('active');
      hostOnlyStatusText.textContent = 'Только хост';
    } else {
      btnToggleHostOnly.classList.remove('active');
      hostOnlyStatusText.textContent = 'Свободное управление';
    }
  }

  function switchView(viewName) {
    if (viewName === 'room') {
      viewHome.classList.add('hidden');
      viewRoom.classList.remove('hidden');
    } else {
      viewRoom.classList.add('hidden');
      viewHome.classList.remove('hidden');
    }
  }

  function checkUrlForRoom() {
    // Check if path is /r/:code or /room/:code
    const path = window.location.pathname;
    const match = path.match(/^\/(?:r|room)\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      joinRoom(match[1]);
      return;
    }

    // Check query params ?room=CODE
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      joinRoom(roomParam);
    }
  }

  function openAuthModal() {
    authModal.classList.remove('hidden');
    guestNameInput.focus();
  }

  function closeAuthModal() {
    authModal.classList.add('hidden');
  }

  function showToast(text, isError = false) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : ''}`;
    toast.textContent = text;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
});
