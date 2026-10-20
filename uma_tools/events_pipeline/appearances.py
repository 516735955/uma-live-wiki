"""Appearances responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import identities as pipeline_identities


def build_appearance_index(events: list[dict[str, pipeline_common.Any]], songs_catalog: dict[str, pipeline_common.Any], identities: pipeline_identities.IdentityIndex) -> dict[str, pipeline_common.Any]:
    voice: dict[str, dict[str, pipeline_common.Any]] = {}
    chars: dict[str, dict[str, pipeline_common.Any]] = {}
    unresolved = pipeline_common.Counter()
    for profile in identities.profiles:
        voice[profile["id"]] = {"events": [], "songs": {}, "performed_songs": {}}
    for char_id in identities.character_by_id:
        chars[char_id] = {"events": [], "songs": {}, "performed_songs": {}}

    def add_release(bucket: dict[str, pipeline_common.Any], song: dict[str, pipeline_common.Any], version_id: str, release: dict[str, pipeline_common.Any]) -> None:
        relation = bucket["songs"].setdefault(song["id"], {
            "song_id": song["id"], "name": song["title"], "album_ids": [],
            "release_ids": [], "version_ids": [],
        })
        relation["album_ids"].append(release.get("album_id") or "")
        relation["release_ids"].append(f"{release.get('album_id') or ''}:{release.get('track_number') or ''}")
        relation["version_ids"].append(version_id)

    for song in songs_catalog.get("songs") or []:
        for version in song.get("versions") or []:
            for release in version.get("releases") or []:
                for vocalist in release.get("vocalists") or []:
                    actor_id = vocalist.get("voice_actor_id") or ""
                    character_id = vocalist.get("character_id") or ""
                    if actor_id in voice:
                        add_release(voice[actor_id], song, version["id"], release)
                    if character_id in chars:
                        add_release(chars[character_id], song, version["id"], release)

    for event in events:
        if event.get("schedule_status") == "cancelled":
            continue
        voice_in_event: dict[str, set[str]] = pipeline_common.defaultdict(set)
        char_in_event: set[str] = set(event.get("character_ids") or [])
        cast_actor_by_character: dict[str, set[str]] = pipeline_common.defaultdict(set)
        for cast in event.get("cast") or []:
            actor_id = cast.get("voice_actor_id") or ""
            char_id = cast.get("character_id") or ""
            if actor_id:
                voice_in_event[actor_id].add(cast.get("evidence") or "")
            elif cast.get("person_type") == "unresolved":
                unresolved[cast.get("name") or "（空）"] += 1
            if char_id:
                char_in_event.add(char_id)
                if actor_id:
                    cast_actor_by_character[char_id].add(actor_id)
        event_songs: dict[str, dict[str, dict[str, pipeline_common.Any]]] = pipeline_common.defaultdict(dict)
        actor_songs: dict[str, dict[str, dict[str, pipeline_common.Any]]] = pipeline_common.defaultdict(dict)
        session_appearances: list[tuple[dict[str, pipeline_common.Any], set[str], dict[str, set[str]]]] = []
        for session in event.get("sessions") or []:
            if session.get("schedule_status") == "cancelled":
                continue
            session_chars = set(session.get("character_ids") or [])
            session_voice: dict[str, set[str]] = pipeline_common.defaultdict(set)
            scoped_actors: dict[str, set[str]] = pipeline_common.defaultdict(set)
            for cast in session.get("cast") or []:
                actor_id = cast.get("voice_actor_id") or ""
                char_id = cast.get("character_id") or ""
                if actor_id:
                    session_voice[actor_id].add(cast.get("evidence") or "")
                if char_id:
                    session_chars.add(char_id)
                    if actor_id:
                        cast_actor_by_character[char_id].add(actor_id)
                        scoped_actors[char_id].add(actor_id)
            explicit_actors = set(session_voice)

            def actors_for_character(char_id):
                character = identities.character_by_id.get(char_id) or {}
                actor_ids = scoped_actors.get(char_id) or (cast_actor_by_character.get(char_id) if 'cast' not in session else set()) or set()
                if not actor_ids and not character.get('cv_former'):
                    current_actor = identities.voice_id(character.get('cv') or character.get('cv_zh') or '')
                    if current_actor:
                        actor_ids = {current_actor}
                # A credited character in a video or song table does not prove
                # that its current voice actor attended this specific session.
                return actor_ids & explicit_actors if 'cast' in session else actor_ids
            char_in_event.update(session_chars)
            performance_ids_seen: dict[str, int] = {}
            for performance_index, performance in enumerate(session.get("performances") or []):
                song = performance.get("song_title") or performance.get("song") or ""
                song_id = performance.get("song_id") or ""
                version_id = performance.get("version_id") or ""
                if not song or not song_id:
                    continue
                performance_chars = set(performance.get("character_ids") or [])
                # A return/encore can legitimately reuse the same song and
                # recording in one session.  Keep the old compact identity for
                # the first occurrence and add a stable ordinal only when the
                # same key repeats, so existing links remain unchanged while
                # every row remains addressable.
                performance_base = f"{session.get('id') or event['id']}:{version_id}"
                occurrence = performance_ids_seen.get(performance_base, 0) + 1
                performance_ids_seen[performance_base] = occurrence
                performance_identity = performance_base if occurrence == 1 else f"{performance_base}:{occurrence}"
                performance.setdefault("id", performance_identity)
                for char_id in performance_chars:
                    relation = event_songs[char_id].setdefault(song_id, {
                        "song_id": song_id, "name": song, "event_ids": [], "performance_ids": [], "version_ids": [],
                    })
                    relation["event_ids"].append(event["id"])
                    relation["performance_ids"].append(performance_identity)
                    relation["version_ids"].append(version_id)
                actor_ids = set(performance.get('voice_actor_ids') or [])
                for char_id in performance_chars:
                    actor_ids.update(actors_for_character(char_id))
                for actor_id in actor_ids:
                    voice_in_event[actor_id].add("setlist_performer")
                    session_voice[actor_id].add("setlist_performer")
                    relation = actor_songs[actor_id].setdefault(song_id, {
                        'song_id': song_id, 'name': song, 'event_ids': [], 'performance_ids': [], 'version_ids': []})
                    relation['event_ids'].append(event['id'])
                    relation['performance_ids'].append(performance_identity)
                    relation['version_ids'].append(version_id)
            for char_id in session_chars:
                actor_ids = actors_for_character(char_id)
                for actor_id in actor_ids:
                    session_voice[actor_id].update(voice_in_event.get(actor_id) or {"canonical_character_cast"})
            if session_chars or session_voice:
                session_appearances.append((session, session_chars, session_voice))
        base = {"event_id": event["id"], "date": event.get("date") or "", "end_date": event.get("end_date") or "", "title": event.get("title") or "", "kind": event.get("kind") or "", "series_id": event.get("series_id") or ""}
        covered_actors: set[str] = set()
        covered_characters: set[str] = set()
        for session, session_chars, session_voice in session_appearances:
            session_base = {
                **base,
                "date": session.get("date") or base["date"],
                "end_date": session.get("date") or base["date"],
                "session_id": session.get("id") or "",
                "session_label": session.get("label") or "",
            }
            for actor_id, evidence in session_voice.items():
                if actor_id not in voice:
                    continue
                voice[actor_id]["events"].append({
                    **session_base,
                    "evidence": sorted(item for item in evidence if item),
                    **({'participation_label': ' · '.join(dict.fromkeys(item['participation_label'] for item in session.get('cast', [])
                        if item.get('voice_actor_id') == actor_id and item.get('participation_label')))}
                       if any(item.get('voice_actor_id') == actor_id and item.get('participation_label') for item in session.get('cast', [])) else {}),
                })
                covered_actors.add(actor_id)
            for char_id in session_chars:
                if char_id not in chars:
                    continue
                chars[char_id]["events"].append(session_base)
                covered_characters.add(char_id)

        for actor_id, evidence in voice_in_event.items():
            if actor_id in covered_actors:
                continue
            if actor_id not in voice:
                continue
            voice[actor_id]["events"].append({**base, "evidence": sorted(item for item in evidence if item)})
        for char_id in char_in_event:
            if char_id in covered_characters:
                continue
            if char_id not in chars:
                continue
            chars[char_id]["events"].append(base)
        for char_id, songs in event_songs.items():
            if char_id not in chars:
                continue
            for song_id, relation in songs.items():
                char_relation = chars[char_id]["performed_songs"].setdefault(song_id, {
                    "song_id": song_id, "name": relation["name"], "event_ids": [], "performance_ids": [], "version_ids": [],
                })
                for key in ("event_ids", "performance_ids", "version_ids"):
                    char_relation[key].extend(relation[key])
        for actor_id, songs in actor_songs.items():
            if actor_id not in voice:
                continue
            for song_id, relation in songs.items():
                actor_relation = voice[actor_id]["performed_songs"].setdefault(song_id, {
                    "song_id": song_id, "name": relation["name"], "event_ids": [], "performance_ids": [], "version_ids": []})
                for key in ("event_ids", "performance_ids", "version_ids"):
                    actor_relation[key].extend(relation[key])
    for bucket in (voice, chars):
        for value in bucket.values():
            value["events"].sort(key=lambda row: (row.get("date") or "0000-00-00", row["event_id"]), reverse=True)
            value["songs"] = [
                {
                    "song_id": relation["song_id"], "name": relation["name"],
                    "album_ids": list(dict.fromkeys(item for item in relation["album_ids"] if item)),
                    "version_ids": list(dict.fromkeys(relation["version_ids"])),
                    "releases": len(set(item for item in relation["release_ids"] if item)),
                }
                for relation in sorted(value["songs"].values(), key=lambda row: row["name"])
            ]
            value["performed_songs"] = [
                {
                    "song_id": relation["song_id"], "name": relation["name"],
                    "event_ids": list(dict.fromkeys(relation["event_ids"])),
                    "version_ids": list(dict.fromkeys(relation["version_ids"])),
                    "performances": len(set(relation["performance_ids"])),
                }
                for relation in sorted(
                    value["performed_songs"].values(),
                    key=lambda row: (-len(set(row["performance_ids"])), row["name"]),
                )
            ]
    return {
        "schema_version": 3,
        "voice_actors": voice,
        "characters": chars,
        "unresolved_cast": [{"name": name, "events": count} for name, count in unresolved.most_common()],
    }


def enrich_profiles(profiles: list[dict[str, pipeline_common.Any]], appearance_index: dict[str, pipeline_common.Any]) -> list[dict[str, pipeline_common.Any]]:
    for profile in profiles:
        history = appearance_index["voice_actors"].get(profile["id"], {"events": [], "songs": []})
        profile["stats"] = {
            "events": len(history["events"]),
            "concerts": sum(1 for event in history["events"] if event["kind"] == "concert"),
            "programs": sum(1 for event in history["events"] if event["kind"] == "official_program"),
            "songs": len(history["songs"]),
        }
    return profiles
