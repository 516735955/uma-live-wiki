/* creators state and behavior; external dependencies are explicit live ports. */
export function createCreators(deps) {
  let creatorCatalogLoadPromise = null;

  const creatorCatalog = deps.ref({ coverage: {}, creators: [] });

  const creatorCatalogError = deps.ref("");

  const creatorCatalogLoading = deps.ref(false);

  const creatorDetail = deps.ref(null);

  const creatorSection = deps.ref("works");

  const expandedCreatorWorkId = deps.ref("");

  const creatorQuery = deps.ref("");

  const creatorRole = deps.ref("all");

  const creatorPage = deps.ref(1);

  const creatorsPerPage = 40;

  function loadCreatorCatalog() {
    if (creatorCatalogLoadPromise) return creatorCatalogLoadPromise;
    creatorCatalogError.value = "";
    creatorCatalogLoading.value = true;
    creatorCatalogLoadPromise = deps.api
      .request("/api/catalog/creators?page_size=5000")
      .then(function (data) {
        creatorCatalog.value =
          data && Array.isArray(data.items)
            ? {
                build_id: data.build_id || "",
                coverage: data.coverage || {},
                creators: data.items,
              }
            : { build_id: "", coverage: {}, creators: [] };
        if (!creatorCatalog.value.creators.length)
          creatorCatalogError.value = "创作者资料为空。";
      })
      .catch(function () {
        creatorCatalogLoadPromise = null;
        creatorCatalog.value = { coverage: {}, creators: [] };
        creatorCatalogError.value = "创作者资料暂时无法载入。";
      })
      .finally(function () {
        creatorCatalogLoadPromise = null;
        creatorCatalogLoading.value = false;
      });
    return creatorCatalogLoadPromise;
  }

  function setCreatorSection(section) {
    if (["works", "collaborators"].indexOf(section) === -1) return;
    creatorSection.value = section;
    deps.pushUrl(true);
  }

  const creatorFiltered = deps.computed(function () {
    const query = String(creatorQuery.value || "")
      .trim()
      .toLowerCase();
    return (creatorCatalog.value.creators || []).filter(function (creator) {
      if (creator.type === "organization") return false;
      if (
        creatorRole.value !== "all" &&
        !(creator.roles || []).some(function (role) {
          return role.role === creatorRole.value;
        })
      )
        return false;
      if (!query) return true;
      return (
        String(
          creator.search_text ||
            [creator.name]
              .concat(creator.aliases || [], creator.affiliations || [])
              .join(" "),
        )
          .toLowerCase()
          .indexOf(query) !== -1
      );
    });
  });

  const creatorPageCount = deps.computed(function () {
    return Math.max(
      1,
      Math.ceil(creatorFiltered.value.length / creatorsPerPage),
    );
  });

  const creatorPaged = deps.computed(function () {
    const start = (creatorPage.value - 1) * creatorsPerPage;
    return creatorFiltered.value.slice(start, start + creatorsPerPage);
  });

  const creatorPageStart = deps.computed(function () {
    return creatorFiltered.value.length
      ? (creatorPage.value - 1) * creatorsPerPage + 1
      : 0;
  });

  const creatorPageEnd = deps.computed(function () {
    return Math.min(
      creatorPage.value * creatorsPerPage,
      creatorFiltered.value.length,
    );
  });

  const creatorPageList = deps.computed(function () {
    return deps.pagerList(creatorPage.value, creatorPageCount.value);
  });

  function setCreatorPage(page) {
    if (page === "…") return;
    const next = parseInt(page, 10);
    if (isNaN(next) || next < 1 || next > creatorPageCount.value) return;
    creatorPage.value = next;
    deps.pushUrl();
    const top = document.getElementById("creatorArchiveTop");
    if (top) top.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goCreatorPage(delta) {
    setCreatorPage(creatorPage.value + delta);
  }

  function setCreatorRole(role) {
    creatorRole.value = role;
    creatorPage.value = 1;
    deps.pushUrl();
  }

  function openCreator(creatorOrId, section) {
    creatorCatalogError.value = "";
    const isCurrent = deps.beginEntityNavigation();
    const requested =
      typeof creatorOrId === "string"
        ? creatorOrId
        : creatorOrId && creatorOrId.id;
    return deps.api
      .request(
        "/api/catalog/creator" +
          deps.api.query({
            id: requested,
            revision: creatorCatalog.value.build_id,
          }),
      )
      .then(function (data) {
        if (!isCurrent()) return;
        const found = data && data.creator;
        if (!found) {
          deps.notFound.value = true;
          deps.activeTab.value = "not-found";
          return;
        }
        if (found.type === "organization")
          return deps.navigateTo(
            deps.routes.songs(found.works[0].song_id),
            isCurrent.fromRoute,
          );
        const requestedCreator =
          typeof creatorOrId === "string" ? null : creatorOrId;
        const catalogCreator = (creatorCatalog.value.creators || []).find(
          function (item) {
            return String(item.id) === String(found.id);
          },
        );
        found.image =
          found.image ||
          (requestedCreator && requestedCreator.image) ||
          (catalogCreator && catalogCreator.image);
        found.photo =
          found.photo ||
          (requestedCreator && requestedCreator.photo) ||
          (catalogCreator && catalogCreator.photo);
        deps.clearEntityDetails("creator");
        creatorDetail.value = found;
        creatorSection.value = section || "works";
        expandedCreatorWorkId.value = "";
        deps.activeTab.value = "database";
        deps.dbView.value = "creators";
        if (!isCurrent.fromRoute) deps.resetPageScroll();
        deps.pushUrl(isCurrent.fromRoute);
        return deps.loadAnimeCatalogOptional("creator", found.id);
      })
      .catch(function (error) {
        if (isCurrent() && error.message === "HTTP 404") {
          deps.notFound.value = true;
          deps.activeTab.value = "not-found";
        } else if (isCurrent())
          deps.navigationError.value = "创作者资料暂时无法载入，请重试。";
      });
  }

  function creatorRoleLabels(roles) {
    return (roles || [])
      .map(function (role) {
        return role.label || role.role;
      })
      .join(" · ");
  }

  function creatorRoleLabel(role) {
    return (
      {
        lyricist: "作词",
        composer: "作曲",
        arranger: "编曲",
        remixer: "混音改编",
        producer: "制作",
        orchestrator: "配器",
      }[role] ||
      role ||
      ""
    );
  }

  function creatorWorkRoleLabels(roles) {
    return (roles || []).map(creatorRoleLabel).join(" · ");
  }

  function creatorPortrait(creator) {
    return (
      (creator && (creator.image || creator.photo)) ||
      window.UmaUi.identityPortrait(creator)
    );
  }

  const creatorRecordingLoading = deps.reactive({});

  const creatorRecordingErrors = deps.reactive({});

  function creatorWorkVersions(work) {
    const song = deps.findSong(work.song_id);
    return (work.versions || []).map((credit) => {
      const version = (song?.versions || []).find(
        (row) => row.id === credit.id,
      );
      return { ...credit, releases: version?.releases || [] };
    });
  }

  async function loadCreatorRecording(work) {
    if (!work || creatorRecordingLoading[work.song_id]) return;
    if (
      deps.findSong(work.song_id)?.versions &&
      !creatorRecordingErrors[work.song_id]
    )
      return;
    creatorRecordingLoading[work.song_id] = true;
    creatorRecordingErrors[work.song_id] = "";
    try {
      const data = await deps.api.request(
        "/api/catalog/song" + deps.api.query({ id: work.song_id }),
      );
      if (!data?.song) throw new Error("No song");
      deps.mergeSong(data.song);
    } catch (_) {
      creatorRecordingErrors[work.song_id] = "录音信息暂时无法载入";
    } finally {
      creatorRecordingLoading[work.song_id] = false;
    }
  }

  function toggleCreatorWork(workId) {
    expandedCreatorWorkId.value =
      expandedCreatorWorkId.value === workId ? "" : workId;
    if (expandedCreatorWorkId.value)
      loadCreatorRecording(
        creatorDetail.value.works.find((work) => work.song_id === workId),
      );
  }
  function start() {
    deps.watch(
      creatorQuery,
      function () {
        if (!deps.restoringRoute) {
          creatorPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    creatorCatalog,
    creatorCatalogError,
    creatorCatalogLoading,
    creatorDetail,
    creatorFiltered,
    creatorPage,
    creatorPageCount,
    creatorPageEnd,
    creatorPageList,
    creatorPageStart,
    creatorPaged,
    creatorPortrait,
    creatorQuery,
    creatorRecordingErrors,
    creatorRecordingLoading,
    creatorRole,
    creatorRoleLabel,
    creatorRoleLabels,
    creatorSection,
    creatorWorkRoleLabels,
    creatorWorkVersions,
    creatorsPerPage,
    expandedCreatorWorkId,
    goCreatorPage,
    loadCreatorCatalog,
    loadCreatorRecording,
    openCreator,
    setCreatorPage,
    setCreatorRole,
    setCreatorSection,
    toggleCreatorWork,
  };
}
