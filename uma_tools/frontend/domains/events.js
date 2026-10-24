/* events state and behavior; external dependencies are explicit live ports. */
export function createEvents(deps) {
  const eventSongs = deps.ref([]);

  const liveView = deps.ref("eventHub");

  const eventsAll = deps.ref([]);

  const eventsTotal = deps.ref(0);

  const eventYearValues = deps.ref([]);

  let eventListRevision = 0;

  const eventSeries = deps.ref([]);

  const eventDetail = deps.ref(null);

  const selectedEventSessionId = deps.ref("");

  const homeNextEvent = deps.ref(null);

  const eventsError = deps.ref("");

  const eventsLoading = deps.ref(false);

  const eventsQuery = deps.ref("");

  const evTime = deps.ref("all");

  const evKind = deps.ref("all");

  const evMode = deps.ref("all");

  const evYear = deps.ref("all");

  const evSeries = deps.ref("all");

  const eventsPage = deps.ref(1);

  const eventsPerPage = 20;

  const charHistoryEvents = deps.computed(function () {
    const query = String(deps.charHistoryQuery.value || "")
      .trim()
      .toLowerCase();
    return (deps.charAppearance.value.events || []).filter(function (event) {
      if (
        deps.charHistoryKind.value !== "all" &&
        event.kind !== deps.charHistoryKind.value
      )
        return false;
      return (
        !query ||
        String(event.title || "")
          .toLowerCase()
          .indexOf(query) !== -1 ||
        String(event.date || "").indexOf(query) !== -1
      );
    });
  });

  function openEventUrl(path) {
    if (path) deps.navigateTo(path);
  }

  function onEventSetlistClick(event) {
    const voiceLink = event.target.closest("a[data-voice-id]");
    if (voiceLink) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      deps.openVoice(voiceLink.getAttribute("data-voice-id"));
      return;
    }
    var playButton = event.target.closest("button[data-play-key]");
    if (playButton) {
      const key = playButton.getAttribute("data-play-key");
      playEventTrackByKey(key);
      Vue.nextTick(() => {
        if (!playButton.isConnected)
          document
            .querySelector('button[data-play-key="' + key + '"]')
            ?.focus({ preventScroll: true });
      });
      return;
    }
    var addButton = event.target.closest("button[data-add-key]");
    if (addButton) {
      addEventTrackByKey(addButton.getAttribute("data-add-key"));
      window.UmaUi.flashAdded(addButton, added => {
        if (!addButton.isConnected) return;
        addButton.classList.toggle('entity-action-added', added);
        addButton.setAttribute('aria-label', added ? '已加入播放列表' : '加入播放列表');
        addButton.querySelector('path').setAttribute('d', added ? 'm5 12 4 4 10-10' : 'M12 5v14M5 12h14');
      });
      return;
    }
    var songLink = event.target.closest("a[data-song-id]");
    if (songLink) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      deps.openSong(songLink.getAttribute("data-song-id"), "performances");
      return;
    }
    var performer = event.target.closest("a[data-character-id]");
    if (performer) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      deps.openCharacter(performer.getAttribute("data-character-id"));
    }
  }

  function eventSessionTable(session) {
    if (!session || !session.setlist_html) return "";
    const html = deps.fixAvatarSrc(deps.hideEncorePerf(session.setlist_html));
    // A generated table may contain only the column header when no song rows
    // were collected. Treat that as empty so the whole setlist block stays
    // hidden instead of rendering a misleading blank frame.
    if (!/<tbody\b[\s\S]*?<tr\b[\s\S]*?<\/tr>/i.test(html)) return "";
    return deps.linkSetlistSongs(html, session.performances);
  }

  const eventSeriesMap = deps.computed(function () {
    const map = {};
    eventSeries.value.forEach(function (series) {
      map[series.id] = series;
    });
    return map;
  });

  const eventYears = deps.computed(function () {
    return eventYearValues.value;
  });

  const eventYearOptions = deps.computed(function () {
    return [{ value: "all", label: "全部" }].concat(
      eventYears.value.map(function (year) {
        return { value: year, label: year === "unknown" ? "未知" : year };
      }),
    );
  });

  const eventTypeOptions = deps.computed(function () {
    const groups = [
        ["concert", "音乐演出"],
        ["onsite", "线下活动"],
        ["official_program", "官方节目"],
      ].map(([kind, label]) => ({
        value: "group:" + kind,
        label,
        children: [
          { value: "kind:" + kind, label: "全部" + label },
          ...eventSeries.value
            .filter((series) => (series.kinds || [series.kind]).includes(kind))
            .map((series) => ({
              value: "series:" + (evKind.value === 'all' && evSeries.value === series.id && kind === (series.kind || (series.kinds || [])[0]) ? 'all' : kind) + ":" + series.id,
              label: series.name,
            })),
          { value: "series:" + kind + ":unclassified", label: "其他" + label },
        ],
      }));
    return [{ value: "kind:all", label: "全部" }].concat(groups);
  });

  const eventTypeSelection = deps.computed({
    get() {
      return evSeries.value !== "all"
        ? "series:" + evKind.value + ":" + evSeries.value
        : "kind:" + evKind.value;
    },
    set(value) {
      const [type, kind, id] = String(value).split(":");
      evSeries.value = type === "series" ? id : "all";
      evKind.value = kind;
      eventsPage.value = 1;
      deps.pushUrl();
    },
  });

  const eventsCurrentPage = eventsAll;

  const eventsPageCount = deps.computed(function () {
    return Math.max(1, Math.ceil(eventsTotal.value / eventsPerPage));
  });


  const eventsPageStart = deps.computed(function () {
    return eventsTotal.value ? (eventsPage.value - 1) * eventsPerPage + 1 : 0;
  });

  const eventsPageEnd = deps.computed(function () {
    return Math.min(eventsTotal.value, eventsPage.value * eventsPerPage);
  });

  const eventsPageList = deps.computed(function () {
    const total = eventsPageCount.value;
    const cur = eventsPage.value;
    const pages = [];
    const push = function (p) {
      if (pages.length && pages[pages.length - 1] === p) return;
      pages.push(p);
    };
    push(1);
    if (cur > 3) push("…");
    for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++)
      push(p);
    if (cur < total - 2) push("…");
    if (total > 1) push(total);
    return pages;
  });

  function setEventsPage(p) {
    if (p === "…") return;
    const n = parseInt(p, 10);
    if (isNaN(n)) return;
    if (n < 1 || n > eventsPageCount.value) return;
    eventsPage.value = n;
    deps.pushUrl();
    loadEvents();
    const el = document.getElementById("eventsRowsTop");
    if (el) el.scrollIntoView({ behavior: window.UmaUi.scrollBehavior(), block: "start" });
  }

  function goEventsPage(dir) {
    setEventsPage(eventsPage.value + dir);
  }

  function eventDateLabel(event) {
    if (!event || !event.date)
      return event && event.schedule_status === "announced_tba"
        ? "官方待公布"
        : "日期待补";
    return event.end_date && event.end_date !== event.date
      ? event.date + " — " + event.end_date
      : event.date;
  }

  function eventSummary(event) {
    const value = String((event && (event.summary_zh || event.summary)) || "").trim();
    if (!value || /(?:出处|提取码|网盘|https?:\/\/)/i.test(value)) return "";
    return value;
  }

  function eventStatusNewsId(event) {
    const source = String((event && event.status_source_url) || "");
    const match = source.match(/^https:\/\/umamusume\.jp\/news\/detail\?id=(\d+)(?:&|$)/);
    return match ? match[1] : "";
  }

  function eventKindLabel(kind) {
    return (
      { concert: "音乐演出", onsite: "线下活动", official_program: "官方节目" }[
        kind
      ] || "活动"
    );
  }

  function eventModeLabel(mode) {
    return { onsite: "现场", online: "线上" }[mode] || "形式待补";
  }

  function eventSeriesName(event) {
    const series = eventSeriesMap.value[(event && event.series_id) || ""];
    return series ? series.name : "";
  }

  const eventVoiceCast = deps.computed(function () {
    const event = eventDetail.value;
    const all = (event && event.cast) || [];
    const session = selectedEventSession.value;
    if (session && Array.isArray(session.cast))
      return session.cast;
    const allowed = new Set((session && session.character_ids) || []);
    if (((event && event.sessions) || []).length > 1 && allowed.size) {
      return all.filter(item => !item.voice_actor_id || allowed.has(item.character_id));
    }
    return ((event && event.sessions) || []).length > 1 ? [] : all;
  });

  const eventCharacterCast = deps.computed(function () {
    const event = eventDetail.value;
    const session = selectedEventSession.value;
    return [...new Set((session && session.character_ids) || (event && event.character_ids) || [])];
  });

  const eventUnscopedCast = deps.computed(function () {
    const event = eventDetail.value;
    if (!event || (event.sessions || []).length < 2) return [];
    const scoped = new Set();
    (event.sessions || []).forEach(function (session) {
      (session.cast || []).forEach(function (item) {
        scoped.add(item.voice_actor_id || "external:" + (item.name || item.person_type || "unknown"));
      });
      const characters = new Set(session.character_ids || []);
      (event.cast || []).forEach(function (item) {
        if (characters.has(item.character_id)) scoped.add(item.voice_actor_id || "external:" + (item.name || item.person_type || "unknown"));
      });
    });
    return (event.cast || []).filter(function (item) {
      const key = item.voice_actor_id || "external:" + (item.name || item.person_type || "unknown");
      return !scoped.has(key);
    });
  });

  function eventSongCount(event) {
    return window.UmaCatalog.eventSongCount(event);
  }

  const eventMediaCards = deps.computed(function () {
    const event = eventDetail.value;
    const seen = new Set();
    return ((event && event.media) || [])
      .map(function (item, index) {
        const videoId = window.UmaCatalog.youtubeVideoId(item.url) || window.UmaCatalog.youtubeVideoId(item.video_id);
        const url = String(
          item.url ||
            (videoId ? "https://www.youtube.com/watch?v=" + videoId : ""),
        );
        const key = videoId ? 'youtube:' + videoId : url;
        if (!key || seen.has(key)) return null;
        seen.add(key);
        let host = "";
        try {
          host = new URL(url).hostname.replace(/^www\./, "");
        } catch (error) {}
        const isYouTube =
          !!videoId || /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host);
        const isBilibili = /(^|\.)bilibili\.com$|(^|\.)b23\.tv$/.test(host);
        const platform = isYouTube
          ? "youtube"
          : isBilibili
            ? "bilibili"
            : "external";
        return {
          key: key,
          url: url,
          videoId: videoId,
          embedUrl: videoId
            ? "https://www.youtube-nocookie.com/embed/" + videoId
            : "",
          platform: platform,
          platformLabel: isYouTube
            ? "YouTube"
            : isBilibili
              ? "Bilibili"
              : host || "外部平台",
          label: item.label || "节目影像 " + (index + 1),
          image: (event && (event.image_preview || event.image)) ||
            "/uma_tools/img/event-covers/onsite.svg",
        };
      })
      .filter(Boolean);
  });

  const activeMediaKey = deps.ref("");

  function activateEventMedia(media) {
    if (media && media.embedUrl) activeMediaKey.value = media.key;
  }

  const selectedEventSession = deps.computed(function () {
    const sessions = (eventDetail.value && eventDetail.value.sessions) || [];
    return (
      sessions.find(function (session) {
        return session.id === selectedEventSessionId.value;
      }) ||
      sessions[0] ||
      null
    );
  });

  function eventPerformanceKey(performance, index) {
    if (performance && performance.id) return performance.id;
    const position = index === undefined
      ? ((selectedEventSession.value && selectedEventSession.value.performances) || []).indexOf(performance)
      : index;
    return [
      performance &&
        (performance.version_id || performance.song_id || performance.song),
      position >= 0 ? position : performance && performance.performance_index,
    ]
      .filter(function (value) {
        return value !== undefined && value !== null && value !== "";
      })
      .join("-");
  }

  const eventPlayableRows = deps.computed(function () {
    if (eventDetail.value?.schedule_status === 'cancelled' || selectedEventSession.value?.schedule_status === 'cancelled') return [];
    return (
      (selectedEventSession.value && selectedEventSession.value.performances) ||
      []
    )
      .map(function (performance, index) {
        const song = deps.findSong(performance.song_id || performance.song);
        const playable = deps.playableSongRelease(song, performance.version_id);
        return playable
          ? {
              key: eventPerformanceKey(performance, index),
              performance: performance,
              track: deps.buildReleasePlayerTrack(
                song,
                playable.version,
                playable.release,
              ),
            }
          : null;
      })
      .filter(Boolean);
  });

  function eventPlayableRow(key) {
    return (
      eventPlayableRows.value.find(function (row) {
        return row.key === key;
      }) || null
    );
  }

  function playEventTrackByKey(key) {
    const row = eventPlayableRow(key);
    if (row) deps.playerController.playTrack(row.track);
  }

  function addEventTrackByKey(key) {
    const row = eventPlayableRow(key);
    if (row)
      deps.playerController.enqueueTracks(
        [row.track],
        (eventDetail.value && eventDetail.value.title) || "活动歌单",
      );
  }

  function playEventTrack(performance) {
    playEventTrackByKey(eventPerformanceKey(performance));
  }

  function addEventTrack(performance) {
    addEventTrackByKey(eventPerformanceKey(performance));
  }

  function playEventSession() {
    const tracks = eventPlayableRows.value.map(function (row) {
      return row.track;
    });
    if (!tracks.length) return;
    deps.playerController.setQueue(
      tracks,
      0,
      (eventDetail.value && eventDetail.value.title) || "活动歌单",
      true,
    );
  }

  function enqueueEventSession() {
    const tracks = eventPlayableRows.value.map(function (row) {
      return row.track;
    });
    if (!tracks.length) return;
    deps.playerController.appendBlock(
      tracks,
      (eventDetail.value && eventDetail.value.title) || "活动歌单",
    );
  }

  function selectEventSession(sessionId) {
    selectedEventSessionId.value = sessionId;
    deps.pushUrl(true);
  }

  function openEvent(eventOrId, requestedSessionId) {
    const isCurrent = deps.beginEntityNavigation();
    const id =
      typeof eventOrId === "string" ? eventOrId : eventOrId && eventOrId.id;
    const show = function (data) {
      if (!isCurrent()) return;
      const found = data && data.event;
      if (!found) {
        deps.notFound.value = true;
        deps.activeTab.value = "not-found";
        return;
      }
      const aliasedSession = (found.sessions || []).find(session => (session.id_aliases || []).includes(requestedSessionId));
      if (aliasedSession) requestedSessionId = aliasedSession.id;
      if (requestedSessionId && !(found.sessions || []).some(session => session.id === requestedSessionId)) {
        deps.navigationError.value = "所请求的活动场次不存在，请返回活动列表选择有效场次。";
        return;
      }
      if (data.series) eventSeries.value = [...eventSeries.value.filter(series => series.id !== data.series.id), data.series];
      deps.clearEntityDetails("event");
      eventDetail.value = found;
      eventSongs.value = data.catalog_songs || [];
      activeMediaKey.value = "";
      const sessions = found.sessions || [];
      selectedEventSessionId.value = sessions.some(function (session) {
        return session.id === requestedSessionId;
      })
        ? requestedSessionId
        : (sessions[0] && sessions[0].id) || "";
      liveView.value = "eventDetail";
      deps.activeTab.value = "live";
      if (!isCurrent.fromRoute) deps.resetPageScroll();
      deps.pushUrl(isCurrent.fromRoute);
      deps.loadAnimeCatalogOptional("event", found.id);
    };
    return Promise.all([
      deps.api.request("/api/catalog/event" + deps.api.query({ id: id })),
      deps.loadCharacterIndexData(),
      deps.loadVoiceData(),
    ])
      .then(function (rows) {
        return show(rows[0]);
      })
      .catch(function () {
        if (isCurrent()) {
          deps.navigationError.value = "活动资料暂时无法载入，请重试。";
          deps.navigationRetry.value = () => openEvent(eventOrId, requestedSessionId);
        }
      });
  }

  const nextUpcomingEvent = deps.computed(function () {
    return homeNextEvent.value;
  });

  function onEventImageError(ev, event) {
    const image = ev && ev.target;
    if (image) window.UmaMedia.fallback(image, '/uma_tools/img/event-covers/onsite.svg');
  }

  function loadEvents(params) {
    const query = params || {
      q: eventsQuery.value,
      time: evTime.value,
      kind: evKind.value,
      mode: evMode.value,
      year: evYear.value,
      series: evSeries.value,
      page: eventsPage.value,
    };
    const revision = ++eventListRevision;
    eventsError.value = "";
    eventsLoading.value = true;
    return deps.api
      .request(
        "/api/catalog/events" +
          deps.api.query(
            Object.assign({}, query, { page_size: eventsPerPage }),
          ),
      )
      .then(function (data) {
        if (revision !== eventListRevision) return;
        eventsAll.value = data.items || [];
        eventSeries.value = data.series || [];
        eventYearValues.value = data.years || [];
        eventsTotal.value = data.total || 0;
        eventsPage.value = data.page || 1;
      })
      .catch(function () {
        if (revision === eventListRevision)
          eventsError.value = "活动资料暂时无法载入，请重试。";
      })
      .finally(function () {
        if (revision === eventListRevision) eventsLoading.value = false;
      });
  }

  let eventSearchTimer = 0;
  function start() {
    deps.watch(
      [eventsQuery, evTime, evKind, evMode, evYear, evSeries],
      function () {
        if (deps.restoringRoute) return;
        eventListRevision += 1;
        eventsPage.value = 1;
        deps.pushUrl(true);
        window.clearTimeout(eventSearchTimer);
        eventSearchTimer = window.setTimeout(function () {
          if (window.location.pathname === '/zh-Hans/events') loadEvents();
        }, 180);
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    activateEventMedia,
    activeMediaKey,
    addEventTrack,
    charHistoryEvents,
    enqueueEventSession,
    evKind,
    evMode,
    evSeries,
    evTime,
    evYear,
    eventDateLabel,
    eventDetail,
    eventKindLabel,
    eventMediaCards,
    eventModeLabel,
    eventPerformanceKey,
    eventPlayableRows,
    eventSeriesMap,
    eventSeriesName,
    eventSessionTable,
    eventSongCount,
    eventSongs,
    eventSummary,
    eventStatusNewsId,
    eventTypeOptions,
    eventTypeSelection,
    eventUnscopedCast,
    eventVoiceCast,
    eventCharacterCast,
    eventYearOptions,
    eventYears,
    eventsAll,
    eventsError,
    eventsLoading,
    eventsCurrentPage,
    eventsPage,
    eventsPageCount,
    eventsPageEnd,
    eventsPageList,
    eventsPageStart,
    eventsQuery,
    eventsTotal,
    goEventsPage,
    homeNextEvent,
    liveView,
    loadEvents,
    nextUpcomingEvent,
    onEventImageError,
    onEventSetlistClick,
    openEvent,
    openEventUrl,
    playEventSession,
    playEventTrack,
    selectEventSession,
    selectedEventSession,
    selectedEventSessionId,
    setEventsPage,
  };
}
