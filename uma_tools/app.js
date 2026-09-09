
const ALBUMS = [];
let ALBUMS_LOADED = false;
const SERIES_GRID = [{"index":0,"no":"1st","title":"1st EVENT","meta":"1 场公演 · 1 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/471238a99eba4fc09b643fd77362e450/event_01.png"},{"index":1,"no":"2nd","title":"2nd EVENT","meta":"1 场公演 · 1 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/00cea361d13343d085477a7bdcae48fa/event_02.png"},{"index":2,"no":"3rd","title":"3rd EVENT","meta":"1 场公演 · 2 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/df69154e90b44827a691cc454f9c5279/event_03.png"},{"index":3,"no":"4th","title":"4th EVENT","meta":"2 场公演 · 4 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/aba8419984df479d94896b3ba20c23fa/event_05.png"},{"index":4,"no":"4thExtra","title":"4th EVENT EXTRA STAGE","meta":"1 场公演 · 2 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/e0aaca1a08bd49fa889fa22f6a402311/event_04.png"},{"index":5,"no":"5th","title":"5th EVENT","meta":"4 场公演 · 8 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/8c98ef15165742ae8492fec00157a8c5/event_06.png"},{"index":6,"no":"6th","title":"6th EVENT","meta":"2 场公演 · 4 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/8e25390d779041fbb1b9485a043cd235/event_tnf.png"},{"index":7,"no":"7th","title":"7th EVENT","meta":"5 场公演 · 10 个歌单","cover":"https://images.microcms-assets.io/assets/973fc097984b400db8729642ddff5938/e33a4cddf22d4bf69e5d3fa0edc9a52a/event_ts.png"}];

const { createApp, ref, reactive, computed, watch } = Vue;

