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
    this.readyState = 0;
    this.emit('loadstart');
  }
  play() {
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

function track(id) {
  return {
    id: id,
    url: 'https://audio.example/' + id + '.mp3',
    name: 'Track ' + id,
    artist: 'Singer ' + id,
    vocalists: [{ voice_actor_id: 'va-' + id, voice_actor_name: 'Singer ' + id }]
  };
}

function setup(storage, random) {
  const audio = new FakeAudio();
  const controller = createPlayerController({
    getAudio: function () { return audio; },
    proxyUrl: function (url) { return '/proxy?url=' + encodeURIComponent(url); },
    storage: storage || new FakeStorage(),
    random: random
  });
  controller.bind();
  return { audio: audio, controller: controller, state: controller.state };
}

async function run() {
  const normalized = normalizeTrack(track('a'));
  assert.equal(normalized.vocalists[0].id, 'va-a', 'voice actor IDs are normalized for clickable credits');

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

  console.log('player controller tests passed');
}

run().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
