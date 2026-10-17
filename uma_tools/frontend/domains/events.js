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
      addButton.classList.add("entity-action-added");
      addButton.setAttribute("aria-label", "已加入播放列表");
      addButton.querySelector("path").setAttribute("d", "m5 12 4 4 10-10");
      window.setTimeout(() => {
        if (!addButton.isConnected) return;
        addButton.classList.remove("entity-action-added");
        addButton.setAttribute("aria-label", "加入播放列表");
        addButton.querySelector("path").setAttribute("d", "M12 5v14M5 12h14");
      }, 900);
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
    var performer = event.target.closest("button[data-character-id]");
    if (performer)
      deps.openCharacter(performer.getAttribute("data-character-id"));
  }

  function eventSessionTable(session) {
    return session && session.setlist_html
      ? deps.linkSetlistSongs(
          deps.fixAvatarSrc(deps.hideEncorePerf(session.setlist_html)),
          session.performances,
        )
      : "";
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
    return [{ value: "kind:all", label: "全部" }].concat(
      [
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
              value: "series:" + kind + ":" + series.id,
              label: series.name,
            })),
          { value: "series:" + kind + ":unclassified", label: "其他" + label },
        ],
      })),
    );
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
      evMode.value = "all";
      eventsPage.value = 1;
      deps.pushUrl();
    },
  });

  const eventsFiltered = deps.computed(function () {
    return eventsAll.value;
  });

  const eventsPageCount = deps.computed(function () {
    return Math.max(1, Math.ceil(eventsTotal.value / eventsPerPage));
  });

  const eventsPaged = deps.computed(function () {
    return eventsAll.value;
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
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const value = String((event && event.summary) || "").trim();
    if (!value || /(?:出处|提取码|网盘|https?:\/\/)/i.test(value)) return "";
    return value;
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
    const all = ((event && event.cast) || []).filter(function (item) {
      return item.voice_actor_id;
    });
    const session = selectedEventSession.value;
    if (session && Array.isArray(session.cast))
      return session.cast.filter(function (item) {
        return item.voice_actor_id;
      });
    const allowed = new Set((session && session.character_ids) || []);
    if (((event && event.sessions) || []).length > 1 && allowed.size) {
      return all.filter(function (item) {
        return allowed.has(item.character_id);
      });
    }
    return ((event && event.sessions) || []).length > 1 ? [] : all;
  });

  const eventUnscopedCast = deps.computed(function () {
    const event = eventDetail.value;
    if (!event || (event.sessions || []).length < 2) return [];
    const scoped = new Set();
    (event.sessions || []).forEach(function (session) {
      (session.cast || []).forEach(function (item) {
        if (item.voice_actor_id) scoped.add(item.voice_actor_id);
      });
      const characters = new Set(session.character_ids || []);
      (event.cast || []).forEach(function (item) {
        if (characters.has(item.character_id)) scoped.add(item.voice_actor_id);
      });
    });
    return (event.cast || []).filter(function (item) {
      return item.voice_actor_id && !scoped.has(item.voice_actor_id);
    });
  });

  function eventSongCount(event) {
    if (Number.isFinite(event && event.song_count)) return event.song_count;
    return (event.sessions || []).reduce(function (total, session) {
      return total + (session.songs || []).length;
    }, 0);
  }

  const eventMediaCards = deps.computed(function () {
    const event = eventDetail.value;
    const seen = new Set();
    return ((event && event.media) || [])
      .map(function (item, index) {
        const videoId = String(item.video_id || "");
        const url = String(
          item.url ||
            (videoId ? "https://www.youtube.com/watch?v=" + videoId : ""),
        );
        const key = videoId || url;
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
          image:
            item.thumbnail ||
            (videoId
              ? "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg"
              : "") ||
            (event && event.image) ||
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

  function eventPerformanceKey(performance) {
    return [
      performance &&
        (performance.version_id || performance.song_id || performance.song),
      performance && performance.performance_index,
    ]
      .filter(function (value) {
        return value !== undefined && value !== null && value !== "";
      })
      .join("-");
  }

  const eventPlayableRows = deps.computed(function () {
    return (
      (selectedEventSession.value && selectedEventSession.value.performances) ||
      []
    )
      .map(function (performance) {
        const song = deps.findSong(performance.song_id || performance.song);
        const playable = deps.playableSongRelease(song, performance.version_id);
        return playable
          ? {
              key: eventPerformanceKey(performance),
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
      return deps.loadAnimeCatalogOptional("event", found.id);
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
        if (isCurrent())
          deps.navigationError.value = "活动资料暂时无法载入，请重试。";
      });
  }

  const nextUpcomingEvent = deps.computed(function () {
    return homeNextEvent.value;
  });

  function onEventImageError(ev, event) {
    const image = ev && ev.target;
    if (!image || image.getAttribute("data-fallback") === "1") return;
    image.setAttribute("data-fallback", "1");
    image.src = "/uma_tools/img/event-covers/onsite.svg";
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
        eventsPage.value = 1;
        deps.pushUrl(true);
        window.clearTimeout(eventSearchTimer);
        eventSearchTimer = window.setTimeout(function () {
          loadEvents();
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
    eventTypeOptions,
    eventTypeSelection,
    eventUnscopedCast,
    eventVoiceCast,
    eventYearOptions,
    eventYears,
    eventsAll,
    eventsError,
    eventsLoading,
    eventsFiltered,
    eventsPage,
    eventsPageCount,
    eventsPageEnd,
    eventsPageList,
    eventsPageStart,
    eventsPaged,
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
