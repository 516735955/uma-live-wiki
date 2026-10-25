'use strict';

const assert = require('assert');
const model = require('./catalog-model');
const versionChoice = {original_version_id:'original',versions:[
  {id:'other',releases:[{audio_url:'other.mp3'}]}, {id:'original',releases:[{audio_url:'original.mp3'}]}]};
assert.strictEqual(model.playableRecording(versionChoice).release.audio_url,'original.mp3');
assert.strictEqual(model.playableRecording(versionChoice,'missing'),null,'an explicit missing version never falls back to another recording');
assert.strictEqual(model.eventSongCount({sessions:[{performances:[{song:'Song'}]}]}),1);
assert.strictEqual(model.youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=3'),model.youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
assert.strictEqual(model.youtubeVideoId('https://youtube.com.example.org/watch?v=dQw4w9WgXcQ'),'');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CatalogStore, stableAlbumId } = require('./catalog-store');

function copyDir(from, to) {
  const stack = [[from, to]];
  while (stack.length) {
    const [src, dst] = stack.pop();
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === 'auto_update' || entry.name === 'horses_cache' || entry.name === 'news_image_cache') continue;
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) stack.push([s, d]);
      else {
        try { fs.copyFileSync(s, d); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
}

async function main() {
  const store = new CatalogStore(path.join(__dirname, '..', 'data'));
  const snapshot = await store.get();
  assert(snapshot.buildId, 'catalog build id is required');
  assert(/-api\d+-/.test(snapshot.buildId), 'catalog build id must include its API response revision');
  assert(snapshot.eventRows.length > 400, 'event catalog is unexpectedly small');
  assert(snapshot.songRows.length > 1000, 'song catalog is unexpectedly small');
  assert(snapshot.creatorRows.length > 100, 'creator catalog is unexpectedly small');
  assert(snapshot.albumRows.length > 100, 'album catalog is unexpectedly small');

  const eventList = await store.events(new URLSearchParams('page_size=5000'));
  assert.strictEqual(eventList.total, snapshot.eventRows.length);
  assert(eventList.items.every((event) => !event.cast && !event.sessions), 'event list leaked detail payloads');
  assert((await store.events(new URLSearchParams('q=PakaLive+TV'))).total > 0, 'server pagination retains series-name search');
  assert((await store.events(new URLSearchParams('q=Tokai+Teio'))).total > 0, 'server pagination retains character aliases');
  assert.strictEqual((await store.events(new URLSearchParams('kind=concert&series=winning-live-release'))).total,
    (await store.events(new URLSearchParams('kind=onsite&series=winning-live-release'))).total,
    'historical category links keep the complete series after primary classification changes');

  const knownEventId = 'live-numbered-6th-event-2025-10-18';
  const knownEvent = await store.event(knownEventId);
  assert(knownEvent && knownEvent.event, 'known hand-checked live is missing');
  assert.strictEqual(knownEvent.event.sessions.length, 2);
  assert(knownEvent.event.sessions.every(session => session.performances.length >= 25), 'both live days retain their complete song lists');
  assert(knownEvent.catalog_songs.length > 0, 'event playback needs scoped recording versions');
  for (const event of snapshot.eventsDoc.events) {
    for (const alias of event.id_aliases || []) {
      const resolved = (await store.event(alias)).event;
      const grouped = snapshot.parentForChild.get(event.id);
      assert.strictEqual(resolved.id, grouped ? grouped.parent.id : event.id, 'merged event IDs keep resolving to their canonical presentation');
      if (grouped) assert.strictEqual(resolved.requested_session_id, grouped.session_id, 'old child aliases retain the intended session');
    }
  }
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
  for (const method of ['songs', 'albums', 'creators']) {
    const straight = await store[method](new URLSearchParams({q:"Girls' Legend",page_size:5000}));
    const curved = await store[method](new URLSearchParams({q:'Girls’ Legend',page_size:5000}));
    assert(straight.total > 0, method + ' contains the known title');
    assert.deepStrictEqual(curved.items.map(row => row.id), straight.items.map(row => row.id), method + ' search accepts equivalent apostrophes');
  }

  const creatorList = await store.creators(new URLSearchParams('page_size=5000'));
  const personPage = await store.creators(new URLSearchParams('type=person&page=2&page_size=40'));
  assert(personPage.total > 40 && personPage.items.length <= 40);
  assert(personPage.items.every(person => person.type !== 'organization'));
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
  const cinderella = await store.album('album-laca-19146', '');
  for (const title of ['約束', '葛藤']) {
    const song = cinderella.catalog_songs.find(row => row.title === title);
    assert(song, 'Cinderella soundtrack includes ' + title);
    assert(song.versions.some(version => version.releases.some(release => release.album_id === cinderella.album.id)));
  }
  assert.strictEqual(await store.song('約束'), null, 'ambiguous title requires a stable song identity');
  assert.strictEqual(await store.voices(new URLSearchParams('id=missing')), null);
  for (const id of ['missing', '__proto__', 'constructor']) assert.strictEqual(await store.appearance('character', id), null);
  const scopedAlbum = await store.album('album-lacz-10116', '');
  assert(Buffer.byteLength(JSON.stringify(scopedAlbum)) < 300 * 1024, 'album recordings must remain scoped to the requested album');
  assert(scopedAlbum.catalog_songs.every(song => !song.performances && !song.detail_complete));
  const solo = await store.album('album-lacz-10116', '');
  const umapyoi = (await store.song('song-228f943b49')).song;
  const recordingFor = albumId => umapyoi.versions.find(version => version.releases.some(release => release.album_id === albumId && !version.version_label.includes('Size') && !version.version_label.includes('Remastered')));
  assert.notStrictEqual(recordingFor('album-laca-15621').id, recordingFor('album-laca-15859').id, 'different officially credited singing ensembles must not share a recording');
  assert.strictEqual(recordingFor('album-laca-15621').releases.find(release => release.album_id === 'album-laca-15621').vocalists.length, 3, 'STARTING GATE 01 retains all three credited singers');
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
        assert(release.vocalists.some((vocalist) => vocalist.character_id === 'specialweek'));
      });
    });
  });

  const ensembleId = 'song-umapyoi-legend-e1d012a94c';
  const ensemble = (await store.song(ensembleId)).song.versions[0].releases[0].vocalists;
  for (const [type,id] of [['voice_actor','va-0039'], ['character','meishodoto']]) {
    const projected = (await store.appearance(type,id)).songs.find(song => song.id===ensembleId);
    assert.deepStrictEqual(projected.versions[0].releases[0].vocalists, ensemble, 'person-specific recording selection preserves the complete ordered cast');
  }

  // A curated profile edit must invalidate HTTP caches even when the generated
  // batch ID stays the same; otherwise removed actors remain visible.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-catalog-profile-'));
  try {
    copyDir(path.join(__dirname, '..', 'data'), temporary);
    const manifestFile = path.join(temporary, 'catalog_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const expectedHome = await store.home();
    assert.strictEqual(expectedHome.stats.events, eventList.total, 'home and directory count the same parent activities');
    if (expectedHome.nextEvent?.session_id) {
      const next = (await store.event(expectedHome.nextEvent.id)).event;
      const session = next.sessions.find(row => row.id === expectedHome.nextEvent.session_id);
      assert(session && session.schedule_status !== 'cancelled');
      assert.strictEqual(expectedHome.nextEvent.date, session.date);
    }
    manifest.home_stats = expectedHome.stats;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const homeStore = new CatalogStore(temporary);
    homeStore.get = () => { throw new Error('home must not parse the full music catalogs'); };
    const loadHome = homeStore.loadHome.bind(homeStore);
    let homeLoads = 0;
    homeStore.loadHome = async () => { homeLoads++; return loadHome(); };
    const summaries = await Promise.all(Array.from({length: 20}, () => homeStore.home()));
    assert.strictEqual(homeLoads, 1, 'concurrent cold home reads share one load');
    assert(summaries.every(summary => summary === summaries[0]));
    assert.deepStrictEqual((await homeStore.home()).stats, expectedHome.stats);
    const eventFile = path.join(temporary, 'events_catalog.json');
    const originalEvents = fs.readFileSync(eventFile, 'utf8');
    const fixture = { build_id: manifest.build_id, events: [
      { id: 'past', title: 'Earlier', date: '2000-01-01', sessions: [{ id: 'past-session', date: '2000-01-01' }] },
      { id: 'cancelled', title: 'Cancelled', date: '2099-01-02', schedule_status: 'cancelled', sessions: [{ id: 'cancelled-session', date: '2099-01-02' }] },
      { id: 'future', title: 'Next', date: '2099-01-03', sessions: [{ id: 'future-session', date: '2099-01-03' }] }
    ], event_groups: [{ id: 'parent', kind: 'onsite_group', title: 'Series', members: [{event_id:'past'}, {event_id:'cancelled'}, {event_id:'future'}] }] };
    fs.writeFileSync(eventFile, JSON.stringify(fixture));
    const groupedHome = await new CatalogStore(temporary).home();
    assert.strictEqual(groupedHome.stats.events, 1);
    assert.strictEqual(groupedHome.nextEvent.id, 'parent');
    assert.strictEqual(groupedHome.nextEvent.session_id, 'future-session');
    assert.strictEqual(groupedHome.nextEvent.date, '2099-01-03');
    fs.writeFileSync(eventFile, originalEvents);
    const editedStore = new CatalogStore(temporary);
    const before = await editedStore.voices();
    const filename = path.join(temporary, 'voice_actor_profiles.json');
    const profiles = JSON.parse(fs.readFileSync(filename, 'utf8'));
    profiles.voice_actors.pop();
    fs.writeFileSync(filename, JSON.stringify(profiles));
    const after = await editedStore.voices();
    assert.strictEqual(after.voice_actors.length, before.voice_actors.length - 1);
    assert.notStrictEqual(after.build_id, before.build_id, 'profile edits must change the HTTP catalog revision');
    const generated = ['catalog_manifest.json','events_catalog.json','song_catalog.json','creator_catalog.json','appearance_index.json','voice_actor_profiles.json'];
    const saved = Object.fromEntries(generated.map(name => [name, JSON.parse(fs.readFileSync(path.join(temporary, name), 'utf8'))]));
    fs.mkdirSync(path.join(temporary, 'auto_update'), {recursive:true});
    const pending = path.join(temporary, 'auto_update/catalog_pending.json');
    fs.writeFileSync(pending, JSON.stringify(saved));
    fs.writeFileSync(path.join(temporary, 'song_catalog.json'), JSON.stringify({...saved['song_catalog.json'],build_id:'interrupted'}));
    const recovered = await new CatalogStore(temporary).get();
    assert.strictEqual(recovered.manifest.build_id, saved['catalog_manifest.json'].build_id, 'cold readers recover a complete generation after interrupted publication');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  console.log('catalog store ok:', snapshot.eventRows.length, 'events,', snapshot.songRows.length, 'songs,', snapshot.albumRows.length, 'albums');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
