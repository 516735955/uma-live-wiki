/* albums state and behavior; external dependencies are explicit live ports. */
export function createAlbums(deps) {
  const albums = deps.ref([]);

  const albumsError = deps.ref("");

  const albumsLoading = deps.ref(false);

  const albumsTotal = deps.ref(0);

  const albumTypes = deps.ref([]);

  const albumYears = deps.ref([]);

  let albumListRevision = 0;

  const albumDetail = deps.ref(null);

  let albumsLoadPromise = null;

  const relFilter = deps.ref("");

  const relYear = deps.ref("");

  const relQuery = deps.ref("");

  const relWork = deps.ref("");

  const relSort = deps.ref("newest");

  const relWorkList = [
    { key: "s1", label: "动画 Season 1" },
    { key: "s2", label: "动画 Season 2" },
    { key: "s3", label: "动画 Season 3" },
    { key: "rttp", label: "ROAD TO THE TOP" },
    { key: "movie", label: "新時代の扉" },
    { key: "cinderella", label: "芦毛灰姑娘" },
    { key: "yon", label: "赛马娘四格" },
    { key: "yuru", label: "摇曳马娘" },
    { key: "starting-gate", label: "STARTING GATE" },
    { key: "winning-live", label: "WINNING LIVE" },
    { key: "solo-vocal", label: "Solo Vocal Tracks" },
    { key: "other", label: "其他作品／独立发行" },
  ];

  const relPage = deps.ref(1);

  const albumSortOptions = [
    { value: "newest", label: "发售时间" },
    { value: "name", label: "名称" },
  ];

  function relationSong(reference) {
    const key = deps.charDetail.value
      ? "character:" + deps.charDetail.value.id
      : "voice_actor:" + (deps.voiceDetail.value && deps.voiceDetail.value.id);
    const target = reference && (reference.song_id || reference.name);
    return (
      (deps.appearanceSongs[key] || []).find(function (song) {
        return song.id === target;
      }) || deps.findSong(target)
    );
  }

  function relationSongVersions(reference, entityType, entityId) {
    const song = relationSong(reference);
    if (!song) return [];
    const allowed = new Set((reference && reference.version_ids) || []);
    return (song.versions || [])
      .filter(function (version) {
        return !allowed.size || allowed.has(version.id);
      })
      .map(function (version) {
        const releases = (version.releases || []).filter(function (release) {
          return (release.vocalists || []).some(function (vocalist) {
            return entityType === "character"
              ? vocalist.character_id === entityId
              : vocalist.voice_actor_id === entityId;
          });
        });
        return {
          id: version.id,
          title: version.title,
          version_label: version.version_label,
          releases: releases,
        };
      })
      .filter(function (version) {
        return version.releases.length;
      });
  }

  function relationReleaseVocalists(release, entityType, entityId) {
    const vocalists = (release && release.vocalists) || [];
    const matches = (vocalist) =>
      entityType === "character"
        ? vocalist.character_id === entityId
        : vocalist.voice_actor_id === entityId;
    return vocalists
      .filter(matches)
      .concat(vocalists.filter((vocalist) => !matches(vocalist)));
  }

  function openAlbumFromSong(item) {
    const release = item && item.release ? item.release : item;
    const album = albums.value.find(function (entry) {
      return entry.name === release.album_name;
    }) || { name: release.album_name };
    if (!album.name) return;
    openAlbum(album);
  }

  function findAlbumTrackSong(track, trackIndex, album) {
    const number = Number(trackIndex) + 1;
    return Object.values(deps.songsById)
      .concat(deps.songCatalog.value.songs || [])
      .find((song) =>
        (song.versions || []).some((version) =>
          (version.releases || []).some(
            (release) =>
              Number(release.track_number) === number &&
              album &&
              ((album.id && release.album_id === album.id) ||
                (album.catalog && release.catalog === album.catalog) ||
                release.album_name === album.name),
          ),
        ),
      );
  }

  function albumTrackSongId(track, trackIndex) {
    const song = findAlbumTrackSong(
      track,
      trackIndex,
      albumDetail.value && albumDetail.value.data,
    );
    return song ? song.id : track.name;
  }

  function albumTrackVocalists(track, trackIndex) {
    const album = albumDetail.value && albumDetail.value.data;
    const song = findAlbumTrackSong(track, trackIndex, album);
    if (!album || !song) return [];
    const number = Number(trackIndex) + 1;
    for (const version of song.versions || []) {
      for (const release of version.releases || []) {
        if (
          release.album_name !== album.name ||
          Number(release.track_number) !== number
        )
          continue;
        return (release.vocalists || []).map(function (vocalist) {
          const voice = deps.findVaBySlug(vocalist.voice_actor_id);
          return {
            voice_actor_id: vocalist.voice_actor_id,
            name: deps.voiceName(
              vocalist.voice_actor_id,
              vocalist.voice_actor_name,
            ),
            image: (voice && voice.photo) || "",
            color: vocalist.character && vocalist.character.color_main,
          };
        });
      }
    }
    return [];
  }

  function albumTrackSecondary(track) {
    const title = String((track && track.name) || "").normalize("NFKC");
    if (/(?:off[ -]?vocal|instrumental|inst\.?|BGM|伴奏|纯音乐)/i.test(title))
      return "";
    return (track && track.artist) || "";
  }

  function releaseSingerLabel(version, release) {
    if (version && version.instrumental) return "";
    return (release && release.artist) || "";
  }

  function albumName(a) {
    return a.name;
  }

  function findAlbumById(id) {
    const target = String(id || "");
    return target
      ? albums.value.find(function (album) {
          return String(album.id || "") === target;
        }) || null
      : null;
  }

  function openAlbum(a) {
    albumsError.value = "";
    const isCurrent = deps.beginEntityNavigation();
    const name = a && a.name;
    if (!name && !(a && a.id)) return Promise.resolve();
    return Promise.all([
      deps.api.request(
        "/api/catalog/album" + deps.api.query({ id: a.id, name: name }),
      ),
      deps.loadVoiceData(),
      deps.loadCharacterIndexData(),
      deps.loadAnimeCatalogOptional("album", a.id),
    ])
      .then(function (rows) {
        if (!isCurrent()) return;
        const data = rows[0];
        if (!data || !data.album) {
          deps.notFound.value = true;
          deps.activeTab.value = "not-found";
          return;
        }
        (data.catalog_songs || []).forEach(deps.mergeSong);
        deps.clearEntityDetails("album");
        deps.activeTab.value = "database";
        deps.dbView.value = "albums";
        albumDetail.value = { data: data.album, songs: data.album.songs || [] };
        if (!isCurrent.fromRoute) deps.resetPageScroll();
        deps.pushUrl(isCurrent.fromRoute);
      })
      .catch(function (error) {
        if (isCurrent() && error.message === "HTTP 404") {
          deps.notFound.value = true;
          deps.activeTab.value = "not-found";
        } else if (isCurrent())
          deps.navigationError.value = "专辑资料暂时无法载入，请重试。";
      });
  }

  function openAlbumFromDb(a) {
    openAlbum(a);
  }

  function buildAlbumPlayerTracks(album) {
    const detail = album && album.data ? album.data : album;
    const songs = (album && album.songs) || (detail && detail.songs) || [];
    return songs.map(function (song, index) {
      const found = findAlbumTrackSong(song, index, detail);
      let matchedVersion = null;
      let matchedRelease = null;
      ((found && found.versions) || []).some(function (version) {
        const release = (version.releases || []).find(function (row) {
          const sameCatalog =
            detail && detail.catalog && row.catalog === detail.catalog;
          const sameAlbum =
            detail && detail.name && row.album_name === detail.name;
          return (
            (sameCatalog || sameAlbum) && Number(row.track_number) === index + 1
          );
        });
        if (!release) return false;
        matchedVersion = version;
        matchedRelease = release;
        return true;
      });
      return deps.buildPlayerTrack({
        id:
          (matchedVersion && matchedVersion.id) ||
          song.url ||
          [
            detail && (detail.catalog || detail.name),
            index + 1,
            found && found.id,
          ]
            .filter(Boolean)
            .join("-"),
        songId: (found && found.id) || "",
        versionId: (matchedVersion && matchedVersion.id) || "",
        url: song.url,
        name: song.name,
        artist: song.artist,
        cover: song.pic || (detail && detail.cover) || "",
        album: (detail && detail.name) || "",
        albumId: (detail && (detail.id || detail.catalog)) || "",
        vocalists: matchedRelease
          ? deps.playerVocalistsFromRelease(
              matchedRelease,
              found && found.voice_actor_ids,
            )
          : deps.mergePlayerVocalists(
              albumTrackVocalists(song, index),
              deps.playerVocalistsFromArtist(song.artist),
            ),
        sourceContext: (detail && detail.name) || "专辑",
      });
    });
  }

  function playAlbumTrack(album, index) {
    const tracks = buildAlbumPlayerTracks(album);
    const selected = tracks[index];
    if (!selected || !selected.url) return;
    if (deps.isActive(selected.url)) {
      deps.playerController.togglePlay();
      return;
    }
    deps.playerController.playTrack(selected);
  }

  function addAlbumTrack(album, index) {
    const track = buildAlbumPlayerTracks(album)[index];
    if (!track || !track.url) return;
    deps.playerController.enqueueTracks([track], track.sourceContext);
  }

  function albumPlayableCount(album) {
    return ((album && album.songs) || []).filter(function (song) {
      return !!song.url;
    }).length;
  }

  function playAlbum(album) {
    const detail = album && (album.data || album);
    if (
      deps.player.current &&
      deps.player.current.albumId === (detail.id || detail.catalog)
    ) {
      deps.playerController.togglePlay();
      return;
    }
    const tracks = buildAlbumPlayerTracks(album).filter(function (track) {
      return !!track.url;
    });
    if (!tracks.length) return;
    deps.playerController.setQueue(tracks, 0, tracks[0].sourceContext, true);
  }

  function enqueueAlbum(album) {
    const tracks = buildAlbumPlayerTracks(album).filter(function (track) {
      return !!track.url;
    });
    if (!tracks.length) return;
    deps.playerController.appendBlock(tracks, tracks[0].sourceContext);
  }

  const statAlbums = deps.computed(function () {
    return deps.homeStats.albums !== null
      ? deps.homeStats.albums
      : albumsTotal.value;
  });

  const relAlbums = deps.computed(function () {
    return albums.value;
  });

  function albumWorkOf(name) {
    const value = String(name || "");
    if (/ANIMATION DERBY Season 2/.test(value)) return "s2";
    if (/ANIMATION DERBY Season 3/.test(value)) return "s3";
    if (/ANIMATION DERBY/.test(value)) return "s1";
    if (/ROAD TO THE TOP/.test(value)) return "rttp";
    if (/新時代の扉/.test(value)) return "movie";
    if (/シンデレラグレイ|^超える$/.test(value)) return "cinderella";
    if (/うまよん/.test(value)) return "yon";
    if (/うまゆる/.test(value)) return "yuru";
    if (/STARTING GATE/.test(value)) return "starting-gate";
    if (/Solo Vocal Tracks/.test(value)) return "solo-vocal";
    if (/WINNING LIVE/.test(value)) return "winning-live";
    return "other";
  }

  const relTypeList = deps.computed(function () {
    return ["专辑", "单曲", "原声带", "精选辑", "其他"].filter(function (t) {
      return albumTypes.value.includes(t);
    });
  });

  const relYearList = deps.computed(function () {
    const ys = albumYears.value;
    return Array.from(new Set(ys)).sort().reverse();
  });

  const relFiltered = deps.computed(function () {
    return relAlbums.value.slice();
  });

  const relPerPage = 30;

  const relPageCount = deps.computed(function () {
    return Math.max(1, Math.ceil(albumsTotal.value / relPerPage));
  });

  const relPaged = deps.computed(function () {
    return albums.value;
  });

  const relPageStart = deps.computed(function () {
    if (!relFiltered.value.length) return 0;
    return (relPage.value - 1) * relPerPage + 1;
  });

  const relPageEnd = deps.computed(function () {
    if (!relFiltered.value.length) return 0;
    return Math.min(albumsTotal.value, relPage.value * relPerPage);
  });

  const relPageList = deps.computed(function () {
    const total = relPageCount.value;
    const cur = relPage.value;
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

  let albumSearchTimer;

  const coverTint = deps.reactive({});

  const tintSet = new Set();

  const catalogCoverFallback = "/uma_tools/img/album-placeholder.svg";

  function coverThumb(url, size) {
    const src = String(url || "");
    if (!src || src === "/album_covers/placeholder.webp")
      return catalogCoverFallback;
    if (
      !/^https?:\/\/p\d+\.music\.126\.net\//i.test(src) ||
      /[?&]param=\d+y\d+/i.test(src)
    )
      return src;
    const px = Math.max(64, parseInt(size, 10) || 360);
    return (
      src + (src.indexOf("?") === -1 ? "?" : "&") + "param=" + px + "y" + px
    );
  }

  function onCatalogImageError(event) {
    const image = event && event.currentTarget;
    if (image && !String(image.src || "").endsWith(catalogCoverFallback))
      image.src = catalogCoverFallback;
  }

  function microCmsImage(url, width) {
    const src = String(url || "");
    if (!/^https:\/\/images\.microcms-assets\.io\//i.test(src)) return src;
    const px = Math.max(1, Math.round(width || 560));
    return (
      src + (src.indexOf("?") === -1 ? "?" : "&") + "w=" + px + "&fm=webp&q=75"
    );
  }

  function sampleCover(event, url) {
    if (!url || tintSet.has(url)) return;
    tintSet.add(url);
    const img = event && event.currentTarget;
    if (!img || !img.naturalWidth) return;
    try {
      const c = document.createElement("canvas");
      const s = 40;
      c.width = s;
      c.height = s;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, s, s);
      const d = ctx.getImageData(0, 0, s, s).data;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      coverTint[url] =
        Math.round(r / n) + "," + Math.round(g / n) + "," + Math.round(b / n);
    } catch (e) {
      /* keep fallback tint */
    }
  }

  function coverStyle(album) {
    return { "--cover-tint": coverTint[album.cover] || "22,26,41" };
  }

  function loadAlbums(params) {
    const query = params || {
      q: relQuery.value,
      type: relFilter.value,
      work: relWork.value,
      year: relYear.value,
      sort: relSort.value,
      page: relPage.value,
    };
    const revision = ++albumListRevision;
    albumsError.value = "";
    albumsLoading.value = true;
    albumsLoadPromise = deps.api
      .request(
        "/api/catalog/albums" +
          deps.api.query({ ...query, page_size: relPerPage }),
      )
      .then(function (data) {
        if (revision !== albumListRevision) return;
        albumsLoadPromise = null;
        albums.value = data && Array.isArray(data.items) ? data.items : [];
        albumsTotal.value = data.total || 0;
        albumTypes.value = data.types || [];
        albumYears.value = data.years || [];
        relPage.value = data.page || 1;
      })
      .catch(function (e) {
        if (revision !== albumListRevision) return;
        albumsLoadPromise = null;
        albumsError.value =
          "无法加载专辑数据（请通过本地服务访问本页，例如 node uma_tools/server.js --no-crawl 后打开 http://localhost:8080/）";
      })
      .finally(function () {
        if (revision === albumListRevision) albumsLoading.value = false;
      });
    return albumsLoadPromise;
  }
  function start() {
    deps.watch(
      relQuery,
      function () {
        if (!deps.restoringRoute) {
          relPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      relWork,
      function () {
        if (!deps.restoringRoute) {
          relPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      relFilter,
      function () {
        if (!deps.restoringRoute) {
          relPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      relYear,
      function () {
        if (!deps.restoringRoute) {
          relPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      relSort,
      function () {
        if (!deps.restoringRoute) {
          relPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      [relQuery, relWork, relFilter, relYear, relSort],
      function () {
        if (
          deps.restoringRoute ||
          deps.activeTab.value !== "database" ||
          deps.dbView.value !== "albums" ||
          albumDetail.value
        )
          return;
        window.clearTimeout(albumSearchTimer);
        albumSearchTimer = window.setTimeout(() => loadAlbums(), 180);
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    addAlbumTrack,
    albumDetail,
    albumName,
    albumPlayableCount,
    albumSortOptions,
    albumTrackSecondary,
    albumTrackSongId,
    albumTrackVocalists,
    albums,
    albumsError,
    albumsLoading,
    coverStyle,
    coverThumb,
    enqueueAlbum,
    findAlbumById,
    loadAlbums,
    microCmsImage,
    onCatalogImageError,
    openAlbum,
    openAlbumFromDb,
    openAlbumFromSong,
    playAlbum,
    playAlbumTrack,
    relAlbums,
    relFilter,
    relFiltered,
    relPage,
    relPageCount,
    relPageEnd,
    relPageList,
    relPageStart,
    relPaged,
    relQuery,
    relSort,
    relTypeList,
    relWork,
    relWorkList,
    relYear,
    relYearList,
    relationReleaseVocalists,
    relationSong,
    relationSongVersions,
    releaseSingerLabel,
    sampleCover,
    statAlbums,
  };
}
