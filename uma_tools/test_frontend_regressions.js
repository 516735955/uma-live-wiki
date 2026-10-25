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
    UmaCatalog: require('./catalog-model'),
    UmaUi: {}, UmaCreatorNetwork: {}, UmaAnimeLoader: require('./anime-loader'), UmaAnimeStaff: require('./anime-staff')
  };
  const history = {
    state: {}, pushes: [],
    pushState(state, unused, url) { this.pushes.push(url); this.replaceState(state, unused, url); },
    replaceState(state, unused, url) { this.state = state; location.href = new URL(url, location).href; }
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
      if (parsed.pathname === '/api/catalog/event') return store.event(parsed.searchParams.get('id'));
      if (parsed.pathname === '/api/catalog/albums') return store.albums(parsed.searchParams);
      if (parsed.pathname === '/api/catalog/creators') return store.creators(parsed.searchParams);
      if (parsed.pathname === '/api/catalog/creator') return store.creator(parsed.searchParams.get('id'));
      if (parsed.pathname === '/api/catalog/voice-actors') return store.voices();
      if (parsed.pathname === '/api/catalog/appearance') return store.appearance(parsed.searchParams.get('type'), parsed.searchParams.get('id'));
      if (parsed.pathname === '/api/catalog/anime') {
        const scope = parsed.searchParams.get('scope');
        if (scope === 'graph' && delayedGraph) return delayedGraph.promise;
        if (animeFailure === scope) throw new Error('HTTP 503');
        return animeStore.response(scope, parsed.searchParams.get('id'));
      }
      if (parsed.pathname === '/api/catalog/anime-media') return { songs: [], events: [] };
      if (parsed.pathname === '/api/catalog/song') {
        const id=parsed.searchParams.get('id');
        return details.has(id)?details.get(id).promise:store.song(id);
      }
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
  vm.runInContext(source('ui-components.js'), context);
  context.document = {
    body: { classList: { toggle() {} } }, getElementById() { return null; }, querySelector() { return null; },
    createElement() { return {}; },
    head: { appendChild(script) { pedigreeAttempts += 1; queueMicrotask(() => script.onerror()); } }
  };
  context.Vue.createApp = (options) => ({ component() {}, directive() {}, mount() { app = options.setup(); } });
  require('./test_frontend_loader').loadFrontend(context);
  const animeMusic = context.createAnimeMusic({...context.Vue,
    animeCurrentRelations:context.Vue.ref([]), animeContentUnit:context.Vue.ref(null),
    animeWorkUnits:context.Vue.ref([{id:'u',music_cues:[
      {title:'同名',usage_type:'op',song_id:'a'}, {title:'同名',usage_type:'op',song_id:'b'},
      {title:'其他曲目',usage_type:'new-kind'}]}])});
  assert.strictEqual(animeMusic.animeMusicCues.value.length,3,'same cue labels do not merge different song identities');
  assert.strictEqual(animeMusic.animeMusicCueGroups.value.find(group=>group.kind==='other').rows.length,1,'unknown standalone cues stay visible');
  const institutionStaff = context.createStaff({...context.Vue,
    animeCatalog:context.Vue.ref({people:[],staff:[
      {work_id:'w',unit_id:'u1',person_id:'p',roles:['作画'],institutions:['A','B']},
      {work_id:'w',unit_id:'u2',person_id:'p',roles:['作画'],institutions:['B','A']}]}),
    animeDetail:context.Vue.ref({id:'w'}),animeUnitDetail:context.Vue.ref(null),animeSingle:context.Vue.ref(false),
    findAnimeUnit:id=>({id,number:id==='u1'?1:2})});
  assert.deepStrictEqual(Array.from(institutionStaff.animeStaffAggregateGroups.value[0].rows[0].units,u=>u.id),['u1','u2'],'institution order never discards credited episodes');
  const optionalWait = deferred();
  let shownAlbum = false;
  const fastAlbum = context.createAlbums({...context.Vue,beginEntityNavigation:()=>()=>true,
    api:{query:()=>'',request:async()=>({album:{id:'fast',songs:[]}})},
    loadMusicPeople:()=>optionalWait.promise,loadAnimeCatalogOptional:()=>optionalWait.promise,
    clearEntityDetails(){},activeTab:context.Vue.ref(''),dbView:context.Vue.ref(''),resetPageScroll(){},
    pushUrl(){shownAlbum=true;},mergeSong(){},notFound:context.Vue.ref(false),navigationError:context.Vue.ref(''),navigationRetry:context.Vue.ref(null)});
  await fastAlbum.openAlbum({id:'fast'});
  assert(shownAlbum && fastAlbum.albumDetail.value,'stalled people and anime dependencies never block the album body');
  optionalWait.resolve(null);
  // The retry callback is written to the shared routing port.
  const errorPorts={...context.Vue,beginEntityNavigation:()=>()=>true,
    api:{query:()=>'',request:async()=>{throw Error('HTTP 503');}},loadMusicPeople:async()=>{},
    navigationError:context.Vue.ref(''),navigationRetry:context.Vue.ref(null)};
  await context.createAlbums(errorPorts).openAlbum({id:'retry'});
  assert.strictEqual(typeof errorPorts.navigationRetry.value,'function','a failed detail offers a real retry');
  const horseDomain = context.createHorses({...context.Vue});
  const horseSource = {races:[{date:'2015.09.21',track:'中山',race:'朝日杯セントライト記念',distance:'2200',winner:'Original',notes:'Keep'}],
    major:[{date:'2015.09.21',track:'中山',race:'セントライト記念',distance:'2200m',grade:'G2',beaten:'Secondary',notes:'Other'}]};
  horseDomain.horseDetail.value = horseSource;
  assert.strictEqual(horseDomain.horseMajorTotal.value,1,'two sources describe one race');
  assert.strictEqual(horseDomain.horseMajorRows.value[0].grade,'G2','same-race alias supplies the missing grade');
  assert.strictEqual(horseDomain.horseMajorRows.value[0].top,'Original','the existing result is preserved');
  assert.strictEqual(horseSource.races[0].grade,undefined,'display merging does not mutate source data');
  horseDomain.horseDetail.value = {...horseSource,major:[{...horseSource.major[0],track:'東京'}]};
  assert.strictEqual(horseDomain.horseMajorRows.value[0].grade,'','another track cannot supply a grade');
  const labelSource=context.createCreators({...context.Vue});
  assert.strictEqual(labelSource.creatorRoleLabel('lyricist',[{roles:[{role:'lyricist',label:'作词'}]}]),'作词','the collaborator panel uses labels from its loaded creator response');
  assert.strictEqual(labelSource.creatorWorkRoleLabels(['lyricist','composer']),'lyricist · composer','list indices are not passed as creator metadata');
  await app.applyCurrentRoute();
  window.CHAR_INDEX.push({id:'avatar-check',zh:'头像核对',img:'/uma_official/avatar-check.png',av:'/uma_avatars/AvatarCheck.png'});
  assert.strictEqual(app.characterImage('avatar-check'), '/uma_official/avatar-check.png', 'ordinary relations keep profile artwork');
  assert.strictEqual(app.characterPerformanceImage('avatar-check'), '/uma_avatars/AvatarCheck.png', 'performance records use the performance avatar');
  const avatarSongs = context.createSongs({...context.Vue,
    routes: window.UmaRoutes,
    normName:value=>value,decodeHtml:value=>value,
    findCharByAvatar:()=>null,findCharByDisplayName:()=>({id:'avatar-check',zh:'头像核对',main:'#123456'}),
    characterPerformanceImage:app.characterPerformanceImage});
  const legacyAvatar = avatarSongs.linkSetlistSongs('<span class="perf-item"><img src="/uma_official/avatar-check.png" alt="头像核对"><span class="perf-name">头像核对</span></span>', []);
  assert(legacyAvatar.includes('src="/uma_avatars/AvatarCheck.png"'), 'legacy setlists normalize to the same avatar as generated full-cast rows');
  assert(legacyAvatar.includes('href="/zh-Hans/database/characters/avatar-check"'), 'setlist roles expose normal character links');
  assert(legacyAvatar.includes('data-media-fallback='), 'injected role portraits use the shared media fallback');
  window.CHAR_INDEX.pop();
  assert.strictEqual(app.songDbCurrentPage.value.length, 30);
  assert(calls.every((url) => !url.includes('page_size=2000')), 'song archive uses real API pagination');
  const isolatedSongs = context.createSongs({...context.Vue, eventSongs: context.Vue.ref([])});
  isolatedSongs.mergeSong({id:'same-a',title:'奇跡',versions:[],detail_complete:true});
  isolatedSongs.mergeSong({id:'same-a',title:'奇跡',versions:[{id:'partial'}]});
  assert.strictEqual(isolatedSongs.findSong('same-a').versions.length, 0, 'an event summary cannot replace a complete song');
  isolatedSongs.mergeSong({id:'same-b',title:'奇跡',versions:[]});
  assert.strictEqual(isolatedSongs.findSong('奇跡'), null, 'ambiguous aliases never select the last registered song');
  isolatedSongs.mergeSong({id:'unseen',title:'約束',ambiguous_aliases:['約束'],versions:[]});
  assert.strictEqual(isolatedSongs.findSong('約束'), null, 'global ambiguity remains known even when only one matching song is cached');
  const recording = {versions:[{id:'live',releases:[]},{id:'studio',releases:[{audio_url:'studio.mp3'}]}]};
  assert.strictEqual(app.playableSongRelease(recording,'live'), null, 'missing live audio cannot silently select studio audio');
  assert.strictEqual(app.playableSongRelease(recording).version.id, 'studio');
  let detailRequests = 0;
  const isolatedCreators = context.createCreators({...context.Vue,
    findSong: () => ({id:'partial',versions:[{}]}), mergeSong() {},
    api:{query:()=>'',request:async()=>{detailRequests++;return {song:{id:'partial',detail_complete:true,versions:[]}};}}
  });
  await isolatedCreators.loadCreatorRecording({song_id:'partial'});
  assert.strictEqual(detailRequests, 1, 'recording expansion loads complete detail despite cached partial versions');
  const indexedSongs = context.Vue.reactive({one:{id:'one',versions:[{releases:[{album_id:'other',album_name:'同名',track_number:1}]}]}});
  const isolatedAlbums = context.createAlbums({...context.Vue,songsById:indexedSongs,songCatalog:context.Vue.ref({songs:[]})});
  isolatedAlbums.albumDetail.value={id:'wanted',name:'同名'};
  assert.strictEqual(isolatedAlbums.albumTrackSongId({name:'Song'},0), 'Song', 'a conflicting album ID cannot resolve the other album song identity');

  const vocalists = [{voice_actor_id:'other-a'}, {voice_actor_id:'current'}, {voice_actor_id:'other-b'}];
  assert.deepStrictEqual(Array.from(app.relationReleaseVocalists({vocalists}, 'voice_actor', 'current'), row => row.voice_actor_id),
    ['current', 'other-a', 'other-b'], 'person recordings keep the whole ensemble with the current person first');
  assert.deepStrictEqual(vocalists.map(row => row.voice_actor_id), ['other-a', 'current', 'other-b'], 'context sorting preserves canonical credits');
  const premiere = 'live-other-2024-05-06-title-7caa082310e6';
  location.href = 'http://localhost/zh-Hans/events/' + premiere;
  history.state = {};
  const initialPushes = history.pushes.length;
  await app.applyCurrentRoute();
  assert(location.pathname.includes('/sessions/'), 'a default event session has its canonical URL');
  assert.strictEqual(history.pushes.length, initialPushes, 'restoring a default session never inserts a new history entry');
  assert.strictEqual(app.showContextBack.value, false, 'direct events do not invent a context return');
  location.href = 'http://localhost/zh-Hans/database/anime/anime-movie-beginning-new-era';
  await app.openEvent(premiere);
  assert.strictEqual(history.pushes.length, initialPushes + 1, 'choosing an event creates one navigation entry');
  assert.strictEqual(app.showContextBack.value, true);
  location.href = 'http://localhost/zh-Hans/music/creators/creator-cygames-f5bc529953';
  history.state = {};
  const beforeRedirect = history.pushes.length;
  await app.applyCurrentRoute();
  assert(location.pathname.startsWith('/zh-Hans/music/songs/'), 'legacy organization credits resolve to their song');
  assert.strictEqual(history.pushes.length,beforeRedirect,'canonical organization redirects replace the route without trapping Back');
  assert.strictEqual(app.showContextBack.value,false);

  location.href = 'http://localhost/zh-Hans/music/songs?page=999';
  await app.applyCurrentRoute();
  assert.strictEqual(app.songDbPage.value, Math.ceil(app.songTotal.value / 30));
  assert(!location.search.includes('999'));
  location.href = 'http://localhost/zh-Hans/music/songs?q=' + encodeURIComponent('アタシたちは必ず掴む勝利');
  await app.applyCurrentRoute();
  assert(app.songDbCurrentPage.value.some((song) => song.title.includes('ウマRAP')), 'frontend keeps backend lyric search matches');

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
  assert.strictEqual(app.songLyricVersions.value.length, 2, 'recordings retain their own lyric, translation and timing selection even when wording matches');
  assert.strictEqual(app.selectedSongLyricLines.value[1].start_ms, undefined, 'a missing timing does not shift the next line');
  assert.strictEqual(app.selectedSongLyricLines.value[2].start_ms, 900);

  const sparse = deferred(); details.set('sparse', sparse);
  sparse.resolve({ song: { id: 'sparse', title: 'Sparse', original_version_id: 'sparse-original', versions: [
    { id: 'sparse-original', credits: [] },
    { id: 'sparse-variant', credits: [{ role: 'composer', name: 'Variant' }] }
  ] } });
  await app.openSong('sparse', 'credits');
  assert.strictEqual(app.songCreditVersions.value.length, 1, 'an empty original is omitted when a credited variant exists');
  assert.strictEqual(app.songCreditVersions.value[0].display_credits[0].name, 'Variant');

  const instrumental = deferred(); details.set('instrumental', instrumental);
  instrumental.resolve({ song: { id: 'instrumental', title: 'Instrumental', versions: [
    { id: 'instrumental-original', instrumental: true, lyrics: { lines: [] } }
  ] } });
  await app.openSong('instrumental', 'lyrics');
  assert.strictEqual(app.songLyricsApplicable.value, false, 'a lyrics route remains explainable for an explicitly instrumental recording');
  assert.strictEqual(app.songSection.value, 'lyrics');

  location.href = 'http://localhost/zh-Hans/news?type=media&page=2';
  await app.applyCurrentRoute();
  assert.strictEqual(app.newsType.value, 'media');
  assert.strictEqual(app.newsPage.value, 2, 'restoring filters must not reset a restored page: ' + location.href + ' count=' + app.newsFiltered.value.length);
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
  assert.strictEqual(app.newsDetail.value.announce_id, 999999, 'failed articles retain their target for retry');
  assert(app.newsError.value.includes('不存在'), 'a missing article has an explicit error');
  assert.strictEqual(location.pathname, '/zh-Hans/news/999999', 'failed articles preserve their permalink for retry');
  assert(app.newsError.value, 'failed article retains its explanatory notice');

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
  assert.deepStrictEqual(Array.from(app.animeFiltered.value, work => work.id).sort(), ['anime-movie-beginning-new-era', 'anime-rttt'], 'movie filtering includes confirmed theatrical editions and ignores retired year filters');
  const movieRttt = app.animeFiltered.value.find(work=>work.id==='anime-rttt');
  assert(app.animeWorkHref(movieRttt).includes('edition=film'));
  assert(app.animeWorkYears(movieRttt).includes('2024'),'theatrical filtering uses its release year');
  assert(app.animeWatchAccess({access:'membership',regions:['JP']}).includes('需会员'));
  assert(app.animeWatchAccess({status:'region_limited',regions:['TW','HK','MO']}).includes('台湾、香港、澳门'));
  location.href = 'http://localhost/zh-Hans/database/anime?format=web&year=2024';
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeFiltered.value.length, 1, 'network format remains available without a year filter');
  assert(app.animeWorkHref(app.animeFiltered.value[0]).includes('edition=web'), 'the primary network entry opens its network edition');
  location.href = 'http://localhost/zh-Hans/database/anime?format=web_short';
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeFormat.value, 'short');
  assert.strictEqual(app.animeFiltered.value.length, 4, 'all television and network shorts share one filter');
  app.clearAnimeFilters();
  app.animeQuery.value = '走向我们的舞台';
  const actualUnit = (await animeStore.response('work', 'anime-s3')).units.find(unit => unit.number === 12);
  app.animeQuery.value = actualUnit.title_ja;
  assert(app.animeWorkHref(app.animeFiltered.value.find(work => work.id === 'anime-s3')).includes(actualUnit.id), 'a unique episode title opens that episode');

  animeFailure = 'unit';
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
  const roleOrder = app.animeStaffGroups.value.map(row => row.role).join('|');
  location.href = 'http://localhost' + app.animeUnitHref(app.animeAdjacentUnits.value.next);
  await app.applyCurrentRoute();
  assert.strictEqual(app.animeSection.value, 'staff');
  assert.strictEqual(app.animeStaffQuery.value, '原画');
  location.href = 'http://localhost/zh-Hans/database/anime/anime-s3/episodes/anime-s3-e11?section=staff&staff=' + encodeURIComponent('原画');
  await app.applyCurrentRoute();
  assert(app.animeStaffGroups.value.some(row => row.key === group.key), 'same episode restores the same role: ' + group.key + ' / ' + app.animeStaffGroups.value.map(row => row.key).join(',') + ' query=' + app.animeStaffQuery.value + ' URL=' + location.href + ' detail=' + (app.animeDetail.value || {}).id + ' unit=' + (app.animeUnitDetail.value || {}).id + ' error=' + app.routeError.value + ' rows=' + app.animeCatalog.value.staff.length);
  assert.strictEqual(app.animeStaffGroups.value.map(row => row.role).join('|'), roleOrder, 'returning preserves the shared job order');
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
  const musicRows = [
    {version:'v1', release:'r1', episode:1},
    {version:'v1', release:'r2', episode:1},
    {version:'v2', release:'r3', episode:2},
  ].map(row => ({work:{id:'work',format:'tv'},unit:{id:'episode-'+row.episode,number:row.episode},relation:{target_type:'song',target_id:'song',version_id:row.version,release_id:row.release,usage_type:'ending'}}));
  const participation = context.createAnimeParticipation({...context.Vue,
    animeMusicUsageLabel: () => '片尾曲', animeRelationTargetLabel: () => '歌曲'});
  const recordingRoles = participation.groupAnimeParticipation(musicRows)[0].roles;
  assert.strictEqual(recordingRoles.length,2,'different recordings keep distinct episode scopes; reissues do not duplicate usages');
  assert.deepStrictEqual(Array.from(recordingRoles[0].units, unit => unit.number),[1]);
  assert.deepStrictEqual(Array.from(recordingRoles[1].units, unit => unit.number),[2]);
  assert.strictEqual(recordingRoles[1].scopes[0].version_id,'v2','episode links retain the recording identity');
  animeFailure = 'person';
  location.href = 'http://localhost/zh-Hans/database/staff/staff-UMP';
  await app.applyCurrentRoute();
  animeFailure = '';
  await app.retryAnime();
  assert.strictEqual(app.staffDetail.value.id, 'staff-ump', 'legacy person links survive detail failure and retry');

  const graphCalls = calls.filter(url => url.includes('scope=graph')).length;
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
  assert.strictEqual(calls.filter(url => url.includes('scope=graph')).length, graphCalls, 'ordinary voice and anime lists never load the full relation graph');
  console.log('frontend regressions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
