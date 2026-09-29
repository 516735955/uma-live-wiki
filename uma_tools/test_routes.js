'use strict';

const assert = require('assert');
const routes = require('./route-utils');

assert.strictEqual(routes.home(), '/zh-Hans/');
assert.strictEqual(routes.news('42'), '/zh-Hans/news/42');
assert.strictEqual(routes.events('live-6th', 'day-2'), '/zh-Hans/events/live-6th/sessions/day-2');
assert.strictEqual(routes.songs('song-1'), '/zh-Hans/music/songs/song-1');
assert.strictEqual(routes.songs('song-1', 'lyrics'), '/zh-Hans/music/songs/song-1/lyrics');
assert.strictEqual(routes.albums('album-laca-25001'), '/zh-Hans/music/albums/album-laca-25001');
assert.strictEqual(routes.creators('creator-1', 'collaborators'), '/zh-Hans/music/creators/creator-1/collaborators');
assert.strictEqual(routes.characters('specialweek', 'pedigree'), '/zh-Hans/database/characters/specialweek/pedigree');
assert.strictEqual(routes.voiceActors('waki-azumi', 'songs'), '/zh-Hans/database/voice-actors/waki-azumi/songs');
assert.strictEqual(routes.other(), '/zh-Hans/database/other');
assert.strictEqual(routes.horses('special-week'), '/zh-Hans/database/horses/special-week');
assert.strictEqual(routes.relationships(), '/zh-Hans/database/relationships');
assert.strictEqual(routes.videos(), '/zh-Hans/resources/videos');
assert.strictEqual(routes.query(routes.songs(), { q: 'GIRLS\' LEGEND U', page: 2 }), '/zh-Hans/music/songs?q=GIRLS%27+LEGEND+U&page=2');

console.log('route registry ok');
