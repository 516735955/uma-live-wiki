// catalog service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  function handleHomeSummary(res) {
    deps.catalogStore
      .home()
      .then((data) =>
        deps.sendJson(res, 200, data, {
          cacheControl: "public, max-age=60, stale-while-revalidate=600",
          etag: catalogEtag(data.build_id, "home:" + (data.business_date || require('./business-date').today())),
        }),
      )
      .catch(() =>
        deps.sendJson(res, 500, { error: "home summary unavailable" }),
      );
  }

  function catalogEtag(buildId, scope) {
    const digest = deps.crypto
      .createHash("sha1")
      .update(String(scope || ""))
      .digest("hex")
      .slice(0, 12);
    return '"catalog-' + buildId + "-" + digest + '"';
  }

  function sendCatalogResult(req, res, result, scope) {
    if (!result) {
      deps.sendJson(res, 404, { error: "catalog entry not found" });
      return;
    }
    deps.sendJson(res, 200, result, {
      cacheControl: "public, max-age=300, stale-while-revalidate=300",
      etag: catalogEtag(
        result.build_id,
        scope +
          (req.url.startsWith("/api/catalog/events")
            ? ":" + (result.business_date || require('./business-date').today())
            : ""),
      ),
    });
  }

  async function handleCatalogApi(req, res, urlPath, params) {
    try {
      let result;
      if (urlPath === "/api/catalog/anime") {
        const scope = params.get("scope") || "index";
        if (
          ![
            "index",
            "graph",
            "people",
            "work",
            "person",
            "unit",
            "entity",
          ].includes(scope)
        ) {
          deps.sendJson(res, 400, { error: "invalid anime scope" });
          return;
        }
        result = await deps.animeStore.response(scope, params.get("id") || "");
      } else if (urlPath === "/api/catalog/anime-media") {
        const work = await deps.animeStore.response(
          params.get("unit") ? "unit" : "work",
          params.get("unit") || params.get("id") || "",
        );
        if (!work) {
          sendCatalogResult(req, res, null, req.url);
          return;
        }
        const songs = new Set(
          work.relations
            .filter((row) => row.target_type === "song")
            .map((row) => row.target_id),
        );
        work.units.forEach((unit) =>
          (unit.music_cues || []).forEach((cue) => {
            if (cue.song_id) songs.add(cue.song_id);
          }),
        );
        if (params.get("kind") === "events") songs.clear();
        const events = new Set(
          work.relations
            .filter((row) => row.target_type === "event")
            .map((row) => row.target_id),
        );
        if (params.get('kind') === 'music') events.clear();
        const albumIds = new Set(work.relations.filter(row => row.target_type === 'album').map(row => row.target_id));
        const snapshot = await deps.catalogStore.get();
        const albumRows = params.get('kind') === 'events' ? [] : await deps.catalogStore.albumSummaries(Array.from(albumIds), snapshot);
        const songRows = await Promise.all(
          Array.from(songs, (id) => deps.catalogStore.song(id, snapshot)),
        );
        const eventRows = await Promise.all(
          Array.from(events, (id) => deps.catalogStore.event(id, undefined, snapshot)),
        );
        if (songRows.some((row) => !row) || eventRows.some((row) => !row))
          throw new Error("Missing anime media");
        result = {
          build_id:
            work.build_id +
            ":" +
            snapshot.buildId,
          songs: songRows.map((row) => row.song),
          events: eventRows.map((row) => row.event),
          albums: albumRows,
        };
      } else if (urlPath === "/api/catalog/events")
        result = await deps.catalogStore.events(params);
      else if (urlPath === "/api/catalog/event")
        result = await deps.catalogStore.event(
          params.get("id"),
          params.get("legacy"),
        );
      else if (urlPath === "/api/catalog/songs")
        result = await deps.catalogStore.songs(params);
      else if (urlPath === "/api/catalog/song")
        result = await deps.catalogStore.song(params.get("id"));
      else if (urlPath === "/api/catalog/creators")
        result = await deps.catalogStore.creators(params);
      else if (urlPath === "/api/catalog/creator")
        result = await deps.catalogStore.creator(params.get("id"));
      else if (urlPath === "/api/catalog/albums")
        result = await deps.catalogStore.albums(params);
      else if (urlPath === "/api/catalog/album")
        result = await deps.catalogStore.album(
          params.get("id"),
          params.get("name"),
        );
      else if (urlPath === "/api/catalog/voice-actors")
        result = await deps.catalogStore.voices(params);
      else if (urlPath === "/api/catalog/horses")
        result = await deps.horseStore.index(params);
      else if (urlPath === "/api/catalog/horse")
        result = await deps.horseStore.detail(params.get("id"));
      else if (urlPath === "/api/catalog/appearance") {
        const type = params.get("type");
        if (type !== "character" && type !== "voice_actor") {
          deps.sendJson(res, 400, { error: "invalid appearance type" });
          return;
        }
        result = await deps.catalogStore.appearance(
          type,
          params.get("id") || "",
        );
      } else {
        deps.sendJson(res, 404, { error: "unknown catalog endpoint" });
        return;
      }
      sendCatalogResult(req, res, result, req.url);
    } catch (error) {
      deps.sendJson(res, 503, { error: "catalog temporarily unavailable" });
    }
  }
  return { handleHomeSummary, handleCatalogApi };
};
