export function createAnimeMusic(deps) {
  const animeMusicUsageLabels = {
    album: "原声专辑",
    op: "片头曲",
    ed: "片尾曲",
    theme: "主题曲",
    insert: "插入曲",
    winning_live: "胜者舞台",
    bgm: "背景配乐",
    other: "其他音乐",
  };
  function animeMusicUsageKind(kind) {
    return animeMusicUsageLabels[kind] ? kind : "other";
  }
  function animeMusicUsageLabel(kind) {
    return animeMusicUsageLabels[animeMusicUsageKind(kind)];
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
                  cue.song_id === row.target_id &&
                  cue.units.some((unit) => unit.id === row.source_id),
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
          cue.title,
          cue.usage_type,
          JSON.stringify(cue.credits),
          JSON.stringify(cue.institutions),
        ].join(":");
        if (!cues.has(key)) cues.set(key, { ...cue, units: [] });
        if (!cues.get(key).units.some((item) => item.id === unit.id))
          cues.get(key).units.push(unit);
      }),
    );
    return Array.from(cues.values());
  });
  const animeMusicCueGroups = deps.computed(() =>
    [
      { kind: "fanfare", label: "比赛号角" },
      { kind: "op", label: "片头曲" },
      { kind: "ed", label: "片尾曲" },
      { kind: "theme", label: "主题曲" },
      { kind: "insert", label: "插入曲" },
      { kind: "bgm", label: "背景配乐" },
    ]
      .map((group) => ({
        ...group,
        rows: animeMusicCues.value.filter(
          (cue) => !cue.song_id && cue.usage_type === group.kind,
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
    return Array.from(items.values());
  });
  function animeMusicVersions(item) {
    const song = deps.findSong(item.relation.target_id);
    if (!song) return [];
    return (song.versions || [])
      .filter(
        (version) =>
          !item.relations.length ||
          item.relations.some(
            (relation) =>
              !relation.version_id || relation.version_id === version.id,
          ),
      )
      .map((version) => ({
        ...version,
        releases: (version.releases || []).filter(
          (release) =>
            !item.relations.length ||
            item.relations.some(
              (relation) =>
                (!relation.version_id || relation.version_id === version.id) &&
                (!relation.release_id ||
                  relation.release_id === release.album_id),
            ),
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
