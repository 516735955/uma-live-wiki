"""Recordings responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import lyrics as pipeline_lyrics


def track_id(url: str) -> str:
    match = pipeline_common.re.search(r"[?&]id=(\d+)", str(url or ""))
    return match.group(1) if match else ""


def normalized_name(value: str) -> str:
    return pipeline_common.re.sub(r"[\s　・･._\-]+", "", pipeline_common.unicodedata.normalize("NFKC", value or "").translate(pipeline_common.NAME_VARIANTS)).lower()


def version_recordings(songs: dict[str, pipeline_common.Any]) -> dict[str, dict[str, pipeline_common.Any]]:
    rows: dict[str, dict[str, pipeline_common.Any]] = {}
    for song in songs.get("songs") or []:
        for version in song.get("versions") or []:
            releases = []
            release_rows = []
            artists: list[str] = []
            for release in version.get("releases") or []:
                source_track = track_id(release.get("audio_url") or "")
                if source_track and source_track not in releases:
                    releases.append(source_track)
                release_rows.append({
                    "album_name": release.get("album_name") or "",
                    "catalog": release.get("catalog") or "",
                    "track_number": release.get("track_number"),
                    "duration": release.get("duration"),
                })
                for artist in pipeline_common.re.split(r"[、,，／/&＋+]", str(release.get("artist") or "")):
                    artist = pipeline_common.re.sub(r"[()（）]", " ", artist).strip()
                    if artist and artist not in artists:
                        artists.append(artist)
            rows[version["id"]] = {
                "version_id": version["id"],
                "song_id": song["id"],
                "song_title": song["title"],
                "version_title": version.get("title") or song["title"],
                "instrumental": bool(version.get("instrumental")) or bool(
                    pipeline_common.re.search(r"(?:off[ -]?vocal|instrumental)", " ".join([
                        str(version.get("title") or ""), str(version.get("version_label") or "")
                    ]), pipeline_common.re.I)
                ),
                "tracks": releases,
                "releases": release_rows,
                "artists": artists,
            }
    return rows


def clean_markup(value: str) -> str:
    text = pipeline_common.re.sub(r"<br\s*/?>", "\n", value or "", flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"<[^>]+>", "", text)
    return pipeline_common.html.unescape(text).replace("\xa0", " ").strip()


def catalog_key(value: str) -> str:
    return pipeline_common.re.sub(r"[^A-Z0-9]+", "", pipeline_common.unicodedata.normalize("NFKC", value or "").upper())


def match_recording_version(
    title: str,
    recordings: dict[str, dict[str, pipeline_common.Any]],
    release_name: str = "",
    track_number: int | None = None,
) -> str:
    title_key = folded_title(title)
    candidates = [row for row in recordings.values() if folded_title(row["version_title"]) == title_key]
    if len(candidates) == 1:
        return candidates[0]["version_id"]
    if release_name:
        release_key = folded_title(release_name)
        narrowed = []
        for row in candidates:
            for release in row.get("releases") or []:
                album_key = folded_title(str(release.get("album_name") or ""))
                same_release = release_key and (release_key == album_key or release_key in album_key or album_key in release_key)
                same_track = track_number is None or int(release.get("track_number") or 0) == track_number
                if same_release and same_track:
                    narrowed.append(row)
                    break
        candidates = narrowed
    return candidates[0]["version_id"] if len(candidates) == 1 else ""


def choose_candidate(recording: dict[str, pipeline_common.Any], fetched: dict[str, dict[str, pipeline_common.Any] | None]) -> tuple[str, list[dict[str, pipeline_common.Any]], list[dict[str, str]]]:
    best_track = ""
    best_lines: list[dict[str, pipeline_common.Any]] = []
    combined_credits: list[dict[str, str]] = []
    seen_credits: set[tuple[str, str]] = set()
    for source_track in recording["tracks"]:
        payload = fetched.get(source_track) or {}
        raw = ((payload.get("lrc") or {}).get("lyric") or "") if isinstance(payload, dict) else ""
        lines, credits = pipeline_lyrics.parse_lyric(raw)
        for credit in credits:
            key = (credit["role"], normalized_name(credit["name"]))
            if key not in seen_credits:
                combined_credits.append(credit)
                seen_credits.add(key)
        if len(lines) > len(best_lines):
            best_track = source_track
            best_lines = lines
    combined_credits.sort(key=lambda row: (pipeline_common.ROLE_ORDER.get(row["role"], 99), normalized_name(row["name"])))
    return best_track, best_lines, combined_credits


def folded_title(value: str) -> str:
    text = pipeline_common.unicodedata.normalize("NFKC", pipeline_common.html.unescape(value or ""))
    text = pipeline_common.re.sub(r"[（(][^）)]*(?:主題歌|テーマ|挿入歌)[^）)]*[）)]", "", text, flags=pipeline_common.re.I)
    return pipeline_common.re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龯]+", "", text.lower())
