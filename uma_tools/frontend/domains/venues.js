/* venues state and behavior; external dependencies are explicit live ports. */
export function createVenues(deps) {
  const venuesList = deps.ref([]);

  const venuesTotal = deps.ref(0);

  const venuesError = deps.ref("");

  const venueDetail = deps.ref(null);

  const venueEvents = deps.ref([]);

  const venueEventsExpanded = deps.ref(false);

  const venueQuery = deps.ref("");

  const venuePage = deps.ref(1);

  const venuesPerPage = 30;

  let venuesListPromise = null;

  let venuesListRevision = 0;

  function loadVenuesListData(params) {
    venuesError.value = "";
    const revision = ++venuesListRevision;
    const requested = params || {
      q: venueQuery.value,
      page: venuePage.value,
      page_size: venuesPerPage,
    };
    const query = {
      q: requested.q || "",
      page: requested.page || venuePage.value,
      page_size: venuesPerPage,
    };
    venuesListPromise = deps.api
      .request("/api/catalog/venues" + deps.api.query(query))
      .then(function (data) {
        if (revision !== venuesListRevision) return;
        if (!data || !Array.isArray(data.items))
          throw new Error("invalid venues list");
        venuesList.value = data.items;
        venuesTotal.value = data.total;
        venuePage.value = data.page;
      })
      .catch(function () {
        if (revision === venuesListRevision) {
          venuesListPromise = null;
          venuesError.value = "会场目录暂时无法载入，请重试。";
        }
        throw new Error("venues list load failed");
      });
    return venuesListPromise;
  }

  function loadVenueData(id) {
    id = id || decodeURIComponent(deps.routeSegments()[2] || "");
    if (!id) return loadVenuesListData();
    venuesError.value = "";
    const sourcePath = deps.currentUrlPath();
    const navigation = deps.navigationRevision.value;
    return deps.api.request("/api/catalog/venue" + deps.api.query({ id }))
      .then(function (data) {
        if (!data || !data.venue) throw new Error("empty venue data");
        window.VENUES_DETAIL = { ...window.VENUES_DETAIL, [id]: data.venue };
        window.VENUES_EVENTS = { ...window.VENUES_EVENTS, [id]: data.events || [] };
      })
      .catch(function (error) {
        if (error.message === "HTTP 404") {
          window.VENUES_DETAIL = { ...window.VENUES_DETAIL, [id]: null };
          return;
        }
        if (sourcePath === deps.currentUrlPath() && navigation === deps.navigationRevision.value)
          venuesError.value = "会场资料暂时无法载入，请重试。";
        throw error;
      });
  }

  function retryVenues() {
    return loadVenueData().catch(() => {});
  }

  function openVenue(id) {
    const isCurrent = deps.beginEntityNavigation();
    const show = function () {
      if (!isCurrent()) return;
      if (!window.VENUES_DETAIL || !window.VENUES_DETAIL[id]) return;
      deps.clearEntityDetails("venue");
      deps.activeTab.value = "database";
      deps.dbView.value = "venues";
      venueDetail.value = window.VENUES_DETAIL[id];
      venueEvents.value = window.VENUES_EVENTS[id] || [];
      deps.resetPageScroll();
      deps.pushUrl();
    };
    return Promise.resolve(loadVenueData(id)).then(show, show);
  }

  const venuePageCount = deps.computed(function () {
    return Math.max(1, Math.ceil(venuesTotal.value / venuesPerPage));
  });

  const venuePageStart = deps.computed(function () {
    return venuesTotal.value ? (venuePage.value - 1) * venuesPerPage + 1 : 0;
  });

  const venuePageEnd = deps.computed(function () {
    return Math.min(venuePage.value * venuesPerPage, venuesTotal.value);
  });

  const venuePageList = deps.computed(function () {
    return deps.pagerList(venuePage.value, venuePageCount.value);
  });

  function setVenuePage(page) {
    const next = Math.min(Math.max(1, Number(page) || 1), venuePageCount.value);
    venuePage.value = next;
    loadVenuesListData().catch(() => {});
    deps.resetPageScroll();
    deps.pushUrl();
  }

  function goVenuePage(page) {
    setVenuePage(venuePage.value + page);
  }

  function venueEventRows(events) {
    const rows = (events || []).filter(row => row && row.id);
    return venueEventsExpanded.value ? rows : rows.slice(0, 10);
  }

  function toggleVenueEvents() {
    venueEventsExpanded.value = !venueEventsExpanded.value;
  }

  function venueLabel(venue) {
    return String(venue && (venue.name_zh || venue.name || venue.name_ja) || '').trim();
  }

  function venueQueryLabel(venue) {
    const name = venueLabel(venue);
    const city = venue && venue.city ? ' ' + venue.city : '';
    return (name + city).trim();
  }

  function venueCapacityLabel(venue) {
    const profile = venue && venue.profile;
    if (!profile) return '';
    const text = String(profile.capacity_text || '').trim();
    if (!text) return profile.capacity ? Number(profile.capacity).toLocaleString('zh-CN') : '';
    return text.split(/[(（]/)[0].split(/\s+/)[0];
  }

  function venueLinkHost(url) {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch (error) {
      return '';
    }
  }

  function venueMapUrl(venue) {
    const profile = venue && venue.profile;
    if (profile && Number.isFinite(profile.latitude) && Number.isFinite(profile.longitude))
      return (
        'https://www.google.com/maps/search/?api=1&query=' +
        profile.latitude +
        ',' +
        profile.longitude
      );
    const label = venueQueryLabel(venue);
    return label
      ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(label)
      : '';
  }

  function venueAliasRows(venue) {
    if (!venue) return [];
    const seen = new Set([venue.name, venue.name_zh, venue.name_ja, venue.name_raw, ''].map(v => String(v || '')));
    const rows = [];
    (venue.aliases || []).forEach(alias => {
      const value = String(alias || '').trim();
      if (value && !seen.has(value) && rows.indexOf(value) < 0) rows.push(value);
    });
    return rows;
  }

  function venueSourceLabel(source) {
    const kind = String(source && source.kind || '').toLowerCase();
    return ({
      eventernote: 'Eventernote',
      eventernote_place: 'Eventernote',
      wikipedia_ja: '日文维基百科',
      wikipedia_en: '英文维基百科',
      official: '官方',
      venue_directory: 'Eventernote 会场资料',
      venue_reference: '官方访问指南',
    })[kind] || kind;
  }

  let venueSearchTimer;

  function start() {
    deps.watch(venueDetail, function () {
      venueEventsExpanded.value = false;
    });
    deps.watch(
      venueQuery,
      function () {
        if (deps.restoringRoute) return;
        deps.pushUrl(true);
      },
      { flush: "sync" },
    );
    deps.watch(
      venueQuery,
      function () {
        if (
          deps.restoringRoute ||
          deps.currentUrlPath().split("?")[0] !== deps.routes.venues()
        )
          return;
        window.clearTimeout(venueSearchTimer);
        venueSearchTimer = window.setTimeout(() => {
          if (deps.currentUrlPath().split('?')[0] === deps.routes.venues()) loadVenuesListData().catch(() => {});
        }, 180);
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    goVenuePage,
    loadVenueData,
    loadVenuesListData,
    openVenue,
    retryVenues,
    setVenuePage,
    venueDetail,
    venueEventRows,
    venueEvents,
    venueEventsExpanded,
    venueAliasRows,
    venueCapacityLabel,
    venueLabel,
    venueLinkHost,
    venueMapUrl,
    venuePage,
    venuePageCount,
    venuePageEnd,
    venuePageList,
    venuePageStart,
    venueQuery,
    venueQueryLabel,
    venueSourceLabel,
    toggleVenueEvents,
    venuesError,
    venuesList,
    venuesPerPage,
    venuesTotal,
  };
}
