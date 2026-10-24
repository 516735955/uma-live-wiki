/* characters state and behavior; external dependencies are explicit live ports. */
export function createCharacters(deps) {
  const characterIndex = deps.ref(window.CHAR_INDEX || []);
  const appearanceSongs = deps.reactive({});

  const appearanceIndex = deps.ref({ voice_actors: {}, characters: {} });

  const appearanceLoading = deps.reactive({});

  const appearanceErrors = deps.reactive({});

  const charDetail = deps.ref(null);

  const charSort = deps.ref("default");

  const charSection = deps.ref("profile");

  const charHistoryQuery = deps.ref("");

  const charHistoryKind = deps.ref("all");

  const charAppearance = deps.computed(function () {
    const id = charDetail.value && charDetail.value.id;
    return (
      (id &&
        appearanceIndex.value.characters &&
        appearanceIndex.value.characters[id]) || { events: [], songs: [] }
    );
  });

  function loadCharacterUi() {
    return deps
      .loadDataScript("/uma_tools/character-ui.js", "UmaCharacterUi")
      .then(function () {
        if (window.UmaCharacterUi) Vue.nextTick(window.UmaCharacterUi.init);
      });
  }

  function loadCharacterIndexData() {
    return deps.loadDataScript("/data/character_index_data.js", "CHAR_INDEX").then(function () {
      characterIndex.value = window.CHAR_INDEX || [];
    });
  }

  function loadCharacterDetailData() {
    return Promise.all([
      loadCharacterIndexData(),
      deps.loadDataScript("/data/character_detail_data.js", "CHAR_DETAIL"),
    ]);
  }

  const appearanceLoads = {};

  function loadRelationshipData(type, id) {
    if (!type || !id) return Promise.resolve();
    const key = type + ":" + id;
    if (appearanceLoads[key]) return appearanceLoads[key];
    appearanceErrors[key] = "";
    appearanceLoading[key] = true;
    appearanceLoads[key] = deps.api
      .request(
        "/api/catalog/appearance" + deps.api.query({ type: type, id: id }),
      )
      .then(function (data) {
        const table =
          type === "voice_actor"
            ? appearanceIndex.value.voice_actors
            : appearanceIndex.value.characters;
        table[id] = (data && data.appearance) || {
          events: [],
          songs: [],
          performed_songs: [],
        };
        appearanceSongs[key] = (data && data.songs) || [];
      })
      .catch(function () {
        delete appearanceLoads[key];
        appearanceErrors[key] = "资料暂时无法载入，请重试。";
      })
      .finally(function () {
        delete appearanceLoads[key];
        appearanceLoading[key] = false;
      });
    return appearanceLoads[key];
  }

  function appearanceIsLoading(type, id) {
    return !!appearanceLoading[type + ":" + id];
  }

  function appearanceError(type, id) {
    return appearanceErrors[type + ":" + id] || "";
  }

  function retryAppearance(type, id) {
    return loadRelationshipData(type, id);
  }

  function appearanceSessionLabel(event) {
    if (!event.session_id && event.end_date && event.end_date !== event.date)
      return "场次未明确";
    const label = String(event.session_label || "").trim();
    return label &&
      !["本公演", "本期节目"].includes(label) &&
      !String(event.title || "")
        .toLowerCase()
        .includes(label.toLowerCase())
      ? label
      : "";
  }

  function appearanceDateLabel(event) {
    return event.date
      ? event.date +
          (!event.session_id && event.end_date && event.end_date !== event.date
            ? " – " + event.end_date
            : "")
      : "待公布";
  }

  const characterSortOptions = [
    { value: "default", label: "默认顺序" },
    { value: "zh", label: "按中文名" },
    { value: "en", label: "按英文名" },
    { value: "cv", label: "按声优" },
  ];

  function setCharSection(section) {
    if (
      ["profile", "pedigree", "songs", "anime", "events"].indexOf(section) ===
      -1
    )
      return;
    charSection.value = section;
    deps.pushUrl(true);
    if (section === "pedigree") {
      deps.loadPedigreeData().then(function () {
        Vue.nextTick(deps.renderCharBlood);
      });
    }
    if (section === "anime") deps.loadAnimeCatalogOptional();
    if ((section === "songs" || section === "events") && charDetail.value) {
      loadRelationshipData("character", charDetail.value.id);
    }
  }

  function openCharacter(id) {
    deps.loadHorsesListData({scope: "index"}).catch(() => {});
    const isCurrent = deps.beginEntityNavigation();
    const show = function () {
      if (!isCurrent()) return;
      const found = findCharById(id);
      if (!found) return;
      deps.clearEntityDetails("character");
      deps.activeTab.value = "database";
      deps.dbView.value = "characters";
      charDetail.value = found;
      charSection.value = "profile";
      if (!isCurrent.fromRoute) deps.resetPageScroll();
      deps.pushUrl(isCurrent.fromRoute);
      deps.loadAnimeCatalogOptional('character', found.id);
      Vue.nextTick(function () {
        if (typeof window.renderCharacterDetail === "function")
          window.renderCharacterDetail(null);
      });
    };
    return Promise.all([
      loadCharacterDetailData(),
      deps.loadVoiceData(),
      deps.loadPedigreeMeta(),
    ])
      .then(loadCharacterUi)
      .then(show, function () {
        if (!isCurrent()) return;
        show();
        deps.navigationError.value = "角色完整资料暂时无法载入，请重试。";
        deps.navigationRetry.value = () => openCharacter(id);
      });
  }

  function openCharDetail(id) {
    return openCharacter(id);
  }

  function characterName(characterId) {
    const character = findCharById(characterId);
    return character ? character.zh : "—";
  }

  function characterImage(characterId) {
    const character = findCharById(characterId);
    return character ? character.img : "";
  }

  function characterPerformanceImage(characterId) {
    const character = findCharById(characterId);
    return character ? character.av : "";
  }

  function characterColor(characterId) {
    const character = findCharById(characterId);
    return character ? character.main : "#3157ed";
  }

  function findCharById(id) {
    if (!id) return null;
    var arr = characterIndex.value;
    var norm = String(id).toLowerCase();
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i].id || "").toLowerCase() === norm) {
        var c = arr[i];
        return {
          id: c.id,
          zh: c.zh,
          ja: c.ja || c.name,
          en: c.en || c.name,
          img: c.img || c.av || "",
          av: c.av || "",
          cv: c.cv || "",
          cv_zh: c.cv_zh || c.cv || "",
          main: c.main || "#8c83ff",
          sub: c.sub || "#ece9ff",
          role_type: c.role_type || "",
          summary_zh: c.summary_zh || "",
          readMore: c.page
            ? c.page.replace("zh.moegirl.org.cn", "mobile.moegirl.org.cn")
            : "https://mobile.moegirl.org.cn/" +
              encodeURIComponent("赛马娘_Pretty_Derby/登场人物"),
          birth: c.birth || "",
          height: c.height || "",
          weight: c.weight || "",
          sankak: c.sankak || "",
        };
      }
    }
    return null;
  }

  function findCharByDisplayName(name) {
    var target = deps.normName(name);
    if (!target) return null;
    var arr = characterIndex.value;
    for (var i = 0; i < arr.length; i++) {
      var candidate = arr[i];
      var names = [candidate.zh, candidate.ja, candidate.name, candidate.en];
      if (
        names.some(function (value) {
          return deps.normName(value) === target;
        })
      ) {
        return findCharById(candidate.id);
      }
    }
    return null;
  }

  function findCharByAvatar(src) {
    var path = String(src || "").split("?")[0];
    var base = path
      .split("/")
      .pop()
      .replace(/\.[A-Za-z0-9]+$/, "");
    if (!base) return null;
    return (
      findCharById(base.replace(/\s+/g, "").toLowerCase()) ||
      findCharByDisplayName(base)
    );
  }
  function start() {
    window.addEventListener?.('uma-catalog-change', () => {
      Object.keys(appearanceSongs).forEach(key => delete appearanceSongs[key]);
      appearanceIndex.value = {voice_actors:{},characters:{}};
      if (charDetail.value && ['songs','events'].includes(charSection.value))
        loadRelationshipData('character', charDetail.value.id);
    });
    deps.watch(
      function () {
        return charDetail.value && charDetail.value.id;
      },
      function () {
        charHistoryQuery.value = "";
        charHistoryKind.value = "all";
        deps.expandedRelationSongId.value = "";
      },
    );
    deps.watch(charSort, function () {
      window.dispatchEvent(new CustomEvent("uma-character-sort"));
    });
  }
  return {
    start,
    appearanceDateLabel,
    appearanceError,
    appearanceIndex,
    appearanceIsLoading,
    appearanceSessionLabel,
    appearanceSongs,
    charAppearance,
    charDetail,
    charHistoryKind,
    charHistoryQuery,
    charSection,
    charSort,
    characterColor,
    characterImage,
    characterPerformanceImage,
    characterName,
    characterSortOptions,
    findCharByAvatar,
    findCharByDisplayName,
    findCharById,
    loadCharacterDetailData,
    loadCharacterIndexData,
    loadCharacterUi,
    loadRelationshipData,
    openCharDetail,
    openCharacter,
    retryAppearance,
    setCharSection,
  };
}
