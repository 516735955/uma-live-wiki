'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { CatalogStore } = require('./catalog-store');
const source = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function main() {
  const store = new CatalogStore(path.join(__dirname, '..', 'data'));
  const calls = [];
  const details = new Map();
  const newsDetail = deferred();
  let newsCalls = 0;
  let pedigreeAttempts = 0;
  let pendingNewsIndex = null;
  let app;
  const location = new URL('http://localhost/zh-Hans/music/songs');
  const window = {
    location, scrollTo() {}, requestAnimationFrame(callback) { callback(); },
    dispatchEvent() {}, setTimeout, clearTimeout,
    CHAR_INDEX: [{ id: 'mock', name: 'Mock' }], CHAR_DETAIL: {}, UmaCharacterUi: { init() {} },
    UmaPlayer: require('./player-controller'), UmaRoutes: require('./route-utils'),
    UmaUi: {}, UmaCreatorNetwork: {}
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

  location.href = 'http://localhost/zh-Hans/news?type=media&page=2';
  await app.applyCurrentRoute();
  assert.strictEqual(app.newsType.value, 'media');
  assert.strictEqual(app.newsPage.value, 2, 'restoring filters must not reset a restored page: ' + location.href + ' count=' + app.newsFiltered.value.length);
  const beforeRefresh = newsCalls;
  await app.refreshNews();
  assert.strictEqual(newsCalls, beforeRefresh + 1, 'refresh issues a new request');
  assert.strictEqual(app.newsPage.value, 2);
  const pendingNews = app.openNews(1);
  location.href = 'http://localhost/zh-Hans/music/albums?sort=name&page=2';
  await app.applyCurrentRoute();
  assert.strictEqual(app.relQuery.value, '');
  assert.strictEqual(app.relSort.value, 'name');
  assert.strictEqual(app.relPage.value, 2);
  newsDetail.resolve({ ok: true, json: async () => ({ detail: { announce_id: 1, title: 'Stale news', message: 'Stale body' } }) });
  await pendingNews;
  assert.strictEqual(app.newsDetail.value, null, 'late news cannot replace a different page');
  assert.strictEqual(app.dbView.value, 'albums');

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
  const selection = Object.assign(component.data(), { creator: { id: 'root' }, catalog: [] });
  const graphA = deferred(), graphB = deferred();
  graphContext.window.UmaApi = { request: (url) => url.includes('id=a') ? graphA.promise : graphB.promise, query: window.UmaApi.query };
  const firstSelection = component.methods.choose.call(selection, { creator_id: 'a' });
  const secondSelection = component.methods.choose.call(selection, { creator_id: 'b' });
  graphB.resolve({ creator: { id: 'b' } }); await secondSelection;
  graphA.resolve({ creator: { id: 'a' } }); await firstSelection;
  assert.strictEqual(selection.selectedDetail.id, 'b', 'graph selection ignores late responses');
  console.log('frontend regressions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
