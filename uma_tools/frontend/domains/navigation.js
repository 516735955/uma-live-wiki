/* navigation state and behavior; external dependencies are explicit live ports. */
export function createNavigation(deps) {
  function routeSegments() {
    const seg = window.location.pathname.split("/").filter(Boolean);
    if (seg.length && seg[0].toLowerCase() === "zh-hans") seg.shift();
    return seg;
  }

  const initialSegments = routeSegments();

  const initialFirst = (initialSegments[0] || "").toLowerCase();

  const initialDatabaseSection =
    initialFirst === "database" ? (initialSegments[1] || "").toLowerCase() : "";

  const initialMusicSection =
    initialFirst === "music" ? (initialSegments[1] || "").toLowerCase() : "";

  const initialDatabaseView =
    ["artist", "songs"].indexOf(initialFirst) >= 0 ||
    initialMusicSection === "songs"
      ? "songs"
      : initialMusicSection === "albums"
        ? "albums"
        : initialMusicSection === "creators"
          ? "creators"
          : initialFirst === "characters"
            ? "characters"
            : {
                characters: "characters",
                voice: "voice",
                "voice-actors": "voice",
                albums: "albums",
                songs: "songs",
                creators: "creators",
                anime: "anime",
                staff: "staff",
                other: "other",
              }[initialDatabaseSection] || "characters";

  const initialTab =
    initialFirst === "events" || initialFirst === "live"
      ? "live"
      : ["characters", "database", "music", "artist", "songs", ""].indexOf(
            initialFirst,
          ) >= 0
        ? "database"
        : initialFirst;

  const activeTab = deps.ref(initialTab);

  const home = deps.ref(initialSegments.length === 0);

  const openNavGroup = deps.ref("");

  const backTopVisible = deps.ref(false);

  function syncBodyBackground(isHome) {
    document.body.classList.toggle("subpage-bg", !isHome);
  }

  const dataScriptPromises = {};

  const dataScriptLoadedAt = {};

  let homeSummaryLoadPromise = null;

  const homeStats = deps.reactive({
    songs: null,
    albums: null,
    live: null,
    performances: null,
    characters: null,
    voiceActors: null,
    events: null,
  });

  function pagerList(cur, total) {
    var out = [];
    if (total <= 7) {
      for (var i = 1; i <= total; i++) out.push(i);
      return out;
    }
    out.push(1);
    var s = Math.max(2, cur - 1),
      e = Math.min(total - 1, cur + 1);
    if (s > 2) out.push("…");
    for (var i = s; i <= e; i++) out.push(i);
    if (e < total - 1) out.push("…");
    out.push(total);
    return out;
  }

  const dbView = deps.ref(initialDatabaseView);

  function loadDataScript(src, globalName) {
    const mutable = src.startsWith("/data/");
    if (
      mutable &&
      globalName &&
      window[globalName] &&
      dataScriptLoadedAt[src] === undefined
    )
      dataScriptLoadedAt[src] = Date.now();
    if (mutable && Date.now() - (dataScriptLoadedAt[src] || 0) >= 5 * 60 * 1000)
      delete dataScriptPromises[src];
    if (
      globalName &&
      window[globalName] &&
      (!mutable || Date.now() - dataScriptLoadedAt[src] < 5 * 60 * 1000)
    )
      return Promise.resolve();
    if (dataScriptPromises[src]) return dataScriptPromises[src];
    dataScriptPromises[src] = new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      const fail = function () {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (script.parentNode) script.parentNode.removeChild(script);
        delete dataScriptPromises[src];
        reject(new Error("failed to load " + src));
      };
      const timer = setTimeout(fail, 25000);
      script.src = src;
      script.async = true;
      script.onload = function () {
        if (globalName && !window[globalName]) {
          fail();
          return;
        }
        clearTimeout(timer);
        dataScriptLoadedAt[src] = Date.now();
        script.onload = script.onerror = null;
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve();
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
    return dataScriptPromises[src];
  }

  function listParamsFromUrl() {
    const params = new URL(window.location.href).searchParams;
    return Object.fromEntries(params.entries());
  }

  function loadHomeSummary() {
    if (homeSummaryLoadPromise) return homeSummaryLoadPromise;
    homeSummaryLoadPromise = deps.api
      .request("/api/home-summary", { fresh: true })
      .then(function (data) {
        homeSummaryLoadPromise = null;
        const stats = (data && data.stats) || {};
        homeStats.songs = Number.isFinite(stats.songs) ? stats.songs : null;
        homeStats.albums = Number.isFinite(stats.albums) ? stats.albums : null;
        homeStats.live = Number.isFinite(stats.live) ? stats.live : null;
        homeStats.performances = Number.isFinite(stats.performances)
          ? stats.performances
          : null;
        homeStats.characters = Number.isFinite(stats.characters)
          ? stats.characters
          : null;
        homeStats.voiceActors = Number.isFinite(stats.voiceActors)
          ? stats.voiceActors
          : null;
        homeStats.events = Number.isFinite(stats.events) ? stats.events : null;
        deps.homeNextEvent.value = (data && data.nextEvent) || null;
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

  const navItems = [
    {
      key: "news",
      label: "新闻",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>',
      path: deps.routes.news(),
    },
    {
      key: "music",
      label: "音乐",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12M9 10l10-2"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
      children: [
        { key: "songs", label: "歌曲", path: deps.routes.songs() },
        { key: "albums", label: "专辑", path: deps.routes.albums() },
        { key: "creators", label: "创作者", path: deps.routes.creators() },
      ],
    },
    {
      key: "project",
      label: "企划",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9h8M8 13h8M8 17h5"/></svg>',
      children: [
        { key: "characters", label: "角色", path: deps.routes.characters() },
        { key: "voice", label: "声优", path: deps.routes.voiceActors() },
        { key: "anime", label: "动漫", path: deps.routes.anime() },
        { key: "live", label: "活动", path: deps.routes.events() },
        { key: "staff", label: "制作人员", path: deps.routes.staff() },
      ],
    },
    {
      key: "database",
      label: "资料库",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></svg>',
      children: [
        { key: "horses", label: "原型马", path: deps.routes.horses() },
        { key: "jockeys", label: "骑师", path: deps.routes.jockeys() },
        { key: "other", label: "其他", path: deps.routes.other() },
      ],
    },
    {
      key: "links",
      label: "友链",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 15 6-6M7.5 17.5l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16.5 6.5l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/></svg>',
      path: deps.routes.links(),
    },
  ];

  const historyKindOptions = [
    { value: "all", label: "全部类型" },
    { value: "concert", label: "音乐演出" },
    { value: "onsite", label: "线下活动" },
    { value: "official_program", label: "官方节目" },
  ];

  const fixTitleOptions = [
    { value: "", label: "选择条目类型…" },
    { value: "角色", label: "角色" },
    { value: "声优", label: "声优" },
    { value: "乐曲", label: "乐曲" },
    { value: "演出/LIVE", label: "演出 / LIVE" },
    { value: "新闻", label: "新闻" },
    { value: "发售/商品", label: "发售 / 商品" },
    { value: "会场", label: "会场" },
    { value: "其他", label: "其他" },
  ];

  const contactEmails = ["516735955@qq.com", "alaemiryoung@163.com"];

  const contactMailto =
    "mailto:" +
    contactEmails[0] +
    "?cc=" +
    encodeURIComponent(contactEmails[1]);

  const fix = deps.reactive({
    page: "",
    kind: "",
    title: "",
    body: "",
    src: "",
    contact: "",
    agree: false,
  });

  const fixDone = deps.ref(false);

  const fixSendState = deps.ref("");

  const fixMailto = deps.computed(function () {
    const kind =
      {
        k1: "资料错误",
        k2: "缺少资料",
        k3: "翻译问题",
        k4: "图片问题",
        k5: "链接问题",
        k6: "其他",
      }[fix.kind] || "其他";
    const subject = "【资料订正】" + (fix.title || "未分类") + " - " + kind;
    const body =
      "页面 URL：" +
      fix.page +
      "\n问题类型：" +
      kind +
      "\n条目类型：" +
      (fix.title || "未选择") +
      "\n正确内容应为：" +
      fix.body +
      "\n来源 / 依据 URL：" +
      (fix.src || "（无）") +
      "\n联系方式：" +
      (fix.contact || "（无）");
    return (
      contactMailto +
      "&subject=" +
      encodeURIComponent(subject) +
      "&body=" +
      encodeURIComponent(body)
    );
  });

  function submitFix() {
    if (
      !fix.page ||
      !fix.body ||
      !fix.agree ||
      fixSendState.value === "sending" ||
      fixSendState.value === "ok"
    )
      return;
    fixSendState.value = "sending";
    const k = {
      k1: "资料错误",
      k2: "缺少资料",
      k3: "翻译问题",
      k4: "图片问题",
      k5: "链接问题",
      k6: "其他",
    };
    const kindText = k[fix.kind] || "其他";
    const subject = "【资料订正】" + (fix.title || "未分类") + " - " + kindText;
    fetch("https://formsubmit.co/ajax/" + contactEmails[0], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        _subject: subject,
        _cc: contactEmails[1],
        _template: "table",
        _captcha: "false",
        "页面 URL": fix.page,
        问题类型: kindText,
        条目类型: fix.title || "未选择",
        正确内容应为: fix.body,
        "来源 / 依据 URL": fix.src || "（无）",
        联系方式: fix.contact || "（无）",
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (result) {
        if (
          !result ||
          result.success === false ||
          result.success === "false" ||
          !result.success
        )
          throw new Error("FormSubmit rejected the request");
        fixDone.value = true;
        fixSendState.value = "ok";
      })
      .catch(function () {
        fixDone.value = false;
        fixSendState.value = "error";
      });
  }

  function goContributeFix() {
    if (!fix.page && isAtomicView()) fix.page = window.location.href;
    deps.beginEntityNavigation();
    fixDone.value = false;
    fixSendState.value = "";
    home.value = false;
    activeTab.value = "contribute";
    deps.clearEntityDetails();
    dbView.value = "index";
    deps.charDetail.value = null;
    deps.voiceDetail.value = null;
    deps.animeDetail.value = null;
    deps.animeUnitDetail.value = null;
    resetPageScroll();
    deps.pushUrl();
  }

  function goContributeContact() {
    deps.beginEntityNavigation();
    home.value = false;
    activeTab.value = "contribute-contact";
    deps.clearEntityDetails();
    dbView.value = "index";
    resetPageScroll();
    deps.pushUrl();
  }

  function goLegal(page) {
    deps.beginEntityNavigation();
    home.value = false;
    activeTab.value = page === "privacy" ? "legal-privacy" : "legal-terms";
    deps.clearEntityDetails();
    dbView.value = "index";
    resetPageScroll();
    deps.pushUrl();
  }

  function navItemActive(key) {
    if (key === "music")
      return (
        activeTab.value === "database" &&
        (dbView.value === "songs" ||
          dbView.value === "albums" ||
          dbView.value === "creators")
      );
    if (key === "project")
      return (
        activeTab.value === "live" ||
        (activeTab.value === "database" &&
          ["characters", "voice", "anime", "staff"].includes(dbView.value))
      );
    if (key === "database")
      return activeTab.value === "database" && dbView.value === "other";
    return activeTab.value === key;
  }

  function toggleNavGroup(key) {
    openNavGroup.value = openNavGroup.value === key ? "" : key;
  }

  function activateNavGroup(key) {
    toggleNavGroup(key);
  }

  function closeNavGroup() {
    openNavGroup.value = "";
  }

  function updateBackTop() {
    backTopVisible.value = window.scrollY > 680;
  }

  function backToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navNavigate(path) {
    closeNavGroup();
    deps.navigateTo(path);
  }

  function isAtomicView() {
    return !!(
      deps.newsDetail.value ||
      deps.eventDetail.value ||
      deps.albumDetail.value ||
      deps.songDetail.value ||
      deps.creatorDetail.value ||
      deps.charDetail.value ||
      deps.voiceDetail.value ||
      deps.horseDetail.value ||
      deps.staffDetail.value ||
      deps.animeDetail.value ||
      deps.animeUnitDetail.value
    );
  }

  function resetPageScroll() {
    window.scrollTo(0, 0);
    Vue.nextTick(function () {
      window.requestAnimationFrame(function () {
        window.scrollTo(0, 0);
      });
    });
  }

  const showContextBack = deps.computed(function () {
    deps.navigationRevision.value;
    return isAtomicView() && !!(history.state && history.state.fromEntity);
  });

  function contextBack() {
    history.back();
  }

  const breadcrumbItems = deps.computed(function () {
    const items = [{ label: "首页", path: deps.routes.home() }];
    if (activeTab.value === "contribute")
      return items.concat([{ label: "参与共建" }, { label: "资料订正" }]);
    if (activeTab.value === "contribute-contact")
      return items.concat([{ label: "参与共建" }, { label: "联系我们" }]);
    if (activeTab.value === "legal-privacy")
      return items.concat([{ label: "法律告知" }, { label: "隐私政策" }]);
    if (activeTab.value === "legal-terms")
      return items.concat([{ label: "法律告知" }, { label: "使用条款" }]);
    if (!isAtomicView()) return [];
    if (deps.newsDetail.value)
      return items.concat([
        { label: "新闻", path: deps.routes.news() },
        { label: deps.newsTitle(deps.newsDetail.value) },
      ]);
    if (deps.eventDetail.value)
      return items.concat([
        { label: "企划" },
        { label: "活动", path: deps.routes.events() },
        { label: deps.eventDetail.value.title },
      ]);
    if (deps.albumDetail.value)
      return items.concat([
        { label: "音乐" },
        { label: "专辑", path: deps.routes.albums() },
        { label: deps.albumDetail.value.data.name },
      ]);
    if (deps.songDetail.value)
      return items.concat([
        { label: "音乐" },
        { label: "歌曲", path: deps.routes.songs() },
        { label: deps.songDetail.value.title },
      ]);
    if (deps.creatorDetail.value)
      return items.concat([
        { label: "音乐" },
        { label: "创作者", path: deps.routes.creators() },
        { label: deps.creatorDetail.value.name },
      ]);
    if (deps.horseDetail.value)
      return items.concat([
        { label: "资料库" },
        { label: "原型马", path: deps.routes.horses() },
        {
          label:
            deps.horseDetail.value.zh ||
            deps.horseDetail.value.en ||
            deps.horseDetail.value.id,
        },
      ]);
    if (deps.charDetail.value)
      return items.concat([
        { label: "企划" },
        { label: "角色", path: deps.routes.characters() },
        { label: deps.charDetail.value.zh },
      ]);
    if (deps.voiceDetail.value)
      return items.concat([
        { label: "企划" },
        { label: "声优", path: deps.routes.voiceActors() },
        { label: deps.voiceDetail.value.zh },
      ]);
    if (deps.staffDetail.value)
      return items.concat([
        { label: "企划" },
        { label: "制作人员", path: deps.routes.staff() },
        { label: deps.staffDetail.value.name },
      ]);
    if (deps.animeUnitDetail.value)
      return items.concat([
        { label: "企划" },
        { label: "动漫", path: deps.routes.anime() },
        {
          label: deps.animeDetail.value.title_zh,
          path: deps.routes.anime(deps.animeDetail.value.id),
        },
        { label: deps.animeUnitDetail.value.title_zh },
      ]);
    if (deps.animeDetail.value)
      return items.concat([
        { label: "企划" },
        { label: "动漫", path: deps.routes.anime() },
        { label: deps.animeDetail.value.title_zh },
      ]);
    return [];
  });

  function goHome() {
    deps.beginEntityNavigation();
    home.value = true;
    deps.clearEntityDetails();
    activeTab.value = "database";
    dbView.value = "songs";
    resetPageScroll();
    loadHomeSummaryIfNeeded();
    deps.pushUrl();
  }

  function creditRoleGroups(version) {
    const groups = [];
    ((version && (version.display_credits || version.credits)) || []).forEach(
      function (credit) {
        let group = groups.find(function (row) {
          return row.role === credit.role;
        });
        if (!group) {
          group = {
            role: credit.role,
            label: credit.role_label || deps.creatorRoleLabel(credit.role),
            credits: [],
          };
          groups.push(group);
        }
        group.credits.push(credit);
      },
    );
    return groups;
  }

  function normName(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\ufe0e\ufe0f]/g, "")
      .replace(/[‘’]/g, "'")
      .replace(/[‐‑‒–—−－]/g, "-")
      .replace(/・/g, "·")
      .replace(/[\s　]+/g, "");
  }

  function togglePlay() {
    return deps.playerController.togglePlay();
  }

  function seek(seconds) {
    deps.playerController.seekTo(seconds);
  }

  function removeQueueItem(index) {
    deps.playerController.removeQueueItem(index);
  }

  function moveQueueItem(index, target) {
    deps.playerController.moveQueueItemTo(index, target);
  }

  function clearQueue() {
    deps.playerController.clearQueue();
  }

  function fixAvatarSrc(html) {
    return String(html || "").replace(
      /(["'])uma_avatars\//g,
      "$1/uma_avatars/",
    );
  }

  function hideEncorePerf(html) {
    return String(html || "").replace(
      /<td class="setlist-song">安可<\/td>\s*<td class="setlist-perf">/g,
      '<td class="setlist-song">安可</td><td class="setlist-perf encore-hide">',
    );
  }

  function setRelPage(p) {
    if (p === "…") return;
    const n = parseInt(p, 10);
    if (isNaN(n)) return;
    if (n < 1 || n > deps.relPageCount.value) return;
    deps.relPage.value = n;
    deps.loadAlbums();
    deps.pushUrl();
    const el = document.querySelector("#tab-db-albums .album-database-grid");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goRelPage(dir) {
    setRelPage(deps.relPage.value + dir);
  }

  const statLive = deps.computed(function () {
    if (homeStats.live !== null) return homeStats.live;
    return deps.eventsAll.value.filter(function (event) {
      return event.kind === "concert";
    }).length;
  });

  const statGongyan = deps.computed(function () {
    if (homeStats.performances !== null) return homeStats.performances;
    return deps.eventsAll.value.reduce(function (total, event) {
      return total + (event.sessions || []).length;
    }, 0);
  });

  const nextUpcomingHref = deps.computed(function () {
    const e = deps.nextUpcomingEvent.value;
    return e ? deps.routes.events(e.id) : null;
  });

  function openNextUpcoming() {
    const e = deps.nextUpcomingEvent.value;
    if (!e) return;
    deps.openEvent(e.id);
  }

  function decodeHtml(s) {
    if (!s) return "";
    var d = document.createElement("div");
    d.innerHTML = s;
    return d.textContent || "";
  }

  function setEvTime(v) {
    if (!["all", "upcoming", "past", "announced"].includes(v)) return;
    deps.evTime.value = v;
    deps.eventsPage.value = 1;
    deps.pushUrl();
  }

  function setEvKind(value) {
    deps.evKind.value = value;
    deps.eventsPage.value = 1;
    deps.pushUrl();
  }

  function setEvMode(value) {
    deps.evMode.value = value;
    deps.eventsPage.value = 1;
    deps.pushUrl();
  }

  function setEvYear(value) {
    deps.evYear.value = value;
    deps.eventsPage.value = 1;
    deps.pushUrl();
  }

  function setEvSeries(value) {
    deps.evSeries.value = value;
    deps.eventsPage.value = 1;
    deps.pushUrl();
  }
  function start() {
    syncBodyBackground(home.value);
    deps.watch(home, syncBodyBackground);
    window.umaNavigate = deps.navigateTo;
    deps.watch(
      function () {
        const crumbs = breadcrumbItems.value;
        const entity = crumbs.length ? crumbs[crumbs.length - 1].label : "";
        const section = {
          profile: "资料",
          pedigree: "血统溯源",
          songs: "歌曲",
          anime: "动画出演",
          events: "活动出演",
          episodes: "剧集",
          characters: "角色",
          music: "音乐",
          staff: "制作人员",
          lyrics: "歌词",
          credits: "创作署名",
          performances: "演出",
          releases: "收录",
          works: "作品",
          collaborators: "合作",
        }[
          deps.charDetail.value
            ? deps.charSection.value
            : deps.voiceDetail.value
              ? deps.voiceSection.value
              : deps.songDetail.value
                ? deps.songSection.value
                : deps.creatorDetail.value
                  ? deps.creatorSection.value
                  : deps.animeDetail.value
                    ? deps.animeSection.value
                    : ""
        ];
        const directory =
          activeTab.value === "database"
            ? {
                characters: "角色",
                voice: "声优",
                songs: "歌曲",
                albums: "专辑",
                creators: "创作者",
                anime: "动漫",
                staff: "制作人员",
                other:
                  deps.otherSection.value === "horses" ? "原型马" : "资料库",
              }[dbView.value]
            : { news: "新闻", live: "活动", links: "友链" }[activeTab.value];
        return home.value
          ? "赛马娘演出综合站"
          : [entity || directory, entity && section, "赛马娘演出综合站"]
              .filter(Boolean)
              .join(" · ");
      },
      function (title) {
        document.title = title;
      },
      { immediate: true },
    );
    Vue.watch(deps.charDetail, function () {
      if (typeof window.renderCharacterDetail === "function")
        Vue.nextTick(function () {
          window.renderCharacterDetail(null);
        });
      Vue.nextTick(deps.renderCharBlood);
    });
    window.voiceProfileForName = deps.voiceProfileForName;
    window.vaLink = function (name) {
      var n = String(name || "");
      if (!n) return n;
      var profile = deps.voiceProfileForName(n);
      if (profile)
        return (
          '<a href="' + deps.routes.voiceActors(profile.id) + '">' + n + "</a>"
        );
      return n;
    };
    window.umaCoverThumb = deps.coverThumb;
  }
  return {
    start,
    activateNavGroup,
    activeTab,
    backToTop,
    backTopVisible,
    breadcrumbItems,
    clearQueue,
    closeNavGroup,
    contactEmails,
    contactMailto,
    contextBack,
    creditRoleGroups,
    dataScriptPromises,
    dbView,
    decodeHtml,
    fix,
    fixAvatarSrc,
    fixDone,
    fixMailto,
    fixSendState,
    fixTitleOptions,
    goContributeContact,
    goContributeFix,
    goHome,
    goLegal,
    goRelPage,
    hideEncorePerf,
    historyKindOptions,
    home,
    homeStats,
    isAtomicView,
    listParamsFromUrl,
    loadDataScript,
    loadHomeSummaryIfNeeded,
    moveQueueItem,
    navItemActive,
    navItems,
    navNavigate,
    nextUpcomingHref,
    normName,
    openNavGroup,
    openNextUpcoming,
    pagerList,
    removeQueueItem,
    resetPageScroll,
    routeSegments,
    seek,
    setEvKind,
    setEvMode,
    setEvSeries,
    setEvTime,
    setEvYear,
    setRelPage,
    showContextBack,
    statGongyan,
    statLive,
    submitFix,
    togglePlay,
    updateBackTop,
  };
}
