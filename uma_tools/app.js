
const ALBUMS = [];
let ALBUMS_LOADED = false;

const { createApp, ref, reactive, computed, watch } = Vue;

let uiSelectSequence = 0;
const UiSelect = {
  props: {
    modelValue: { type: [String, Number], default: '' },
    options: { type: Array, default: function () { return []; } },
    label: { type: String, default: '' },
    ariaLabel: { type: String, default: '' }
  },
  emits: ['update:modelValue', 'change'],
  data: function () {
    uiSelectSequence += 1;
    return { open: false, activeIndex: -1, listId: 'ui-select-' + uiSelectSequence };
  },
  computed: {
    selectedOption: function () {
      const value = String(this.modelValue);
      return this.options.find(function (option) { return String(option.value) === value; }) || this.options[0] || { label: '' };
    }
  },
  mounted: function () { document.addEventListener('pointerdown', this.onOutside); },
  beforeUnmount: function () { document.removeEventListener('pointerdown', this.onOutside); },
  methods: {
    onOutside: function (event) {
      if (this.open && !this.$el.contains(event.target)) this.close();
    },
    close: function () { this.open = false; this.activeIndex = -1; },
    toggle: function () {
      this.open = !this.open;
      this.activeIndex = this.open ? Math.max(0, this.options.findIndex(function (option) { return String(option.value) === String(this.modelValue); }, this)) : -1;
    },
    choose: function (option) {
      if (!option || option.disabled) return;
      this.$emit('update:modelValue', option.value);
      this.$emit('change', option.value);
      this.close();
      this.$nextTick(() => {
        if (this.$refs.trigger) this.$refs.trigger.focus();
      });
    },
    onKeydown: function (event) {
      if (event.key === 'Escape') { this.close(); return; }
      if (event.key === 'Tab') { this.close(); return; }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!this.open) this.toggle();
        else this.choose(this.options[this.activeIndex]);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      if (!this.open) this.open = true;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const total = this.options.length;
      if (!total) return;
      let next = this.activeIndex < 0 ? 0 : this.activeIndex;
      do { next = (next + direction + total) % total; } while (this.options[next] && this.options[next].disabled);
      this.activeIndex = next;
    }
  },
  template: `
    <div class="ui-select-control" :class="{open:open}">
      <span v-if="label" class="ui-select-label">{{ label }}</span>
      <button ref="trigger" class="ui-select-trigger" type="button" :aria-label="ariaLabel || label" :aria-expanded="open" :aria-controls="listId" @click="toggle" @keydown="onKeydown">
        <span>{{ selectedOption.label }}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
      </button>
      <div v-show="open" :id="listId" class="ui-select-menu" role="listbox">
        <button v-for="(option,index) in options" :key="String(option.value)" type="button" role="option" :disabled="option.disabled" :aria-selected="String(option.value)===String(modelValue)" :class="{selected:String(option.value)===String(modelValue),active:index===activeIndex}" @pointerenter="activeIndex=index" @click="choose(option)">
          <span>{{ option.label }}</span><svg v-if="String(option.value)===String(modelValue)" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>
        </button>
      </div>
    </div>`
};

