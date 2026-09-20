(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UmaPlayer = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'uma-live-player-v2';
  const PLAYING_STATES = new Set(['playing', 'buffering']);
  const PLAYBACK_MODES = ['list', 'one', 'shuffle'];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  function uniqueVocalists(rows) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      if (!row) return null;
      const id = String(row.id || row.voice_actor_id || '');
      const name = String(row.name || row.voice_actor_name || '');
      const key = id || name;
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return {
        id: id,
        name: name || id,
        image: String(row.image || row.photo || ''),
        color: String(row.color || row.color_main || '#3157e8')
      };
    }).filter(Boolean);
  }

  function normalizeTrack(track) {
    if (!track || !track.url) return null;
    const name = String(track.name || track.title || '未命名曲目');
    return {
      id: String(track.id || track.songId || track.url),
      songId: String(track.songId || ''),
      url: String(track.url),
      name: name,
      artist: String(track.artist || '—'),
      cover: String(track.cover || track.pic || ''),
      album: String(track.album || track.albumTitle || ''),
      albumId: String(track.albumId || ''),
      vocalists: uniqueVocalists(track.vocalists),
      sourceContext: String(track.sourceContext || '')
    };
  }

  function safeStorage(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return null;
      return storage;
    } catch (error) {
      return null;
    }
  }

  function restoreSnapshot(storage) {
    if (!storage) return null;
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || !parsed.current) return null;
      const queue = (parsed.queue || []).map(normalizeTrack).filter(Boolean);
      const current = normalizeTrack(parsed.current);
      if (!current) return null;
      let index = Number(parsed.queueIndex);
      if (!Number.isInteger(index) || index < 0 || index >= queue.length || queue[index].id !== current.id) {
        index = queue.findIndex(function (track) { return track.id === current.id; });
      }
      if (index < 0) {
        queue.splice(0, queue.length, current);
        index = 0;
      }
      return {
        current: current,
        queue: queue,
        queueIndex: index,
        currentTime: Math.max(0, Number(parsed.currentTime) || 0),
        contextLabel: String(parsed.contextLabel || ''),
        visible: parsed.visible !== false,
        playbackMode: PLAYBACK_MODES.includes(parsed.playbackMode) ? parsed.playbackMode : 'list'
      };
    } catch (error) {
      return null;
    }
  }

  function createPlayerController(options) {
    options = options || {};
    const reactive = options.reactive || function (value) { return value; };
    const getAudio = options.getAudio || function () { return null; };
    const proxyUrl = options.proxyUrl || function (url) { return url; };
    const random = options.random || Math.random;
    const storage = safeStorage(options.storage);
    const restored = restoreSnapshot(storage);
    const state = reactive({
      current: restored ? restored.current : null,
      queue: restored ? restored.queue : [],
      queueIndex: restored ? restored.queueIndex : -1,
      contextLabel: restored ? restored.contextLabel : '',
      status: restored ? 'paused' : 'idle',
      panelOpen: false,
      visible: restored ? restored.visible : false,
      playbackMode: restored ? restored.playbackMode : 'list',
      currentTime: restored ? restored.currentTime : 0,
      duration: 0,
      buffered: 0,
      error: '',
      pendingSeek: restored ? restored.currentTime : 0
    });
    let boundAudio = null;
    let handlers = [];
    let lastPersistSecond = -1;
    let shuffleHistory = [];

    function isPlaying() {
      return PLAYING_STATES.has(state.status);
    }

    function persist(force) {
      if (!storage || !state.current) return;
      const second = Math.floor(state.currentTime || 0);
      if (!force && second === lastPersistSecond) return;
      lastPersistSecond = second;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({
          current: state.current,
          queue: state.queue,
          queueIndex: state.queueIndex,
          currentTime: state.currentTime,
          contextLabel: state.contextLabel,
          visible: state.visible,
          playbackMode: state.playbackMode
        }));
      } catch (error) {}
    }

    function updateMediaSession() {
      if (typeof navigator === 'undefined' || !navigator.mediaSession || !state.current) return;
      const track = state.current;
      try {
        if (typeof MediaMetadata !== 'undefined') {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: track.artist,
            album: track.album,
            artwork: track.cover ? [{ src: track.cover }] : []
          });
        }
      } catch (error) {}
    }

    function updatePositionState() {
      if (typeof navigator === 'undefined' || !navigator.mediaSession || typeof navigator.mediaSession.setPositionState !== 'function') return;
      if (!state.duration || !Number.isFinite(state.duration)) return;
      try {
        navigator.mediaSession.setPositionState({
          duration: state.duration,
          playbackRate: (boundAudio && boundAudio.playbackRate) || 1,
          position: clamp(state.currentTime, 0, Math.max(0, state.duration - 0.001))
        });
      } catch (error) {}
    }

    function markError(message) {
      state.status = 'error';
      state.error = message || '试听暂时无法播放，请稍后重试。';
      persist(true);
    }

    function requestPlay() {
      const audio = getAudio();
      if (!audio || !state.current) return Promise.resolve(false);
      state.visible = true;
      state.error = '';
      if (state.status === 'ended' && state.duration) audio.currentTime = 0;
      state.status = audio.readyState >= 3 ? 'ready' : 'loading';
      let result;
      try { result = audio.play(); }
      catch (error) {
        markError('浏览器未能启动试听，请重试。');
        return Promise.resolve(false);
      }
      return Promise.resolve(result).then(function () {
        return true;
      }).catch(function (error) {
        if (error && error.name === 'AbortError') return false;
        markError('试听启动失败，请检查网络后重试。');
        return false;
      });
    }

    function loadCurrent(autoplay) {
      const audio = getAudio();
      if (!audio || !state.current) return Promise.resolve(false);
      state.error = '';
      state.currentTime = 0;
      state.duration = 0;
      state.buffered = 0;
      state.pendingSeek = 0;
      state.status = 'loading';
      audio.pause();
      audio.src = proxyUrl(state.current.url);
      if (typeof audio.load === 'function') audio.load();
      updateMediaSession();
      persist(true);
      return autoplay ? requestPlay() : Promise.resolve(true);
    }

    function setQueue(tracks, selectedIndex, contextLabel, autoplay) {
      const raw = (Array.isArray(tracks) ? tracks : []).map(normalizeTrack);
      const selected = raw[clamp(selectedIndex, 0, Math.max(0, raw.length - 1))];
      const playable = raw.filter(Boolean);
      if (!playable.length) {
        markError('当前列表没有可试听的曲目。');
        return Promise.resolve(false);
      }
      let index = selected ? playable.indexOf(selected) : -1;
      if (index < 0) index = 0;
      state.queue = playable;
      state.queueIndex = index;
      state.contextLabel = String(contextLabel || '播放列表');
      state.current = playable[index];
      state.visible = true;
      state.panelOpen = false;
      shuffleHistory = [];
      return loadCurrent(autoplay !== false);
    }

    function enqueueTracks(tracks, selectedIndex, contextLabel, autoplay) {
      const incoming = (Array.isArray(tracks) ? tracks : []).map(normalizeTrack).filter(Boolean);
      if (!incoming.length) {
        markError('没有可加入播放列表的曲目。');
        return Promise.resolve(false);
      }
      const selected = incoming[clamp(selectedIndex, 0, incoming.length - 1)];
      const wasEmpty = !state.queue.length;
      incoming.forEach(function (track) {
        if (state.queue.some(function (queued) { return queued.id === track.id; })) return;
        state.queue.push(track);
      });
      const nextIndex = state.queue.findIndex(function (track) { return track.id === selected.id; });
      if (nextIndex < 0) return Promise.resolve(false);
      if (wasEmpty) {
        state.contextLabel = String(contextLabel || selected.sourceContext || '播放列表');
      } else if (contextLabel && state.contextLabel && state.contextLabel !== contextLabel) {
        state.contextLabel = '播放列表';
      }
      state.queueIndex = nextIndex;
      state.current = state.queue[nextIndex];
      state.visible = true;
      state.panelOpen = false;
      shuffleHistory = [];
      return loadCurrent(autoplay !== false);
    }

    function playTrack(track) {
      const normalized = normalizeTrack(track);
      if (!normalized) return Promise.resolve(false);
      if (state.current && state.current.id === normalized.id) return togglePlay();
      return enqueueTracks([normalized], 0, normalized.sourceContext || '单曲试听', true);
    }

    function playQueueAt(index, rememberShuffle) {
      if (!state.queue.length) return Promise.resolve(false);
      const next = clamp(index, 0, state.queue.length - 1);
      if (state.current && next === state.queueIndex && state.current.url === state.queue[next].url) return togglePlay();
      if (rememberShuffle !== false && state.playbackMode === 'shuffle' && state.queueIndex >= 0) {
        shuffleHistory.push(state.queueIndex);
      }
      state.queueIndex = next;
      state.current = state.queue[next];
      state.visible = true;
      return loadCurrent(true);
    }

    function togglePlay() {
      const audio = getAudio();
      if (!audio || !state.current) return Promise.resolve(false);
      state.visible = true;
      if (isPlaying() || !audio.paused) {
        audio.pause();
        return Promise.resolve(true);
      }
      return requestPlay();
    }

    function randomQueueIndex() {
      if (state.queue.length < 2) return state.queueIndex;
      const offset = 1 + Math.floor(clamp(random(), 0, 0.999999) * (state.queue.length - 1));
      return (state.queueIndex + offset) % state.queue.length;
    }

    function advance(automatic) {
      if (state.queueIndex < 0 || !state.queue.length) return Promise.resolve(false);
      if (automatic && state.playbackMode === 'one') {
        const audio = getAudio();
        if (audio) audio.currentTime = 0;
        state.currentTime = 0;
        return requestPlay();
      }
      if (state.playbackMode === 'shuffle') {
        const nextIndex = randomQueueIndex();
        if (nextIndex === state.queueIndex) {
          const audio = getAudio();
          if (audio) audio.currentTime = 0;
          state.currentTime = 0;
          return requestPlay();
        }
        shuffleHistory.push(state.queueIndex);
        return playQueueAt(nextIndex, false);
      }
      const nextIndex = (state.queueIndex + 1) % state.queue.length;
      if (nextIndex === state.queueIndex) {
        const audio = getAudio();
        if (audio) audio.currentTime = 0;
        state.currentTime = 0;
        return requestPlay();
      }
      return playQueueAt(nextIndex, false);
    }

    function next() {
      return advance(false);
    }

    function previous() {
      const audio = getAudio();
      if (audio && audio.currentTime > 3) {
        audio.currentTime = 0;
        state.currentTime = 0;
        persist(true);
        return Promise.resolve(true);
      }
      if (state.playbackMode === 'shuffle' && shuffleHistory.length) {
        return playQueueAt(shuffleHistory.pop(), false);
      }
      if (!state.queue.length || state.queueIndex < 0) return Promise.resolve(false);
      const previousIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
      if (previousIndex === state.queueIndex) {
        if (audio) audio.currentTime = 0;
        state.currentTime = 0;
        persist(true);
        return Promise.resolve(true);
      }
      return playQueueAt(previousIndex, false);
    }

    function seekTo(seconds) {
      const audio = getAudio();
      if (!audio || !state.duration) return;
      const target = clamp(seconds, 0, state.duration);
      audio.currentTime = target;
      state.currentTime = target;
      updatePositionState();
      persist(true);
    }

    function retry() {
      if (!state.current) return Promise.resolve(false);
      state.visible = true;
      return loadCurrent(true);
    }

    function cyclePlaybackMode() {
      const index = PLAYBACK_MODES.indexOf(state.playbackMode);
      state.playbackMode = PLAYBACK_MODES[(index + 1) % PLAYBACK_MODES.length];
      if (state.playbackMode !== 'shuffle') shuffleHistory = [];
      persist(true);
      return state.playbackMode;
    }

    function dismiss() {
      const audio = getAudio();
      if (audio) audio.pause();
      state.visible = false;
      state.panelOpen = false;
      if (state.current && state.status !== 'error') state.status = 'paused';
      persist(true);
    }

    function removeQueueItem(index) {
      if (index < 0 || index >= state.queue.length) return;
      const wasCurrent = index === state.queueIndex;
      const wasPlaying = isPlaying();
      state.queue.splice(index, 1);
      if (!state.queue.length) {
        const audio = getAudio();
        if (audio) audio.pause();
        state.current = null;
        state.queueIndex = -1;
        state.status = 'idle';
        state.panelOpen = false;
        state.currentTime = 0;
        state.duration = 0;
        if (storage) {
          try { storage.removeItem(STORAGE_KEY); }
          catch (error) {}
        }
        return;
      }
      if (index < state.queueIndex) state.queueIndex -= 1;
      shuffleHistory = [];
      if (wasCurrent) {
        state.queueIndex = Math.min(index, state.queue.length - 1);
        state.current = state.queue[state.queueIndex];
        loadCurrent(wasPlaying);
      } else {
        persist(true);
      }
    }

    function moveQueueItem(index, direction) {
      const target = index + direction;
      if (index < 0 || target < 0 || index >= state.queue.length || target >= state.queue.length) return;
      const currentId = state.current && state.current.id;
      const row = state.queue.splice(index, 1)[0];
      state.queue.splice(target, 0, row);
      state.queueIndex = state.queue.findIndex(function (track) { return currentId && track.id === currentId; });
      shuffleHistory = [];
      persist(true);
    }

    function openPanel() { if (state.current) state.panelOpen = true; }
    function closePanel() { state.panelOpen = false; }
    function togglePanel() { state.panelOpen ? closePanel() : openPanel(); }

    function bind() {
      const audio = getAudio();
      if (!audio || audio === boundAudio) return;
      boundAudio = audio;
      function on(type, handler) {
        audio.addEventListener(type, handler);
        handlers.push([type, handler]);
      }
      on('loadstart', function () { state.status = 'loading'; state.error = ''; });
      on('loadedmetadata', function () {
        state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (state.pendingSeek) {
          audio.currentTime = clamp(state.pendingSeek, 0, state.duration || state.pendingSeek);
          state.currentTime = audio.currentTime;
          state.pendingSeek = 0;
        }
        if (audio.paused && state.status !== 'error') state.status = 'paused';
        updatePositionState();
      });
      on('durationchange', function () { state.duration = Number.isFinite(audio.duration) ? audio.duration : 0; });
      on('play', function () { state.status = 'playing'; state.error = ''; persist(true); });
      on('playing', function () { state.status = 'playing'; state.error = ''; });
      on('pause', function () {
        if (state.status !== 'ended' && state.status !== 'error' && state.current) state.status = 'paused';
        persist(true);
      });
      on('waiting', function () { if (!audio.paused) state.status = 'buffering'; });
      on('stalled', function () { if (!audio.paused) state.status = 'buffering'; });
      on('canplay', function () { if (!audio.paused) state.status = 'playing'; else if (state.status !== 'error') state.status = 'paused'; });
      on('timeupdate', function () {
        state.currentTime = audio.currentTime || 0;
        if (audio.buffered && audio.buffered.length) state.buffered = audio.buffered.end(audio.buffered.length - 1);
        updatePositionState();
        persist(false);
      });
      on('progress', function () {
        state.buffered = audio.buffered && audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
      });
      on('seeked', function () { state.currentTime = audio.currentTime || 0; persist(true); });
      on('error', function () { markError('试听资源暂时无法载入，请稍后重试。'); });
      on('ended', function () {
        advance(true);
      });
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        const actions = {
          play: requestPlay,
          pause: function () { audio.pause(); },
          previoustrack: previous,
          nexttrack: next,
          seekto: function (details) { if (details && Number.isFinite(details.seekTime)) seekTo(details.seekTime); },
          seekbackward: function (details) { seekTo(state.currentTime - ((details && details.seekOffset) || 10)); },
          seekforward: function (details) { seekTo(state.currentTime + ((details && details.seekOffset) || 10)); }
        };
        Object.keys(actions).forEach(function (action) {
          try { navigator.mediaSession.setActionHandler(action, actions[action]); }
          catch (error) {}
        });
      }
      if (state.current) {
        audio.src = proxyUrl(state.current.url);
        if (typeof audio.load === 'function') audio.load();
        updateMediaSession();
      }
    }

    function destroy() {
      if (boundAudio) handlers.forEach(function (entry) { boundAudio.removeEventListener(entry[0], entry[1]); });
      handlers = [];
      boundAudio = null;
    }

    return {
      state: state,
      bind: bind,
      destroy: destroy,
      isPlaying: isPlaying,
      playTrack: playTrack,
      setQueue: setQueue,
      enqueueTracks: enqueueTracks,
      playQueueAt: playQueueAt,
      togglePlay: togglePlay,
      next: next,
      previous: previous,
      seekTo: seekTo,
      retry: retry,
      cyclePlaybackMode: cyclePlaybackMode,
      dismiss: dismiss,
      removeQueueItem: removeQueueItem,
      moveQueueItem: moveQueueItem,
      openPanel: openPanel,
      closePanel: closePanel,
      togglePanel: togglePanel
    };
  }

  return {
    createPlayerController: createPlayerController,
    normalizeTrack: normalizeTrack
  };
});
