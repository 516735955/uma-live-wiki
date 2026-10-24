"""Build responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import appearances as pipeline_appearances
from . import common as pipeline_common
from . import events as pipeline_events
from . import identities as pipeline_identities
from . import music as pipeline_music
from . import validation as pipeline_validation
from . import setlists as pipeline_setlists
from . import event_enrichment as pipeline_event_enrichment
from . import generate_group_images as pipeline_group_images


def build(programs_override: dict[str, pipeline_common.Any] | None = None, details_override: dict[str, pipeline_common.Any] | None = None) -> dict[str, pipeline_common.Any]:
    source_hashes = {path.name: pipeline_common.sha256(path) for path in pipeline_common.IMMUTABLE_LIVE_FILES}
    live_data = pipeline_common.read_json(pipeline_common.DATA_DIR / "live_data.json")
    live_cat_data = pipeline_common.read_json(pipeline_common.DATA_DIR / "live_cat_data.json")
    albums = pipeline_common.read_json(pipeline_common.DATA_DIR / "albums.json")
    eventernote = pipeline_common.read_json(pipeline_common.DATA_DIR / "events_data.json")
    series = pipeline_common.read_json(pipeline_common.EVENTS_DIR / "series.json")
    programs = programs_override if programs_override is not None else pipeline_common.read_json(pipeline_common.EVENTS_DIR / "official_programs.json")
    details = details_override if details_override is not None else (pipeline_common.read_json(pipeline_common.VOICE_DETAILS_FILE) if pipeline_common.VOICE_DETAILS_FILE.exists() else {"records": []})
    overrides = pipeline_common.read_json(pipeline_common.EVENTS_DIR / "overrides.json")
    characters = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    voice_list = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "voice_list_data.js", "VA_LIST")
    photos = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "va_photos_data.js", "VA_PHOTOS")
    identity_registry = pipeline_common.read_json(pipeline_common.VOICE_IDENTITIES_FILE)
    music_sources = {key: pipeline_common.read_json(path) for key, path in pipeline_common.MUSIC_SOURCE_FILES.items()}
    identities = pipeline_identities.IdentityIndex(characters, voice_list, photos, overrides, identity_registry, details)
    used: set[str] = set()
    events = pipeline_events.numbered_events(live_data, identities, used, overrides.get("stable_event_ids") or {})
    events.extend(pipeline_events.category_events(live_cat_data, identities, used, overrides.get('stable_event_ids') or {}))
    pipeline_events.attach_eventernote(events, eventernote, identities, used)
    pipeline_events.add_programs(events, programs, identities, used)
    pipeline_events.add_programs(events, {"programs": overrides.get("additional_events") or []}, identities, used)
    events = pipeline_events.apply_overrides(events, overrides, identities)
    events = pipeline_events.dedupe_events(pipeline_setlists.merge_numbered_sources(events))
    sheet_blocks = pipeline_setlists.read_blocks(pipeline_common.ROOT)
    pipeline_setlists.apply_sheet(events, sheet_blocks, identities, eventernote)
    event_groups = []
    for event in events:
        event.pop("session_aliases", None)
        # Preserve known franchise actors with documented participation even
        # when their character is outside the curated character catalogue.
        event["cast"] = [
            item for item in event.get("cast") or []
            if item.get("person_type") in {"unresolved_cast", "external_guest"}
            or (item.get("voice_actor_id") in identities.profile_by_id
            and (item.get("character_id") or item.get('evidence') == 'google_sheet' or not identities.profile_by_id[item["voice_actor_id"]].get("roles")))
        ]
        if event["cast"]:
            event["cast_status"] = "verified"
        elif event.get("character_ids"):
            event["cast_status"] = "character_only"
        elif event.get("cast_status") != "announced_tba":
            event["cast_status"] = "partial"
    series_by_id = pipeline_events.series_lookup(series)
    for event in events:
        event.pop("image_fallback", None)
        event["image"] = pipeline_events.resolve_event_cover(event, series_by_id)
        event["setlist_status"] = "verified" if any(
            session.get("setlist_source") for session in event.get("sessions") or []
        ) else "none"
        for source in event.get("sources") or []:
            if source.get("kind") == "curated_live":
                source["label"] = "站内精调歌单" if event["setlist_status"] == "verified" else "站内精调资料"
        for session in event.get("sessions") or []:
            if event.get("schedule_status") == "cancelled":
                session["schedule_status"] = "cancelled"
            session["setlist_status"] = "verified" if session.get("setlist_source") else "none"
    events, event_groups = pipeline_event_enrichment.enrich(events)
    # Generate parent collages from this build's enriched events before the
    # material hash is calculated, so new editorial children ship atomically
    # with the catalog and receive a matching build id.
    pipeline_group_images.rebuild(events, event_groups)
    events, event_groups = pipeline_event_enrichment.enrich(events)
    for event in events:
        if not event.get("series_id"):
            derived = pipeline_events.title_series_id(event.get("title") or "")
            if derived:
                event["series_id"] = derived
    from event_localization import apply_localizations
    apply_localizations(events, pipeline_common.DATA_DIR)
    events.sort(key=lambda event: (event.get("date") or "0000-00-00", event.get("title") or "", event["id"]), reverse=True)
    generated_at = pipeline_common.dt.datetime.now(pipeline_common.dt.timezone.utc).replace(microsecond=0).isoformat()
    songs_catalog = pipeline_music.build_song_catalog(albums, events, identities, generated_at, overrides, music_sources)
    creators_catalog = pipeline_music.build_creator_catalog(songs_catalog, music_sources["creators"], generated_at)
    appearances = pipeline_appearances.build_appearance_index(events, songs_catalog, identities)
    profiles = pipeline_appearances.enrich_profiles(identities.profiles, appearances)
    current_hashes = {path.name: pipeline_common.sha256(path) for path in pipeline_common.IMMUTABLE_LIVE_FILES}
    if current_hashes != source_hashes:
        raise RuntimeError("curated live sources changed during event build")
    kinds = pipeline_common.Counter(event.get("kind") or "unknown" for event in events)
    modes = pipeline_common.Counter(event.get("mode") or "unknown" for event in events)
    catalog = {
        "schema_version": 1,
        "generated_at": generated_at,
        "source_integrity": {name: {"sha256": digest, "preserved": True} for name, digest in source_hashes.items()},
        "coverage": {
            "events": len(events), "by_kind": dict(sorted(kinds.items())), "by_mode": dict(sorted(modes.items())),
            "official_programs": len(programs.get("programs") or []), "unresolved_cast_names": len(appearances["unresolved_cast"]),
        },
        "series": series.get("series") or [],
        "event_groups": event_groups,
        "events": events,
    }
    profiles_doc = {"schema_version": 1, "generated_at": catalog["generated_at"], "voice_actors": profiles}
    appearances["generated_at"] = catalog["generated_at"]
    build_material = {
        "live": live_data, "live_categories": live_cat_data, "albums": albums,
        "eventernote": eventernote, "series": series, "programs": programs,
        "voice_details": details, "overrides": overrides, "characters": characters,
        "voice_list": voice_list, "photos": photos, "voice_identities": identity_registry,
        "music_sources": music_sources, "google_setlists": sheet_blocks,
        "event_groups": event_groups,
        "event_group_source": pipeline_common.read_json(pipeline_common.EVENTS_DIR / "groupings.json"),
        "venue_source": pipeline_common.read_json(pipeline_common.EVENTS_DIR / "venues.json"),
        # Parent-group collage assets are generated inputs too.  Include their
        # content in the material hash so a refreshed cover cannot be served
        # under an unchanged catalog build id.
        "event_group_images": {
            path.name: pipeline_common.sha256(path)
            for path in sorted(pipeline_event_enrichment.GROUP_IMAGE_DIR.glob("*.svg"))
        },
        "event_copy": [(
            event["id"], event.get("title_zh"), event.get("summary_zh"),
            event.get("group_ids"), event.get("venue_id"),
            tuple((session.get("id"), session.get("start_time"), session.get("doors_time"), session.get("end_time"))
                  for session in event.get("sessions") or []),
        ) for event in events],
    }
    build_id = pipeline_common.hashlib.sha256(
        pipeline_common.json.dumps(build_material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    for document in (catalog, songs_catalog, creators_catalog, appearances, profiles_doc):
        document["build_id"] = build_id
    manifest = {
        "schema_version": 1,
        "build_id": build_id,
        "generated_at": generated_at,
        "home_stats": home_statistics(catalog, songs_catalog, appearances, profiles_doc),
        "files": {
            "events": "/data/events_catalog.json",
            "songs": "/data/song_catalog.json",
            "creators": "/data/creator_catalog.json",
            "appearances": "/data/appearance_index.json",
            "voice_actors": "/data/voice_actor_profiles.json",
        },
    }
    errors = pipeline_validation.validate(catalog, songs_catalog, creators_catalog, appearances, profiles)
    if errors:
        raise RuntimeError("validation failed:\n- " + "\n- ".join(errors[:30]))
    return {"catalog": catalog, "songs": songs_catalog, "creators": creators_catalog, "appearances": appearances, "profiles": profiles_doc, "manifest": manifest}


def build_music_only() -> dict[str, pipeline_common.Any]:
    """Refresh music outputs without regenerating curated event/profile data."""
    catalog = pipeline_common.read_json(pipeline_common.OUTPUT_FILES["catalog"])
    manifest = pipeline_common.read_json(pipeline_common.OUTPUT_FILES["manifest"])
    albums = pipeline_common.read_json(pipeline_common.DATA_DIR / "albums.json")
    overrides = pipeline_common.read_json(pipeline_common.EVENTS_DIR / "overrides.json")
    characters = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    voice_list = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "voice_list_data.js", "VA_LIST")
    photos = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "va_photos_data.js", "VA_PHOTOS")
    identities = pipeline_identities.IdentityIndex(
        characters,
        voice_list,
        photos,
        overrides,
        pipeline_common.read_json(pipeline_common.VOICE_IDENTITIES_FILE),
        pipeline_common.read_json(pipeline_common.VOICE_DETAILS_FILE) if pipeline_common.VOICE_DETAILS_FILE.exists() else {"records": []},
    )
    music_sources = {key: pipeline_common.read_json(path) for key, path in pipeline_common.MUSIC_SOURCE_FILES.items()}
    generated_at = pipeline_common.dt.datetime.now(pipeline_common.dt.timezone.utc).replace(microsecond=0).isoformat()
    songs_catalog = pipeline_music.build_song_catalog(albums, catalog.get("events") or [], identities, generated_at, overrides, music_sources)
    creators_catalog = pipeline_music.build_creator_catalog(songs_catalog, music_sources["creators"], generated_at)
    appearances = pipeline_appearances.build_appearance_index(catalog.get("events") or [], songs_catalog, identities)
    appearances["generated_at"] = generated_at
    profiles_doc = {
        "schema_version": 1,
        "generated_at": generated_at,
        "voice_actors": pipeline_appearances.enrich_profiles(identities.profiles, appearances),
    }
    catalog["source_integrity"] = {
        path.name: {"sha256": pipeline_common.sha256(path), "preserved": True}
        for path in pipeline_common.IMMUTABLE_LIVE_FILES
    }
    identity_material = {
        "live": pipeline_common.read_json(pipeline_common.DATA_DIR / "live_data.json"),
        "live_categories": pipeline_common.read_json(pipeline_common.DATA_DIR / "live_cat_data.json"),
        "albums": albums,
        "eventernote": pipeline_common.read_json(pipeline_common.DATA_DIR / "events_data.json"),
        "series": pipeline_common.read_json(pipeline_common.EVENTS_DIR / "series.json"),
        "programs": pipeline_common.read_json(pipeline_common.EVENTS_DIR / "official_programs.json"),
        "voice_details": pipeline_common.read_json(pipeline_common.VOICE_DETAILS_FILE) if pipeline_common.VOICE_DETAILS_FILE.exists() else {},
        "overrides": overrides, "characters": characters, "voice_list": voice_list, "photos": photos,
        "voice_identities": pipeline_common.read_json(pipeline_common.VOICE_IDENTITIES_FILE),
        "music_sources": music_sources,
        "google_setlists": pipeline_setlists.read_blocks(pipeline_common.ROOT),
    }
    build_id = pipeline_common.hashlib.sha256(pipeline_common.json.dumps(identity_material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:20]
    for document in (catalog, songs_catalog, creators_catalog, appearances, profiles_doc):
        document["build_id"] = build_id
    manifest["build_id"] = build_id
    manifest["generated_at"] = generated_at
    manifest['home_stats'] = home_statistics(catalog, songs_catalog, appearances, profiles_doc)
    manifest.setdefault("files", {})["creators"] = "/data/creator_catalog.json"
    errors = pipeline_validation.validate(
        catalog,
        songs_catalog,
        creators_catalog,
        appearances,
        profiles_doc.get("voice_actors") or [],
    )
    if errors:
        raise RuntimeError("validation failed:\n- " + "\n- ".join(errors[:30]))
    return {
        "catalog": catalog,
        "songs": songs_catalog,
        "creators": creators_catalog,
        "appearances": appearances,
        "profiles": profiles_doc,
        "manifest": manifest,
    }


def home_statistics(catalog, songs, appearances, profiles):
    events = catalog.get('events') or []
    concerts = [event for event in events if event.get('kind') == 'concert' and event.get('schedule_status') != 'cancelled']
    return {
        'songs': songs['coverage']['songs'], 'albums': songs['coverage']['albums'],
        'live': sum(max(1, sum(session.get('schedule_status') != 'cancelled' for session in event.get('sessions') or [])) for event in concerts),
        'performances': len(concerts), 'characters': len(appearances.get('characters') or {}),
        'voiceActors': len(profiles.get('voice_actors') or []), 'events': len(events),
    }
