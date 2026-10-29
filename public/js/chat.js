/**
 * WatchTogether — Chat & Social Controller
 */

class ChatManager {
  constructor() {
    this.chatMessagesContainer = document.getElementById('chat-messages');
    this.chatForm = document.getElementById('chat-form');
    this.chatInput = document.getElementById('chat-input');
    this.participantsContainer = document.getElementById('participants-list');
    this.participantsCount = document.getElementById('participants-count');
    this.reactionsOverlay = document.getElementById('reactions-overlay');

    this.tabChatBtn = document.getElementById('tab-chat-btn');
    this.tabUsersBtn = document.getElementById('tab-users-btn');
    this.tabChatContent = document.getElementById('tab-chat-content');
    this.tabUsersContent = document.getElementById('tab-users-content');

    this.currentUser = null;
    this.onSendMessage = null; // (text) => void
    this.onSendReaction = null; // (emoji) => void

    this.bindEvents();
  }

  bindEvents() {
    // Tabs
    this.tabChatBtn.addEventListener('click', () => {
      this.tabChatBtn.classList.add('active');
      this.tabUsersBtn.classList.remove('active');
      this.tabChatContent.classList.add('active');
      this.tabUsersContent.classList.remove('active');
    });

    this.tabUsersBtn.addEventListener('click', () => {
      this.tabUsersBtn.classList.add('active');
      this.tabChatBtn.classList.remove('active');
      this.tabUsersContent.classList.add('active');
      this.tabChatContent.classList.remove('active');
    });

    // Chat submit
    this.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.chatInput.value.trim();
      if (!text) return;

      if (this.onSendMessage) {
        this.onSendMessage(text);
      }
      this.chatInput.value = '';
    });

    // Quick reactions
    document.querySelectorAll('.btn-emoji').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (emoji && this.onSendReaction) {
          this.onSendReaction(emoji);
        }
      });
    });
  }

  setCurrentUser(user) {
    this.currentUser = user;
  }

  addMessage(msg) {
    if (!msg) return;

    if (msg.isSystem) {
      const sysDiv = document.createElement('div');
      sysDiv.className = 'chat-system-msg';
      sysDiv.textContent = msg.text;
      this.chatMessagesContainer.appendChild(sysDiv);
    } else {
      const isSelf = this.currentUser && (this.currentUser.id === msg.user?.id || this.currentUser.socketId === msg.user?.id);
      const msgDiv = document.createElement('div');
      msgDiv.className = `chat-msg ${isSelf ? 'self' : ''}`;

      const avatarSrc = msg.user?.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.user?.name || 'User'}`;
      const timeStr = this.formatTime(msg.timestamp);

      msgDiv.innerHTML = `
        <img class="chat-msg-avatar" src="${this.escapeHtml(avatarSrc)}" alt="Avatar" />
        <div class="chat-msg-body">
          <div class="chat-msg-header">
            <span class="chat-msg-author">${this.escapeHtml(msg.user?.name || 'Гость')}</span>
            ${msg.user?.isTelegram ? '<span class="badge-tg" title="Telegram Verified">✈️</span>' : ''}
            ${msg.user?.isHost ? '<span class="badge-host">ХОСТ</span>' : ''}
            <span class="chat-msg-time">${timeStr}</span>
          </div>
          <div class="chat-msg-bubble">${this.escapeHtml(msg.text)}</div>
        </div>
      `;

      this.chatMessagesContainer.appendChild(msgDiv);
    }

    this.scrollToBottom();
  }

  renderMessages(messages) {
    this.chatMessagesContainer.innerHTML = '';
    if (Array.isArray(messages)) {
      messages.forEach((m) => this.addMessage(m));
    }
  }

  renderParticipants(participants) {
    this.participantsContainer.innerHTML = '';
    const list = Array.isArray(participants) ? participants : [];
    this.participantsCount.textContent = list.length;

    list.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'participant-item';

      const avatarSrc = p.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${p.name}`;

      item.innerHTML = `
        <img class="participant-avatar" src="${this.escapeHtml(avatarSrc)}" alt="${this.escapeHtml(p.name)}" />
        <div class="participant-info">
          <div class="participant-name-row">
            <span class="participant-name">${this.escapeHtml(p.name)}</span>
            ${p.isTelegram ? '<span class="badge-tg" title="Авторизован через Telegram">✈️</span>' : ''}
            ${p.isHost ? '<span class="badge-host">ХОСТ</span>' : ''}
          </div>
        </div>
        <span class="dot-online" title="В сети"></span>
      `;

      this.participantsContainer.appendChild(item);
    });
  }

  showFloatingReaction(emoji) {
    if (!this.reactionsOverlay) return;

    const el = document.createElement('div');
    el.className = 'floating-reaction-item';
    el.textContent = emoji;

    // Randomize horizontal position between 10% and 85%
    const randomLeft = 10 + Math.random() * 75;
    el.style.left = `${randomLeft}%`;

    this.reactionsOverlay.appendChild(el);

    // Remove element after animation completes (3 seconds)
    setTimeout(() => {
      el.remove();
    }, 3000);
  }

  scrollToBottom() {
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
  }

  formatTime(ts) {
    const d = new Date(ts || Date.now());
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

window.ChatManager = ChatManager;
