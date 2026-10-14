/* horses state and behavior; external dependencies are explicit live ports. */
export function createHorses(deps) {
  let pedigreeLoadPromise = null;

  let pedigreeMetaLoadPromise = null;

  const pedigreeStatus = deps.ref("idle");

  const pedigreeError = deps.ref("");

  const charHasPedigree = deps.computed(function () {
    const id = deps.charDetail.value && deps.charDetail.value.id;
    const meta = window.CHARACTER_PEDIGREE_META || {};
    return !!id && (meta.available || []).indexOf(id) >= 0;
  });

  const otherSection = deps.ref("relationships");

  const horsesList = deps.ref([]);

  const horsesTotal = deps.ref(0);

  const horsesPagedByApi = deps.ref(false);

  let horseListRevision = 0;

  const horsesListError = deps.ref("");

  const horseDetail = deps.ref(null);

  const horseQuery = deps.ref("");

  const horsePage = deps.ref(1);

  const horsesPerPage = 30;

  let horsesDataPromise = null;

  let horsesListPromise = null;

  let horseIndexUpdatedAt = Date.now();

  function loadHorsesListData(params) {
    const paged = deps.currentUrlPath().split("?")[0] === deps.routes.horses();
    if (
      !paged &&
      window.HORSES &&
      window.HORSES.length &&
      Date.now() - horseIndexUpdatedAt < 300000
    ) {
      horsesList.value = window.HORSES;
      return Promise.resolve();
    }
    const revision = ++horseListRevision;
    const query = paged
      ? params || {
          q: horseQuery.value,
          page: horsePage.value,
          page_size: horsesPerPage,
        }
      : { scope: "index" };
    horsesListPromise = deps.api
      .request("/api/catalog/horses" + deps.api.query(query))
      .then(function (data) {
        if (revision !== horseListRevision) return;
        if (!data || !Array.isArray(data.items))
          throw new Error("invalid horses list");
        horsesPagedByApi.value = paged;
        horsesList.value = data.items;
        horsesTotal.value = data.total;
        if (paged) horsePage.value = data.page;
        else {
          window.HORSES = data.items;
          horseIndexUpdatedAt = Date.now();
        }
      })
      .catch(function () {
        horsesListPromise = null;
        throw new Error("horses list load failed");
      });
    return horsesListPromise;
  }

  const curatedVideos = [
    { id: "BV1N83n6YEyT", title: "“笨蛋，我一直都认可你啊！”" },
    { id: "BV1sRw2ezEXZ", title: "我以世纪大逃 换你奇迹复活" },
    { id: "BV1jF411B7sw", title: "无败的陨落，奇迹的复活「T.E.I.O」" },
    { id: "BV1J5411Q7Do", title: "场上的嘘声对于“反派”的她却是最好的勋章" },
    { id: "BV1Az4y1c7NU", title: "三匹三冠马的对决：特殊的时代" },
    { id: "BV1Q1HUzaE6H", title: "Never give up" },
    { id: "BV1FH4y1z78L", title: "不是所有的马都是卡莲酱的，池添" },
    { id: "BV1vz4y1Y7M3", title: "船哥与121亿日元" },
    { id: "BV1PyfDBaEUE", title: "1993 有马纪念：他们都说我赢不了" },
    { id: "BV12G411r72u", title: "曾风光无限的目白牧场为何解散？" },
    { id: "BV1WY411Y7o5", title: "一匹赛马能为已逝的人类母亲做什么？" },
    { id: "BV1zA411L7YT", title: "一代芦毛马传奇：小栗帽" },
    { id: "BV1znUwB4ELs", title: "后来，那个时代被称为黄金时代" },
    { id: "BV1kSLdznEGS", title: "你强任你强，我有三冠王" },
    { id: "BV1dt4y1o7x1", title: "这就是男子汉的谢幕之际" },
  ];

  function loadPedigreeMeta() {
    if (pedigreeMetaLoadPromise) return pedigreeMetaLoadPromise;
    const source = "/data/character_pedigree_meta.js";
    pedigreeMetaLoadPromise = deps
      .loadDataScript(source, "CHARACTER_PEDIGREE_META")
      .catch(function () {
        delete deps.dataScriptPromises[source];
        pedigreeMetaLoadPromise = null;
      })
      .finally(function () {
        pedigreeMetaLoadPromise = null;
      });
    return pedigreeMetaLoadPromise;
  }

  function loadPedigreeData() {
    if (pedigreeLoadPromise) return pedigreeLoadPromise;
    pedigreeStatus.value = "loading";
    pedigreeError.value = "";
    const source = "/data/pedigree_data.js";
    pedigreeLoadPromise = Promise.all([
      deps.loadCharacterUi(),
      deps.loadDataScript(source, "PED_REL"),
    ])
      .then(function () {
        if (!window.PED_REL || !window.PED_REL.length)
          throw new Error("empty pedigree data");
        pedigreeStatus.value = "ready";
        Vue.nextTick(renderCharBlood);
      })
      .catch(function () {
        pedigreeLoadPromise = null;
        delete deps.dataScriptPromises[source];
        pedigreeStatus.value = "error";
        pedigreeError.value = "血统资料暂时无法载入，请重试。";
      })
      .finally(function () {
        pedigreeLoadPromise = null;
      });
    return pedigreeLoadPromise;
  }

  function retryPedigree() {
    loadPedigreeData().then(function () {
      Vue.nextTick(renderCharBlood);
    });
  }

  function loadHorsesData(id) {
    id = id || decodeURIComponent(deps.routeSegments()[2] || "");
    if (!id) return loadHorsesListData();
    horsesListError.value = "";
    horsesDataPromise = Promise.all([
      loadHorsesListData(),
      deps.api.request("/api/catalog/horse" + deps.api.query({ id })),
    ])
      .then(function (rows) {
        if (!rows[1]?.horse) throw new Error("empty horse data");
        window.HORSES_DETAIL = { ...window.HORSES_DETAIL, [id]: rows[1].horse };
      })
      .catch(function (error) {
        horsesDataPromise = null;
        if (error.message === "HTTP 404") {
          window.HORSES_DETAIL = { ...window.HORSES_DETAIL, [id]: null };
          return;
        }
        horsesListError.value = "原型马资料暂时无法载入，请重试。";
        throw error;
      });
    return horsesDataPromise;
  }

  function retryHorses() {
    loadHorsesData();
  }

  function setOtherSection(section) {
    if (
      ["relationships", "videos", "horses", "jockeys"].indexOf(section) === -1
    )
      return;
    otherSection.value = section;
    horseDetail.value = null;
    if (section === "horses")
      loadHorsesListData().catch(function () {
        horsesListError.value = "原型马目录暂时无法载入，请重试。";
      });
    deps.pushUrl();
  }

  function findHorseById(id) {
    if (!id) return null;
    const arr =
      window.HORSES && window.HORSES.length ? window.HORSES : horsesList.value;
    const norm = String(id).toLowerCase();
    for (let i = 0; i < arr.length; i++) {
      if (String(arr[i].id || "").toLowerCase() === norm) return arr[i];
    }
    return null;
  }

  const horseFiltered = deps.computed(function () {
    if (horsesPagedByApi.value) return horsesList.value;
    let rows = horsesList.value.slice();
    const query = String(horseQuery.value || "")
      .trim()
      .toLowerCase();
    if (query) {
      rows = rows.filter(function (horse) {
        return (
          String(horse.zh || "")
            .toLowerCase()
            .indexOf(query) !== -1 ||
          String(horse.ja || "")
            .toLowerCase()
            .indexOf(query) !== -1 ||
          String(horse.en || "")
            .toLowerCase()
            .indexOf(query) !== -1 ||
          String(horse.birthdate || "").indexOf(query) !== -1
        );
      });
    }
    return rows;
  });

  const horsePaged = deps.computed(function () {
    if (horsesPagedByApi.value) return horsesList.value;
    const start = (horsePage.value - 1) * horsesPerPage;
    return horseFiltered.value.slice(start, start + horsesPerPage);
  });

  const horsePageCount = deps.computed(function () {
    return Math.max(
      1,
      Math.ceil(
        (horsesPagedByApi.value
          ? horsesTotal.value
          : horseFiltered.value.length) / horsesPerPage,
      ),
    );
  });

  const horsePageStart = deps.computed(function () {
    return horseFiltered.value.length
      ? (horsePage.value - 1) * horsesPerPage + 1
      : 0;
  });

  const horsePageEnd = deps.computed(function () {
    return Math.min(
      horsePage.value * horsesPerPage,
      horsesPagedByApi.value ? horsesTotal.value : horseFiltered.value.length,
    );
  });

  const horsePageList = deps.computed(function () {
    return deps.pagerList(horsePage.value, horsePageCount.value);
  });

  function setHorsePage(page) {
    const next = Math.min(Math.max(1, Number(page) || 1), horsePageCount.value);
    horsePage.value = next;
    if (horsesPagedByApi.value) loadHorsesListData();
    deps.resetPageScroll();
    deps.pushUrl();
  }

  function goHorsePage(page) {
    setHorsePage(horsePage.value + page);
  }

  function openHorse(id) {
    const isCurrent = deps.beginEntityNavigation();
    const show = function () {
      if (!isCurrent()) return;
      if (!window.HORSES_DETAIL || !window.HORSES_DETAIL[id]) return;
      deps.clearEntityDetails("horse");
      deps.activeTab.value = "database";
      deps.dbView.value = "other";
      otherSection.value = "horses";
      horseDetail.value = window.HORSES_DETAIL[id];
      horseQuery.value = "";
      deps.resetPageScroll();
      deps.pushUrl();
    };
    return Promise.resolve(loadHorsesData(id)).then(show, show);
  }

  const horseMajorExpanded = deps.ref(false);

  function horseRaceRows(detail) {
    const rows = (detail.races || []).slice();
    const dates = new Set(
      rows
        .map((row) => row.date)
        .filter((date) => /^\d{4}\.\d{2}\.\d{2}$/.test(date)),
    );
    const keys = new Set(rows.map((row) => row.date + ":" + row.race));
    (detail.major || []).forEach((row) => {
      const key = row.date + ":" + row.race;
      if (dates.has(row.date) || keys.has(key)) return;
      rows.push(row);
      keys.add(key);
    });
    return rows;
  }

  const horseMajorTotal = deps.computed(function () {
    const detail = horseDetail.value || {};
    return horseRaceRows(detail).length;
  });

  let horseGradeIndex = null;

  function horseGradeFor(race, date) {
    if (!window.HORSES_DETAIL) return "";
    if (!horseGradeIndex) {
      horseGradeIndex = {};
      let found = false;
      Object.keys(window.HORSES_DETAIL).forEach(function (id) {
        (window.HORSES_DETAIL[id].major || []).forEach(function (m) {
          if (!m.grade || !m.race) return;
          found = true;
          const year = String(m.date || "").slice(0, 4);
          const core = m.race.replace(/（[^）]*）/g, "").trim();
          [m.race, core].forEach(function (key) {
            if (!key) return;
            const slots = horseGradeIndex[key] || (horseGradeIndex[key] = {});
            const slot = slots[year] || (slots[year] = {});
            slot[m.grade] = (slot[m.grade] || 0) + 1;
          });
        });
      });
      if (!found) horseGradeIndex = null;
    }
    if (!horseGradeIndex) return "";
    const key = String(race || "");
    const core = key.replace(/（[^）]*）/g, "").trim();
    const entry = horseGradeIndex[key] || horseGradeIndex[core];
    if (!entry) return "";
    const pick = function (slot) {
      let best = "";
      let bestN = 0;
      Object.keys(slot).forEach(function (g) {
        if (slot[g] > bestN) {
          best = g;
          bestN = slot[g];
        }
      });
      return best;
    };
    const year = String(date || "").slice(0, 4);
    if (entry[year]) return pick(entry[year]);
    const years = Object.keys(entry);
    if (!years.length) return "";
    years.sort(function (a, b) {
      return (
        Math.abs(Number(a) - Number(year)) - Math.abs(Number(b) - Number(year))
      );
    });
    return pick(entry[years[0]]);
  }

  const horseMajorRows = deps.computed(function () {
    const detail = horseDetail.value || {};
    const source = horseRaceRows(detail);
    const rows = source.map(function (row) {
      const place = String(row.place == null ? "" : row.place).trim();
      const distance = String(row.distance || "");
      return {
        date: row.date || "",
        track: row.track || "",
        race: row.race || "",
        grade: row.grade || horseGradeFor(row.race, row.date) || "",
        placeLabel: /^\d+$/.test(place) ? place + "着" : place || "—",
        surface: row.surface || "",
        distance: distance
          ? /\d$/.test(distance)
            ? distance + "m"
            : distance
          : "",
        top: row.winner || row.beaten || "",
        prize: row.prize || "",
      };
    });
    rows.sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    return horseMajorExpanded.value ? rows : rows.slice(0, 10);
  });

  function toggleHorseMajor() {
    horseMajorExpanded.value = !horseMajorExpanded.value;
  }

  const horseFacts = deps.computed(function () {
    const facts = (horseDetail.value && horseDetail.value.facts) || {};
    const defs = [
      ["sire", "父系"],
      ["dam", "母系"],
      ["damsire", "外祖父"],
      ["owner", "马主"],
      ["breeder", "生产牧场"],
      ["farm", "牧场"],
      ["trainer", "调教师"],
      ["stable", "厩舍"],
      ["record", "战绩"],
      ["earnings", "总赏金"],
      ["registration", "登记"],
      ["country", "产地"],
    ];
    return defs
      .filter(function (entry) {
        return String(facts[entry[0]] || "").trim();
      })
      .map(function (entry) {
        return { name: entry[1], value: String(facts[entry[0]]).trim() };
      });
  });

  function horseSexLabel(horse) {
    const sex = horse && horse.sex;
    if (sex === "male") return "牡马";
    if (sex === "female") return "牝马";
    if (sex === "gelding") return "阉马";
    return "—";
  }

  function horseForCharacter(characterId) {
    const normalized = String(characterId || "").toLowerCase();
    let pool = window.HORSES && window.HORSES.length ? window.HORSES : [];
    if (!pool.length && window.HORSES_DETAIL)
      pool = Object.keys(window.HORSES_DETAIL).map(function (key) {
        return window.HORSES_DETAIL[key];
      });
    for (let i = 0; i < pool.length; i++) {
      const horse = pool[i];
      if (String(horse.id || "").toLowerCase() === normalized) return horse;
      if (
        (horse.cids || []).some(function (cid) {
          return String(cid || "").toLowerCase() === normalized;
        })
      )
        return horse;
    }
    return null;
  }

  function horseUrlForCharacter(characterId) {
    const horse = horseForCharacter(characterId);
    return horse ? deps.routes.horses(horse.id) : "";
  }

  function openHorseForCharacter(characterId) {
    const horse = horseForCharacter(characterId);
    if (horse) openHorse(horse.id);
  }

  function horseChars(horse) {
    return ((horse && horse.cids) || []).map(deps.findCharById).filter(Boolean);
  }

  function horseSourceName(url) {
    const value = String(url || "");
    if (value.indexOf("jbis.or.jp") !== -1) return "JBIS（轻井泽赛马信息）";
    if (value.indexOf("db.netkeiba.com") !== -1) return "netkeiba";
    if (value.indexOf("zh.wikipedia.org") !== -1) return "中文维基百科";
    if (value.indexOf("ja.wikipedia.org") !== -1) return "日文维基百科";
    return value;
  }

  function onHorseImageError(event) {
    const image = event && event.currentTarget;
    if (!image) return;
    const replaced = "/uma_tools/img/album-placeholder.svg";
    if (!String(image.src || "").endsWith("album-placeholder.svg"))
      image.src = replaced;
  }

  let horseSearchTimer;

  function renderCharBlood() {
    var box = document.getElementById("cCharBlood");
    if (!box) return;
    box.innerHTML = "";
    var id = deps.charDetail.value && deps.charDetail.value.id;
    if (
      !id ||
      deps.charSection.value !== "pedigree" ||
      !charHasPedigree.value ||
      pedigreeStatus.value !== "ready"
    )
      return;
    if (typeof window.renderBloodGraphInDetail !== "function") {
      pedigreeStatus.value = "error";
      pedigreeError.value = "血统组件暂时无法载入，请重试。";
      return;
    }
    if (window.renderBloodGraphInDetail(box, id) === false) {
      box.innerHTML = "";
      deps.charSection.value = "profile";
      deps.pushUrl(true);
    }
  }
  function start() {
    deps.watch(horseDetail, function () {
      horseMajorExpanded.value = false;
    });
    deps.watch(
      horseQuery,
      function () {
        if (!deps.restoringRoute) {
          horsePage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      horseQuery,
      function () {
        if (
          deps.restoringRoute ||
          deps.currentUrlPath().split("?")[0] !== deps.routes.horses()
        )
          return;
        window.clearTimeout(horseSearchTimer);
        horseSearchTimer = window.setTimeout(() => loadHorsesListData(), 180);
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    charHasPedigree,
    curatedVideos,
    findHorseById,
    goHorsePage,
    horseChars,
    horseDetail,
    horseFacts,
    horseFiltered,
    horseMajorExpanded,
    horseMajorRows,
    horseMajorTotal,
    horsePage,
    horsePageCount,
    horsePageEnd,
    horsePageList,
    horsePageStart,
    horsePaged,
    horseQuery,
    horseSexLabel,
    horseSourceName,
    horseUrlForCharacter,
    horsesList,
    horsesListError,
    horsesPerPage,
    loadHorsesData,
    loadHorsesListData,
    loadPedigreeData,
    loadPedigreeMeta,
    onHorseImageError,
    openHorse,
    openHorseForCharacter,
    otherSection,
    pedigreeError,
    pedigreeStatus,
    renderCharBlood,
    retryHorses,
    retryPedigree,
    setHorsePage,
    setOtherSection,
    toggleHorseMajor,
  };
}
