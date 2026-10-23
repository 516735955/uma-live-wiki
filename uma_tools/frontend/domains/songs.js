/* songs state and behavior; external dependencies are explicit live ports. */
export function createSongs(deps) {
  const songsById = deps.reactive({});

  const songCatalog = deps.ref({ coverage: {}, songs: [] });

  const songCatalogError = deps.ref("");

  const songCatalogLoading = deps.ref(false);

  const songDetail = deps.ref(null);

  const songSection = deps.ref("releases");

  const songLyricVersionId = deps.ref("");

  const songLyricTranslation = deps.ref(false);

  const expandedSongReleaseId = deps.ref("");

  const songLinkVersion = deps.ref("");

  const songLinkRelease = deps.ref("");

  const expandedSongCreditId = deps.ref("");

  const songDbQuery = deps.ref("");

  const songTotal = deps.ref(0);

  let songListRevision = 0;

  const songDbPage = deps.ref(1);

  const songDbPerPage = 30;

  const expandedRelationSongId = deps.ref("");

  function mergeSong(song) {
    if (!song || !song.id) return;
    if (songsById[song.id]?.detail_complete && !song.detail_complete) return;
    if (!songsById[song.id] || song.versions) songsById[song.id] = song;
  }

  function songKey(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[\ufe0e\ufe0f]/g, '')
      .replace(/[‘’]/g, "'").replace(/[‐‑‒–—−－]/g, '-').replace(/・/g, '·').replace(/\s+/g, '');
  }

  function loadSongCatalog(params) {
    const query = params || { q: songDbQuery.value, page: songDbPage.value };
    const revision = ++songListRevision;
    songCatalogError.value = "";
    songCatalogLoading.value = true;
    return deps.api
      .request(
        "/api/catalog/songs" +
          deps.api.query({
            q: query.q,
            page: query.page,
            page_size: songDbPerPage,
          }),
      )
      .then(function (data) {
        if (revision !== songListRevision) return;
        songCatalog.value = {
          build_id: data.build_id || "",
          coverage: data.coverage || {},
          songs: data.items || [],
        };
        songTotal.value = data.total || 0;
        songDbPage.value = data.page || 1;
      })
      .catch(function () {
        if (revision === songListRevision)
          songCatalogError.value = "歌曲资料暂时无法载入，请重试。";
      })
      .finally(function () {
        if (revision === songListRevision) songCatalogLoading.value = false;
      });
  }

  function setSongSection(section) {
    if (
      ["releases", "credits", "lyrics", "performances"].indexOf(section) === -1
    )
      return;
    songSection.value = section;
    deps.pushUrl(true);
  }

  const songAliasMap = deps.computed(function () {
    const map = Object.create(null);
    (songCatalog.value.songs || [])
      .concat(deps.eventSongs.value, Object.values(songsById))
      .forEach(function (song) {
        [song.title].concat(song.aliases || []).forEach(function (title) {
          const key = songKey(title);
          if (key) map[key] = (song.ambiguous_aliases || []).includes(key) ? null : !(key in map) || map[key]?.id === song.id ? song : null;
        });
      });
    return map;
  });

  function findSong(songOrId) {
    const target =
      typeof songOrId === "string"
        ? songOrId
        : songOrId && (songOrId.id || songOrId.song_id);
    if (!target) return null;
    const direct =
      (Object.hasOwn(songsById, target) && songsById[target]) ||
      deps.eventSongs.value.find(function (song) {
        return song.id === target;
      }) ||
      (songCatalog.value.songs || []).find(function (song) {
        return song.id === target;
      });
    if (direct) return direct;
    const key = songKey(target);
    return songAliasMap.value[key] || null;
  }

  const songDbCurrentPage = deps.computed(function () {
    return songCatalog.value.songs || [];
  });

  const songDbPageCount = deps.computed(function () {
    return Math.max(1, Math.ceil(songTotal.value / songDbPerPage));
  });


  const songDbPageStart = deps.computed(function () {
    return songTotal.value ? (songDbPage.value - 1) * songDbPerPage + 1 : 0;
  });

  const songDbPageEnd = deps.computed(function () {
    return Math.min(songDbPage.value * songDbPerPage, songTotal.value);
  });

  const songDbPageList = deps.computed(function () {
    return deps.pagerList(songDbPage.value, songDbPageCount.value);
  });

  function setSongDbPage(page) {
    if (page === "…") return;
    const next = parseInt(page, 10);
    if (isNaN(next) || next < 1 || next > songDbPageCount.value) return;
    songDbPage.value = next;
    deps.pushUrl();
    loadSongCatalog();
    const top = document.getElementById("songArchiveTop");
    if (top) top.scrollIntoView({ behavior: window.UmaUi.scrollBehavior(), block: "start" });
  }

  function goSongDbPage(delta) {
    setSongDbPage(songDbPage.value + delta);
  }

  let songSearchTimer = 0;

  const songDetailReleaseVersions = deps.computed(function () {
    return ((songDetail.value && songDetail.value.versions) || []).filter(
      function (version) {
        return version.releases && version.releases.length;
      },
    );
  });

  const songCreditVersions = deps.computed(function () {
    if (!songDetail.value) return [];
    const originalId = songDetail.value.original_version_id;
    const versions = songDetail.value.versions || [];
    const original =
      versions.find(function (version) {
        return version.id === originalId;
      }) ||
      versions.find(function (version) {
        return version.credits && version.credits.length;
      });
    if (!original) return [];
    const key = function (credit) {
      return [credit.role, credit.creator_id || credit.name].join(":");
    };
    const originalKeys = new Set((original.credits || []).map(key));
    const rows = [
      Object.assign({}, original, {
        display_credits: original.credits || [],
        is_original: true,
      }),
    ];
    versions.forEach(function (version) {
      if (
        version.id === original.id ||
        !version.credits ||
        !version.credits.length
      )
        return;
      const versionKeys = new Set(version.credits.map(key));
      if (
        versionKeys.size === originalKeys.size &&
        Array.from(versionKeys).every(function (value) {
          return originalKeys.has(value);
        })
      )
        return;
      const roles = new Set(
        (original.credits || []).concat(version.credits).map(function (credit) {
          return credit.role;
        }),
      );
      const changedRoles = new Set(
        Array.from(roles).filter(function (role) {
          const before = (original.credits || [])
            .filter(function (credit) {
              return credit.role === role;
            })
            .map(key)
            .sort()
            .join("|");
          const after = version.credits
            .filter(function (credit) {
              return credit.role === role;
            })
            .map(key)
            .sort()
            .join("|");
          return before !== after;
        }),
      );
      rows.push(
        Object.assign({}, version, {
          display_credits: version.credits.filter(function (credit) {
            return changedRoles.has(credit.role);
          }),
          credit_heading: version.version_label || version.title,
          is_original: false,
        }),
      );
    });
    // Only populated recording credits enter the ledger.
    return rows.filter(function (row) { return row.display_credits.length; });
  });

  const songDetailPerformances = deps.computed(function () {
    if (!songDetail.value) return [];
    const rows = [];
    (songDetail.value.versions || []).forEach(function (version) {
      (version.performances || []).forEach(function (performance) {
        const setlistNo = performance.setlist_no;
        let displayNo = String(performance.performance_index || "");
        if (setlistNo !== null && setlistNo !== undefined) {
          displayNo = String(setlistNo);
        }
        rows.push({
          version: version,
          performance: performance,
          display_no: displayNo,
        });
      });
    });
    return rows.sort(function (a, b) {
      return String(
        b.performance.session_date || b.performance.event_date,
      ).localeCompare(
        String(a.performance.session_date || a.performance.event_date),
      );
    });
  });

  const songLyricVersions = deps.computed(function () {
    const accepted = [];
    ((songDetail.value && songDetail.value.versions) || []).forEach(
      function (version) {
        if (!version.lyrics || version.instrumental) return;
        const lyric = version.lyrics;
        const sequence = (lyric.lines || [])
          .join("")
          .normalize("NFKC")
          .replace(/[\p{P}\p{Z}\s]/gu, "")
          .toLowerCase();
        if (!sequence) return;
        accepted.push(version);
      },
    );
    return accepted;
  });

  const songLyricsApplicable = deps.computed(function () {
    const versions = (songDetail.value && songDetail.value.versions) || [];
    return !(versions.length && versions.every(function (version) {
      return version.instrumental === true;
    }));
  });

  const songLyricVersionOptions = deps.computed(function () {
    return songLyricVersions.value.map(function (version) {
      return { value: version.id, label: version.title };
    });
  });

  const selectedSongLyricVersion = deps.computed(function () {
    return (
      songLyricVersions.value.find(function (version) {
        return version.id === songLyricVersionId.value;
      }) ||
      songLyricVersions.value[0] ||
      null
    );
  });

  const selectedSongLyricLines = deps.computed(function () {
    const version = selectedSongLyricVersion.value;
    if (!version || !version.lyrics) return [];
    const lyric = version.lyrics;
    const translated =
      songLyricTranslation.value &&
      lyric.translation_lines &&
      lyric.translation_lines.length;
    const texts = translated ? lyric.translation_lines : lyric.lines;
    const timings = new Map(
      (lyric.timings || [])
        .filter(function (line) {
          return !!line.line_id;
        })
        .map(function (line) {
          return [line.line_id, line];
        }),
    );
    return (texts || []).map(function (text, index) {
      const timing = timings.get((lyric.line_ids || [])[index]);
      return { text: text, start_ms: timing && timing.start_ms, index: index };
    });
  });

  function setSongLyricVersion(versionId) {
    if (!songLyricVersions.value.some(version => version.id === versionId)) return;
    songLyricVersionId.value = versionId;
    songLyricTranslation.value = false;
    songLinkVersion.value = versionId;
    songLinkRelease.value = "";
    deps.pushUrl();
  }

  function addSongPrimary() {
    const row = deps.playableSongRelease(songDetail.value);
    if (row) deps.addSongTrack(songDetail.value, row.version, row.release);
  }

  function toggleRelationSong(songId) {
    expandedRelationSongId.value =
      expandedRelationSongId.value === songId ? "" : songId;
  }

  function songSingerLabel(song) {
    const names = ((song && song.voice_actor_ids) || [])
      .map(function (actorId) {
        const voice = deps.findVaBySlug(actorId);
        return voice && voice.zh;
      })
      .filter(Boolean);
    if (names.length) return names.join(" / ");
    const credits = Array.from(
      new Set(
        (song && song.artist_names && song.artist_names.length
          ? song.artist_names
          : song && song.artists) || [],
      ),
    ).filter(Boolean);
    return credits.length ? credits.join(" / ") : "—";
  }

  function openSong(songOrId, section) {
    songCatalogError.value = "";
    const isCurrent = deps.beginEntityNavigation();
    const requested =
      typeof songOrId === "string"
        ? songOrId
        : songOrId && (songOrId.id || songOrId.song_id);
    const requestedUrl = new URL(window.location.href);
    const recordingUrl =
      [deps.routes.songs(requested), ...deps.routes.sections.song.map(section => deps.routes.songs(requested, section))].includes(requestedUrl.pathname)
        ? requestedUrl
        : null;
    const show = function (data) {
      if (!isCurrent()) return;
      const found = data && data.song;
      if (!found) {
        deps.notFound.value = true;
        deps.activeTab.value = "not-found";
        return;
      }
      mergeSong(found);
      deps.clearEntityDetails("song");
      songDetail.value = found;
      songSection.value = section || "releases";
      expandedSongReleaseId.value =
        (
          window.UmaCatalog.playableRecording(found)?.version || (found.versions || []).find(function (version) {
            return version.releases && version.releases.length;
          }) || {}
        ).id || "";
      songLinkVersion.value = "";
      songLinkRelease.value = "";
      expandedSongCreditId.value = "";
      const lyricVersion =
        (found.versions || []).find(function (version) {
          return version.id === found.original_version_id && version.lyrics;
        }) ||
        (found.versions || []).find(function (version) {
          return !!version.lyrics;
        });
      songLyricVersionId.value = lyricVersion ? lyricVersion.id : "";
      songLyricTranslation.value = false;
      deps.activeTab.value = "database";
      deps.dbView.value = "songs";
      if (!isCurrent.fromRoute) deps.resetPageScroll();
      if (recordingUrl) restoreSongRecording(recordingUrl);
      deps.pushUrl(isCurrent.fromRoute);
      deps.loadAnimeCatalogOptional("song", found.id);
    };
    deps.loadMusicPeople();
    return deps.api.request(
        "/api/catalog/song" + deps.api.query({ id: requested }),
      )
      .then(show)
      .catch(function (error) {
        if (isCurrent() && error.message === "HTTP 404") {
          deps.notFound.value = true;
          deps.activeTab.value = "not-found";
        } else if (isCurrent()) {
          deps.navigationError.value = "歌曲资料暂时无法载入，请重试。";
          deps.navigationRetry.value = () => openSong(songOrId, section);
        }
      });
  }

  function toggleSongRelease(versionId) {
    expandedSongReleaseId.value =
      expandedSongReleaseId.value === versionId ? "" : versionId;
  }

  function restoreSongRecording(url) {
    const versions = (songDetail.value || {}).versions || [];
    const release = url.searchParams.get("release");
    let version = versions.find(
      (row) => row.id === url.searchParams.get("version"),
    );
    if (
      release &&
      (!version ||
        !(version.releases || []).some((row) => row.album_id === release))
    ) {
      const candidates = versions.filter((row) =>
        (row.releases || []).some((item) => item.album_id === release),
      );
      if (candidates.length === 1) version = candidates[0];
    }
    if (!version) return;
    songLinkVersion.value = version.id;
    songLinkRelease.value = (version.releases || []).some(
      (row) => row.album_id === release,
    )
      ? release
      : "";
    if (songSection.value === "lyrics") {
      if (songLyricVersions.value.some(row => row.id === version.id)) songLyricVersionId.value = version.id;
      return;
    }
    expandedSongReleaseId.value = version.id;
    Vue.nextTick(() => {
      const element = document.getElementById("recording-" + version.id);
      if (element) element.scrollIntoView({ block: "start" });
    });
  }

  function toggleSongCredit(versionId) {
    expandedSongCreditId.value =
      expandedSongCreditId.value === versionId ? "" : versionId;
  }

  function proxySongUrl(url) {
    if (!url) return url;
    if (url.indexOf("/api/audio") === 0) return url;
    if (url.indexOf(location.origin) === 0) return url;
    if (/^https?:\/\//i.test(url))
      return "/api/audio?url=" + encodeURIComponent(url);
    return url;
  }

  function nextSong() {
    return deps.playerController.next();
  }

  function prevSong() {
    return deps.playerController.previous();
  }

  function linkSetlistSongs(table, performances) {
    const performanceRows = (performances || []).slice();
    const byTitle = {};
    performanceRows.forEach(function (performance) {
      const key = deps.normName(
        performance.song || performance.song_title || "",
      );
      if (key) (byTitle[key] || (byTitle[key] = [])).push(performance);
    });
    var linked = String(table || "").replace(
      /<tr\b[^>]*>[\s\S]*?<\/tr>/gi,
      function (row) {
        if (/<th\b/i.test(row))
          return row.replace(
            /<\/tr>/i,
            '<th class="setlist-actions">试听</th></tr>',
          );
        let queueButtons = "";
        row = row.replace(
          /(<td\s+class=["']setlist-song["'][^>]*>)([\s\S]*?)(<\/td>)/gi,
          function (_, start, body, end) {
            const title = deps.decodeHtml(body).trim();
            const matchedPerformance = (
              byTitle[deps.normName(title)] || []
            ).shift();
            const song =
              matchedPerformance && matchedPerformance.song_id
                ? findSong(matchedPerformance.song_id) || {
                    id: matchedPerformance.song_id,
                  }
                : findSong(title);
            if (!song) return start + body + end;
            const queueKey = matchedPerformance
              ? deps.eventPerformanceKey(matchedPerformance)
              : "";
            const recording = deps.playableSongRelease(song, matchedPerformance?.version_id);
            const playing =
              recording && deps.isActive(recording.release.audio_url);
            queueButtons =
              queueKey && recording
                ? '<span class="entity-actions entity-actions-compact"><button class="entity-action entity-action-play" type="button" data-play-key="' +
                  queueKey +
                  '" aria-label="' +
                  (playing ? "暂停" : "播放") +
                  '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' +
                  (playing ? "M7 5h4v14H7zM14 5h4v14h-4z" : "m8 5 11 7-11 7z") +
                  '"/></svg></button><button class="entity-action entity-action-add" type="button" data-add-key="' +
                  queueKey +
                  '" aria-label="加入播放列表"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></span>'
                : "";
            return (
              start +
              (/<a\b/i.test(body)
                ? body
                : '<a class="setlist-song-link" data-song-id="' +
                  song.id +
                  '" href="' +
                  deps.routes.songs(song.id) +
                  '">' +
                  body +
                  "</a>") +
              end
            );
          },
        );
        return row.replace(
          /<\/tr>/i,
          '<td class="setlist-actions">' + queueButtons + "</td></tr>",
        );
      },
    );
    linked = linked.replace(/<span class=["']guest-performer["']>([^<]*)<\/span>/gi, function (whole, name) {
      const profile = deps.voiceProfileForName?.(deps.decodeHtml(name));
      const voice = profile && deps.findVaBySlug(profile.id);
      if (!voice) return whole;
      const escape = value => String(value || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      const photo = voice.photo ? '<img loading="lazy" src="/api/image?' + (/^https?:\/\//i.test(voice.photo) ? 'url=' : 'path=') + encodeURIComponent(voice.photo) + '&amp;w=96" alt="">' : '';
      return '<a class="performer-chip voice-chip setlist-voice-link" data-voice-id="' + escape(voice.id) + '" href="' + escape(deps.routes.voiceActors(voice.id)) + '">' + photo + '<span>' + escape(voice.zh || voice.ja) + '</span></a>';
    });
    const result = linked.replace(
      /<span class=["']perf-item["']>(<img[^>]*\balt=["']([^"']+)["'][^>]*>)<span class=["']perf-name["']>([\s\S]*?)<\/span><\/span>/gi,
      function (whole, image, alt, label) {
        var srcMatch = image.match(/\bsrc=["']([^"']+)["']/i);
        var character =
          deps.findCharByAvatar(srcMatch ? srcMatch[1] : "") ||
          deps.findCharByDisplayName(deps.decodeHtml(alt));
        if (!character) return whole;
        const avatar = deps.characterPerformanceImage(character.id);
        if (avatar) {
          const source = window.UmaMedia ? window.UmaMedia.preview(avatar, 160) : avatar;
          image = image.replace(/\bsrc=["'][^"']*["']/i, 'src="' + source.replace(/&/g, '&amp;') + '"');
        }
        var shown = [character.zh, character.ja, character.en].some(
          function (value) {
            return deps.normName(value) === deps.normName(label);
          },
        )
          ? label
          : character.zh;
        return (
          '<a class="perf-item setlist-performer-link" href="' + deps.routes.characters(character.id) + '" data-character-id="' +
          character.id +
          '" style="--chip-color:' +
          character.main +
          '">' +
          image +
          '<span class="perf-name">' +
          shown +
          "</span></a>"
        );
      },
    );
    return result.replace(/<img\b(?![^>]*\bdata-media-fallback)/gi, '<img data-media-fallback="/uma_tools/img/person-placeholder.svg"');
  }

  const statSongs = deps.computed(function () {
    if (
      songCatalog.value.coverage &&
      Number.isFinite(songCatalog.value.coverage.songs)
    )
      return songCatalog.value.coverage.songs;
    if (deps.homeStats.songs !== null) return deps.homeStats.songs;
    return '—';
  });
  function start() {
    window.addEventListener?.('uma-catalog-change', () => {
      Object.keys(songsById).forEach(key => delete songsById[key]);
    });
    deps.watch(
      songDbQuery,
      function () {
        if (deps.restoringRoute) return;
        songListRevision += 1;
        songDbPage.value = 1;
        deps.pushUrl(true);
        window.clearTimeout(songSearchTimer);
        songSearchTimer = window.setTimeout(function () {
          if (window.location.pathname === deps.routes.songs()) loadSongCatalog();
        }, 180);
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    addSongPrimary,
    expandedRelationSongId,
    expandedSongCreditId,
    expandedSongReleaseId,
    findSong,
    goSongDbPage,
    linkSetlistSongs,
    loadSongCatalog,
    mergeSong,
    nextSong,
    openSong,
    prevSong,
    proxySongUrl,
    selectedSongLyricLines,
    selectedSongLyricVersion,
    setSongDbPage,
    setSongLyricVersion,
    setSongSection,
    songCatalog,
    songCatalogError,
    songCatalogLoading,
    songCreditVersions,
    songDbCurrentPage,
    songDbPage,
    songDbPageCount,
    songDbPageEnd,
    songDbPageList,
    songDbPageStart,
    songDbQuery,
    songDetail,
    songDetailPerformances,
    songDetailReleaseVersions,
    songLinkRelease,
    songLinkVersion,
    songLyricTranslation,
    songLyricVersionId,
    songLyricVersionOptions,
    songLyricVersions,
    songLyricsApplicable,
    songSection,
    songSingerLabel,
    songTotal,
    songsById,
    statSongs,
    toggleRelationSong,
    toggleSongCredit,
    toggleSongRelease,
  };
}