createApp({
  setup() {
    function routeSegments() {
      const seg = window.location.pathname.split('/').filter(Boolean);
      if (seg.length && seg[0].toLowerCase() === 'zh-hans') seg.shift();
      return seg;
    }
    const initialSegments = routeSegments();
    const initialFirst = (initialSegments[0] || '').toLowerCase();
    const initialTab = initialFirst === 'characters' || initialFirst === 'events' ? 'database' :
      (initialFirst === 'music' || initialFirst === 'artist' || !initialFirst ? 'songs' : initialFirst);
    const audio = ref(null);
    const albums = ref([]);
    const albumsError = ref('');
    const activeTab = ref(initialTab);
    const home = ref(initialSegments.length === 0);
    function syncBodyBackground(isHome) {
      document.body.classList.toggle('subpage-bg', !isHome);
    }
    syncBodyBackground(home.value);
    watch(home, syncBodyBackground);
    const albumDetail = ref(null);
    const artistDetail = ref(null);
    const search = ref('');
    const newsItems = ref([]);
    const newsError = ref('');
    const newsLoading = ref(false);
    const newsRange = ref('all');
    const newsType = ref('all');
    const newsDetail = ref(null);
    const newsDetailBody = ref('');
    const newsPrevId = ref(0);
    const newsNextId = ref(0);
    const newsPage = ref(1);
    const newsPerPage = 20;
    const newsDefaultCover = '/news-card-default.webp';
    const filterWork = ref('');
    const filterType = ref('');
    const showFilters = ref(false);
    const sortMode = ref('');
    const backTopVisible = ref(false);
    const view = ref('list');
    const liveView = ref('liveCats');
    const liveSeriesIndex = ref(-1);
    const livePerf = ref(-1);
    const liveDay = ref(0);
    const catNote = ref('');
    const liveCatType = ref('cd');
    const liveCatIndex = ref(-1);
    const liveCatSectionIndex = ref(-1);
    const liveData = ref([]);
    const liveDataError = ref('');
    const liveCatData = ref(null);
    const liveCatDataError = ref('');
    const liveCatDataOrig = ref(null);
    const dataScriptPromises = {};
    let newsLoadPromise = null;
    let albumsLoadPromise = null;
    let liveDataLoadPromise = null;
    let liveCatLoadPromise = null;
    let eventsLoadPromise = null;
    let homeSummaryLoadPromise = null;
    const savedScrollY = ref(0);
    const albumReturnView = ref('songs');
    const liveReturnSource = ref('live');
    const eventsSavedScrollY = ref(0);
    const charSavedScrollY = ref(0);
    const vaSavedScrollY = ref(0);
    const eventsAll = ref([]);
    const homeStats = reactive({ songs: null, albums: null, live: null, performances: null, characters: null, voiceActors: null, events: null });
    const homeNextEvent = ref(null);
    const eventsMeta = ref('');
    const eventsError = ref('');
    const eventsLoading = ref(false);
    const eventsQuery = ref('');
    const evTime = ref('all');
    const eventsPage = ref(1);
    const eventsPerPage = 20;
    const evDataView = ref(false);
    const evDataTab = ref('actor');
    const evDataLoading = ref(false);
    const evDataError = ref('');
    const vaFilters = ref([]);
    const songFilter = ref('all');
    const rankSort = ref('count');
    const vaPage = ref(1);
    const songPage = ref(1);
    const evRankPage = 30;
    const voiceEvData = ref([]);
    const songEvData = ref([]);
    function pagerList(cur, total) {
      var out = [];
      if (total <= 7) { for (var i = 1; i <= total; i++) out.push(i); return out; }
      out.push(1);
      var s = Math.max(2, cur - 1), e = Math.min(total - 1, cur + 1);
      if (s > 2) out.push('…');
      for (var i = s; i <= e; i++) out.push(i);
      if (e < total - 1) out.push('…');
      out.push(total);
      return out;
    }
    function countVoice() {
      var map = {};
      var sel = vaFilters.value;
      var useAll = sel.length === 0;
      voiceEvData.value.forEach(function (ev) {
        if (!useAll && sel.indexOf(ev.cat) === -1) return;
        ev.actors.forEach(function (n) { map[n] = (map[n] || 0) + 1; });
      });
      var arr = Object.keys(map).map(function (n) { return { name: n, count: map[n] }; });
      if (rankSort.value === 'name') {
        arr.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
      } else {
        arr.sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
      }
      return arr;
    }
    function countSong(filter) {
      var map = {};
      songEvData.value.forEach(function (ev) {
        if (filter !== 'all' && ev.cat !== filter) return;
        ev.songs.forEach(function (n) { map[n] = (map[n] || 0) + 1; });
      });
      var arr = Object.keys(map).map(function (n) { return { name: n, count: map[n] }; });
      if (rankSort.value === 'name') {
        arr.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
      } else {
        arr.sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
      }
      return arr;
    }
    function getEventSetlists(liveUrl) {
      if (!liveUrl || liveCatData.value == null) return [];
      var parts = String(liveUrl).split('/').filter(Boolean);
      if (parts[0] && parts[0].toLowerCase() === 'zh-hans') parts = parts.slice(1);
      if (parts[0] !== 'live') return [];
      var typ = parts[1];
      var hasSI = parts.length >= 4;
      var si = hasSI ? parseInt(parts[2], 10) : 0;
      var gi = hasSI ? parseInt(parts[3], 10) : parseInt(parts[2], 10);
      if (isNaN(gi)) return [];
      var node = liveCatData.value[typ];
      if (!node) return [];
      var groups = null;
      if (node.sections) {
        var sec = node.sections[si];
        if (!sec || !sec.groups) return [];
        groups = sec.groups;
      } else if (node.groups) {
        groups = node.groups;
      } else { return []; }
      var grp = groups[gi];
      if (!grp) return [];
      var tables = [];
      (function walk(o) {
        if (o == null || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        for (var k in o) { if (k === 'table' && typeof o[k] === 'string') tables.push(o[k]); else walk(o[k]); }
      })(grp);
      return tables;
    }
    const actorRankList = computed(function () { return countVoice(); });
    const songRankList = computed(function () { return countSong(songFilter.value); });
    const actorPageCount = computed(function () { return Math.max(1, Math.ceil(actorRankList.value.length / evRankPage)); });
    const songPageCount = computed(function () { return Math.max(1, Math.ceil(songRankList.value.length / evRankPage)); });
    const actorPageRows = computed(function () { var s = (vaPage.value - 1) * evRankPage; return actorRankList.value.slice(s, s + evRankPage); });
    const songPageRows = computed(function () { var s = (songPage.value - 1) * evRankPage; return songRankList.value.slice(s, s + evRankPage); });
    const actorPageStart = computed(function () { return actorRankList.value.length ? (vaPage.value - 1) * evRankPage + 1 : 0; });
    const actorPageEnd = computed(function () { return Math.min(vaPage.value * evRankPage, actorRankList.value.length); });
    const songPageStart = computed(function () { return songRankList.value.length ? (songPage.value - 1) * evRankPage + 1 : 0; });
    const songPageEnd = computed(function () { return Math.min(songPage.value * evRankPage, songRankList.value.length); });
    const actorPageList = computed(function () { return pagerList(vaPage.value, actorPageCount.value); });
    const songPageList = computed(function () { return pagerList(songPage.value, songPageCount.value); });
    function setVaFilter(f) {
      if (f === 'all') { vaFilters.value = []; }
      else {
        const i = vaFilters.value.indexOf(f);
        if (i >= 0) vaFilters.value.splice(i, 1);
        else vaFilters.value.push(f);
      }
      vaPage.value = 1;
    }
    function isVaFilter(f) { return f === 'all' ? vaFilters.value.length === 0 : vaFilters.value.indexOf(f) !== -1; }
    function setSongFilter(f) { songFilter.value = f; songPage.value = 1; }
    function setVaPage(p) { if (p >= 1 && p <= actorPageCount.value) vaPage.value = p; }
    function goVaPage(d) { setVaPage(vaPage.value + d); }
    function setSongPage(p) { if (p >= 1 && p <= songPageCount.value) songPage.value = p; }
    function goSongPage(d) { setSongPage(songPage.value + d); }
    watch(rankSort, function () { vaPage.value = 1; songPage.value = 1; });
    const charSub = ref('intro');
    const charDetail = ref(null);
    const dbView = ref('index');
    const voiceDetail = ref(null);
    const charDetailSource = ref('');
    const charHasIntro = computed(function () {
      var id = charDetail.value && charDetail.value.id;
      return !!(window.CHAR_DETAIL && id && window.CHAR_DETAIL[id] && window.CHAR_DETAIL[id].html);
    });
    const savedVoiceDetail = ref(null);
    const relFilter = ref('');
    const relYear = ref('');
    const relPage = ref(1);

    function loadDataScript(src, globalName) {
      if (globalName && window[globalName]) return Promise.resolve();
      if (dataScriptPromises[src]) return dataScriptPromises[src];
      dataScriptPromises[src] = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = function () {
          delete dataScriptPromises[src];
          reject(new Error('failed to load ' + src));
        };
        document.head.appendChild(script);
      });
      return dataScriptPromises[src];
    }
    function loadCharacterIndexData() {
      return loadDataScript('/character_index_data.js?v=20260904', 'CHAR_INDEX');
    }
    function loadCharacterDetailData() {
      return Promise.all([
        loadCharacterIndexData(),
        loadDataScript('/character_detail_data.js?v=20260904', 'CHAR_DETAIL'),
        loadDataScript('/pedigree_data.js?v=20260830', 'PED_REL')
      ]);
    }
    function loadVoiceData() {
      return Promise.all([
        loadCharacterIndexData(),
        loadDataScript('/va_photos_data.js?v=20260830', 'VA_PHOTOS'),
        loadDataScript('/voice_list_data.js?v=20260830', 'VA_LIST')
      ]);
    }
    function loadLivePathData(path) {
      const value = String(path || '');
      if (value.indexOf('number_series_event') !== -1) return loadLiveData();
      if (value.indexOf('/live/nonlive') !== -1) return loadEvents();
      return loadLiveCatData();
    }
    function ensureTabData(tab) {
      if (tab === 'news') return loadNews();
      if (tab === 'songs') return loadAlbums();
      if (tab === 'database') return loadHomeSummary();
      return Promise.resolve();
    }
    function prepareCurrentRoute() {
      const seg = routeSegments();
      if (!seg.length) return Promise.resolve();
      const first = (seg[0] || '').toLowerCase();
      if (first === 'news') return loadNews();
      if (first === 'music' || first === 'artist' || first === 'songs') return loadAlbums();
      if (first === 'live') {
        const sub = (seg[1] || '').toLowerCase();
        if (!sub) return Promise.resolve();
        if (sub === 'number_series_event') return loadLiveData();
        if (sub === 'nonlive') return loadEvents();
        return loadLiveCatData();
      }
      if (first === 'characters') {
        const sub = (seg[1] || '').toLowerCase();
        const characterReady = sub && sub !== 'intro' && sub !== 'room' && sub !== 'videos' && sub !== 'blood'
          ? loadCharacterDetailData() : loadCharacterIndexData();
        return Promise.all([characterReady, loadHomeSummary()]);
      }
      if (first === 'events') return loadEvents();
      if (first !== 'database') return Promise.resolve();
      const sub = (seg[1] || '').toLowerCase();
      if (!sub) return loadHomeSummary();
      if (sub === 'albums' || sub === 'songs') return loadAlbums();
      if (sub === 'events') return loadEvents();
      if (sub === 'voice' || sub === 'voice-actors') return Promise.all([loadVoiceData(), loadHomeSummary()]);
      if (sub === 'characters') {
        const charPath = (seg[2] || '').toLowerCase();
        const characterReady = charPath && charPath !== 'intro' && charPath !== 'room' && charPath !== 'videos' && charPath !== 'blood'
          ? loadCharacterDetailData() : loadCharacterIndexData();
        return Promise.all([characterReady, loadHomeSummary()]);
      }
      return Promise.resolve();
    }
    function loadHomeSummary() {
      if (homeSummaryLoadPromise) return homeSummaryLoadPromise;
      homeSummaryLoadPromise = fetch('/api/home-summary', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          const stats = (data && data.stats) || {};
          homeStats.songs = Number.isFinite(stats.songs) ? stats.songs : null;
          homeStats.albums = Number.isFinite(stats.albums) ? stats.albums : null;
          homeStats.live = Number.isFinite(stats.live) ? stats.live : null;
          homeStats.performances = Number.isFinite(stats.performances) ? stats.performances : null;
          homeStats.characters = Number.isFinite(stats.characters) ? stats.characters : null;
          homeStats.voiceActors = Number.isFinite(stats.voiceActors) ? stats.voiceActors : null;
          homeStats.events = Number.isFinite(stats.events) ? stats.events : null;
          homeNextEvent.value = (data && data.nextEvent) || null;
        })
        .catch(function () {
          return Promise.all([loadAlbums(), loadLiveData(), loadLiveCatData(), loadEvents(), loadCharacterIndexData(), loadVoiceData()]);
        });
      return homeSummaryLoadPromise;
    }
    function loadHomeSummaryIfNeeded() {
      if (home.value) loadHomeSummary();
    }

    const player = reactive({
      shown: false, url: null, playing: false,
      cover: '', name: '', artist: '',
      currentTime: 0, duration: 0,
      queue: [], queueIndex: -1
    });

    const showQueue = ref(false);

    const tabs = [
      { key: 'news', label: '新闻', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0V9"/><polyline points="12 2 12 22"/><path d="M3 5h6"/><path d="M3 9h6"/><path d="M3 13h6"/><path d="M12 7h9"/><path d="M12 11h9"/><path d="M12 15h9"/></svg>' },
      { key: 'songs', label: '歌曲', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' },
      { key: 'live', label: 'Live演出', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' },
      { key: 'database', label: '资料库', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>' },
      { key: 'links', label: '友链', svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' }
    ];

    // 资料订正表单状态
    const fix = reactive({ page: '', kind: '', title: '', body: '', src: '', contact: '', agree: false });
    const fixDone = ref(false);
    const fixSendState = ref('');
    function submitFix() {
      if (!fix.page || !fix.body || !fix.agree) return;
      const k = { k1: '资料错误', k2: '缺少资料', k3: '翻译问题', k4: '图片问题', k5: '链接问题', k6: '其他' };
      const kindText = k[fix.kind] || '其他';
      const body =
        '【资料订正报告】\n\n' +
        '页面 URL：' + fix.page + '\n' +
        '问题类型：' + kindText + '\n' +
        '条目类型：' + (fix.title || '未选择') + '\n' +
        '正确内容应为：' + fix.body + '\n' +
        '来源 / 依据 URL：' + (fix.src || '（无）') + '\n' +
        '联系方式：' + (fix.contact || '（无）');
      const subject = '【资料订正】' + (fix.title || '未分类') + ' - ' + kindText;
      // 真实发送：POST 到 FormSubmit（第三方转发到 516735955@qq.com）
      fetch('https://formsubmit.co/ajax/516735955@qq.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: subject,
          _template: 'table',
          _captcha: 'false',
          '页面 URL': fix.page,
          '问题类型': kindText,
          '条目类型': fix.title || '未选择',
          '正确内容应为': fix.body,
          '来源 / 依据 URL': fix.src || '（无）',
          '联系方式': fix.contact || '（无）'
        })
      }).then(function (r) {
        fixDone.value = true;
        fixSendState.value = 'ok';
      }).catch(function () {
        // 发送失败则降级为 mailto 草稿
        fixDone.value = true;
        fixSendState.value = 'mailto';
        window.location.href = 'mailto:516735955@qq.com?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
      });
    }
    function goContributeFix() {
      home.value = false;
      activeTab.value = 'contribute';
      albumDetail.value = null;
      artistDetail.value = null;
      newsDetail.value = null;
      liveSeriesIndex.value = -1; livePerf.value = 0; liveDay.value = 0; liveView.value = 'liveCats';
      dbView.value = 'index';
      charDetail.value = null; voiceDetail.value = null; charSub.value = 'intro';
      window.scrollTo(0, 0);
      pushUrl();
    }
    function goContributeContact() {
      home.value = false;
      activeTab.value = 'contribute-contact';
      albumDetail.value = null;
      artistDetail.value = null;
      newsDetail.value = null;
      liveSeriesIndex.value = -1; livePerf.value = 0; liveDay.value = 0; liveView.value = 'liveCats';
      dbView.value = 'index';
      charDetail.value = null; voiceDetail.value = null; charSub.value = 'intro';
      window.scrollTo(0, 0);
      pushUrl();
    }
    function goLegal(page) {
      home.value = false;
      activeTab.value = page === 'privacy' ? 'legal-privacy' : 'legal-terms';
      albumDetail.value = null;
      artistDetail.value = null;
      newsDetail.value = null;
      liveSeriesIndex.value = -1; livePerf.value = 0; liveDay.value = 0; liveView.value = 'liveCats';
      dbView.value = 'index';
      charDetail.value = null; voiceDetail.value = null; charSub.value = 'intro';
      window.scrollTo(0, 0);
      pushUrl();
    }

    function isTabActive(k) {
      return activeTab.value === k;
    }
    function goCharSub(sub) {
      charDetailSource.value = '';
      charSub.value = sub;
      window.scrollTo(0, 0);
      pushUrl();
    }
    function charBack() {
      if (charDetailSource.value === 'voice') {
        charDetail.value = null;
        dbView.value = 'voice';
        voiceDetail.value = savedVoiceDetail.value;
        savedVoiceDetail.value = null;
        charDetailSource.value = '';
        window.scrollTo(0, 0);
        pushUrl();
      } else {
        goCharSub('intro');
      }
    }
    function switchTab(k) {
      albumDetail.value = null;
      artistDetail.value = null;
      activeTab.value = k;
      liveSeriesIndex.value = -1;
      livePerf.value = 0;
      liveDay.value = 0;
      liveView.value = 'liveCats';
      if (k !== 'database') dbView.value = 'index';
      charSub.value = 'intro';
      charDetail.value = null;
      voiceDetail.value = null;
      ensureTabData(k);
      pushUrl();
    }
    function enterTab(k) {
      albumDetail.value = null;
      artistDetail.value = null;
      home.value = false;
      activeTab.value = k;
      liveSeriesIndex.value = -1;
      livePerf.value = 0;
      liveDay.value = 0;
      liveView.value = 'liveCats';
      if (k !== 'database') dbView.value = 'index';
      if (k !== 'database') charSub.value = 'intro';
      if (k !== 'database') charDetail.value = null;
      voiceDetail.value = null;
      ensureTabData(k);
      window.scrollTo(0, 0);
      pushUrl();
    }
    function goCharSub(sub) {
      if (sub !== 'intro' && sub !== 'room' && sub !== 'videos' && sub !== 'blood') sub = 'intro';
      const fromDetail = !!charDetail.value;
      charSub.value = sub;
      charDetail.value = null;
      pushUrl();
      if (fromDetail && sub === 'intro' && charSavedScrollY.value > 0) {
        var sy = charSavedScrollY.value;
        Vue.nextTick(function () {
          var max = document.documentElement.scrollHeight - window.innerHeight;
          var target = Math.min(sy, Math.max(0, max));
          var saved = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, target);
          document.documentElement.style.scrollBehavior = saved;
        });
      } else {
        window.scrollTo(0, 0);
      }
    }
    function openCharDetail(id) {
      const show = function () {
        const found = findCharById(id);
        if (!found) return;
        if (!charDetail.value) charSavedScrollY.value = window.scrollY || 0;
        charDetail.value = found;
        window.scrollTo(0, 0);
        pushUrl();
        Vue.nextTick(renderCharBlood);
      };
      return loadCharacterDetailData().then(show, show);
    }
    function renderCharBlood() {
      var box = document.getElementById('cCharBlood');
      if (!box) return;
      box.innerHTML = '';
      var id = charDetail.value && charDetail.value.id;
      if (!id) return;
      if (typeof renderBloodGraphInDetail === 'function') renderBloodGraphInDetail(box, id);
    }
    Vue.watch(charDetail, function () {
      if (typeof renderDetail === 'function') Vue.nextTick(function () { renderDetail(null); });
      Vue.nextTick(renderCharBlood);
    });
    function goHome() {
      home.value = true;
      albumDetail.value = null;
      artistDetail.value = null;
      activeTab.value = 'songs';
      window.scrollTo(0, 0);
      loadHomeSummaryIfNeeded();
      pushUrl();
    }
    function goDbView(v) {
      let ready = Promise.resolve();
      if (v === 'index') ready = loadHomeSummary();
      else if (v === 'characters') ready = loadCharacterIndexData();
      else if (v === 'voice') ready = loadVoiceData();
      else if (v === 'albums' || v === 'songs') ready = loadAlbums();
      else if (v === 'events') ready = loadEvents();
      const activate = function () {
        evDataView.value = false;
        if (v !== 'voice') voiceDetail.value = null;
        if (v === 'songs') { window.__songsPage = 1; var _st = document.getElementById('tab-db-songs'); if (_st) _st._rendered = false; }
        dbView.value = v;
        window.scrollTo(0, 0);
        pushUrl();
      };
      if (v === 'characters' || v === 'voice') return ready.then(activate, activate);
      activate();
      return ready;
    }
    function vaSlugOf(name) {
      return encodeURIComponent(String(name || ''));
    }
    window.vaLink = function (name) {
      var n = String(name || '');
      if (!n) return n;
      var ph = (window.VA_PHOTOS && window.VA_PHOTOS[n]) || null;
      var page = ph ? ph.page : '';
      if (page) return '<a href="' + page + '" target="_blank" rel="noopener">' + n + '</a>';
      return n;
    };
    function vaList() {
      var src = (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : [];
      var map = new Map();
      var charByZh = {};
      src.forEach(function (c) { if (c.zh) charByZh[c.zh] = c.id; });
      src.forEach(function (c) {
        var key = c.cv_zh || c.cv;
        if (!key) return;
        if (!map.has(key)) {
          var ph = (window.VA_PHOTOS && window.VA_PHOTOS[key]) || null;
          map.set(key, { slug: vaSlugOf(key), zh: c.cv_zh || '', ja: c.cv || key, roles: [], photo: ph ? ph.img : '', credit: ph || null, birth: ph ? (ph.birth || '') : '' });
        }
        map.get(key).roles.push({ id: c.id, zh: c.role_zh || c.zh, ja: c.ja || '', en: c.en || '', img: c.img || '', main: c.main || '', sub: c.sub || '' });
        if (c.cv_former) {
          var fk = c.cv_former;
          if (!map.has(fk)) {
            var fph = (window.VA_PHOTOS && window.VA_PHOTOS[fk]) || null;
            map.set(fk, { slug: vaSlugOf(fk), zh: c.cv_former, ja: c.cv_former_ja || fk, roles: [], photo: fph ? fph.img : '', credit: fph || null, birth: fph ? (fph.birth || '') : '' });
          }
          map.get(fk).roles.push({ id: c.id, zh: c.zh, orig: true, ja: c.ja || '', en: c.en || '', img: c.img || '', main: c.main || '', sub: c.sub || '' });
        }
      });
      // 合并 voice_list.xlsx 中未收录于 CHAR_INDEX 的声优（如训练员 / 解说等）
      var extra = window.VA_LIST || [];
      extra.forEach(function (v) {
        var zh = (v.zh || '').trim(), ja = (v.ja || '').trim();
        if (!zh && !ja) return;
        if (map.has(zh) || (ja && map.has(ja))) return;
        var ph = (window.VA_PHOTOS && (window.VA_PHOTOS[zh] || (ja && window.VA_PHOTOS[ja]))) || null;
        var roles = [];
        if (v.role && v.role.trim()) roles.push({ zh: v.role.trim(), id: charByZh[v.role.trim()] || '', img: '', main: '', sub: '' });
        map.set(zh || ja, { slug: vaSlugOf(zh || ja), zh: zh || ja, ja: ja || zh, roles: roles, photo: ph ? ph.img : '', credit: ph || null, birth: ph ? (ph.birth || '') : '' });
      });
      return Array.from(map.values());
    }
    function findVaBySlug(slug) {
      var target = String(slug || '');
      if (!target) return null;
      var list = vaList();
      for (var i = 0; i < list.length; i++) { if (list[i].slug === target) return list[i]; }
      try {
        var dec = decodeURIComponent(target);
        for (var j = 0; j < list.length; j++) { if (list[j].slug === vaSlugOf(dec)) return list[j]; }
        for (var k = 0; k < list.length; k++) { if (list[k].zh === dec || list[k].ja === dec) return list[k]; }
      } catch (e) {}
      return null;
    }
    function openVa(slug) {
      const found = findVaBySlug(slug);
      if (!found) return;
      if (!voiceDetail.value) vaSavedScrollY.value = window.scrollY || 0;
      voiceDetail.value = found;
      window.scrollTo(0, 0);
      pushUrl();
    }
    function voiceBack() {
      voiceDetail.value = null;
      pushUrl();
      var sy = vaSavedScrollY.value;
      vaSavedScrollY.value = 0;
      if (sy > 0) {
        Vue.nextTick(function () {
          var max = document.documentElement.scrollHeight - window.innerHeight;
          var target = Math.min(sy, Math.max(0, max));
          var saved = document.documentElement.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = 'auto';
          window.scrollTo(0, target);
          document.documentElement.style.scrollBehavior = saved;
        });
      } else {
        window.scrollTo(0, 0);
      }
    }
    function openCharFromVoice(id) {
      const show = function () {
        const found = findCharById(id);
        if (!found) return;
        charDetailSource.value = 'voice';
        savedVoiceDetail.value = voiceDetail.value;
        dbView.value = 'characters';
        charSub.value = 'intro';
        voiceDetail.value = null;
        charDetail.value = found;
        window.scrollTo(0, 0);
        pushUrl();
      };
      return loadCharacterDetailData().then(show, show);
    }
    function albumName(a) { return a.name; }
    function clearSearch() {
      search.value = '';
      artistDetail.value = null;
    }
    function onScroll() {
      backTopVisible.value = (window.scrollY || 0) > 480;
    }
    function backToTop() {
      var saved = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
      document.documentElement.style.scrollBehavior = saved;
    }

    // ---- client-side routing (history mode) ----
    function findCharById(id) {
      if (!id) return null;
      var arr = (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : (window.UMA_INTRO || []);
      var norm = String(id).toLowerCase();
      for (var i = 0; i < arr.length; i++) {
        if (String(arr[i].id || '').toLowerCase() === norm) {
          var c = arr[i];
          return {
            id: c.id, zh: c.zh, ja: c.ja || c.name, en: c.en || c.name,
            img: c.img || c.av || '', cv: c.cv || '', cv_zh: c.cv_zh || c.cv || '',
            main: c.main || '#8c83ff', sub: c.sub || '#ece9ff',
            readMore: c.page ? c.page.replace('zh.moegirl.org.cn', 'mobile.moegirl.org.cn') : 'https://mobile.moegirl.org.cn/' + encodeURIComponent('赛马娘_Pretty_Derby/登场人物'),
            birth: c.birth || '', height: c.height || '', weight: c.weight || '', sankak: c.sankak || ''
          };
        }
      }
      return null;
    }
    function slugOfAlbum(name) {
      const latin = String(name || '')
        .replace(/[‘’`'"「」『』\[\]（）()]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(function (s) {
          var m = s.match(/[A-Za-z0-9]+/g);
          return m ? m.join('') : '';
        })
        .filter(Boolean)
        .join('_')
        .toUpperCase();
      if (latin) return latin;
      return String(name || '')
        .replace(/[‘’`'"「」『』\[\]（）()]/g, ' ')
        .replace(/[\/\\&+=?#%<>]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_');
    }
    function findAlbumBySlug(slug) {
      const target = String(slug || '');
      if (!target) return null;
      const direct = albums.value.find(function (a) { return slugOfAlbum(a.name) === target; });
      if (direct) return direct;
      let decoded = '';
      try { decoded = decodeURIComponent(target); } catch (e) {}
      if (decoded && decoded !== target) {
        const d2 = albums.value.find(function (a) { return slugOfAlbum(a.name) === decoded; });
        if (d2) return d2;
      }
      return albums.value.find(function (a) { return a.name === decoded || a.name === target; }) || null;
    }
    function seriesNoToIndex(no) {
      const t = String(no || '').toLowerCase().replace(/_event$/, '');
      for (let i = 0; i < SERIES_GRID.length; i++) {
        if (SERIES_GRID[i].no.toLowerCase() === t) return i;
      }
      return -1;
    }
    const LANG_PREFIX = '/zh-Hans';
    function currentUrlPath() {
      return window.location.pathname + window.location.search;
    }
    function pushUrl() {
      let path = '/';
      if (!home.value) {
        if (activeTab.value === 'songs') {
          if (artistDetail.value) {
            path = LANG_PREFIX + '/artist/' + encodeURIComponent(artistDetail.value);
          } else if (albumDetail.value) {
            path = LANG_PREFIX + '/music/' + slugOfAlbum(albumDetail.value.data.name);
          } else {
            path = LANG_PREFIX + '/music';
          }
        } else if (activeTab.value === 'news') {
          if (newsDetail.value) {
            path = LANG_PREFIX + '/news/' + newsDetail.value.announce_id;
          } else {
            path = LANG_PREFIX + '/news';
            if (newsPage.value > 1) path += '?page=' + newsPage.value;
          }
        } else if (activeTab.value === 'live') {
          if (liveView.value === 'liveSeries') {
            path = LANG_PREFIX + '/live/number_series_event';
          } else if (liveView.value === 'liveDetail') {
            const sg = (liveSeriesIndex.value >= 0 && liveSeriesIndex.value < SERIES_GRID.length) ? SERIES_GRID[liveSeriesIndex.value] : null;
            if (sg) {
              path = LANG_PREFIX + '/live/number_series_event/' + sg.no + '_EVENT';
              if (livePerf.value > 0 || liveDay.value > 0) path += '/' + livePerf.value + '/' + liveDay.value;
            } else {
              path = LANG_PREFIX + '/live/number_series_event';
            }
          } else if (liveView.value === 'liveCatList') {
            path = LANG_PREFIX + '/live/' + liveCatType.value;
          } else if (liveView.value === 'liveCatSection') {
            if (liveCatSectionIndex.value >= 0) {
              path = LANG_PREFIX + '/live/' + liveCatType.value + '/' + liveCatSectionIndex.value;
            } else {
              path = LANG_PREFIX + '/live/' + liveCatType.value;
            }
          } else if (liveView.value === 'liveCatDetail') {
            if (liveCatIndex.value >= 0) {
              if (liveCatSectionIndex.value >= 0) {
                path = LANG_PREFIX + '/live/' + liveCatType.value + '/' + liveCatSectionIndex.value + '/' + liveCatIndex.value;
              } else {
                path = LANG_PREFIX + '/live/' + liveCatType.value + '/' + liveCatIndex.value;
              }
              if (livePerf.value > 0 || liveDay.value > 0) path += '/' + livePerf.value + '/' + liveDay.value;
            } else {
              path = LANG_PREFIX + '/live/' + liveCatType.value;
            }
          } else {
            path = LANG_PREFIX + '/live';
          }
        } else if (activeTab.value === 'database') {
          if (dbView.value === 'characters') {
            if (charDetail.value && charDetail.value.id) {
              path = LANG_PREFIX + '/database/characters/' + encodeURIComponent(charDetail.value.id);
            } else {
              path = LANG_PREFIX + '/database/characters' + (charSub.value === 'intro' ? '' : '/' + charSub.value);
            }
          } else if (dbView.value === 'events') {
            if (evDataView.value) {
              path = LANG_PREFIX + '/database/events/data';
            } else {
              path = LANG_PREFIX + '/database/events';
              if (evTime.value === 'upcoming') path += '?filter[time]=upcoming';
              else if (evTime.value === 'past') path += '?filter[time]=past';
            }
          } else if (dbView.value === 'voice') {
            path = LANG_PREFIX + '/database/voice-actors' + (voiceDetail.value ? '/' + voiceDetail.value.slug : '');
          } else if (dbView.value === 'albums') {
            path = LANG_PREFIX + '/database/albums';
          } else if (dbView.value === 'songs') {
            path = LANG_PREFIX + '/database/songs' + (window.__songsPage && window.__songsPage > 1 ? '?page=' + window.__songsPage : '');
          } else {
            path = LANG_PREFIX + '/database';
          }
        } else if (activeTab.value === 'contribute') {
          path = LANG_PREFIX + '/contribute/fix';
        } else if (activeTab.value === 'contribute-contact') {
          path = LANG_PREFIX + '/contribute/contact';
        } else if (activeTab.value === 'legal-privacy') {
          path = LANG_PREFIX + '/legal/privacy';
        } else if (activeTab.value === 'legal-terms') {
          path = LANG_PREFIX + '/legal/terms';
        } else {
          path = LANG_PREFIX + '/' + activeTab.value;
        }
      } else {
        path = LANG_PREFIX;
      }
      if (currentUrlPath() !== path) {
        history.pushState({ r: true }, '', path);
      }
    }
    function syncFromUrl() {
      const url = new URL(window.location.href);
      const raw = url.pathname.split('/').filter(Boolean);
      // strip optional language prefix (zh-Hans for now)
      const seg = raw.slice();
      if (seg.length && (seg[0].toLowerCase() === 'zh-hans')) seg.shift();
      const first = (seg[0] || '').toLowerCase();
      home.value = seg.length === 0;
      albumDetail.value = null;
      artistDetail.value = null;
      newsDetail.value = null;
      liveSeriesIndex.value = -1;
      livePerf.value = 0;
      liveDay.value = 0;
      liveView.value = 'liveCats';
      activeTab.value = 'songs';
      if (home.value) return;
      if (first === 'news') {
        activeTab.value = 'news';
        if (seg.length >= 2) {
          const raw = decodeURIComponent(seg[1]);
          if (raw && raw.indexOf('lantis-') === 0) {
            openNews(raw);
          } else {
            const id = parseInt(raw, 10);
            if (!isNaN(id)) openNews(id);
          }
        } else {
          const p = parseInt(url.searchParams.get('page') || '1', 10);
          newsPage.value = (isNaN(p) || p < 1) ? 1 : p;
        }
      } else if (first === 'contribute') {
        const subFix = (seg[1] || '').toLowerCase();
        if (subFix === 'contact') {
          activeTab.value = 'contribute-contact';
        } else {
          activeTab.value = 'contribute';
          fixDone.value = false;
        }
      } else if (first === 'legal') {
        const subLegal = (seg[1] || '').toLowerCase();
        activeTab.value = subLegal === 'privacy' ? 'legal-privacy' : 'legal-terms';
      } else if (first === 'music') {
        activeTab.value = 'songs';
        if (seg.length >= 2) {
          const a = findAlbumBySlug(decodeURIComponent(seg[1]));
          if (a) openAlbum(a, null);
        }
      } else if (first === 'artist') {
        activeTab.value = 'songs';
        if (seg.length >= 2) {
          artistDetail.value = decodeURIComponent(seg[1]);
        }
      } else if (first === 'live') {
        activeTab.value = 'live';
        if (seg.length >= 2 && seg[1] === 'number_series_event') {
          if (seg.length >= 3) {
            const idx = seriesNoToIndex(seg[2]);
            if (idx >= 0) {
              const pi = (seg.length >= 5) ? parseInt(seg[3], 10) : -1;
              const di = (seg.length >= 5) ? parseInt(seg[4], 10) : -1;
              openLiveSeries(idx, pi, di);
            }
          } else {
            liveView.value = 'liveSeries';
            restoreLiveScrollFromState('liveSeries');
          }
        } else if (seg.length >= 2 && (seg[1] === 'cd' || seg[1] === 'twinkle' || seg[1] === 'other' || seg[1] === 'nonlive')) {
          liveCatType.value = seg[1];
          if (seg.length >= 3) {
            if (seg[1] === 'cd' && seg.length >= 4) {
              const si = parseInt(seg[2], 10);
              const gi = parseInt(seg[3], 10);
              if (!isNaN(si) && si >= 0 && !isNaN(gi) && gi >= 0) {
                const pi = (seg.length >= 6) ? parseInt(seg[4], 10) : -1;
                const di = (seg.length >= 6) ? parseInt(seg[5], 10) : -1;
                openCatDetail('cd', si, gi, pi, di);
              } else { liveCatIndex.value = -1; liveCatSectionIndex.value = -1; liveView.value = 'liveCatList'; restoreLiveScrollFromState('liveCatList'); }
            } else if (seg[1] === 'cd') {
              const si = parseInt(seg[2], 10);
              if (!isNaN(si) && si >= 0) openCatSection(si);
              else { liveCatIndex.value = -1; liveCatSectionIndex.value = -1; liveView.value = 'liveCatList'; restoreLiveScrollFromState('liveCatList'); }
            } else {
              const idx = parseInt(seg[2], 10);
              if (!isNaN(idx) && idx >= 0) {
                const pi = (seg.length >= 5) ? parseInt(seg[3], 10) : -1;
                const di = (seg.length >= 5) ? parseInt(seg[4], 10) : -1;
                openCatDetail(seg[1], -1, idx, pi, di);
              } else { liveCatIndex.value = -1; liveCatSectionIndex.value = -1; liveView.value = 'liveCatList'; restoreLiveScrollFromState('liveCatList'); }
            }
          } else {
            liveCatIndex.value = -1;
            liveCatSectionIndex.value = -1;
            liveView.value = 'liveCatList';
            restoreLiveScrollFromState('liveCatList');
          }
        }
      } else if (first === 'database') {
        activeTab.value = 'database';
        const sub = (seg[1] || '').toLowerCase();
        charDetail.value = null;
        if (sub === 'characters') {
          dbView.value = 'characters';
          const csub = (seg[2] || 'intro').toLowerCase();
          if (csub === 'room' || csub === 'videos' || csub === 'blood') {
            charSub.value = csub;
          } else {
            charSub.value = 'intro';
            const found = findCharById(csub);
            if (found) charDetail.value = found;
          }
        } else if (sub === 'events') {
          dbView.value = 'events';
          if ((seg[2] || '').toLowerCase() === 'data') {
            evDataView.value = true;
            computeEvData();
          } else {
            evDataView.value = false;
            const ft = url.searchParams.get('filter[time]');
            evTime.value = (ft === 'upcoming' || ft === 'past') ? ft : 'all';
          }
        } else if (sub === 'voice' || sub === 'voice-actors') {
          dbView.value = 'voice';
          voiceDetail.value = findVaBySlug(seg[2] ? decodeURIComponent(seg[2]) : '');
        } else if (sub === 'albums' || sub === 'songs') {
          dbView.value = sub;
          if (sub === 'songs') { var _sp = parseInt(new URLSearchParams(location.search).get('page'), 10); window.__songsPage = (isNaN(_sp) || _sp < 1) ? 1 : _sp; }
        } else {
          dbView.value = 'index';
        }
      } else if (first === 'characters' || first === 'events') {
        activeTab.value = 'database';
        if (first === 'characters') {
          dbView.value = 'characters';
          const sub = (seg[1] || 'intro').toLowerCase();
          charDetail.value = null;
          if (sub === 'room' || sub === 'videos' || sub === 'blood') {
            charSub.value = sub;
          } else {
            charSub.value = 'intro';
            const found = findCharById(sub);
            if (found) charDetail.value = found;
          }
        } else {
          dbView.value = 'events';
          if ((seg[1] || '').toLowerCase() === 'data') {
            evDataView.value = true;
            computeEvData();
          } else {
            evDataView.value = false;
            const ft = url.searchParams.get('filter[time]');
            evTime.value = (ft === 'upcoming' || ft === 'past') ? ft : 'all';
          }
        }
      } else if (first === 'links') {
        activeTab.value = 'links';
      } else {
        activeTab.value = 'songs';
      }
      Vue.nextTick(renderCharBlood);
    }
    function route() {
      syncFromUrl();
    }

    // ---- classification for filters ----
    const WORK_LIST = [
      { key: 's1', label: '赛马娘 Season 1' },
      { key: 's2', label: '赛马娘 Season 2' },
      { key: 's3', label: '赛马娘 Season 3' },
      { key: 'rttp', label: 'ROAD TO THE TOP' },
      { key: 'movi', label: '剧场版《新時代の扉》' },
      { key: 'cinder', label: '芦毛灰姑娘' },
      { key: 'yon', label: '赛马娘四格' },
      { key: 'yur', label: '摇曳马娘' },
      { key: 'sg', label: 'STARTING GATE系列' },
      { key: 'wl', label: 'WINNING LIVE系列' },
      { key: 'svt', label: 'Solo Vocal Tracks系列' }
    ];
    const TYPE_LIST = [
      { key: '专辑', label: '专辑' },
      { key: '单曲', label: '单曲' },
      { key: '原声带', label: '原声带' },
      { key: '精选辑', label: '精选辑' }
    ];
    const FILTERS = {
      '': '',
      s2: ['ANIMATION DERBY Season 2'], s3: ['ANIMATION DERBY Season 3'], s1: ['ANIMATION DERBY'],
      rttp: ['ROAD TO THE TOP'], movi: ['新時代の扉'], cinder: ['シンデレラグレイ'],
      yon: ['うまよん'], yur: ['うまゆる'], sg: ['STARTING GATE'], wl: ['WINNING LIVE'], svt: ['Solo Vocal Tracks'],
      inst: ['サウンドトラック', 'Soundtrack', 'Sound Track']
    };
    function isWorkKey(k, name) {
      if (k === 's1') return /ANIMATION DERBY(?! Season [23])/.test(name);
      return FILTERS[k] && FILTERS[k].some(function (f) { return name.indexOf(f) !== -1; });
    }
    function albumTypeOf(name) {
      if (/サウンドトラック|Sound ?Track/i.test(name)) return 'inst';
      if (/WINNING LIVE (?:06|12|17|25|32)$/.test(name)) return 'inst';
      if (/ROAD TO THE TOP/.test(name)) return 'inst';
      if (/うまよん|うまゆる/.test(name)) return 'inst';
      return 'song';
    }
    function albumWorkOf(name) {
      if (/ANIMATION DERBY Season [23]/.test(name)) return /Season 2/.test(name) ? 's2' : 's3';
      if (/ANIMATION DERBY/.test(name)) return 's1';
      if (/ROAD TO THE TOP/.test(name)) return 'rttp';
      if (/新時代の扉/.test(name)) return 'movi';
      if (/シンデレラグレイ|^超える$/.test(name)) return 'cinder';
      if (/うまよん/.test(name)) return 'yon';
      if (/うまゆる/.test(name)) return 'yur';
      if (/STARTING GATE/.test(name)) return 'sg';
      if (/Solo Vocal Tracks/.test(name)) return 'svt';
      if (/WINNING LIVE/.test(name)) return 'wl';
      return '';
    }
    const filteredAlbums = computed(function () {
      const now = new Date();
      const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const list = albums.value.filter(function (a) {
        if (a.release && String(a.release) > today) return false;
        if (filterWork.value && albumWorkOf(a.name) !== filterWork.value) return false;
        if (filterType.value && a.type !== filterType.value) return false;
        return true;
      });
      if (sortMode.value === 'name') {
        list.sort(function (x, y) { return x.name.localeCompare(y.name, 'ja'); });
      } else {
        list.sort(function (x, y) {
          const dx = String(x.release || ''), dy = String(y.release || '');
          if (dx === dy) return x.name.localeCompare(y.name, 'ja');
          if (!dx) return 1;
          if (!dy) return -1;
          return dy.localeCompare(dx);
        });
      }
      return list;
    });
    function setFilter(which, key) {
      if (which === 'work') filterWork.value = (filterWork.value === key) ? '' : key;
      else filterType.value = (filterType.value === key) ? '' : key;
    }
    function clearFilters() {
      filterWork.value = '';
      filterType.value = '';
    }
    function workLabel(key) {
      const f = WORK_LIST.find(function (x) { return x.key === key; });
      return f ? f.label : key;
    }
    function typeLabel(key) {
      const f = TYPE_LIST.find(function (x) { return x.key === key; });
      return f ? f.label : key;
    }
    function filterActive() { return !!(filterWork.value || filterType.value); }

    // search results (structured)
    const qSearch = computed(function () { return (search.value || '').toLowerCase().trim(); });
    const songHits = computed(function () {
      const q = qSearch.value; if (!q) return [];
      const out = [];
      filteredAlbums.value.forEach(function (a) { a.songs.forEach(function (s) { if (s.name.toLowerCase().indexOf(q) !== -1) out.push({ album: a, song: s }); }); });
      return out;
    });
    const artistHits = computed(function () {
      const q = qSearch.value; if (!q) return [];
      const set = {};
      filteredAlbums.value.forEach(function (a) { a.songs.forEach(function (s) {
        splitArtists(s.artist).forEach(function (nm) {
          if (nm.toLowerCase().indexOf(q) !== -1) set[nm] = 1;
        });
      }); });
      return Object.keys(set);
    });
    const albumHits = computed(function () {
      const q = qSearch.value; if (!q) return [];
      return filteredAlbums.value.filter(function (a) { return a.name.toLowerCase().indexOf(q) !== -1; });
    });
    const artistSongs = computed(function () {
      if (!artistDetail.value) return [];
      const out = [];
      filteredAlbums.value.forEach(function (a) { a.songs.forEach(function (s) { if (splitArtists(s.artist).indexOf(artistDetail.value) !== -1) out.push({ album: a, song: s }); }); });
      return out;
    });
    function openArtist(a) { artistDetail.value = a; albumDetail.value = null; window.scrollTo(0, 0); pushUrl(); }
    function backArtist() { artistDetail.value = null; window.scrollTo(0, 0); pushUrl(); }

    function splitArtists(str) {
      return String(str || '').split(/[/、]/).map(function (s) {
        s = s.trim();
        if (!s) return '';
        const cv = s.match(/\(CV\.\s*([^()]*)\)/);
        if (cv) return cv[1].trim();
        return s;
      }).filter(Boolean);
    }

    function openAlbum(a, target) {
      albumReturnView.value = 'songs';
      savedScrollY.value = window.scrollY || 0;
      const q = search.value.trim();
      var matched = 0;
      if (q) {
        const lq = q.toLowerCase();
        a.songs.forEach(function (s) {
          if (s.name.toLowerCase().indexOf(lq) !== -1 || s.artist.toLowerCase().indexOf(lq) !== -1) matched++;
        });
      }
      albumDetail.value = {
        data: a, songs: a.songs, shown: a.songs.length, total: a.songs.length, query: q, targetName: target ? target.name : null,
        note: matched > 0 ? '匹配到 ' + matched + ' 首，展示该专辑全部 ' + a.songs.length + ' 首' : ''
      };
      pushUrl();
      var savedBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
      document.documentElement.style.scrollBehavior = savedBehavior;
      requestAnimationFrame(function () {
        const t = document.getElementById('tab-album');
        if (t) t.scrollTop = 0;
      });
      requestAnimationFrame(function () {
        if (!q) return;
        const list = document.querySelector('#tab-album .detail-songs');
        const targetName = albumDetail.value ? albumDetail.value.targetName : null;
        if (!list || !targetName) return;
        var row = null;
        const rows = list.querySelectorAll('.song-item.hit-highlight');
        for (let k = 0; k < rows.length; k++) {
          const nm = rows[k].querySelector('.song-name');
          if (nm && nm.textContent === targetName) { row = rows[k]; break; }
        }
        if (!row) return;
        const lr = list.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        list.scrollTop += (rr.top - lr.top) - (lr.height / 2 - rr.height / 2);
      });
    }
    function openAlbumFromDb(a) {
      activeTab.value = 'songs';
      artistDetail.value = null;
      albumDetail.value = null;
      openAlbum(a, null);
      albumReturnView.value = 'albums';
    }
    function albumBack() {
      albumDetail.value = null;
      artistDetail.value = null;
      if (albumReturnView.value === 'albums') {
        activeTab.value = 'database';
        dbView.value = 'albums';
      } else if (albumReturnView.value === 'dbsongs') {
        activeTab.value = 'database';
        dbView.value = 'songs';
        search.value = '';
      } else {
        activeTab.value = 'songs';
      }
      pushUrl();
      var sy = savedScrollY.value;
      Vue.nextTick(function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var target = Math.min(sy, Math.max(0, max));
        var saved = document.documentElement.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = 'auto';
        window.scrollTo(0, target);
        document.documentElement.style.scrollBehavior = saved;
      });
    }
    const detailNoteText = computed(function () { return albumDetail.value ? albumDetail.value.note : ''; });
    const albumBackLabel = computed(function () {
      if (albumReturnView.value === 'albums') return '返回';
      if (albumDetail.value && albumDetail.value.query) return '返回';
      return '返回';
    });
    function isSongHit(s) {
      if (!albumDetail.value || !albumDetail.value.query) return false;
      const q = albumDetail.value.query.toLowerCase();
      return s.name.toLowerCase().indexOf(q) !== -1 || s.artist.toLowerCase().indexOf(q) !== -1;
    }

    // player
    function isActive(url) { return player.url === url && player.playing; }
    function proxySongUrl(url) {
      if (!url) return url;
      if (url.indexOf('/api/audio') === 0) return url;
      if (url.indexOf(location.origin) === 0) return url;
      if (/^https?:\/\//i.test(url)) return '/api/audio?url=' + encodeURIComponent(url);
      return url;
    }
    function playSong(url, name, artist, pic) {
      if (player.url === url) { togglePlay(); return; }
      setAndPlay(url, name, artist, pic);
    }
    function setAndPlay(url, name, artist, pic) {
      player.url = url; player.cover = pic; player.name = name; player.artist = artist;
      player.shown = true; player.playing = true;
      if (audio.value) { audio.value.src = proxySongUrl(url); audio.value.play().catch(function () {}); }
    }
    function playAlbumAt(album, index) {
      const songs = album.songs || [];
      if (!songs.length) return;
      const i = Math.max(0, Math.min(index, songs.length - 1));
      const s = songs[i];
      if (player.url === s.url) { player.queueIndex = i; player.queue = songs; togglePlay(); return; }
      player.queue = songs;
      player.queueIndex = i;
      setAndPlay(s.url, s.name, s.artist, s.pic || album.cover || s.pic);
    }
    function playQueueAt(i) {
      const q = player.queue;
      if (!q || !q.length) return;
      const idx = ((i % q.length) + q.length) % q.length;
      player.queueIndex = idx;
      const s = q[idx];
      setAndPlay(s.url, s.name, s.artist, s.pic);
    }
    function nextSong() { playQueueAt(player.queueIndex + 1); }
    function prevSong() { playQueueAt(player.queueIndex - 1); }
    function togglePlay() {
      if (!audio.value) return;
      if (audio.value.paused) { audio.value.play().catch(function () {}); player.playing = true; }
      else { audio.value.pause(); player.playing = false; }
    }
    function seek(e) {
      if (!audio.value || !player.duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      audio.value.currentTime = ratio * player.duration;
    }
    const styleWidth = computed(function () {
      if (!player.duration) return 'width:0%';
      const pct = Math.min(100, (player.currentTime / player.duration) * 100);
      return 'width:' + pct + '%';
    });

    // live
    const seriesGrid = SERIES_GRID;
    function _isPastDate(ds) {
      const d = new Date(ds + 'T23:59:59');
      if (isNaN(d.getTime())) return true;
      return d.getTime() < Date.now();
    }
    function _groupDateNum(g) {
      const s = (g && g.subs && g.subs[0] && g.subs[0].date) || '';
      const m = String(s).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (!m) return 0;
      return (+m[1]) * 10000 + (+m[2]) * 100 + (+m[3]);
    }
    function _sortGroupsDateDesc(groups) {
      if (Array.isArray(groups)) groups.sort(function (a, b) { return _groupDateNum(b) - _groupDateNum(a); });
    }
    const liveNonliveCat = computed(function () {
      const groups = [];
      (eventsAll.value || []).forEach(function (e) {
        if (e.live) return;
        let castHtml = '';
        if (e.times) castHtml += '<div class="cast-line">' + e.times + '</div>';
        const names = (e.actors || []).map(function (a) { return a.name; }).filter(Boolean);
        if (names.length) castHtml += '<div class="cast-line">出演：' + names.join('、') + '</div>';
        const upcoming = !_isPastDate(e.date);
        const sub = {
          title: e.title,
          date: e.date + (e.venue ? '　' + e.venue : ''),
          cast: castHtml,
          tips: '出处：Eventernote 活动页\n' + ((e.link && e.link.indexOf('eventernote.com') !== -1) ? e.link : ''),
          days: [],
          vids: [],
          nonlive: true,
          upcoming: upcoming,
          evLink: e.link
        };
        groups.push({ group: e.title, subs: [sub], cover: '', nonlive: true, upcoming: upcoming });
      });
      groups.sort(function (a, b) {
        const ua = a.upcoming ? 1 : 0;
        const ub = b.upcoming ? 1 : 0;
        if (ua !== ub) return ua - ub;
        return _groupDateNum(b) - _groupDateNum(a);
      });
      return { group: '非Live活动', groups: groups };
    });
    const liveNonlivePastGroups = computed(function () {
      const all = (liveNonliveCat.value && liveNonliveCat.value.groups) || [];
      return all.filter(function (g) { return !g.upcoming; });
    });
    const liveCatListGroups = computed(function () {
      if (liveCatType.value === 'nonlive') return liveNonlivePastGroups.value;
      const secs = liveCatSections.value;
      if (!secs.length) return [];
      return secs[0].groups || [];
    });
    const currentCat = computed(function () {
      if (liveCatType.value === 'nonlive') return liveNonliveCat.value || null;
      return (liveCatData.value && liveCatData.value[liveCatType.value]) || null;
    });
    const currentGroup = computed(function () {
      if (liveView.value === 'liveCatDetail') {
        const cat = currentCat.value;
        if (!cat || liveCatIndex.value < 0) return null;
        const gi = liveCatIndex.value;
        if (cat.sections) {
          const si = liveCatSectionIndex.value;
          const sec = (si >= 0 && si < cat.sections.length) ? cat.sections[si] : null;
          if (!sec || !sec.groups || gi >= sec.groups.length) return null;
          return sec.groups[gi];
        }
        if (!cat.groups || gi >= cat.groups.length) return null;
        return cat.groups[gi];
      }
      if (liveSeriesIndex.value < 0) return null;
      return liveData.value[liveSeriesIndex.value];
    });
    const liveCatSections = computed(function () {
      const cat = currentCat.value;
      if (!cat) return [];
      if (cat.sections) return cat.sections;
      return [{ group: cat.group, groups: cat.groups || [] }];
    });
    const currentSection = computed(function () {
      const secs = liveCatSections.value;
      const si = liveCatSectionIndex.value;
      if (si < 0 || si >= secs.length) return null;
      return secs[si];
    });
    const CARD_COLORS = ['cc-0', 'cc-1', 'cc-2', 'cc-3', 'cc-4', 'cc-5'];
    function sectionCardClass(gi) { return CARD_COLORS[gi % CARD_COLORS.length]; }
    const liveBackScroll = { view: '', y: 0 };
    function saveLiveScroll() {
      liveBackScroll.view = liveView.value;
      liveBackScroll.y = window.pageYOffset || document.documentElement.scrollTop || 0;
    }
    function restoreLiveScroll(y) {
      const el = document.documentElement;
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
      el.style.scrollBehavior = prev;
    }
    function restoreLiveScrollFromState(id) {
      if (liveBackScroll.view === id && liveBackScroll.y > 0) {
        const y = liveBackScroll.y;
        liveBackScroll.view = '';
        restoreLiveScroll(y);
        requestAnimationFrame(function () { restoreLiveScroll(y); });
        return true;
      }
      return false;
    }
    function showLiveView(id) {
      liveView.value = id;
      if (id === 'liveDetail' || id === 'liveCatDetail') {
        requestAnimationFrame(function () { const d = document.getElementById('liveDetail'); if (d) d.scrollTop = 0; });
      } else if (!restoreLiveScrollFromState(id)) {
        window.scrollTo(0, 0);
      }
      pushUrl();
    }
    function openCat(cat) {
      if (cat === 'series') {
        loadLiveData().then(function () { showLiveView('liveSeries'); }, function () { showLiveView('liveSeries'); });
      } else if (cat === 'cd' || cat === 'twinkle' || cat === 'other' || cat === 'nonlive') {
        const show = function () {
          liveCatType.value = cat;
          liveCatIndex.value = -1;
          liveCatSectionIndex.value = -1;
          showLiveView('liveCatList');
        };
        const ready = cat === 'nonlive' ? loadEvents() : loadLiveCatData();
        ready.then(show, show);
      }
      else { catNote.value = (cat === 'cd') ? 'CD发售纪念活动 正在建设中，敬请期待...' : 'Twinkle Circle! 正在建设中，敬请期待...'; }
    }
    function openCatSection(si) {
      liveCatSectionIndex.value = si;
      liveCatIndex.value = -1;
      livePerf.value = 0;
      liveDay.value = 0;
      showLiveView('liveCatSection');
    }
    function openCatDetail(type, si, gi, pi, di) {
      liveReturnSource.value = 'live';
      saveLiveScroll();
      liveCatType.value = type;
      liveCatSectionIndex.value = si;
      liveCatIndex.value = gi;
      livePerf.value = (typeof pi === 'number' && pi >= 0) ? pi : 0;
      liveDay.value = (typeof di === 'number' && di >= 0) ? di : 0;
      showLiveView('liveCatDetail');
    }
    function backCatList() {
      const cat = liveCatData.value && liveCatData.value[liveCatType.value];
      if (liveView.value === 'liveCatDetail' && cat && cat.sections && liveCatSectionIndex.value >= 0) {
        liveCatIndex.value = -1;
        showLiveView('liveCatSection');
        return;
      }
      liveCatIndex.value = -1;
      liveCatSectionIndex.value = -1;
      showLiveView('liveCatList');
    }
    function liveDetailBack() {
      if (liveReturnSource.value === 'home') {
        liveReturnSource.value = 'live';
        liveSeriesIndex.value = -1;
        livePerf.value = -1;
        liveDay.value = 0;
        activeTab.value = 'songs';
        const path = LANG_PREFIX;
        if (currentUrlPath() !== path) history.pushState({ r: true }, '', path);
        syncFromUrl();
        window.scrollTo(0, 0);
        return;
      }
      if (liveReturnSource.value === 'events') {
        liveReturnSource.value = 'live';
        liveSeriesIndex.value = -1;
        livePerf.value = -1;
        liveDay.value = 0;
        activeTab.value = 'database';
        dbView.value = 'events';
        pushUrl();
        Vue.nextTick(function () {
          var max = document.documentElement.scrollHeight - window.innerHeight;
          var target = Math.min(eventsSavedScrollY.value, Math.max(0, max));
          restoreLiveScroll(target);
        });
        return;
      }
      if (liveView.value === 'liveCatDetail') backCatList();
      else showLiveView('liveSeries');
    }
    function liveDetailHref(path) {
      path = String(path || '');
      if (path.indexOf('number_series_event') !== -1 || path.indexOf('/live/nonlive/') !== -1) return path;
      const orig = liveCatDataOrig.value;
      if (!orig) return path;
      const mcd = path.match(/^\/(?:zh-Hans\/)?live\/cd\/(\d+)\/(\d+)$/);
      if (mcd) {
        const si = +mcd[1], gi = +mcd[2];
        const sec = orig.cd && orig.cd.sections && orig.cd.sections[si];
        const g0 = sec && sec.groups && sec.groups[gi];
        if (g0) {
          const cur = liveCatData.value;
          const csec = cur && cur.cd && cur.cd.sections && cur.cd.sections[si];
          if (csec && Array.isArray(csec.groups)) {
            for (let i = 0; i < csec.groups.length; i++) {
              if (csec.groups[i] && csec.groups[i].group === g0.group) return '/zh-Hans/live/cd/' + si + '/' + i;
            }
          }
        }
        return path;
      }
      const m2 = path.match(/^\/(?:zh-Hans\/)?live\/(other|twinkle)\/(\d+)$/);
      if (m2) {
        const gi = +m2[2], cat = m2[1];
        const g0 = orig[cat] && orig[cat].groups && orig[cat].groups[gi];
        if (g0) {
          const cg = liveCatData.value && liveCatData.value[cat] && liveCatData.value[cat].groups;
          if (Array.isArray(cg)) {
            for (let i = 0; i < cg.length; i++) {
              if (cg[i] && cg[i].group === g0.group) return '/zh-Hans/live/' + cat + '/' + i;
            }
          }
        }
      }
      return path;
    }
    function openLiveFromEvents(path, returnSource) {
      const open = function () {
        path = liveDetailHref(path);
        eventsSavedScrollY.value = window.pageYOffset || document.documentElement.scrollTop || 0;
        liveBackScroll.view = '';
        history.pushState({ r: true }, '', path);
        syncFromUrl();
        liveReturnSource.value = returnSource || 'events';
        var goTop = function () {
          var el = document.documentElement;
          var prev = el.style.scrollBehavior;
          el.style.scrollBehavior = 'auto';
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          el.style.scrollBehavior = prev;
        };
        requestAnimationFrame(goTop);
        setTimeout(goTop, 0);
      };
      return loadLivePathData(path).then(open, open);
    }
    function nonliveGi(e) {
      const gs = (liveNonliveCat.value && liveNonliveCat.value.groups) || [];
      for (let i = 0; i < gs.length; i++) {
        if (gs[i] && gs[i].nonlive && gs[i].subs && gs[i].subs[0] && gs[i].subs[0].evLink === e.link) return i;
      }
      return -1;
    }
    function nonliveHref(e) {
      const gi = nonliveGi(e);
      return gi >= 0 ? LANG_PREFIX + '/live/nonlive/' + gi : LANG_PREFIX + '/live/nonlive';
    }
    function openNonliveFromEvents(e) {
      if (nonliveGi(e) < 0) return;
      eventsSavedScrollY.value = window.pageYOffset || document.documentElement.scrollTop || 0;
      history.pushState({ r: true }, '', nonliveHref(e));
      syncFromUrl();
      liveReturnSource.value = 'events';
      var goTop = function () {
        var el = document.documentElement;
        var prev = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        el.style.scrollBehavior = prev;
      };
      requestAnimationFrame(goTop);
      setTimeout(goTop, 0);
    }
    function openLiveSeries(i, pi, di) {
      liveReturnSource.value = 'live';
      saveLiveScroll();
      liveSeriesIndex.value = i;
      livePerf.value = (typeof pi === 'number' && pi >= 0) ? pi : 0;
      liveDay.value = (typeof di === 'number' && di >= 0) ? di : 0;
      showLiveView('liveDetail');
    }
    function selectLivePerf(pi) {
      livePerf.value = pi;
      liveDay.value = 0;
      requestAnimationFrame(function () { const d = document.getElementById('liveDetail'); if (d) d.scrollTop = 0; });
    }
    function selectLiveDay(pi, di) {
      livePerf.value = pi;
      liveDay.value = di;
      requestAnimationFrame(function () { const d = document.getElementById('liveDetail'); if (d) d.scrollTop = 0; });
    }
    const currentSub = computed(function () {
      const g = currentGroup.value;
      if (!g || livePerf.value < 0 || livePerf.value >= g.subs.length) return null;
      return g.subs[livePerf.value];
    });
    const liveInfoHtml = computed(function () {
      const s = currentSub.value;
      if (!s) return '<div class="live-setlist-placeholder">请在左侧选择一场公演</div>';
      const dp = (s.date || '').split(/\s+/);
      const dTime = dp[0] || '';
      const dPlace = dp.slice(1).join(' ');
      let src = '', srcUrl = '', srcText = '';
      if (s.tips) {
        const sm = s.tips.match(/(?:出处|来源)[：:]\s*([^\n]+)/);
        const um = s.tips.match(/https?:\/\/[^\s]+/);
        if (sm) src = sm[1].replace(/[\r\n\s]+$/, '').trim();
        if (um) { srcUrl = um[0].replace(/\/$/, ''); srcText = srcUrl; }
      }
      var srcHtml = (src || srcText) ?
        '<a class="live-info-date-src"' + (srcUrl ? ' href="' + srcUrl + '" target="_blank" rel="noopener" title="' + srcText + '"' : '') + '>出处：' + src + '</a>' : '';
      let h = '<div class="live-info-title">' + (s.title||'') + '</div>';
      h += '<div class="live-info-date"><span class="live-info-date-main">时间：' + dTime + '　地点：' + dPlace + '</span>' + srcHtml + '</div>';
      if (s.nonlive && !!s.upcoming) h += '<div class="live-info-cast"><div class="cast-line" style="color:var(--accent,#ff8c1a);font-weight:700;">暂未开演 · 歌单整理中</div></div>';
      if (s.cast) h += '<div class="live-info-cast">' + s.cast + '</div>';
      if (s.tips && !srcHtml) h += '<div class="live-info-tips">' + s.tips + '</div>';
      return fixAvatarSrc(h);
    });
    const setlistTitle = computed(function () {
      const s = currentSub.value;
      if (!s) return '';
      if (s.nonlive && !!s.upcoming) return s.title + ' · 暂未开演';
      if (s.nonlive) return s.title + ' · 本活动';
      if (liveDay.value >= s.days.length) return '';
      return s.title + ' · ' + s.days[liveDay.value].label;
    });
    const setlistLinks = computed(function () {
      const s = currentSub.value;
      if (!s || liveDay.value >= s.days.length || !s.vids) return [];
      const links = [];
      s.vids.forEach(function (v) {
        if (v[1] === 'D' + (liveDay.value + 1)) {
          const raw = String(v[0] || '');
          const urls = raw.match(/https?:\/\/\S+/g) || [];
          if (urls.length) {
            const cleaned = urls.map(function (u) { return u.replace(/[.,，。;；\s]+$/, ''); });
            const obj = { href: cleaned[0], title: cleaned.length > 1 ? cleaned.join('\n') : undefined };
            links.push(obj);
          }
        }
      });
      return links;
    });
    function fixAvatarSrc(html) {
      return String(html || '').replace(/(["'])uma_avatars\//g, '$1/uma_avatars/');
    }
    function hideEncorePerf(html) {
      return String(html || '').replace(/<td class="setlist-song">安可<\/td>\s*<td class="setlist-perf">/g,
        '<td class="setlist-song">安可</td><td class="setlist-perf encore-hide">');
    }
    const setlistTable = computed(function () {
      const s = currentSub.value;
      if (!s || liveDay.value >= s.days.length) return '';
      return fixAvatarSrc(hideEncorePerf(s.days[liveDay.value].table || ''));
    });

    // albums loading
    const statSongs = computed(function () {
      if (homeStats.songs !== null) return homeStats.songs;
      return albums.value.reduce(function (n, a) { return n + a.songs.length; }, 0);
    });
    const statAlbums = computed(function () { return homeStats.albums !== null ? homeStats.albums : albums.value.length; });
    const charCount = computed(function () {
      if (homeStats.characters !== null) return homeStats.characters;
      return (window.CHAR_INDEX && window.CHAR_INDEX.length) || 0;
    });
    const statVoiceActors = computed(function () {
      return homeStats.voiceActors !== null ? homeStats.voiceActors : vaList().length;
    });
    const relAlbums = computed(function () {
      let out = albums.value.slice();
      if (relFilter.value) out = out.filter(function (a) { return a.type === relFilter.value; });
      if (relYear.value) out = out.filter(function (a) { return String(a.release).slice(0, 4) === relYear.value; });
      return out.slice().sort(function (a, b) { return String(b.release).localeCompare(String(a.release)); });
    });
    const relTypesCount = computed(function () {
      return albums.value.reduce(function (s, a) { return s.add(a.type); }, new Set()).size;
    });
    const relTypeList = computed(function () {
      return ['专辑', '单曲', '原声带', '精选辑'].filter(function (t) {
        return albums.value.some(function (a) { return a.type === t; });
      });
    });
    const relYearList = computed(function () {
      const ys = albums.value.map(function (a) { return String(a.release).slice(0, 4); });
      return Array.from(new Set(ys)).filter(function (y) { return /^\d{4}$/.test(y); }).sort().reverse();
    });
    const relFiltered = computed(function () {
      return relAlbums.value.slice();
    });
    const relPerPage = 30;
    const relPageCount = computed(function () {
      return Math.max(1, Math.ceil(relFiltered.value.length / relPerPage));
    });
    const relPaged = computed(function () {
      const s = (relPage.value - 1) * relPerPage;
      return relFiltered.value.slice(s, s + relPerPage);
    });
    const relPageStart = computed(function () {
      if (!relFiltered.value.length) return 0;
      return (relPage.value - 1) * relPerPage + 1;
    });
    const relPageEnd = computed(function () {
      if (!relFiltered.value.length) return 0;
      return Math.min(relFiltered.value.length, relPage.value * relPerPage);
    });
    const relPageList = computed(function () {
      const total = relPageCount.value;
      const cur = relPage.value;
      const pages = [];
      const push = function (p) { if (pages.length && pages[pages.length - 1] === p) return; pages.push(p); };
      push(1);
      if (cur > 3) push('…');
      for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) push(p);
      if (cur < total - 2) push('…');
      if (total > 1) push(total);
      return pages;
    });
    function setRelPage(p) {
      if (p === '…') return;
      const n = parseInt(p, 10);
      if (isNaN(n)) return;
      if (n < 1 || n > relPageCount.value) return;
      relPage.value = n;
      const el = document.querySelector('#tab-db-albums .rel-table');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function goRelPage(dir) {
      setRelPage(relPage.value + dir);
    }
    function setRelFilter(t) {
      relFilter.value = (relFilter.value === t) ? '' : t;
      relPage.value = 1;
    }
    function setRelYear(y) {
      relYear.value = (relYear.value === y) ? '' : y;
      relPage.value = 1;
    }
    function clearRelFilters() {
      relFilter.value = '';
      relYear.value = '';
      relPage.value = 1;
    }
    function relIsSold(a) {
      const t = new Date(String(a.release || '').replace(/-/g, '/')).getTime();
      return !isNaN(t) && t <= Date.now();
    }
    const statLive = computed(function () {
      let n = liveData.value.reduce(function (a, g) { return a + g.subs.reduce(function (b, s) { return b + (s.days ? s.days.length : 1); }, 0); }, 0);
      const cat = liveCatData.value;
      if (cat) {
        const sumGroups = function (gs) { return gs.reduce(function (a, g) { return a + g.subs.length; }, 0); };
        if (cat.cd && cat.cd.sections) n += cat.cd.sections.reduce(function (a, s) { return a + sumGroups(s.groups); }, 0);
        if (cat.twinkle && cat.twinkle.groups) n += sumGroups(cat.twinkle.groups);
        if (cat.other && cat.other.groups) n += sumGroups(cat.other.groups);
      }
      return homeStats.live !== null ? homeStats.live : n;
    });
    const statGongyan = computed(function () { return homeStats.performances !== null ? homeStats.performances : liveData.value.length; });
    const newsHero = computed(function () {
      function timeOf(n) {
        const s = n.post_at || n.update_at || '';
        const t = new Date(String(s).replace(' ', 'T')).getTime();
        if (!isNaN(t)) return t;
        return -1;
      }
      function pick(list) {
        let best = null;
        list.forEach(function (n) {
          if (!best || timeOf(n) > timeOf(best)) best = n;
        });
        return best;
      }
      const media = [];
      const game = [];
      const cd = [];
      newsItems.value.forEach(function (n) {
        const t = newsTypeOf(n);
        if (t === 'media') media.push(n);
        else if (t === 'game') game.push(n);
        else if (t === 'cd') cd.push(n);
      });
      return [pick(media), pick(cd), pick(game)].filter(Boolean).slice(0, 3);
    });
    const newsFiltered = computed(function () {
      let out = newsItems.value;
      if (newsRange.value !== 'all') {
        const days = parseInt(newsRange.value, 10);
        const cut = Date.now() - days * 86400000;
        out = out.filter(function (n) { var t = new Date(String(n.post_at).replace(' ', 'T')).getTime(); return !isNaN(t) && t >= cut; });
      }
      if (newsType.value !== 'all') {
        out = out.filter(function (n) { return newsTypeOf(n) === newsType.value; });
      }
      // Sort by original publish time (post_at) newest-first so the list always shows
      // the latest-posted news on top regardless of server update_at ordering.
      out = out.slice().sort(function (a, b) {
        const ta = new Date(String(a.post_at || '').replace(' ', 'T')).getTime();
        const tb = new Date(String(b.post_at || '').replace(' ', 'T')).getTime();
        if (!isNaN(ta) && !isNaN(tb)) return tb - ta;
        if (!isNaN(ta)) return -1;
        if (!isNaN(tb)) return 1;
        return 0;
      });
      return out;
    });
    const newsPageCount = computed(function () {
      return Math.max(1, Math.ceil(newsFiltered.value.length / newsPerPage));
    });
    const newsPaged = computed(function () {
      const s = (newsPage.value - 1) * newsPerPage;
      return newsFiltered.value.slice(s, s + newsPerPage);
    });
    const newsPageStart = computed(function () {
      if (!newsFiltered.value.length) return 0;
      return (newsPage.value - 1) * newsPerPage + 1;
    });
    const newsPageEnd = computed(function () {
      if (!newsFiltered.value.length) return 0;
      return Math.min(newsFiltered.value.length, newsPage.value * newsPerPage);
    });
    const newsPageList = computed(function () {
      const total = newsPageCount.value;
      const cur = newsPage.value;
      const pages = [];
      const push = function (p) { if (pages.length && pages[pages.length - 1] === p) return; pages.push(p); };
      push(1);
      if (cur > 3) push('…');
      for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) push(p);
      if (cur < total - 2) push('…');
      if (total > 1) push(total);
      return pages;
    });
    function setNewsPage(p) {
      if (p === '…') return;
      const n = parseInt(p, 10);
      if (isNaN(n)) return;
      if (n < 1 || n > newsPageCount.value) return;
      newsPage.value = n;
      pushUrl();
      const el = document.getElementById('news-list-top');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function goNewsPage(dir) {
      setNewsPage(newsPage.value + dir);
    }
    watch(function () { return newsRange.value; }, function () { newsPage.value = 1; });
    watch(function () { return newsType.value; }, function () { newsPage.value = 1; });
    watch(function () { return newsItems.value.length; }, function () { newsPage.value = 1; });

    const eventsCount = computed(function () { return homeStats.events !== null ? homeStats.events : eventsAll.value.length; });
    const eventsFiltered = computed(function () {
      const q = (eventsQuery.value || '').toLowerCase();
      let out = eventsAll.value.filter(function (e) {
        if (!q) return true;
        if ((e.title || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((e.venue || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((e.times || '').toLowerCase().indexOf(q) !== -1) return true;
        return e.actors.some(function (a) { return (a.name || '').toLowerCase().indexOf(q) !== -1; });
      });
      if (evTime.value !== 'all') {
        const now = Date.now();
        out = out.filter(function (e) {
          var t = new Date(e.date + 'T00:00:00').getTime();
          if (isNaN(t)) return true;
          if (evTime.value === 'upcoming') return t >= now - 86400000;
          return t < now - 86400000;
        });
      }
      return out;
    });
    const eventsPageCount = computed(function () {
      return Math.max(1, Math.ceil(eventsFiltered.value.length / eventsPerPage));
    });
    const eventsPaged = computed(function () {
      const s = (eventsPage.value - 1) * eventsPerPage;
      return eventsFiltered.value.slice(s, s + eventsPerPage);
    });
    const eventsPageStart = computed(function () {
      if (!eventsFiltered.value.length) return 0;
      return (eventsPage.value - 1) * eventsPerPage + 1;
    });
    const eventsPageEnd = computed(function () {
      if (!eventsFiltered.value.length) return 0;
      return Math.min(eventsFiltered.value.length, eventsPage.value * eventsPerPage);
    });
    const eventsPageList = computed(function () {
      const total = eventsPageCount.value;
      const cur = eventsPage.value;
      const pages = [];
      const push = function (p) { if (pages.length && pages[pages.length - 1] === p) return; pages.push(p); };
      push(1);
      if (cur > 3) push('…');
      for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) push(p);
      if (cur < total - 2) push('…');
      if (total > 1) push(total);
      return pages;
    });
    function setEventsPage(p) {
      if (p === '…') return;
      const n = parseInt(p, 10);
      if (isNaN(n)) return;
      if (n < 1 || n > eventsPageCount.value) return;
      eventsPage.value = n;
      pushUrl();
      const el = document.getElementById('eventsRowsTop');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function goEventsPage(dir) {
      setEventsPage(eventsPage.value + dir);
    }
    function pastEvent(e) {
      var t = new Date(e.date + 'T00:00:00').getTime();
      return !isNaN(t) && t < Date.now() - 86400000;
    }
    const nextUpcomingEvent = computed(function () {
      if (homeNextEvent.value) return homeNextEvent.value;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const today = now.getTime();
      let best = null, bestT = 0;
      (eventsAll.value || []).forEach(function (e) {
        const t = new Date(e.date + 'T00:00:00').getTime();
        if (isNaN(t)) return;
        if (t < today) return;
        if (!best || t < bestT) { best = e; bestT = t; }
      });
      return best;
    });
    const nextUpcomingHref = computed(function () {
      const e = nextUpcomingEvent.value;
      if (!e) return null;
      if (e.live) return liveDetailHref(e.live);
      return nonliveHref(e);
    });
    function openNextUpcoming() {
      const e = nextUpcomingEvent.value;
      if (!e) return;
      if (e.live) {
        openLiveFromEvents(liveDetailHref(e.live), 'home');
        return;
      }
      loadEvents().then(function () {
        openNonliveFromEvents(e);
        liveReturnSource.value = 'home';
      });
    }
    function onEvImgError(ev) {
      ev.target.style.visibility = 'hidden';
    }
    function loadEvents() {
      if (eventsLoadPromise) return eventsLoadPromise;
      eventsError.value = '';
      eventsLoading.value = true;
      eventsLoadPromise = fetch('/events_data.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          eventsAll.value = (data && Array.isArray(data.events)) ? data.events : [];
          eventsMeta.value = (data && data._meta && data._meta.scraped_at) ? data._meta.scraped_at : '2026-08-12';
          eventsLoading.value = false;
          eventsError.value = eventsAll.value.length ? '' : '活动数据为空。';
        })
        .catch(function () {
          eventsAll.value = [];
          eventsLoading.value = false;
          eventsError.value = '无法加载活动数据（请确认 events_data.json 存在，并通过本地服务访问本页）。';
        });
      return eventsLoadPromise;
    }
    function openEvData() {
      evDataView.value = true;
      computeEvData();
      pushUrl();
    }
    function closeEvData() {
      evDataView.value = false;
      pushUrl();
    }
    function decodeHtml(s) {
      if (!s) return '';
      var d = document.createElement('div');
      d.innerHTML = s;
      return d.textContent || '';
    }
    function computeEvData() {
      evDataLoading.value = true;
      evDataError.value = '';
      vaFilters.value = []; songFilter.value = 'all'; vaPage.value = 1; songPage.value = 1;
      // 歌曲演出次数排行：仍来自 voice_participation.json（不变）
      fetch('/voice_participation.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var events = (data && data.events) || [];
          var sEv = [];
          events.forEach(function (ev) {
            (ev.days || []).forEach(function (d) {
              if (d.songs && d.songs.length) sEv.push({ cat: ev.cat, songs: d.songs });
            });
          });
          songEvData.value = sEv;
        })
        .catch(function () { /* 歌曲数据加载失败不阻塞声优侧 */ });
      // 声优出演次数排行：改由 events_list.xlsx 导出的 actor_participation.json（按事件计数）
      fetch('/actor_participation.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var entries = (data && data.entries) || [];
          voiceEvData.value = entries.map(function (e) { return { cat: e.cat, actors: e.actors }; });
          evDataLoading.value = false;
        })
        .catch(function () { evDataError.value = '无法加载声优参与数据（actor_participation.json）。'; evDataLoading.value = false; });
    }
    function setEvTime(v) {
      if (v !== 'all' && v !== 'upcoming' && v !== 'past') return;
      evTime.value = v;
      eventsPage.value = 1;
      pushUrl();
    }
    watch(function () { return eventsQuery.value; }, function () { eventsPage.value = 1; });
    watch(function () { return evTime.value; }, function () { eventsPage.value = 1; });
    watch(function () { return eventsAll.value; }, function () { if (evDataView.value && !voiceEvData.value.length) computeEvData(); });
    const coverTint = reactive({});
    const tintSet = new Set();
    function coverThumb(url, size) {
      const src = String(url || '');
      if (!src || !/^https?:\/\/p\d+\.music\.126\.net\//i.test(src) || /[?&]param=\d+y\d+/i.test(src)) return src;
      const px = Math.max(64, parseInt(size, 10) || 360);
      return src + (src.indexOf('?') === -1 ? '?' : '&') + 'param=' + px + 'y' + px;
    }
    function microCmsImage(url, width) {
      const src = String(url || '');
      if (!/^https:\/\/images\.microcms-assets\.io\//i.test(src)) return src;
      const px = Math.max(1, Math.round(width || 560));
      return src + (src.indexOf('?') === -1 ? '?' : '&') + 'w=' + px + '&fm=webp&q=75';
    }
    window.umaCoverThumb = coverThumb;
    function sampleCover(event, url) {
      if (!url || tintSet.has(url)) return;
      tintSet.add(url);
      const img = event && event.currentTarget;
      if (!img || !img.naturalWidth) return;
      try {
        const c = document.createElement('canvas');
        const s = 40;
        c.width = s; c.height = s;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, s, s);
        const d = ctx.getImageData(0, 0, s, s).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        coverTint[url] = Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n);
      } catch (e) { /* keep fallback tint */ }
    }
    function coverStyle(album) {
      return { '--cover-tint': coverTint[album.cover] || '22,26,41' };
    }
    function newsDate(s) {
      if (!s) return '';
      const d = new Date(s.replace(' ', 'T'));
      if (isNaN(d)) return s;
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }
    function newsTypeOf(n) {
      if (n.announce_label === 4) return 'cd';
      return n.announce_label === 3 ? 'media' : 'game';
    }
    function newsTypeLabel(n) {
      if (!n) return '';
      const t = newsTypeOf(n);
      if (t === 'media') return 'MEDIA';
      if (t === 'game') return 'GAME';
      if (t === 'cd') return 'CD相关';
      return '';
    }
    function newsTitle(n) {
      if (!n) return '';
      return n.title_zh || n.title || '';
    }
    function cleanNewsBody(html) {
      if (!html) return '';
      let h = String(html);
      h = h.replace(/<span data-renderer-mark="true"[^>]*>/gi, '');
      h = h.replace(/<span[^>]*>|<\/span>/gi, '');
      h = h.replace(/<div[^>]*>\s*<\/div>/gi, '');
      h = h.replace(/<\/?exclusion-game[^>]*>/gi, '');
      return h;
    }
    function loadNews() {
      if (newsLoadPromise) return newsLoadPromise;
      newsError.value = '';
      newsLoading.value = true;
      newsLoadPromise = fetch('/api/news-index', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          newsItems.value = (d && d.information_list) || [];
          newsLoading.value = false;
        })
        .catch(function () {
          newsItems.value = [];
          newsLoading.value = false;
          newsError.value = '无法加载新闻数据（请通过本地服务访问，例如 node uma_tools/server.js --no-crawl 后打开 http://localhost:8080/）';
        });
      return newsLoadPromise;
    }
    function newsHeroCover(n) {
      if (!n) return newsDefaultCover;
      return n.image || newsDefaultCover;
    }
    function openNews(id) {
      if (!id) return;
      if (String(id).indexOf('lantis-') === 0) {
        // Lantis CD-related item: crawl body via the proxy server.
        let item = null;
        newsItems.value.forEach(function (n) { if (n.announce_id === id) item = n; });
        newsDetail.value = {
          announce_id: id,
          title: (item && item.title) || '',
          title_zh: (item && item.title_zh) || '',
          post_at: (item && item.post_at) || '',
          source: 'lantis',
          url: (item && item.url) || '',
          image: (item && item.image) || ''
        };
        newsDetailBody.value = '';
        newsPrevId.value = 0;
        newsNextId.value = 0;
        window.scrollTo(0, 0);
        pushUrl();
        fetch('/api/lantis-detail?id=' + encodeURIComponent(id), { cache: 'no-cache' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.detail || !d.detail.announce_id) throw new Error('no detail');
            const dd = d.detail;
            newsDetail.value = {
              announce_id: dd.announce_id,
              title: dd.title || (item && item.title) || '',
              title_zh: dd.title_zh || (item && item.title_zh) || dd.title || '',
              post_at: dd.post_at || (item && item.post_at) || '',
              source: 'lantis',
              url: dd.url || (item && item.url) || '',
              image: dd.image || (item && item.image) || ''
            };
            newsDetailBody.value = cleanNewsBody(dd.message_zh || dd.message);
          })
          .catch(function () { /* keep the header-only view on failure */ });
        return;
      }
      fetch('/api/news-detail?id=' + id, { cache: 'no-cache' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.detail || !d.detail.announce_id) throw new Error('no detail');
          newsDetail.value = d.detail;
          newsDetailBody.value = cleanNewsBody(d.detail.message_zh || d.detail.message);
          newsPrevId.value = d.prev_announce_id || 0;
          newsNextId.value = d.next_announce_id || 0;
          window.scrollTo(0, 0);
          pushUrl();
        })
        .catch(function () { newsError.value = '详情加载失败'; });
    }
    function newsBack() {
      newsDetail.value = null;
      newsDetailBody.value = '';
      pushUrl();
    }
    function loadAlbums() {
      if (albumsLoadPromise) return albumsLoadPromise;
      albumsError.value = '';
      albumsLoadPromise = fetch('/albums.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { albums.value = Array.isArray(data) ? data : []; })
        .catch(function (e) { albumsError.value = '无法加载专辑数据（请通过本地服务访问本页，例如 node uma_tools/server.js --no-crawl 后打开 http://localhost:8080/）'; });
      return albumsLoadPromise;
    }
    function loadLiveCatData() {
      if (liveCatLoadPromise) return liveCatLoadPromise;
      liveCatDataError.value = '';
      liveCatLoadPromise = fetch('/live_cat_data.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          try { liveCatDataOrig.value = JSON.parse(JSON.stringify(data)); } catch (e) { liveCatDataOrig.value = null; }
          if (data) {
            if (data.cd && Array.isArray(data.cd.sections)) data.cd.sections.forEach(function (sec) { _sortGroupsDateDesc(sec && sec.groups); });
            if (data.twinkle) _sortGroupsDateDesc(data.twinkle.groups);
            if (data.other) _sortGroupsDateDesc(data.other.groups);
          }
          liveCatData.value = data || null;
        })
        .catch(function () {
          liveCatData.value = null;
          liveCatDataError.value = '无法加载活动演出数据（请确认 /live_cat_data.json 可访问）。';
        });
      return liveCatLoadPromise;
    }
    function loadLiveData() {
      if (liveDataLoadPromise) return liveDataLoadPromise;
      liveDataError.value = '';
      liveDataLoadPromise = fetch('/live_data.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { liveData.value = Array.isArray(data) ? data : []; })
        .catch(function () {
          liveData.value = [];
          liveDataError.value = '无法加载编号系列公演数据（请确认 /live_data.json 可访问）。';
        });
      return liveDataLoadPromise;
    }

    // audio events
    function bindAudio() {
      const a = audio.value;
      if (!a) return;
      a.addEventListener('play', function () { player.playing = true; });
      a.addEventListener('pause', function () { player.playing = false; });
      a.addEventListener('ended', function () {
        player.playing = false; player.currentTime = 0; player.duration = 0;
        if (player.queue && player.queue.length && player.queueIndex >= 0 && player.queueIndex < player.queue.length - 1) {
          nextSong();
        }
      });
      a.addEventListener('timeupdate', function () { player.currentTime = a.currentTime; });
      a.addEventListener('loadedmetadata', function () { player.duration = a.duration; });
    }

    return {
      audio, albums, albumsError, activeTab, home, albumDetail, albumReturnView, artistDetail, search, view, liveView, liveSeriesIndex, livePerf, liveDay, catNote, player, tabs,
      filterWork, filterType, sortMode, WORK_LIST, TYPE_LIST, filteredAlbums, setFilter, clearFilters, workLabel, typeLabel, filterActive, showFilters, backTopVisible, backToTop, onScroll,
      albumTypeOf,
      isTabActive, switchTab, enterTab, goHome, goDbView, dbView, albumName, clearSearch, songHits, artistHits, albumHits, artistSongs, openArtist, backArtist, openAlbum, openAlbumFromDb, albumBack, detailNoteText, albumBackLabel, isSongHit,
      statSongs, statAlbums, statLive, statGongyan,       loadAlbums, coverStyle, coverThumb, microCmsImage, sampleCover, evDataView, evDataTab, evDataLoading, evDataError, openEvData, closeEvData, vaFilters, songFilter, rankSort, vaPage, songPage, evRankPage, actorRankList, songRankList, actorPageRows, songPageRows, actorPageCount, songPageCount, actorPageStart, actorPageEnd, songPageStart, songPageEnd, actorPageList, songPageList, setVaFilter, isVaFilter, setSongFilter, setVaPage, goVaPage, setSongPage, goSongPage,
      fix, fixDone, fixSendState, submitFix, goContributeFix, goContributeContact, goLegal,
      isActive, playSong, togglePlay, seek, styleWidth,
      nextSong, prevSong, playQueueAt, playAlbumAt, showQueue,
      showLiveView, openCat, openLiveSeries, selectLivePerf, selectLiveDay, liveDetailBack, openLiveFromEvents, liveDetailHref,
      liveCatType, liveCatIndex, liveData, liveDataError, loadLiveData, liveCatData, liveCatDataError, loadLiveCatData, openCatDetail, backCatList, liveCatSectionIndex, liveCatSections, openCatSection, currentSection, sectionCardClass,
      currentCat, liveNonliveCat, liveNonlivePastGroups, liveCatListGroups, nonliveGi, nonliveHref, openNonliveFromEvents,
      newsItems, newsError, newsLoading, newsRange, newsType, newsFiltered, newsHero,
      newsDetail, newsDetailBody, newsPrevId, newsNextId,
      newsDate, newsTypeOf, newsTypeLabel, newsTitle, openNews, newsBack, loadNews, newsHeroCover,
      newsPage, newsPaged, newsPageCount, newsPageStart, newsPageEnd, newsPageList, setNewsPage, goNewsPage,
      currentGroup, currentSub, liveInfoHtml, setlistTitle, setlistLinks, setlistTable,
      seriesGrid, syncFromUrl, prepareCurrentRoute, loadHomeSummaryIfNeeded,
      eventsCount, eventsMeta, eventsQuery, evTime, setEvTime, eventsPaged, eventsFiltered,
      eventsPage, eventsPageCount, eventsPageStart, eventsPageEnd, eventsPageList,
      setEventsPage, goEventsPage, pastEvent, onEvImgError, loadEvents,
      nextUpcomingEvent, nextUpcomingHref, openNextUpcoming,
      charSub, goCharSub, charDetail, openCharDetail, charBack, charDetailSource, charHasIntro,
      voiceDetail, statVoiceActors, charCount, openVa, voiceBack, openCharFromVoice, LANG_PREFIX,
      relFilter, relAlbums, relTypesCount, relTypeList, relYearList, relYear, relPage, relFiltered, relPaged, relPageCount, relPageStart, relPageEnd, relPageList, setRelPage, goRelPage, setRelFilter, setRelYear, clearRelFilters, relIsSold,
      bindAudio
    };
  },
  mounted() {
    this.bindAudio();
    const self = this;
    window.__uma_app = this;
    const syncPrepared = function () {
      self.prepareCurrentRoute().then(function () { self.syncFromUrl(); }, function () { self.syncFromUrl(); });
    };
    window.addEventListener('popstate', syncPrepared);
    syncPrepared();
    this.loadHomeSummaryIfNeeded();
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.onScroll();
  }
}).mount('#app');



(function () {
  var curZoom = null;
  function applyZ() {
    var z = curZoom;
    if (z) z.stage.style.transform = 'translate(' + z.tx + 'px,' + z.ty + 'px) scale(' + z.scale + ')';
  }
  window.addEventListener('mousemove', function (e) {
    var z = curZoom;
    if (!z || !z.dragging) return;
    z.tx = z.ox + (e.clientX - z.sx);
    z.ty = z.oy + (e.clientY - z.sy);
    applyZ();
  });
  window.addEventListener('mouseup', function () { if (curZoom) curZoom.dragging = false; });

  function fitGlobal() {
    var z = curZoom;
    if (!z) return;
    var w = z.stage.parentElement.clientWidth, h = z.stage.parentElement.clientHeight;
    if (w < 50) return;
    var iw = z.img.naturalWidth || 1000, ih = z.img.naturalHeight || 800;
    z.scale = Math.min(w / iw, h / ih); if (z.scale > 1) z.scale = 1;
    z.tx = (w - iw * z.scale) / 2; z.ty = (h - ih * z.scale) / 2;
    applyZ();
  }
  function zoomStep(delta) {
    var z = curZoom;
    if (!z) return;
    var ns = Math.max(0.05, Math.min(4, z.scale * delta));
    z.tx = (z.stage.parentElement.clientWidth / 2) - ((z.stage.parentElement.clientWidth / 2) - z.tx) * (ns / z.scale);
    z.ty = 100 - (100 - z.ty) * (ns / z.scale);
    z.scale = ns;
    applyZ();
  }

  function initZoom(root) {
    var stage = (root || document).querySelector('#c-global-stage');
    var img = (root || document).querySelector('#c-global-img');
    if (!stage || !img || stage.getAttribute('data-c-inited')) return;
    stage.setAttribute('data-c-inited', '1');
    var z = { scale: 1, tx: 0, ty: 0, dragging: false, stage: stage, img: img };
    curZoom = z;
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var rect = stage.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var nx = (px - z.tx) / z.scale, ny = (py - z.ty) / z.scale;
      var ns = Math.max(0.05, Math.min(4, z.scale * delta));
      z.tx = px - nx * ns; z.ty = py - ny * ns; z.scale = ns;
      applyZ();
    }, { passive: false });
    stage.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      z.dragging = true; z.sx = e.clientX; z.sy = e.clientY; z.ox = z.tx; z.oy = z.ty;
      e.preventDefault();
    });
    img.addEventListener('load', fitGlobal);
    var zin = root.querySelector('#cgzin'), zout = root.querySelector('#cgzout'),
        zreset = root.querySelector('#cgzreset'), zfit = root.querySelector('#cgzfit');
    if (zfit) zfit.addEventListener('click', fitGlobal);
    if (zin) zin.addEventListener('click', function () { zoomStep(1.2); });
    if (zout) zout.addEventListener('click', function () { zoomStep(1 / 1.2); });
    if (zreset) zreset.addEventListener('click', function () { z.scale = 1; z.tx = 0; z.ty = 0; applyZ(); });
    applyZ();
  }

  function renderIntro(root) {
    var grid = (root || document).querySelector('#cIntroGrid');
    var input = (root || document).querySelector('#cIntroSearch');
    var sortSel = (root || document).querySelector('#cIntroSort');
    var listBox = (root || document).querySelector('#cIntroList');
    if (!grid || !input || grid.getAttribute('data-c-inited')) return;
    grid.setAttribute('data-c-inited', '1');
    function norm(c) { return String(c || '').toLowerCase(); }
    function data() {
      if (window.CHAR_INDEX && window.CHAR_INDEX.length) return window.CHAR_INDEX;
      return (window.UMA_INTRO || []).map(function (c) {
        return { zh: c.zh, ja: c.name, en: c.en || c.name, cv_zh: c.cv, cv: c.cv, img: c.av, page: c.page, main: '#8c83ff', sub: '#ece9ff' };
      });
    }
    function render() {
      var q = norm(input.value.trim());
      var s = sortSel ? sortSel.value : 'default';
      var list = data().filter(function (c) {
        if (!q) return true;
        return norm(c.zh).indexOf(q) >= 0 || norm(c.ja).indexOf(q) >= 0 ||
               norm(c.en).indexOf(q) >= 0 || norm(c.cv_zh).indexOf(q) >= 0 || norm(c.cv).indexOf(q) >= 0;
      });
      if (s === 'zh') { list = list.slice().sort(function (a, b) { return norm(a.zh).localeCompare(norm(b.zh), 'zh'); }); }
      else if (s === 'en') { list = list.slice().sort(function (a, b) { return norm(a.en).localeCompare(norm(b.en)); }); }
      else if (s === 'cv') { list = list.slice().sort(function (a, b) { return norm(a.cv_zh).localeCompare(norm(b.cv_zh), 'zh'); }); }
      grid.innerHTML = '';
      list.forEach(function (c, i) {
        var url = c.page ? c.page.replace('zh.moegirl.org.cn', 'mobile.moegirl.org.cn')
                         : 'https://mobile.moegirl.org.cn/' + encodeURIComponent(c.zh);
        var li = document.createElement('li');
        var card = document.createElement('a');
        card.className = 'cio-card';
        card.href = url;
        card.target = '_blank';
        card.rel = 'noopener';
        card.addEventListener('click', function (e) {
          e.preventDefault();
          openCharDetailGlobal(c.id);
        });
        card.style.setProperty('--color-main', c.main || '#8c83ff');
        card.style.setProperty('--color-sub', c.sub || '#ece9ff');
        var imageAttrs = i < 4 ? ' loading="eager"' + (i === 0 ? ' fetchpriority="high"' : '') : ' loading="lazy"';
        card.innerHTML =
          '<dl>' +
            '<dt>' +
              (c.img || c.av ? '<div class="cio-img"><img src="' + (c.img || c.av) + '" alt="' + ((c.zh || '').replace(/（[^（）]*）$/, '')) + '"' + imageAttrs + '></div>' : '<div class="cio-img cio-img-empty"><p>暂无图片</p></div>') +
              '<div class="cio-bg"><p>' + (c.en || c.ja || '') + '</p></div>' +
            '</dt>' +
            '<dd>' +
              '<p class="cio-name">' + ((c.zh || '').replace(/（[^（）]*）$/, '')) + '</p>' +
              '<p class="cio-cv"><span>CV:</span>' + (c.cv_zh || c.cv || '') + '</p>' +
            '</dd>' +
          '</dl>' +
          '<div class="cio-veil"><p>View more</p><span class="cio-arrow">&gt;</span></div>';
        li.appendChild(card);
        grid.appendChild(li);
      });
      var nodata = (root || document).querySelector('#cIntroNoData');
      if (nodata) nodata.style.display = list.length ? 'none' : 'block';
      if (listBox) listBox.classList.remove('loading');
    }
    input.addEventListener('input', render);
    if (sortSel) sortSel.addEventListener('change', render);
    render();
  }

  window.renderBloodGraphInDetail = renderBloodGraphInDetail;

  function renderDetail(root) {
    var box = (root || document).querySelector('#cDetailBlock');
    if (!box) return;
    function fill() {
      refreshRelIndex();
      var detail = window.__uma_app ? window.__uma_app.charDetail : null;
      if (!detail || !detail.id || !window.CHAR_DETAIL) return;
      if (box.getAttribute('data-d-filled') === detail.id) return;
      var d = window.CHAR_DETAIL[detail.id];
      if (!d || !d.html) return;
      box.innerHTML = '<div class="mw-parser-output">' + d.html + '</div>';
      box.setAttribute('data-d-filled', detail.id);
      if (d.cv_former_zh) {
        var cvEl = box.querySelector('.uma-cv');
        if (cvEl) {
          var cvP = cvEl.querySelector('p');
          if (cvP) {
            cvP.innerHTML = '<span>CV：</span>' + (window.vaLink || function (x) { return x; })(d.cv_former_zh) + '→' + (window.vaLink || function (x) { return x; })(d.cv_zh || '');
          }
        }
      }
      var rel = relByCid[detail.id];
      if (rel && rel.real) {
        var cvEl = box.querySelector('.uma-cv');
        if (cvEl) {
          var realEl = document.createElement('div');
          realEl.className = 'uma-real';
          realEl.innerHTML = '<p>原型马：' + rel.real + '</p>';
          cvEl.parentNode.insertBefore(realEl, cvEl);
        }
      }
      var vids = UMA_VIDEOS[detail.id];
    if (vids && vids.length) {
      var intro = box.querySelector('.umamusume-intro');
      if (intro) {
        var vEl = document.createElement('div');
        vEl.className = 'uma-videos';
        var btns = '';
        for (var vi = 0; vi < vids.length; vi++) {
          if (vids[vi].bv || vids[vi].url) {
            var vhref = vids[vi].url || ('https://www.bilibili.com/video/' + vids[vi].bv + '/');
            btns += '<a class="uma-video-btn" href="' + vhref + '" target="_blank" rel="noopener">' + vids[vi].n + '</a>';
          } else {
            btns += '<span class="uma-video-btn uma-video-none">' + vids[vi].n + '</span>';
          }
        }
        vEl.innerHTML = '<div class="uma-videos-label">原型马解说</div><div class="uma-videos-btns">' + btns + '</div>';
        intro.appendChild(vEl);
      }
    }
    fill();
  }
    fill();
  }

  /* ---------- 血缘关系节点图（角色详情页下方） ---------- */
  var relByCid = {};
  var relSource = null;
  function refreshRelIndex() {
    if (typeof PED_REL === 'undefined' || relSource === PED_REL) return;
    relByCid = {};
    PED_REL.forEach(function (n) { relByCid[n.cid] = n; });
    relSource = PED_REL;
  }
  var NON_UMA = { otonashietsuko:1, kiryuinaoi:1, anshinzawasasami:1, kashimotoriko:1, satakemei:1, tsurugiryoka:1, hoshinakiyoko:1, akasakamisato:1, hosoejunko:1, spica_trainer:1, narita_trainer:1, teppen_commentator_honizumi:1, teppen_commentator_yamamoto:1 };
  var UMA_VIDEOS = {
  "sakurabakushino": [{"n":"短途领域的爆进之王","bv":"BV12K4y1N78N"}],
  "haruurara": [{"n":"百战百败努力家，不胜传说乌拉拉","bv":"BV1xp4y1t7VS"}],
  "symbolirudolf": [{"n":"我以不败身姿，傲立三冠之列（上）","bv":"BV1264y1m7qa"}, {"n":"七冠荣光退役，归来仍是皇帝（下）","bv":"BV1if4y1s71V"}],
  "oguricap": [{"n":"传说的开始！芦毛怪物诞生！（上）","bv":"BV1BN411o7Nw"}, {"n":"芦毛怪物VS白色闪电！小栗帽三战玉藻十字（中）","bv":"BV1D64y1d7Rv"}, {"n":"平成三强的激斗，芦毛怪物有终之美！（下）","bv":"BV1nh411e7Y4"}],
  "biwahayahide": [{"n":"傲立三强我以晨光之名，头顶青天高举芦毛终旗！","bv":"BV1YV411s7dg"}],
  "mejiromcqueen": [{"n":"芦毛三代连霸G1，天皇赏春目白传说（上）","bv":"BV1gK4y1M7nE"}, {"n":"目白麦昆VS东海帝皇，92年春世纪之战！（下）","bv":"BV1Ro4y1X7pK"}],
  "taikishuttle": [{"n":"漂亮的尾花栗，无败的英里王！（上）","bv":"BV1GU4y1H7uX"}, {"n":"风中疾走的金色闪电，雨下跃动的尾花栗毛！（下）","bv":"BV1Mq4y197Zv"}],
  "inesfujin": [{"n":"20万人的日本德比，燃烧生命的一逃到底！","bv":"BV1JU4y1E7PJ"}],
  "nicenature": [{"n":"有马三着的传说，独一无二的荣耀！","bv":"BV1tA411c79B"}],
  "hishiamazon": [{"n":"狂气追走炸裂末脚！漆黑的女杰菱亚马逊","bv":"BV1b64y1a7uK"}],
  "grasswonder": [{"n":"栗毛怪物再出世，踏雪无痕草上飞（上）","bv":"BV1gU4y1F7E6"}, {"n":"终点前草特交锋，毫厘间决定胜负（下）","bv":"BV1EL4y1q7Xx"}],
  "seiunsky": [{"n":"划过青空的闪电，刻铭心中的逃亡！","bv":"BV1AQ4y1i7Dn"}],
  "riceshower": [{"n":"虽无钢铁不坏躯，却有青岭英雄魂（上）","bv":"BV1hR4y1g7Gk"}, {"n":"跨越了肉体灵魂，疾驰于天堂彼岸（下）","bv":"BV1pT4y1m7z3"}],
  "zennorobroy": [{"n":"秋行王道三冠征途，疾行荒漠善战英雄","bv":"BV1a44y1L7cV"}],
  "fujikiseki": [{"n":"虽承父相终大器未完，无事名驹即富士奇石","bv":"BV1Wr4y1a7Gk"}],
  "goldship": [{"n":"漂移过弯初露怪物锋芒 ，上坡加速尽显英雄本色（上）","bv":"BV1vb4y1s72Y"}, {"n":"黄金战舰开创伟大航路，连霸宝冢再续芦毛传说（中）","bv":"BV1AR4y157op"}, {"n":"三战天春不负麦昆血脉，奋身抬腿力劝马迷戒赌（下）","bv":"BV1DZ4y167Wg"}],
  "supercreek": [{"n":"稚嫩天才邂逅初恋，此般相遇一生几何","bv":"BV16i4y1C7Tb"}],
  "sakuralaurel": [{"n":"力战三冠势破两强，残樱终迎满开之时！","bv":"BV1fu411v7zq"}],
  "kitasanblack": [{"n":"越战越勇终贯彻王道，彻夜高声奏祭典之歌！（上）","bv":"BV19B4y127p5"}, {"n":"满身泥泞斗伏兵强敌，身披七冠展最后英姿（下）","bv":"BV1bT4y1r7Eu"}],
  "vodka": [{"n":"巾帼之身鏖战德比，反叛英姿勇斗强敌（上）","bv":"BV1qG411x7mU"}, {"n":"宿命之敌决战府中，女帝之名响彻东京（下）","bv":"BV1H34y1H768"}],
  "sweeptosho": [{"n":"刁蛮任性大小姐，暴走狂气小魔女","bv":"BV19S4y177jQ"}],
  "nakayamafesta": [{"n":"寥寥一生胜负，漫漫长路追梦","bv":"BV1VB4y187ns"}],
  "silencesuzuka": [{"n":"半生起伏半生跌踉，乘风飞翔向梦的彼方（上）","bv":"BV1oW4y1b7CF"}, {"n":"一生速度一生梦幻，化作天马愿真心永恒（下）","bv":"BV1iV4y1W7vN"}],
  "manhattancafe": [{"n":"不鸣则已，一鸣惊人！","bv":"BV1nG4y1Q74v"}],
  "junglepocket": [{"n":"打开新时代之门","bv":"BV1mz4tzyERT"}],
  "agnestachyon": [{"n":"他仅凭四场比赛便成为了传奇\"幻之三冠马","bv":"BV1ki421X7xq"}],
  "mejiropalmer": [{"n":"跌宕起伏我仍不屈不挠，昂首高歌梦想追逐闪耀","bv":"BV13V4y1N7DB"}],
  "tmoperao": [{"n":"天生耀眼神明为之嫉妒，连战不捷拉开传说序幕（上）","bv":"BV1Tg411i7CS"}, {"n":"创不败传说得万人景仰，奏霸王凯歌令群马俯首（中）","bv":"BV1x24y1a7Gp"}, {"n":"登上山巅直面七冠高墙，唯一无二王朝终将落幕（终）","bv":"BV16k4y1473R"}],
  "mrcb": [{"n":"疾驰，飞驰，腾驰，在温暖的大地（上）","bv":"BV13H4y1o7iP"}, {"n":"丢弃，抛弃，舍弃，那仅剩的尊严（下）","bv":"BV1ke411X7GH"}],
  "tamamocross": [{"n":"那悲哀的胆怯的马儿，早已随着故乡一起死去（上）","bv":"BV1WB421z7Dz"}, {"n":"那勇敢的迅疾的闪电，将最初的梦想不断延续（下）","bv":"BV1pD421j7z8"}],
  "hishimiracle": [{"n":"以奇迹为名，令天地倒转","bv":"BV1Tx421S7E9"}],
  "staygold": [{"n":"褪去昔日旧枷锁，今日方知我是我","bv":"BV1W9FSz8Eut"}],
  "buenavista": [{"n":"名雌辈出，我依旧是正统女主角（上）","bv":"BV1kVZABWEzy"}, {"n":"屡次吃瘪，你仍然集一生所偏爱（下）","bv":"BV1t1AizuE8H"}],
  "mejiroramonu": [{"n":"青鬃踏雪完美小姐驾到，一骑绝尘三冠女王登顶","bv":"BV1sbRbBtE2v"}],
  "twinturbo": [{"n":"除了逃，再无其他活法","bv":"BV1d3VG68EBu"}],
  "mayanotopgun": [{"n":"变幻自在的英里天才少女——摩耶重炮","bv":"BV1AT4y1Y7xd"}],
  "agnesdigital": [{"n":"全能贵公子为何如此变态？——爱丽数码","bv":"BV1yR4y1p7Fz"}],
  "specialweek": [{"n":"特能吃的外交总大将——特别周","bv":"BV1sL4y1e7wN"}],
  "tokaiteio": [{"n":"三度骨折仍复活的奇迹不死鸟——东海帝王","bv":"BV1yq4y1s77y"}],
  "nishinoflower": [{"n":"闪耀的短跑少女——西野花","bv":"BV1K64y1r7fa"}],
  "matikanetannhauser": [{"n":"主角身后的努力家——待兼诗歌剧","bv":"BV1h54y1V79w"}],
  "daiwascarlet": [{"n":"世纪死对头——大和赤骥","bv":"BV1uK4y1N7SX"}],
  "akikawayayoi": [{"n":"理事长也是马娘？北方风味","bv":"BV1d64y1S7Lg"}],
/* 马娘本体故事 by 浠月照耀下的奇迹 */
  "mihonobourbon": [{"n":"凭努力硬刚血统，败于命运的挑战者——美浦波旁","bv":"BV1Hw4m1e7mg"}],
  "casinodrive": [{"n":"CY为何选娱乐场作为远征引路人？","bv":"BV1iVDMBVErK"}],
  "elcondorpasa": [{"n":"非冠即亚的天才！3G1进殿堂——神鹰","bv":"BV1LUZ7BdEdf"}],
  "copanorickey": [{"n":"272倍赔率下取胜的传奇——小林历奇","bv":"BV18hrEBuEws"}],
  "wonderacute": [{"n":"老骥伏枥，志在千里——奇锐骏","bv":"BV1C5BKBDEJV"}],
  "luckylilac": [{"n":"若无杏目，她早已成为传奇——旺紫丁","bv":"BV1RDbpzmEoe"}],
  "admiregroove": [{"n":"传承至未来的名血——爱慕律动","bv":"BV1vUn2zZEnP"}],
  "chronogenesis": [{"n":"首位春秋三连霸母马——创世驹","bv":"BV1rSGAzfEfg"}],
  "lovesonlyyou": [{"n":"发光→低谷→完全闪耀——唯独爱你","bv":"BV1mWLmzKEME"}],
  "granalegria": [{"n":"其名为胜利的欢呼声——放声欢呼","bv":"BV1r9ZBYYEBq"}],
  "fenomeno": [{"n":"并非无端COS承太郎——超常骏骥","bv":"BV1epR4Y5EjJ"}],
  "durandal": [{"n":"以圣剑为名的短英强者——多旺达","bv":"BV1ivAnenE1Y"}],
  "naritabrian": [{"n":"20世纪名马第一位——成田白仁","bv":"BV1cxkmYSEje"}],
  "astonmachan": [{"n":"转瞬即逝的跑车","bv":"BV15N4y1w79e"}],
  "rheinkraft": [{"n":"早逝的变则二冠母马——莱茵力量","bv":"BV1ueC1Y8EvC"}],
  "cesario": [{"n":"来自日本的超级巨星——西沙里奥","bv":"BV1DS2JYPER9"}],
  "daringtact": [{"n":"首位无败三冠母马——谋勇兼备","bv":"BV1oWtxe8Euf"}],
  "neouniverse": [{"n":"神秘宇宙——新宇宙","bv":"BV1EwptedEPb"}],
  "finemotion": [{"n":"与这样的马比赛，她对手太可怜——美妙姿势","bv":"BV1QHWPemEHS"}],
  "dreamjourney": [{"n":"没有他，就没有黄金巨匠和黄金船——梦之旅","bv":"BV1WHY9ePEKE"}],
  "symbolikriss": [{"n":"漆黑的帝王——吉兆","bv":"BV1Eb42177oK"}],
  "daiichiruby": [{"n":"因想成为母亲而退役——第一红宝石","bv":"BV1eS42197aU"}],
  "dantsuflame": [{"n":"电影主角团一员的悲剧原型——烈焰快驹","bv":"BV1wZ421s7Ty"}],
  "noreason": [{"n":"名为莫名其妙的赛马有多莫名其妙？","bv":"BV1Vi421k7jh"}],
  "chevalgrand": [{"n":"5分钟了解高尚骏逸的原型故事","bv":"BV1Lm41127vd"}],
  "vivlos": [{"n":"5分钟了解强击的原型故事","bv":"BV1Vr421V7eS"}],
  "verxina": [{"n":"极峰成为女版怒涛的背后玄机","bv":"BV1P1421U7HW"}],
  "gentildonna": [{"n":"竟有这样的母马——贵妇人","bv":"BV1aD421L763"}],
  "stillinlove": [{"n":"自带病娇属性的爱如往昔","bv":"BV1Gu4m137uE"}],
  "hokkotarumae": [{"n":"能成为城市观光大使的北港火山","bv":"BV1sH4y1E7or"}],
  "smartfalcon": [{"n":"连战连胜反而风评下降——醒目飞鹰","bv":"BV14K411h7bL"}],
  "bamboomemory": [{"n":"初代短距离王者——青竹回忆","bv":"BV1va4y127fM"}],
  "inarione": [{"n":"从地方转中央并青史留名——稻荷一","bv":"BV1Hw41147nz"}],
  "satonocrown": [{"n":"北部玄驹真正的青梅竹马——里见皇冠","bv":"BV1we41197gZ"}],
  "satonodiamond": [{"n":"6分钟了解里见光钻的原型故事","bv":"BV1nC4y1V78Y"}],
  "duramente": [{"n":"未能复活的帝王——大鸣大放","bv":"BV1Ew411X7VU"}],
  "maruzensky": [{"n":"充满遗憾的强者——丸善斯基","bv":"BV1Go4y1P7FG"}],
  "meishodoto": [{"n":"世纪末倒霉蛋——名将怒涛","bv":"BV1mu411W74T"}],
  "naritatoproad": [{"n":"三年未胜G1，得票仍是第一——成田路","bv":"BV13s4y1R7ou"}],
  "currenchan": [{"n":"人爱马敬的闪光少女——真机伶","bv":"BV1NX4y1R7aH"}],
  "airshakur": [{"n":"最惨准三冠马——空中神宫","bv":"BV1eG4y1P7op"}],
  "shinkowindy": [{"n":"咬马是故意的——新光风","bv":"BV1ds4y1h7pQ"}],
  "kawakamiprincess": [{"n":"凶暴又娇贵的实力派——川上公主","bv":"BV1aY411i7UJ"}],
  "ksmiracle": [{"n":"被人为摧毁的奇迹——凯斯奇迹","bv":"BV1xD4y1N7s5"}],
  "tosenjordan": [{"n":"苦心马，天不负——东瀛佐敦","bv":"BV1nG4y1U7RS"}],
  "mejirobright": [{"n":"'庸才'的逆袭——目白光明","bv":"BV1Ky4y1X73x"}],
  "matikanefukukitaru": [{"n":"承兄之福，弥兄之憾——待兼福来","bv":"BV1Y8411w7eg"}],
  "hishiakebono": [{"n":"大体重的奇迹——菱曙","bv":"BV1MM411875C"}],
  "sakurachiyonoo": [{"n":"燃尽一切的奇迹逆转——樱花千代王","bv":"BV12Y41197px"}],
  "mejiroryan": [{"n":"目白赖恩与横山典弘的友情","bv":"BV1kx4y137cM"}],
  "admirevega": [{"n":"燃尽一切，只为不负亡兄——爱慕织姬","bv":"BV1H14y1u7hy"}],
  "katsuragiace": [{"n":"从'废马'到'日本的王牌'——葛城王牌","bv":"BV1pHcJeWEzn"}],
  "foreveryoung": [{"n":"CY家的太子有多强？——青春永驻","bv":"BV1iQPVzfEqA"}],
  "victoirepisa": [{"n":"他的胜利为日本带来了勇气和希望——比萨胜驹","bv":"BV1m2QFBkEgb"}],
  "marchelorraine": [{"n":"人气倒数爆大冷，G1首胜创造历史——洛林军歌","bv":"BV1zdXsBiEct"}],

/* 赛马科普 by 稚九鸟Kyutori */
  "orfevre": [{"n":"黄金巨匠！脑子有问题的超强赛马","bv":"BV1PM411y7Zz"}],
  "winningticket": [{"n":"纪念最近离世的胜利奖券","bv":"BV1sv4y1W7i8"}],
  "almondeye": [{"n":"杏目，9个G1的母马三冠王","bv":"BV1MZ42187ds"}],
  "titleholder": [{"n":"领衔！阪神竞马场的领跑王者","bv":"BV195HpzoE5K"}],
  "venuspaques": [{"n":"卓芙！击碎日本马凯旋门冠军梦","bv":"BV18C4y1L79h"}],
  "darleyarabian": [{"n":"达利阿拉伯 Darley Arabian","bv":"BV1WGfCBgEWK"}],
  "godolphinbarb": [{"n":"高多芬阿拉伯 Godolphin Barb","bv":"BV1trNAzSEcn"}],
  "byerleyturk": [{"n":"拜耶尔土耳其 Byerley Turk","bv":"BV1CcfqBWECy"}],
  "haiseiko": [{"n":"20世纪的名马 第8位 海塞克","bv":"BV1Q7nAzcESe"}],
  "airgroove": [{"n":"20世纪的名马 第9位 气槽","bv":"BV15XfdBhEdC"}],
  "mejirodober": [{"n":"20世纪的名马 第19位 目白多伯","bv":"BV1yEZrBeEar"}],
  "northflight": [{"n":"20世纪的名马 第35位 北方飞翔","bv":"BV1jqcTzNEvv"}],
  "daitakuhelios": [{"n":"20世纪的名马 第73位 大拓太阳神","bv":"BV179PizoE5y"}],
  "phalaenopsis": [{"n":"20世纪的名马 第85位 蝴蝶兰","bv":"BV18s8B6vEU9"}],
  "hayakawatazuna": [{"n":"20世纪的名马 第44位 丰收时刻","bv":"BV1x44y1H7CJ"}],
  "rigantona": [{"n":"名马传说--Dancing Brave 勇舞者","bv":"BV1E4JCzpEaY"}],
  "sononelfie": [{"n":"原型马解说 暂无视频"}],
  "saintlite": [{"n":"三冠马之路—圣烈特 ","bv":"BV1iS4y1c7WM"}],
  "speedsymboli": [{"n":"时代的先驱，日本速度的象征！","bv":"BV1fJPueREut"}],
  "bochuzoku": [{"n":"【世界の名马】望族(モンジュー Moutjeu)","bv":"BV1ZMt563Ezj"}],
  "yukinobijin": [{"n":"雪之美人 专属特殊胜利实况","bv":"BV1614y1e78m"}],
  "marveloussunday": [{"n":"瑰丽的强者灵魂！美丽周日原型介绍！","bv":"BV1gPy5YCEeB"}],
  "yamaninzephyr": [{"n":"傲人的飓风 也文攝輝","bv":"BV1Vm4y1w7c8"}],
  "siriussymboli": [{"n":"远征海外的先驱！-天狼星象征原型","bv":"BV1XhUZYmE2z"}],
  "tapdancecity": [{"n":"继续与时间赛跑吧！-跳舞城原型介绍","bv":"BV1GPXVYAEUd"}],
  "bikopegasus": [{"n":"与命运抗争的小小英雄—微光飞驹原型介绍","bv":"BV1GhMcz8Egb"}],
  "ikunodictus": [{"n":"不屈的铁娘子—生野狄杜斯原型介绍","bv":"BV1V7grzEEYz"}],
  "transcend": [{"n":"短暂制霸泥地的新星~创升原型介绍","bv":"BV1XPuBziEvg"}],
  "soundsofearth": [{"n":"最强坠机王万老二是也～万籁争鸣原型介绍","bv":"BV1XZY4zPEzq"}],
  "yaenomuteki": [{"n":"光辉与热忱并存的战士～八重无敌原型介绍","bv":"BV1X7anzVEvU"}],
  "eishinflash": [{"n":"一匹在日本土生土长的德国马～荣进闪耀原型介绍","bv":"BV1jFSjBwETr"}],
  "calstonelighto": [{"n":"学院里来了只傲娇猫娘～金镇之光原型介绍","bv":"BV1yDyuBLEEN"}],
  "airmessiah": [{"n":"璀璨短暂的名门之后～空中救世主原型介绍","bv":"BV18zwXzWEWx"}],
  "naritataishin": [{"n":"努力证明不被看好的自己～成田大进原型介绍","bv":"BV1qLNczfEiP"}],
  "bubblegumfellow": [{"n":"看我如何两面包夹芝士～吹波糖原型介绍","bv":"BV1oxcvzLEbD"}],
  "winvariation": [{"n":"舞动吧，草地上的奥杰塔～凯旋芭蕾原型介绍","bv":"BV1PTDvBAEqd"}],
  "tsurumarutsuyoshi": [{"n":"好像斯佩酱也不是我的对手~鹤丸刚志原型介绍","bv":"BV1spEj6TEgS"}],
  "furioso": [{"n":"泥地出了个奖项收集者~狂怒乐章原型介绍","bv":"BV17t5969EQA"}],
  "kinghalo": [{"n":"我这一生如履薄冰～帝王光辉原型介绍","bv":"BV1sYJ9zFEQa"}],
  "goldcity": [{"n":"百年难遇的梦幻美马！10分钟带你了解历史上的黄金城（ゴールドシチー）！","bv":"BV1fb4y1Z7QT"}],
  "seekingthepearl": [{"n":"【赛马娘角色介绍＃8】采珠","bv":"BV1QpXYYDEW3"}],
  "mejiroardan": [{"n":"被时代遮蔽的强者【目白阿尔丹】不屈的中国媳妇","bv":"BV1Vr4y1r7Yr"}],
  "espoircity": [{"n":"【赛马娘】希望之城 专属特殊胜利实况","bv":"BV1BdpgzNEin"}],
  "taninogimlet": [{"n":"将胜利的美酒传递给爱女——谷水琴蕾","bv":"BV1ubvRBREmX"}],
  "believe": [{"n":"【赛马娘】信念 专属特殊胜利实况","bv":"BV17tW3zTEaz"}],
  "samsonbig": [{"n":"下落不明史实马系列 大森逊传说","bv":"BV1eNbzzWExo"}],
  "royceandroyce": [{"n":"【赛马娘】莱斯莱斯 专属特殊胜利实况","bv":"BV1ksKf6QEQb"}],
  "daringheart": [{"n":"后冠之梦跨越时空——勇敢之心人物志","bv":"BV1M7yKB3EdP"}],
  "fusaichipandora": [{"n":"【赛马娘】火神 专属特殊胜利实况","bv":"BV1uLbDzjEBg"}],
  "genuine": [{"n":"20世纪的名马 第55位 真诚 ジェニュイン","bv":"BV1G1thzcEr9"}],
  "sakurachitoseo": [{"n":"【20世纪の名胜负】1995年 天皇赏·秋——樱花千岁王","bv":"BV1NA411U7RS"}],
  "blastonepiece": [{"n":"Blast onepiece 防爆装束 @Hooskey","bv":"BV19s3B6fEKE"}],
  "currenbouquetdor": [{"n":"机伶金花：最强2胜马传奇","bv":"BV1gg4y1b7U5"}],
  "reddesire": [{"n":"【赛马娘】红色梦想 专属特殊胜利实况","bv":"BV1tgLU6RELw"}],
  "kiseki": [{"n":"【赛马娘】神业 特殊实况合集","bv":"BV1Joz7B1E53"}],
  "epiphaneia": [{"n":"21世纪的名马 神威启示","bv":"BV19U4y1q7mE"}],
  "logotype": [{"n":"21世纪的名马 标志名驹","bv":"BV1cv411W7vq"}],
  "rosekingdom": [{"n":"2010.11.28 日本杯　玫瑰帝国","bv":"BV1P44y1s77p"}],
  "rulership": [{"n":"【赛马娘】统治地位 专属特殊胜利实况","bv":"BV1qpgR6GE4p"}],
  "efforia": [{"n":"21世纪的名马 乐透心","bv":"BV1k84y1K7yW"}],
  "lighthello": [{"n":"原型马解说 暂无视频"}],
  "zankan_koukou": [{"n":"原型马解说 暂无视频"}],
};

  var relCtrl = { scale: 1, tx: 0, ty: 0, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 };
  var SLOTW = 132, NODEH = 150, VGAP = 120, PAD = 60;

  function ancTag(r, i) {
    if (r === 0) return i === 0 ? '父' : '母';
    if (r === 1) {
      if (i === 0) return '祖父';
      if (i === 1) return '祖母';
      if (i === 2) return '母父';
      return '母母';
    }
    return '曾祖·' + (i % 2 === 0 ? '父系' : '母系');
  }

  function renderBloodGraphInDetail(box, root) {
    if (!box) return;
    refreshRelIndex();
    if (NON_UMA[root]) {
      var note = document.createElement('div');
      note.className = 'c-blood c-blood-pure';
      note.innerHTML = '<div class="c-blood-head"><h3 class="c-blood-title">血缘关系图</h3></div>' +
        '<p class="c-blood-pure-note">该角色非赛马娘，无现实原型，不提供血缘关系图。</p>';
      box.appendChild(note);
      return;
    }
    if (typeof PED_REL === 'undefined' || !relByCid[root]) return;
    if (relByCid[root].pure) {
      var note = document.createElement('div');
      note.className = 'c-blood c-blood-pure';
      var nonUmaMsg = NON_UMA[root] ? '该角色非赛马娘，无现实原型，不提供血缘关系图。' : '该角色为纯原创赛马娘，无现实原型，不提供血缘关系图。';
      note.innerHTML = '<div class="c-blood-head"><h3 class="c-blood-title">血缘关系图</h3></div>' +
        '<p class="c-blood-pure-note">' + nonUmaMsg + '</p>';
      box.appendChild(note);
      return;
    }
    var sec = document.createElement('div');
    sec.className = 'c-blood';
    sec.innerHTML =
      '<div class="c-blood-head">' +
        '<h3 class="c-blood-title">血缘关系图<small>上溯3代 · 下延2代 · 点击节点跳转</small></h3>' +
        '<div class="c-blood-tools">' +
          '<input class="c-blood-search" placeholder="搜索马娘并跳转…" autocomplete="off">' +
          '<span class="c-blood-zoom"><button type="button" data-zoom="in">＋</button><button type="button" data-zoom="out">－</button></span>' +
        '</div>' +
      '</div>' +
      '<p class="c-blood-status"></p>' +
      '<div class="c-blood-wrap"><div class="c-blood-stage"></div></div>';
    box.appendChild(sec);

    var wrap = sec.querySelector('.c-blood-wrap');
    var stage = sec.querySelector('.c-blood-stage');
    var statusEl = sec.querySelector('.c-blood-status');
    var searchEl = sec.querySelector('.c-blood-search');

    var ctrl = { scale: 1, tx: 0, ty: 0, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    ctrl.apply = function () {
      stage.style.transform = 'translate(' + ctrl.tx + 'px,' + ctrl.ty + 'px) scale(' + ctrl.scale + ')';
    };
    ctrl.fit = function () {
      var w = wrap.clientWidth || 600, h = wrap.clientHeight || 480;
      var iw = stage.offsetWidth, ih = stage.offsetHeight;
      if (!iw) return;
      ctrl.scale = Math.min(1, Math.min(w / iw, h / ih));
      ctrl.fitScale = ctrl.scale;
      ctrl.tx = (w - iw * ctrl.scale) / 2;
      ctrl.ty = (h - ih * ctrl.scale) / 2;
      ctrl.apply();
    };

    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      ctrl.scale = Math.max(0.05, Math.min(4, ctrl.scale * (e.deltaY < 0 ? 1.15 : 0.87)));
      ctrl.apply();
    }, { passive: false });
    wrap.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('.rel-node')) return;
      ctrl.dragging = true; ctrl.sx = e.clientX; ctrl.sy = e.clientY; ctrl.ox = ctrl.tx; ctrl.oy = ctrl.ty;
    });
    window.addEventListener('mousemove', function (e) {
      if (!ctrl.dragging) return;
      ctrl.tx = ctrl.ox + (e.clientX - ctrl.sx); ctrl.ty = ctrl.oy + (e.clientY - ctrl.sy);
      ctrl.apply();
    });
    window.addEventListener('mouseup', function () { ctrl.dragging = false; });
    var pinchDist = null, pinchScale = 1;
    function touchDist(e) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    wrap.addEventListener('touchstart', function (e) {
      if (e.target.closest && e.target.closest('.rel-node')) return;
      if (e.touches.length === 1) {
        ctrl.dragging = true; ctrl.sx = e.touches[0].clientX; ctrl.sy = e.touches[0].clientY; ctrl.ox = ctrl.tx; ctrl.oy = ctrl.ty;
      } else if (e.touches.length === 2) {
        ctrl.dragging = false;
        pinchDist = touchDist(e); pinchScale = ctrl.scale;
      }
    }, { passive: false });
    wrap.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1 && ctrl.dragging) {
        if (ctrl.scale > (ctrl.fitScale || 1)) {
          e.preventDefault();
          ctrl.tx = ctrl.ox + (e.touches[0].clientX - ctrl.sx);
          ctrl.ty = ctrl.oy + (e.touches[0].clientY - ctrl.sy);
          ctrl.apply();
        }
      } else if (e.touches.length === 2 && pinchDist) {
        e.preventDefault();
        var d = touchDist(e);
        ctrl.scale = Math.max(0.05, Math.min(4, pinchScale * (d / pinchDist)));
        ctrl.apply();
      }
    }, { passive: false });
    wrap.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) pinchDist = null;
      if (e.touches.length === 0) ctrl.dragging = false;
    });
    sec.querySelector('[data-zoom=in]').addEventListener('click', function () {
      ctrl.scale = Math.min(4, ctrl.scale * 1.2); ctrl.apply();
    });
    sec.querySelector('[data-zoom=out]').addEventListener('click', function () {
      ctrl.scale = Math.max(0.05, ctrl.scale / 1.2); ctrl.apply();
    });

    function selectRel(cid) {
      if (cid === root) return;
      if (window.__uma_app && typeof window.__uma_app.openCharDetail === 'function') {
        window.__uma_app.openCharDetail(cid);
      }
    }

    function draw() {
      stage.innerHTML = '';
      var SV = 'http://www.w3.org/2000/svg';
      var rootNode = relByCid[root];
      var up = rootNode.up || [[], [], []];
      var originX = PAD + 4 * SLOTW;
      var pos = {}, edges = [];

      var maxG = 0;
      for (var gi = 0; gi < up.length; gi++) {
        var row = up[gi];
        var has = false;
        if (row) for (var z = 0; z < row.length; z++) if (row[z]) { has = true; break; }
        if (!has) break;
        maxG = gi + 1;
      }
      maxG = Math.min(3, maxG);

      var rootX = originX, rootY = PAD + maxG * (NODEH + VGAP);
      var rootKey = 'root';
      pos[rootKey] = { x: rootX, y: rootY, tag: '', cid: root };

      for (var r = 0; r < maxG; r++) {
        var rowUp = up[r];
        var y = rootY - (r + 1) * (NODEH + VGAP);
        var n = Math.pow(2, r + 1);
        for (var i = 0; i < n; i++) {
          var cid = rowUp[i];
          if (!cid || !relByCid[cid]) continue;
          var x = originX + (i + 0.5 - Math.pow(2, r)) * SLOTW;
          var key = r + '_' + i;
          pos[key] = { x: x, y: y, tag: ancTag(r, i), cid: cid };
          if (r === 0) {
            edges.push({ x1: x, y1: y + NODEH / 2, x2: rootX, y2: rootY - NODEH / 2, color: '#b9a8d6' });
          } else {
            var childKey = (r - 1) + '_' + Math.floor(i / 2);
            if (pos[childKey]) {
              edges.push({ x1: x, y1: y + NODEH / 2, x2: pos[childKey].x, y2: pos[childKey].y - NODEH / 2, color: '#b9a8d6' });
            }
          }
        }
      }

      var children = (rootNode.children || []).filter(function (c) { return relByCid[c]; });
      var grand = (rootNode.grandchildren || []).filter(function (c) {
        if (!relByCid[c]) return false;
        var p = relByCid[c].up[0] || [];
        return (p[0] && children.indexOf(p[0]) >= 0) || (p[1] && children.indexOf(p[1]) >= 0);
      });
      if (children.length) {
        for (var cIdx = 0; cIdx < children.length; cIdx++) {
          var cx = originX + (cIdx + 0.5 - children.length / 2) * SLOTW;
          var cy2 = rootY + NODEH + VGAP;
          var cKey = 'child_' + cIdx;
          pos[cKey] = { x: cx, y: cy2, tag: '子女', cid: children[cIdx] };
          edges.push({ x1: rootX, y1: rootY + NODEH / 2, x2: cx, y2: cy2 - 30, color: '#4a7ac7' });
        }
      }
      if (grand.length) {
        var byChild = {};
        grand.forEach(function (gc) {
          var p = (relByCid[gc].up[0] || []);
          var parentC = p[0] && children.indexOf(p[0]) >= 0 ? p[0] : (p[1] && children.indexOf(p[1]) >= 0 ? p[1] : root);
          (byChild[parentC] = byChild[parentC] || []).push(gc);
        });
        Object.keys(byChild).forEach(function (parentC) {
          var list = byChild[parentC];
          var px2 = rootX, py2 = rootY;
          Object.keys(pos).forEach(function (k) { if (pos[k].cid === parentC) { px2 = pos[k].x; py2 = pos[k].y; } });
          var nn = list.length;
          for (var k = 0; k < nn; k++) {
            var gx = px2 + (k + 0.5 - nn / 2) * SLOTW;
            var gy = rootY + 2 * (NODEH + VGAP);
            var gcKey = 'grand_' + parentC + '_' + k;
            pos[gcKey] = { x: gx, y: gy, tag: '孙辈', cid: list[k] };
            edges.push({
              x1: px2, y1: py2 + NODEH / 2,
              x2: gx, y2: gy - 30, color: '#d9577c'
            });
          }
        });
      }

      var maxX = 0, maxY = 0;
      function nodeEl(key) {
        var p = pos[key];
        if (!p) return;
        var id = p.cid;
        var nd = relByCid[id];
        var el = document.createElement('div');
        var plain = !nd.av;
        el.className = 'rel-node' + (id === root ? ' rel-root' : '') + (plain ? ' rel-plain' : '');
        if (!plain) {
          var av = nd.av;
          if (av && av.indexOf('/') === -1 && av.indexOf('data:') !== 0) av = '/' + av;
          if (av && av.indexOf('uma_avatars') === 0) av = '/' + av;
          el.innerHTML = '<span class="tag"></span><img class="av" src="' + av + '" alt="" loading="lazy"><div class="nm">' + (nd.real || nd.zh || id) + '</div>';
          el.addEventListener('click', function () { selectRel(id); });
        } else {
          el.innerHTML = '<span class="tag"></span><span class="av">原</span><div class="nm">' + (nd.real || nd.zh || id) + '</div>';
        }
        el.style.left = (p.x - SLOTW / 2 + 28) + 'px';
        el.style.top = (p.y - 30) + 'px';
        var tagEl = el.querySelector('.tag');
        tagEl.textContent = p.tag || '';
        tagEl.className = 'tag' + (p.tag === '母父' || p.tag === '母母' || p.tag === '子女' || p.tag === '孙辈' ? ' m-g' : '');
        if (!p.tag) tagEl.style.display = 'none';
        stage.appendChild(el);
        maxX = Math.max(maxX, p.x + SLOTW / 2);
        maxY = Math.max(maxY, p.y + NODEH / 2);
      }
      Object.keys(pos).forEach(nodeEl);

      var stageW = Math.max(1200, maxX + PAD * 2);
      var stageH = maxY + PAD;
      stage.style.width = stageW + 'px';
      stage.style.height = stageH + 'px';
      var svg = document.createElementNS(SV, 'svg');
      svg.setAttribute('width', stageW);
      svg.setAttribute('height', stageH);
      svg.style.cssText = 'position:absolute;left:0;top:0;width:' + stageW + 'px;height:' + stageH + 'px;overflow:visible';
      edges.forEach(function (e) {
        var line = document.createElementNS(SV, 'line');
        line.setAttribute('x1', e.x1); line.setAttribute('y1', e.y1);
        line.setAttribute('x2', e.x2); line.setAttribute('y2', e.y2);
        line.setAttribute('class', 'rel-edge');
        line.setAttribute('stroke', e.color);
        svg.appendChild(line);
      });
      stage.appendChild(svg);

      var cnt = Object.keys(pos).length;
      statusEl.textContent = '原型马名：' + (rootNode.real || rootNode.zh || root) + ' · 上溯 ' + maxG + ' 代 / 下延 2 代 · 共 ' + cnt + ' 个节点（空心为现实原型马名）';
      ctrl.scale = 1; ctrl.tx = 0; ctrl.ty = 0;
      requestAnimationFrame(ctrl.fit);
    }
    draw();

    searchEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = (this.value || '').trim().toLowerCase();
      if (!q) return;
      for (var i = 0; i < PED_REL.length; i++) {
        var n = PED_REL[i];
        if (n.av && n.zh && n.zh.toLowerCase().indexOf(q) >= 0) { selectRel(n.cid); return; }
      }
    });
  }

  function openCharDetailGlobal(id) {
    if (window.__uma_app && typeof window.__uma_app.openCharDetail === 'function') {
      window.__uma_app.openCharDetail(id);
    }
  }

  function roomDist(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function closeRoomLightbox(ov) {
    if (ov) { ov.style.display = 'none'; var im = ov.querySelector('img'); if (im) { im.style.transform = ''; } }
  }
  function initRoomPinch(ov) {
    if (ov.getAttribute('data-pinch')) return;
    ov.setAttribute('data-pinch', '1');
    var img = ov.querySelector('img');
    var st = { scale: 1, tx: 0, ty: 0 };
    ov._roomSt = st;
    var ges = null, multi = false, suppress = false;
    function apply() {
      if (st.scale > 1.01) img.classList.add('zoomed');
      else img.classList.remove('zoomed');
      img.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.scale + ')';
    }
    ov.addEventListener('touchstart', function (e) {
      if (e.touches.length >= 2) {
        multi = true;
        e.preventDefault();
      }
      if (e.touches.length === 2) {
        ges = { type: 'pinch', d: roomDist(e.touches[0], e.touches[1]), s: st.scale, tx: st.tx, ty: st.ty, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      } else if (e.touches.length === 1 && !multi) {
        ges = { type: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY, tx: st.tx, ty: st.ty };
      }
    }, { passive: false });
    ov.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && ges && ges.type === 'pinch') {
        e.preventDefault(); suppress = true;
        var d = roomDist(e.touches[0], e.touches[1]);
        if (d > 0) {
          var ns = Math.max(1, Math.min(6, ges.s * d / ges.d));
          var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          var nx = (ges.cx - ges.tx) / ges.s, ny = (ges.cy - ges.ty) / ges.s;
          st.scale = ns;
          st.tx = cx - nx * ns; st.ty = cy - ny * ns;
          apply();
        }
      } else if (e.touches.length === 1 && ges && ges.type === 'pan') {
        e.preventDefault(); suppress = true;
        var dx = e.touches[0].clientX - ges.x, dy = e.touches[0].clientY - ges.y;
        st.tx = ges.tx + dx; st.ty = ges.ty + dy;
        apply();
      }
    }, { passive: false });
    ov.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) multi = false;
      if (e.touches.length === 0) ges = null;
    }, { passive: true });
    ov.addEventListener('click', function (e) {
      if (suppress) { suppress = false; e.preventDefault(); e.stopPropagation(); return; }
      closeRoomLightbox(ov);
    });
    ov.addEventListener('dblclick', function () {
      st.scale = 1; st.tx = 0; st.ty = 0; apply();
    });
    ov.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = ov.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var ns = Math.max(1, Math.min(6, st.scale * factor));
      if (ns === st.scale) return;
      var nx = (mx - st.tx) / st.scale, ny = (my - st.ty) / st.scale;
      st.scale = ns;
      st.tx = mx - nx * ns; st.ty = my - ny * ns;
      apply();
    }, { passive: false });
  }
  function openRoomLightbox(src) {
    var ov = document.getElementById('c-lightbox');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'c-lightbox';
      ov.className = 'c-lightbox';
      ov.innerHTML = '<img src="" alt="宿舍室友图大图">';
      document.body.appendChild(ov);
    }
    initRoomPinch(ov);
    if (ov._roomSt) { ov._roomSt.scale = 1; ov._roomSt.tx = 0; ov._roomSt.ty = 0; }
    var im = ov.querySelector('img');
    im.src = src;
    im.style.transform = '';
    ov.style.display = 'flex';
  }

  function initRoom(root) {
    var img = (root || document).querySelector('.c-room-img');
    if (!img || img.getAttribute('data-room-inited')) return;
    img.setAttribute('data-room-inited', '1');
    img.addEventListener('click', function () { openRoomLightbox(img.getAttribute('src') || img.src); });
  }

  function initCharTab() {
    var tab = document.getElementById('tab-characters');
    if (!tab) return;
    renderIntro(tab);
    renderDetail(tab);
    initZoom(tab);
    initRoom(tab);
  }

  /* ---------- 声优库列表 ---------- */
  function renderVoiceList(root) {
    var grid = (root || document).querySelector('#vaGrid');
    var input = (root || document).querySelector('#vaSearch');
    if (!grid || !input || grid.getAttribute('data-va-inited')) return;
    grid.setAttribute('data-va-inited', '1');
    function norm(v) { return String(v || '').toLowerCase(); }
    function data() {
      var src = (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : [];
      var map = new Map();
      var charByZh = {};
      src.forEach(function (c) { if (c.zh) charByZh[c.zh] = c.id; });
      src.forEach(function (c) {
        var key = c.cv_zh || c.cv;
        if (!key) return;
        if (!map.has(key)) map.set(key, { key: key, slug: encodeURIComponent(key), zh: c.cv_zh || '', ja: c.cv || key, roles: [] });
        map.get(key).roles.push({ id: c.id, zh: c.role_zh || c.zh, main: c.main || '#8c83ff' });
        if (c.cv_former) {
          var fk = c.cv_former;
          if (!map.has(fk)) map.set(fk, { key: fk, slug: encodeURIComponent(fk), zh: c.cv_former || fk, ja: c.cv_former_ja || fk, roles: [] });
          map.get(fk).roles.push({ id: c.id, zh: c.zh, orig: true, main: c.main || '#8c83ff' });
        }
      });
      // 合并 voice_list.xlsx 中未收录于 CHAR_INDEX 的声优（如训练员 / 解说等）
      var extra = window.VA_LIST || [];
      extra.forEach(function (v) {
        var zh = (v.zh || '').trim(), ja = (v.ja || '').trim();
        if (!zh && !ja) return;
        if (map.has(zh) || (ja && map.has(ja))) return;
        var roles = [];
        if (v.role && v.role.trim()) roles.push({ zh: v.role.trim(), id: charByZh[v.role.trim()] || '', main: '#8c83ff' });
        map.set(zh || ja, { key: zh || ja, slug: encodeURIComponent(zh || ja), zh: zh || ja, ja: ja || zh, roles: roles });
      });
      return Array.from(map.values());
    }
    function render() {
      var q = norm(input.value.trim());
      var list = data().filter(function (v) {
        if (!q) return true;
        if (norm(v.zh).indexOf(q) >= 0 || norm(v.ja).indexOf(q) >= 0) return true;
        for (var i = 0; i < v.roles.length; i++) {
          if (norm(v.roles[i].zh).indexOf(q) >= 0) return true;
        }
        return false;
      });
      grid.innerHTML = '';
      list.forEach(function (v, i) {
        var li = document.createElement('li');
        var card = document.createElement('a');
        card.className = 'va-card';
        card.href = '/zh-Hans/database/voice-actors/' + v.slug;
        card.style.setProperty('--color-main', v.roles[0] && v.roles[0].main ? v.roles[0].main : '#8c83ff');
        var ph = window.VA_PHOTOS && window.VA_PHOTOS[v.key];
        var imageAttrs = i < 4 ? ' loading="eager"' + (i === 0 ? ' fetchpriority="high"' : '') : ' loading="lazy"';
        var imgHtml = ph
          ? '<img class="va-card-img" src="' + ph.img + '" alt="' + v.zh + '"' + imageAttrs + '>'
          : '<span class="va-ph-fb">' + (v.zh || v.ja || '?').charAt(0) + '</span>';
          card.innerHTML =
          imgHtml +
          '<span class="va-card-txt">' +
            '<p class="va-name">' + v.zh + '</p>' +
            '<p class="va-kana">' + v.ja + '</p>' +
            '<p class="va-roles' + (v.roles.length === 1 ? ' va-roles--single' : '') + '"><b>as</b>' + v.roles.map(function (r) { return r.orig ? r.zh + '<i class="va-orig">原</i>' : r.zh; }).join(' / ') + '</p>' +
          '</span>';
        card.addEventListener('click', function (e) {
          e.preventDefault();
          if (window.__uma_app && typeof window.__uma_app.openVa === 'function') window.__uma_app.openVa(v.slug);
        });
        li.appendChild(card);
        grid.appendChild(li);
      });
      var nodata = (root || document).querySelector('#vaNoData');
      if (nodata) nodata.style.display = list.length ? 'none' : 'block';
    }
    input.addEventListener('input', render);
    render();
  }

  function initVoiceTab() {
    var tab = document.getElementById('tab-db-voice');
    if (!tab) return;
    renderVoiceList(tab);
  }

  function openSongFromDb(album, song) {
    var app = window.__uma_app;
    if (!app) return;
    try {
      if (song && song.name) app.search = song.name;
      app.activeTab = 'songs';
      app.openAlbum(album, song);
      app.albumReturnView = 'dbsongs';
    } catch (e) {
      try {
        if (album && album.name) {
          app.activeTab = 'songs';
          app.albumDetail = { data: album, songs: album.songs || [], shown: (album.songs || []).length, total: (album.songs || []).length, query: (song && song.name) || '', targetName: (song && song.name) || null, note: '' };
          app.albumReturnView = 'dbsongs';
          if (typeof app.pushUrl === 'function') app.pushUrl();
        }
      } catch (_) {}
    }
  }

  function renderSongs(root) {
    var tab = root || document.getElementById('tab-db-songs');
    if (!tab) return;
    var tbody = tab.querySelector('#songRows');
    if (!tbody) return;
    var search = tab.querySelector('#songSearch');
    var nd = tab.querySelector('#songNoData');
    var pager = tab.querySelector('#songPager');
    var PAGE = 30;
    if (!window.__songsPage || window.__songsPage < 1) window.__songsPage = 1;

    function buildPageList(cur, total) {
      var list = [];
      if (total <= 7) { for (var i = 1; i <= total; i++) list.push(i); return list; }
      list.push(1);
      var s = Math.max(2, cur - 2);
      var e = Math.min(total - 1, cur + 2);
      if (s > 2) list.push('…');
      for (var j = s; j <= e; j++) list.push(j);
      if (e < total - 1) list.push('…');
      list.push(total);
      return list;
    }

    function renderPager(total) {
      if (!pager) return;
      var pages = Math.max(1, Math.ceil(total / PAGE));
      if (pages <= 1) { pager.innerHTML = ''; pager.style.display = 'none'; return; }
      pager.style.display = 'flex';
      var page = window.__songsPage;
      var startIdx = (page - 1) * PAGE + 1;
      var endIdx = Math.min(total, page * PAGE);
      var html = '<div class="news-pager-count">显示 ' + startIdx + '-' + endIdx + ' 共 ' + total + ' 条</div>';
      html += '<div class="news-pager-btns">';
      html += '<button type="button" class="news-pager-btn" ' + (page <= 1 ? 'disabled' : '') + ' data-pg="prev">«</button>';
      html += '<button type="button" class="news-pager-btn" ' + (page <= 1 ? 'disabled' : '') + ' data-pg="prev">‹</button>';
      buildPageList(page, pages).forEach(function (p) {
        if (p === '…') html += '<button type="button" class="news-pager-ellipsis" disabled>…</button>';
        else html += '<button type="button" class="news-pager-btn' + (p === page ? ' active' : '') + '" data-pg="' + p + '">' + p + '</button>';
      });
      html += '<button type="button" class="news-pager-btn" ' + (page >= pages ? 'disabled' : '') + ' data-pg="next">›</button>';
      html += '<button type="button" class="news-pager-btn" ' + (page >= pages ? 'disabled' : '') + ' data-pg="last">»</button>';
      html += '</div>';
      pager.innerHTML = html;
      Array.prototype.forEach.call(pager.querySelectorAll('.news-pager-btn:not([disabled])'), function (b) {
        b.addEventListener('click', function () {
          var d = b.getAttribute('data-pg');
          var pg = page;
          if (d === 'prev') pg = page - 1;
          else if (d === 'next') pg = page + 1;
          else if (d === 'last') pg = pages;
          else pg = parseInt(d, 10);
          if (isNaN(pg) || pg < 1 || pg > pages) return;
          window.__songsPage = pg;
          draw(search && search.value ? search.value : '', pg);
          if (window.__uma_app && typeof window.__uma_app.pushUrl === 'function') window.__uma_app.pushUrl();
          window.scrollTo(0, 0);
        });
      });
    }

    function draw(filter, page) {
      page = page || window.__songsPage || 1;
      window.__songsPage = page;
      tbody.innerHTML = '';
      var rows = window.__songsRows || [];
      if (filter) {
        var f = filter.toLowerCase();
        rows = rows.filter(function (r) {
          return (r.s.name || '').toLowerCase().indexOf(f) >= 0 || (r.s.artist || '').toLowerCase().indexOf(f) >= 0 || (r.al.name || '').toLowerCase().indexOf(f) >= 0;
        });
      }
      renderPager(rows.length);
      if (nd) nd.style.display = rows.length ? 'none' : 'block';
      if (!rows.length) return;
      var pages = Math.ceil(rows.length / PAGE);
      if (page > pages) page = pages;
      window.__songsPage = page;
      var slice = rows.slice((page - 1) * PAGE, page * PAGE);
      slice.forEach(function (r) {
        var tr = document.createElement('tr');
        tr.className = 'song-row';
        tr.innerHTML =
          '<td class="col-name"><img class="song-thumb" src="' + (window.umaCoverThumb ? window.umaCoverThumb(r.s.pic || r.al.cover || '', 96) : (r.s.pic || r.al.cover || '')) + '" alt="" loading="lazy"><span class="song-name">' + (r.s.name || '') + '</span></td>' +
          '<td class="col-date">' + (r.al.release || '') + '</td>' +
          '<td class="col-album">' + (r.al.name || '') + '</td>';
        tr.addEventListener('click', function () { openSongFromDb(r.al, r.s); });
        tbody.appendChild(tr);
      });
    }

    if (window.__songsRows) {
      draw(search && search.value ? search.value : '', window.__songsPage);
    } else {
      var useAlbums = function (albums) {
        var rows = [];
        (albums || []).slice().sort(function (a, b) { return (b.release || '').localeCompare(a.release || ''); }).forEach(function (al) {
          (al.songs || []).forEach(function (s, i) { rows.push({ s: s, al: al, i: i }); });
        });
        window.__songsRows = rows;
        draw(search && search.value ? search.value : '', window.__songsPage);
      };
      var showLoadError = function () {
        if (nd) { nd.textContent = '无法加载专辑数据（请确认服务器提供 /albums.json）'; nd.style.display = 'block'; }
        if (pager) { pager.innerHTML = ''; pager.style.display = 'none'; }
      };
      var app = window.__uma_app;
      if (app && typeof app.loadAlbums === 'function') {
        app.loadAlbums().then(function () {
          if (app.albumsError) throw new Error(app.albumsError);
          useAlbums(app.albums);
        }).catch(showLoadError);
      } else {
        fetch('/albums.json', { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(useAlbums)
          .catch(showLoadError);
      }
    }
    if (search && !search._wired) { search._wired = true; search.addEventListener('input', function () { window.__songsPage = 1; draw(search.value, 1); }); }
  }

  function initSongsTab() {
    var tab = document.getElementById('tab-db-songs');
    if (!tab || tab._rendered) return;
    tab._rendered = true;
    renderSongs(tab);
  }

var mo = new MutationObserver(function () { initCharTab(); initVoiceTab(); initSongsTab(); });
mo.observe(document.body, { childList: true, subtree: true });
initCharTab();
initVoiceTab();
initSongsTab();
})();
