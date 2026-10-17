"""Validation responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import identities as pipeline_identities
from . import text as pipeline_text


def validate(
    catalog: dict[str, pipeline_common.Any],
    songs_catalog: dict[str, pipeline_common.Any],
    creators_catalog: dict[str, pipeline_common.Any],
    appearances: dict[str, pipeline_common.Any],
    profiles: list[dict[str, pipeline_common.Any]],
) -> list[str]:
    errors: list[str] = []
    build_ids = {catalog.get("build_id"), songs_catalog.get("build_id"), creators_catalog.get("build_id"), appearances.get("build_id")}
    if len(build_ids) != 1 or not next(iter(build_ids), ""):
        errors.append("catalog documents do not share one build ID")
    event_ids = [event.get("id") for event in catalog.get("events") or []]
    event_id_set = set(event_ids)
    if len(event_ids) != len(set(event_ids)):
        errors.append("duplicate event IDs")
    actor_ids = [profile.get("id") for profile in profiles]
    if len(actor_ids) != len(set(actor_ids)):
        errors.append("duplicate voice actor IDs")
    known_actors = set(actor_ids)
    known_characters = set(appearances.get("characters") or {})
    current_voice_by_character: dict[str, list[str]] = pipeline_common.defaultdict(list)
    characters_by_voice: dict[str, set[str]] = pipeline_common.defaultdict(set)
    character_optional_actors: set[str] = set()
    for profile in profiles:
        roles = [role for role in profile.get("roles") or [] if role.get("character_id")]
        participation = (appearances.get("voice_actors") or {}).get(profile.get("id"), {})
        if not roles and (profile.get("anime_credit_sources") or participation.get("events") or participation.get("songs")):
            character_optional_actors.add(str(profile.get("id") or ""))
        if not roles and str(profile.get("id") or "") not in character_optional_actors:
            errors.append(f"voice actor {profile.get('id')} has no character or documented participation")
        elif profile.get("id"):
            characters_by_voice[str(profile["id"])].update(str(role["character_id"]) for role in roles)
        current_roles = [role for role in profile.get("roles") or [] if not role.get("former")]
        for role in current_roles:
            current_voice_by_character[str(role.get("character_id") or "")].append(str(profile.get("id") or ""))
    for character_id in known_characters:
        owners = current_voice_by_character.get(character_id) or []
        if len(owners) != 1:
            errors.append(f"character {character_id} has {len(owners)} current voice actors")
    song_ids = [song.get("id") for song in songs_catalog.get("songs") or []]
    known_songs = set(song_ids)
    version_ids = [
        version.get("id")
        for song in songs_catalog.get("songs") or []
        for version in song.get("versions") or []
    ]
    known_versions = set(version_ids)
    versions_by_song = {song.get('id'): {version.get('id') for version in song.get('versions') or []}
                        for song in songs_catalog.get('songs') or []}
    if len(song_ids) != len(known_songs):
        errors.append("duplicate song IDs")
    if len(version_ids) != len(known_versions):
        errors.append("duplicate song version IDs")
    creator_ids = [creator.get("id") for creator in creators_catalog.get("creators") or []]
    known_creators = set(creator_ids)
    if len(creator_ids) != len(known_creators):
        errors.append("duplicate creator IDs")
    for song in songs_catalog.get("songs") or []:
        if song.get("original_version_id") not in {version.get("id") for version in song.get("versions") or []}:
            errors.append(f"song {song.get('id')} has an invalid original version")
        for version in song.get("versions") or []:
            if version.get("instrumental") and version.get("has_lyrics"):
                errors.append(f"instrumental version {version.get('id')} publishes lyrics")
            for credit in version.get("credits") or []:
                if credit.get("creator_id") not in known_creators:
                    errors.append(f"version {version.get('id')} references unknown creator {credit.get('creator_id')}")
    for creator in creators_catalog.get("creators") or []:
        for work in creator.get("works") or []:
            if work.get("song_id") not in known_songs:
                errors.append(f"creator {creator.get('id')} references unknown song {work.get('song_id')}")
            for version_id in work.get("version_ids") or []:
                if version_id not in known_versions:
                    errors.append(f"creator {creator.get('id')} references unknown version {version_id}")
        for collaborator in creator.get("collaborators") or []:
            if collaborator.get("creator_id") not in known_creators:
                errors.append(f"creator {creator.get('id')} references unknown collaborator {collaborator.get('creator_id')}")
    semantic_events: dict[tuple[str, str], list[str]] = pipeline_common.defaultdict(list)
    all_session_ids: list[str] = []
    for event in catalog.get("events") or []:
        if not event.get("title"):
            errors.append(f"event {event.get('id')} has no title")
        if not event.get("image"):
            errors.append(f"event {event.get('id')} has no visible cover")
        normalized_title = pipeline_common.re.sub(r"[\W_]+", "", pipeline_common.unicodedata.normalize("NFKC", event.get("title") or "").lower())
        semantic_events[(event.get("date") or "", normalized_title)].append(event.get("id") or "")
        if not event.get("date") and event.get("schedule_status") != "announced_tba":
            errors.append(f"event {event.get('id')} has no date without an announced-TBA status")
        if event.get("date"):
            try:
                pipeline_common.dt.date.fromisoformat(event["date"])
            except (TypeError, ValueError):
                errors.append(f"event {event.get('id')} has invalid date {event.get('date')}")
        sources = event.get("sources") or []
        if not sources:
            errors.append(f"event {event.get('id')} has no evidence source")
        source_keys = [(source.get("kind"), source.get("url")) for source in sources]
        if len(source_keys) != len(set(source_keys)):
            errors.append(f"event {event.get('id')} has duplicate evidence sources")
        if any(not source.get("url") for source in sources):
            errors.append(f"event {event.get('id')} has a source without URL")
        cast_status = event.get("cast_status")
        if cast_status not in ("verified", "partial", "character_only", "announced_tba"):
            errors.append(f"event {event.get('id')} has unsupported cast status {cast_status}")
        if cast_status == "verified" and not event.get("cast"):
            errors.append(f"event {event.get('id')} is verified without cast")
        if cast_status == "character_only" and (event.get("cast") or not event.get("character_ids")):
            errors.append(f"event {event.get('id')} has inconsistent character-only cast")
        cast_keys = []
        for cast in event.get("cast") or []:
            person_type = cast.get("person_type")
            if person_type != "voice_actor":
                errors.append(f"event {event['id']} publishes non-Uma cast {cast.get('name')}")
            if not cast.get("voice_actor_id"):
                errors.append(f"event {event['id']} has cast without voice-actor identity {cast.get('name')}")
            if not cast.get("character_id") and cast.get("voice_actor_id") not in character_optional_actors:
                errors.append(f"event {event['id']} has cast without canonical character {cast.get('name')}")
            if cast.get("voice_actor_id") and cast["voice_actor_id"] not in known_actors:
                errors.append(f"event {event['id']} references unknown actor {cast['voice_actor_id']}")
            if cast.get("character_id") and cast["character_id"] not in known_characters:
                errors.append(f"event {event['id']} references unknown character {cast['character_id']}")
            if cast.get("voice_actor_id") and cast.get("character_id") and cast["character_id"] not in characters_by_voice.get(str(cast["voice_actor_id"]), set()):
                errors.append(
                    f"event {event['id']} maps actor {cast['voice_actor_id']} to noncanonical character {cast.get('character_id')}"
                )
            cast_keys.append(pipeline_identities.cast_relation_key(cast))
        if len(cast_keys) != len(set(cast_keys)):
            errors.append(f"event {event.get('id')} has duplicate cast relationships")
        for character_id in event.get("character_ids") or []:
            if character_id not in known_characters:
                errors.append(f"event {event['id']} references unknown character {character_id}")
        session_sources: set[tuple[str, str, str]] = set()
        for session in event.get("sessions") or []:
            all_session_ids.append(session.get("id") or "")
            if not session.get("id") or not session.get("label"):
                errors.append(f"event {event['id']} has a session without stable ID or label")
            if not session.get("date") and event.get("schedule_status") != "announced_tba":
                errors.append(f"session {session.get('id')} has no date without an announced-TBA status")
            if session.get("setlist_source"):
                source_key = (
                    str(session.get("label") or ""),
                    str(session.get("date") or ""),
                    pipeline_common.json.dumps(session["setlist_source"], ensure_ascii=False, sort_keys=True),
                )
                if source_key in session_sources:
                    errors.append(f"event {event['id']} repeats setlist source for {session.get('label')}")
                session_sources.add(source_key)
                if not session.get("setlist_html"):
                    errors.append(f"session {session.get('id')} has a curated source without its exact setlist HTML")
            elif session.get("songs") or session.get("performances"):
                errors.append(f"session {session.get('id')} has songs outside the curated setlist source")
            elif session.get("setlist_html"):
                errors.append(f"session {session.get('id')} has setlist HTML outside the curated setlist source")
            expected_setlist_status = "verified" if session.get("setlist_source") else "none"
            if session.get("setlist_status") != expected_setlist_status:
                errors.append(f"session {session.get('id')} has inconsistent setlist status")
            for character_id in session.get("character_ids") or []:
                if character_id not in known_characters:
                    errors.append(f"session {session.get('id')} references unknown character {character_id}")
            for performance in session.get("performances") or []:
                if performance.get("song_id") not in known_songs:
                    errors.append(f"session {session.get('id')} references unknown song {performance.get('song_id')}")
                if performance.get("version_id") not in known_versions:
                    errors.append(f"session {session.get('id')} references unknown song version {performance.get('version_id')}")
                elif performance.get('version_id') not in versions_by_song.get(performance.get('song_id'), set()):
                    errors.append(f"session {session.get('id')} references a version belonging to a different song")
    for semantic_key, matching_ids in semantic_events.items():
        if semantic_key[1] and len(matching_ids) > 1:
            errors.append(f"duplicate event identity {semantic_key}: {', '.join(matching_ids)}")
    if len(all_session_ids) != len(set(all_session_ids)):
        errors.append("duplicate or empty session IDs")
    if appearances.get("unresolved_cast"):
        errors.append("appearance index contains unresolved cast")
    for actor_id, value in (appearances.get("voice_actors") or {}).items():
        if actor_id not in known_actors:
            errors.append(f"appearance index has unknown actor {actor_id}")
        for row in value.get("events") or []:
            if row.get("event_id") not in event_id_set:
                errors.append(f"actor {actor_id} references unknown event {row.get('event_id')}")
        for row in value.get("songs") or []:
            if row.get("song_id") not in known_songs:
                errors.append(f"actor {actor_id} references unknown song {row.get('song_id')}")
    for character_id, value in (appearances.get("characters") or {}).items():
        for row in value.get("songs") or []:
            if row.get("song_id") not in known_songs:
                errors.append(f"character {character_id} references unknown song {row.get('song_id')}")
    identity_owners: dict[str, str] = {}
    allowed_field_statuses = {"verified", "not_published", "not_applicable", "source_unavailable"}
    for profile in profiles:
        identity = profile.get("identity") or {}
        for name in (identity.get("zh"), identity.get("ja"), *(identity.get("aliases") or [])):
            if not name:
                continue
            folded = pipeline_text.fold_name(str(name))
            owner = identity_owners.setdefault(folded, profile.get("id") or "")
            if owner != profile.get("id"):
                errors.append(f"voice actor identity {name} belongs to both {owner} and {profile.get('id')}")
        details = profile.get("profile") or {}
        if not details.get("sources") and details.get("status") != "source_unavailable":
            errors.append(f"voice actor {profile.get('id')} has no profile source")
        field_status = details.get("field_status") or {}
        for field in ("birthday", "birthplace", "agency", "official_profile"):
            status = field_status.get(field)
            if status not in allowed_field_statuses:
                errors.append(f"voice actor {profile.get('id')} has unaccounted {field}: {status}")
            if status == "verified" and not details.get(field):
                errors.append(f"voice actor {profile.get('id')} marks empty {field} verified")
    for series_id, baseline in pipeline_common.REGULAR_PROGRAM_BASELINES.items():
        ids = {event.get("id") for event in catalog.get("events") or [] if event.get("series_id") == series_id}
        missing = [f"{series_id}-{number:03d}" for number in range(1, baseline + 1) if f"{series_id}-{number:03d}" not in ids]
        if missing:
            errors.append(f"series {series_id} is missing episodes: {', '.join(missing)}")
    for event_id in [*(f"official-special-abema-stakes-{number:02d}" for number in range(1, 7)), *(f"all-night-nippon-gold-{number:03d}" for number in range(1, 7))]:
        if event_id not in event_id_set:
            errors.append(f"required historical or announced program is missing: {event_id}")
    return errors
