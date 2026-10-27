import { preloadPage } from "/uma_tools/frontend/pages.js";
/* routing state and behavior; external dependencies are explicit live ports. */
export function createRouting(deps) {
  const routeReady = deps.ref(false);
  const navigationPending = deps.ref(false);
  const routeProgress = deps.ref(false);
  const routeEntering = deps.ref(false);
  const routePendingAtomic = deps.ref(false);
  const routePendingTitle = deps.ref('');
  let progressTimer, enterTimer, navigationStarted = 0;

  function beginRouteFeedback(path, title = '') {
    clearTimeout(progressTimer); clearTimeout(enterTimer);
    navigationStarted = performance.now();
    routeProgress.value = false; routeEntering.value = false;
    navigationPending.value = true;
    routePendingAtomic.value = path ? routeWillBeAtomic(path) : true;
    routePendingTitle.value = title;
    progressTimer = setTimeout(() => { if (navigationStarted) routeProgress.value = true; }, 120);
  }

  function finishRouteFeedback() {
    if (!navigationStarted || !routeReady.value || navigationPending.value ||
        (deps.activeTab.value === 'news' && deps.newsDetailLoading.value)) return;
    const started = navigationStarted;
    routeEntering.value = performance.now() - started > 100;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (started !== navigationStarted || navigationPending.value ||
          (deps.activeTab.value === 'news' && deps.newsDetailLoading.value)) return;
      clearTimeout(progressTimer);
      routeProgress.value = false;
      navigationStarted = 0;
      enterTimer = setTimeout(() => { routeEntering.value = false; }, 180);
    }));
  }

  function stageRoute(path, title) {
    beginRouteFeedback(path, title);
    const parts = new URL(path, window.location.origin).pathname.split('/').filter(Boolean).slice(1);
    deps.home.value = parts.length === 0;
    if (parts[0] === 'news') deps.activeTab.value = 'news';
    else if (parts[0] === 'events') deps.activeTab.value = 'live';
    else if (parts[0] === 'music' || parts[0] === 'database') {
      deps.activeTab.value = 'database';
      deps.dbView.value = ({'voice-actors':'voice',horses:'other'})[parts[1]] || parts[1] || 'index';
    }
  }

  const routeError = deps.ref("");

  const notFound = deps.ref(false);

  const navigationRevision = deps.ref(0);

  const navigationError = deps.ref("");
  const navigationRetry = deps.ref(null);

  let pendingEntitySource = false;

  let entityRequestRevision = 0;

  let restoringRoute = false;

  function prepareCurrentRoute() {
    const seg = deps.routeSegments();
    if (!seg.length) return Promise.resolve();
    const first = (seg[0] || "").toLowerCase();
    if (first === "news") {
      return seg.length > 1 ? Promise.resolve() : deps.loadNews(false, new URL(window.location.href).searchParams.get('q') || '');
    }
    if (first === "music") {
      const musicSection = (seg[1] || "").toLowerCase();
      if (musicSection === "creators")
        return Promise.all([
          seg.length > 2 ? Promise.resolve() : deps.loadCreatorCatalog(deps.listParamsFromUrl()),
        ]);
      if (musicSection === "songs")
        return seg.length > 2
          ? Promise.resolve()
          : deps.loadSongCatalog(deps.listParamsFromUrl());
      return seg.length > 2
        ? Promise.resolve()
        : deps.loadAlbums(deps.listParamsFromUrl());
    }
    if (first === "events")
      return Promise.all([
        seg.length > 1
          ? Promise.resolve()
          : deps.loadEvents(deps.listParamsFromUrl()),
      ]);
    if (first === "resources") return Promise.resolve();
    if (first !== "database") return Promise.resolve();
    const sub = (seg[1] || "").toLowerCase();
    if (!sub) return deps.loadCharacterIndexData().then(deps.loadCharacterUi);
    if (sub === "voice-actors") {
      return Promise.all([
        deps.loadVoiceData().then(() => {
          const actor = seg[2] && deps.findVaBySlug(decodeURIComponent(seg[2]));
          return actor ? deps.loadVoiceData(actor.id) : null;
        }),
        deps.loadCharacterIndexData(),
      ]).then(deps.loadCharacterUi);
    }
    if (sub === "characters") {
      const charPath = (seg[2] || "").toLowerCase();
      const characterReady =
        charPath &&
        charPath !== "intro" &&
        charPath !== "room" &&
        charPath !== "videos"
          ? Promise.all([deps.loadCharacterDetailData(), deps.loadVoiceData()])
          : deps.loadCharacterIndexData();
      return Promise.all([
        Promise.resolve(characterReady),
        deps.loadHorsesListData().catch(() => null),
        deps.loadPedigreeMeta(),
      ]).then(deps.loadCharacterUi);
    }
    if (sub === "anime") {
      const animePath = (seg[2] || "").toLowerCase();
      if (!animePath) return deps.loadAnimeCatalog();
      return Promise.all([
        deps.loadAnimeRelatedMedia(animePath),
        deps.loadCharacterIndexData(),
        deps.loadVoiceData(),
      ]);
    }
    if (sub === "staff")
      return deps.loadAnimeCatalog(
        seg[2] ? "person" : "people",
        seg[2] ? decodeURIComponent(seg[2]) : "",
      );
    if (sub === "horses")
      return Promise.all([
        seg.length > 2
          ? deps.loadHorsesData(decodeURIComponent(seg[2]))
          : deps.loadHorsesListData(deps.listParamsFromUrl()),
        deps.loadCharacterIndexData(),
      ]);
    return Promise.resolve();
  }

  function clearEntityDetails(except) {
    if (except !== "news") {
      deps.newsDetail.value = null;
      deps.newsDetailBody.value = "";
    }
    if (except !== "event") {
      deps.eventDetail.value = null;
      deps.selectedEventSessionId.value = "";
      deps.liveView.value = "eventHub";
    }
    if (except !== "album") deps.albumDetail.value = null;
    if (except !== "song") deps.songDetail.value = null;
    if (except !== "creator") deps.creatorDetail.value = null;
    if (except !== "character") deps.charDetail.value = null;
    if (except !== "voice") deps.voiceDetail.value = null;
    if (except !== "staff") deps.staffDetail.value = null;
    if (except !== "horse") deps.horseDetail.value = null;
    if (except !== "anime") {
      deps.animeDetail.value = null;
      deps.animeUnitDetail.value = null;
    }
  }

  function routeWillBeAtomic(path) {
    const clean = String(path || "")
      .split("?")[0]
      .replace(/\/+$/, '')
      .replace(/^\/zh-Hans/i, "");
    return (
      /^\/news\/[^/]+$/.test(clean) ||
      /^\/events\/[^/]+(?:\/sessions\/[^/]+)?$/.test(clean) ||
      /^\/music\/(?:songs|albums|creators)\/[^/]+(?:\/[^/]+)?$/.test(clean) ||
      /^\/database\/(?:characters|voice-actors|horses|staff)\/[^/]+(?:\/[^/]+)?$/.test(
        clean,
      ) ||
      /^\/database\/anime\/[^/]+(?:\/episodes\/[^/]+)?$/.test(clean)
    );
  }

  function beginEntityNavigation() {
    const fromRoute = restoringRoute;
    if (!fromRoute) {
      beginRouteFeedback();
      routeReady.value = false;
    }
    if (!fromRoute)
      history.replaceState(
        Object.assign({}, history.state, { scrollY: window.scrollY }),
        "",
        currentUrlPath(),
      );
    navigationError.value = "";
    navigationRetry.value = null;
    deps.cancelNewsDetailRequest();
    navigationRevision.value += 1;
    pendingEntitySource = !fromRoute && routeWillBeAtomic(currentUrlPath());
    deps.home.value = false;
    notFound.value = false;
    const revision = ++entityRequestRevision;
    const sourcePath = currentUrlPath();
    return Object.assign(
      function () {
        return (
          revision === entityRequestRevision && sourcePath === currentUrlPath()
        );
      },
      { fromRoute },
    );
  }

  function applyCurrentRoute(title = '') {
    const canonicalPath = deps.routes.resolve(currentUrlPath());
    if (canonicalPath !== currentUrlPath()) history.replaceState(history.state, '', canonicalPath);
    routeReady.value = false;
    stageRoute(canonicalPath, title);
    routeError.value = "";
    const revision = ++navigationRevision.value;
    entityRequestRevision += 1;
    clearEntityDetails();
    const sourcePath = currentUrlPath();
    let preparedEntityRevision;
    return Promise.all([prepareCurrentRoute(), preloadPage(canonicalPath)]).then(apply).catch(function (error) {
      if (
        (revision === navigationRevision.value || preparedEntityRevision === entityRequestRevision) &&
        sourcePath === currentUrlPath()
      ) {
        if (error?.message === "HTTP 404") {
          notFound.value = true;
          deps.activeTab.value = "not-found";
        } else routeError.value = "资料暂时无法载入，请重试。";
        routeReady.value = true;
        navigationPending.value = false;
        finishRouteFeedback();
      }
    });
    function apply() {
      if (
        revision === navigationRevision.value &&
        sourcePath === currentUrlPath()
      ) {
        const pending = syncFromUrl();
        const requestRevision = entityRequestRevision;
        preparedEntityRevision = requestRevision;
        // News already has a title/date placeholder and its own body state.
        if (/^\/zh-Hans\/news\/[^/]+/.test(sourcePath)) {
          routeReady.value = true;
          navigationPending.value = false;
        }
        return Promise.resolve(pending).then(function () {
          if (requestRevision === entityRequestRevision) {
            routeReady.value = true;
            navigationPending.value = false;
            clampLocalPages();
            finishRouteFeedback();
          }
        });
      }
    }
  }

  function navigateTo(path, replace, title = '') {
    if (/^https?:/.test(path)) {
      const url = new URL(path);
      path = url.pathname + url.search;
    }
    const method = replace ? "replaceState" : "pushState";
    history.replaceState(
      Object.assign({}, history.state, { scrollY: window.scrollY }),
      "",
      currentUrlPath(),
    );
    const fromEntity = replace
      ? !!(history.state && history.state.fromEntity)
      : routeWillBeAtomic(currentUrlPath());
    if (currentUrlPath() !== path)
      history[method](
        {
          umaInternal: true,
          entity: routeWillBeAtomic(path),
          fromEntity: fromEntity,
        },
        "",
        path,
      );
    const pending = applyCurrentRoute(title);
    deps.resetPageScroll();
    return pending;
  }

  function retryCurrentRoute() {
    navigateTo(currentUrlPath(), true);
  }

  function currentUrlPath() {
    return window.location.pathname + window.location.search;
  }

  function pushUrl(replace) {
    replace = replace || restoringRoute;
    let path = deps.routes.home();
    if (!deps.home.value) {
      if (deps.activeTab.value === "news") {
        if (deps.newsDetail.value) {
          path = deps.routes.news(deps.newsDetail.value.announce_id);
        } else {
          path = deps.routes.query(deps.routes.news(), {
            q: deps.newsQuery.value,
            range: deps.newsRange.value,
            type: deps.newsType.value,
            page: deps.newsPage.value,
          });
        }
      } else if (deps.activeTab.value === "live") {
        if (deps.liveView.value === "eventDetail" && deps.eventDetail.value) {
          path = deps.routes.events(
            deps.eventDetail.value.id,
            deps.selectedEventSessionId.value,
          );
        } else {
          path = deps.routes.query(deps.routes.events(), {
            q: deps.eventsQuery.value,
            time: deps.evTime.value,
            kind: deps.evKind.value,
            mode: deps.evMode.value,
            year: deps.evYear.value,
            series: deps.evSeries.value,
            page: deps.eventsPage.value,
          });
        }
      } else if (deps.activeTab.value === "database") {
        if (deps.dbView.value === "characters") {
          path = deps.charDetail.value
            ? deps.routes.characters(deps.charDetail.value.id, deps.charSection.value)
            : deps.routes.query(deps.routes.characters(), {
                q: document.querySelector('#cIntroSearch')?.value || '',
                sort: deps.charSort.value === 'default' ? '' : deps.charSort.value,
              });
        } else if (deps.dbView.value === "voice") {
          path = deps.voiceDetail.value
            ? deps.routes.voiceActors(deps.voiceDetail.value.id, deps.voiceSection.value)
            : deps.routes.query(deps.routes.voiceActors(), {
                q: document.querySelector('#vaSearch')?.value || '',
              });
        } else if (deps.dbView.value === "albums") {
          path = deps.albumDetail.value
            ? deps.routes.albums(deps.albumDetail.value.data.id)
            : deps.routes.query(deps.routes.albums(), {
                q: deps.relQuery.value,
                work: deps.relWork.value,
                release_series: deps.relSeries.value,
                type: deps.relFilter.value,
                year: deps.relYear.value,
                sort: deps.relSort.value === "newest" ? "" : deps.relSort.value,
                page: deps.relPage.value,
              });
        } else if (deps.dbView.value === "songs") {
          path = deps.routes.songs(
            deps.songDetail.value && deps.songDetail.value.id,
            deps.songSection.value,
          );
          if (deps.songDetail.value) {
            path = deps.routes.query(path, {
              version: deps.songLinkVersion.value,
              release: deps.songLinkRelease.value,
            });
          } else {
            path = deps.routes.query(deps.routes.songs(), {
              q: deps.songDbQuery.value,
              page: deps.songDbPage.value,
            });
          }
        } else if (deps.dbView.value === "creators") {
          path = deps.routes.creators(
            deps.creatorDetail.value && deps.creatorDetail.value.id,
            deps.creatorSection.value,
          );
          if (!deps.creatorDetail.value) {
            path = deps.routes.query(deps.routes.creators(), {
              q: deps.creatorQuery.value,
              page: deps.creatorPage.value,
            });
          }
        } else if (deps.dbView.value === "anime") {
          if (deps.animeDetail.value) {
            const current = new URL(window.location.href);
            const workPath = deps.routes.anime(deps.animeDetail.value.id);
            const sameWork = current.pathname === workPath || current.pathname.startsWith(workPath + "/");
            path = deps.routes.query(
              deps.routes.anime(
                deps.animeDetail.value.id,
                deps.animeUnitDetail.value && deps.animeUnitDetail.value.id,
              ),
              {
                section: deps.animeSection.value,
                staff: deps.animeStaffQuery.value,
                edition:
                  deps.animeDetail.value.id === "anime-rttt"
                    ? deps.animeEdition.value
                    : "",
                still: deps.animeStillUnit.value,
                episodes: deps.animeEpisodeQuery.value,
                version: sameWork ? current.searchParams.get("version") : "",
                release: sameWork ? current.searchParams.get("release") : "",
              },
            );
          } else {
            path = deps.routes.query(deps.routes.anime(), {
              q: deps.animeQuery.value,
              format: deps.animeFormat.value,
              status: deps.animeStatus.value,
              sort:
                deps.animeSort.value === "newest" ? "" : deps.animeSort.value,
            });
          }
        } else if (deps.dbView.value === "staff") {
          path = deps.routes.query(
            deps.routes.staff(
              deps.staffDetail.value && deps.staffDetail.value.id,
            ),
            {
              q: deps.staffDetail.value ? "" : deps.staffQuery.value,
              page: deps.staffDetail.value ? "" : deps.staffPage.value,
            },
          );
        } else if (deps.dbView.value === "other") {
          if (
            !deps.horseDetail.value &&
            deps.otherSection.value === "relationships"
          ) {
            path = deps.routes.other();
          } else if (deps.otherSection.value === "horses") {
            path = deps.routes.query(
              deps.routes.horses(
                deps.horseDetail.value && deps.horseDetail.value.id,
              ),
              {
                q: deps.horseQuery.value,
                page: deps.horsePage.value,
                sex: deps.horseSex.value,
                sort: deps.horseSort.value === "newest" ? "" : deps.horseSort.value,
              },
            );
          } else if (deps.otherSection.value === "videos") {
            path = deps.routes.videos();
          } else if (deps.otherSection.value === "jockeys") {
            path = deps.routes.jockeys();
          } else {
            path = deps.routes.relationships();
          }
        } else {
          path = deps.routes.characters();
        }
      } else if (deps.activeTab.value === "contribute") {
        path = deps.routes.contribute("fix");
      } else if (deps.activeTab.value === "contribute-contact") {
        path = deps.routes.contribute("contact");
      } else if (deps.activeTab.value === "legal-privacy") {
        path = deps.routes.legal("privacy");
      } else if (deps.activeTab.value === "legal-terms") {
        path = deps.routes.legal("terms");
      } else if (deps.activeTab.value === "links") {
        path = deps.routes.links();
      } else {
        path = deps.LANG_PREFIX + "/" + deps.activeTab.value;
      }
    }
    if (currentUrlPath() !== path) {
      const targetEntity = deps.isAtomicView();
      const previousState = history.state || {};
      const fromEntity =
        targetEntity &&
        (pendingEntitySource || (replace && previousState.fromEntity));
      const nextState = Object.assign({}, previousState, {
        umaInternal: true,
        entity: targetEntity,
        fromEntity: !!fromEntity,
      });
      history[replace ? "replaceState" : "pushState"](nextState, "", path);
      navigationRevision.value += 1;
    }
    if (deps.newsDetailRequest && deps.newsDetailRequest.path !== path)
      deps.cancelNewsDetailRequest();
    pendingEntitySource = false;
    if (navigationPending.value && !restoringRoute) {
      navigationPending.value = false;
      routeReady.value = true;
      finishRouteFeedback();
    }
  }

  function syncFromUrl() {
    const canonicalPath = deps.routes.resolve(currentUrlPath(), {
      eventSeries: Object.keys(deps.eventSeriesMap.value).length ? Object.keys(deps.eventSeriesMap.value) : undefined,
      albumYears: deps.albumYears.value.length ? deps.albumYears.value : undefined,
    });
    if (canonicalPath !== currentUrlPath())
      history.replaceState(history.state, "", canonicalPath);
    navigationError.value = "";
    entityRequestRevision += 1;
    navigationRetry.value = null;
    restoringRoute = true;
    try {
      const url = new URL(window.location.href);
      const raw = url.pathname.split("/").filter(Boolean);
      const canonicalLanguage = raw[0] === deps.routes.language;
      const seg = canonicalLanguage ? raw.slice(1) : [];
      const first = (seg[0] || "").toLowerCase();
      if (!(first === "news" && seg[1])) deps.cancelNewsDetailRequest();

      deps.albumDetail.value = null;
      deps.newsDetail.value = null;
      deps.eventDetail.value = null;
      deps.voiceDetail.value = null;
      deps.charDetail.value = null;
      deps.songDetail.value = null;
      deps.creatorDetail.value = null;
      deps.horseDetail.value = null;
      deps.animeDetail.value = null;
      deps.animeUnitDetail.value = null;
      deps.staffDetail.value = null;
      deps.liveView.value = "eventHub";
      deps.selectedEventSessionId.value = "";
      deps.activeTab.value = "database";
      deps.dbView.value = "index";
      deps.home.value = canonicalLanguage && seg.length === 0;
      notFound.value = !canonicalLanguage;
      if (deps.home.value || notFound.value) return;

      function reject() {
        notFound.value = true;
        deps.activeTab.value = "not-found";
        deps.dbView.value = "index";
      }

      if (first === "news" && seg.length <= 2) {
        deps.activeTab.value = "news";
        if (seg[1]) return deps.openNews(decodeURIComponent(seg[1]));
        else {
          deps.newsQuery.value = url.searchParams.get("q") || "";
          deps.newsRange.value = ["7", "30", "90"].includes(
            url.searchParams.get("range"),
          )
            ? url.searchParams.get("range")
            : "all";
          deps.newsType.value = ["media", "game", "cd"].includes(
            url.searchParams.get("type"),
          )
            ? url.searchParams.get("type")
            : "all";
          deps.newsPage.value = Math.max(
            1,
            parseInt(url.searchParams.get("page") || "1", 10) || 1,
          );
        }
      } else if (
        first === "events" &&
        (seg.length === 1 ||
          seg.length === 2 ||
          (seg.length === 4 && seg[2] === "sessions"))
      ) {
        deps.activeTab.value = "live";
        const requested = seg[1] ? decodeURIComponent(seg[1]) : "";
        if (requested)
          return deps.openEvent(
            requested,
            seg[3]
              ? decodeURIComponent(seg[3])
              : url.searchParams.get("session") || "",
          );
        else {
          deps.eventsQuery.value = url.searchParams.get("q") || "";
          deps.evTime.value =
            ["upcoming", "past", "announced", "cancelled"].indexOf(
              url.searchParams.get("time"),
            ) >= 0
              ? url.searchParams.get("time")
              : "all";
          deps.evKind.value =
            ["concert", "onsite", "official_program"].indexOf(
              url.searchParams.get("kind"),
            ) >= 0
              ? url.searchParams.get("kind")
              : "all";
          deps.evMode.value = ["online", "onsite"].includes(url.searchParams.get("mode"))
            ? url.searchParams.get("mode") : "all";
          deps.evYear.value =
            /^20\d{2}$/.test(url.searchParams.get("year") || "") ||
            url.searchParams.get("year") === "unknown"
              ? url.searchParams.get("year")
              : "all";
          deps.evSeries.value = url.searchParams.get("series") || "all";
          const selectedSeries = deps.eventSeriesMap.value[deps.evSeries.value];
          if (selectedSeries) deps.evKind.value = selectedSeries.kind;
          if (deps.evSeries.value === 'unclassified' && deps.evKind.value === 'all') deps.evSeries.value = 'all';
          deps.eventsPage.value = Math.max(
            1,
            parseInt(url.searchParams.get("page") || "1", 10) || 1,
          );
        }
      } else if (first === "music" && seg[1] === "songs" && seg.length <= 4) {
        deps.activeTab.value = "database";
        deps.dbView.value = "songs";
        const requested = seg[2] ? decodeURIComponent(seg[2]) : "";
        const section = seg[3] || "releases";
        if (requested && deps.routes.sections.song.indexOf(section) < 0)
          return reject();
        deps.songSection.value = section;
        deps.songDbQuery.value = url.searchParams.get("q") || "";
        deps.songDbPage.value = Math.max(
          1,
          parseInt(url.searchParams.get("page") || "1", 10) || 1,
        );
        if (requested) return deps.openSong(requested, section);
      } else if (
        first === "music" &&
        seg[1] === "creators" &&
        seg.length <= 4
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "creators";
        const requested = seg[2] ? decodeURIComponent(seg[2]) : "";
        const section = seg[3] || "works";
        if (requested && deps.routes.sections.creator.indexOf(section) < 0)
          return reject();
        deps.creatorSection.value = section;
        deps.creatorQuery.value = url.searchParams.get("q") || "";
        deps.creatorPage.value = Math.max(
          1,
          parseInt(url.searchParams.get("page") || "1", 10) || 1,
        );
        if (requested) return deps.openCreator(requested, section);
      } else if (first === "music" && seg[1] === "albums" && seg.length <= 3) {
        deps.activeTab.value = "database";
        deps.dbView.value = "albums";
        if (!seg[2]) {
          deps.relQuery.value = url.searchParams.get("q") || "";
          deps.relWork.value = url.searchParams.get("work") || "";
          deps.relSeries.value = url.searchParams.get("release_series") || "";
          deps.relFilter.value =
            url.searchParams.get("type") === "数字单曲"
              ? "单曲"
              : url.searchParams.get("type") || "";
          deps.relYear.value = url.searchParams.get("year") || "";
          deps.relSort.value =
            url.searchParams.get("sort") === "name" ? "name" : "newest";
          deps.relPage.value = Math.max(
            1,
            parseInt(url.searchParams.get("page") || "1", 10) || 1,
          );
        }
        if (seg[2]) return deps.openAlbum({ id: decodeURIComponent(seg[2]) });
      } else if (
        first === "database" &&
        seg[1] === "characters" &&
        seg.length <= 4
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "characters";
        const requested = seg[2] ? decodeURIComponent(seg[2]) : "";
        const section = seg[3] || "profile";
        if (requested && deps.routes.sections.character.indexOf(section) < 0)
          return reject();
        deps.charDetail.value = requested ? deps.findCharById(requested) : null;
        deps.charSection.value = section;
        deps.charSort.value = url.searchParams.get('sort') || 'default';
        if (requested && !deps.charDetail.value && window.CHAR_INDEX) reject();
        else if (deps.charDetail.value && section !== "profile")
          deps.setCharSection(section);
      } else if (
        first === "database" &&
        seg[1] === "voice-actors" &&
        seg.length <= 4
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "voice";
        const requested = seg[2] ? decodeURIComponent(seg[2]) : "";
        const section = seg[3] || "profile";
        if (requested && deps.routes.sections.voiceActor.indexOf(section) < 0)
          return reject();
        deps.voiceDetail.value = requested
          ? deps.findVaBySlug(requested)
          : null;
        deps.voiceSection.value = section;
        if (
          requested &&
          !deps.voiceDetail.value &&
          deps.voiceProfiles.value.length
        )
          reject();
        else if (deps.voiceDetail.value && section !== "profile")
          deps.setVoiceSection(section);
      } else if (
        first === "database" &&
        seg[1] === "anime" &&
        (seg.length <= 3 || (seg.length === 5 && seg[3] === "episodes"))
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "anime";
        const requestedWork = seg[2] ? decodeURIComponent(seg[2]) : "";
        deps.animeEdition.value =
          url.searchParams.get("edition") === "web" ? "web" : "film";
        deps.animeStillUnit.value = url.searchParams.get("still") || "";
        deps.animeSection.value = [
          "episodes",
          "characters",
          "music",
          "staff",
          "stills",
        ].includes(url.searchParams.get("section"))
          ? url.searchParams.get("section")
          : seg[4]
            ? "characters"
            : "episodes";
        deps.animeStaffQuery.value = url.searchParams.get("staff") || "";
        deps.animeEpisodeQuery.value = url.searchParams.get("episodes") || "";
        if (requestedWork) {
          deps.animeDetail.value = deps.findAnimeWork(requestedWork);
          deps.animeUnitDetail.value = seg[4]
            ? deps.findAnimeUnit(decodeURIComponent(seg[4]))
            : null;
          if (
            (deps.animeCatalog.value.works || []).length &&
            seg[4] &&
            (!deps.animeUnitDetail.value ||
              deps.animeUnitDetail.value.work_id !== requestedWork)
          )
            return reject();
          if (
            deps.animeUnitDetail.value &&
            deps.animeDetail.value &&
            ["movie", "special"].includes(deps.animeDetail.value.format)
          ) {
            deps.animeUnitDetail.value = null;
            url.pathname = deps.routes.anime(requestedWork);
            url.searchParams.set("section", deps.animeSection.value);
            history.replaceState(
              history.state,
              "",
              url.pathname + url.search + url.hash,
            );
          } else if (
            deps.animeUnitDetail.value &&
            requestedWork === "anime-rttt"
          ) {
            deps.animeEdition.value = "web";
            url.searchParams.set("edition", "web");
            history.replaceState(
              history.state,
              "",
              url.pathname + url.search + url.hash,
            );
          }
          if (
            (deps.animeCatalog.value.works || []).length &&
            (!deps.animeDetail.value ||
              (seg[4] &&
                !deps.animeSingle.value &&
                (!deps.animeUnitDetail.value ||
                  deps.animeUnitDetail.value.work_id !== requestedWork)))
          )
            reject();
        } else {
          deps.animeQuery.value = url.searchParams.get("q") || "";
          deps.animeFormat.value =
            ["tv", "movie", "short", "web", "special", "unknown"].indexOf(
              url.searchParams.get("format"),
            ) >= 0
              ? url.searchParams.get("format")
              : "all";
          deps.animeStatus.value =
            ["completed", "airing", "announced"].indexOf(
              url.searchParams.get("status"),
            ) >= 0
              ? url.searchParams.get("status")
              : "all";
          deps.animeSort.value = ["oldest", "name"].includes(
            url.searchParams.get("sort"),
          )
            ? url.searchParams.get("sort")
            : "newest";
        }
      } else if (
        first === "database" &&
        seg[1] === "staff" &&
        seg.length <= 3
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "staff";
        deps.staffQuery.value = url.searchParams.get("q") || "";
        deps.staffPage.value = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
        deps.staffDetail.value = seg[2]
          ? (deps.animeCatalog.value.people || []).find(
              (person) =>
                person.id === decodeURIComponent(seg[2]) ||
                (person.alias_ids || []).includes(decodeURIComponent(seg[2])),
            ) || null
          : null;
        if (
          seg[2] &&
          deps.animeCatalog.value.works.length &&
          !deps.staffDetail.value
        )
          reject();
      } else if (
        first === "database" &&
        seg[1] === "other" &&
        seg.length === 2
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "other";
        deps.otherSection.value = "relationships";
      } else if (
        first === "database" &&
        seg[1] === "horses" &&
        seg.length <= 3
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "other";
        deps.otherSection.value = "horses";
        deps.horseQuery.value = url.searchParams.get("q") || "";
        deps.horsePage.value = Math.max(
          1,
          parseInt(url.searchParams.get("page") || "1", 10) || 1,
        );
        deps.horseSex.value = ["male", "female", "gelding"].includes(
          url.searchParams.get("sex"),
        )
          ? url.searchParams.get("sex")
          : "";
        deps.horseSort.value = ["oldest", "name"].includes(
          url.searchParams.get("sort"),
        )
          ? url.searchParams.get("sort")
          : "newest";
        deps.horseDetail.value =
          seg[2] && window.HORSES_DETAIL
            ? window.HORSES_DETAIL[decodeURIComponent(seg[2])] || null
            : null;
        if (seg[2] && !deps.horseDetail.value && window.HORSES_DETAIL) reject();
      } else if (
        first === "database" &&
        seg[1] === "relationships" &&
        seg.length === 2
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "other";
        deps.otherSection.value = "relationships";
      } else if (
        first === "database" &&
        seg[1] === "jockeys" &&
        seg.length <= 3
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "other";
        deps.otherSection.value = "jockeys";
      } else if (
        first === "resources" &&
        seg[1] === "videos" &&
        seg.length === 2
      ) {
        deps.activeTab.value = "database";
        deps.dbView.value = "other";
        deps.otherSection.value = "videos";
      } else if (
        first === "contribute" &&
        (seg[1] === "fix" || seg[1] === "contact") &&
        seg.length === 2
      ) {
        deps.activeTab.value =
          seg[1] === "contact" ? "contribute-contact" : "contribute";
        deps.fixDone.value = false;
        deps.resetFixState();
      } else if (
        first === "legal" &&
        (seg[1] === "privacy" || seg[1] === "terms") &&
        seg.length === 2
      ) {
        deps.activeTab.value =
          seg[1] === "privacy" ? "legal-privacy" : "legal-terms";
      } else if (first === "links" && seg.length === 1) {
        deps.activeTab.value = "links";
      } else {
        reject();
      }
      Vue.nextTick(deps.renderCharBlood);
    } finally {
      restoringRoute = false;
    }
    clampLocalPages();
  }

  function clampLocalPages() {
    if (navigationPending.value || !routeReady.value) return;
    let changed = false;
    const music = deps.activeTab.value === "database";
    [
      [
        deps.songDbPage,
        deps.songDbPageCount,
        deps.routes.songs(),
        music && deps.dbView.value === "songs",
      ],
      [
        deps.eventsPage,
        deps.eventsPageCount,
        deps.routes.events(),
        deps.activeTab.value === "live",
      ],
      [
        deps.creatorPage,
        deps.creatorPageCount,
        deps.routes.creators(),
        music && deps.dbView.value === "creators",
      ],
      [
        deps.newsPage,
        deps.newsPageCount,
        deps.routes.news(),
        deps.activeTab.value === "news",
      ],
      [
        deps.horsePage,
        deps.horsePageCount,
        deps.routes.horses(),
        music &&
          deps.dbView.value === "other" &&
          deps.otherSection.value === "horses",
      ],
      [
        deps.relPage,
        deps.relPageCount,
        deps.routes.albums(),
        music && deps.dbView.value === "albums",
      ],
      [deps.staffPage, deps.staffPageCount, deps.routes.staff(), music && deps.dbView.value === "staff"],
    ].forEach(function (pair) {
      const page = Math.min(Math.max(1, pair[0].value), pair[1].value);
      if (pair[0].value !== page) {
        pair[0].value = page;
        if (pair[3] && pair[2] === window.location.pathname) changed = true;
      }
    });
    if (changed && !restoringRoute && !deps.isAtomicView()) pushUrl(true);
  }
  function start() {
    deps.watch(navigationError, error => {
      if (!error) return;
      navigationPending.value = false; routeReady.value = true; finishRouteFeedback();
    });
    deps.watch(notFound, missing => {
      if (!missing) return;
      navigationPending.value = false; routeReady.value = true; finishRouteFeedback();
    });
    deps.watch(() => deps.newsDetailLoading.value, finishRouteFeedback);
    window.addEventListener('uma-page-rendered', finishRouteFeedback);
  }
  return {
    start,
    applyCurrentRoute,
    beginEntityNavigation,
    clampLocalPages,
    clearEntityDetails,
    currentUrlPath,
    navigateTo,
    navigationError,
    navigationRetry,
    navigationRevision,
    notFound,
    prepareCurrentRoute,
    pushUrl,
    get restoringRoute() {
      return restoringRoute;
    },
    set restoringRoute(value) {
      restoringRoute = value;
    },
    retryCurrentRoute,
    routeError,
    routeReady,
    navigationPending,
    routeProgress,
    routeEntering,
    routePendingAtomic,
    routePendingTitle,
    syncFromUrl,
  };
}
