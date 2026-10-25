export function createAnimeParticipation(deps) {
  function groupAnimeParticipation(rows) {
    const works = new Map();
    rows.forEach((row) => {
      if (!row.work) return;
      const relation = row.relation || {};
      let group = works.get(row.work.id);
      if (!group) {
        group = { work: row.work, roles: [] };
        works.set(row.work.id, group);
      }
      let label;
      let songUsageKey = '';
      let songEditionKey = '';
      let songVersionLabel = '';
      if (row.entry)
        label = [row.entry.group, row.entry.role].filter(Boolean).join(" ");
      else if (relation.target_type === "character")
        label = deps.characterName(relation.target_id);
      else if (relation.target_type === "song") {
        let version =
          relation.version_label !==
          deps.animeRelationTargetLabel(relation)
            ? relation.version_label
            : "";
        if (/原唱发行版|原曲发行版|发行版/.test(String(version || ""))) version = "";
        if (row.unit) {
          version = String(version || '').split(/\s*[/／]\s*/).filter(part => {
            const episode = part.match(/(?:第[一二三四五六七八九十\d]+季)?第?\s*(\d+)\s*[话話]/);
            return !episode || Number(episode[1]) !== Number(row.unit.number);
          }).join('、');
        }
        songUsageKey = relation.usage_type || '';
        songVersionLabel = version;
        label = deps.animeMusicUsageLabel(relation.usage_type) || version;
      } else
        label =
          relation.role_name ||
          relation.signature ||
          relation.label ||
          "";
      const institutions = row.entry ? row.entry.institutions || [] : [];
      const recordingIdentity = relation.target_type === 'song'
        ? [relation.target_id, relation.version_id || ''].join('|')
        : '';
      const recordingKey = relation.target_type === 'song'
        ? [recordingIdentity, relation.release_id || ''].join('|')
        : '';
      const editionsForRole = row.work.id === "anime-rttt"
        ? (row.unit ? ["web"] : deps.animeRowEditions(row.entry || row.relation))
        : [""];
      songEditionKey = editionsForRole.slice().sort().join(',');
      // Display a composition once per use and edition; retain recording
      // targets on each episode rather than duplicating the visible role.
      const key = relation.target_type === 'song'
        ? ['song', relation.target_id, songUsageKey, songEditionKey, row.entry ? label : ''].join('|')
        : [label, recordingIdentity, songEditionKey].filter(Boolean).join('|');
      let role = group.roles.find((role) => role.key === key);
      if (!role) {
        role = { key, label, units: [], editions: [], scopes: [], recordings: [] };
        group.roles.push(role);
      }
      const recordingLabel = relation.version_label || relation.release_name || relation.release_title || '';
      if (recordingKey && !role.recordings.some((item) => item.key === recordingKey))
        role.recordings.push({
          key: recordingKey,
          song: relation.target_id,
          version: relation.version_id || '',
          release: relation.release_id || '',
          label: recordingLabel,
        });
      const editions =
        row.work.id === "anime-rttt"
          ? row.unit
            ? ["web"]
            : deps.animeRowEditions(row.entry || row.relation)
          : [""];
      (editions.length ? editions : [""]).forEach((edition) => {
        const scopeKey = JSON.stringify([edition, institutions]);
        let scope = role.scopes.find((item) => item.key === scopeKey);
        if (!scope) {
          scope = { key: scopeKey, edition, institutions, units: [], mediaByUnit: {}, version_id: relation.version_id || '', release_id: relation.release_id || '' };
          role.scopes.push(scope);
        }
        if (row.unit && relation.target_type === 'song') {
          const media = scope.mediaByUnit[row.unit.id] || { versions: [], releases: [] };
          if (relation.version_id && !media.versions.includes(relation.version_id)) media.versions.push(relation.version_id);
          if (relation.release_id && !media.releases.includes(relation.release_id)) media.releases.push(relation.release_id);
          media.version_id = media.versions.length === 1 ? media.versions[0] : '';
          media.release_id = media.releases.length === 1 ? media.releases[0] : '';
          scope.mediaByUnit[row.unit.id] = media;
        }
        if (
          row.unit &&
          !["movie", "special"].includes(row.work.format) &&
          !scope.units.some((unit) => unit.id === row.unit.id)
        )
          scope.units.push(row.unit);
      });
      if (
        row.unit &&
        !["movie", "special"].includes(row.work.format) &&
        !role.units.some((unit) => unit.id === row.unit.id)
      )
        role.units.push(row.unit);
      if (row.work.id === "anime-rttt" && !row.unit) {
        const editions = deps.animeRowEditions(row.entry || row.relation);
        editions.forEach((edition) => {
          if (!role.editions.includes(edition)) role.editions.push(edition);
        });
      }
    });
    return Array.from(works.values())
      .sort((a, b) =>
        String(a.work.start_date).localeCompare(String(b.work.start_date)),
      )
      .map((group) => {
        group.roles.forEach((role) => {
          role.units.sort((a, b) => a.number - b.number);
          role.scopes.forEach((scope) =>
            scope.units.sort((a, b) => a.number - b.number),
          );
          role.scopes.sort(
            (a, b) =>
              (a.edition === "film" ? 0 : 1) - (b.edition === "film" ? 0 : 1),
          );
        });
        group.roles.sort((a, b) =>
          window.UmaAnimeStaff.compareRoles(a.label, b.label),
        );
        return group;
      });
  }
  const creatorAnimeWorks = deps.computed(() =>
    groupAnimeParticipation(deps.creatorAnimeStaff.value),
  );
  const creatorAnimeCueWorks = deps.computed(() => {
    if (!deps.creatorDetail.value) return [];
    const rows = [];
    (deps.animeCatalog.value.units || []).forEach((unit) =>
      (unit.music_cues || []).forEach((cue) => {
        (cue.credits || [])
          .filter((credit) =>
            (credit.creator_ids || []).includes(deps.creatorDetail.value.id),
          )
          .forEach((credit) => {
            rows.push({
              entry: {
                group: cue.title,
                role: credit.role,
                institutions: credit.institutions,
              },
              relation: {
                target_type: 'song',
                target_id: cue.song_id,
                version_id: cue.version_id || '',
                release_id: cue.release_id || '',
                usage_type: cue.usage_type || '',
              },
              work: deps.findAnimeWork(unit.work_id),
              unit,
            });
          });
      }),
    );
    return groupAnimeParticipation(rows);
  });
  const characterAnimeWorks = deps.computed(() =>
    groupAnimeParticipation(characterAnimeRelations.value),
  );
  const voiceAnimeWorks = deps.computed(() =>
    groupAnimeParticipation(voiceAnimeRelations.value),
  );
  const songAnimeWorks = deps.computed(() =>
    groupAnimeParticipation(songAnimeRelations.value),
  );
  const albumAnimeWorks = deps.computed(() =>
    groupAnimeParticipation(albumAnimeRelations.value),
  );
  function relatedAnimeRows(targetType, targetIds) {
    const ids = new Set(
      (Array.isArray(targetIds) ? targetIds : [targetIds]).filter(Boolean),
    );
    if (!ids.size) return [];
    const seen = new Set();
    return (deps.animeCatalog.value.relations || [])
      .filter(function (relation) {
        return (
          (relation.target_type === targetType &&
            ids.has(relation.target_id)) ||
          (targetType === "voice_actor" && ids.has(relation.voice_actor_id))
        );
      })
      .map(function (relation) {
        const unit =
          relation.source_type === "anime_unit"
            ? deps.findAnimeUnit(relation.source_id)
            : null;
        const work = deps.findAnimeWork(
          unit ? unit.work_id : relation.source_id,
        );
        return work ? { relation: relation, work: work, unit: unit } : null;
      })
      .filter(function (row) {
        if (!row) return false;
        const key = [
          row.work.id,
          row.unit ? row.unit.id : "work",
          row.relation.target_id,
          row.relation.relation_type,
          row.relation.usage_type || "",
          row.relation.version_id || "",
          row.relation.release_id || "",
          [...deps.animeRowEditions(row.relation)].sort().join(','),
          row.relation.role_name || row.relation.signature || "",
        ].join(":");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(function (a, b) {
        return (
          String(a.work.start_date || "").localeCompare(
            String(b.work.start_date || ""),
          ) ||
          String(a.work.title_zh || "").localeCompare(
            String(b.work.title_zh || ""),
          )
        );
      });
  }
  const characterAnimeRelations = deps.computed(function () {
    return relatedAnimeRows(
      "character",
      deps.charDetail.value && deps.charDetail.value.id,
    );
  });
  const voiceAnimeRelations = deps.computed(function () {
    return relatedAnimeRows(
      "voice_actor",
      deps.voiceDetail.value && deps.voiceDetail.value.id,
    );
  });
  const songAnimeRelations = deps.computed(function () {
    return relatedAnimeRows(
      "song",
      deps.songDetail.value && deps.songDetail.value.id,
    );
  });
  const albumAnimeRelations = deps.computed(function () {
    return relatedAnimeRows(
      "album",
      deps.albumDetail.value && deps.albumDetail.value.data.id,
    );
  });
  const eventAnimeRelations = deps.computed(function () {
    return relatedAnimeRows(
      "event",
      deps.eventDetail.value && deps.eventDetail.value.id,
    );
  });
  const eventAnimeWorks = deps.computed(() => {
    const rows = eventAnimeRelations.value;
    return groupAnimeParticipation(
      rows.filter(
        (row) =>
          row.unit ||
          !rows.some((other) => other.unit && other.work.id === row.work.id),
      ),
    );
  });
  function animeRelationContext(row) {
    if (!row) return "";
    return [row.unit && row.unit.label, row.relation.label]
      .filter(Boolean)
      .join(" ");
  }
  function relatedAnimeHref(row) {
    const relation = row && row.relation;
    return deps.routes.query(
      deps.routes.anime(row.work.id, row.unit && row.unit.id),
      relation && relation.target_type === 'song'
        ? { section: 'music', version: relation.version_id, release: relation.release_id }
        : {},
    );
  }
  return {
    groupAnimeParticipation,
    creatorAnimeWorks,
    creatorAnimeCueWorks,
    characterAnimeWorks,
    voiceAnimeWorks,
    songAnimeWorks,
    albumAnimeWorks,
    relatedAnimeRows,
    characterAnimeRelations,
    voiceAnimeRelations,
    songAnimeRelations,
    albumAnimeRelations,
    eventAnimeRelations,
    eventAnimeWorks,
    animeRelationContext,
    relatedAnimeHref,
  };
}
