/* venues state and behavior; external dependencies are explicit live ports. */
export function createVenues(deps) {
  const venuesList = deps.ref([]);

  const venuesTotal = deps.ref(0);

  const venuesError = deps.ref("");
  const venuesLoading = deps.ref(true);

  const venueDetail = deps.ref(null);

  const venueEvents = deps.ref([]);

  const venueEventsExpanded = deps.ref(false);

  const venueQuery = deps.ref("");

  const venuePage = deps.ref(1);

  const venuesPerPage = 30;

  let venuesListRevision = 0;
  let venueSearchTimer;

  function loadVenuesListData(params) {
    window.clearTimeout(venueSearchTimer);
    venuesError.value = "";
    venuesLoading.value = true;
    const revision = ++venuesListRevision;
    const requested = params || {
      q: venueQuery.value,
      page: venuePage.value,
      page_size: venuesPerPage,
    };
    const query = {
      q: requested.q || "",
      page: Math.max(1, Number(requested.page) || 1),
      page_size: venuesPerPage,
    };
    return deps.api
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
          venuesError.value = "会场目录暂时无法载入，请重试。";
        }
        throw new Error("venues list load failed");
      })
      .finally(function () {
        if (revision === venuesListRevision) venuesLoading.value = false;
      });
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
    const rows = (events || []).map(row => ({ ...row, event_id: row.id, parent_title: row.title_zh || row.title }));
    return venueEventsExpanded.value ? rows : rows.slice(0, 10);
  }

  function venueActivityLabel(event) {
    const status = { cancelled: '已取消', partially_cancelled: '部分场次取消' }[event.schedule_status];
    return [event.session_count > 1 ? event.session_count + ' 场' : '', status].filter(Boolean).join('，');
  }

  function toggleVenueEvents() {
    venueEventsExpanded.value = !venueEventsExpanded.value;
  }

  function venueLabel(venue) {
    return String(venue && (venue.display_name || venue.name_zh || venue.name || venue.name_ja) || '').trim();
  }

  function venueLocation(venue) {
    return Array.from(new Set([venue.country, venue.city].filter(Boolean))).join(' ');
  }

  function venueOriginalName(venue) {
    return venue.localization?.name_original || venue.name_ja || venue.name_en || venue.name_raw || '';
  }

  function venueNameKey(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  }

  function venueEnglishName(venue) {
    const name = venue.name_en || '';
    return [venueLabel(venue), venueOriginalName(venue)].some(value => venueNameKey(value) === venueNameKey(name)) ? '' : name;
  }

  function venueCapacityLabel(venue) {
    const localized = venue?.localization?.capacity_zh?.[0];
    if (localized) return localized.split(/[（(]/)[0].trim();
    const profile = venue && venue.profile;
    if (!profile || !profile.capacity) return '';
    const number = Number(profile.capacity).toLocaleString('zh-CN');
    const unit = { seats: '席', people: '人' }[profile.capacity_unit] || '';
    const prefix = profile.capacity_maximum ? '最多 ' : profile.capacity_approximate ? '约 ' : '';
    return prefix + number + (unit ? ' ' + unit : '');
  }

  function venueListPath() {
    return deps.routes.query(deps.routes.venues(), { q: venueQuery.value, page: venuePage.value });
  }

  function venueAliasRows(venue) {
    if (!venue) return [];
    const seen = new Set([venueLabel(venue), venueOriginalName(venue), venue.name_en, '', ...venueNameHistory(venue).map(row => row.name)].map(venueNameKey));
    const rows = [];
    const candidates = venue.localization?.display_aliases || [venue.name_ja, venue.name_raw, ...(venue.localization?.aliases || []), ...(venue.aliases || [])];
    candidates.forEach(alias => {
      const value = String(alias || '').trim();
      const key = venueNameKey(value);
      const parts = value.normalize('NFKC').split(/[()]/).filter(part => part.trim());
      if (seen.has(key) || (parts.length > 1 && parts.every(part => seen.has(venueNameKey(part))))) return;
      seen.add(key);
      rows.push(value);
    });
    return rows;
  }

  function venueNameHistory(venue) {
    return (venue?.localization?.name_history_zh || []).map(line => {
      const match = line.match(/^(.*?)（([^（）]*\d[^（）]*)）$/);
      const period = match?.[2].replace(/(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日/g, (_, year, month, day) => `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')}`).replace('至', ' — ');
      return match ? { name: match[1].trim(), period } : { name: line, period: '' };
    });
  }

  function venueHeroLinks(venue) {
    const profile = venue?.profile || {};
    const sources = [profile.capacity_source, ...(profile.sources || []), ...(venue?.sources || []), ...(venue?.localization?.references || [])]
      .map(source => typeof source === 'string' ? source : source?.url).filter(Boolean);
    const findHost = host => sources.find(url => {
      try { return new URL(url).hostname === host || new URL(url).hostname.endsWith('.' + host); }
      catch { return false; }
    });
    return [
      { label: '官网', url: profile.official_url },
      { label: 'Eventernote', url: findHost('eventernote.com'), icon: '/uma_tools/img/eventernote-icon.png' },
      { label: 'Wikipedia', url: profile.wikipedia_zh || profile.wikipedia_ja || profile.wikipedia_en || findHost('wikipedia.org'), icon: '/uma_tools/img/wikipedia-icon.png' },
      { label: 'SeatView', url: venue?.localization?.seatview_url, icon: '/uma_tools/img/seatview-icon.png' },
      { label: 'Google Maps', url: venue?.localization?.google_maps?.url, icon: '/uma_tools/img/google-maps-icon.png', title: venue?.localization?.google_maps?.note_zh || venue?.localization?.google_maps?.place_name },
    ].filter(link => /^https?:\/\//.test(link.url || ''));
  }

  function start() {
    deps.watch(venueDetail, function () {
      venueEventsExpanded.value = false;
    });
    deps.watch(
      venueQuery,
      function () {
        if (
          deps.restoringRoute ||
          deps.currentUrlPath().split("?")[0] !== deps.routes.venues()
        )
          return;
        venuePage.value = 1;
        venuesListRevision += 1;
        venuesLoading.value = true;
        venuesError.value = "";
        deps.pushUrl(true);
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
    venueNameHistory,
    venueHeroLinks,
    venueEnglishName,
    venueActivityLabel,
    venueCapacityLabel,
    venueLabel,
    venueListPath,
    venueLocation,
    venueOriginalName,
    venuePage,
    venuePageCount,
    venuePageList,
    venueQuery,
    toggleVenueEvents,
    venuesError,
    venuesList,
    venuesLoading,
  };
}
