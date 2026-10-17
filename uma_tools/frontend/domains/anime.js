import {
  animeFormatLabel,
  animeStatusLabel,
  animePlatformLabel,
} from "/uma_tools/frontend/anime-labels.js";
import { createAnimeMusic } from "/uma_tools/frontend/anime-music.js";
import { createAnimeParticipation } from "/uma_tools/frontend/anime-participation.js";
/* anime state and behavior; external dependencies are explicit live ports. */
export function createAnime(deps) {
  let animeLoader = null;

  let animeLoadingCount = 0;

  const animeCatalog = deps.ref({
    coverage: {},
    works: [],
    units: [],
    watch_resources: [],
    relations: [],
    staff: [],
    people: [],
  });

  const animeRelatedEvents = deps.reactive({});
  const animeRelatedAlbums = deps.reactive({});

  const animeMediaLoads = {};

  const animeLoading = deps.ref(false);

  const animeError = deps.ref("");

  const animeDetail = deps.ref(null);

  const animeUnitDetail = deps.ref(null);

  const animeQuery = deps.ref("");

  const animeEpisodeQuery = deps.ref("");

  const animeSort = deps.ref("newest");

  const animeFormat = deps.ref("all");

  const animeStatus = deps.ref("all");

  const animeSection = deps.ref("episodes");

  const animeEdition = deps.ref("film");

  const animeStillUnit = deps.ref("");

  function getAnimeLoader() {
    if (
      !animeLoader &&
      window.UmaAnimeLoader &&
      typeof window.UmaAnimeLoader.create === "function"
    ) {
      animeLoader = window.UmaAnimeLoader.create(function (url, options) {
        return deps.api.request(url, options);
      });
    }
    if (!animeLoader) throw new Error("动漫资料加载器不可用。");
    return animeLoader;
  }

  function loadAnimeCatalog(scope, id, retry) {
    scope = scope || "index";
    id = id || "";
    const sourcePath = deps.currentUrlPath();
    const navigation = deps.navigationRevision.value;
    animeLoadingCount += 1;
    animeLoading.value = true;
    animeError.value = "";
    const promise = Promise.resolve()
      .then(function () {
        return getAnimeLoader().load(scope, id, !!retry);
      })
      .then(function (data) {
        animeCatalog.value = data;
        return animeCatalog.value;
      })
      .catch(function (error) {
        if (
          navigation === deps.navigationRevision.value &&
          sourcePath === deps.currentUrlPath()
        ) {
          animeError.value =
            error && error.message === "动漫资料加载器不可用。"
              ? error.message
              : "动漫资料暂时无法载入。";
        }
        throw error;
      })
      .finally(function () {
        animeLoadingCount = Math.max(0, animeLoadingCount - 1);
        animeLoading.value = animeLoadingCount > 0;
      });
    return promise;
  }

  function animeRouteLoadTarget() {
    const seg = deps.routeSegments();
    if ((seg[1] || "").toLowerCase() === "anime" && seg[2])
      return seg[4]
        ? ["unit", decodeURIComponent(seg[4])]
        : ["work", decodeURIComponent(seg[2])];
    if ((seg[1] || "").toLowerCase() === "staff")
      return [
        seg[2] ? "person" : "people",
        seg[2] ? decodeURIComponent(seg[2]) : "",
      ];
    const type = {
      characters: "character",
      "voice-actors": "voice_actor",
      creators: "creator",
      songs: "song",
      albums: "album",
    }[seg[1]];
    if (type && seg[2])
      return ["entity", type + ":" + decodeURIComponent(seg[2])];
    if (seg[0] === "events" && seg[1])
      return ["entity", "event:" + decodeURIComponent(seg[1])];
    return ["index", ""];
  }

  function retryAnime() {
    const target = animeRouteLoadTarget();
    const sourcePath = deps.currentUrlPath();
    const navigation = deps.navigationRevision.value;
    const ready =
      target[0] === "work"
        ? loadAnimeRelatedMedia(target[1], true)
        : loadAnimeCatalog(target[0], target[1], true);
    return ready
      .then(function () {
        if (
          navigation === deps.navigationRevision.value &&
          sourcePath === deps.currentUrlPath()
        ) {
          deps.syncFromUrl();
          deps.routeError.value = "";
          deps.routeReady.value = true;
        }
      })
      .catch(function () {});
  }

  function loadAnimeCatalogOptional(type, id) {
    const target =
      type && id ? ["entity", type + ":" + id] : animeRouteLoadTarget();
    if (target[0] !== "entity") return Promise.resolve(null);
    return loadAnimeCatalog(target[0], target[1]).catch(function () {
      return null;
    });
  }

  function loadAnimeRelatedMedia(workId, retry, kind) {
    kind =
      kind ||
      (new URL(window.location.href).searchParams.get("section") === "music"
        ? "music"
        : "events");
    const mediaKey =
      workId + ":" + (deps.routeSegments()[4] || "") + ":" + kind;
    if (retry) delete animeMediaLoads[mediaKey];
    if (animeMediaLoads[mediaKey]) return animeMediaLoads[mediaKey];
    const sourcePath = deps.currentUrlPath();
    const navigation = deps.navigationRevision.value;
    animeLoadingCount += 1;
    animeLoading.value = true;
    animeMediaLoads[mediaKey] = Promise.all([
      loadAnimeCatalog(
        deps.routeSegments()[4] ? "unit" : "work",
        deps.routeSegments()[4] || workId,
        !!retry,
      ),
      Promise.resolve(),
      deps.api.request(
        "/api/catalog/anime-media" +
          deps.api.query({ id: workId, unit: deps.routeSegments()[4], kind }),
        { fresh: !!retry },
      ),
    ])
      .then(function (results) {
        const media = results[2] || {};
        (media.songs || []).forEach(deps.mergeSong);
        (media.albums || []).forEach(album => { animeRelatedAlbums[album.id] = album; });
        (media.events || []).forEach(function (event) {
          if (event && event.id) animeRelatedEvents[event.id] = event;
        });
        return results[0];
      })
      .catch(function (error) {
        if (
          navigation === deps.navigationRevision.value &&
          sourcePath === deps.currentUrlPath()
        )
          animeError.value = "动画关联资料暂时无法载入。";
        throw error;
      })
      .finally(function () {
        delete animeMediaLoads[mediaKey];
        animeLoadingCount = Math.max(0, animeLoadingCount - 1);
        animeLoading.value = animeLoadingCount > 0;
      });
    return animeMediaLoads[mediaKey];
  }

  function findAnimeWork(id) {
    return (
      (animeCatalog.value.works || []).find(function (work) {
        return work.id === id;
      }) || null
    );
  }

  function findAnimeUnit(id) {
    return (
      (animeCatalog.value.units || []).find(function (unit) {
        return unit.id === id;
      }) || null
    );
  }

  function animeWorkFormats(work) {
    return [...new Set([work.format || "unknown", ...(work.film_cover || work.film_release_date ? ['movie'] : [])])];
  }

  function animeWorkYears(work) {
    return work && work.start_date ? [String(work.start_date).slice(0, 4)] : [];
  }

  function animeArtwork(work, film = false) {
    const url = film ? work.film_cover : work.cover;
    return url && url.startsWith("/uma_tools/")
      ? deps.routes.query(url, { v: animeCatalog.value.build_id })
      : url;
  }

  const animeFormatOptions = deps.computed(() =>
    ["tv", "movie", "web", "short", "special", "unknown"].filter((format) =>
      (animeCatalog.value.works || []).some((work) =>
        animeWorkFormats(work).includes(format),
      ),
    ),
  );

  const animeStatusOptions = deps.computed(() =>
    ["airing", "completed", "announced"].filter((status) =>
      (animeCatalog.value.works || []).some((work) => work.status === status),
    ),
  );

  const animeSortOptions = [
    { value: "newest", label: "最新公开" },
    { value: "oldest", label: "最早公开" },
    { value: "name", label: "名称" },
  ];

  function animeSearchText(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  function animeUnitMatchesQuery(unit, query) {
    const number = String(query || "").match(
      /^(?:第\s*)?(\d+)\s*(?:话|話|集)?$/,
    );
    if (number) return unit.number === Number(number[1]);
    return [
      unit.label,
      unit.title_zh,
      unit.title_ja,
      ...(unit.aliases || []),
    ].some((value) => animeSearchText(value).includes(animeSearchText(query)));
  }

  function animeWorkTitleMatches(work, query) {
    return [work.title_zh, work.title_ja, ...(work.aliases || [])].some(
      (value) => animeSearchText(value).includes(animeSearchText(query)),
    );
  }

  function animeMatchedUnits(work) {
    return animeQuery.value.trim() &&
      !animeWorkTitleMatches(work, animeQuery.value)
      ? (animeCatalog.value.units || []).filter(
          (unit) =>
            unit.work_id === work.id &&
            animeUnitMatchesQuery(unit, animeQuery.value),
        )
      : [];
  }

  function animeWorkHref(work) {
    const matched = animeMatchedUnits(work);
    if (
      matched.length === 1 &&
      !["movie", "special"].includes(work.format) &&
      !(work.id === "anime-rttt" && animeFormat.value === "movie")
    )
      return animeUnitHref(matched[0], "characters");
    return deps.routes.query(deps.routes.anime(work.id), {
      edition: work.id === "anime-rttt" ? "web" : "",
      section:
        matched.length && animeFormat.value !== "movie" ? "episodes" : "",
      episodes:
        matched.length && animeFormat.value !== "movie" ? animeQuery.value : "",
    });
  }

  function clearAnimeFilters() {
    animeQuery.value = "";
    animeFormat.value = "all";
    animeStatus.value = "all";
  }

  function animeWorkMatchesQuery(work, query) {
    if (!query) return true;
    return (
      animeWorkTitleMatches(work, query) ||
      (animeCatalog.value.units || []).some(
        (unit) =>
          unit.work_id === work.id && animeUnitMatchesQuery(unit, query),
      )
    );
  }

  const animeFiltered = deps.computed(function () {
    const query = String(animeQuery.value || "")
      .trim()
      .toLowerCase();
    const rows = (animeCatalog.value.works || []).filter(function (work) {
      if (
        animeFormat.value !== "all" &&
        !animeWorkFormats(work).includes(animeFormat.value)
      )
        return false;
      if (animeStatus.value !== "all" && work.status !== animeStatus.value)
        return false;
      if (!query) return true;
      return animeWorkMatchesQuery(work, query);
    });
    return rows.sort(function (a, b) {
      if (animeSort.value === "name")
        return String(a.title_zh || a.title_ja || "").localeCompare(
          String(b.title_zh || b.title_ja || ""),
          "zh",
        );
      const aDate = String(a.start_date || "9999-99-99"),
        bDate = String(b.start_date || "9999-99-99");
      return animeSort.value === "oldest"
        ? aDate.localeCompare(bDate)
        : bDate.localeCompare(aDate);
    });
  });

  const animeWorkUnits = deps.computed(function () {
    const id = animeDetail.value && animeDetail.value.id;
    return (animeCatalog.value.units || []).filter(function (unit) {
      return unit.work_id === id;
    });
  });

  const animeSingle = deps.computed(
    () =>
      !!animeDetail.value &&
      (["movie", "special"].includes(animeDetail.value.format) ||
        (!animeUnitDetail.value &&
          animeDetail.value.id === "anime-rttt" &&
          animeEdition.value === "film")),
  );

  const animeContentUnit = deps.computed(
    () =>
      animeUnitDetail.value ||
      (animeSingle.value && animeDetail.value.id !== "anime-rttt"
        ? animeWorkUnits.value[0]
        : null),
  );

  const animeHeroArtwork = deps.computed(() => {
    const unit = animeUnitDetail.value;
    return (
      (unit && (unit.cover || (unit.stills || [])[0]?.url)) ||
      animeArtwork(
        animeDetail.value,
        animeDetail.value?.id === "anime-rttt" && animeEdition.value === "film",
      )
    );
  });

  const animeHeroOriginal = deps.computed(() => {
    const unit = animeUnitDetail.value,
      work = animeDetail.value;
    return (
      (unit && (unit.cover_original || (unit.stills || [])[0]?.original)) ||
      (work?.id === "anime-rttt" && animeEdition.value === "film"
        ? work.film_cover_original
        : work?.cover_original) ||
      animeHeroArtwork.value
    );
  });

  function setAnimeEdition(edition) {
    animeEdition.value = edition;
    animeStillUnit.value = "";
    if (!animeTabs.value.some((tab) => tab.id === animeSection.value))
      animeSection.value = (animeTabs.value[0] || {}).id || "characters";
    deps.pushUrl(true);
  }

  function animeRowEditions(row) {
    return Array.isArray(row.editions) && row.editions.length
      ? row.editions
      : row.edition
        ? [row.edition]
        : [];
  }

  function animeRowMatchesEdition(row, edition) {
    const editions = animeRowEditions(row);
    return !editions.length || editions.includes(edition);
  }

  const animeCurrentRelations = deps.computed(function () {
    const unit = animeContentUnit.value;
    const sourceType = unit ? "anime_unit" : "anime_work";
    const sourceId = unit ? unit.id : animeDetail.value && animeDetail.value.id;
    return (animeCatalog.value.relations || [])
      .filter(function (relation) {
        if (
          animeDetail.value &&
          animeDetail.value.id === "anime-rttt" &&
          relation.source_type === "anime_work" &&
          !animeRowMatchesEdition(relation, animeEdition.value)
        )
          return false;
        return (
          (relation.source_type === sourceType &&
            relation.source_id === sourceId) ||
          (animeSingle.value &&
            relation.source_type === "anime_work" &&
            relation.source_id === animeDetail.value.id)
        );
      })
      .sort(function (a, b) {
        return (a.display_order || 0) - (b.display_order || 0);
      });
  });

  const animeCurrentWatch = deps.computed(function () {
    const workId = animeDetail.value && animeDetail.value.id;
    const unitId = animeContentUnit.value && animeContentUnit.value.id;
    const resources = (animeCatalog.value.watch_resources || []).filter(
      function (resource) {
        const scope = resource.scope || {};
        if (!["official", "licensed"].includes(resource.authority))
          return false;
        if (!["active", "region_limited"].includes(resource.status))
          return false;
        if (
          !["full_episode", "playlist", "series"].includes(
            resource.content_type,
          )
        )
          return false;
        if (
          workId === "anime-rttt" &&
          animeEdition.value === "film" &&
          resource.edition !== "film"
        )
          return false;
        if (scope.type === "unit") return scope.id === unitId;
        return (
          scope.id === workId &&
          (!unitId || (resource.unit_ids || []).includes(unitId))
        );
      },
    );
    return resources
      .filter(
        (resource) =>
          !unitId ||
          resource.scope.type === "unit" ||
          !resources.some(
            (other) =>
              other.scope.type === "unit" &&
              other.platform === resource.platform &&
              other.authority === resource.authority,
          ),
      )
      .sort(function (a, b) {
        const score = { official: 0, licensed: 1 };
        return (score[a.authority] ?? 9) - (score[b.authority] ?? 9);
      });
  });

  function animeLink(event, path) {
    if (
      !path ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    deps.navigateTo(path);
  }

  function setAnimeSection(section) {
    animeSection.value = section;
    deps.pushUrl(true);
    if (section === "music" && animeDetail.value)
      loadAnimeRelatedMedia(animeDetail.value.id, false, "music").catch(() => {});
  }

  const animeDates = deps.computed(() => {
    const content = animeContentUnit.value || animeDetail.value || {};
    const labels = {
      "ぱかチューブっ！配信": "YouTube上线",
      "TOKYO MX・BS11放送": "TOKYO MX／BS11首播",
      TBS系放送: "TBS电视网首播",
      官网公开公告: "公开日期",
    };
    return (content.dates || [])
      .filter((date) => !date.edition || date.edition === animeEdition.value)
      .map((date) =>
        Object.assign({}, date, {
          label: labels[date.label] || date.label.replace(/配信/g, "上线"),
        }),
      )
      .filter(
        (date, index, dates) =>
          date.label !== "公开日期" ||
          !dates.some(
            (other, otherIndex) =>
              otherIndex !== index &&
              other.label !== "公开日期" &&
              other.date === date.date,
          ),
      );
  });

  const animeStillGroups = deps.computed(() => {
    if (animeContentUnit.value)
      return [
        {
          unit: animeContentUnit.value,
          stills: animeContentUnit.value.stills || [],
        },
      ].filter((row) => row.stills.length);
    if (animeSingle.value)
      return [
        { unit: null, stills: animeDetail.value.film_stills || [] },
      ].filter((row) => row.stills.length);
    return animeWorkUnits.value
      .filter((unit) => (unit.stills || []).length)
      .map((unit) => ({ unit, stills: unit.stills }));
  });

  const animeVisibleStillGroups = deps.computed(() => {
    if (
      animeStillUnit.value === "all" ||
      animeContentUnit.value ||
      animeSingle.value
    )
      return animeStillGroups.value;
    const id =
      animeStillUnit.value || ((animeStillGroups.value[0] || {}).unit || {}).id;
    return animeStillGroups.value.filter((row) => row.unit.id === id);
  });

  const animeStillOptions = deps.computed(() =>
    animeStillGroups.value
      .filter((group) => group.unit)
      .map((group, index) => ({
        value: index ? group.unit.id : "",
        label: group.unit.label,
      }))
      .concat([{ value: "all", label: "全部" }]),
  );

  const animeUnitGroups = deps.computed(() => {
    const query = animeEpisodeQuery.value.trim().toLowerCase();
    const groups = [];
    animeWorkUnits.value.forEach((unit) => {
      if (query && !animeUnitMatchesQuery(unit, query)) return;
      const kind = ["ova", "special"].includes(unit.unit_type)
        ? unit.unit_type
        : "episode";
      let group = groups.find((row) => row.kind === kind);
      if (!group) {
        group = {
          kind,
          label: {
            episode: "正篇",
            ova: "OVA",
            bd_short: "剧集",
            special: "特别动画",
          }[kind],
          units: [],
        };
        groups.push(group);
      }
      group.units.push(unit);
    });
    return groups;
  });

  const animeAdjacentUnits = deps.computed(() => {
    const index = animeWorkUnits.value.findIndex(
      (unit) => animeUnitDetail.value && unit.id === animeUnitDetail.value.id,
    );
    return {
      previous: index > 0 ? animeWorkUnits.value[index - 1] : null,
      next: index >= 0 ? animeWorkUnits.value[index + 1] : null,
    };
  });

  const animeEpisodeDirectoryHref = deps.computed(() =>
    deps.routes.query(deps.routes.anime(animeDetail.value.id), {
      section: "episodes",
      edition: animeDetail.value.id === "anime-rttt" ? "web" : "",
      episodes: animeEpisodeQuery.value,
      staff: deps.animeStaffQuery.value,
    }),
  );

  function animeUnitHref(unit, section = animeSection.value) {
    if (!unit) return "";
    return deps.routes.query(deps.routes.anime(unit.work_id, unit.id), {
      section: section || "episodes",
      staff: section === "staff" ? deps.animeStaffQuery.value : "",
      episodes: animeEpisodeQuery.value,
      edition: unit.work_id === "anime-rttt" ? "web" : "",
    });
  }

  const animeCurrentCast = deps.computed(() => {
    let rows = animeCurrentRelations.value.filter(
      (row) =>
        row.relation_type === "credited_cast" ||
        row.target_type === "character",
    );
    if (!animeContentUnit.value && !animeSingle.value) {
      const units = new Set(animeWorkUnits.value.map((unit) => unit.id));
      rows = rows.concat(
        (animeCatalog.value.relations || []).filter(
          (row) =>
            units.has(row.source_id) && row.relation_type === "credited_cast",
        ),
      );
    }
    const seen = new Set();
    return rows.filter((row) => {
      const key =
        row.target_type +
        ":" +
        row.target_id +
        ":" +
        row.voice_actor_id +
        ":" +
        (row.role_name || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  const animeTabs = deps.computed(() =>
    [
      {
        id: "episodes",
        label: "剧集",
        show:
          !animeUnitDetail.value &&
          !animeSingle.value &&
          animeWorkUnits.value.length,
      },
      {
        id: "characters",
        label: animeUnitDetail.value ? "登场角色" : "角色",
        show: animeCurrentCast.value.length,
      },
      {
        id: "music",
        label: "音乐",
        show:
          music.animeMusicGroups.value.length ||
          music.animeMusicCues.value.length,
      },
      {
        id: "staff",
        label: "制作人员",
        show:
          deps.animeCurrentStaff.value.length ||
          deps.animeStaffAggregate.value.length,
      },
      { id: "stills", label: "剧照", show: animeStillGroups.value.length },
    ].filter((tab) => tab.show),
  );

  const animeUsefulRelations = deps.computed(() =>
    animeCurrentRelations.value.filter((row) => row.target_type === "race"),
  );

  const animeEventGroups = deps.computed(() =>
    [
      { kind: "screening", label: "上映" },
      { kind: "stage", label: "舞台见面会" },
      { kind: "program", label: "作品专题" },
    ]
      .map((group) => ({
        ...group,
        rows: animeCurrentRelations.value
          .filter(
            (row) =>
              row.target_type === "event" &&
              (row.event_category || "screening") === group.kind,
          )
          .map((relation) => ({
            relation,
            event: animeRelatedEvents[relation.target_id],
          }))
          .filter((row) => row.event)
          .sort((a, b) =>
            String(a.event.date).localeCompare(String(b.event.date)),
          ),
      }))
      .filter((group) => group.rows.length),
  );

  function animeRelationTargetLabel(relation) {
    if (!relation) return "";
    if (relation.target_type === "character")
      return deps.characterName(relation.target_id);
    if (relation.target_type === "song") {
      const song = deps.findSong(relation.target_id);
      return song ? song.title : relation.target_id;
    }
    if (relation.target_type === "event") {
      const event =
        animeRelatedEvents[relation.target_id] ||
        deps.eventsAll.value.find(function (entry) {
          return entry.id === relation.target_id;
        });
      return event ? event.title : relation.target_id;
    }
    if (relation.target_type === "voice_actor")
      return relation.signature || deps.voiceName(relation.target_id);
    if (relation.target_type === "album") {
      const album = animeRelatedAlbums[relation.target_id] || deps.albums.value.find(
        (row) => (row.data || row).id === relation.target_id,
      );
      return (
        relation.title ||
        (album &&
          ((album.data || album).name || (album.data || album).title)) ||
        relation.target_id
      );
    }
    if (relation.target_type === "horse" || relation.target_type === "race")
      return relation.title || relation.target_id;
    if (relation.target_type === "anime_work") {
      const work = findAnimeWork(relation.target_id);
      return work ? work.title_zh : relation.target_id;
    }
    return relation.target_id;
  }

  function animeRelationHref(relation) {
    if (relation.target_type === "character")
      return deps.routes.characters(relation.target_id);
    if (relation.target_type === "song")
      return deps.routes.query(
        deps.routes.songs(relation.target_id, "releases"),
        { version: relation.version_id, release: relation.release_id },
      );
    if (relation.target_type === "voice_actor")
      return deps.routes.voiceActors(relation.target_id);
    if (relation.target_type === "event")
      return deps.routes.events(relation.target_id, relation.session_id);
    if (relation.target_type === "anime_work")
      return deps.routes.anime(relation.target_id);
    if (relation.target_type === "horse")
      return deps.routes.horses(relation.target_id);
    if (relation.target_type === "race") return relation.url || "";
    if (relation.target_type === "album")
      return deps.routes.albums(relation.target_id);
    return relation.url || "";
  }

  function start() {
    deps.watch([animeQuery, animeFormat, animeStatus, animeSort], () => {
      if (
        deps.routeReady.value &&
        deps.activeTab.value === "database" &&
        deps.dbView.value === "anime" &&
        !animeDetail.value
      )
        deps.pushUrl(true);
    });
    deps.watch(animeTabs, (tabs) => {
      if (tabs.length && !tabs.some((tab) => tab.id === animeSection.value))
        animeSection.value = tabs[0].id;
    });
  }
  const participation = createAnimeParticipation({
    get animeRowEditions() {
      return animeRowEditions;
    },
    get animeRelationTargetLabel() {
      return animeRelationTargetLabel;
    },
    get animeMusicUsageLabel() {
      return music.animeMusicUsageLabel;
    },
    get animeCatalog() {
      return animeCatalog;
    },
    get findAnimeWork() {
      return findAnimeWork;
    },
    get findAnimeUnit() {
      return findAnimeUnit;
    },
    get characterName() {
      return deps.characterName;
    },
    get computed() {
      return deps.computed;
    },
    get creatorAnimeStaff() {
      return deps.creatorAnimeStaff;
    },
    get creatorDetail() {
      return deps.creatorDetail;
    },
    get charDetail() {
      return deps.charDetail;
    },
    get voiceDetail() {
      return deps.voiceDetail;
    },
    get songDetail() {
      return deps.songDetail;
    },
    get albumDetail() {
      return deps.albumDetail;
    },
    get eventDetail() {
      return deps.eventDetail;
    },
    get routes() {
      return deps.routes;
    },
  });
  const music = createAnimeMusic({
    get animeCurrentRelations() {
      return animeCurrentRelations;
    },
    get animeContentUnit() {
      return animeContentUnit;
    },
    get animeWorkUnits() {
      return animeWorkUnits;
    },
    get computed() {
      return deps.computed;
    },
    get findSong() {
      return deps.findSong;
    },
    get findAlbumById() {
      return id => animeRelatedAlbums[id] || deps.findAlbumById(id);
    },
  });
  return {
    start,
    albumAnimeRelations: participation.albumAnimeRelations,
    albumAnimeWorks: participation.albumAnimeWorks,
    animeAdjacentUnits,
    animeArtwork,
    animeCatalog,
    animeContentUnit,
    animeCurrentCast,
    animeCurrentRelations,
    animeCurrentWatch,
    animeDates,
    animeDetail,
    animeEdition,
    animeEpisodeDirectoryHref,
    animeEpisodeQuery,
    animeError,
    animeEventGroups,
    animeFiltered,
    animeFormat,
    animeFormatLabel,
    animeFormatOptions,
    animeHeroArtwork,
    animeHeroOriginal,
    animeLink,
    animeLoading,
    animeMatchedUnits,
    animeMusicCover: music.animeMusicCover,
    animeMusicCueGroups: music.animeMusicCueGroups,
    animeMusicCues: music.animeMusicCues,
    animeMusicGroups: music.animeMusicGroups,
    animeMusicItems: music.animeMusicItems,
    animeMusicSong: music.animeMusicSong,
    animeMusicVersions: music.animeMusicVersions,
    animePlatformLabel,
    animeQuery,
    animeRelationContext: participation.animeRelationContext,
    animeRelationHref,
    animeRelationTargetLabel,
    animeRowMatchesEdition,
    animeSection,
    animeSingle,
    animeSort,
    animeSortOptions,
    animeStatus,
    animeStatusLabel,
    animeStatusOptions,
    animeStillGroups,
    animeStillOptions,
    animeStillUnit,
    animeTabs,
    animeUnitDetail,
    animeUnitGroups,
    animeUnitHref,
    animeUsefulRelations,
    animeVisibleStillGroups,
    animeWorkFormats,
    animeWorkHref,
    animeWorkUnits,
    animeWorkYears,
    characterAnimeRelations: participation.characterAnimeRelations,
    characterAnimeWorks: participation.characterAnimeWorks,
    clearAnimeFilters,
    creatorAnimeCueWorks: participation.creatorAnimeCueWorks,
    creatorAnimeWorks: participation.creatorAnimeWorks,
    eventAnimeRelations: participation.eventAnimeRelations,
    eventAnimeWorks: participation.eventAnimeWorks,
    findAnimeUnit,
    findAnimeWork,
    groupAnimeParticipation: participation.groupAnimeParticipation,
    loadAnimeCatalog,
    loadAnimeCatalogOptional,
    loadAnimeRelatedMedia,
    relatedAnimeHref: participation.relatedAnimeHref,
    retryAnime,
    setAnimeEdition,
    setAnimeSection,
    songAnimeRelations: participation.songAnimeRelations,
    songAnimeWorks: participation.songAnimeWorks,
    voiceAnimeRelations: participation.voiceAnimeRelations,
    voiceAnimeWorks: participation.voiceAnimeWorks,
  };
}
