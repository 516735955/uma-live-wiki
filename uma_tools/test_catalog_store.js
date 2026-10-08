'use strict';

const assert = require('assert');
const path = require('path');
const { CatalogStore, stableAlbumId } = require('./catalog-store');

async function main() {
  const store = new CatalogStore(path.join(__dirname, '..', 'data'));
  const snapshot = await store.get();
  assert(snapshot.buildId, 'catalog build id is required');
  assert(snapshot.buildId.includes('-api3-'), 'catalog response revision must invalidate caches when the API schema changes');
  assert(snapshot.eventRows.length > 400, 'event catalog is unexpectedly small');
  assert(snapshot.songRows.length > 1000, 'song catalog is unexpectedly small');
  assert(snapshot.creatorRows.length > 100, 'creator catalog is unexpectedly small');
  assert(snapshot.albumRows.length > 100, 'album catalog is unexpectedly small');

  const eventList = await store.events(new URLSearchParams('page_size=5000'));
  assert.strictEqual(eventList.total, snapshot.eventRows.length);
  assert(eventList.items.every((event) => !event.cast && !event.sessions), 'event list leaked detail payloads');
  assert((await store.events(new URLSearchParams('q=PakaLive+TV'))).total > 0, 'server pagination retains series-name search');
  assert((await store.events(new URLSearchParams('q=Tokai+Teio'))).total > 0, 'server pagination retains character aliases');

  const knownEventId = 'live-numbered-6th-event-2025-10-18';
  const knownEvent = await store.event(knownEventId);
  assert(knownEvent && knownEvent.event, 'known hand-checked live is missing');
  assert.strictEqual(knownEvent.event.sessions.length, 2);
  assert.deepStrictEqual(knownEvent.event.sessions.map((session) => session.performances.length), [27, 27]);
  assert(knownEvent.catalog_songs.length > 0, 'event playback needs scoped recording versions');
  for (const session of knownEvent.event.sessions) {
    for (const performance of session.performances) {
      if (!performance.song_id || !performance.version_id) continue;
      const projected = knownEvent.catalog_songs.find((song) => song.id === performance.song_id);
      assert(projected && projected.versions.some((version) => version.id === performance.version_id), 'event projection lost its performed recording version');
    }
  }

  const songList = await store.songs(new URLSearchParams('page_size=5000'));
  assert.strictEqual(songList.total, snapshot.songRows.length);
  assert(songList.items.every((song) => !song.versions && !song.performances), 'song list leaked detail payloads');
  const song = await store.song(songList.items[0].id);
  assert(song && song.song && Array.isArray(song.song.versions), 'song detail is incomplete');
  const girlsLegend = await store.song('song-girls-legend-u-a4a797abe1');
  assert(girlsLegend.song.versions.some((version) => version.lyrics && version.lyrics.lines.length > 0), 'canonical lyric documents were not hydrated');
  const girlsLegendLegacy = await store.song('song-girls-legend-u-68f74d7b92');
  assert.strictEqual(girlsLegendLegacy.song.id, girlsLegend.song.id, 'merged song legacy IDs must keep resolving');

  const creatorList = await store.creators(new URLSearchParams('page_size=5000'));
  assert.strictEqual(creatorList.total, snapshot.creatorRows.length);
  assert(creatorList.items.every((creator) => !creator.works && !creator.collaborators), 'creator list leaked detail payloads');
  const creator = await store.creator(creatorList.items[0].id);
  assert(creator && creator.creator && Array.isArray(creator.creator.works), 'creator detail is incomplete');

  const albumList = await store.albums(new URLSearchParams('page_size=5000'));
  assert.strictEqual(albumList.total, snapshot.albumRows.length);
  assert.strictEqual(new Set(albumList.items.map((item) => item.id)).size, albumList.items.length, 'album URL ids must be unique');
  assert(albumList.items.every((item) => /^album-[a-z0-9-]+$/.test(item.id)), 'album URL ids must use the canonical format');
  assert.strictEqual(albumList.items[0].id, stableAlbumId(albumList.items[0]), 'album URL id must be stable');
  const album = await store.album(albumList.items[0].id, '');
  assert(album && album.album && Array.isArray(album.catalog_songs), 'album detail is incomplete');
  const solo = await store.album('album-lacz-10116', '');
  assert.strictEqual(solo.catalog_songs.length, new Set(solo.catalog_songs.map((song) => song.id)).size, 'solo tracks must not duplicate full song objects');
  assert.strictEqual(solo.album.songs.length, 77, 'all solo recordings remain present');
  const lastPage = await store.songs(new URLSearchParams('page=999&page_size=30'));
  assert.strictEqual(lastPage.page, Math.ceil(lastPage.total / 30), 'invalid pages clamp to the last real page');
  const lyricsMatch = await store.songs(new URLSearchParams('q=アタシたちは必ず掴む勝利'));
  assert(lyricsMatch.items.some((song) => song.title.includes('ウマRAP')), 'lyrics search results must survive list projection');

  store.fileSignature = async () => { throw new Error('file being replaced'); };
  const fallbacks = await Promise.all([store.get(), store.get()]);
  assert(fallbacks.every((value) => value === snapshot), 'every concurrent reader keeps the last complete snapshot');

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
