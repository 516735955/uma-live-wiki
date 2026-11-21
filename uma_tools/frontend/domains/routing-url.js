/* Pure URL serialization & route-layout helpers extracted from routing.js. */

export function currentUrlPath() {
  return window.location.pathname + window.location.search;
}

export function routeWillBeAtomic(path) {
  const clean = String(path || "")
    .split("?")[0]
    .replace(/\/+$/, "")
    .replace(/^\/zh-Hans/i, "");
  return (
    /^\/news\/[^/]+$/.test(clean) ||
    /^\/events\/[^/]+(?:\/sessions\/[^/]+)?$/.test(clean) ||
    /^\/music\/(?:songs|albums|creators)\/[^/]+(?:\/[^/]+)?$/.test(clean) ||
    /^\/database\/(?:characters|voice-actors|horses|venues|staff)\/[^/]+(?:\/[^/]+)?$/.test(
      clean,
    ) ||
    /^\/database\/anime\/[^/]+(?:\/episodes\/[^/]+)?$/.test(clean)
  );
}

export function pendingLayout(path) {
  if (!path) return "entity";
  const [, , area, section, id] = new URL(path, window.location.origin).pathname.split("/");
  if (area === "news") return section ? "article" : "news";
  if (area === "events") return section ? "event" : "rows";
  if (area === "database" && section === "venues") return id ? "venue" : "venues";
  if (routeWillBeAtomic(path)) return "entity";
  if (area === "music" && ["songs", "albums"].includes(section)) return section;
  return area === "music" && section === "creators" ? "rows" : "plain";
}

