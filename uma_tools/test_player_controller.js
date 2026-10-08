'use strict';

const assert = require('assert');
const { createPlayerController, normalizeTrack } = require('./player-controller.js');

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.src = '';
    this.paused = true;
    this.currentTime = 0;
    this.duration = 0;
    this.readyState = 0;
    this.playbackRate = 1;
    this.buffered = { length: 0, end: function () { return 0; } };
    this.rejectPlay = false;
    this.loadCount = 0;
    this.playCount = 0;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(handler);
  }
  emit(type) {
    (this.listeners.get(type) || []).forEach(function (handler) { handler(); });
  }
  load() {
    this.loadCount += 1;
    this.readyState = 0;
    this.emit('loadstart');
  }
  play() {
    this.playCount += 1;
    if (this.rejectPlay) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    this.paused = false;
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  metadata(duration) {
    this.duration = duration;
    this.readyState = 3;
    this.emit('loadedmetadata');
  }
}

class FakeStorage {
  constructor(initial) { this.values = Object.assign({}, initial); }
  getItem(key) { return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null; }
  setItem(key, value) { this.values[key] = String(value); }
  removeItem(key) { delete this.values[key]; }
}

class FakeClock {
  constructor() { this.time = 0; this.nextId = 1; this.tasks = new Map(); }
  now() { return this.time; }
  setTimeout(callback, delay) {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.time + Math.max(0, Number(delay) || 0), callback: callback });
    return id;
  }
  clearTimeout(id) { this.tasks.delete(id); }
  advance(milliseconds) {
    const target = this.time + milliseconds;
    while (true) {
      const due = Array.from(this.tasks.entries())
        .filter(function (entry) { return entry[1].at <= target; })
        .sort(function (left, right) { return left[1].at - right[1].at || left[0] - right[0]; })[0];
      if (!due) break;
      this.time = due[1].at;
      this.tasks.delete(due[0]);
      due[1].callback();
    }
    this.time = target;
  }
}

function track(id) {
  return {
    id: id,
    url: 'https://audio.example/' + id + '.mp3',
    name: 'Track ' + id,
    artist: 'Singer ' + id,
    songId: 'song-' + id,
    versionId: 'version-' + id,
    vocalists: [{ voice_actor_id: 'va-' + id, voice_actor_name: 'Singer ' + id }]
  };
}

function setup(storage, random, options) {
  const audio = new FakeAudio();
  const controller = createPlayerController(Object.assign({
    getAudio: function () { return audio; },
    proxyUrl: function (url) { return '/proxy?url=' + encodeURIComponent(url); },
    storage: storage || new FakeStorage(),
    random: random
  }, options || {}));
  controller.bind();
  return { audio: audio, controller: controller, state: controller.state };
}

