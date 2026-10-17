/* player state and behavior; external dependencies are explicit live ports. */
export function createPlayer(deps) {
  const audio = deps.ref(null);

  let playerStorage = null;

  try {
    playerStorage = window.localStorage;
  } catch (error) {}

  const playerController = window.UmaPlayer.createPlayerController({
    reactive: deps.reactive,
    getAudio: function () {
      return audio.value;
    },
    proxyUrl: deps.proxySongUrl,
    storage: playerStorage,
  });

  const player = playerController.state;

  function playableSongRelease(song, versionId) {
    const exact = ((song && song.versions) || []).find(function (version) {
      return version.id === versionId;
    });
    const exactRelease =
      exact &&
      (exact.releases || []).find(function (release) {
        return !!release.audio_url;
      });
    if (exactRelease) return { version: exact, release: exactRelease };
    if (versionId) return null;
    if (song && song.playable) {
      return {
        version: {
          id: song.playable.version_id,
          title: song.playable.version_title,
        },
        release: {
          audio_url: song.playable.audio_url,
          artist: song.playable.artist,
          cover: song.playable.cover,
          album_id: song.playable.album_id,
          album_name: song.playable.album_name,
          voice_actor_ids:
            song.playable.voice_actor_ids || song.voice_actor_ids || [],
        },
      };
    }
    for (const version of (song && song.versions) || []) {
      for (const release of version.releases || []) {
        if (release.audio_url) return { version: version, release: release };
      }
    }
    return null;
  }

  function playCatalogSong(song, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    const row = playableSongRelease(song);
    if (!row) return;
    playSongTrack(song, row.version, row.release);
  }

  function playSongPrimary() {
    const row = playableSongRelease(deps.songDetail.value);
    if (row) playSongTrack(deps.songDetail.value, row.version, row.release);
  }

  function playSongRelease(row, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (!row || !row.release || !row.release.audio_url) return;
    playSongTrack(deps.songDetail.value, row.version, row.release);
  }

  function playRelationRelease(song, version, release, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (!release || !release.audio_url) return;
    playSongTrack(song, version, release);
  }

  function isActive(url) {
    return !!(
      player.current &&
      player.current.url === url &&
      playerController.isPlaying()
    );
  }

  function playerVocalistsFromIds(ids) {
    return Array.from(new Set(ids || []))
      .map(function (actorId) {
        const voice = deps.findVaBySlug(actorId);
        const role = voice && voice.roles && voice.roles[0];
        return voice
          ? {
              id: voice.id,
              name: voice.zh || voice.ja || actorId,
              image: voice.photo || "",
              color: (role && role.main) || "#3157ed",
            }
          : null;
      })
      .filter(Boolean);
  }

  function playerVocalistsFromArtist(artist) {
    const names = String(artist || "")
      .split(/[、,，/／・]+/)
      .map(function (name) {
        const trimmed = name.trim();
        const cv = trimmed.match(/(?:CV\s*[.．:：]?\s*)([^)）]+)/i);
        return cv ? cv[1].trim() : trimmed;
      })
      .filter(Boolean);
    return names.map(function (name) {
      const profile = deps.voiceProfileForName(name);
      const voice = profile && deps.findVaBySlug(profile.id);
      const role = voice && voice.roles && voice.roles[0];
      return {
        id: voice ? voice.id : "",
        name: voice ? voice.zh || voice.ja || name : name,
        image: voice ? voice.photo || "" : "",
        color: (role && role.main) || "#3157ed",
      };
    });
  }

  function mergePlayerVocalists(exactRows, artistRows) {
    const exact = (exactRows || []).map(function (row) {
      return Object.assign({}, row, { id: row.id || row.voice_actor_id || "" });
    });
    const credits = artistRows || [];
    if (!exact.length) return credits;
    if (!credits.length) return exact;
    // Curated release vocalist rows are authoritative. Artist text is only
    // needed when it contains additional guest credits without a site page.
    if (credits.length <= exact.length) return exact;
    const used = new Set();
    const merged = credits.map(function (credit) {
      const matchIndex = exact.findIndex(function (row, index) {
        if (used.has(index)) return false;
        if (credit.id && row.id) return credit.id === row.id;
        return (
          String(credit.name || "").trim() === String(row.name || "").trim()
        );
      });
      if (matchIndex < 0) return credit;
      used.add(matchIndex);
      return exact[matchIndex];
    });
    exact.forEach(function (row, index) {
      if (!used.has(index)) merged.push(row);
    });
    return merged;
  }

  function playerVocalistsFromRelease(release, fallbackIds) {
    const rows = ((release && release.vocalists) || []).map(
      function (vocalist) {
        const voice = deps.findVaBySlug(vocalist.voice_actor_id);
        return {
          id: vocalist.voice_actor_id || "",
          name: deps.voiceName(
            vocalist.voice_actor_id,
            vocalist.voice_actor_name,
          ),
          image: (voice && voice.photo) || "",
          color:
            (vocalist.character && vocalist.character.color_main) ||
            (voice && voice.roles && voice.roles[0] && voice.roles[0].main) ||
            "#3157ed",
        };
      },
    );
    const artistRows = playerVocalistsFromArtist(release && release.artist);
    if (rows.length) return mergePlayerVocalists(rows, artistRows);
    const byId = playerVocalistsFromIds(
      (release && release.voice_actor_ids) || fallbackIds || [],
    );
    return byId.length ? mergePlayerVocalists(byId, artistRows) : artistRows;
  }

  function buildPlayerTrack(data) {
    return {
      id: data.id || data.songId || data.url,
      songId: data.songId || "",
      versionId: data.versionId || "",
      url: data.url,
      name: data.name,
      artist: data.artist || "—",
      cover: data.cover || "",
      album: data.album || "",
      albumId: data.albumId || "",
      vocalists: data.vocalists || [],
      sourceContext: data.sourceContext || "",
    };
  }

  function buildReleasePlayerTrack(song, version, release) {
    return buildPlayerTrack({
      id:
        (version && version.id) ||
        [song && song.id, release && release.audio_url]
          .filter(Boolean)
          .join("-") ||
        release.audio_url,
      songId: (song && song.id) || "",
      versionId: (version && version.id) || "",
      url: release.audio_url,
      name: (version && version.title) || (song && song.title) || "未命名曲目",
      artist: release.artist || deps.songSingerLabel(song),
      cover: release.cover || (song && song.cover) || "",
      album: release.album_name || "",
      albumId: release.album_id || "",
      vocalists: playerVocalistsFromRelease(
        release,
        song && song.voice_actor_ids,
      ),
      sourceContext: release.album_name || "歌曲试听",
    });
  }

  function playSongTrack(song, version, release, toggle) {
    if (!release || !release.audio_url) return;
    if (toggle !== false && isActive(release.audio_url)) {
      playerController.togglePlay();
      return;
    }
    playerController.playTrack(buildReleasePlayerTrack(song, version, release));
  }

  function addSongTrack(song, version, release) {
    if (!release || !release.audio_url) return;
    const track = buildReleasePlayerTrack(song, version, release);
    playerController.enqueueTracks([track], track.sourceContext);
  }

  function playQueueAt(index) {
    return playerController.playQueueAt(index);
  }

  function skipPlayer(seconds) {
    playerController.seekBy(seconds);
  }

  function setPlayerVolume(value) {
    playerController.setVolume(value);
  }

  function togglePlayerMute() {
    playerController.toggleMute();
  }

  function togglePlayerPanel() {
    playerController.togglePanel();
  }

  function closePlayerPanel() {
    playerController.closePanel();
  }

  function cyclePlayerMode() {
    return playerController.cyclePlaybackMode();
  }

  function dismissPlayer() {
    playerController.dismiss();
  }

  function retryPlayer() {
    return playerController.retry();
  }

  function openPlayerSong(songId) {
    if (!songId) return;
    playerController.closePanel();
    deps.openSong(songId);
  }

  function bindAudio() {
    playerController.bind();
  }
  function start() {
    deps.watch(
      function () {
        return !!(player.current || player.queue.length) && player.visible;
      },
      function (active) {
        document.body.classList.toggle("audio-dock-active", active);
      },
      { immediate: true },
    );
  }
  return {
    start,
    addSongTrack,
    audio,
    bindAudio,
    buildPlayerTrack,
    buildReleasePlayerTrack,
    closePlayerPanel,
    cyclePlayerMode,
    dismissPlayer,
    isActive,
    mergePlayerVocalists,
    openPlayerSong,
    playCatalogSong,
    playQueueAt,
    playRelationRelease,
    playSongPrimary,
    playSongRelease,
    playSongTrack,
    playableSongRelease,
    player,
    playerController,
    playerVocalistsFromArtist,
    playerVocalistsFromRelease,
    retryPlayer,
    setPlayerVolume,
    skipPlayer,
    togglePlayerMute,
    togglePlayerPanel,
  };
}
