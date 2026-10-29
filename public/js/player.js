/**
 * WatchTogether — Universal Synchronized Video Player Engine
 * Supports: YouTube, RuTube, VK Video, HTML5 Video, HLS (.m3u8), and Generic Web Embeds.
 */

class UniversalPlayer {
  constructor() {
    this.currentType = 'none';
    this.videoData = null;
    this.isPlaying = false;
    this.duration = 0;
    this.currentTime = 0;
    this.playbackRate = 1.0;
    this.volume = 1.0;
    this.isMuted = false;
    this.isSeeking = false;
    this.isInternalSync = false;

    // Sub-players
    this.ytPlayer = null;
    this.hlsInstance = null;
    this.html5Video = document.getElementById('html5-video');
    this.vkIframe = document.getElementById('vk-player-iframe');
    this.rutubeIframe = document.getElementById('rutube-player-iframe');
    this.genericIframe = document.getElementById('generic-player-iframe');

    // UI elements
    this.uiWrapper = document.getElementById('player-wrapper');
    this.uiEmptyPlaceholder = document.getElementById('player-empty-placeholder');
    this.uiYtContainer = document.getElementById('yt-player-container');
    this.uiVkContainer = document.getElementById('vk-player-container');
    this.uiRutubeContainer = document.getElementById('rutube-player-container');
    this.uiHtml5Container = document.getElementById('html5-player-container');
    this.uiGenericContainer = document.getElementById('generic-player-container');

    // Controls
    this.btnPlayPause = document.getElementById('ctrl-play-pause');
    this.iconPlay = document.getElementById('icon-play');
    this.iconPause = document.getElementById('icon-pause');
    this.timeCurrent = document.getElementById('time-current');
    this.timeDuration = document.getElementById('time-duration');
    this.timelineContainer = document.getElementById('timeline-container');
    this.timelinePlayed = document.getElementById('timeline-played');
    this.timelineBuffered = document.getElementById('timeline-buffered');
    this.timelineHandle = document.getElementById('timeline-handle');
    this.timelineTooltip = document.getElementById('timeline-tooltip');

    this.btnVolume = document.getElementById('ctrl-volume-btn');
    this.iconVolHigh = document.getElementById('icon-vol-high');
    this.iconVolMute = document.getElementById('icon-vol-mute');
    this.volumeSlider = document.getElementById('volume-slider');

    this.btnResync = document.getElementById('ctrl-resync-btn');
    this.btnFullscreen = document.getElementById('ctrl-fullscreen-btn');

    this.dropdownQuality = document.getElementById('dropdown-quality-wrap');
    this.btnQualityTrigger = document.getElementById('btn-quality-trigger');
    this.labelQuality = document.getElementById('label-quality');
    this.menuQuality = document.getElementById('menu-quality');

    this.dropdownAudio = document.getElementById('dropdown-audio-wrap');
    this.btnAudioTrigger = document.getElementById('btn-audio-trigger');
    this.labelAudio = document.getElementById('label-audio');
    this.menuAudio = document.getElementById('menu-audio');

    this.dropdownSpeed = document.getElementById('dropdown-speed-wrap');
    this.btnSpeedTrigger = document.getElementById('btn-speed-trigger');
    this.labelSpeed = document.getElementById('label-speed');
    this.menuSpeed = document.getElementById('menu-speed');

    this.videoTitleDisplay = document.getElementById('video-title-display');
    this.videoTypeBadge = document.getElementById('video-type-badge');
    this.videoDurationBadge = document.getElementById('video-duration-badge');

    // Event callbacks
    this.onUserPlaybackChange = null; // (isPlaying, currentTime, playbackRate) => void
    this.onUserTrackChange = null;    // (quality, audioTrack) => void

    this.initYouTubeApi();
    this.bindEvents();
    this.startTimeLoop();
  }

  // Load YouTube Iframe API
  initYouTubeApi() {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
  }