async function run() {
  const normalized = normalizeTrack(track('a'));
  assert.equal(normalized.vocalists[0].id, 'va-a', 'voice actor IDs are normalized for clickable credits');
  assert.equal(normalized.versionId, 'version-a', 'recording version identity is kept for synchronized lyrics');

  const first = setup();
  await first.controller.playTrack(track('a'));
  assert.equal(first.state.status, 'playing');
  assert.equal(first.state.queue.length, 1);
  assert.match(first.audio.src, /^\/proxy\?url=/);
  first.audio.metadata(180);
  first.audio.currentTime = 42;
  first.audio.emit('timeupdate');
  assert.equal(first.state.currentTime, 42);
  assert.equal(first.state.duration, 180);
  first.audio.currentTime = 1;
  first.audio.emit('timeupdate');
  await first.controller.previous();
  assert.equal(first.audio.currentTime, 0, 'previous restarts a one-track queue');
  assert.equal(first.audio.paused, false, 'restarting a one-track queue does not pause it');

  await first.controller.playTrack(track('b'));
  assert.deepEqual(first.state.queue.map(function (row) { return row.id; }), ['a', 'b'], 'playing another track appends it');
  assert.equal(first.state.current.id, 'b');
  await first.controller.playTrack(track('a'));
  assert.deepEqual(first.state.queue.map(function (row) { return row.id; }), ['a', 'b'], 'replaying a queued track does not duplicate it');
  assert.equal(first.state.current.id, 'a');
  const alternate = Object.assign({}, track('a'), { url: 'https://audio.example/alternate.mp3' });
  await first.controller.playTrack(alternate);
  assert.equal(first.state.current.url, alternate.url, 'another release URL replaces the queued source for the same recording');
  assert(first.audio.src.includes('alternate.mp3'));
  assert.equal(first.state.queue.length, 2);

  const emptied = setup();
  await emptied.controller.playTrack(track('last'));
  emptied.controller.removeQueueItem(0);
  assert.equal(emptied.audio.src, '', 'removing the last row releases the audio source');
  assert.equal(emptied.state.current, null);
  emptied.audio.emit('error');
  assert.notEqual(emptied.state.status, 'error', 'late audio events cannot revive an empty session');

  const appendedAlbum = setup();
  await appendedAlbum.controller.playTrack(track('a'));
  await appendedAlbum.controller.enqueueTracks([track('b'), track('c'), track('a')], 0, 'Album');
  assert.deepEqual(appendedAlbum.state.queue.map(function (row) { return row.id; }), ['a', 'b', 'c']);
  assert.equal(appendedAlbum.state.current.id, 'a', 'adding to the queue never changes the current track');
  assert.equal(appendedAlbum.audio.paused, false, 'adding to the queue never interrupts playback');
  assert.equal(appendedAlbum.state.contextLabel, '播放列表', 'mixed sources use the generic queue label');

  const movedBlock = setup();
  await movedBlock.controller.setQueue([track('a'), track('b'), track('c'), track('d')], 1, 'Mixed', true);
  movedBlock.audio.currentTime = 37;
  movedBlock.audio.emit('timeupdate');
  const loadBeforeMove = movedBlock.audio.loadCount;
  await movedBlock.controller.appendBlock([track('d'), track('b'), track('e'), track('d')], 'Album block');
  assert.deepEqual(movedBlock.state.queue.map(function (row) { return row.id; }), ['a', 'c', 'd', 'b', 'e'], 'adding a group moves duplicates into one ordered block');
  assert.equal(movedBlock.state.current.id, 'b', 'moving the current track keeps its identity');
  assert.equal(movedBlock.state.queueIndex, 3, 'moving the current track updates its queue position');
  assert.equal(movedBlock.audio.currentTime, 37, 'moving a current track does not restart playback');
  assert.equal(movedBlock.audio.loadCount, loadBeforeMove, 'moving a current track does not reload its source');

  movedBlock.controller.dismiss();
  await movedBlock.controller.enqueueTracks([track('e')], 0, 'Duplicate');
  assert.equal(movedBlock.state.visible, false, 'adding only an existing single track does not reopen a dismissed dock');
  await movedBlock.controller.appendBlock([track('e'), track('f')], 'New block');
  assert.equal(movedBlock.state.visible, true, 'a successful group addition reopens a dismissed dock');

  const queuedOnly = setup();
  await queuedOnly.controller.enqueueTracks([track('a'), track('b')], 0, 'Album');
  assert.equal(queuedOnly.state.current, null, 'adding to an empty queue does not load a track');
  assert.equal(queuedOnly.state.queue.length, 2);
  assert.equal(queuedOnly.audio.src, '');
  assert.equal(queuedOnly.state.panelOpen, true, 'a queue with no current track opens for selection');

  const queue = setup();
  await queue.controller.setQueue([track('a'), track('b'), track('c')], 1, 'Album', true);
  assert.equal(queue.state.current.id, 'b');
  assert.equal(queue.state.contextLabel, 'Album');
  await queue.controller.next();
  assert.equal(queue.state.current.id, 'c');
  assert.equal(await queue.controller.next(), true, 'list loop wraps at the end');
  assert.equal(queue.state.current.id, 'a');
  queue.audio.currentTime = 8;
  assert.equal(await queue.controller.previous(), true);
  assert.equal(queue.state.current.id, 'a', 'previous restarts the current track after three seconds');
  assert.equal(queue.audio.currentTime, 0);
  queue.audio.currentTime = 2;
  await queue.controller.previous();
  assert.equal(queue.state.current.id, 'c', 'previous wraps to the end of a looping list');

  queue.controller.moveQueueItem(2, -1);
  assert.equal(queue.state.current.id, 'c');
  assert.equal(queue.state.queueIndex, 1, 'moving the queue keeps the current track selected');
  queue.controller.removeQueueItem(1);
  assert.equal(queue.state.current.id, 'b', 'removing the current track selects the row now occupying its place');
  queue.controller.moveQueueItemTo(1, 0);
  assert.equal(queue.state.queueIndex, 0, 'drag reordering keeps the current item identity');

  queue.controller.setVolume(0.45);
  assert.equal(queue.audio.volume, 0.45);
  assert.equal(queue.state.volume, 0.45);
  assert.equal(queue.controller.toggleMute(), true);
  assert.equal(queue.audio.muted, true);
  queue.audio.metadata(120);
  queue.controller.seekBy(15);
  assert.equal(queue.audio.currentTime, 15);

  const modes = setup(null, function () { return 0; });
  await modes.controller.setQueue([track('a'), track('b'), track('c')], 0, 'Modes', true);
  assert.equal(modes.state.playbackMode, 'list');
  assert.equal(modes.controller.cyclePlaybackMode(), 'one');
  modes.audio.emit('ended');
  await Promise.resolve();
  assert.equal(modes.state.current.id, 'a', 'repeat-one replays the same track after it ends');
  await modes.controller.next();
  assert.equal(modes.state.current.id, 'b', 'manual next still advances in repeat-one mode');
  assert.equal(modes.controller.cyclePlaybackMode(), 'shuffle');
  await modes.controller.next();
  assert.equal(modes.state.current.id, 'c', 'shuffle chooses a different track');
  modes.audio.currentTime = 0;
  await modes.controller.previous();
  assert.equal(modes.state.current.id, 'b', 'shuffle previous follows actual playback history');

  modes.controller.dismiss();
  assert.equal(modes.state.visible, false, 'dismiss hides the player');
  assert.equal(modes.state.queue.length, 3, 'dismiss keeps the queue');
  assert.equal(modes.state.current.id, 'b', 'dismiss keeps the current track');
  assert.equal(modes.audio.paused, true, 'dismiss stops playback');
  await modes.controller.togglePlay();
  assert.equal(modes.state.visible, true, 'playing again restores the dock');

  const duplicateUrls = setup();
  const firstVersion = track('same-a');
  const secondVersion = track('same-b');
  secondVersion.url = firstVersion.url;
  await duplicateUrls.controller.setQueue([firstVersion, secondVersion], 1, 'Versions', false);
  assert.equal(duplicateUrls.state.current.id, 'same-b', 'queue selection uses the stable track ID when URLs are shared');

  const rejected = setup();
  rejected.audio.rejectPlay = true;
  assert.equal(await rejected.controller.playTrack(track('x')), false);
  assert.equal(rejected.state.status, 'error');
  assert.match(rejected.state.error, /\u8bd5\u542c\u542f\u52a8\u5931\u8d25/);

  const snapshot = {
    current: track('saved'),
    queue: [track('saved')],
    queueIndex: 0,
    currentTime: 31,
    contextLabel: 'Saved album',
    visible: false,
    playbackMode: 'shuffle'
  };
  const restored = setup(new FakeStorage({ 'uma-live-player-v2': JSON.stringify(snapshot) }));
  restored.audio.metadata(120);
  assert.equal(restored.state.current.id, 'saved');
  assert.equal(restored.state.status, 'paused', 'a restored session never autoplays');
  assert.equal(restored.audio.currentTime, 31);
  assert.equal(restored.state.contextLabel, 'Saved album');
  assert.equal(restored.state.visible, false, 'a dismissed dock stays hidden after restoration');
  assert.equal(restored.state.playbackMode, 'shuffle');

  const queueSnapshot = {
    current: null,
    queue: [track('saved-a'), track('saved-b')],
    queueIndex: -1,
    currentTime: 0,
    visible: false,
    playbackMode: 'list',
    volume: 0.3,
    muted: true
  };
  const restoredQueue = setup(new FakeStorage({ 'uma-live-player-v2': JSON.stringify(queueSnapshot) }));
  assert.equal(restoredQueue.state.current, null);
  assert.equal(restoredQueue.state.queue.length, 2, 'a queue-only session is restored');
  assert.equal(restoredQueue.state.volume, 0.3);
  assert.equal(restoredQueue.state.muted, true);
  restoredQueue.controller.clearQueue();
  assert.equal(restoredQueue.state.queue.length, 0);
  assert.equal(restoredQueue.state.visible, false);

  const clock = new FakeClock();
  const initialClock = new FakeClock();
  const pendingInitial = setup(null, null, {
    stallTimeout: 20, retryDelays: [0],
    now: initialClock.now.bind(initialClock),
    setTimeout: initialClock.setTimeout.bind(initialClock),
    clearTimeout: initialClock.clearTimeout.bind(initialClock)
  });
  pendingInitial.audio.play = function () { this.playCount += 1; return new Promise(() => {}); };
  pendingInitial.controller.playTrack(track('pending'));
  const initialLoads = pendingInitial.audio.loadCount;
  initialClock.advance(21);
  assert(pendingInitial.audio.loadCount > initialLoads, 'an unresolved initial play promise still starts recovery');
  pendingInitial.controller.destroy();
  const recovering = setup(null, null, {
    stallTimeout: 20,
    retryDelays: [0, 0, 0],
    stablePlaybackWindow: 80,
    now: clock.now.bind(clock),
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock)
  });
  await recovering.controller.playTrack(track('recover'));
  recovering.audio.metadata(120);
  recovering.audio.currentTime = 20;
  recovering.audio.buffered = { length: 1, end: function () { return 80; } };
  recovering.audio.emit('progress');
  recovering.audio.emit('waiting');
  clock.advance(21);
  await Promise.resolve();
  assert.ok(recovering.audio.currentTime > 20, 'a silent buffered stall nudges the playhead and resumes');
  assert.equal(recovering.state.status, 'playing');
  recovering.controller.destroy();

  const reloadClock = new FakeClock();
  const reloading = setup(null, null, {
    stallTimeout: 20,
    retryDelays: [0, 0, 0],
    stablePlaybackWindow: 1000,
    now: reloadClock.now.bind(reloadClock),
    setTimeout: reloadClock.setTimeout.bind(reloadClock),
    clearTimeout: reloadClock.clearTimeout.bind(reloadClock)
  });
  await reloading.controller.playTrack(track('reload'));
  reloading.audio.metadata(120);
  reloading.audio.currentTime = 33;
  reloading.audio.emit('timeupdate');
  reloading.audio.buffered = { length: 1, end: function () { return 33; } };
  const loadsBeforeStall = reloading.audio.loadCount;
  reloading.audio.emit('waiting');
  reloadClock.advance(21);
  await Promise.resolve();
  assert.equal(reloading.audio.loadCount, loadsBeforeStall + 1, 'a stall without buffered audio reloads the source once');
  assert.equal(reloading.state.currentTime, 33, 'a source reload keeps the last playback position');
  reloading.audio.metadata(120);
  assert.equal(reloading.audio.currentTime, 33, 'metadata restoration seeks back to the saved position');
  reloading.controller.destroy();

  const retryClock = new FakeClock();
  const bounded = setup(null, null, {
    stallTimeout: 1000,
    retryDelays: [0, 0, 0],
    stablePlaybackWindow: 10000,
    now: retryClock.now.bind(retryClock),
    setTimeout: retryClock.setTimeout.bind(retryClock),
    clearTimeout: retryClock.clearTimeout.bind(retryClock)
  });
  await bounded.controller.playTrack(track('bounded'));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    bounded.audio.emit('error');
    retryClock.advance(0);
    await Promise.resolve();
  }
  bounded.audio.emit('error');
  assert.equal(bounded.state.status, 'error', 'recovery stops after the configured retry budget');
  assert.match(bounded.state.error, /多次中断/);
  bounded.controller.destroy();

  const pauseClock = new FakeClock();
  const cancelled = setup(null, null, {
    stallTimeout: 1000,
    retryDelays: [50],
    stablePlaybackWindow: 10000,
    now: pauseClock.now.bind(pauseClock),
    setTimeout: pauseClock.setTimeout.bind(pauseClock),
    clearTimeout: pauseClock.clearTimeout.bind(pauseClock)
  });
  await cancelled.controller.playTrack(track('cancelled'));
  const loadsBeforePause = cancelled.audio.loadCount;
  cancelled.audio.emit('error');
  await cancelled.controller.togglePlay();
  pauseClock.advance(60);
  assert.equal(cancelled.audio.loadCount, loadsBeforePause, 'an explicit pause cancels a scheduled recovery');
  assert.equal(cancelled.state.status, 'paused');
  cancelled.controller.destroy();

  const switchClock = new FakeClock();
  const switched = setup(null, null, {
    stallTimeout: 1000,
    retryDelays: [50],
    stablePlaybackWindow: 10000,
    now: switchClock.now.bind(switchClock),
    setTimeout: switchClock.setTimeout.bind(switchClock),
    clearTimeout: switchClock.clearTimeout.bind(switchClock)
  });
  await switched.controller.playTrack(track('old'));
  switched.audio.emit('error');
  await switched.controller.playTrack(track('new'));
  const loadsAfterSwitch = switched.audio.loadCount;
  switchClock.advance(60);
  await Promise.resolve();
  assert.equal(switched.state.current.id, 'new', 'a stale recovery cannot replace a newer track');
  assert.equal(switched.audio.loadCount, loadsAfterSwitch, 'switching tracks cancels the previous source recovery');
  switched.controller.destroy();

  console.log('player controller tests passed');
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
