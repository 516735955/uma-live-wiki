export function createAnimeMusic(deps) {
  const animeMusicUsageLabels = {
    album: "原声专辑",
    op: "片头曲",
    ed: "片尾曲",
    theme: "主题曲",
    insert: "插入曲",
    winning_live: "胜者舞台",
    bgm: "背景配乐",
    fanfare: "比赛号角",
    other: "其他音乐",
  };
  function animeMusicUsageKind(kind) {
    return animeMusicUsageLabels[kind] ? kind : "other";
  }
  function animeMusicUsageLabel(kind) {
    return animeMusicUsageLabels[animeMusicUsageKind(kind)];
  }
  function animeMediaScope() {
    return (deps.animeMediaScope && deps.animeMediaScope()) || null;
  }
  function cueMatchesRelation(cue, relation) {
    if (cue.song_id !== relation.target_id) return false;
    if ((cue.usage_type || '') !== (relation.usage_type || '')) return false;
    if ((cue.version_id || '') !== (relation.version_id || '')) return false;
    if ((cue.release_id || '') !== (relation.release_id || '')) return false;
    return cue.units.some((unit) => unit.id === relation.source_id);
  }
  const animeMusicGroups = deps.computed(() => {
    const labels = animeMusicUsageLabels;
    return Object.entries(labels)
      .map(([kind, label]) => ({
        kind,
        label,
        rows: deps.animeCurrentRelations.value.filter((row) =>
          row.target_type === "album"
            ? kind === "album"
            : row.target_type === "song" &&
              animeMusicUsageKind(row.usage_type) === kind &&
              !animeMusicCues.value.some(
                (cue) =>
                  cueMatchesRelation(cue, row),
              ),
        ),
      }))
      .filter((group) => group.rows.length);
  });
  const animeMusicCues = deps.computed(() => {
    const units = deps.animeContentUnit.value
      ? [deps.animeContentUnit.value]
      : deps.animeWorkUnits.value;
    const cues = new Map();
    units.forEach((unit) =>
      (unit.music_cues || []).forEach((cue) => {
        const key = [
          cue.song_id || "",
          cue.version_id || "",
          cue.release_id || "",
          cue.title,
          cue.usage_type,
          JSON.stringify(cue.credits),
          JSON.stringify(cue.institutions),
        ].join(":");
        if (!cues.has(key)) cues.set(key, { ...cue, key, units: [] });
        if (!cues.get(key).units.some((item) => item.id === unit.id))
          cues.get(key).units.push(unit);
      }),
    );
    return Array.from(cues.values());
  });
  const animeMusicCueGroups = deps.computed(() =>
    Object.entries(animeMusicUsageLabels).filter(([kind]) => kind !== 'album')
      .map(([kind, label]) => ({kind, label}))
      .map((group) => ({
        ...group,
        rows: animeMusicCues.value.filter(
          (cue) => !cue.song_id && animeMusicUsageKind(cue.usage_type) === group.kind,
        ),
      }))
      .filter((group) => group.rows.length),
  );
  const animeMusicItems = deps.computed(() => {
    const items = new Map();
    animeMusicGroups.value.forEach((group) =>
      group.rows.forEach((relation) => {
        const key = relation.target_type + ":" + relation.target_id;
        if (!items.has(key))
          items.set(key, { key, relation, usages: [], relations: [] });
        const item = items.get(key);
        if (!item.usages.includes(group.label)) item.usages.push(group.label);
        item.relations.push(relation);
      }),
    );
    animeMusicCues.value
      .filter((cue) => cue.song_id)
      .forEach((cue) => {
        const key = "song:" + cue.song_id;
        if (!items.has(key))
          items.set(key, {
            key,
            relation: { target_type: "song", target_id: cue.song_id },
            usages: [],
            relations: [],
          });
        const item = items.get(key);
        if (!item.cues) item.cues = [];
        item.cues.push(cue);
        const label =
          cue.usage_type === "fanfare"
            ? "比赛号角"
            : animeMusicUsageLabel(cue.usage_type);
        if (!item.usages.includes(label)) item.usages.push(label);
      });
    return Array.from(items.values()).filter((item) => {
      const scope = animeMediaScope();
      return !scope || animeMusicVersions(item).length;
    });
  });
  function animeMusicVersions(item) {
    const song = deps.findSong(item.relation.target_id);
    if (!song) return [];
    const routeScope = animeMediaScope();
    const evidenceRows = [...(item.relations || []), ...(item.cues || [])];
    const evidence = evidenceRows.filter((row) => row.version_id || row.release_id);
    const evidenceWildcard = evidenceRows.some((row) => !row.version_id && !row.release_id);
    const matchesVersion = (version, scope) =>
      (!scope.version_id || scope.version_id === version.id) &&
      (!scope.release_id || (version.releases || []).some((release) => release.album_id === scope.release_id));
    const matches = (version, release, scope) =>
      (!scope.version_id || scope.version_id === version.id) &&
      (!scope.release_id || (release && release.album_id === scope.release_id));
    return (song.versions || [])
      .filter(
        (version) =>
          (evidenceWildcard || !evidence.length || evidence.some((scope) => matchesVersion(version, scope))) &&
          (!routeScope || matchesVersion(version, routeScope)),
      )
      .map((version) => ({
        ...version,
        releases: (version.releases || []).filter(
          (release) =>
            (evidenceWildcard || !evidence.length || evidence.some((scope) => matches(version, release, scope))) &&
            (!routeScope || matches(version, release, routeScope)),
        ),
      }));
  }
  function animeMusicCover(item) {
    if (item.relation.target_type === "album")
      return (deps.findAlbumById(item.relation.target_id) || {}).cover || "";
    const version = animeMusicVersions(item)[0];
    return version && version.releases.length
      ? version.releases[0].cover || ""
      : (deps.findSong(item.relation.target_id) || {}).cover || "";
  }
  function animeMusicSong(item) {
    return deps.findSong(item.relation.target_id);
  }
  return {
    animeMusicUsageLabels,
    animeMusicUsageKind,
    animeMusicUsageLabel,
    animeMusicGroups,
    animeMusicCues,
    animeMusicCueGroups,
    animeMusicItems,
    animeMusicVersions,
    animeMusicCover,
    animeMusicSong,
  };
}