const umaApp = createApp({
  setup() {
    function routeSegments() {
      const seg = window.location.pathname.split('/').filter(Boolean);
      if (seg.length && seg[0].toLowerCase() === 'zh-hans') seg.shift();
      return seg;
    }
    const initialSegments = routeSegments();
    const initialFirst = (initialSegments[0] || '').toLowerCase();
    const initialDatabaseSection = initialFirst === 'database' ? (initialSegments[1] || '').toLowerCase() : '';
    const initialMusicSection = initialFirst === 'music' ? (initialSegments[1] || '').toLowerCase() : '';
    const initialDatabaseView = ['artist', 'songs'].indexOf(initialFirst) >= 0 || initialMusicSection === 'songs' ? 'songs' :
      (initialMusicSection === 'albums' ? 'albums' :
      (initialFirst === 'characters' ? 'characters' : ({
        characters: 'characters',
        voice: 'voice',
        'voice-actors': 'voice',
        albums: 'albums',
        songs: 'songs',
        other: 'other'
      }[initialDatabaseSection] || 'characters')));
    const initialTab = initialFirst === 'events' || initialFirst === 'live' ? 'live' :
      (['characters', 'database', 'music', 'artist', 'songs', ''].indexOf(initialFirst) >= 0 ? 'database' : initialFirst);
    const audio = ref(null);
    const albums = ref([]);
    const albumsError = ref('');
    const activeTab = ref(initialTab);
    const home = ref(initialSegments.length === 0);
    const routeReady = ref(home.value || initialFirst === 'news');
    const openNavGroup = ref('');
    const navigationRevision = ref(0);
    const backTopVisible = ref(false);
    let pendingEntitySource = false;
    function syncBodyBackground(isHome) {
      document.body.classList.toggle('subpage-bg', !isHome);
    }
    syncBodyBackground(home.value);
    watch(home, syncBodyBackground);
    const albumDetail = ref(null);
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
    const newsDefaultCover = '/uma_tools/img/news-card-default.webp';
    const liveView = ref('eventHub');
    const dataScriptPromises = {};
    let newsLoadPromise = null;
    let albumsLoadPromise = null;
    let eventsLoadPromise = null;
    let songCatalogLoadPromise = null;
    let relationshipLoadPromise = null;
    let homeSummaryLoadPromise = null;
    const eventsAll = ref([]);
    const eventSeries = ref([]);
    const eventDetail = ref(null);
    const selectedEventSessionId = ref('');
    const songCatalog = ref({ coverage: {}, songs: [] });
    const songCatalogError = ref('');
    const songDetail = ref(null);
    const songSection = ref('releases');
    const songDbQuery = ref('');
    const songDbPage = ref(1);
    const songDbPerPage = 30;
    const appearanceIndex = ref({ voice_actors: {}, characters: {} });
    const voiceProfiles = ref([]);
    const homeStats = reactive({ songs: null, albums: null, live: null, performances: null, characters: null, voiceActors: null, events: null });
    const homeNextEvent = ref(null);
    const eventsError = ref('');
    const eventsLoading = ref(false);
    const eventsQuery = ref('');
    const evTime = ref('all');
    const evKind = ref('all');
    const evMode = ref('all');
    const evYear = ref('all');
    const evSeries = ref('all');
    const eventsPage = ref(1);
    const eventsPerPage = 20;
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
    const charDetail = ref(null);
    const charSort = ref('default');
    const dbView = ref(initialDatabaseView);
    const voiceDetail = ref(null);
    const charSection = ref('profile');
    const voiceSection = ref('profile');
    const otherSection = ref('relationships');
    const expandedRelationSongId = ref('');
    const curatedVideos = [
      { id: 'BV1N83n6YEyT', title: '“笨蛋，我一直都认可你啊！”' },
      { id: 'BV1sRw2ezEXZ', title: '我以世纪大逃 换你奇迹复活' },
      { id: 'BV1jF411B7sw', title: '无败的陨落，奇迹的复活「T.E.I.O」' },
      { id: 'BV1J5411Q7Do', title: '场上的嘘声对于“反派”的她却是最好的勋章' },
      { id: 'BV1Az4y1c7NU', title: '三匹三冠马的对决：特殊的时代' },
      { id: 'BV1Q1HUzaE6H', title: 'Never give up' },
      { id: 'BV1FH4y1z78L', title: '不是所有的马都是卡莲酱的，池添' },
      { id: 'BV1vz4y1Y7M3', title: '船哥与121亿日元' },
      { id: 'BV1PyfDBaEUE', title: '1993 有马纪念：他们都说我赢不了' },
      { id: 'BV12G411r72u', title: '曾风光无限的目白牧场为何解散？' },
      { id: 'BV1WY411Y7o5', title: '一匹赛马能为已逝的人类母亲做什么？' },
      { id: 'BV1zA411L7YT', title: '一代芦毛马传奇：小栗帽' },
      { id: 'BV1znUwB4ELs', title: '后来，那个时代被称为黄金时代' },
      { id: 'BV1kSLdznEGS', title: '你强任你强，我有三冠王' },
      { id: 'BV1dt4y1o7x1', title: '这就是男子汉的谢幕之际' }
    ];
    const voiceHistoryQuery = ref('');
    const voiceHistoryKind = ref('all');
    const charHistoryQuery = ref('');
    const charHistoryKind = ref('all');
    const charAppearance = computed(function () {
      const id = charDetail.value && charDetail.value.id;
      return (id && appearanceIndex.value.characters && appearanceIndex.value.characters[id]) || { events: [], songs: [] };
    });
    const charHistoryEvents = computed(function () {
      const query = String(charHistoryQuery.value || '').trim().toLowerCase();
      return (charAppearance.value.events || []).filter(function (event) {
        if (charHistoryKind.value !== 'all' && event.kind !== charHistoryKind.value) return false;
        return !query || String(event.title || '').toLowerCase().indexOf(query) !== -1 || String(event.date || '').indexOf(query) !== -1;
      });
    });
    const relFilter = ref('');
    const relYear = ref('');
    const relQuery = ref('');
    const relWork = ref('');
    const relSort = ref('newest');
    const relWorkList = [
      { key: 's1', label: '动画 Season 1' }, { key: 's2', label: '动画 Season 2' },
      { key: 's3', label: '动画 Season 3' }, { key: 'rttp', label: 'ROAD TO THE TOP' },
      { key: 'movie', label: '新時代の扉' }, { key: 'cinderella', label: '芦毛灰姑娘' },
      { key: 'yon', label: '赛马娘四格' }, { key: 'yuru', label: '摇曳马娘' },
      { key: 'starting-gate', label: 'STARTING GATE' }, { key: 'winning-live', label: 'WINNING LIVE' },
      { key: 'solo-vocal', label: 'Solo Vocal Tracks' }
    ];
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
      return loadDataScript('/data/character_index_data.js?v=20260904', 'CHAR_INDEX');
    }
    function loadCharacterDetailData() {
      return Promise.all([
        loadCharacterIndexData(),
        loadDataScript('/data/character_detail_data.js?v=20260910-4', 'CHAR_DETAIL'),
        loadDataScript('/data/pedigree_data.js?v=20260911-8', 'PED_REL'),
        loadRelationshipData()
      ]);
    }
    function loadVoiceData() {
      return loadRelationshipData();
    }
    function loadRelationshipData() {
      if (relationshipLoadPromise) return relationshipLoadPromise;
      relationshipLoadPromise = Promise.all([
        fetch('/data/voice_actor_profiles.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
        fetch('/data/appearance_index.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      ]).then(function (rows) {
        voiceProfiles.value = (rows[0] && rows[0].voice_actors) || [];
        appearanceIndex.value = rows[1] || { voice_actors: {}, characters: {} };
      }).catch(function () {
        relationshipLoadPromise = null;
        voiceProfiles.value = [];
        appearanceIndex.value = { voice_actors: {}, characters: {} };
      });
      return relationshipLoadPromise;
    }
    function loadSongCatalog() {
      if (songCatalogLoadPromise) return songCatalogLoadPromise;
      songCatalogError.value = '';
      songCatalogLoadPromise = fetch('/data/song_catalog.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          songCatalog.value = data && Array.isArray(data.songs) ? data : { coverage: {}, songs: [] };
          if (!songCatalog.value.songs.length) songCatalogError.value = '歌曲资料为空。';
        })
        .catch(function () {
          songCatalogLoadPromise = null;
          songCatalog.value = { coverage: {}, songs: [] };
          songCatalogError.value = '无法加载歌曲资料（请确认 /data/song_catalog.json 已生成）。';
        });
      return songCatalogLoadPromise;
    }
    function loadMusicRelations() {
      return Promise.all([loadRelationshipData(), loadSongCatalog(), loadAlbums()]);
    }
    function prepareCurrentRoute() {
      const seg = routeSegments();
      if (!seg.length) return Promise.resolve();
      const first = (seg[0] || '').toLowerCase();
      if (first === 'news') {
        const newsReady = loadNews();
        return seg.length > 1 ? newsReady : Promise.resolve();
      }
      if (first === 'music' || first === 'artist' || first === 'songs') return Promise.all([loadAlbums(), loadSongCatalog(), loadVoiceData()]);
      if (first === 'live') return Promise.all([loadEvents(), loadRelationshipData(), loadSongCatalog(), loadCharacterIndexData()]);
      if (first === 'characters') {
        const sub = (seg[1] || '').toLowerCase();
        const characterReady = sub && sub !== 'intro' && sub !== 'room' && sub !== 'videos' ? loadCharacterDetailData() : loadCharacterIndexData();
        return sub && sub !== 'intro' && sub !== 'room' && sub !== 'videos'
          ? Promise.all([characterReady, loadMusicRelations()])
          : Promise.all([characterReady, loadHomeSummary()]);
      }
      if (first === 'events') return Promise.all([loadEvents(), loadRelationshipData(), loadSongCatalog(), loadCharacterIndexData()]);
      if (first !== 'database') return Promise.resolve();
      const sub = (seg[1] || '').toLowerCase();
      if (!sub) return Promise.all([loadCharacterIndexData(), loadHomeSummary()]);
      if (sub === 'albums') return Promise.all([loadAlbums(), loadSongCatalog(), loadVoiceData()]);
      if (sub === 'songs') return Promise.all([loadAlbums(), loadSongCatalog(), loadVoiceData()]);
      if (sub === 'events') return Promise.all([loadEvents(), loadRelationshipData()]);
      if (sub === 'voice' || sub === 'voice-actors') {
        return seg[2] ? loadMusicRelations() : Promise.all([loadVoiceData(), loadHomeSummary()]);
      }
      if (sub === 'characters') {
        const charPath = (seg[2] || '').toLowerCase();
        const characterReady = charPath && charPath !== 'intro' && charPath !== 'room' && charPath !== 'videos'
          ? loadCharacterDetailData() : loadCharacterIndexData();
        return charPath && charPath !== 'intro' && charPath !== 'room' && charPath !== 'videos'
          ? Promise.all([characterReady, loadMusicRelations()])
          : Promise.all([characterReady, loadHomeSummary()]);
      }
      if (sub === 'other') return loadHomeSummary();
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
          homeSummaryLoadPromise = null;
          return null;
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

    const navItems = [
      { key: 'news', label: '新闻', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>', path: '/zh-Hans/news' },
      { key: 'music', label: '音乐', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12M9 10l10-2"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>', children: [
        { key: 'songs', label: '歌曲', path: '/zh-Hans/music/songs' },
        { key: 'albums', label: '专辑', path: '/zh-Hans/music/albums' }
      ] },
      { key: 'live', label: '活动', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></svg>', path: '/zh-Hans/events' },
      { key: 'database', label: '资料库', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>', children: [
        { key: 'characters', label: '角色', path: '/zh-Hans/database/characters' },
        { key: 'voice', label: '声优', path: '/zh-Hans/database/voice-actors' },
        { key: 'other', label: '其他', path: '/zh-Hans/database/other' }
      ] },
      { key: 'links', label: '友链', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 15 6-6M7.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/></svg>', path: '/zh-Hans/links' }
    ];

    const historyKindOptions = [
      { value: 'all', label: '全部类型' },
      { value: 'concert', label: '音乐演出' },
      { value: 'onsite', label: '线下活动' },
      { value: 'official_program', label: '官方节目' }
    ];
    const characterSortOptions = [
      { value: 'default', label: '默认顺序' },
      { value: 'zh', label: '按中文名' },
      { value: 'en', label: '按英文名' },
      { value: 'cv', label: '按声优' }
    ];
    const albumSortOptions = [
      { value: 'newest', label: '按发售时间' },
      { value: 'name', label: '按名称' }
    ];
    const fixTitleOptions = [
      { value: '', label: '选择条目类型…' },
      { value: '角色', label: '角色' },
      { value: '声优', label: '声优' },
      { value: '乐曲', label: '乐曲' },
      { value: '演出/LIVE', label: '演出 / LIVE' },
      { value: '新闻', label: '新闻' },
      { value: '发售/商品', label: '发售 / 商品' },
      { value: '会场', label: '会场' },
      { value: '其他', label: '其他' }
    ];

    // 资料订正表单状态
    const fix = reactive({ page: '', kind: '', title: '', body: '', src: '', contact: '', agree: false });
    const fixDone = ref(false);
    const fixSendState = ref('');
    function submitFix() {
      if (!fix.page || !fix.body || !fix.agree || fixSendState.value === 'sending') return;
      fixSendState.value = 'sending';
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
        if (!r.ok) throw new Error('HTTP ' + r.status);
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
      songDetail.value = null;
      newsDetail.value = null;
      eventDetail.value = null;
      liveView.value = 'eventHub';
      dbView.value = 'index';
      charDetail.value = null; voiceDetail.value = null;
      resetPageScroll();
      pushUrl();
    }
    function goContributeContact() {
      home.value = false;
      activeTab.value = 'contribute-contact';
      albumDetail.value = null;
      songDetail.value = null;
      newsDetail.value = null;
      liveView.value = 'eventHub';
      dbView.value = 'index';
      charDetail.value = null; voiceDetail.value = null;
      resetPageScroll();
      pushUrl();
    }
    function goLegal(page) {
      home.value = false;
      activeTab.value = page === 'privacy' ? 'legal-privacy' : 'legal-terms';
      albumDetail.value = null;
      songDetail.value = null;
      newsDetail.value = null;
      liveView.value = 'eventHub';
      dbView.value = 'index';
      charDetail.value = null; voiceDetail.value = null;
      resetPageScroll();
      pushUrl();
    }

    function navItemActive(key) {
      if (key === 'music') return activeTab.value === 'database' && (dbView.value === 'songs' || dbView.value === 'albums');
      if (key === 'database') return activeTab.value === 'database' && ['characters', 'voice', 'other'].indexOf(dbView.value) >= 0;
      return activeTab.value === key;
    }
    function toggleNavGroup(key) {
      openNavGroup.value = openNavGroup.value === key ? '' : key;
    }
    function closeNavGroup() { openNavGroup.value = ''; }
    function updateBackTop() { backTopVisible.value = window.scrollY > 680; }
    function backToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    function navNavigate(path) {
      closeNavGroup();
      navigateTo(path);
    }
    function isAtomicView() {
      return !!(newsDetail.value || eventDetail.value || albumDetail.value || songDetail.value || charDetail.value || voiceDetail.value);
    }
    function clearEntityDetails(except) {
      if (except !== 'news') {
        newsDetail.value = null;
        newsDetailBody.value = '';
      }
      if (except !== 'event') {
        eventDetail.value = null;
        selectedEventSessionId.value = '';
        liveView.value = 'eventHub';
      }
      if (except !== 'album') albumDetail.value = null;
      if (except !== 'song') songDetail.value = null;
      if (except !== 'character') charDetail.value = null;
      if (except !== 'voice') voiceDetail.value = null;
    }
    function routeWillBeAtomic(path) {
      const clean = String(path || '').split('?')[0].replace(/^\/zh-Hans/i, '');
      return /^\/(?:news|events)\/[^/]+$/.test(clean) ||
        /^\/music\/(?:songs|albums)\/[^/]+$/.test(clean) ||
        /^\/database\/(?:characters|voice-actors)\/[^/]+$/.test(clean);
    }
    function beginEntityNavigation() { pendingEntitySource = isAtomicView(); }
    function resetPageScroll() {
      window.scrollTo(0, 0);
      Vue.nextTick(function () {
        window.requestAnimationFrame(function () { window.scrollTo(0, 0); });
      });
    }
    function navigateTo(path, replace) {
      const method = replace ? 'replaceState' : 'pushState';
      const fromEntity = isAtomicView() && routeWillBeAtomic(path);
      routeReady.value = /^\/zh-Hans\/news\/?(?:\?.*)?$/.test(path);
      if (currentUrlPath() !== path) history[method]({ umaInternal: true, entity: routeWillBeAtomic(path), fromEntity: fromEntity }, '', path);
      const ready = prepareCurrentRoute();
      Promise.resolve(ready).then(function () {
        syncFromUrl();
        routeReady.value = true;
        navigationRevision.value += 1;
      }, function () {
        syncFromUrl();
        routeReady.value = true;
        navigationRevision.value += 1;
      });
      resetPageScroll();
    }
    const showContextBack = computed(function () {
      navigationRevision.value;
      return isAtomicView() && !!(history.state && history.state.fromEntity);
    });
    function contextBack() { history.back(); }
    const breadcrumbItems = computed(function () {
      if (!isAtomicView()) return [];
      const items = [{ label: '首页', path: LANG_PREFIX }];
      if (newsDetail.value) return items.concat([{ label: '新闻', path: LANG_PREFIX + '/news' }, { label: newsTitle(newsDetail.value) }]);
      if (eventDetail.value) return items.concat([{ label: '活动', path: LANG_PREFIX + '/events' }, { label: eventDetail.value.title }]);
      if (albumDetail.value) return items.concat([{ label: '音乐' }, { label: '专辑', path: LANG_PREFIX + '/music/albums' }, { label: albumDetail.value.data.name }]);
      if (songDetail.value) return items.concat([{ label: '音乐' }, { label: '歌曲', path: LANG_PREFIX + '/music/songs' }, { label: songDetail.value.title }]);
      if (charDetail.value) return items.concat([{ label: '资料库' }, { label: '角色', path: LANG_PREFIX + '/database/characters' }, { label: charDetail.value.zh }]);
      if (voiceDetail.value) return items.concat([{ label: '资料库' }, { label: '声优', path: LANG_PREFIX + '/database/voice-actors' }, { label: voiceDetail.value.zh }]);
      return [];
    });
    function setCharSection(section) {
      if (['profile', 'pedigree', 'songs', 'appearances'].indexOf(section) === -1) return;
      charSection.value = section;
      pushUrl(true);
      if (section === 'pedigree') Vue.nextTick(renderCharBlood);
    }
    function setVoiceSection(section) {
      if (['profile', 'songs', 'appearances'].indexOf(section) === -1) return;
      voiceSection.value = section;
      pushUrl(true);
    }
    function setSongSection(section) {
      if (['releases', 'performances'].indexOf(section) === -1) return;
      songSection.value = section;
      pushUrl(true);
    }
    function setOtherSection(section) {
      if (section !== 'relationships' && section !== 'videos') return;
      otherSection.value = section;
      pushUrl();
    }
    function openCharacter(id) {
      beginEntityNavigation();
      const show = function () {
        const found = findCharById(id);
        if (!found) return;
        clearEntityDetails('character');
        activeTab.value = 'database';
        dbView.value = 'characters';
        charDetail.value = found;
        charSection.value = 'profile';
        resetPageScroll();
        pushUrl();
        Vue.nextTick(function () {
          if (typeof renderDetail === 'function') renderDetail(null);
        });
      };
      return Promise.all([loadCharacterDetailData(), loadMusicRelations()]).then(show, show);
    }
    function openCharDetail(id) {
      return openCharacter(id);
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
      clearEntityDetails();
      activeTab.value = 'database';
      dbView.value = 'songs';
      resetPageScroll();
      loadHomeSummaryIfNeeded();
      pushUrl();
    }
    function vaSlugOf(name) {
      return encodeURIComponent(String(name || ''));
    }
    function voiceProfileForName(name) {
      var target = String(name || '').replace(/[\s　]/g, '').replace(/髙/g, '高');
      if (!target) return null;
      for (var i = 0; i < voiceProfiles.value.length; i++) {
        var profile = voiceProfiles.value[i];
        var identity = profile.identity || {};
        var names = [identity.zh, identity.ja].concat(identity.aliases || []);
        if (names.some(function (item) { return String(item || '').replace(/[\s　]/g, '').replace(/髙/g, '高') === target; })) return profile;
      }
      return null;
    }
    window.voiceProfileForName = voiceProfileForName;
    window.vaLink = function (name) {
      var n = String(name || '');
      if (!n) return n;
      var profile = voiceProfileForName(n);
      if (profile) return '<a href="' + LANG_PREFIX + '/database/voice-actors/' + encodeURIComponent(profile.id) + '">' + n + '</a>';
      return n;
    };
    function vaList() {
      if (voiceProfiles.value.length) {
        return voiceProfiles.value.map(function (profile) {
          const identity = profile.identity || {};
          const details = profile.profile || {};
          const photo = profile.photo || {};
          return {
            id: profile.id,
            slug: profile.slug || profile.id,
            zh: identity.zh || identity.ja || '',
            ja: identity.ja || identity.zh || '',
            kana: identity.kana || '',
            aliases: identity.aliases || [],
            roles: (profile.roles || []).slice(0, 1).map(function (role) {
              return { id: role.character_id || '', zh: role.name || '', ja: role.name_ja || '', en: '', img: role.image || '', main: role.color_main || '', sub: role.color_sub || '', orig: !!role.former };
            }),
            photo: photo.url || '',
            credit: photo.source_url ? { page: photo.source_url, title: photo.source_title || '图片来源', src: 'reference' } : null,
            birth: details.birthday || '',
            birthplace: details.birthplace || '',
            agency: details.agency || '',
            officialProfile: details.official_profile || '',
            social: details.social || [],
            fieldStatus: details.field_status || {},
            profileSources: details.sources || [],
            profileStatus: details.status || 'partial',
            stats: profile.stats || { events: 0, concerts: 0, programs: 0, songs: 0 }
          };
        });
      }
      return [];
    }
    function findVaBySlug(slug) {
      var target = String(slug || '');
      if (!target) return null;
      var list = vaList();
      for (var i = 0; i < list.length; i++) { if (list[i].slug === target || list[i].id === target) return list[i]; }
      try {
        var dec = decodeURIComponent(target);
        for (var j = 0; j < list.length; j++) { if (list[j].slug === vaSlugOf(dec)) return list[j]; }
        for (var k = 0; k < list.length; k++) { if (list[k].zh === dec || list[k].ja === dec) return list[k]; }
      } catch (e) {}
      return null;
    }
    const voiceAppearance = computed(function () {
      const id = voiceDetail.value && voiceDetail.value.id;
      return (id && appearanceIndex.value.voice_actors && appearanceIndex.value.voice_actors[id]) || { events: [], songs: [] };
    });
    const voicePastByYear = computed(function () {
      const groups = [];
      const map = {};
      voiceAppearance.value.events.forEach(function (event) {
        if (voiceHistoryKind.value !== 'all' && event.kind !== voiceHistoryKind.value) return;
        const query = String(voiceHistoryQuery.value || '').trim().toLowerCase();
        if (query && String(event.title || '').toLowerCase().indexOf(query) === -1 && String(event.date || '').indexOf(query) === -1) return;
        const year = (event.date || '日期待补').slice(0, 4);
        if (!map[year]) { map[year] = { year: year, events: [] }; groups.push(map[year]); }
        map[year].events.push(event);
      });
      return groups;
    });
    function openVoice(actorId) {
      beginEntityNavigation();
      const show = function () {
        const found = findVaBySlug(actorId);
        if (!found) return;
        clearEntityDetails('voice');
        activeTab.value = 'database';
        dbView.value = 'voice';
        voiceDetail.value = found;
        voiceSection.value = 'profile';
        resetPageScroll();
        pushUrl();
      };
      return loadMusicRelations().then(show, show);
    }
    function openVa(slug) {
      return openVoice(slug);
    }
    function openVoiceByName(name) {
      const profile = voiceProfileForName(name);
      if (profile) return openVoice(profile.id);
    }
    function openCharFromVoice(id) {
      return openCharacter(id);
    }
    const songAliasMap = computed(function () {
      const map = {};
      (songCatalog.value.songs || []).forEach(function (song) {
        [song.title].concat(song.aliases || []).forEach(function (title) {
          const key = String(title || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
          if (key) map[key] = song;
        });
      });
      return map;
    });
    function findSong(songOrId) {
      const target = typeof songOrId === 'string' ? songOrId : (songOrId && (songOrId.id || songOrId.song_id));
      if (!target) return null;
      const direct = (songCatalog.value.songs || []).find(function (song) { return song.id === target; });
      if (direct) return direct;
      const key = String(target).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
      return songAliasMap.value[key] || null;
    }
    const songDbFiltered = computed(function () {
      const query = String(songDbQuery.value || '').trim().toLowerCase();
      let rows = (songCatalog.value.songs || []).filter(function (song) {
        if (!query) return true;
        const releaseText = (song.versions || []).reduce(function (out, version) {
          return out.concat((version.releases || []).map(function (release) { return release.album_name; }));
        }, []).join(' ');
        return [song.title, (song.aliases || []).join(' '), (song.artists || []).join(' '), releaseText]
          .join(' ').toLowerCase().indexOf(query) !== -1;
      });
      rows = rows.slice().sort(function (a, b) {
        return a.title.localeCompare(b.title, 'ja');
      });
      return rows;
    });
    const songDbPageCount = computed(function () { return Math.max(1, Math.ceil(songDbFiltered.value.length / songDbPerPage)); });
    const songDbPaged = computed(function () {
      const start = (songDbPage.value - 1) * songDbPerPage;
      return songDbFiltered.value.slice(start, start + songDbPerPage);
    });
    const songDbPageStart = computed(function () { return songDbFiltered.value.length ? (songDbPage.value - 1) * songDbPerPage + 1 : 0; });
    const songDbPageEnd = computed(function () { return Math.min(songDbPage.value * songDbPerPage, songDbFiltered.value.length); });
    const songDbPageList = computed(function () { return pagerList(songDbPage.value, songDbPageCount.value); });
    function setSongDbPage(page) {
      if (page === '…') return;
      const next = parseInt(page, 10);
      if (isNaN(next) || next < 1 || next > songDbPageCount.value) return;
      songDbPage.value = next;
      pushUrl();
      const top = document.getElementById('songArchiveTop');
      if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function goSongDbPage(delta) { setSongDbPage(songDbPage.value + delta); }
    watch(function () { return songDbQuery.value; }, function () { songDbPage.value = 1; });
    const songDetailReleases = computed(function () {
      if (!songDetail.value) return [];
      const rows = [];
      (songDetail.value.versions || []).forEach(function (version) {
        (version.releases || []).forEach(function (release) { rows.push({ version: version, release: release }); });
      });
      return rows.sort(function (a, b) { return String(b.release.release_date).localeCompare(String(a.release.release_date)); });
    });
    const songDetailPerformances = computed(function () {
      if (!songDetail.value) return [];
      const rows = [];
      (songDetail.value.versions || []).forEach(function (version) {
        (version.performances || []).forEach(function (performance) { rows.push({ version: version, performance: performance }); });
      });
      return rows.sort(function (a, b) {
        return String(b.performance.session_date || b.performance.event_date).localeCompare(String(a.performance.session_date || a.performance.event_date));
      });
    });
    function playableSongRelease(song) {
      for (const version of ((song && song.versions) || [])) {
        for (const release of (version.releases || [])) {
          if (release.audio_url) return { version: version, release: release };
        }
      }
      return null;
    }
    function playCatalogSong(song, event) {
      if (event && event.stopPropagation) event.stopPropagation();
      const row = playableSongRelease(song);
      if (!row) return;
      playSong(row.release.audio_url, song.title, row.release.artist || songSingerLabel(song), row.release.cover || song.cover);
    }
    function playSongRelease(row, event) {
      if (event && event.stopPropagation) event.stopPropagation();
      if (!row || !row.release || !row.release.audio_url) return;
      playSong(row.release.audio_url, row.version.title, row.release.artist || songSingerLabel(songDetail.value), row.release.cover || songDetail.value.cover);
    }
    function relationSong(reference) { return findSong(reference && (reference.song_id || reference.name)); }
    function relationSongVersions(reference, entityType, entityId) {
      const song = relationSong(reference);
      if (!song) return [];
      const allowed = new Set((reference && reference.version_ids) || []);
      return (song.versions || []).filter(function (version) {
        return !allowed.size || allowed.has(version.id);
      }).map(function (version) {
        const releases = (version.releases || []).filter(function (release) {
          return (release.vocalists || []).some(function (vocalist) {
            return entityType === 'character'
              ? vocalist.character_id === entityId
              : vocalist.voice_actor_id === entityId;
          });
        });
        return { id: version.id, title: version.title, version_label: version.version_label, releases: releases };
      }).filter(function (version) { return version.releases.length; });
    }
    function relationReleaseVocalists(release, entityType, entityId) {
      return (release && release.vocalists || []).filter(function (vocalist) {
        return entityType === 'character' ? vocalist.character_id === entityId : vocalist.voice_actor_id === entityId;
      });
    }
    function toggleRelationSong(songId) {
      expandedRelationSongId.value = expandedRelationSongId.value === songId ? '' : songId;
    }
    function playRelationRelease(song, version, release, event) {
      if (event && event.stopPropagation) event.stopPropagation();
      if (!release || !release.audio_url) return;
      playSong(release.audio_url, version.title || song.title, release.artist || songSingerLabel(song), release.cover || song.cover);
    }
    function songSingerLabel(song) {
      const names = ((song && song.voice_actor_ids) || []).map(function (actorId) {
        const voice = findVaBySlug(actorId);
        return voice && voice.zh;
      }).filter(Boolean);
      if (names.length) return names.join(' / ');
      const credits = Array.from(new Set((song && song.artists) || [])).filter(Boolean);
      return credits.length ? credits.join(' / ') : '—';
    }
    function openSong(songOrId) {
      beginEntityNavigation();
      const show = function () {
        const found = findSong(songOrId);
        if (!found) return;
        clearEntityDetails('song');
        songDetail.value = found;
        songSection.value = 'releases';
        activeTab.value = 'database';
        dbView.value = 'songs';
        resetPageScroll();
        pushUrl();
      };
      return Promise.all([loadSongCatalog(), loadVoiceData()]).then(show, show);
    }
    function openAlbumFromSong(item) {
      const release = item && item.release ? item.release : item;
      const album = albums.value.find(function (entry) { return entry.name === release.album_name; });
      if (!album) return;
      openAlbum(album);
    }
    function openEventUrl(path) {
      if (path) navigateTo(path);
    }
    function characterName(characterId) {
      const character = findCharById(characterId);
      return character ? character.zh : characterId;
    }
    function characterImage(characterId) {
      const character = findCharById(characterId);
      return character ? character.img : '';
    }
    function characterColor(characterId) {
      const character = findCharById(characterId);
      return character ? character.main : '#ff8c1a';
    }
    function voiceName(actorId, fallback) {
      const voice = findVaBySlug(actorId);
      return (voice && voice.zh) || fallback || actorId || '—';
    }
    function voicePaletteStyle(voice) {
      const role = voice && voice.roles && voice.roles[0];
      return { '--entity-accent': (role && role.main) || '#315FC2', '--entity-sub': (role && role.sub) || '#FF8C1A' };
    }
    function voicePhoto(actorId) {
      const voice = findVaBySlug(actorId);
      return voice ? voice.photo : '';
    }
    function voicePhotoByName(name) {
      const profile = voiceProfileForName(name);
      return profile && profile.photo ? profile.photo.url : '';
    }
    function albumTrackVocalists(track, trackIndex) {
      const album = albumDetail.value && albumDetail.value.data;
      const song = findSong(track && track.name);
      if (!album || !song) return [];
      const number = Number(trackIndex) + 1;
      for (const version of (song.versions || [])) {
        for (const release of (version.releases || [])) {
          if (release.album_name !== album.name || Number(release.track_number) !== number) continue;
          return (release.vocalists || []).map(function (vocalist) {
            const voice = findVaBySlug(vocalist.voice_actor_id);
            return {
              voice_actor_id: vocalist.voice_actor_id,
              name: voiceName(vocalist.voice_actor_id, vocalist.voice_actor_name),
              image: (voice && voice.photo) || '',
              color: vocalist.character && vocalist.character.color_main
            };
          });
        }
      }
      return [];
    }
    function albumName(a) { return a.name; }
    // ---- client-side routing (history mode) ----
    function findCharById(id) {
      if (!id) return null;
      var arr = (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : [];
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
    function findCharByDisplayName(name) {
      var target = String(name || '').replace(/\s+/g, '').toLowerCase();
      if (!target) return null;
      var arr = (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : [];
      for (var i = 0; i < arr.length; i++) {
        var candidate = arr[i];
        var names = [candidate.zh, candidate.ja, candidate.name, candidate.en];
        if (names.some(function (value) { return String(value || '').replace(/\s+/g, '').toLowerCase() === target; })) {
          return findCharById(candidate.id);
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
    const LANG_PREFIX = '/zh-Hans';
    function currentUrlPath() {
      return window.location.pathname + window.location.search;
    }
    function pushUrl(replace) {
      let path = '/';
      if (!home.value) {
        if (activeTab.value === 'news') {
          if (newsDetail.value) {
            path = LANG_PREFIX + '/news/' + newsDetail.value.announce_id;
          } else {
            path = LANG_PREFIX + '/news';
            if (newsPage.value > 1) path += '?page=' + newsPage.value;
          }
        } else if (activeTab.value === 'live') {
          if (liveView.value === 'eventDetail' && eventDetail.value) {
            path = LANG_PREFIX + '/events/' + encodeURIComponent(eventDetail.value.id);
            if (selectedEventSessionId.value) path += '?session=' + encodeURIComponent(selectedEventSessionId.value);
          } else {
            path = LANG_PREFIX + '/events';
            const params = [];
            if (eventsQuery.value) params.push('q=' + encodeURIComponent(eventsQuery.value));
            if (evTime.value !== 'all') params.push('time=' + encodeURIComponent(evTime.value));
            if (evKind.value !== 'all') params.push('kind=' + encodeURIComponent(evKind.value));
            if (evMode.value !== 'all') params.push('mode=' + encodeURIComponent(evMode.value));
            if (evYear.value !== 'all') params.push('year=' + encodeURIComponent(evYear.value));
            if (evSeries.value !== 'all') params.push('series=' + encodeURIComponent(evSeries.value));
            if (eventsPage.value > 1) params.push('page=' + eventsPage.value);
            if (params.length) path += '?' + params.join('&');
          }
        } else if (activeTab.value === 'database') {
          if (dbView.value === 'characters') {
            path = LANG_PREFIX + '/database/characters';
            if (charDetail.value && charDetail.value.id) {
              path += '/' + encodeURIComponent(charDetail.value.id);
              if (charSection.value !== 'profile') path += '?section=' + encodeURIComponent(charSection.value);
            }
          } else if (dbView.value === 'voice') {
            path = LANG_PREFIX + '/database/voice-actors';
            if (voiceDetail.value) {
              path += '/' + encodeURIComponent(voiceDetail.value.slug);
              if (voiceSection.value !== 'profile') path += '?section=' + encodeURIComponent(voiceSection.value);
            }
          } else if (dbView.value === 'albums') {
            path = LANG_PREFIX + '/music/albums';
            if (albumDetail.value) path += '/' + slugOfAlbum(albumDetail.value.data.name);
          } else if (dbView.value === 'songs') {
            path = LANG_PREFIX + '/music/songs';
            if (songDetail.value) {
              path += '/' + encodeURIComponent(songDetail.value.id);
              if (songSection.value !== 'releases') path += '?section=' + encodeURIComponent(songSection.value);
            } else {
              const params = [];
              if (songDbQuery.value) params.push('q=' + encodeURIComponent(songDbQuery.value));
              if (songDbPage.value > 1) params.push('page=' + songDbPage.value);
              if (params.length) path += '?' + params.join('&');
            }
          } else if (dbView.value === 'other') {
            path = LANG_PREFIX + '/database/other/' + otherSection.value;
          } else {
            path = LANG_PREFIX + '/database/characters';
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
        const targetEntity = isAtomicView();
        const previousState = history.state || {};
        const fromEntity = targetEntity && (pendingEntitySource || (replace && previousState.fromEntity));
        const nextState = Object.assign({}, previousState, { umaInternal: true, entity: targetEntity, fromEntity: !!fromEntity });
        history[replace ? 'replaceState' : 'pushState'](nextState, '', path);
        navigationRevision.value += 1;
      }
      pendingEntitySource = false;
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
      newsDetail.value = null;
      eventDetail.value = null;
      voiceDetail.value = null;
      charDetail.value = null;
      songDetail.value = null;
      liveView.value = 'eventHub';
      selectedEventSessionId.value = '';
      activeTab.value = 'database';
      dbView.value = 'index';
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
        activeTab.value = 'database';
        const musicSection = (seg[1] || '').toLowerCase();
        if (musicSection === 'songs') {
          dbView.value = 'songs';
          const requestedSong = seg[2] ? decodeURIComponent(seg[2]) : '';
          songDetail.value = requestedSong ? findSong(requestedSong) : null;
          const section = url.searchParams.get('section');
          songSection.value = ['releases', 'performances'].indexOf(section) >= 0 ? section : 'releases';
          songDbQuery.value = url.searchParams.get('q') || '';
          const songPageFromUrl = parseInt(url.searchParams.get('page') || '1', 10);
          songDbPage.value = isNaN(songPageFromUrl) || songPageFromUrl < 1 ? 1 : songPageFromUrl;
        } else {
          dbView.value = 'albums';
          const legacyAlbumSlug = musicSection && musicSection !== 'albums' ? seg[1] : '';
          const requestedAlbum = seg[2] ? decodeURIComponent(seg[2]) : (legacyAlbumSlug ? decodeURIComponent(legacyAlbumSlug) : '');
          const album = requestedAlbum ? findAlbumBySlug(requestedAlbum) : null;
          if (album) albumDetail.value = { data: album, songs: album.songs || [], shown: (album.songs || []).length, total: (album.songs || []).length, query: '', targetName: null, note: '' };
          if (!musicSection || legacyAlbumSlug) {
            const target = LANG_PREFIX + '/music/albums' + (album ? '/' + slugOfAlbum(album.name) : '');
            history.replaceState(history.state || {}, '', target);
          }
        }
      } else if (first === 'artist') {
        activeTab.value = 'database';
        dbView.value = 'songs';
        let target = LANG_PREFIX + '/music/songs';
        if (seg.length >= 2) {
          songDbQuery.value = decodeURIComponent(seg[1]);
          target += '?q=' + encodeURIComponent(songDbQuery.value);
        }
        history.replaceState(history.state || {}, '', target);
      } else if (first === 'songs') {
        activeTab.value = 'database';
        dbView.value = 'songs';
        history.replaceState(history.state || {}, '', LANG_PREFIX + '/music/songs');
      } else if (first === 'events') {
        activeTab.value = 'live';
        const requested = seg[1] ? decodeURIComponent(seg[1]) : '';
        if (requested) {
          const found = eventsAll.value.find(function (event) { return event.id === requested; });
          if (found) {
            eventDetail.value = found;
            liveView.value = 'eventDetail';
            const session = url.searchParams.get('session');
            const sessions = found.sessions || [];
            selectedEventSessionId.value = sessions.some(function (item) { return item.id === session; })
              ? session : ((sessions[0] && sessions[0].id) || '');
          }
        } else {
          const time = url.searchParams.get('time');
          const kind = url.searchParams.get('kind');
          const mode = url.searchParams.get('mode');
          const year = url.searchParams.get('year');
          const series = url.searchParams.get('series');
          const page = parseInt(url.searchParams.get('page') || '1', 10);
          eventsQuery.value = url.searchParams.get('q') || '';
          evTime.value = ['upcoming', 'past'].indexOf(time) >= 0 ? time : 'all';
          evKind.value = ['concert', 'onsite', 'official_program'].indexOf(kind) >= 0 ? kind : 'all';
          evMode.value = ['onsite', 'online'].indexOf(mode) >= 0 ? mode : 'all';
          evYear.value = /^20\d{2}$/.test(year || '') ? year : 'all';
          evSeries.value = series && (series === 'unclassified' || eventSeries.value.some(function (item) { return item.id === series; })) ? series : 'all';
          eventsPage.value = isNaN(page) || page < 1 ? 1 : page;
        }
      } else if (first === 'live') {
        const requestedPath = '/' + raw.join('/');
        const legacy = eventsAll.value.find(function (event) {
          return event.legacy_url === requestedPath || (event.legacy_aliases || []).indexOf(requestedPath) !== -1;
        });
        const target = legacy ? LANG_PREFIX + '/events/' + encodeURIComponent(legacy.id) : LANG_PREFIX + '/events';
        history.replaceState(history.state || {}, '', target);
        activeTab.value = 'live';
        liveView.value = legacy ? 'eventDetail' : 'eventHub';
        if (legacy) {
          eventDetail.value = legacy;
          selectedEventSessionId.value = legacy.sessions && legacy.sessions[0] ? legacy.sessions[0].id : '';
        }
      } else if (first === 'database') {
        activeTab.value = 'database';
        const sub = (seg[1] || '').toLowerCase();
        if (sub === 'characters') {
          dbView.value = 'characters';
          const requested = seg[2] ? decodeURIComponent(seg[2]) : '';
          charDetail.value = requested ? findCharById(requested) : null;
          const section = url.searchParams.get('section');
          charSection.value = ['profile', 'pedigree', 'songs', 'appearances'].indexOf(section) >= 0 ? section : 'profile';
        } else if (sub === 'events') {
          const ft = url.searchParams.get('filter[time]');
          const target = LANG_PREFIX + '/events' + ((ft === 'upcoming' || ft === 'past') ? '?time=' + ft : '');
          history.replaceState(history.state || {}, '', target);
          activeTab.value = 'live';
          liveView.value = 'eventHub';
          evTime.value = (ft === 'upcoming' || ft === 'past') ? ft : 'all';
        } else if (sub === 'voice' || sub === 'voice-actors') {
          dbView.value = 'voice';
          voiceDetail.value = findVaBySlug(seg[2] ? decodeURIComponent(seg[2]) : '');
          const section = url.searchParams.get('section');
          voiceSection.value = ['profile', 'songs', 'appearances'].indexOf(section) >= 0 ? section : 'profile';
        } else if (sub === 'albums') {
          const target = LANG_PREFIX + '/music/albums' + (seg[2] ? '/' + encodeURIComponent(decodeURIComponent(seg[2])) : '');
          history.replaceState(history.state || {}, '', target + url.search);
          return syncFromUrl();
        } else if (sub === 'songs') {
          const target = LANG_PREFIX + '/music/songs' + (seg[2] ? '/' + encodeURIComponent(decodeURIComponent(seg[2])) : '');
          history.replaceState(history.state || {}, '', target + url.search);
          return syncFromUrl();
        } else if (sub === 'other') {
          dbView.value = 'other';
          otherSection.value = seg[2] === 'videos' ? 'videos' : 'relationships';
        } else {
          dbView.value = 'characters';
          history.replaceState(history.state || {}, '', LANG_PREFIX + '/database/characters');
        }
      } else if (first === 'characters') {
        const sub = (seg[1] || '').toLowerCase();
        let target = LANG_PREFIX + '/database/characters';
        if (sub === 'room') target = LANG_PREFIX + '/database/other/relationships';
        else if (sub === 'videos') target = LANG_PREFIX + '/database/other/videos';
        else if (sub && sub !== 'intro') target += '/' + encodeURIComponent(sub);
        history.replaceState(history.state || {}, '', target);
        activeTab.value = 'database';
        if (sub === 'room' || sub === 'videos') {
          dbView.value = 'other';
          otherSection.value = sub === 'videos' ? 'videos' : 'relationships';
        } else {
          dbView.value = 'characters';
          charDetail.value = sub && sub !== 'intro' ? findCharById(sub) : null;
        }
      } else if (first === 'links') {
        activeTab.value = 'links';
      } else {
        activeTab.value = 'database';
        dbView.value = 'index';
      }
      Vue.nextTick(renderCharBlood);
    }
    function openAlbum(a) {
      beginEntityNavigation();
      clearEntityDetails('album');
      activeTab.value = 'database';
      dbView.value = 'albums';
      albumDetail.value = { data: a, songs: a.songs || [] };
      resetPageScroll();
      pushUrl();
    }
    function openAlbumFromDb(a) { openAlbum(a); }

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

    // The generated event catalog carries the exact validated curated table.
    function fixAvatarSrc(html) {
      return String(html || '').replace(/(["'])uma_avatars\//g, '$1/uma_avatars/');
    }
    function hideEncorePerf(html) {
      return String(html || '').replace(/<td class="setlist-song">安可<\/td>\s*<td class="setlist-perf">/g,
        '<td class="setlist-song">安可</td><td class="setlist-perf encore-hide">');
    }
    function linkSetlistSongs(table) {
      var linked = String(table || '').replace(/(<td\s+class=["']setlist-song["'][^>]*>)([\s\S]*?)(<\/td>)/gi, function (_, start, body, end) {
        const title = decodeHtml(body).trim();
        const song = findSong(title);
        if (!song || /<a\b/i.test(body)) return start + body + end;
        return start + '<a class="setlist-song-link" data-song-id="' + song.id + '" href="' + LANG_PREFIX + '/music/songs/' + encodeURIComponent(song.id) + '">' + body + '</a>' + end;
      });
      return linked.replace(/<span class=["']perf-item["']>(<img[^>]*\balt=["']([^"']+)["'][^>]*>)<span class=["']perf-name["']>([\s\S]*?)<\/span><\/span>/gi, function (whole, image, alt, label) {
        var character = findCharByDisplayName(decodeHtml(alt));
        if (!character) return whole;
        return '<button type="button" class="perf-item setlist-performer-link" data-character-id="' + character.id + '" style="--chip-color:' + character.main + '">' + image + '<span class="perf-name">' + label + '</span></button>';
      });
    }
    function onEventSetlistClick(event) {
      var songLink = event.target.closest('a[data-song-id]');
      if (songLink) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openSong(songLink.getAttribute('data-song-id'), 'event');
        return;
      }
      var performer = event.target.closest('button[data-character-id]');
      if (performer) openCharacter(performer.getAttribute('data-character-id'));
    }
    function eventSessionTable(session) {
      return session && session.setlist_html
        ? linkSetlistSongs(fixAvatarSrc(hideEncorePerf(session.setlist_html)))
        : '';
    }

    // albums loading
    const statSongs = computed(function () {
      if (songCatalog.value.coverage && Number.isFinite(songCatalog.value.coverage.songs)) return songCatalog.value.coverage.songs;
      if (homeStats.songs !== null) return homeStats.songs;
      return albums.value.reduce(function (n, a) { return n + a.songs.length; }, 0);
    });
    const statAlbums = computed(function () { return homeStats.albums !== null ? homeStats.albums : albums.value.length; });
    const relAlbums = computed(function () {
      let out = albums.value.slice();
      const query = String(relQuery.value || '').trim().toLowerCase();
      if (query) out = out.filter(function (album) {
        const tracks = (album.songs || []).map(function (song) { return (song.name || '') + ' ' + (song.artist || ''); }).join(' ');
        return ((album.name || '') + ' ' + (album.catalog || '') + ' ' + tracks).toLowerCase().indexOf(query) !== -1;
      });
      if (relWork.value) out = out.filter(function (album) { return albumWorkOf(album.name) === relWork.value; });
      if (relFilter.value) out = out.filter(function (a) { return a.type === relFilter.value; });
      if (relYear.value) out = out.filter(function (a) { return String(a.release).slice(0, 4) === relYear.value; });
      return out.slice().sort(function (a, b) {
        if (relSort.value === 'name') return String(a.name).localeCompare(String(b.name), 'ja');
        return String(b.release).localeCompare(String(a.release)) || String(a.name).localeCompare(String(b.name), 'ja');
      });
    });
    function albumWorkOf(name) {
      const value = String(name || '');
      if (/ANIMATION DERBY Season 2/.test(value)) return 's2';
      if (/ANIMATION DERBY Season 3/.test(value)) return 's3';
      if (/ANIMATION DERBY/.test(value)) return 's1';
      if (/ROAD TO THE TOP/.test(value)) return 'rttp';
      if (/新時代の扉/.test(value)) return 'movie';
      if (/シンデレラグレイ|^超える$/.test(value)) return 'cinderella';
      if (/うまよん/.test(value)) return 'yon';
      if (/うまゆる/.test(value)) return 'yuru';
      if (/STARTING GATE/.test(value)) return 'starting-gate';
      if (/Solo Vocal Tracks/.test(value)) return 'solo-vocal';
      if (/WINNING LIVE/.test(value)) return 'winning-live';
      return '';
    }
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
      const el = document.querySelector('#tab-db-albums .album-database-grid');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function goRelPage(dir) {
      setRelPage(relPage.value + dir);
    }
    watch(function () { return relQuery.value; }, function () { relPage.value = 1; });
    watch(function () { return relWork.value; }, function () { relPage.value = 1; });
    watch(function () { return relFilter.value; }, function () { relPage.value = 1; });
    watch(function () { return relYear.value; }, function () { relPage.value = 1; });
    watch(function () { return relSort.value; }, function () { relPage.value = 1; });
    const statLive = computed(function () {
      if (homeStats.live !== null) return homeStats.live;
      return eventsAll.value.filter(function (event) { return event.kind === 'concert'; }).length;
    });
    const statGongyan = computed(function () {
      if (homeStats.performances !== null) return homeStats.performances;
      return eventsAll.value.reduce(function (total, event) { return total + (event.sessions || []).length; }, 0);
    });
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

    const eventSeriesMap = computed(function () {
      const map = {};
      eventSeries.value.forEach(function (series) { map[series.id] = series; });
      return map;
    });
    const eventYears = computed(function () {
      const years = new Set();
      eventsAll.value.forEach(function (event) { if (/^20\d{2}/.test(event.date || '')) years.add(event.date.slice(0, 4)); });
      return Array.from(years).sort().reverse();
    });
    const eventYearOptions = computed(function () {
      return [{ value: 'all', label: '全部年份' }].concat(eventYears.value.map(function (year) { return { value: year, label: year }; }));
    });
    const eventSeriesOptions = computed(function () {
      const rows = [{ value: 'all', label: '全部系列' }];
      ['concert', 'onsite', 'official_program'].forEach(function (kind) {
        eventSeries.value.filter(function (series) { return series.kind === kind; }).forEach(function (series) {
          rows.push({ value: series.id, label: series.name });
        });
      });
      rows.push({ value: 'unclassified', label: '其他活动' });
      return rows;
    });
    const eventsFiltered = computed(function () {
      const q = (eventsQuery.value || '').toLowerCase();
      let out = eventsAll.value.filter(function (e) {
        if (!q) return true;
        if ((e.title || '').toLowerCase().indexOf(q) !== -1) return true;
        if ((e.venue || '').toLowerCase().indexOf(q) !== -1) return true;
        const series = eventSeriesMap.value[e.series_id] || {};
        if (((series.name || '') + ' ' + (series.name_ja || '')).toLowerCase().indexOf(q) !== -1) return true;
        if ((e.cast || []).some(function (a) { return ((a.name || '') + ' ' + (a.role || '')).toLowerCase().indexOf(q) !== -1; })) return true;
        const characterIds = [];
        (e.character_ids || []).forEach(function (id) { if (characterIds.indexOf(id) === -1) characterIds.push(id); });
        (e.cast || []).forEach(function (cast) { if (cast.character_id && characterIds.indexOf(cast.character_id) === -1) characterIds.push(cast.character_id); });
        (e.sessions || []).forEach(function (session) {
          (session.character_ids || []).forEach(function (id) { if (characterIds.indexOf(id) === -1) characterIds.push(id); });
          (session.performances || []).forEach(function (performance) {
            (performance.character_ids || []).forEach(function (id) { if (characterIds.indexOf(id) === -1) characterIds.push(id); });
          });
        });
        if (characterIds.some(function (id) {
          const character = findCharById(id) || {};
          return ((character.zh || '') + ' ' + (character.ja || '') + ' ' + (character.en || '')).toLowerCase().indexOf(q) !== -1;
        })) return true;
        return (e.sessions || []).some(function (session) { return (session.songs || []).some(function (song) { return song.toLowerCase().indexOf(q) !== -1; }); });
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
      if (evKind.value !== 'all') out = out.filter(function (event) { return event.kind === evKind.value; });
      if (evMode.value !== 'all') out = out.filter(function (event) { return event.mode === evMode.value; });
      if (evYear.value !== 'all') out = out.filter(function (event) { return (event.date || '').slice(0, 4) === evYear.value; });
      if (evSeries.value !== 'all') {
        out = out.filter(function (event) {
          return evSeries.value === 'unclassified' ? !event.series_id : event.series_id === evSeries.value;
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
    function eventDateLabel(event) {
      if (!event || !event.date) return event && event.schedule_status === 'announced_tba' ? '官方待公布' : '日期待补';
      return event.end_date && event.end_date !== event.date ? event.date + ' — ' + event.end_date : event.date;
    }
    function eventSummary(event) {
      const value = String((event && event.summary) || '').trim();
      if (!value || /(?:出处|提取码|网盘|https?:\/\/)/i.test(value)) return '';
      return value;
    }
    function eventKindLabel(kind) {
      return { concert: '音乐演出', onsite: '线下活动', official_program: '官方节目' }[kind] || '活动';
    }
    function eventModeLabel(mode) {
      return { onsite: '现场', online: '线上' }[mode] || '形式待补';
    }
    function eventSeriesName(event) {
      const series = eventSeriesMap.value[(event && event.series_id) || ''];
      return series ? series.name : '';
    }
    const eventVoiceCast = computed(function () {
      return ((eventDetail.value && eventDetail.value.cast) || []).filter(function (item) { return item.person_type === 'voice_actor' || item.voice_actor_id; });
    });
    const eventGuestCast = computed(function () {
      return ((eventDetail.value && eventDetail.value.cast) || []).filter(function (item) { return item.person_type !== 'voice_actor' && !item.voice_actor_id; });
    });
    function eventSongCount(event) {
      return (event.sessions || []).reduce(function (total, session) { return total + (session.songs || []).length; }, 0);
    }
    const eventMediaCards = computed(function () {
      const event = eventDetail.value;
      const seen = new Set();
      return ((event && event.media) || []).map(function (item, index) {
        const videoId = String(item.video_id || '');
        const url = String(item.url || (videoId ? 'https://www.youtube.com/watch?v=' + videoId : ''));
        const key = videoId || url;
        if (!key || seen.has(key)) return null;
        seen.add(key);
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (error) {}
        const isYouTube = !!videoId || /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host);
        const isBilibili = /(^|\.)bilibili\.com$|(^|\.)b23\.tv$/.test(host);
        const platform = isYouTube ? 'youtube' : (isBilibili ? 'bilibili' : 'external');
        return {
          key: key,
          url: url,
          videoId: videoId,
          embedUrl: videoId ? 'https://www.youtube-nocookie.com/embed/' + videoId : '',
          platform: platform,
          platformLabel: isYouTube ? 'YouTube' : (isBilibili ? 'Bilibili' : (host || '外部平台')),
          label: item.label || ('节目影像 ' + (index + 1)),
          image: item.thumbnail || (event && event.image) || '/uma_tools/img/event-covers/onsite.svg'
        };
      }).filter(Boolean);
    });
    function voiceFieldLabel(voice, field) {
      if (!voice) return '——';
      const value = field === 'birthday' ? voice.birth : voice[field];
      if (value) return value;
      const status = (voice.fieldStatus || {})[field];
      return { not_published: '未公开', not_applicable: '不适用', source_unavailable: '暂无可核实公开资料' }[status] || '——';
    }
    const selectedEventSession = computed(function () {
      const sessions = (eventDetail.value && eventDetail.value.sessions) || [];
      return sessions.find(function (session) { return session.id === selectedEventSessionId.value; }) || sessions[0] || null;
    });
    function selectEventSession(sessionId) {
      selectedEventSessionId.value = sessionId;
      pushUrl(true);
    }
    function openEvent(eventOrId) {
      beginEntityNavigation();
      const id = typeof eventOrId === 'string' ? eventOrId : (eventOrId && eventOrId.id);
      const show = function () {
        const found = eventsAll.value.find(function (event) { return event.id === id; });
        if (!found) return;
        clearEntityDetails('event');
        eventDetail.value = found;
        selectedEventSessionId.value = found.sessions && found.sessions[0] ? found.sessions[0].id : '';
        liveView.value = 'eventDetail';
        activeTab.value = 'live';
        resetPageScroll();
        pushUrl();
      };
      if (eventsAll.value.length) return show();
      return loadEvents().then(show);
    }
    function eventPaletteStyle(event) {
      const series = eventSeriesMap.value[(event && event.series_id) || ''];
      const fallback = {
        concert: ['#315FC2', '#FF8C1A'],
        onsite: ['#28A8AE', '#B9D934'],
        official_program: ['#4169D8', '#34CED0']
      }[(event && event.kind) || ''] || ['#315FC2', '#FF8C1A'];
      return {
        '--entity-accent': (series && series.primary) || fallback[0],
        '--entity-sub': (series && series.secondary) || fallback[1]
      };
    }
    function eventKindColor(kind) {
      return { concert: '#315FC2', onsite: '#28A8AE', official_program: '#4169D8' }[kind] || '#315FC2';
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
      return e ? LANG_PREFIX + '/events/' + encodeURIComponent(e.id) : null;
    });
    function openNextUpcoming() {
      const e = nextUpcomingEvent.value;
      if (!e) return;
      loadEvents().then(function () { home.value = false; openEvent(e.id); });
    }
    function onEventImageError(ev, event) {
      const image = ev && ev.target;
      if (!image || image.getAttribute('data-fallback') === '1') return;
      image.setAttribute('data-fallback', '1');
      image.src = '/uma_tools/img/event-covers/onsite.svg';
    }
    function loadEvents() {
      if (eventsLoadPromise) return eventsLoadPromise;
      eventsError.value = '';
      eventsLoading.value = true;
      eventsLoadPromise = fetch('/data/events_catalog.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          eventsAll.value = (data && Array.isArray(data.events)) ? data.events : [];
          eventSeries.value = (data && Array.isArray(data.series)) ? data.series : [];
          eventsLoading.value = false;
          eventsError.value = eventsAll.value.length ? '' : '活动数据为空。';
        })
        .catch(function () {
          eventsLoadPromise = null;
          eventsAll.value = [];
          eventSeries.value = [];
          eventsLoading.value = false;
          eventsError.value = '无法加载统一活动目录（请确认 data/events_catalog.json 已生成，并通过本地服务访问本页）。';
        });
      return eventsLoadPromise;
    }
    function decodeHtml(s) {
      if (!s) return '';
      var d = document.createElement('div');
      d.innerHTML = s;
      return d.textContent || '';
    }
    function setEvTime(v) {
      if (v !== 'all' && v !== 'upcoming' && v !== 'past') return;
      evTime.value = v;
      eventsPage.value = 1;
      pushUrl();
    }
    function setEvKind(value) { evKind.value = value; eventsPage.value = 1; pushUrl(); }
    function setEvMode(value) { evMode.value = value; eventsPage.value = 1; pushUrl(); }
    function setEvYear(value) { evYear.value = value; eventsPage.value = 1; pushUrl(); }
    function setEvSeries(value) { evSeries.value = value; eventsPage.value = 1; pushUrl(); }
    watch(function () { return eventsQuery.value; }, function () { eventsPage.value = 1; });
    watch(function () { return evTime.value; }, function () { eventsPage.value = 1; });
    watch(function () { return evKind.value; }, function () { eventsPage.value = 1; });
    watch(function () { return evMode.value; }, function () { eventsPage.value = 1; });
    watch(function () { return evYear.value; }, function () { eventsPage.value = 1; });
    watch(function () { return evSeries.value; }, function () { eventsPage.value = 1; });
    const coverTint = reactive({});
    const tintSet = new Set();
    const catalogCoverFallback = '/uma_tools/img/album-placeholder.svg';
    function coverThumb(url, size) {
      const src = String(url || '');
      if (!src || src === '/album_covers/placeholder.webp') return catalogCoverFallback;
      if (!/^https?:\/\/p\d+\.music\.126\.net\//i.test(src) || /[?&]param=\d+y\d+/i.test(src)) return src;
      const px = Math.max(64, parseInt(size, 10) || 360);
      return src + (src.indexOf('?') === -1 ? '?' : '&') + 'param=' + px + 'y' + px;
    }
    function onCatalogImageError(event) {
      const image = event && event.currentTarget;
      if (image && !String(image.src || '').endsWith(catalogCoverFallback)) image.src = catalogCoverFallback;
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
      const doc = new DOMParser().parseFromString(String(html), 'text/html');
      const allowedTags = new Set([
        'A', 'P', 'BR', 'DIV', 'SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S',
        'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'H1', 'H2', 'H3',
        'H4', 'H5', 'H6', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
        'TH', 'TD', 'FIGURE', 'FIGCAPTION', 'PICTURE', 'SOURCE', 'IMG', 'IFRAME'
      ]);
      const dangerousTags = new Set(['SCRIPT', 'STYLE', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META', 'BASE']);
      const allowedAttrs = new Set(['href', 'src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'colspan', 'rowspan']);
      const iframeAttrs = new Set(['src', 'title', 'width', 'height', 'loading', 'allow', 'allowfullscreen', 'frameborder', 'referrerpolicy']);
      function safeUrl(value) {
        const normalized = String(value || '').trim().replace(/[\u0000-\u0020]+/g, '');
        return !/(?:^|,)(?:javascript|data|vbscript):/i.test(normalized);
      }
      function trustedVideoEmbed(value) {
        try {
          const url = new URL(String(value || ''), window.location.origin);
          const trustedHost = ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname);
          return url.protocol === 'https:' && trustedHost && /^\/embed\/[A-Za-z0-9_-]+/.test(url.pathname);
        } catch (e) {
          return false;
        }
      }
      Array.from(doc.body.querySelectorAll('*')).forEach(function (el) {
        if (!allowedTags.has(el.tagName)) {
          if (dangerousTags.has(el.tagName)) el.remove();
          else el.replaceWith.apply(el, Array.from(el.childNodes));
          return;
        }
        if (el.tagName === 'IFRAME' && !trustedVideoEmbed(el.getAttribute('src'))) {
          el.remove();
          return;
        }
        const attrs = el.tagName === 'IFRAME' ? iframeAttrs : allowedAttrs;
        Array.from(el.attributes).forEach(function (attr) {
          const name = attr.name.toLowerCase();
          if (!attrs.has(name) || ((name === 'href' || name === 'src' || name === 'srcset') && !safeUrl(attr.value))) {
            el.removeAttribute(attr.name);
          }
        });
        if (el.tagName === 'A' && el.hasAttribute('href')) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
        if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
        if (el.tagName === 'IFRAME') {
          el.className = 'news-embed';
          el.setAttribute('loading', 'lazy');
          el.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        }
      });
      return doc.body.innerHTML;
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
          newsLoadPromise = null;
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
      beginEntityNavigation();
      clearEntityDetails('news');
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
        resetPageScroll();
        pushUrl();
        fetch('/api/lantis-detail?id=' + encodeURIComponent(id), { cache: 'no-cache' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
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
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) {
          if (!d || !d.detail || !d.detail.announce_id) throw new Error('no detail');
          newsDetail.value = d.detail;
          newsDetailBody.value = cleanNewsBody(d.detail.message_zh || d.detail.message);
          newsPrevId.value = d.prev_announce_id || 0;
          newsNextId.value = d.next_announce_id || 0;
          resetPageScroll();
          pushUrl();
        })
        .catch(function () { newsError.value = '详情加载失败'; });
    }
    function loadAlbums() {
      if (albumsLoadPromise) return albumsLoadPromise;
      albumsError.value = '';
      albumsLoadPromise = fetch('/data/albums.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { albums.value = Array.isArray(data) ? data : []; })
        .catch(function (e) {
          albumsLoadPromise = null;
          albumsError.value = '无法加载专辑数据（请通过本地服务访问本页，例如 node uma_tools/server.js --no-crawl 后打开 http://localhost:8080/）';
        });
      return albumsLoadPromise;
    }
    watch(function () { return charDetail.value && charDetail.value.id; }, function () {
      charHistoryQuery.value = '';
      charHistoryKind.value = 'all';
      expandedRelationSongId.value = '';
    });
    watch(function () { return voiceDetail.value && voiceDetail.value.id; }, function () {
      voiceHistoryQuery.value = '';
      voiceHistoryKind.value = 'all';
      expandedRelationSongId.value = '';
    });
    watch(charSort, function () { window.dispatchEvent(new CustomEvent('uma-character-sort')); });

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
      audio, albums, albumsError, activeTab, home, routeReady, albumDetail, liveView, player, navItems, openNavGroup,
      navItemActive, toggleNavGroup, closeNavGroup, navNavigate, goHome, dbView, albumName, openAlbum, openAlbumFromDb,
      statSongs, statAlbums, statLive, statGongyan, loadAlbums, coverStyle, coverThumb, onCatalogImageError, microCmsImage, sampleCover,
      fix, fixDone, fixSendState, submitFix, goContributeFix, goContributeContact, goLegal,
      isActive, playSong, togglePlay, seek, styleWidth,
      nextSong, prevSong, playQueueAt, playAlbumAt, showQueue,
      newsItems, newsError, newsLoading, newsRange, newsType, newsFiltered, newsHero,
      newsDetail, newsDetailBody, newsPrevId, newsNextId,
      newsDate, newsTypeOf, newsTypeLabel, newsTitle, openNews, loadNews, newsHeroCover,
      newsPage, newsPaged, newsPageCount, newsPageStart, newsPageEnd, newsPageList, setNewsPage, goNewsPage,
      syncFromUrl, prepareCurrentRoute, loadHomeSummaryIfNeeded, navigateTo, showContextBack, contextBack, breadcrumbItems,
      eventsQuery, evTime, evKind, evMode, evYear, evSeries, eventYears, eventYearOptions, eventSeriesOptions, setEvTime, setEvKind, setEvMode, setEvYear, setEvSeries, eventsPaged, eventsFiltered,
      eventsPage, eventsPageCount, eventsPageStart, eventsPageEnd, eventsPageList,
      setEventsPage, goEventsPage, pastEvent, onEventImageError, loadEvents,
      nextUpcomingEvent, nextUpcomingHref, openNextUpcoming,
      eventDetail, selectedEventSession, selectedEventSessionId, selectEventSession, eventMediaCards, eventVoiceCast, eventGuestCast, openEvent, eventDateLabel, eventSummary, eventKindLabel, eventKindColor, eventPaletteStyle, eventModeLabel, eventSeriesName, eventSongCount, eventSessionTable, onEventSetlistClick,
      songCatalog, songCatalogError, songDetail, songSection, setSongSection, songDbQuery, songDbFiltered, songDbPaged, songDbPage, songDbPageCount, songDbPageStart, songDbPageEnd, songDbPageList, setSongDbPage, goSongDbPage, songDetailReleases, songDetailPerformances, songSingerLabel, playableSongRelease, playCatalogSong, playSongRelease, playRelationRelease, relationSong, relationSongVersions, relationReleaseVocalists, expandedRelationSongId, toggleRelationSong, openSong, openAlbumFromSong, openEventUrl, loadSongCatalog, characterName, characterImage, characterColor, voiceName, voicePhoto, voicePhotoByName, voicePaletteStyle, albumTrackVocalists,
      charDetail, charSort, characterSortOptions, openCharDetail, openCharacter, charSection, setCharSection, charAppearance, charHistoryQuery, charHistoryKind, charHistoryEvents,
      voiceProfiles, voiceDetail, voiceSection, setVoiceSection, voiceAppearance, voicePastByYear, voiceHistoryQuery, voiceHistoryKind, voiceFieldLabel, openVa, openVoice, openVoiceByName, openCharFromVoice, LANG_PREFIX,
      otherSection, setOtherSection, curatedVideos,
      relFilter, relAlbums, relTypeList, relYearList, relWorkList, relQuery, relWork, relSort, relYear, relPage, relFiltered, relPaged, relPageCount, relPageStart, relPageEnd, relPageList, setRelPage, goRelPage,
      historyKindOptions, albumSortOptions, fixTitleOptions,
      backTopVisible, updateBackTop, backToTop, bindAudio
    };
  },
  mounted() {
    this.bindAudio();
    const self = this;
    window.__uma_app = this;
    const syncPrepared = function () {
      const segments = window.location.pathname.split('/').filter(Boolean).filter(function (part) { return part.toLowerCase() !== 'zh-hans'; });
      self.routeReady = segments.length === 1 && segments[0].toLowerCase() === 'news';
      self.prepareCurrentRoute().then(function () {
        self.syncFromUrl();
        self.routeReady = true;
      }, function () {
        self.syncFromUrl();
        self.routeReady = true;
      });
    };
    window.addEventListener('popstate', syncPrepared);
    window.addEventListener('scroll', this.updateBackTop, { passive: true });
    syncPrepared();
    this.loadHomeSummaryIfNeeded();
  }
});
umaApp.component('ui-select', UiSelect);
umaApp.mount('#app');



(function () {
  function renderIntro(root) {
    var grid = (root || document).querySelector('#cIntroGrid');
    var input = (root || document).querySelector('#cIntroSearch');
    var listBox = (root || document).querySelector('#cIntroList');
    if (!grid || !input || grid.getAttribute('data-c-inited')) return;
    grid.setAttribute('data-c-inited', '1');
    function norm(c) { return String(c || '').toLowerCase(); }
    function data() {
      return (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : [];
    }
    function render() {
      var q = norm(input.value.trim());
      var s = window.__uma_app ? window.__uma_app.charSort : 'default';
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
        var li = document.createElement('li');
        var card = document.createElement('a');
        card.className = 'cio-card';
        card.href = '/zh-Hans/database/characters/' + encodeURIComponent(c.id);
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
    window.addEventListener('uma-character-sort', render);
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
      var source = document.createElement('div');
      source.innerHTML = d.html;
      var description = source.querySelector('.uma-description');
      box.innerHTML = description && description.innerHTML.trim()
        ? '<div class="character-description">' + description.innerHTML + '</div>'
        : '';
      box.setAttribute('data-d-filled', detail.id);
    }
    fill();
  }

  /* ---------- 血缘关系节点图（角色详情页下方） ---------- */
  var relByCid = {};
  var relSource = null;
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'uma-pedigree-height') return;
    var frames = document.querySelectorAll('.c-pedigree-lens-frame');
    frames.forEach(function (frame) {
      if (frame.contentWindow !== event.source) return;
      if (frame.dataset.pedigreeSample !== event.data.sample) return;
      var height = Math.max(76, Math.min(3200, Number(event.data.height) || 0));
      if (height) frame.style.height = height + 'px';
    });
  });
  function refreshRelIndex() {
    if (typeof PED_REL === 'undefined' || relSource === PED_REL) return;
    relByCid = {};
    PED_REL.forEach(function (n) { relByCid[n.cid] = n; });
    relSource = PED_REL;
  }
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

  function renderBloodGraphInDetail(box, root) {
    if (!box) return;
    refreshRelIndex();

    var relation = relByCid[root];
    var message = '';
    if (relation && relation.mapping_kind === 'non_uma') {
      message = '该角色非赛马娘，无现实原型，不提供血缘关系图。';
    } else if (relation && (relation.mapping_kind === 'original' || relation.pure)) {
      message = '该角色为纯原创赛马娘，无现实原型，不提供血缘关系图。';
    }
    if (message) {
      var note = document.createElement('section');
      note.className = 'c-blood c-blood-pure';
      note.innerHTML = '<div class="c-blood-head"><h3 class="c-blood-title">血缘关系图</h3></div>' +
        '<p class="c-blood-pure-note">' + message + '</p>';
      box.appendChild(note);
      return;
    }

    if (!relation) {
      var missing = document.createElement('section');
      missing.className = 'c-blood c-blood-pure';
      missing.innerHTML = '<div class="c-blood-head"><h3 class="c-blood-title">血缘关系图</h3></div>' +
        '<p class="c-blood-pure-note">血统数据载入失败。</p>' +
        '<button type="button" class="c-blood-retry">重新载入</button>';
      missing.querySelector('.c-blood-retry').addEventListener('click', function () {
        window.location.reload();
      });
      box.appendChild(missing);
      return;
    }
    var lens = document.createElement('section');
    lens.className = 'c-pedigree-lens';
    var frame = document.createElement('iframe');
    var displayName = relation.zh || root;
    var sampleId = String(root).replace(/[^a-z0-9_]/gi, '');
    frame.className = 'c-pedigree-lens-frame';
    frame.dataset.pedigreeSample = root;
    frame.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link rel="stylesheet" href="/uma_tools/pedigree-lab.css?v=20260911-15">' +
      '<script>window.PEDIGREE_SAMPLE=' + JSON.stringify(sampleId) +
      ';window.PEDIGREE_EMBEDDED=true;<\/script>' +
      '<script defer src="/data/character_index_data.js?v=20260904"><\/script>' +
      '<script defer src="/data/pedigree_data.js?v=20260911-8"><\/script>' +
      '<script defer src="/uma_tools/pedigree-lab.js?v=20260911-20"><\/script></head>' +
      '<body><a id="character-back-link" hidden></a><main class="lab-page">' +
      '<section class="lab-workspace" aria-labelledby="workspace-title">' +
      '<div class="workspace-head"><h2 id="workspace-title">血统关系</h2></div>' +
      '<div class="workspace-content"><div class="workspace-body">' +
      '<div class="graph-viewport" id="graph-viewport" aria-label="血统关系图"><div class="graph-stage" id="graph-stage"></div></div>' +
      '</div></div></section></main>' +
      '<div class="mobile-sheet" id="mobile-sheet" aria-hidden="true">' +
      '<button type="button" class="sheet-backdrop" data-sheet-close aria-label="关闭关系详情"></button>' +
      '<section class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-grip"></div><button type="button" class="sheet-close" data-sheet-close aria-label="关闭">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '<div id="sheet-content"></div></section></div></body></html>';
    frame.title = displayName + '的血统关系';
    frame.loading = 'lazy';
    lens.appendChild(frame);
    box.appendChild(lens);
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
      var lightboxImage = document.createElement('img');
      lightboxImage.alt = '宿舍室友图大图';
      ov.appendChild(lightboxImage);
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
    var img = (root || document).querySelector('.roommate-image');
    if (!img || img.getAttribute('data-room-inited')) return;
    img.setAttribute('data-room-inited', '1');
    img.addEventListener('click', function () { openRoomLightbox(img.getAttribute('src') || img.src); });
  }

  function initCharTab() {
    var tab = document.getElementById('tab-characters');
    if (tab) {
      renderIntro(tab);
      renderDetail(tab);
    }
    initRoom(document);
  }

  /* ---------- 声优库列表 ---------- */
  function renderVoiceList(root) {
    var grid = (root || document).querySelector('#vaGrid');
    var input = (root || document).querySelector('#vaSearch');
    if (!grid || !input || grid.getAttribute('data-va-inited')) return;
    grid.setAttribute('data-va-inited', '1');
    function norm(v) { return String(v || '').toLowerCase(); }
    function data() {
      var generated = window.__uma_app && window.__uma_app.voiceProfiles;
      if (generated && generated.length) {
        return generated.map(function (profile) {
          var identity = profile.identity || {}, photo = profile.photo || {};
          return {
            key: identity.zh || identity.ja || profile.id,
            slug: profile.slug || profile.id,
            zh: identity.zh || identity.ja || '', ja: identity.ja || identity.zh || '',
            photo: photo.url || '',
            roles: (profile.roles || []).map(function (role) { return { id: role.character_id || '', zh: role.name || '', image: role.image || '', main: role.color_main || '#8c83ff' }; })
          };
        });
      }
      return [];
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
        var ph = v.photo ? { img: v.photo } : null;
        var roleHtml = v.roles.map(function (role) {
          var roleImage = role.image ? '<img src="' + role.image + '" alt="">' : '<span class="performer-chip-fallback" aria-hidden="true">' + (role.zh || '?').charAt(0) + '</span>';
          return '<span class="performer-chip character-chip" style="--chip-color:' + role.main + '">' + roleImage + '<span>' + role.zh + '</span></span>';
        }).join('');
        var imageAttrs = i < 4 ? ' loading="eager"' + (i === 0 ? ' fetchpriority="high"' : '') : ' loading="lazy"';
        var imgHtml = ph
          ? '<img class="va-card-img" src="' + ph.img + '" alt="' + v.zh + '"' + imageAttrs + '>'
          : '<span class="va-ph-fb">' + (v.zh || v.ja || '?').charAt(0) + '</span>';
          card.innerHTML =
          imgHtml +
          '<span class="va-card-txt">' +
            '<p class="va-name">' + v.zh + '</p>' +
            '<p class="va-kana">' + v.ja + '</p>' +
            '<span class="performer-chip-list compact va-card-roles">' + roleHtml + '</span>' +
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

var mo = new MutationObserver(function () { initCharTab(); initVoiceTab(); });
mo.observe(document.body, { childList: true, subtree: true });
initCharTab();
initVoiceTab();
})();
