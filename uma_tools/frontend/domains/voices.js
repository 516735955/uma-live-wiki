/* voices state and behavior; external dependencies are explicit live ports. */
export function createVoices(deps) {
  const voiceDataRequests = new Map();

  const voiceProfiles = deps.ref([]);

  const voiceLoading = deps.ref(false);

  const voiceError = deps.ref("");
  let failedVoiceId = '';
  const musicPeopleError = deps.ref("");
  let musicPeopleRequest = null;

  function loadMusicPeople() {
    if (musicPeopleRequest) return musicPeopleRequest;
    musicPeopleError.value = "";
    musicPeopleRequest = Promise.allSettled([
      loadVoiceData(),
      deps.loadCharacterIndexData(),
    ]).then(function (results) {
      if (results.some(result => result.status === "rejected" || result.value === false))
        musicPeopleError.value = "人物资料暂时无法载入。";
    }).finally(function () {
      musicPeopleRequest = null;
    });
    return musicPeopleRequest;
  }

  const voiceDetail = deps.ref(null);

  const voiceSection = deps.ref("profile");

  const voiceHistoryQuery = deps.ref("");

  const voiceHistoryKind = deps.ref("all");

  function loadVoiceData(id) {
    const key = id || "index";
    voiceLoading.value = true;
    voiceError.value = "";
    const sourcePath = deps.currentUrlPath();
    const navigation = deps.navigationRevision.value;
    const promise = voiceDataRequests.get(key) || deps.api
      .request(
        "/api/catalog/voice-actors" +
          deps.api.query(id ? { id: id } : { scope: "index" }),
      )
      .then(function (data) {
        if (
          !data ||
          !Array.isArray(data.voice_actors) ||
          !data.voice_actors.length
        )
          throw new Error("声优资料暂时无法载入。");
        const previous = new Map(voiceProfiles.value.map((row) => [row.id, row]));
        const rows = id ? new Map(previous) : new Map();
        data.voice_actors.forEach((row) =>
          rows.set(row.id, { ...previous.get(row.id), ...row }),
        );
        voiceProfiles.value = Array.from(rows.values());
        window.dispatchEvent(new CustomEvent("uma-voice-data"));
        return true;
      })
      .finally(function () {
        voiceDataRequests.delete(key);
        voiceLoading.value = voiceDataRequests.size > 0;
      });
    voiceDataRequests.set(key, promise);
    return promise.catch(function () {
      if (sourcePath === deps.currentUrlPath() && navigation === deps.navigationRevision.value) {
        failedVoiceId = id || '';
        voiceError.value = "声优资料暂时无法载入，请重试。";
      }
      return false;
    });
  }

  function setVoiceSection(section) {
    if (["profile", "songs", "anime", "events"].indexOf(section) === -1) return;
    voiceSection.value = section;
    deps.pushUrl(true);
    if (section === "anime") deps.loadAnimeCatalogOptional();
    if ((section === "songs" || section === "events") && voiceDetail.value) {
      deps.loadRelationshipData("voice_actor", voiceDetail.value.id);
    }
  }

  function vaSlugOf(name) {
    return encodeURIComponent(String(name || ""));
  }

  function voiceProfileForName(name) {
    var target = String(name || "")
      .replace(/[\s　]/g, "")
      .replace(/髙/g, "高");
    if (!target) return null;
    for (var i = 0; i < voiceProfiles.value.length; i++) {
      var profile = voiceProfiles.value[i];
      var identity = profile.identity || {};
      var names = [identity.zh, identity.ja].concat(identity.aliases || []);
      if (
        names.some(function (item) {
          return (
            String(item || "")
              .replace(/[\s　]/g, "")
              .replace(/髙/g, "高") === target
          );
        })
      )
        return profile;
    }
    return null;
  }

  function vaList() {
    return voiceList.value;
  }
  const voiceList = deps.computed(function () {
    if (voiceProfiles.value.length) {
      return voiceProfiles.value.map(function (profile) {
        const identity = profile.identity || {};
        const details = profile.profile || {};
        const photo = profile.photo || {};
        return {
          id: profile.id,
          slug: profile.slug || profile.id,
          zh: identity.zh || identity.ja || "",
          ja: identity.ja || identity.zh || "",
          kana: identity.kana || "",
          aliases: identity.aliases || [],
          roles: (profile.roles || []).map(function (role) {
            return {
              id: role.character_id || "",
              zh: role.name || "",
              ja: role.name_ja || "",
              en: "",
              img: role.image || "",
              main: role.color_main || "",
              sub: role.color_sub || "",
              orig: !!role.former,
            };
          }),
          photo: photo.url || "",
          credit: photo.source_url
            ? {
                page: photo.source_url,
                title: photo.source_title || "图片来源",
                src: "reference",
              }
            : null,
          birth: details.birthday || "",
          birthplace: details.birthplace || "",
          agency: details.agency || "",
          officialProfile: details.official_profile || "",
          social: details.social || [],
          fieldStatus: details.field_status || {},
          profileSources: details.sources || [],
          profileStatus: details.status || "partial",
          stats: profile.stats || {
            events: 0,
            concerts: 0,
            programs: 0,
            songs: 0,
          },
        };
      });
    }
    return [];
  });
  const voiceBySlug = deps.computed(() => new Map(vaList().flatMap(voice => [[voice.id, voice], [voice.slug, voice]])));

  function findVaBySlug(slug) {
    var target = String(slug || "");
    if (!target) return null;
    if (voiceBySlug.value.has(target)) return voiceBySlug.value.get(target);
    var list = vaList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === target || list[i].id === target) return list[i];
    }
    try {
      var dec = decodeURIComponent(target);
      for (var j = 0; j < list.length; j++) {
        if (list[j].slug === vaSlugOf(dec)) return list[j];
      }
      for (var k = 0; k < list.length; k++) {
        if (list[k].zh === dec || list[k].ja === dec) return list[k];
      }
    } catch (e) {}
    return null;
  }

  const voiceAppearance = deps.computed(function () {
    const id = voiceDetail.value && voiceDetail.value.id;
    return (
      (id &&
        deps.appearanceIndex.value.voice_actors &&
        deps.appearanceIndex.value.voice_actors[id]) || {
        events: [],
        songs: [],
      }
    );
  });

  const voicePastByYear = deps.computed(function () {
    const groups = [];
    const map = {};
    voiceAppearance.value.events.forEach(function (event) {
      if (
        voiceHistoryKind.value !== "all" &&
        event.kind !== voiceHistoryKind.value
      )
        return;
      const query = String(voiceHistoryQuery.value || "")
        .trim()
        .toLowerCase();
      if (
        query &&
        String(event.title || "")
          .toLowerCase()
          .indexOf(query) === -1 &&
        String(event.date || "").indexOf(query) === -1
      )
        return;
      const year = (event.date || "日期待补").slice(0, 4);
      if (!map[year]) {
        map[year] = { year: year, events: [] };
        groups.push(map[year]);
      }
      map[year].events.push(event);
    });
    return groups;
  });

  function openVoice(actorId) {
    const isCurrent = deps.beginEntityNavigation();
    const show = function () {
      if (!isCurrent()) return;
      const found = findVaBySlug(actorId);
      if (!found) return;
      deps.clearEntityDetails("voice");
      deps.activeTab.value = "database";
      deps.dbView.value = "voice";
      voiceDetail.value = found;
      voiceSection.value = "profile";
      if (!isCurrent.fromRoute) deps.resetPageScroll();
      deps.pushUrl(isCurrent.fromRoute);
      deps.loadAnimeCatalogOptional('voice_actor', found.id);
    };
    return Promise.all([
      loadVoiceData().then(() => {
        const actor = findVaBySlug(actorId);
        return actor ? loadVoiceData(actor.id) : null;
      }),
      deps.loadCharacterIndexData(),
    ])
      .then(deps.loadCharacterUi)
      .then(show, show);
  }

  function openVa(slug) {
    return openVoice(slug);
  }
  function retryVoice() {
    return loadVoiceData((voiceDetail.value && voiceDetail.value.id) || failedVoiceId).then(() => {
      if (voiceDetail.value) voiceDetail.value = findVaBySlug(voiceDetail.value.id) || voiceDetail.value;
    });
  }

  function voiceName(actorId, fallback) {
    const voice = findVaBySlug(actorId);
    return (voice && voice.zh) || fallback || "—";
  }

  function voicePaletteStyle(voice) {
    const role = voice && voice.roles && voice.roles[0];
    return {
      "--entity-accent": (role && role.main) || "#3157ed",
      "--entity-sub": (role && role.sub) || "#ffa932",
    };
  }

  function voicePhoto(actorId) {
    const voice = findVaBySlug(actorId);
    return voice ? voice.photo : "";
  }

  function voicePhotoByName(name) {
    const profile = voiceProfileForName(name);
    return profile && profile.photo ? profile.photo.url : "";
  }

  function voiceHrefByName(name) {
    const profile = voiceProfileForName(name);
    return profile ? deps.routes.voiceActors(profile.id) : "";
  }

  function voiceFieldLabel(voice, field) {
    if (!voice) return "尚未收录";
    const value = field === "birthday" ? voice.birth : voice[field];
    if (value) return value;
    const status = (voice.fieldStatus || {})[field];
    return (
      {
        not_published: "未公开",
        not_applicable: "不适用",
        source_unavailable: "暂无可核实公开资料",
      }[status] || "尚未收录"
    );
  }
  function start() {
    window.addEventListener?.('uma-catalog-change', () => {
      if (voiceDetail.value && ['songs','events'].includes(voiceSection.value))
        deps.loadRelationshipData('voice_actor', voiceDetail.value.id);
    });
    deps.watch(
      function () {
        return voiceDetail.value && voiceDetail.value.id;
      },
      function () {
        voiceHistoryQuery.value = "";
        voiceHistoryKind.value = "all";
        deps.expandedRelationSongId.value = "";
      },
    );
  }
  return {
    start,
    findVaBySlug,
    loadVoiceData,
    loadMusicPeople,
    musicPeopleError,
    retryVoice,
    openVa,
    openVoice,
    setVoiceSection,
    voiceAppearance,
    voiceDetail,
    voiceError,
    voiceFieldLabel,
    voiceHistoryKind,
    voiceHistoryQuery,
    voiceHrefByName,
    voiceLoading,
    voiceName,
    voicePaletteStyle,
    voicePastByYear,
    voicePhoto,
    voicePhotoByName,
    voiceProfileForName,
    voiceProfiles,
    voiceSection,
  };
}
