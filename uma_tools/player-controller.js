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
        color: String(row.color || row.color_main || '#3558d8')
      };
    }).filter(Boolean);
  }

  function normalizeTrack(track) {
    if (!track || !track.url) return null;
    const name = String(track.name || track.title || '未命名曲目');
    return {
      id: String(track.id || track.songId || track.url),
      songId: String(track.songId || ''),
      versionId: String(track.versionId || ''),
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
      if (!parsed) return null;
      const queue = (parsed.queue || []).map(normalizeTrack).filter(Boolean);
      const current = normalizeTrack(parsed.current);
      if (!queue.length && !current) return null;
      let index = Number(parsed.queueIndex);
      if (current && (!Number.isInteger(index) || index < 0 || index >= queue.length || queue[index].id !== current.id)) {
        index = queue.findIndex(function (track) { return track.id === current.id; });
      }
      if (current && index < 0) {
        queue.splice(0, queue.length, current);
        index = 0;
      }
      if (!current) index = -1;
      return {
        current: current,
        queue: queue,
        queueIndex: index,
        currentTime: Math.max(0, Number(parsed.currentTime) || 0),
        contextLabel: String(parsed.contextLabel || ''),
        visible: parsed.visible !== false,
        playbackMode: PLAYBACK_MODES.includes(parsed.playbackMode) ? parsed.playbackMode : 'list',
        volume: clamp(parsed.volume == null ? 1 : parsed.volume, 0, 1),
        muted: !!parsed.muted
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
    const schedule = options.setTimeout || setTimeout;
    const cancelSchedule = options.clearTimeout || clearTimeout;
    const now = options.now || Date.now;
    const stallTimeout = Number(options.stallTimeout) || 4000;
    const stablePlaybackWindow = Number(options.stablePlaybackWindow) || 8000;
    const retryDelays = Array.isArray(options.retryDelays) ? options.retryDelays : [1500, 3000, 6000];
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
      volume: restored ? restored.volume : 1,
      muted: restored ? restored.muted : false,
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
    let prefetchAudio = null;
    let sourceGeneration = 0;
    let intendedPlay = false;
    let recoveryTimer = null;
    let stableTimer = null;
    let retryCount = 0;
    let lastProgressAt = now();
    let lastProgressTime = 0;

    function scheduleTask(callback, delay) {
      const timer = schedule(callback, delay);
      if (timer && typeof timer.unref === 'function') timer.unref();
      return timer;
    }

    function isPlaying() {
      return PLAYING_STATES.has(state.status);
    }

    function clearRecoveryTimer() {
      if (recoveryTimer !== null) cancelSchedule(recoveryTimer);
      recoveryTimer = null;
    }

    function clearStableTimer() {
      if (stableTimer !== null) cancelSchedule(stableTimer);
      stableTimer = null;
    }

    function resetRecovery() {
      clearRecoveryTimer();
      clearStableTimer();
      retryCount = 0;
      lastProgressAt = now();
      lastProgressTime = state.currentTime || 0;
    }

    function persist(force) {
      if (!storage || (!state.current && !state.queue.length)) return;
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
          playbackMode: state.playbackMode,
          volume: state.volume,
          muted: state.muted
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

    function nextQueueIndex() {
      if (!state.queue.length) return -1;
      if (state.playbackMode === 'shuffle') return randomQueueIndex();
      return state.queueIndex < 0 ? 0 : (state.queueIndex + 1) % state.queue.length;
    }

    function prefetchNextMetadata() {
      const connection = typeof navigator !== 'undefined' && navigator.connection;
      if (connection && connection.saveData) return;
      const index = nextQueueIndex();
      const track = index >= 0 ? state.queue[index] : null;
      if (!track || (state.current && track.id === state.current.id) || typeof Audio === 'undefined') return;
      try {
        prefetchAudio = new Audio();
        prefetchAudio.preload = 'metadata';
        prefetchAudio.src = proxyUrl(track.url);
        if (typeof prefetchAudio.load === 'function') prefetchAudio.load();
      } catch (error) { prefetchAudio = null; }
    }

    function markError(message) {
      clearRecoveryTimer();
      clearStableTimer();
      intendedPlay = false;
      state.status = 'error';
      state.error = message || '试听暂时无法播放，请稍后重试。';
      persist(true);
    }

    function requestPlay() {
      const audio = getAudio();
      if (!audio || !state.current) return Promise.resolve(false);
      const generation = sourceGeneration;
      intendedPlay = true;
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
      // Initial play can remain pending without emitting waiting/stalled.
      if (!recoveryTimer) {
        lastProgressAt = now();
        lastProgressTime = audio.currentTime || 0;
        scheduleStallCheck('initial-play');
      }
      return Promise.resolve(result).then(function () {
        if (generation !== sourceGeneration) return false;
        return true;
      }).catch(function (error) {
        if (generation !== sourceGeneration) return false;
        if (error && error.name === 'AbortError') return false;
        markError('试听启动失败，请检查网络后重试。');
        return false;
      });
    }

    function loadCurrent(autoplay, recovery) {
      const audio = getAudio();
      if (!audio || !state.current) return Promise.resolve(false);
      sourceGeneration += 1;
      clearRecoveryTimer();
      clearStableTimer();
      if (!recovery) retryCount = 0;
      intendedPlay = autoplay !== false;
      state.error = '';
      const resumeTime = recovery ? Math.max(0, Number(recovery.resumeTime) || 0) : 0;
      state.currentTime = resumeTime;
      state.duration = 0;
      state.buffered = 0;
      state.pendingSeek = resumeTime;
      state.status = 'loading';
      audio.pause();
      audio.volume = state.volume;
      audio.muted = state.muted;
      audio.src = proxyUrl(state.current.url);
      if (typeof audio.load === 'function') audio.load();
      updateMediaSession();
      persist(true);
      const result = autoplay ? requestPlay() : Promise.resolve(true);
      Promise.resolve(result).then(function () { prefetchNextMetadata(); });
      return result;
    }

    function uniqueTracks(tracks) {
      const seen = new Set();
      return (Array.isArray(tracks) ? tracks : []).map(normalizeTrack).filter(function (track) {
        if (!track || seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      });
    }

    function setQueue(tracks, selectedIndex, contextLabel, autoplay) {
      const raw = (Array.isArray(tracks) ? tracks : []).map(normalizeTrack);
      const selected = raw[clamp(selectedIndex, 0, Math.max(0, raw.length - 1))];
      const playable = uniqueTracks(raw);
      if (!playable.length) {
        markError('当前列表没有可试听的曲目。');
        return Promise.resolve(false);
      }
      let index = selected ? playable.findIndex(function (track) { return track.id === selected.id; }) : -1;
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

    function enqueueTracks(tracks, selectedIndex, contextLabel) {
      const incoming = uniqueTracks(tracks);
      if (!incoming.length) {
        markError('没有可加入播放列表的曲目。');
        return Promise.resolve(false);
      }
      const wasEmpty = !state.queue.length;
      let added = 0;
      incoming.forEach(function (track) {
        if (state.queue.some(function (queued) { return queued.id === track.id; })) return;
        state.queue.push(track);
        added += 1;
      });
      if (wasEmpty) {
        state.contextLabel = String(contextLabel || incoming[0].sourceContext || '播放列表');
      } else if (contextLabel && state.contextLabel && state.contextLabel !== contextLabel) {
        state.contextLabel = '播放列表';
      }
      if (added > 0) {
        state.visible = true;
        if (!state.current) state.panelOpen = true;
      }
      shuffleHistory = [];
      persist(true);
      return Promise.resolve(added > 0);
    }

    function appendBlock(tracks, contextLabel) {
      const incoming = uniqueTracks(tracks);
      if (!incoming.length) {
        markError('没有可加入播放列表的曲目。');
        return Promise.resolve(false);
      }
      const currentId = state.current && state.current.id;
      const incomingIds = new Set(incoming.map(function (track) { return track.id; }));
      const retained = state.queue.filter(function (track) { return !incomingIds.has(track.id); });
      const nextQueue = retained.concat(incoming);
      const changed = nextQueue.length !== state.queue.length || nextQueue.some(function (track, index) {
        return !state.queue[index] || state.queue[index].id !== track.id;
      });
      if (!changed) return Promise.resolve(false);
      state.queue = nextQueue;
      state.queueIndex = currentId ? state.queue.findIndex(function (track) { return track.id === currentId; }) : -1;
      if (currentId && state.queueIndex >= 0) state.current = state.queue[state.queueIndex];
      if (!state.current) {
        state.queueIndex = -1;
        state.panelOpen = true;
        state.contextLabel = String(contextLabel || incoming[0].sourceContext || '播放列表');
      } else if (contextLabel && state.contextLabel !== contextLabel) {
        state.contextLabel = '播放列表';
      }
      state.visible = true;
      shuffleHistory = [];
      persist(true);
      return Promise.resolve(true);
    }

    function playTrack(track) {
      const normalized = normalizeTrack(track);
      if (!normalized) return Promise.resolve(false);
      const queuedIndex = state.queue.findIndex(function (queued) { return queued.id === normalized.id; });
      if (state.current && state.current.id === normalized.id && state.current.url === normalized.url) return togglePlay();
      if (queuedIndex >= 0) {
        state.queue[queuedIndex] = normalized;
        if (queuedIndex === state.queueIndex) {
          state.current = normalized;
          return loadCurrent(true);
        }
        return playQueueAt(queuedIndex);
      }
      const insertAt = state.queueIndex >= 0 ? state.queueIndex + 1 : state.queue.length;
      state.queue.splice(insertAt, 0, normalized);
      state.queueIndex = insertAt;
      state.current = normalized;
      state.contextLabel = state.queue.length === 1 ? (normalized.sourceContext || '单曲试听') : '播放列表';
      state.visible = true;
      state.panelOpen = false;
      shuffleHistory = [];
      return loadCurrent(true);
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
        intendedPlay = false;
        clearRecoveryTimer();
        clearStableTimer();
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
      lastProgressTime = target;
      lastProgressAt = now();
      clearRecoveryTimer();
      if (intendedPlay) scheduleStallCheck('seek');
      updatePositionState();
      persist(true);
    }

    function seekBy(seconds) {
      if (!state.current) return;
      seekTo((state.currentTime || 0) + Number(seconds || 0));
    }

    function setVolume(value) {
      const audio = getAudio();
      state.volume = clamp(value, 0, 1);
      if (state.volume > 0) state.muted = false;
      if (audio) {
        audio.volume = state.volume;
        audio.muted = state.muted;
      }
      persist(true);
    }

    function toggleMute() {
      const audio = getAudio();
      state.muted = !state.muted;
      if (audio) audio.muted = state.muted;
      persist(true);
      return state.muted;
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
      intendedPlay = false;
      clearRecoveryTimer();
      clearStableTimer();
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
        clearQueue();
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

    function clearQueue() {
      const audio = getAudio();
      if (audio) {
        audio.pause();
        audio.removeAttribute && audio.removeAttribute('src');
        if (typeof audio.load === 'function') audio.load();
      }
      state.queue.splice(0, state.queue.length);
      state.current = null;
      state.queueIndex = -1;
      state.status = 'idle';
      state.panelOpen = false;
      state.visible = false;
      state.currentTime = 0;
      state.duration = 0;
      state.buffered = 0;
      state.error = '';
      intendedPlay = false;
      sourceGeneration += 1;
      resetRecovery();
      shuffleHistory = [];
      if (storage) {
        try { storage.removeItem(STORAGE_KEY); }
        catch (error) {}
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

    function moveQueueItemTo(index, target) {
      if (index === target || index < 0 || target < 0 || index >= state.queue.length || target >= state.queue.length) return;
      const currentId = state.current && state.current.id;
      const row = state.queue.splice(index, 1)[0];
      state.queue.splice(target, 0, row);
      state.queueIndex = state.queue.findIndex(function (track) { return currentId && track.id === currentId; });
      shuffleHistory = [];
      persist(true);
    }

    function openPanel() { if (state.current || state.queue.length) { state.visible = true; state.panelOpen = true; } }
    function closePanel() { state.panelOpen = false; }
    function togglePanel() { state.panelOpen ? closePanel() : openPanel(); }

    function scheduleStableReset() {
      clearStableTimer();
      if (!retryCount) return;
      stableTimer = scheduleTask(function () {
        stableTimer = null;
        if (intendedPlay && state.status === 'playing') retryCount = 0;
      }, stablePlaybackWindow);
    }

    function recoverPlayback(reason) {
      const audio = getAudio();
      if (!audio || !state.current || !intendedPlay) return;
      if (retryCount >= retryDelays.length) {
        markError('试听连接多次中断，请点击重试。');
        return;
      }
      const generation = sourceGeneration;
      const delay = Number(retryDelays[retryCount]) || 0;
      retryCount += 1;
      clearRecoveryTimer();
      state.status = 'buffering';
      recoveryTimer = scheduleTask(function () {
        recoveryTimer = null;
        if (!intendedPlay || generation !== sourceGeneration || !state.current) return;
        const resumeTime = Math.max(0, Number(audio.currentTime) || state.currentTime || 0);
        const bufferedAhead = state.buffered - resumeTime;
        if (reason !== 'error' && bufferedAhead > 0.75) {
          try { audio.currentTime = Math.min(resumeTime + 0.05, state.duration || resumeTime + 0.05); }
          catch (error) {}
          requestPlay().then(function (played) {
            if (played) scheduleStallCheck('resume');
          });
          return;
        }
        loadCurrent(true, { resumeTime: resumeTime });
      }, delay);
    }

    function scheduleStallCheck(reason) {
      clearRecoveryTimer();
      if (!intendedPlay || !state.current) return;
      const generation = sourceGeneration;
      const elapsed = Math.max(0, now() - lastProgressAt);
      const delay = Math.max(1, stallTimeout - elapsed);
      recoveryTimer = scheduleTask(function () {
        recoveryTimer = null;
        if (!intendedPlay || generation !== sourceGeneration || !state.current) return;
        const audio = getAudio();
        const position = audio ? Number(audio.currentTime) || 0 : state.currentTime;
        if (position > lastProgressTime + 0.2) {
          lastProgressTime = position;
          lastProgressAt = now();
          scheduleStallCheck('progress');
          return;
        }
        recoverPlayback(reason || 'stalled');
      }, delay);
    }

    function bind() {
      const audio = getAudio();
      if (!audio || audio === boundAudio) return;
      boundAudio = audio;
      function on(type, handler) {
        const guarded = function () { if (state.current) handler(); };
        audio.addEventListener(type, guarded);
        handlers.push([type, guarded]);
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
      on('play', function () { state.status = 'playing'; state.error = ''; intendedPlay = true; persist(true); });
      on('playing', function () {
        state.status = 'playing';
        state.error = '';
        lastProgressAt = now();
        lastProgressTime = audio.currentTime || 0;
        scheduleStallCheck('playing');
        scheduleStableReset();
      });
      on('pause', function () {
        if (state.status !== 'loading' && state.status !== 'buffering') intendedPlay = false;
        if (!intendedPlay) {
          clearRecoveryTimer();
          clearStableTimer();
        }
        if (state.status !== 'ended' && state.status !== 'error' && state.current) state.status = 'paused';
        persist(true);
      });
      on('waiting', function () {
        if (!audio.paused) {
          state.status = 'buffering';
          lastProgressTime = Number(audio.currentTime) || state.currentTime || 0;
          lastProgressAt = now();
          scheduleStallCheck('waiting');
        }
      });
      on('stalled', function () {
        if (!audio.paused) {
          state.status = 'buffering';
          lastProgressTime = Number(audio.currentTime) || state.currentTime || 0;
          lastProgressAt = now();
          scheduleStallCheck('stalled');
        }
      });
      on('canplay', function () { if (!audio.paused) { state.status = 'playing'; scheduleStallCheck('canplay'); } else if (state.status !== 'error') state.status = 'paused'; });
      on('timeupdate', function () {
        state.currentTime = audio.currentTime || 0;
        if (state.currentTime > lastProgressTime + 0.2) {
          lastProgressTime = state.currentTime;
          lastProgressAt = now();
          if (intendedPlay) scheduleStallCheck('timeupdate');
        }
        if (audio.buffered && audio.buffered.length) state.buffered = audio.buffered.end(audio.buffered.length - 1);
        updatePositionState();
        persist(false);
      });
      on('progress', function () {
        state.buffered = audio.buffered && audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
      });
      on('seeked', function () { state.currentTime = audio.currentTime || 0; lastProgressTime = state.currentTime; lastProgressAt = now(); if (intendedPlay) scheduleStallCheck('seeked'); persist(true); });
      on('error', function () {
        if (intendedPlay && state.current) recoverPlayback('error');
        else markError('试听资源暂时无法载入，请稍后重试。');
      });
      on('abort', function () {
        if (intendedPlay && state.current && state.status !== 'loading') recoverPlayback('abort');
      });
      on('ended', function () {
        clearRecoveryTimer();
        clearStableTimer();
        advance(true);
      });
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        const actions = {
          play: requestPlay,
          pause: function () { intendedPlay = false; audio.pause(); },
          previoustrack: previous,
          nexttrack: next,
          seekto: function (details) { if (details && Number.isFinite(details.seekTime)) seekTo(details.seekTime); },
          seekbackward: function (details) { seekTo(state.currentTime - ((details && details.seekOffset) || 15)); },
          seekforward: function (details) { seekTo(state.currentTime + ((details && details.seekOffset) || 15)); }
        };
        Object.keys(actions).forEach(function (action) {
          try { navigator.mediaSession.setActionHandler(action, actions[action]); }
          catch (error) {}
        });
      }
      if (typeof document !== 'undefined') {
        const onVisibility = function () {
          if (!document.hidden && intendedPlay && state.current) scheduleStallCheck('visibility');
        };
        document.addEventListener('visibilitychange', onVisibility);
        handlers.push(['document:visibilitychange', onVisibility]);
      }
      if (state.current) {
        audio.volume = state.volume;
        audio.muted = state.muted;
        audio.src = proxyUrl(state.current.url);
        if (typeof audio.load === 'function') audio.load();
        updateMediaSession();
      }
    }

    function destroy() {
      clearRecoveryTimer();
      clearStableTimer();
      if (boundAudio) handlers.forEach(function (entry) {
        if (entry[0] === 'document:visibilitychange') {
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', entry[1]);
        } else {
          boundAudio.removeEventListener(entry[0], entry[1]);
        }
      });
      handlers = [];
      boundAudio = null;
      prefetchAudio = null;
    }

    return {
      state: state,
      bind: bind,
      destroy: destroy,
      isPlaying: isPlaying,
      playTrack: playTrack,
      setQueue: setQueue,
      enqueueTracks: enqueueTracks,
      appendBlock: appendBlock,
      playQueueAt: playQueueAt,
      togglePlay: togglePlay,
      next: next,
      previous: previous,
      seekTo: seekTo,
      seekBy: seekBy,
      setVolume: setVolume,
      toggleMute: toggleMute,
      retry: retry,
      cyclePlaybackMode: cyclePlaybackMode,
      dismiss: dismiss,
      removeQueueItem: removeQueueItem,
      clearQueue: clearQueue,
      moveQueueItem: moveQueueItem,
      moveQueueItemTo: moveQueueItemTo,
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
