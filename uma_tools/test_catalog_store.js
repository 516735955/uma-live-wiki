'use strict';

const assert = require('assert');
const path = require('path');
const { CatalogStore, albumSlug } = require('./catalog-store');

async function main() {
  const store = new CatalogStore(path.join(__dirname, '..', 'data'));
  const snapshot = await store.get();
  assert(snapshot.buildId, 'catalog build id is required');
  assert(snapshot.eventRows.length > 400, 'event catalog is unexpectedly small');
  assert(snapshot.songRows.length > 1000, 'song catalog is unexpectedly small');
  assert(snapshot.albumRows.length > 100, 'album catalog is unexpectedly small');

  const eventList = await store.events(new URLSearchParams('page_size=5000'));
  assert.strictEqual(eventList.total, snapshot.eventRows.length);
  assert(eventList.items.every((event) => !event.cast && !event.sessions), 'event list leaked detail payloads');

  const knownEventId = 'live-numbered-6th-event-2025-10-18';
  const knownEvent = await store.event(knownEventId);
  assert(knownEvent && knownEvent.event, 'known hand-checked live is missing');
  assert.strictEqual(knownEvent.event.sessions.length, 2);
  assert.deepStrictEqual(knownEvent.event.sessions.map((session) => session.performances.length), [27, 27]);

  const songList = await store.songs(new URLSearchParams('page_size=5000'));
  assert.strictEqual(songList.total, snapshot.songRows.length);
  assert(songList.items.every((song) => !song.versions && !song.performances), 'song list leaked detail payloads');
  const song = await store.song(songList.items[0].id);
  assert(song && song.song && Array.isArray(song.song.versions), 'song detail is incomplete');

  const albumList = await store.albums(new URLSearchParams('page_size=5000'));
  assert.strictEqual(albumList.total, snapshot.albumRows.length);
  assert.strictEqual(albumList.items[0].slug, albumSlug(albumList.items[0].name), 'album URL slug must match the browser route');
  const album = await store.album(albumList.items[0].slug, '');
  assert(album && album.album && Array.isArray(album.catalog_songs), 'album detail is incomplete');

  const appearance = await store.appearance('character', 'specialweek');
  assert(appearance.appearance.songs.length > 0, 'known character songs are missing');
  appearance.songs.forEach((appearanceSong) => {
    appearanceSong.versions.forEach((version) => {
      version.releases.forEach((release) => {
        assert(release.vocalists.length > 0);
        assert(release.vocalists.every((vocalist) => vocalist.character_id === 'specialweek'));
      });
    });
  });

  console.log('catalog store ok:', snapshot.eventRows.length, 'events,', snapshot.songRows.length, 'songs,', snapshot.albumRows.length, 'albums');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