  bindEvents() {
    // Play/Pause button
    this.btnPlayPause.addEventListener('click', () => {
      this.togglePlayPause(true);
    });

    // Volume button & slider
    this.btnVolume.addEventListener('click', () => {
      this.setMuted(!this.isMuted);
    });

    this.volumeSlider.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value));
    });

    // Timeline Seeking
    let isDraggingTimeline = false;
    const handleSeek = (e) => {
      const rect = this.timelineContainer.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetTime = pos * this.duration;
      this.timelinePlayed.style.width = `${pos * 100}%`;
      this.timelineHandle.style.left = `${pos * 100}%`;
      this.timeCurrent.textContent = this.formatTime(targetTime);
      return targetTime;
    };

    this.timelineContainer.addEventListener('mousedown', (e) => {
      isDraggingTimeline = true;
      this.isSeeking = true;
      handleSeek(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingTimeline) {
        handleSeek(e);
      }
      // Tooltip position
      const rect = this.timelineContainer.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top - 20 && e.clientY <= rect.bottom + 10) {
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.timelineTooltip.style.display = 'block';
        this.timelineTooltip.style.left = `${pos * 100}%`;
        this.timelineTooltip.textContent = this.formatTime(pos * this.duration);
      } else {
        this.timelineTooltip.style.display = 'none';
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isDraggingTimeline) {
        isDraggingTimeline = false;
        this.isSeeking = false;
        const targetTime = handleSeek(e);
        this.seekTo(targetTime, true);
      }
    });

    // Dropdowns toggling
    const setupDropdown = (trigger, menu) => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('hidden');
      });
    };

    setupDropdown(this.btnQualityTrigger, this.menuQuality);
    setupDropdown(this.btnAudioTrigger, this.menuAudio);
    setupDropdown(this.btnSpeedTrigger, this.menuSpeed);

    document.addEventListener('click', () => {
      this.menuQuality.classList.add('hidden');
      this.menuAudio.classList.add('hidden');
      this.menuSpeed.classList.add('hidden');
    });

    // Speed selections
    this.menuSpeed.querySelectorAll('.dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        const speed = parseFloat(item.dataset.speed);
        this.setPlaybackRate(speed, true);
        this.labelSpeed.textContent = `${speed}x`;
        this.menuSpeed.querySelectorAll('.dropdown-item').forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // Fullscreen
    this.btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        this.uiWrapper.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // HTML5 Video Events
    this.html5Video.addEventListener('timeupdate', () => {
      if (!this.isSeeking) {
        this.currentTime = this.html5Video.currentTime;
        this.duration = this.html5Video.duration || this.duration;
        this.updateTimelineUI();
      }
    });

    this.html5Video.addEventListener('play', () => {
      if (!this.isInternalSync && !this.isPlaying) {
        this.isPlaying = true;
        this.updatePlayPauseIcon();
        if (this.onUserPlaybackChange) {
          this.onUserPlaybackChange(true, this.html5Video.currentTime, this.playbackRate);
        }
      }
    });

    this.html5Video.addEventListener('pause', () => {
      if (!this.isInternalSync && this.isPlaying) {
        this.isPlaying = false;
        this.updatePlayPauseIcon();
        if (this.onUserPlaybackChange) {
          this.onUserPlaybackChange(false, this.html5Video.currentTime, this.playbackRate);
        }
      }
    });

    // PostMessage listener for RuTube & VK Video embeds
    window.addEventListener('message', (event) => {
      this.handleEmbedPostMessage(event);
    });
  }

  // Load a video source
  async loadVideo(videoData) {
    if (!videoData || !videoData.type) return;

    this.videoData = videoData;
    this.currentType = videoData.type;
    this.duration = videoData.duration || 0;
    this.currentTime = videoData.currentTime || 0;
    this.isPlaying = false;
    this.updatePlayPauseIcon();

    // Update metadata titles
    this.videoTitleDisplay.textContent = videoData.title || videoData.url;
    this.videoTypeBadge.textContent = videoData.type.toUpperCase();
    this.videoDurationBadge.textContent = this.formatTime(this.duration);

    // Update Quality & Audio menus
    this.renderQualityMenu(videoData.qualities || ['Auto'], videoData.currentQuality || 'Auto');
    this.renderAudioMenu(videoData.audioTracks || ['Default'], videoData.currentAudioTrack || 'Default');

    // Hide all player containers
    this.uiEmptyPlaceholder.classList.add('hidden');
    this.uiYtContainer.classList.add('hidden');
    this.uiVkContainer.classList.add('hidden');
    this.uiRutubeContainer.classList.add('hidden');
    this.uiHtml5Container.classList.add('hidden');
    this.uiGenericContainer.classList.add('hidden');

    // Pause any HTML5 playback
    this.html5Video.pause();
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }

    if (this.currentType === 'youtube') {
      this.uiYtContainer.classList.remove('hidden');
      this.loadYouTubeVideo(videoData.id);
    } else if (this.currentType === 'vk') {
      this.uiVkContainer.classList.remove('hidden');
      this.loadVkVideo(videoData.embedUrl);
    } else if (this.currentType === 'rutube') {
      this.uiRutubeContainer.classList.remove('hidden');
      this.loadRutubeVideo(videoData.embedUrl);
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      this.uiHtml5Container.classList.remove('hidden');
      this.loadHtml5Video(videoData.streamUrl || videoData.url, this.currentType === 'hls');
    } else {
      this.uiGenericContainer.classList.remove('hidden');
      this.genericIframe.src = videoData.embedUrl || videoData.url;
    }
  }

  // YouTube Video Loader
  loadYouTubeVideo(videoId) {
    const onPlayerReady = () => {
      this.ytPlayer.cueVideoById(videoId, this.currentTime);
      this.duration = this.ytPlayer.getDuration() || 0;
      this.timeDuration.textContent = this.formatTime(this.duration);
    };

    const onStateChange = (event) => {
      if (this.isInternalSync) return;
      // YT.PlayerState: PLAYING=1, PAUSED=2
      if (event.data === 1 && !this.isPlaying) {
        this.isPlaying = true;
        this.updatePlayPauseIcon();
        if (this.onUserPlaybackChange) {
          this.onUserPlaybackChange(true, this.ytPlayer.getCurrentTime(), this.playbackRate);
        }
      } else if (event.data === 2 && this.isPlaying) {
        this.isPlaying = false;
        this.updatePlayPauseIcon();
        if (this.onUserPlaybackChange) {
          this.onUserPlaybackChange(false, this.ytPlayer.getCurrentTime(), this.playbackRate);
        }
      }
    };

    if (window.YT && window.YT.Player) {
      if (!this.ytPlayer) {
        this.ytPlayer = new window.YT.Player('yt-player', {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0, // Using our unified controls
            disablekb: 0,
            rel: 0,
            modestbranding: 1
          },
          events: {
            onReady: onPlayerReady,
            onStateChange
          }
        });
      } else {
        this.ytPlayer.cueVideoById(videoId, this.currentTime);
      }
    } else {
      // Retry in 500ms if API not ready yet
      setTimeout(() => this.loadYouTubeVideo(videoId), 500);
    }
  }

  // VK Video Loader
  loadVkVideo(embedUrl) {
    this.vkIframe.src = embedUrl;
  }

  // RuTube Video Loader
  loadRutubeVideo(embedUrl) {
    this.rutubeIframe.src = embedUrl;
  }

  // HTML5 / Hls.js Video Loader
  loadHtml5Video(url, isHls) {
    if (isHls && window.Hls && window.Hls.isSupported()) {
      this.hlsInstance = new window.Hls();
      this.hlsInstance.loadSource(url);
      this.hlsInstance.attachMedia(this.html5Video);
      this.hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.duration = this.html5Video.duration || 0;
        this.timeDuration.textContent = this.formatTime(this.duration);

        // Dynamically populate qualities from HLS levels
        if (data && data.levels && data.levels.length > 0) {
          const qualities = data.levels.map((l) => `${l.height}p`);
          qualities.sort((a, b) => parseInt(b) - parseInt(a));
          qualities.push('Auto');
          this.renderQualityMenu(qualities, 'Auto');
        }

        // Dynamically populate audio tracks
        if (this.hlsInstance.audioTracks && this.hlsInstance.audioTracks.length > 0) {
          const tracks = this.hlsInstance.audioTracks.map((t, idx) => t.name || `Озвучка ${idx + 1}`);
          this.renderAudioMenu(tracks, tracks[0]);
        }
      });
    } else {
      this.html5Video.src = url;
      this.html5Video.load();
    }
  }

  // PostMessage bridge for VK & RuTube embeds
  handleEmbedPostMessage(event) {
    if (!event.data) return;
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

      // RuTube events
      if (data.type === 'player:changeState') {
        const state = data.data?.state;
        if (state === 'playing') {
          this.isPlaying = true;
          this.updatePlayPauseIcon();
        } else if (state === 'paused' || state === 'stopped') {
          this.isPlaying = false;
          this.updatePlayPauseIcon();
        }
      } else if (data.type === 'player:currentTime') {
        if (!this.isSeeking) {
          this.currentTime = data.data?.time || 0;
          this.updateTimelineUI();
        }
      }
    } catch {}
  }

  // Play / Pause / Seek / Sync methods
  togglePlayPause(notifyUser = true) {
    if (this.isPlaying) {
      this.pause(notifyUser);
    } else {
      this.play(notifyUser);
    }
  }

  play(notifyUser = false) {
    this.isPlaying = true;
    this.updatePlayPauseIcon();

    if (this.currentType === 'youtube' && this.ytPlayer?.playVideo) {
      this.ytPlayer.playVideo();
    } else if (this.currentType === 'vk') {
      this.sendVkPostMessage({ method: 'play' });
    } else if (this.currentType === 'rutube') {
      this.sendRutubePostMessage({ type: 'player:play', data: {} });
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      this.html5Video.play().catch(() => {});
    }

    if (notifyUser && this.onUserPlaybackChange) {
      this.onUserPlaybackChange(true, this.getCurrentTime(), this.playbackRate);
    }
  }

  pause(notifyUser = false) {
    this.isPlaying = false;
    this.updatePlayPauseIcon();

    if (this.currentType === 'youtube' && this.ytPlayer?.pauseVideo) {
      this.ytPlayer.pauseVideo();
    } else if (this.currentType === 'vk') {
      this.sendVkPostMessage({ method: 'pause' });
    } else if (this.currentType === 'rutube') {
      this.sendRutubePostMessage({ type: 'player:pause', data: {} });
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      this.html5Video.pause();
    }

    if (notifyUser && this.onUserPlaybackChange) {
      this.onUserPlaybackChange(false, this.getCurrentTime(), this.playbackRate);
    }
  }

  seekTo(seconds, notifyUser = false) {
    const target = Math.max(0, seconds);
    this.currentTime = target;
    this.updateTimelineUI();

    if (this.currentType === 'youtube' && this.ytPlayer?.seekTo) {
      this.ytPlayer.seekTo(target, true);
    } else if (this.currentType === 'vk') {
      this.sendVkPostMessage({ method: 'seek', time: target });
    } else if (this.currentType === 'rutube') {
      this.sendRutubePostMessage({ type: 'player:setCurrentTime', data: { time: target } });
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      this.html5Video.currentTime = target;
    }

    if (notifyUser && this.onUserPlaybackChange) {
      this.onUserPlaybackChange(this.isPlaying, target, this.playbackRate);
    }
  }

  // Smooth drift synchronization with room state
  syncWithRoomState(roomState) {
    if (!roomState || !roomState.video) return;
    const v = roomState.video;

    // If video url changed
    if (!this.videoData || this.videoData.url !== v.url) {
      this.loadVideo(v);
    }

    const targetTime = v.currentTime || 0;
    const targetPlaying = Boolean(v.isPlaying);
    const targetRate = v.playbackRate || 1.0;

    const currentLocalTime = this.getCurrentTime();
    const drift = Math.abs(currentLocalTime - targetTime);

    this.isInternalSync = true;

    // If drift is significant (> 1.5 seconds), seek smoothly to room time
    if (drift > 1.5) {
      this.seekTo(targetTime, false);
      const indicator = document.getElementById('sync-status-pill');
      if (indicator) {
        indicator.classList.add('drifted');
        indicator.querySelector('.sync-text').textContent = 'Синхронизация...';
        setTimeout(() => {
          indicator.classList.remove('drifted');
          indicator.querySelector('.sync-text').textContent = 'Синхронизировано';
        }, 1200);
      }
    }

    // Play/Pause sync
    if (targetPlaying && !this.isPlaying) {
      this.play(false);
    } else if (!targetPlaying && this.isPlaying) {
      this.pause(false);
    }

    // Playback rate
    if (Math.abs(this.playbackRate - targetRate) > 0.05) {
      this.setPlaybackRate(targetRate, false);
    }

    setTimeout(() => {
      this.isInternalSync = false;
    }, 300);
  }

  getCurrentTime() {
    if (this.currentType === 'youtube' && this.ytPlayer?.getCurrentTime) {
      return this.ytPlayer.getCurrentTime() || 0;
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      return this.html5Video.currentTime || 0;
    }
    return this.currentTime || 0;
  }

  setPlaybackRate(rate, notifyUser = false) {
    this.playbackRate = rate;
    this.labelSpeed.textContent = `${rate}x`;

    if (this.currentType === 'youtube' && this.ytPlayer?.setPlaybackRate) {
      this.ytPlayer.setPlaybackRate(rate);
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      this.html5Video.playbackRate = rate;
    }

    if (notifyUser && this.onUserPlaybackChange) {
      this.onUserPlaybackChange(this.isPlaying, this.getCurrentTime(), rate);
    }
  }

  setQuality(quality, notifyUser = false) {
    this.labelQuality.textContent = quality;

    if (this.hlsInstance) {
      if (quality === 'Auto') {
        this.hlsInstance.currentLevel = -1;
      } else {
        const height = parseInt(quality);
        const idx = this.hlsInstance.levels.findIndex((l) => l.height === height);
        if (idx !== -1) {
          this.hlsInstance.currentLevel = idx;
        }
      }
    }

    if (notifyUser && this.onUserTrackChange) {
      this.onUserTrackChange(quality, null);
    }
  }

  setAudioTrack(trackName, notifyUser = false) {
    this.labelAudio.textContent = trackName;

    if (this.hlsInstance && this.hlsInstance.audioTracks) {
      const idx = this.hlsInstance.audioTracks.findIndex((t) => t.name === trackName);
      if (idx !== -1) {
        this.hlsInstance.audioTrack = idx;
      }
    }

    if (notifyUser && this.onUserTrackChange) {
      this.onUserTrackChange(null, trackName);
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    this.isMuted = this.volume === 0;
    this.updateVolumeUI();

    if (this.currentType === 'youtube' && this.ytPlayer) {
      this.ytPlayer.setVolume(this.volume * 100);
      if (this.isMuted) this.ytPlayer.mute();
      else this.ytPlayer.unMute();
    } else if (this.currentType === 'hls' || this.currentType === 'direct') {
      this.html5Video.volume = this.volume;
      this.html5Video.muted = this.isMuted;
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (this.isMuted) {
      this.setVolume(0);
    } else {
      this.setVolume(0.8);
    }
  }

  updateVolumeUI() {
    this.volumeSlider.value = this.volume;
    if (this.isMuted || this.volume === 0) {
      this.iconVolHigh.classList.add('hidden');
      this.iconVolMute.classList.remove('hidden');
    } else {
      this.iconVolHigh.classList.remove('hidden');
      this.iconVolMute.classList.add('hidden');
    }
  }

  updatePlayPauseIcon() {
    if (this.isPlaying) {
      this.iconPlay.classList.add('hidden');
      this.iconPause.classList.remove('hidden');
    } else {
      this.iconPlay.classList.remove('hidden');
      this.iconPause.classList.add('hidden');
    }
  }

  updateTimelineUI() {
    if (this.duration <= 0) return;
    const progress = Math.min(1, Math.max(0, this.currentTime / this.duration));
    this.timelinePlayed.style.width = `${progress * 100}%`;
    this.timelineHandle.style.left = `${progress * 100}%`;
    this.timeCurrent.textContent = this.formatTime(this.currentTime);
    this.timeDuration.textContent = this.formatTime(this.duration);
  }

  renderQualityMenu(qualities, currentQuality) {
    this.menuQuality.innerHTML = '';
    this.labelQuality.textContent = currentQuality || qualities[0] || 'Качество';

    qualities.forEach((q) => {
      const item = document.createElement('div');
      item.className = `dropdown-item ${q === currentQuality ? 'active' : ''}`;
      item.textContent = q;
      item.addEventListener('click', () => {
        this.setQuality(q, true);
        this.menuQuality.querySelectorAll('.dropdown-item').forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
      });
      this.menuQuality.appendChild(item);
    });
  }

  renderAudioMenu(audioTracks, currentAudioTrack) {
    this.menuAudio.innerHTML = '';
    this.labelAudio.textContent = currentAudioTrack || audioTracks[0] || 'Озвучка';

    audioTracks.forEach((track) => {
      const item = document.createElement('div');
      item.className = `dropdown-item ${track === currentAudioTrack ? 'active' : ''}`;
      item.textContent = track;
      item.addEventListener('click', () => {
        this.setAudioTrack(track, true);
        this.menuAudio.querySelectorAll('.dropdown-item').forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
      });
      this.menuAudio.appendChild(item);
    });
  }

  sendVkPostMessage(msg) {
    try {
      this.vkIframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
    } catch {}
  }

  sendRutubePostMessage(msg) {
    try {
      this.rutubeIframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
    } catch {}
  }

  startTimeLoop() {
    setInterval(() => {
      if (this.isPlaying && !this.isSeeking) {
        if (this.currentType === 'youtube' && this.ytPlayer?.getCurrentTime) {
          this.currentTime = this.ytPlayer.getCurrentTime();
          this.duration = this.ytPlayer.getDuration() || this.duration;
          this.updateTimelineUI();
        } else if (this.currentType === 'rutube' || this.currentType === 'vk') {
          this.currentTime += 0.5 * this.playbackRate;
          this.updateTimelineUI();
        }
      }
    }, 500);
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

window.UniversalPlayer = UniversalPlayer;
