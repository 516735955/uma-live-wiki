'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { CatalogStore } = require('./catalog-store');
const { AnimeStore } = require('./anime-store');
const source = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function main() {
  const store = new CatalogStore(path.join(__dirname, '..', 'data'));
  const animeStore = new AnimeStore(path.join(__dirname, '..', 'data'));
  let animeFailure = '';
  let delayedGraph = null;
  const calls = [];
  const details = new Map();
  let newsDetail = deferred();
  let newsCalls = 0;
  let pedigreeAttempts = 0;
  let pendingNewsIndex = null;
  let app;
  const location = new URL('http://localhost/zh-Hans/music/songs');
  const window = {
    location, scrollTo() {}, requestAnimationFrame(callback) { callback(); },
    dispatchEvent() {}, setTimeout, clearTimeout,
    CHAR_INDEX: [{ id: 'mock', name: 'Mock' }], CHAR_DETAIL: {}, UmaCharacterUi: { init() {} },
    HORSES: [{ id: 'mock-horse', zh: 'Mock Horse' }],
    UmaPlayer: require('./player-controller'), UmaRoutes: require('./route-utils'),
    UmaUi: {}, UmaCreatorNetwork: {}, UmaAnimeLoader: require('./anime-loader'), UmaAnimeStaff: require('./anime-staff')
  };
  const history = {
    state: {}, pushState(state, unused, url) { this.state = state; location.href = new URL(url, location).href; },
    replaceState(state, unused, url) { this.pushState(state, unused, url); }
  };
  window.UmaApi = {
    query: (params) => '?' + new URLSearchParams(Object.entries(params).filter((entry) => entry[1] !== undefined)).toString(),
    async request(url) {
      calls.push(url);
      const parsed = new URL(url, location);
      if (parsed.pathname === '/api/news-index') {
        newsCalls += 1;
        if (pendingNewsIndex) return pendingNewsIndex.promise;
        return { information_list: Array.from({ length: 50 }, (_, i) => ({ announce_id: i + 1, title: 'Item', announce_label: 3, post_at: '2026-10-08' })) };
      }
      if (parsed.pathname === '/api/catalog/songs') return store.songs(parsed.searchParams);
      if (parsed.pathname === '/api/catalog/events') return store.events(parsed.searchParams);
      if (parsed.pathname === '/api/catalog/albums') return store.albums(parsed.searchParams);
      if (parsed.pathname === '/api/catalog/creators') return store.creators(parsed.searchParams);
      if (parsed.pathname === '/api/catalog/voice-actors') return store.voices();
      if (parsed.pathname === '/api/catalog/appearance') return store.appearance(parsed.searchParams.get('type'), parsed.searchParams.get('id'));
      if (parsed.pathname === '/api/catalog/anime') {
        const scope = parsed.searchParams.get('scope');
        if (scope === 'graph' && delayedGraph) return delayedGraph.promise;
        if (animeFailure === scope) throw new Error('HTTP 503');
        return animeStore.response(scope, parsed.searchParams.get('id'));
      }
      if (parsed.pathname === '/api/catalog/anime-media') return { songs: [], events: [] };
      if (parsed.pathname === '/api/catalog/song') return details.get(parsed.searchParams.get('id')).promise;
      return {};
    }
  };
  const context = vm.createContext({
    window, history, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    CustomEvent: function () {}, console,
    fetch(url) {
      if (url.startsWith('/api/news-detail')) return newsDetail.promise;
      newsCalls += 1;
      return Promise.resolve({ ok: true, json: async () => ({ information_list: Array.from({ length: 50 }, (_, i) => ({ announce_id: i + 1, title: 'Item', announce_label: 3, post_at: '2026-10-08' })) }) });
    }
  });
  vm.runInContext(source('vendor/vue.global.prod.js'), context);
  context.document = {
    body: { classList: { toggle() {} } }, getElementById() { return null; }, querySelector() { return null; },
    createElement() { return {}; },
    head: { appendChild(script) { pedigreeAttempts += 1; queueMicrotask(() => script.onerror()); } }
  };
  context.Vue.createApp = (options) => ({ component() {}, mount() { app = options.setup(); } });
  vm.runInContext(source('app.js'), context);
  await app.applyCurrentRoute();
  assert.strictEqual(app.songDbPaged.value.length, 30);
  assert(calls.every((url) => !url.includes('page_size=2000')), 'song archive uses real API pagination');

  location.href = 'http://localhost/zh-Hans/music/songs?page=999';
  await app.applyCurrentRoute();
  assert.strictEqual(app.songDbPage.value, Math.ceil(app.songTotal.value / 30));
  assert(!location.search.includes('999'));
  location.href = 'http://localhost/zh-Hans/music/songs?q=' + encodeURIComponent('アタシたちは必ず掴む勝利');
  await app.applyCurrentRoute();
  assert(app.songDbPaged.value.some((song) => song.title.includes('ウマRAP')), 'frontend keeps backend lyric search matches');

  const a = deferred(), b = deferred();
  details.set('a', a); details.set('b', b);
  const old = app.openSong('a');
  const latest = app.openSong('b', 'credits');
  b.resolve({ song: { id: 'b', title: 'Latest', versions: [] } });
  await latest;
  a.resolve({ song: { id: 'a', title: 'Old', versions: [] } });
  await old;
  assert.strictEqual(app.songDetail.value.id, 'b', 'late entity responses never overwrite a newer detail');
  assert.strictEqual(app.songSection.value, 'credits');

  const music = deferred(); details.set('music', music);
  music.resolve({ song: { id: 'music', title: 'Music', versions: [
    { id: 'original', credits: [{ role: 'composer', name: 'A' }, { role: 'composer', name: 'B' }],
      lyrics: { lines: ['Hello', 'world!', 'Next'], line_ids: ['one', 'two', 'three'], timings: [{ line_id: 'one', start_ms: 100 }, { line_id: 'three', start_ms: 900 }] } },
    { id: 'alternate', credits: [{ role: 'composer', name: 'A' }], lyrics: { lines: ['Hello world！', 'Next'] } }
  ] } });
  await app.openSong('music');
  assert.strictEqual(app.songCreditVersions.value.length, 2, 'removed contributors still produce a visible version difference');
  assert.strictEqual(app.songCreditVersions.value[1].display_credits[0].name, 'A');
  assert.strictEqual(app.songLyricVersions.value.length, 1, 'punctuation and line wrapping do not create duplicate lyrics');
  assert.strictEqual(app.selectedSongLyricLines.value[1].start_ms, undefined, 'a missing timing does not shift the next line');
  assert.strictEqual(app.selectedSongLyricLines.value[2].start_ms, 900);

  location.href = 'http://localhost/zh-Hans/news?type=media&page=2';
  await app.applyCurrentRoute();
  assert.strictEqual(app.newsType.value, 'media');
  assert.strictEqual(app.newsPage.value, 2, 'restoring filters must not reset a restored page: ' + location.href + ' count=' + app.newsFiltered.value.length);
  const beforeRefresh = newsCalls;
  await app.refreshNews();
  assert.strictEqual(newsCalls, beforeRefresh + 1, 'refresh issues a new request');
  assert.strictEqual(app.newsPage.value, 2);
  const pendingNews = app.openNews(1);
  assert.strictEqual(app.newsDetailLoading.value, true, 'news loading is visible instead of an empty article');
  location.href = 'http://localhost/zh-Hans/music/albums?sort=name&page=2';
  await app.applyCurrentRoute();
  assert.strictEqual(app.relQuery.value, '');
  assert.strictEqual(app.relSort.value, 'name');
  assert.strictEqual(app.relPage.value, 2);
  newsDetail.resolve({ ok: true, json: async () => ({ detail: { announce_id: 1, title: 'Stale news', message: 'Stale body' } }) });
  await pendingNews;
  assert.strictEqual(app.newsDetail.value, null, 'late news cannot replace a different page');
  assert.strictEqual(app.newsDetailLoading.value, false, 'abandoned articles clear their loading state');
  assert.strictEqual(app.dbView.value, 'albums');

  newsDetail = deferred();
  const missingNews = app.openNews(999999);
  newsDetail.resolve({ ok: false, status: 404 });
  await missingNews;
  assert.strictEqual(app.newsDetail.value, null, 'failed articles do not retain an empty placeholder');
  assert.strictEqual(location.pathname, '/zh-Hans/news', 'failed articles return to the news list');
  assert.strictEqual(app.newsError.value, '', 'no detail retry notice leaks into the list');

  const creatorLoads = calls.filter((url) => url.startsWith('/api/catalog/creators')).length;
  await app.loadCreatorCatalog();
  await app.loadCreatorCatalog();
  assert.strictEqual(calls.filter((url) => url.startsWith('/api/catalog/creators')).length, creatorLoads + 2, 'completed creator loads can refresh through the API cache');
  await app.openCharacter('mock');
  await app.openCharacter('mock');
  assert.strictEqual(pedigreeAttempts, 2, 'failed pedigree metadata loads retry instead of retaining an empty result');
  assert.strictEqual(window.CHARACTER_PEDIGREE_META, undefined);

  location.href = 'http://localhost/zh-Hans/news';
  pendingNewsIndex = deferred();
  const pendingArchive = app.applyCurrentRoute();
  const c = deferred();
  details.set('c', c);
  const chosenDetail = app.openSong('c');
  pendingNewsIndex.resolve({ information_list: [] });
  await pendingArchive;
  c.resolve({ song: { id: 'c', title: 'Chosen detail', versions: [] } });
  await chosenDetail;
  assert.strictEqual(app.songDetail.value.id, 'c', 'late route preparation cannot cancel a newly chosen entity');

  const scoped = await store.appearance('voice_actor', 'va-0001');
  const scopedSong = scoped.songs[0];
  const fullSong = await store.song(scopedSong.id);
  const fullReply = deferred();
  fullReply.resolve(fullSong);
  details.set(scopedSong.id, fullReply);
  await app.openSong(scopedSong.id);
  await app.openVoice('va-0001');
  await app.retryAppearance('voice_actor', 'va-0001');
  assert.strictEqual(app.relationSong({ song_id: scopedSong.id }).versions.length, scopedSong.versions.length);
  await app.openSong('c');
  assert.strictEqual(app.relationSong({ song_id: scopedSong.id }).versions.length, fullSong.song.versions.length, 'an actor-specific projection never replaces the complete song cache');

  const graphContext = vm.createContext({ window: { UmaApi: window.UmaApi }, console });
  vm.runInContext(source('creator-network.js'), graphContext);
  const component = graphContext.window.UmaCreatorNetwork.CreatorNetwork;
  const selection = context.Vue.reactive(Object.assign(component.data(), { creator: { id: 'root' }, catalog: [] }));
  const graphA = deferred(), graphB = deferred();
  graphContext.window.UmaApi = { request: (url) => url.includes('id=a') ? graphA.promise : graphB.promise, query: window.UmaApi.query };
  const firstSelection = component.methods.choose.call(selection, { creator_id: 'a' });
  const secondSelection = component.methods.choose.call(selection, { creator_id: 'b' });
  graphB.resolve({ creator: { id: 'b' } }); await secondSelection;
  assert.strictEqual(selection.loading, false, 'reactive graph selection exits its loading state');
  graphA.resolve({ creator: { id: 'a' } }); await firstSelection;
  assert.strictEqual(selection.selectedDetail.id, 'b', 'graph selection ignores late responses');
  const closed = deferred();
  graphContext.window.UmaApi.request = () => closed.promise;
  const closingSelection = component.methods.choose.call(selection, { creator_id: 'a' });
  component.methods.close.call(selection);
  closed.resolve({ creator: { id: 'a' } }); await closingSelection;
  assert.strictEqual(selection.selectedDetail, null, 'closing the inspector invalidates its pending response');
  assert.strictEqual(selection.loading, false);
  graphContext.window.UmaApi.request = () => Promise.reject(new Error('HTTP 503'));
  await component.methods.choose.call(selection, { creator_id: 'a' });
  assert.strictEqual(selection.loading, false);
  assert(selection.loadError.includes('重试'), 'failed requests expose a retry instead of remaining busy');
  graphContext.window.UmaApi.request = () => Promise.resolve({ creator: { id: 'a' } });
  await component.methods.choose.call(selection, { creator_id: 'a' });
  assert.strictEqual(selection.selectedDetail.id, 'a');
  assert.strictEqual(selection.loadError, '');
  location.href = 'http://localhost/zh-Hans/database/anime?format=movie&year=2023';
  await app.applyCurrentRoute();
  assert.deepStrictEqual(Array.from(app.animeFiltered.value, work => work.id), ['anime-movie-beginning-new-era','anime-rttt'], 'retired year URLs do not apply hidden filters');
  assert(app.animeWorkHref(app.animeFiltered.value.find(work => work.id === 'anime-rttt')).includes('edition=film'));
  location.href = 'http://localhost/zh-Hans/database/anime?format=web&year=2024';
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeFiltered.value.length, 1, 'network format remains available without a year filter');
  location.href = 'http://localhost/zh-Hans/database/anime?format=web_short';
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeFormat.value, 'short');
  assert.strictEqual(app.animeFiltered.value.length, 4, 'all television and network shorts share one filter');
  app.clearAnimeFilters();
  app.animeQuery.value = '走向我们的舞台';
  const actualUnit = (await animeStore.response('work', 'anime-s3')).units.find(unit => unit.number === 12);
  app.animeQuery.value = actualUnit.title_ja;
  assert(app.animeWorkHref(app.animeFiltered.value.find(work => work.id === 'anime-s3')).includes(actualUnit.id), 'a unique episode title opens that episode');

  animeFailure = 'work';
  location.href = 'http://localhost/zh-Hans/database/anime/anime-s3/episodes/anime-s3-e11?section=staff&staff=' + encodeURIComponent('原画');
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeDetail.value, null);
  assert(app.routeError.value, 'failed direct detail exposes a retry');
  animeFailure = '';
  await app.retryAnime();
  assert.strictEqual(app.animeDetail.value.id, 'anime-s3', 'retry restores the requested detail rather than showing the archive');
  assert.strictEqual(app.animeUnitDetail.value.id, 'anime-s3-e11');
  assert.strictEqual(app.routeError.value, '');
  assert(app.animeUnitHref(app.animeAdjacentUnits.value.next).includes('staff='));
  const group = app.animeStaffGroups.value[0];
  app.toggleAnimeStaffGroup(group);
  const episodeGroupOpen = app.animeStaffGroupOpen(group);
  location.href = 'http://localhost' + app.animeUnitHref(app.animeAdjacentUnits.value.next);
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeSection.value, 'staff');
  assert.strictEqual(app.animeStaffQuery.value, '原画');
  location.href = 'http://localhost/zh-Hans/database/anime/anime-s3/episodes/anime-s3-e11?section=staff&staff=' + encodeURIComponent('原画');
  await app.applyCurrentRoute();
  assert(app.animeStaffGroups.value.some(row => row.key === group.key), 'same episode restores the same role: ' + group.key + ' / ' + app.animeStaffGroups.value.map(row => row.key).join(',') + ' query=' + app.animeStaffQuery.value + ' URL=' + location.href + ' detail=' + (app.animeDetail.value || {}).id + ' unit=' + (app.animeUnitDetail.value || {}).id + ' error=' + app.routeError.value + ' rows=' + app.animeCatalog.value.staff.length);
  assert.strictEqual(app.animeStaffGroupOpen(app.animeStaffGroups.value.find(row => row.key === group.key)), episodeGroupOpen, 'returning restores only this episode’s disclosure state');
  location.href = 'http://localhost/zh-Hans/database/anime/anime-s3?section=episodes&episodes=12';
  await app.applyCurrentRoute();
  assert.deepStrictEqual(Array.from(app.animeUnitGroups.value.flatMap(row => row.units), unit => unit.number), [12], 'number search does not also match episode 1 or 2');
  assert(app.animeUnitHref(app.animeUnitGroups.value[0].units[0], 'characters').includes('episodes=12'));
  location.href = 'http://localhost/zh-Hans/database/anime/anime-rttt?edition=web&section=staff';
  await app.applyCurrentRoute();
  app.setAnimeEdition('film');
  assert.strictEqual(app.animeSection.value, 'staff');
  app.setAnimeEdition('web');
  assert.strictEqual(app.animeSection.value, 'staff');

  location.href = 'http://localhost/zh-Hans/database/staff?page=2&sort=name';
  await app.applyCurrentRoute();
  assert.strictEqual(app.staffPage.value, 2, 'restoring a new sort must not reset the requested page');
  location.href = 'http://localhost/zh-Hans/database/staff?q=UMP&sort=name';
  await app.applyCurrentRoute();
  assert.strictEqual(app.staffFiltered.value.length, 1);
  assert.strictEqual(app.staffFiltered.value[0].id, 'staff-ump');
  const thirdRolePerson = app.animeCatalog.value.people.find(person => person.roles.length > 2);
  app.staffQuery.value = thirdRolePerson.roles[2];
  assert(app.staffVisibleRoles(thirdRolePerson).includes(thirdRolePerson.roles[2]), 'the matching role is visible even when it is not a primary role');
  location.href = 'http://localhost/zh-Hans/database/staff/' + encodeURIComponent('staff-山本健');
  await app.applyCurrentRoute();
  const rtttParticipation = app.staffCredits.value.find(group => group.work.id === 'anime-rttt');
  assert(rtttParticipation, 'the participant has RTTT credits');
  assert(rtttParticipation.roles.some(role => role.editions.includes('film')), 'film participation remains visible alongside network episodes');
  assert(rtttParticipation.roles.some(role => role.units.length), 'network episode tags remain individually available');
  animeFailure = 'person';
  location.href = 'http://localhost/zh-Hans/database/staff/staff-UMP';
  await app.applyCurrentRoute();
  animeFailure = '';
  await app.retryAnime();
  assert.strictEqual(app.staffDetail.value.id, 'staff-ump', 'legacy person links survive detail failure and retry');

  delayedGraph = deferred();
  location.href = 'http://localhost/zh-Hans/database/voice-actors';
  const oldGraphRoute = app.applyCurrentRoute();
  await Promise.resolve();
  location.href = 'http://localhost/zh-Hans/database/anime';
  await app.applyCurrentRoute();
  delayedGraph.resolve(null);
  await oldGraphRoute;
  delayedGraph = null;
  assert.strictEqual(app.animeError.value, '', 'an abandoned graph failure does not replace the current page with an error');
  console.log('frontend regressions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
