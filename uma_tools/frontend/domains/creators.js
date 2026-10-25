/* creators state and behavior; external dependencies are explicit live ports. */
export function createCreators(deps) {
  let creatorCatalogLoadPromise = null;
  let creatorListRevision = 0;
  let creatorSearchTimer;
  const creatorTotal = deps.ref(0);

  const creatorCatalog = deps.ref({ coverage: {}, creators: [] });

  const creatorCatalogError = deps.ref("");

  const creatorCatalogLoading = deps.ref(false);

  const creatorDetail = deps.ref(null);

  const creatorSection = deps.ref("works");

  const expandedCreatorWorkId = deps.ref("");

  const creatorQuery = deps.ref("");

  const creatorPage = deps.ref(1);

  const creatorsPerPage = 40;

  function loadCreatorCatalog(params) {
    const revision = ++creatorListRevision;
    const query = params || { q: creatorQuery.value, page: creatorPage.value };
    creatorCatalogError.value = "";
    creatorCatalogLoading.value = true;
    creatorCatalogLoadPromise = deps.api
      .request('/api/catalog/creators' + deps.api.query({ ...query, type: 'person', page_size: creatorsPerPage }))
      .then(function (data) {
        if (revision !== creatorListRevision) return;
        creatorCatalog.value =
          data && Array.isArray(data.items)
            ? {
                build_id: data.build_id || "",
                coverage: data.coverage || {},
                creators: data.items,
              }
            : { build_id: "", coverage: {}, creators: [] };
        creatorTotal.value = data.total || 0;
        creatorPage.value = data.page || 1;
      })
      .catch(function () {
        if (revision !== creatorListRevision) return;
        creatorCatalogLoadPromise = null;
        creatorCatalog.value = { coverage: {}, creators: [] };
        creatorCatalogError.value = "创作者资料暂时无法载入。";
      })
      .finally(function () {
        if (revision !== creatorListRevision) return;
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

  const creatorCurrentPage = deps.computed(function () {
    return creatorCatalog.value.creators || [];
  });

  const creatorPageCount = deps.computed(function () {
    return Math.max(
      1,
      Math.ceil(creatorTotal.value / creatorsPerPage),
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
    loadCreatorCatalog();
    const top = document.getElementById("creatorArchiveTop");
    if (top) top.scrollIntoView({ behavior: window.UmaUi.scrollBehavior(), block: "start" });
  }

  function goCreatorPage(delta) {
    setCreatorPage(creatorPage.value + delta);
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
        deps.loadAnimeCatalogOptional("creator", found.id);
      })
      .catch(function (error) {
        if (isCurrent() && error.message === "HTTP 404") {
          deps.notFound.value = true;
          deps.activeTab.value = "not-found";
        } else if (isCurrent()) {
          deps.navigationError.value = "创作者资料暂时无法载入，请重试。";
          deps.navigationRetry.value = () => openCreator(creatorOrId, section);
        }
      });
  }

  function creatorRoleLabel(role, related = []) {
    const roles = [...(creatorDetail.value?.roles || []),
      ...related.flatMap(creator => creator?.roles || []),
      ...creatorCatalog.value.creators.flatMap(creator => creator.roles || [])];
    return roles.find(entry => entry.role === role)?.label || role || '';
  }

  function creatorWorkRoleLabels(roles) {
    return (roles || []).map(role => creatorRoleLabel(role)).join(" ");
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
      deps.findSong(work.song_id)?.detail_complete &&
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
          creatorListRevision += 1;
          creatorPage.value = 1;
          deps.pushUrl(true);
          clearTimeout(creatorSearchTimer);
          creatorSearchTimer = setTimeout(() => {
            if (window.location.pathname === deps.routes.creators()) loadCreatorCatalog();
          }, 250);
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
    creatorCurrentPage,
    creatorPage,
    creatorPageCount,
    creatorPageList,
    creatorPortrait,
    creatorQuery,
    creatorRecordingErrors,
    creatorRecordingLoading,
    creatorRoleLabel,
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
    setCreatorSection,
    toggleCreatorWork,
  };
}