export function buildCanonicalRoutePath(deps) {
  let path = deps.routes.home();
  if (deps.home.value) return path;

  if (deps.activeTab.value === "news") {
    if (deps.newsDetail.value) {
      return deps.routes.news(deps.newsDetail.value.announce_id);
    }
    return deps.routes.query(deps.routes.news(), {
      q: deps.newsQuery.value,
      range: deps.newsRange.value,
      type: deps.newsType.value,
      page: deps.newsPage.value,
    });
  }

  if (deps.activeTab.value === "live") {
    if (deps.liveView.value === "eventDetail" && deps.eventDetail.value) {
      return deps.routes.query(
        deps.routes.events(deps.eventDetail.value.id, deps.selectedEventSessionId.value),
        {
          section: deps.eventSection.value === deps.defaultEventSection.value ? "" : deps.eventSection.value,
        },
      );
    }
    return deps.routes.query(deps.routes.events(), {
      q: deps.eventsQuery.value,
      time: deps.evTime.value,
      kind: deps.evKind.value,
      mode: deps.evMode.value,
      year: deps.evYear.value,
      series: deps.evSeries.value,
      page: deps.eventsPage.value,
    });
  }

  if (deps.activeTab.value === "database") {
    if (deps.dbView.value === "characters") {
      return deps.charDetail.value
        ? deps.routes.characters(deps.charDetail.value.id, deps.charSection.value)
        : deps.routes.query(deps.routes.characters(), {
            q: document.querySelector("#cIntroSearch")?.value || "",
            sort: deps.charSort.value === "default" ? "" : deps.charSort.value,
          });
    }
    if (deps.dbView.value === "voice") {
      return deps.voiceDetail.value
        ? deps.routes.voiceActors(deps.voiceDetail.value.id, deps.voiceSection.value)
        : deps.routes.query(deps.routes.voiceActors(), {
            q: document.querySelector("#vaSearch")?.value || "",
          });
    }
    if (deps.dbView.value === "albums") {
      return deps.albumDetail.value
        ? deps.routes.albums(deps.albumDetail.value.data.id, deps.albumSection.value)
        : deps.routes.query(deps.routes.albums(), {
            q: deps.relQuery.value,
            work: deps.relWork.value,
            release_series: deps.relSeries.value,
            type: deps.relFilter.value,
            year: deps.relYear.value,
            sort: deps.relSort.value === "newest" ? "" : deps.relSort.value,
            page: deps.relPage.value,
          });
    }
    if (deps.dbView.value === "songs") {
      path = deps.routes.songs(
        deps.songDetail.value && deps.songDetail.value.id,
        deps.songSection.value,
      );
      if (deps.songDetail.value) {
        return deps.routes.query(path, {
          version: deps.songLinkVersion.value,
          release: deps.songLinkRelease.value,
        });
      }
      return deps.routes.query(deps.routes.songs(), {
        q: deps.songDbQuery.value,
        page: deps.songDbPage.value,
      });
    }
    if (deps.dbView.value === "creators") {
      path = deps.routes.creators(
        deps.creatorDetail.value && deps.creatorDetail.value.id,
        deps.creatorSection.value,
      );
      if (!deps.creatorDetail.value) {
        return deps.routes.query(deps.routes.creators(), {
          q: deps.creatorQuery.value,
          page: deps.creatorPage.value,
        });
      }
      return path;
    }
    if (deps.dbView.value === "anime") {
      if (deps.animeDetail.value) {
        const current = new URL(window.location.href);
        const workPath = deps.routes.anime(deps.animeDetail.value.id);
        const sameWork = current.pathname === workPath || current.pathname.startsWith(workPath + "/");
        return deps.routes.query(
          deps.routes.anime(
            deps.animeDetail.value.id,
            deps.animeUnitDetail.value && deps.animeUnitDetail.value.id,
          ),
          {
            section: deps.animeSection.value,
            staff: deps.animeStaffQuery.value,
            edition: deps.animeDetail.value.id === "anime-rttt" ? deps.animeEdition.value : "",
            still: deps.animeStillUnit.value,
            episodes: deps.animeEpisodeQuery.value,
            version: sameWork ? current.searchParams.get("version") : "",
            release: sameWork ? current.searchParams.get("release") : "",
          },
        );
      }
      return deps.routes.query(deps.routes.anime(), {
        q: deps.animeQuery.value,
        format: deps.animeFormat.value,
        status: deps.animeStatus.value,
        sort: deps.animeSort.value === "newest" ? "" : deps.animeSort.value,
      });
    }
    if (deps.dbView.value === "staff") {
      return deps.routes.query(
        deps.routes.staff(deps.staffDetail.value && deps.staffDetail.value.id),
        {
          q: deps.staffDetail.value ? "" : deps.staffQuery.value,
          page: deps.staffDetail.value ? "" : deps.staffPage.value,
        },
      );
    }
    if (deps.dbView.value === "venues") {
      if (deps.venueDetail.value) return deps.routes.venues(deps.venueDetail.value.id);
      return deps.routes.query(deps.routes.venues(), {
        q: deps.venueQuery.value,
        page: deps.venuePage.value,
      });
    }
    if (deps.dbView.value === "other") {
      if (!deps.horseDetail.value && deps.otherSection.value === "relationships") {
        return deps.routes.other();
      }
      if (deps.otherSection.value === "horses") {
        return deps.routes.query(
          deps.routes.horses(deps.horseDetail.value && deps.horseDetail.value.id),
          {
            q: deps.horseQuery.value,
            page: deps.horsePage.value,
            sex: deps.horseSex.value,
            sort: deps.horseSort.value === "newest" ? "" : deps.horseSort.value,
          },
        );
      }
      if (deps.otherSection.value === "videos") return deps.routes.videos();
      if (deps.otherSection.value === "jockeys") return deps.routes.jockeys();
      return deps.routes.relationships();
    }
    return deps.routes.characters();
  }

  if (deps.activeTab.value === "contribute") return deps.routes.contribute("fix");
  if (deps.activeTab.value === "contribute-contact") return deps.routes.contribute("contact");
  if (deps.activeTab.value === "legal-privacy") return deps.routes.legal("privacy");
  if (deps.activeTab.value === "legal-terms") return deps.routes.legal("terms");
  if (deps.activeTab.value === "links") return deps.routes.links();
  return deps.LANG_PREFIX + "/" + deps.activeTab.value;
}
