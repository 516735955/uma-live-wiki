"""Music responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import song_identity as pipeline_song_identity
from . import text as pipeline_text


def build_creator_catalog(songs_catalog: dict[str, pipeline_common.Any], creators_doc: dict[str, pipeline_common.Any], generated_at: str) -> dict[str, pipeline_common.Any]:
    source_by_id = {str(row.get("id") or ""): row for row in creators_doc.get("creators") or [] if row.get("id")}
    relations: dict[str, dict[str, pipeline_common.Any]] = pipeline_common.defaultdict(lambda: {"works": {}, "versions": set(), "roles": pipeline_common.Counter(), "collaborators": pipeline_common.defaultdict(lambda: {"versions": set(), "works": set()})})
    for song in songs_catalog.get("songs") or []:
        for version in song.get("versions") or []:
            credits = [row for row in version.get("credits") or [] if row.get("creator_id")]
            creator_ids = sorted({row["creator_id"] for row in credits})
            roles_by_creator: dict[str, set[str]] = pipeline_common.defaultdict(set)
            for credit in credits:
                creator_id = credit["creator_id"]
                role = credit["role"]
                roles_by_creator[creator_id].add(role)
                relations[creator_id]["versions"].add(version["id"])
                relations[creator_id]["roles"][role] += 1
                work = relations[creator_id]["works"].setdefault(song["id"], {
                    "song_id": song["id"], "title": song["title"], "cover": song.get("cover") or "",
                    "release_date": song.get("release_date") or "", "roles": set(), "version_ids": set(), "versions": {},
                    "album_names": set(),
                })
                work["roles"].add(role)
                work["version_ids"].add(version["id"])
                work["album_names"].update(
                    str(release.get("album_name") or "").strip()
                    for release in version.get("releases") or []
                    if str(release.get("album_name") or "").strip()
                )
                version_row = work["versions"].setdefault(version["id"], {
                    "id": version["id"], "title": version.get("title") or song["title"],
                    "version_label": version.get("version_label") or "", "roles": set(),
                })
                version_row["roles"].add(role)
            for creator_id in creator_ids:
                for collaborator_id in creator_ids:
                    if collaborator_id == creator_id:
                        continue
                    relations[creator_id]["collaborators"][collaborator_id]["versions"].add(version["id"])
                    relations[creator_id]["collaborators"][collaborator_id]["works"].add(song["id"])

    # Animation music staff and authors of identified, unreleased cues share
    # creator pages. Their episode credits do not fabricate song recordings.
    for creator_id, source in source_by_id.items():
        if source.get("anime_staff") or source.get("anime_music"):
            relations[creator_id]
    creators: list[dict[str, pipeline_common.Any]] = []
    for creator_id, relation in relations.items():
        source = source_by_id.get(creator_id) or {"id": creator_id, "name": creator_id}
        works = []
        for work in relation["works"].values():
            works.append({
                **{key: value for key, value in work.items() if key not in ("roles", "version_ids", "versions", "album_names")},
                "album_name": sorted(work["album_names"])[0] if work["album_names"] else "",
                "roles": sorted(work["roles"], key=lambda role: pipeline_common.CREATOR_ROLE_ORDER.get(role, 99)),
                "version_ids": sorted(work["version_ids"]),
                "versions": [
                    {**{key: value for key, value in version.items() if key != "roles"},
                     "roles": sorted(version["roles"], key=lambda role: pipeline_common.CREATOR_ROLE_ORDER.get(role, 99))}
                    for version in work["versions"].values()
                ],
            })
        works.sort(key=lambda row: (row["release_date"] or "9999-99-99", pipeline_song_identity.fold_song_key(row["title"]), row["song_id"]))
        collaborators = []
        for collaborator_id, shared in relation["collaborators"].items():
            collaborator = source_by_id.get(collaborator_id) or {}
            collaborators.append({
                "creator_id": collaborator_id,
                "name": collaborator.get("name") or collaborator_id,
                **({"image": collaborator["image"]} if collaborator.get("image") else {}),
                "shared_version_count": len(shared["versions"]),
                "shared_work_count": len(shared["works"]),
                "shared_song_ids": sorted(shared["works"]),
            })
        collaborators.sort(key=lambda row: (-row["shared_work_count"], -row["shared_version_count"], pipeline_text.fold_name(row["name"])))
        creators.append({
            "id": creator_id,
            "name": source.get("name") or creator_id,
            "aliases": list(source.get("aliases") or []),
            "type": source.get("type") or "person",
            "affiliations": list(source.get("affiliations") or []),
            **({"image": source["image"]} if source.get("image") else {}),
            "roles": [{"role": role, "label": pipeline_common.CREATOR_ROLE_LABELS.get(role, role), "count": count}
                      for role, count in sorted({**{role: 0 for role in source.get("anime_music_roles", [])},
                                               **relation["roles"]}.items(), key=lambda item: pipeline_common.CREATOR_ROLE_ORDER.get(item[0], 99))],
            "work_count": len(works),
            "version_count": len(relation["versions"]),
            "works": works,
            "collaborators": collaborators,
        })
    creators.sort(key=lambda row: (pipeline_text.fold_name(row["name"]), row["id"]))
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "coverage": {
            "creators": len(creators),
            "credited_works": len({work["song_id"] for creator in creators for work in creator["works"]}),
            "credited_versions": len({version_id for creator in creators for work in creator["works"] for version_id in work["version_ids"]}),
        },
        "creators": creators,
    }


def release_vocalists(artist: str, identities: "IdentityIndex") -> list[dict[str, pipeline_common.Any]]:
    """Resolve release credits once; pages never reinterpret artist strings."""
    credits: list[dict[str, pipeline_common.Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in pipeline_common.re.split(r"[、,，／/&＋+・]|\s{2,}", str(artist or "")):
        label = raw.strip()
        explicit_character = ""
        credited_actor = pipeline_common.re.search(r"[（(]\s*CV[.:：]?\s*([^）)]+)[）)]", label, pipeline_common.re.I)
        if credited_actor:
            explicit_character = label[:credited_actor.start()].strip()
            label = credited_actor.group(1).strip()
        else:
            parenthetical = pipeline_common.re.search(r"[（(]([^）)]+)[）)]", label)
            if parenthetical and identities.voice_id(parenthetical.group(1).strip()):
                label = parenthetical.group(1).strip()
        label = pipeline_common.re.sub(r"^(?:CV[.:：]?\s*)", "", label, flags=pipeline_common.re.I)
        if not label or pipeline_common.re.search(r"^(?:声优剧|ドラマ|トーク|SE|BGM)$", label, pipeline_common.re.I):
            continue
        actor_id = identities.voice_id(label)
        character_id = identities.character_id(explicit_character) if explicit_character else (
            identities.current_character_id(actor_id) if actor_id else identities.character_id(label)
        )
        if character_id and not actor_id:
            character = identities.character_by_id.get(character_id) or {}
            actor_id = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
        if not actor_id:
            continue
        # An explicit but unresolved role must stay unresolved; selecting the
        # actor's current role would mis-credit releases where one actor voices
        # multiple characters.
        if not character_id and not explicit_character:
            character_id = identities.current_character_id(actor_id)
        key = (actor_id, character_id)
        if key in seen:
            continue
        seen.add(key)
        profile = identities.profile_by_id.get(actor_id) or {}
        credits.append({
            "voice_actor_id": actor_id,
            "voice_actor_name": (profile.get("identity") or {}).get("zh") or label,
            "character_id": character_id,
            "character": identities.character_payload(character_id) if character_id else None,
        })
    return credits


def build_song_catalog(
    albums: list[dict[str, pipeline_common.Any]],
    events: list[dict[str, pipeline_common.Any]],
    identities: "IdentityIndex",
    generated_at: str,
    overrides: dict[str, pipeline_common.Any] | None = None,
    music_sources: dict[str, dict[str, pipeline_common.Any]] | None = None,
) -> dict[str, pipeline_common.Any]:
    """Build one canonical work with explicit release/performance variants."""
    title_overrides = dict(overrides or {})
    title_overrides["song_versions"] = {
        **((overrides or {}).get("song_versions") or {}),
        **(((music_sources or {}).get("overrides") or {}).get("song_versions") or {}),
    }
    raw_titles = {
        pipeline_song_identity.fold_song_key(str(song.get("name") or ""))
        for album in albums
        for song in album.get("songs") or []
        if pipeline_song_identity.clean_song(str(song.get("name") or ""))
    }
    raw_titles.update(
        pipeline_song_identity.fold_song_key(str(performance.get("song") or ""))
        for event in events
        if event.get("schedule_status") != "cancelled"
        for session in event.get("sessions") or []
        if session.get("schedule_status") != "cancelled"
        for performance in session.get("performances") or []
        if pipeline_song_identity.clean_song(str(performance.get("song") or ""))
    )
    works: dict[str, dict[str, pipeline_common.Any]] = {}
    used_song_ids: dict[str, str] = {}
    published_song_ids: dict[str, str] = {}
    published_base_releases: set[tuple[str, str]] = set()
    # Keep URLs for already published works stable while allowing newly seen
    # equivalent titles to use the same folded identity.  The catalog is only
    # a compatibility index here; a failed or partial read must not block a
    # rebuild.
    try:
        catalog_path = pipeline_common.OUTPUT_FILES.get("songs")
        if catalog_path and pipeline_common.os.path.isfile(catalog_path):
            with open(catalog_path, encoding="utf-8") as handle:
                previous_catalog = pipeline_common.json.load(handle)
            published_candidates: dict[str, set[str]] = {}
            for previous in previous_catalog.get("songs") or []:
                previous_id = str(previous.get("id") or "")
                if not previous_id:
                    continue
                for version in previous.get('versions') or []:
                    if version.get('id') == pipeline_song_identity.stable_version_id(previous_id, version.get('title') or ''):
                        published_base_releases.update((release.get('album_id') or '', version.get('title') or '') for release in version.get('releases') or [])
                for title in [previous.get("title"), *(previous.get("aliases") or [])]:
                    key = pipeline_song_identity.fold_song_key(str(title or ""))
                    if key:
                        published_candidates.setdefault(key, set()).add(previous_id)
            published_song_ids = {
                key: next(iter(ids)) for key, ids in published_candidates.items() if len(ids) == 1
            }
    except (OSError, ValueError, TypeError):
        published_song_ids = {}

    def performer_key(track):
        raw = str(track.get('artist') or '')
        keys = set()
        for name in pipeline_common.re.split(r'[、,，・/]', raw):
            if not name.strip() or pipeline_common.re.fullmatch(r'\s*ウマ娘\s*プリティーダービー\s*', name):
                continue
            resolved = release_vocalists(name, identities)
            keys.update(row['voice_actor_id'] for row in resolved)
            if not resolved:
                keys.add(pipeline_text.fold_name(name))
        return tuple(sorted(keys))

    def recording_key(track):
        return (pipeline_song_identity.fold_song_key(track.get('name') or ''), track.get('work_context') or '')

    canonical_performers = {}
    performer_variants = {}
    ordered_albums = sorted(albums, key=lambda album: (album.get('release') or '9999', pipeline_song_identity.stable_album_id(album)))
    # Keep published recording URLs stable when a new source is inserted before
    # an older release. Explicitly reviewed variant labels retain priority.
    for known_only in (True, False):
        for album in ordered_albums:
            album_id = pipeline_song_identity.stable_album_id(album)
            for track in album.get('songs') or []:
                key, performers = recording_key(track), performer_key(track)
                if track.get('version_label'):
                    performer_variants[(key, performers)] = track['version_label']
                elif performers and (not known_only or (album_id, track.get('name') or '') in published_base_releases):
                    canonical_performers.setdefault(key, performers)

    def ensure_version(exact_title: str, release_variant: str = "", work_context: str = "") -> tuple[dict[str, pipeline_common.Any], dict[str, pipeline_common.Any]]:
        title = pipeline_song_identity.clean_song(exact_title)
        override_config = pipeline_song_identity.song_version_config(title, title_overrides)
        override = pipeline_song_identity.song_version_override(title, title_overrides)
        if override:
            base, version_label = override
        else:
            base, version_label = pipeline_song_identity.split_song_version(title, identities, raw_titles)
        work_identity = base + (f" ({work_context})" if work_context else "")
        work_key = pipeline_song_identity.fold_song_key(work_identity)
        stable_id = published_song_ids.get(work_key) or pipeline_song_identity.stable_song_id(work_identity)
        prior_key = used_song_ids.get(stable_id)
        if prior_key and prior_key != work_key:
            suffix = pipeline_common.hashlib.sha1(work_key.encode("utf-8")).hexdigest()[:8]
            stable_id = f"{stable_id}-{suffix}"
        used_song_ids[stable_id] = work_key
        work = works.setdefault(work_key, {
            "id": stable_id, "title": base, "aliases": set(), "artists": set(),
            "legacy_ids": set(),
            "character_ids": set(), "voice_actor_ids": set(),
            "released_character_ids": set(), "released_voice_actor_ids": set(),
            "performed_character_ids": set(), "performed_voice_actor_ids": set(),
            "versions": {},
        })
        work["legacy_ids"].update(str(value) for value in override_config.get("legacy_song_ids") or [] if value)
        work["aliases"].add(title)
        identity_title = title + (f" ({release_variant})" if release_variant else "")
        version_key = pipeline_song_identity.fold_song_key(identity_title)
        version = work["versions"].setdefault(version_key, {
            "id": str(override_config.get("version_id") or pipeline_song_identity.stable_version_id(work["id"], identity_title)), "title": title,
            "version_label": " / ".join(dict.fromkeys(value for value in (version_label, release_variant) if value)), "artists": set(), "releases": [], "performances": [],
            "instrumental": False,
        })
        return work, version

    for album in albums:
        album_id = pipeline_song_identity.stable_album_id(album)
        for track_number, track in enumerate(album.get("songs") or [], 1):
            if not pipeline_song_identity.clean_song(str(track.get("name") or "")):
                continue
            key, performers = recording_key(track), performer_key(track)
            variant = str(track.get('version_label') or '')
            if not variant and performers and performers != canonical_performers.get(key):
                variant = performer_variants.setdefault((key, performers), '演唱版：' + (album.get('catalog') or album_id))
            work, version = ensure_version(str(track.get("name") or ""), variant, str(track.get("work_context") or ""))
            artist = str(track.get("artist") or "").strip()
            instrumental = bool(track.get("instrumental")) or pipeline_song_identity.is_instrumental_track(str(track.get("name") or ""), artist)
            version["instrumental"] = bool(version["instrumental"] or instrumental)
            if track.get('content_type') == 'spoken':
                version['content_type'] = 'spoken'
            vocalists = [] if instrumental else release_vocalists(artist, identities)
            if artist:
                work["artists"].add(artist)
                version["artists"].add(artist)
            for vocalist in vocalists:
                actor_id = vocalist.get("voice_actor_id") or ""
                character_id = vocalist.get("character_id") or ""
                if actor_id:
                    work["voice_actor_ids"].add(actor_id)
                    work["released_voice_actor_ids"].add(actor_id)
                if character_id:
                    work["character_ids"].add(character_id)
                    work["released_character_ids"].add(character_id)
            release = {
                "album_id": album_id, "album_name": album.get("name") or "", "release_date": album.get("release") or "",
                "catalog": album.get("catalog") or "", "type": album.get("type") or "", "cover": album.get("cover") or "",
                "track_number": track_number, "disc_number": track.get("disc_number"), "disc_track_number": track.get("disc_track_number"),
                "artist": artist, "audio_url": track.get("url") or "", "image": track.get("pic") or "",
                "instrumental": instrumental, "vocalists": vocalists,
                **({'content_type': 'spoken'} if track.get('content_type') == 'spoken' else {}),
            }
            version["releases"].append(release)

    for event in events:
        if event.get("schedule_status") == "cancelled":
            continue
        for session in event.get("sessions") or []:
            if session.get("schedule_status") == "cancelled":
                continue
            actor_ids_by_character: dict[str, set[str]] = pipeline_common.defaultdict(set)
            for cast in [*(event.get("cast") or []), *(session.get("cast") or [])]:
                if cast.get("character_id") and cast.get("voice_actor_id"):
                    actor_ids_by_character[cast["character_id"]].add(cast["voice_actor_id"])
            for performance_index, performance in enumerate(session.get("performances") or [], 1):
                title = str(performance.get("song") or "")
                if not pipeline_song_identity.clean_song(title):
                    continue
                work, version = ensure_version(title)
                performance["song_id"] = work["id"]
                performance["version_id"] = version["id"]
                performance["song_title"] = work["title"]
                character_ids = list(dict.fromkeys(performance.get("character_ids") or []))
                voice_actor_ids = set(performance.get('voice_actor_ids') or [])
                guests = performance.get('guest_performers') or []
                if hasattr(identities, 'voice_id'):
                    voice_actor_ids.update(actor for name in guests if (actor := identities.voice_id(name)))
                    guests = [name for name in guests if not identities.voice_id(name)]
                for character_id in character_ids:
                    resolved = actor_ids_by_character.get(character_id) or set()
                    character = getattr(identities, "character_by_id", {}).get(character_id) or {}
                    if not resolved and not character.get("cv_former") and hasattr(identities, "voice_id"):
                        current_actor = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
                        if current_actor:
                            resolved = {current_actor}
                    voice_actor_ids.update(resolved)
                performance['voice_actor_ids'] = sorted(voice_actor_ids)
                performance['guest_performers'] = guests
                work["character_ids"].update(character_ids)
                work["voice_actor_ids"].update(voice_actor_ids)
                work["performed_character_ids"].update(character_ids)
                work["performed_voice_actor_ids"].update(voice_actor_ids)
                version["performances"].append({
                    "event_id": event.get("id") or "", "event_title": event.get("title") or "", "event_date": event.get("date") or "",
                    "kind": event.get("kind") or "", "series_id": event.get("series_id") or "",
                    "session_id": session.get("id") or "", "session_label": session.get("label") or "",
                    "session_date": session.get("date") or "", "performance_index": performance_index,
                    "setlist_no": performance.get("setlist_no") if "setlist_no" in performance else None,
                    "character_ids": character_ids, "voice_actor_ids": sorted(voice_actor_ids),
                    **({'guest_performers': list(guests)} if guests else {}),
                    "event_url": f"/zh-Hans/events/{pipeline_common.urllib.parse.quote(str(event.get('id') or ''))}?session={pipeline_common.urllib.parse.quote(str(session.get('id') or ''))}",
                })

    sources = music_sources or {}
    source_versions = set((sources.get("credits") or {}).get("versions") or {}) | set((sources.get("lyrics") or {}).get("versions") or {})
    version_overrides = (sources.get("overrides") or {}).get("versions") or {}
    folded_versions: dict[str, tuple[str, str, str]] = {}
    for work in works.values():
        if not work["versions"]:
            continue
        original_id = pipeline_song_identity.select_original_version(work, sources.get("overrides") or {})
        original = next((row for row in work["versions"].values() if row["id"] == original_id), None)
        if not original:
            continue
        for version_key, version in list(work["versions"].items()):
            version_id = version["id"]
            override = version_overrides.get(version_id) or {}
            if version is original or version.get("releases") or version_id in source_versions or override.get("independent_recording"):
                continue
            for performance in version.get("performances") or []:
                performance["performance_variant"] = {
                    "title": version.get("title") or work["title"],
                    "label": version.get("version_label") or "",
                }
                original["performances"].append(performance)
            folded_versions[version_id] = (
                original_id,
                version.get("title") or work["title"],
                version.get("version_label") or "",
            )
            del work["versions"][version_key]
    if folded_versions:
        for event in events:
            for session in event.get("sessions") or []:
                for performance in session.get("performances") or []:
                    folded = folded_versions.get(str(performance.get("version_id") or ""))
                    if not folded:
                        continue
                    performance["version_id"] = folded[0]
                    performance["performance_variant"] = {"title": folded[1], "label": folded[2]}

    songs = []
    for work in works.values():
        original_version_id = pipeline_song_identity.effective_music_metadata(
            work,
            sources.get("credits") or {},
            sources.get("lyrics") or {},
            sources.get("timings") or {},
            sources.get("overrides") or {},
        )
        versions = []
        for version in work["versions"].values():
            releases = sorted(version["releases"], key=lambda row: (row["release_date"] or "9999-99-99", row["album_name"], row["track_number"]))
            performances = sorted(version["performances"], key=lambda row: (row["session_date"] or row["event_date"] or "0000-00-00", row["event_id"], row["session_id"]), reverse=True)
            versions.append({
                "id": version["id"], "title": version["title"], "version_label": version["version_label"],
                "artists": sorted(version["artists"]), "releases": releases, "performances": performances,
                "release_count": len(releases), "performance_count": len(performances),
                "instrumental": bool(version.get("instrumental")),
                **({'content_type': 'spoken'} if version.get('content_type') == 'spoken' else {}),
                "credits": list(version.get("credits") or []),
                "creator_ids": list(version.get("creator_ids") or []),
                "lyrics_ref": version.get("lyrics_ref") or "",
                "has_lyrics": bool(version.get("has_lyrics")),
                "has_timing": bool(version.get("has_timing")),
            })
        versions.sort(key=lambda row: (bool(row["version_label"]), row["version_label"], row["title"]))
        release_count = sum(version["release_count"] for version in versions)
        performance_count = sum(version["performance_count"] for version in versions)
        release_rows = sorted(
            [release for version in versions for release in version["releases"]],
            key=lambda row: (row["release_date"] or "9999-99-99", row["album_name"], row["track_number"]),
        )
        first_release = release_rows[0] if release_rows else None
        songs.append({
            "id": work["id"], "title": work["title"], "aliases": sorted(work["aliases"]),
            "legacy_ids": sorted(work["legacy_ids"]),
            "artists": sorted(work["artists"]), "character_ids": sorted(work["character_ids"]),
            "voice_actor_ids": sorted(work["voice_actor_ids"]),
            "released_character_ids": sorted(work["released_character_ids"]),
            "released_voice_actor_ids": sorted(work["released_voice_actor_ids"]),
            "performed_character_ids": sorted(work["performed_character_ids"]),
            "performed_voice_actor_ids": sorted(work["performed_voice_actor_ids"]),
            "cover": ((first_release or {}).get("cover") or (first_release or {}).get("image") or "/album_covers/placeholder.webp"),
            "release_date": (first_release or {}).get("release_date") or "",
            "versions": versions, "version_count": len(versions), "release_count": release_count,
            "performance_count": performance_count,
            "original_version_id": original_version_id,
            "creator_ids": sorted({creator_id for version in versions for creator_id in version.get("creator_ids") or []}),
            "has_lyrics": any(bool(version.get("has_lyrics")) for version in versions),
        })
    songs.sort(key=lambda row: (pipeline_song_identity.fold_song_key(row["title"]), row["id"]))
    return {
        "schema_version": 1, "generated_at": generated_at,
        "coverage": {
            "songs": len(songs), "versions": sum(row["version_count"] for row in songs),
            "albums": len(albums),
            "release_tracks": sum(row["release_count"] for row in songs),
            "live_performances": sum(row["performance_count"] for row in songs),
            "credited_songs": sum(bool(row.get("creator_ids")) for row in songs),
            "lyric_songs": sum(bool(row.get("has_lyrics")) for row in songs),
            "credited_versions": sum(bool(version.get("creator_ids")) for row in songs for version in row.get("versions") or []),
            "lyric_versions": sum(bool(version.get("has_lyrics")) for row in songs for version in row.get("versions") or []),
        },
        "songs": songs,
    }
