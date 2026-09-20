#!/usr/bin/env python3
"""Build the unified event, music, appearance, and voice-actor indexes.

The two hand-curated live JSON files are immutable inputs. The normal command is
offline and deterministic apart from generated_at. Network discovery is an
explicit maintenance action:

    python3 uma_tools/update_events.py --refresh-programs
    python3 uma_tools/update_events.py --refresh-profiles
    python3 uma_tools/update_events.py --refresh-all
    python3 uma_tools/update_events.py
    python3 uma_tools/update_events.py --check
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
DATA_DIR = ROOT / "data"
EVENTS_DIR = DATA_DIR / "events"
PROGRAM_REFRESH_REPORT = EVENTS_DIR / "program_refresh_report.json"
OFFICIAL_CHANNEL_ID = "UCAWxPGGuIfWME2KTLUmSCHw"
REGULAR_PROGRAM_BASELINES = {"paka-live-tv": 62, "paka-live-tv-prime": 6, "sokosoko-paka-live-tv": 55}
PROGRAM_SOURCE_PRIORITY = {
    "community_archive": 1,
    "official_broadcaster": 2,
    "official_announcement": 3,
    "official_youtube": 4,
}
PAKALIVE_ARCHIVE_PAGES = {
    "paka-live-tv": "https://umamusu.wiki/PakaLive_TV",
    "paka-live-tv-prime": "https://umamusu.wiki/PakaLive_TV_Dash",
}
ANN_PROGRAM_URL = "https://www.allnightnippon.com/umamusume/"
VOICE_DETAILS_FILE = EVENTS_DIR / "voice_actor_details.json"
VOICE_IDENTITIES_FILE = EVENTS_DIR / "voice_actor_identities.json"
IMMUTABLE_LIVE_FILES = (DATA_DIR / "live_data.json", DATA_DIR / "live_cat_data.json")
OUTPUT_FILES = {
    "catalog": DATA_DIR / "events_catalog.json",
    "songs": DATA_DIR / "song_catalog.json",
    "appearances": DATA_DIR / "appearance_index.json",
    "profiles": DATA_DIR / "voice_actor_profiles.json",
    "manifest": DATA_DIR / "catalog_manifest.json",
}

EVENT_COVER_BY_KIND = {
    "concert": "/uma_tools/img/event-covers/concert.svg",
    "official_program": "/uma_tools/img/event-covers/official-program.svg",
    "onsite": "/uma_tools/img/event-covers/onsite.svg",
}
NUMBERED_EVENT_COVERS = {
    "1st-event": "/uma_tools/img/event-covers/numbered/1st.png",
    "2nd-event": "/uma_tools/img/event-covers/numbered/2nd.png",
    "3rd-event": "/uma_tools/img/event-covers/numbered/3rd.png",
    "4th-event-extra": "/uma_tools/img/event-covers/numbered/4th-extra.png",
    "4th-event": "/uma_tools/img/event-covers/numbered/4th.png",
    "5th-event": "/uma_tools/img/event-covers/numbered/5th.png",
    "6th-event": "/uma_tools/img/event-covers/numbered/6th.png",
    "7th-event": "/uma_tools/img/event-covers/numbered/7th.png",
}

VFOLD = str.maketrans({"髙": "高", "﨑": "崎", "祥": "祥", "塚": "塚", "濱": "浜", "諸": "諸"})
DATE_RE = re.compile(r"(20\d{2})[.年/-](\d{1,2})[.月/-](\d{1,2})")
SONG_RE = re.compile(r'<td class="setlist-song">([\s\S]*?)</td>')
PERFORMER_RE = re.compile(r'<span class="perf-name">([\s\S]*?)</span>')
GUEST_PERFORMER_RE = re.compile(
    r'<span\b[^>]*class=["\'][^"\']*\bguest-performer\b[^"\']*["\'][^>]*>([\s\S]*?)</span>',
    re.I,
)
ROW_RE = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.I)
HTML_TAG_RE = re.compile(r"<[^>]+>")
EVENTERNOTE_ID_RE = re.compile(r"/events/id/(\d+)")
MEDIA_URL_RE = re.compile(r'https?://[^\s<>"\'\]\[）)]+', re.I)
CAST_LINE_RE = re.compile(
    r'<div\b[^>]*class=["\'][^"\']*\bcast-line\b[^"\']*["\'][^>]*>([\s\S]*?)</div>', re.I
)
CAST_LABEL_RE = re.compile(
    r'<span\b[^>]*class=["\'][^"\']*\bcast-label\b[^"\']*["\'][^>]*>([\s\S]*?)</span>', re.I
)
FULL_CAST_RE = re.compile(r"(?:全员|全員)")
NON_PERFORMER_CAST_LABEL_RE = re.compile(r"实况|實況|嘉宾|ゲスト|向导|案内|解说|解説|司会|MC", re.I)


def curated_media(items: Iterable[list[Any] | tuple[Any, ...]]) -> list[dict[str, str]]:
    """Turn hand-curated video cells into one card per usable URL.

    Some legacy cells contain separate upper/lower-part links and editorial text
    on multiple lines. The catalog stores only complete URLs so the frontend
    never has to interpret source formatting or offer a broken media card.
    """

    media: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if not item:
            continue
        raw = str(item[0] or "")
        base_label = str(item[1] if len(item) > 1 else "视频").strip() or "视频"
        for line in raw.splitlines() or [raw]:
            part = re.sub(r"[：:\s]+$", "", line.split("http", 1)[0]).strip()
            for match in MEDIA_URL_RE.finditer(line):
                url = match.group(0).rstrip(".,，。；;")
                parsed = urllib.parse.urlparse(url)
                if parsed.scheme not in {"http", "https"} or not parsed.hostname or "." not in parsed.hostname:
                    continue
                if url in seen:
                    continue
                seen.add(url)
                label = f"{base_label} · {part}" if part else base_label
                media.append({"url": url, "label": label})
    return media
SONG_VERSION_HINT_RE = re.compile(
    r"(?:ver(?:sion)?\.?|size|remaster|remix|mix|off[ -]?vocal|instrumental|"
    r"acoustic|symphonic|revision|arrange|edit|solo|feat\.|short|long|game|tv|"
    r"anime|pv|mv|舞台|剧中|劇中|歌词版|歌詞版|アドリブ|メロ)",
    re.I,
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_window_data(path: Path, global_name: str) -> Any:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"window\." + re.escape(global_name) + r"\s*=\s*([\[{][\s\S]*[\]}])\s*;\s*$", source)
    if not match:
        raise ValueError(f"{global_name} not found in {path}")
    return json.loads(match.group(1))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(HTML_TAG_RE.sub("", str(value or "")))).strip()


def concise_program_summary(value: Any, limit: int = 300) -> str:
    """Keep the editorial introduction and discard channel-wide YouTube boilerplate."""
    text = clean_text(value)
    if not text:
        return ""
    text = re.split(
        r"\s+(?:https?://|[-+]{5,}|チャンネル登録はこちら|"
        r"【ウマ娘 プリティーダービー(?:公式| 公式)|【ぱかチューブっ！公式)",
        text,
        maxsplit=1,
    )[0].strip()
    if len(text) <= limit:
        return text
    shortened = text[:limit].rstrip()
    sentence_end = max(shortened.rfind("。"), shortened.rfind("！"), shortened.rfind("？"))
    return shortened[: sentence_end + 1] if sentence_end >= limit // 2 else shortened + "……"


def fold_name(value: str) -> str:
    return unicodedata.normalize("NFKC", value or "").translate(VFOLD).replace(" ", "").strip()


def first_date(value: Any) -> str:
    match = DATE_RE.search(str(value or ""))
    if not match:
        return ""
    try:
        return dt.date(*(int(part) for part in match.groups())).isoformat()
    except ValueError:
        return ""


def all_dates(value: Any) -> list[str]:
    current_year = None
    out = []
    for match in re.finditer(r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日", str(value or "")):
        if match.group(1):
            current_year = int(match.group(1))
        if current_year is None:
            continue
        try:
            parsed = dt.date(current_year, int(match.group(2)), int(match.group(3))).isoformat()
        except ValueError:
            continue
        if parsed not in out:
            out.append(parsed)
    return out


def event_date_for_day(value: Any, offset: int) -> str:
    base = first_date(value)
    if not base:
        return ""
    try:
        return (dt.date.fromisoformat(base) + dt.timedelta(days=offset)).isoformat()
    except ValueError:
        return base


def venue_from_date_text(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^20\d{2}[./-]\d{1,2}[./-]\d{1,2}(?:\s*[-–—]\s*\d{1,2})?\s*", "", text)
    return text.strip(" -–—./")


def clean_song(raw: str) -> str:
    value = clean_text(raw)
    if not value or value == "安可" or "曲名不明" in value or re.fullmatch(r"MC\d*", value, re.I):
        return ""
    value = value.replace("\ufe0e", "").replace("\ufe0f", "")
    value = re.sub(r"\s+([!?！？。、,.])", r"\1", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def table_songs(table: str) -> list[str]:
    return [song for song in (clean_song(match.group(1)) for match in SONG_RE.finditer(table or "")) if song]


def table_characters(table: str) -> list[str]:
    return list(dict.fromkeys(clean_text(match.group(1)) for match in PERFORMER_RE.finditer(table or "") if clean_text(match.group(1))))


def table_performances(
    table: str,
    identities: "IdentityIndex",
    full_cast_character_ids: Iterable[str] = (),
) -> list[dict[str, Any]]:
    performances = []
    full_cast = list(dict.fromkeys(character_id for character_id in full_cast_character_ids if character_id))
    for row_match in ROW_RE.finditer(table or ""):
        row = row_match.group(1)
        song_match = SONG_RE.search(row)
        if not song_match:
            continue
        song = clean_song(song_match.group(1))
        if not song:
            continue
        character_ids = []
        for name in table_characters(row):
            character_id = identities.character_id(name)
            if character_id and character_id not in character_ids:
                character_ids.append(character_id)
        if FULL_CAST_RE.search(clean_text(row)):
            character_ids = list(dict.fromkeys([*full_cast, *character_ids]))
        performance = {"song": song, "character_ids": character_ids}
        guest_performers = list(dict.fromkeys(
            clean_text(match.group(1))
            for match in GUEST_PERFORMER_RE.finditer(row)
            if clean_text(match.group(1))
        ))
        if guest_performers:
            performance["guest_performers"] = guest_performers
        performances.append(performance)
    return performances


def fold_song_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", clean_song(value)).lower()
    normalized = normalized.replace("’", "'").replace("‘", "'").replace("・", "·")
    return re.sub(r"\s+", "", normalized)


def pop_trailing_song_group(value: str) -> tuple[str, str] | None:
    """Return the final balanced ASCII/full-width parenthetical group."""
    text = value.strip()
    if not text or text[-1] not in ")）":
        return None
    closing = text[-1]
    opening = "(" if closing == ")" else "（"
    depth = 0
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        if char == closing:
            depth += 1
        elif char == opening:
            depth -= 1
            if depth == 0:
                candidate = text[:index].strip()
                label = text[index + 1:-1].strip()
                return (candidate, label) if candidate and label else None
    return None


def split_song_version(title: str, identities: "IdentityIndex", known_titles: set[str]) -> tuple[str, str]:
    """Split only explicit version/performer suffixes; preserve ambiguous title text."""
    base = clean_song(title)
    labels: list[str] = []
    while base:
        bracket_match = re.match(r"^(.*?)\s*\[([^\[\]]+)\]\s*$", base)
        if (
            bracket_match
            and bracket_match.group(1).strip()
            and (
                SONG_VERSION_HINT_RE.search(bracket_match.group(2))
                or SONG_VERSION_HINT_RE.search(bracket_match.group(1))
                or fold_song_key(bracket_match.group(1)) in known_titles
            )
        ):
            base = bracket_match.group(1).strip()
            labels.insert(0, bracket_match.group(2).strip())
            continue
        note_match = re.match(r"^(.*?)\s*※\s*(.+)$", base)
        if note_match and note_match.group(1).strip():
            base = note_match.group(1).strip()
            labels.insert(0, note_match.group(2).strip())
            continue
        dash_match = re.match(r"^(.*?)\s+[-‐‑–—―]\s*(.+?)\s*[-‐‑–—―]?\s*$", base)
        if (
            dash_match
            and dash_match.group(1).strip()
            and fold_song_key(dash_match.group(1)) in known_titles
            and SONG_VERSION_HINT_RE.search(dash_match.group(2))
        ):
            base = dash_match.group(1).strip()
            labels.insert(0, dash_match.group(2).strip())
            continue
        suffix = pop_trailing_song_group(base)
        if not suffix:
            break
        candidate, label = suffix
        character_id = identities.character_id(label)
        should_split = bool(
            SONG_VERSION_HINT_RE.search(label)
            or character_id
            or fold_song_key(candidate) in known_titles
        )
        if not should_split:
            break
        base = candidate
        labels.insert(0, f"角色独唱：{label}" if character_id else label)
    return base or clean_song(title), " / ".join(label for label in labels if label)


def stable_song_id(title: str) -> str:
    normalized = unicodedata.normalize("NFKC", title or "").strip()
    readable = stable_suffix(normalized)[:40]
    digest = hashlib.sha1(fold_song_key(normalized).encode("utf-8")).hexdigest()[:10]
    return "song-" + ((readable + "-") if readable else "") + digest


def stable_version_id(song_id: str, title: str) -> str:
    digest = hashlib.sha1(fold_song_key(title).encode("utf-8")).hexdigest()[:10]
    return f"{song_id}-v-{digest}"


def stable_album_id(album: dict[str, Any]) -> str:
    catalog = re.sub(r"[^a-z0-9]+", "-", str(album.get("catalog") or "").lower()).strip("-")
    if catalog:
        return "album-" + catalog
    title = str(album.get("name") or "")
    return "album-" + hashlib.sha1(fold_song_key(title).encode("utf-8")).hexdigest()[:12]


def is_instrumental_track(title: str, artist: str) -> bool:
    value = unicodedata.normalize("NFKC", f"{title} {artist}")
    return bool(re.search(r"(?:off[ -]?vocal|instrumental|inst\.?|纯音乐|伴奏)", value, re.I))


def release_vocalists(artist: str, identities: "IdentityIndex") -> list[dict[str, Any]]:
    """Resolve release credits once; pages never reinterpret artist strings."""
    credits: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in re.split(r"[、,，／/&＋+・]|\s{2,}", str(artist or "")):
        label = raw.strip()
        credited_actor = re.search(r"[（(]\s*CV[.:：]?\s*([^）)]+)[）)]", label, re.I)
        if credited_actor:
            label = credited_actor.group(1).strip()
        else:
            parenthetical = re.search(r"[（(]([^）)]+)[）)]", label)
            if parenthetical and identities.voice_id(parenthetical.group(1).strip()):
                label = parenthetical.group(1).strip()
        label = re.sub(r"^(?:CV[.:：]?\s*)", "", label, flags=re.I)
        if not label or re.search(r"^(?:声优剧|ドラマ|トーク|SE|BGM)$", label, re.I):
            continue
        actor_id = identities.voice_id(label)
        character_id = identities.current_character_id(actor_id) if actor_id else identities.character_id(label)
        if character_id and not actor_id:
            character = identities.character_by_id.get(character_id) or {}
            actor_id = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
        if not actor_id:
            continue
        character_id = character_id or identities.current_character_id(actor_id)
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
    albums: list[dict[str, Any]],
    events: list[dict[str, Any]],
    identities: "IdentityIndex",
    generated_at: str,
) -> dict[str, Any]:
    """Build one canonical work with explicit release/performance variants."""
    raw_titles = {
        fold_song_key(str(song.get("name") or ""))
        for album in albums
        for song in album.get("songs") or []
        if clean_song(str(song.get("name") or ""))
    }
    raw_titles.update(
        fold_song_key(str(performance.get("song") or ""))
        for event in events
        for session in event.get("sessions") or []
        for performance in session.get("performances") or []
        if clean_song(str(performance.get("song") or ""))
    )
    works: dict[str, dict[str, Any]] = {}

    def ensure_version(exact_title: str) -> tuple[dict[str, Any], dict[str, Any]]:
        title = clean_song(exact_title)
        base, version_label = split_song_version(title, identities, raw_titles)
        work_key = fold_song_key(base)
        work = works.setdefault(work_key, {
            "id": stable_song_id(base), "title": base, "aliases": set(), "artists": set(),
            "character_ids": set(), "voice_actor_ids": set(),
            "released_character_ids": set(), "released_voice_actor_ids": set(),
            "performed_character_ids": set(), "performed_voice_actor_ids": set(),
            "versions": {},
        })
        work["aliases"].add(title)
        version_key = fold_song_key(title)
        version = work["versions"].setdefault(version_key, {
            "id": stable_version_id(work["id"], title), "title": title,
            "version_label": version_label, "artists": set(), "releases": [], "performances": [],
        })
        return work, version

    for album in albums:
        album_id = stable_album_id(album)
        for track_number, track in enumerate(album.get("songs") or [], 1):
            if not clean_song(str(track.get("name") or "")):
                continue
            work, version = ensure_version(str(track.get("name") or ""))
            artist = str(track.get("artist") or "").strip()
            instrumental = is_instrumental_track(str(track.get("name") or ""), artist)
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
                "track_number": track_number, "artist": artist, "audio_url": track.get("url") or "", "image": track.get("pic") or "",
                "instrumental": instrumental, "vocalists": vocalists,
            }
            version["releases"].append(release)

    for event in events:
        for session in event.get("sessions") or []:
            actor_ids_by_character: dict[str, set[str]] = defaultdict(set)
            for cast in [*(event.get("cast") or []), *(session.get("cast") or [])]:
                if cast.get("character_id") and cast.get("voice_actor_id"):
                    actor_ids_by_character[cast["character_id"]].add(cast["voice_actor_id"])
            for performance_index, performance in enumerate(session.get("performances") or [], 1):
                title = str(performance.get("song") or "")
                if not clean_song(title):
                    continue
                work, version = ensure_version(title)
                performance["song_id"] = work["id"]
                performance["version_id"] = version["id"]
                performance["song_title"] = work["title"]
                character_ids = list(dict.fromkeys(performance.get("character_ids") or []))
                voice_actor_ids = set()
                for character_id in character_ids:
                    resolved = actor_ids_by_character.get(character_id) or set()
                    character = getattr(identities, "character_by_id", {}).get(character_id) or {}
                    if not resolved and not character.get("cv_former") and hasattr(identities, "voice_id"):
                        current_actor = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
                        if current_actor:
                            resolved = {current_actor}
                    voice_actor_ids.update(resolved)
                work["character_ids"].update(character_ids)
                work["voice_actor_ids"].update(voice_actor_ids)
                work["performed_character_ids"].update(character_ids)
                work["performed_voice_actor_ids"].update(voice_actor_ids)
                version["performances"].append({
                    "event_id": event.get("id") or "", "event_title": event.get("title") or "", "event_date": event.get("date") or "",
                    "kind": event.get("kind") or "", "series_id": event.get("series_id") or "",
                    "session_id": session.get("id") or "", "session_label": session.get("label") or "",
                    "session_date": session.get("date") or "", "performance_index": performance_index,
                    "character_ids": character_ids, "voice_actor_ids": sorted(voice_actor_ids),
                    **({"guest_performers": list(performance.get("guest_performers") or [])} if performance.get("guest_performers") else {}),
                    "event_url": f"/zh-Hans/events/{urllib.parse.quote(str(event.get('id') or ''))}?session={urllib.parse.quote(str(session.get('id') or ''))}",
                })

    songs = []
    for work in works.values():
        versions = []
        for version in work["versions"].values():
            releases = sorted(version["releases"], key=lambda row: (row["release_date"] or "9999-99-99", row["album_name"], row["track_number"]))
            performances = sorted(version["performances"], key=lambda row: (row["session_date"] or row["event_date"] or "0000-00-00", row["event_id"], row["session_id"]), reverse=True)
            versions.append({
                "id": version["id"], "title": version["title"], "version_label": version["version_label"],
                "artists": sorted(version["artists"]), "releases": releases, "performances": performances,
                "release_count": len(releases), "performance_count": len(performances),
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
        })
    songs.sort(key=lambda row: (fold_song_key(row["title"]), row["id"]))
    return {
        "schema_version": 1, "generated_at": generated_at,
        "coverage": {
            "songs": len(songs), "versions": sum(row["version_count"] for row in songs),
            "albums": len(albums),
            "release_tracks": sum(row["release_count"] for row in songs),
            "live_performances": sum(row["performance_count"] for row in songs),
        },
        "songs": songs,
    }


def parse_cast_text(value: str) -> list[dict[str, str]]:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<br\s*/?>", "、", text, flags=re.I)
    text = re.sub(r"</div>", "、", text, flags=re.I)
    text = clean_text(text)
    text = re.sub(r"^(出演者|出走者|ゲスト|嘉宾)[:：]\s*", "", text)
    out: list[dict[str, str]] = []
    for item in re.split(r"[、,，／/]|\s{2,}", text):
        item = item.strip(" ：:・")
        if not item:
            continue
        match = re.match(r"([^（(]+?)[（(]([^）)]+?)(?:役)?[）)]", item)
        if match:
            actor = match.group(1).strip()
            role = re.sub(r"役$", "", match.group(2).strip())
        else:
            actor = re.sub(r"^(MC|司会|実況)[:：]", "", item).strip()
            role = ""
        actor = re.sub(r"[【\[].*?[】\]]", "", actor).strip()
        actor = re.sub(r"^(?:(?:仅|僅)?\d+日|两日出演|出演|出走者|嘉宾|ゲスト|実況|实况|向导|司会|MC)[:：]\s*", "", actor).strip()
        if actor and len(actor) <= 30 and not re.search(r"全員|ほか|他\d|出演者", actor):
            out.append({"name": actor, "role": role})
    return out


def cast_characters_for_session(
    value: str,
    identities: "IdentityIndex",
    date_value: Any,
    day_index: int,
) -> list[str]:
    """Resolve the performing character cast for one day of a curated event."""
    lines = CAST_LINE_RE.findall(value or "") or [value or ""]
    session_date = event_date_for_day(date_value, day_index)
    session_day = dt.date.fromisoformat(session_date).day if session_date else 0
    character_ids = []
    for line in lines:
        label_match = CAST_LABEL_RE.search(line)
        label = clean_text(label_match.group(1)) if label_match else ""
        if label and NON_PERFORMER_CAST_LABEL_RE.search(label):
            continue
        day_match = re.search(r"(?:仅|僅)?(\d{1,2})日", label)
        if day_match and session_day and int(day_match.group(1)) != session_day:
            continue
        for item in parse_cast_text(line):
            character_id = identities.character_id(item.get("role") or "")
            if character_id and character_id not in character_ids:
                character_ids.append(character_id)
    return character_ids


def stable_suffix(value: str) -> str:
    ascii_words = re.findall(r"[A-Za-z0-9]+", unicodedata.normalize("NFKC", value or ""))
    text = "-".join(word.lower() for word in ascii_words[:8])
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:64]


def stable_title_suffix(value: str) -> str:
    readable = stable_suffix(value)
    if readable:
        return readable
    normalized = unicodedata.normalize("NFKC", value or "").strip()
    return "title-" + hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12] if normalized else ""


def unique_id(base: str, used: set[str]) -> str:
    candidate = re.sub(r"[^a-z0-9-]+", "-", base.lower()).strip("-")
    candidate = re.sub(r"-+", "-", candidate) or "event"
    if candidate not in used:
        used.add(candidate)
        return candidate
    number = 2
    while f"{candidate}-{number}" in used:
        number += 1
    candidate = f"{candidate}-{number}"
    used.add(candidate)
    return candidate


class IdentityIndex:
    def __init__(self, characters: list[dict[str, Any]], voice_list: list[dict[str, Any]], photos: dict[str, Any], overrides: dict[str, Any], identity_registry: dict[str, Any], details: dict[str, Any] | None = None):
        self.characters = characters
        self.voice_list = voice_list
        self.photos = photos
        self.overrides = overrides
        self.profile_details = details or {"records": []}
        self.non_voice_people = {
            fold_name(str(alias)): str(kind)
            for kind, aliases in (overrides.get("non_voice_people") or {}).items()
            for alias in aliases
        }
        self.voice_by_alias: dict[str, str] = {}
        self.character_by_alias: dict[str, str] = {}
        self.character_by_id = {str(item.get("id")): item for item in characters if item.get("id")}
        self._canonical_ids: dict[str, str] = {}
        registry_ids: set[str] = set()
        for item in identity_registry.get("voice_actors") or []:
            actor_id = str(item.get("id") or "")
            if not actor_id or actor_id in registry_ids:
                raise ValueError(f"invalid or duplicate canonical voice-actor ID: {actor_id!r}")
            registry_ids.add(actor_id)
            for name in item.get("names") or []:
                alias = fold_name(str(name))
                owner = self._canonical_ids.get(alias)
                if owner and owner != actor_id:
                    raise ValueError(f"voice-actor alias {name!r} belongs to both {owner} and {actor_id}")
                if alias:
                    self._canonical_ids[alias] = actor_id
        self.profiles = self._build_profiles()
        self.profile_by_id = {item["id"]: item for item in self.profiles}
        self.current_role_by_voice_id: dict[str, dict[str, Any]] = {}
        self.current_voice_by_character_id: dict[str, str] = {}
        for profile in self.profiles:
            current_roles = [
                role for role in profile.get("roles") or []
                if role.get("character_id") and not role.get("former")
            ]
            if len(current_roles) == 1:
                self.current_role_by_voice_id[profile["id"]] = current_roles[0]
                self.current_voice_by_character_id[current_roles[0]["character_id"]] = profile["id"]

    def _build_profiles(self) -> list[dict[str, Any]]:
        grouped: dict[str, dict[str, Any]] = {}
        alias_to_group: dict[str, str] = {}
        for row in self.voice_list:
            zh = str(row.get("zh") or "").strip()
            ja = str(row.get("ja") or "").strip()
            key = alias_to_group.get(fold_name(ja)) or alias_to_group.get(fold_name(zh)) or fold_name(ja or zh)
            if not key:
                continue
            grouped.setdefault(key, {"zh": zh or ja, "ja": ja or zh, "aliases": set(), "roles": []})
            grouped[key]["aliases"].update(name for name in (zh, ja) if name)
            for name in (zh, ja):
                if name:
                    alias_to_group[fold_name(name)] = key
        for row in self.overrides.get("additional_voice_actors") or []:
            zh = str(row.get("zh") or row.get("ja") or "").strip()
            ja = str(row.get("ja") or row.get("zh") or "").strip()
            aliases = [zh, ja, *(row.get("aliases") or [])]
            key = next((alias_to_group.get(fold_name(name)) for name in aliases if name and alias_to_group.get(fold_name(name))), "") or fold_name(ja or zh)
            if not key:
                continue
            record = grouped.setdefault(key, {"zh": zh or ja, "ja": ja or zh, "aliases": set(), "roles": []})
            record["aliases"].update(name for name in aliases if name)
            for name in aliases:
                if name:
                    alias_to_group[fold_name(name)] = key
            for role in row.get("roles") or []:
                record["roles"].append({
                    "character_id": str(role.get("character_id") or ""),
                    "name": str(role.get("name") or role.get("name_ja") or ""),
                    "name_ja": str(role.get("name_ja") or role.get("name") or ""),
                    "former": False,
                    "image": str(role.get("image") or ""),
                    "color_main": str(role.get("color_main") or ""),
                    "color_sub": str(role.get("color_sub") or ""),
                })
        for char in self.characters:
            current_ja = str(char.get("cv") or "").strip()
            current_zh = str(char.get("cv_zh") or current_ja).strip()
            for former, former_ja, is_former in (
                (current_zh, current_ja, False),
                (str(char.get("cv_former") or "").strip(), str(char.get("cv_former_ja") or "").strip(), True),
            ):
                if not former and not former_ja:
                    continue
                key = alias_to_group.get(fold_name(former_ja)) or alias_to_group.get(fold_name(former)) or fold_name(former_ja or former)
                record = grouped.setdefault(key, {"zh": former or former_ja, "ja": former_ja or former, "aliases": set(), "roles": []})
                record["aliases"].update(name for name in (former, former_ja) if name)
                for name in (former, former_ja):
                    if name:
                        alias_to_group[fold_name(name)] = key
                record["roles"].append({
                    "character_id": char.get("id", ""),
                    "name": char.get("role_zh") or char.get("zh") or "",
                    "name_ja": char.get("ja") or "",
                    "former": is_former,
                    "image": char.get("img") or "",
                    "color_main": char.get("main") or "",
                    "color_sub": char.get("sub") or "",
                })
                for char_name in (char.get("zh"), char.get("ja"), char.get("en"), char.get("role_zh")):
                    if char_name:
                        self.character_by_alias[fold_name(str(char_name))] = str(char.get("id"))

        used_ids = {value for value in self._canonical_ids.values() if value}
        assigned_ids: set[str] = set()
        profiles: list[dict[str, Any]] = []
        details_by_alias = {}
        for detail in self.profile_details.get("records") or []:
            for name in (detail.get("name_ja"), detail.get("name_zh"), *(detail.get("aliases") or [])):
                if name:
                    details_by_alias[fold_name(str(name))] = detail
        for key in sorted(grouped):
            record = grouped[key]
            actor_id = next((
                self._canonical_ids.get(fold_name(name))
                for name in (record["ja"], record["zh"], *record["aliases"])
                if self._canonical_ids.get(fold_name(name))
            ), "")
            if actor_id in assigned_ids:
                actor_id = ""
            if not actor_id:
                identity_key = fold_name(record["ja"] or record["zh"])
                actor_id = "va-auto-" + hashlib.sha1(identity_key.encode("utf-8")).hexdigest()[:12]
                if actor_id in used_ids:
                    raise ValueError(f"deterministic voice-actor ID collision for {record['ja'] or record['zh']}")
                used_ids.add(actor_id)
            assigned_ids.add(actor_id)
            aliases = sorted(set(record["aliases"]), key=lambda value: (value != record["zh"], value))
            detail = next((details_by_alias.get(fold_name(name)) for name in (record["ja"], record["zh"], *aliases) if details_by_alias.get(fold_name(name))), {})
            detail = dict(detail)
            photo = self.photos.get(record["zh"]) or self.photos.get(record["ja"]) or {}
            profile_patch = next(
                ((self.overrides.get("voice_actor_profile_overrides") or {}).get(name) for name in (record["ja"], record["zh"], *aliases) if (self.overrides.get("voice_actor_profile_overrides") or {}).get(name)),
                None,
            )
            if profile_patch:
                detail.update({field: value for field, value in profile_patch.items() if field != "sources"})
                detail["sources"] = list({
                    (source.get("kind"), source.get("url")): source
                    for source in [*detail.get("sources", []), *profile_patch.get("sources", [])]
                    if source.get("url")
                }.values())
                statuses = dict(detail.get("field_status") or {})
                for field in ("birthday", "birthplace", "agency", "official_profile"):
                    if profile_patch.get(field):
                        statuses[field] = "verified"
                detail["field_status"] = statuses
                detail["status"] = "complete"
            profiles.append({
                "id": actor_id,
                "slug": actor_id,
                "identity": {"zh": record["zh"], "ja": detail.get("name_ja") or record["ja"], "kana": detail.get("kana") or "", "aliases": aliases},
                "profile": {
                    "birthday": detail.get("birthday") or photo.get("birth") or "",
                    "birthplace": detail.get("birthplace") or "",
                    "agency": detail.get("agency") or "",
                    "official_profile": detail.get("official_profile") or "",
                    "social": detail.get("social") or [],
                    "field_status": detail.get("field_status") or {},
                    "sources": detail.get("sources") or [],
                    "status": detail.get("status") or "partial",
                },
                "photo": {
                    "url": photo.get("img") or detail.get("photo_url") or "",
                    "source_url": photo.get("page") or detail.get("photo_source_url") or "",
                    "source_title": photo.get("title") or detail.get("photo_source_title") or "",
                },
                "roles": sorted(record["roles"], key=lambda role: (role["former"], role["name"])),
            })
        profiles.sort(key=lambda item: item["id"])
        for profile in profiles:
            names = [profile["identity"]["zh"], profile["identity"]["ja"], *profile["identity"]["aliases"]]
            for name in names:
                if name:
                    self.voice_by_alias[fold_name(name)] = profile["id"]
        for alias, canonical in (self.overrides.get("voice_aliases") or {}).items():
            resolved = self.voice_by_alias.get(fold_name(str(canonical)))
            if resolved:
                self.voice_by_alias[fold_name(str(alias))] = resolved
        for alias, character_id in (self.overrides.get("character_aliases") or {}).items():
            if character_id in self.character_by_id:
                self.character_by_alias[fold_name(str(alias))] = str(character_id)
        return profiles

    def voice_id(self, value: str) -> str:
        text = re.sub(r"[【\[].*?[】\]]", "", str(value or "")).strip()
        text = re.sub(r"^(?:(?:仅|僅)?\d+日|两日出演|出演|出走者|嘉宾|ゲスト|実況|实况|向导|司会|MC)[:：]\s*", "", text).strip()
        text = re.split(r"[（(]", text, maxsplit=1)[0].strip()
        return self.voice_by_alias.get(fold_name(text), "")

    def character_id(self, value: str) -> str:
        text = re.sub(r"役$", "", str(value or "")).strip()
        return self.character_by_alias.get(fold_name(text), "")

    def current_character_id(self, voice_actor_id: str) -> str:
        current = str((self.current_role_by_voice_id.get(voice_actor_id) or {}).get("character_id") or "")
        if current:
            return current
        roles = [role for role in (self.profile_by_id.get(voice_actor_id) or {}).get("roles") or [] if role.get("character_id")]
        return str(roles[0]["character_id"]) if len(roles) == 1 else ""

    def current_voice_id(self, character_id: str) -> str:
        return self.current_voice_by_character_id.get(str(character_id or ""), "")

    def character_payload(self, character_id: str) -> dict[str, Any]:
        character = self.character_by_id.get(character_id) or {}
        return {
            "id": character_id,
            "name": character.get("zh") or "",
            "name_ja": character.get("ja") or "",
            "name_en": character.get("en") or "",
            "image": character.get("img") or "",
            "color_main": character.get("main") or "",
            "color_sub": character.get("sub") or "",
        }

    def characters_in_text(self, value: str) -> list[str]:
        folded = unicodedata.normalize("NFKC", value or "").translate(VFOLD).replace(" ", "")
        name_char = re.compile(r"[A-Za-z0-9ぁ-ゖァ-ヺー一-龯々〆ヵヶ]")
        boundary_particles = set("とでがはをの")
        matches = []
        for alias, character_id in self.character_by_alias.items():
            if len(alias) < 2 or alias not in folded:
                continue
            for found in re.finditer(re.escape(alias), folded):
                start, end = found.span()
                if len(alias) <= 4:
                    left = folded[start - 1] if start else ""
                    right = folded[end] if end < len(folded) else ""
                    left_ok = not left or not name_char.fullmatch(left) or left in boundary_particles
                    right_ok = not right or not name_char.fullmatch(right) or right in boundary_particles
                    if not (left_ok and right_ok):
                        continue
                matches.append((len(alias), start, end, character_id))
        matches.sort(reverse=True)
        chosen = []
        occupied: list[tuple[int, int]] = []
        for _, start, end, character_id in matches:
            if any(start < occupied_end and end > occupied_begin for occupied_begin, occupied_end in occupied):
                continue
            occupied.append((start, end))
            if character_id not in chosen:
                chosen.append(character_id)
        return chosen

    def non_voice_person_type(self, value: str) -> str:
        return self.non_voice_people.get(fold_name(value), "")


def cast_relation_key(item: dict[str, Any]) -> tuple[str, ...]:
    actor_id = str(item.get("voice_actor_id") or "")
    character_id = str(item.get("character_id") or "")
    if actor_id and character_id:
        return ("voice_character", actor_id, character_id)
    if actor_id:
        return ("voice_role", actor_id, fold_name(item.get("role") or ""))
    return (
        "person_role",
        str(item.get("person_type") or ""),
        fold_name(item.get("name") or ""),
        character_id or fold_name(item.get("role") or ""),
    )


def merge_cast_records(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge one real appearance while retaining every supporting source."""
    out: list[dict[str, Any]] = []
    by_relation: dict[tuple[str, ...], dict[str, Any]] = {}
    for raw in items:
        item = dict(raw)
        evidence_sources = [dict(source) for source in item.get("evidence_sources") or []]
        if item.get("evidence"):
            evidence_sources.append({"kind": item["evidence"], "url": item.get("source_url") or ""})
        evidence_sources = list({(source.get("kind"), source.get("url")): source for source in evidence_sources}.values())
        item["evidence_sources"] = evidence_sources
        key = cast_relation_key(item)
        existing = by_relation.get(key)
        if existing is None:
            by_relation[key] = item
            out.append(item)
            continue
        existing["evidence_sources"] = list({
            (source.get("kind"), source.get("url")): source
            for source in [*existing.get("evidence_sources", []), *evidence_sources]
        }.values())
        if not existing.get("source_url") and item.get("source_url"):
            existing["source_url"] = item["source_url"]
        if not existing.get("role") and item.get("role"):
            existing["role"] = item["role"]
        if not existing.get("character_id") and item.get("character_id"):
            existing["character_id"] = item["character_id"]

    # Eventernote often confirms only the person while a hand-curated setlist
    # supplies that same person's character. When exactly one richer relation
    # exists, fold the person-only evidence into it instead of showing the cast
    # member twice. Keep the generic row when one actor genuinely has multiple
    # roles and the source does not say which one it supports.
    actor_relations: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in out:
        actor_id = str(item.get("voice_actor_id") or "")
        if actor_id and (item.get("character_id") or item.get("role")):
            actor_relations[actor_id].append(item)
    merged_generic_ids: set[int] = set()
    for item in out:
        actor_id = str(item.get("voice_actor_id") or "")
        if not actor_id or item.get("character_id") or item.get("role"):
            continue
        richer = actor_relations.get(actor_id) or []
        if len(richer) != 1:
            continue
        target = richer[0]
        target["evidence_sources"] = list({
            (source.get("kind"), source.get("url")): source
            for source in [*target.get("evidence_sources", []), *item.get("evidence_sources", [])]
        }.values())
        if not target.get("source_url") and item.get("source_url"):
            target["source_url"] = item["source_url"]
        merged_generic_ids.add(id(item))
    return [item for item in out if id(item) not in merged_generic_ids]


def make_cast(items: Iterable[dict[str, Any]], identities: IdentityIndex, evidence: str, source_url: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in items:
        name = str(item.get("name") or "").strip()
        role = str(item.get("role") or "").strip()
        actor_id = identities.voice_id(name)
        # The public event cast has one precise meaning: an Uma Musume voice
        # actor appearing as their canonical character. Festival guests,
        # presenters, staff, and other performers remain in the source record;
        # singers outside the franchise are retained on the exact song row.
        if not actor_id:
            continue
        item_evidence = str(item.get("source_kind") or evidence)
        item_source_url = str(item.get("source_url") or source_url)
        character_id = identities.current_character_id(actor_id)
        if not character_id:
            continue
        # A voice-actor identity has exactly one canonical role in this archive.
        # Source-side role labels may be missing, translated differently, or
        # attached to the wrong same-named commentator; never let them create a
        # second actor-to-character relationship at runtime.
        profile = identities.profile_by_id.get(actor_id) or {}
        character = identities.character_by_id.get(character_id) or {}
        out.append({
            "voice_actor_id": actor_id,
            "name": (profile.get("identity") or {}).get("zh") or name,
            "character_id": character_id,
            "role": character.get("zh") or role,
            "evidence": item_evidence,
            "source_url": item_source_url,
            "person_type": "voice_actor",
            "resolution": "resolved",
        })
    return merge_cast_records(out)


def make_character_cast(character_ids: Iterable[str], identities: IdentityIndex, evidence: str, source_url: str = "") -> list[dict[str, Any]]:
    """Resolve an official character credit through the canonical current cast."""
    rows = []
    for character_id in dict.fromkeys(str(item or "") for item in character_ids if item):
        actor_id = identities.current_voice_id(character_id)
        profile = identities.profile_by_id.get(actor_id) or {}
        character = identities.character_by_id.get(character_id) or {}
        actor_name = (profile.get("identity") or {}).get("zh") or ""
        character_name = character.get("zh") or ""
        if not actor_name or not character_name:
            continue
        rows.append({
            "name": actor_name,
            "role": character_name,
            "source_kind": evidence,
            "source_url": source_url,
        })
    return make_cast(rows, identities, evidence, source_url)


def series_lookup(series_doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in series_doc.get("series", [])}


def resolve_event_cover(event: dict[str, Any], series_by_id: dict[str, dict[str, Any]]) -> str:
    """Return the one cover URL published for an event."""
    image = str(event.get("image") or "")
    if image and "eventernote.s3.amazonaws.com/" not in image:
        return image
    event_id = str(event.get("id") or "").lower()
    if event.get("series_id") == "numbered-live":
        for token, cover in NUMBERED_EVENT_COVERS.items():
            if token in event_id:
                return cover
    series = series_by_id.get(str(event.get("series_id") or "")) or {}
    return str(series.get("cover") or EVENT_COVER_BY_KIND.get(
        str(event.get("kind") or ""), EVENT_COVER_BY_KIND["onsite"]
    ))


def numbered_events(data: list[dict[str, Any]], identities: IdentityIndex, used: set[str], stable_ids: dict[str, str] | None = None) -> list[dict[str, Any]]:
    out = []
    for group_index, group in enumerate(data):
        series_match = re.search(r"(\d+(?:st|nd|rd|th)(?:\s*EVENT)?(?:\s*EXTRA)?)", group.get("group") or "", re.I)
        series_token = re.sub(r"\s+", "-", series_match.group(1).lower()) if series_match else f"series-{group_index + 1}"
        for performance_index, sub in enumerate(group.get("subs") or []):
            date = first_date(sub.get("date"))
            event_id = unique_id((stable_ids or {}).get(sub.get("title") or "") or f"live-numbered-{series_token}-{date or performance_index + 1}", used)
            sessions = []
            cast_source = parse_cast_text(sub.get("cast") or "")
            event_cast = make_cast(cast_source, identities, "curated_live_cast")
            for day_index, day in enumerate(sub.get("days") or []):
                table = day.get("table") or ""
                full_cast = cast_characters_for_session(
                    sub.get("cast") or "", identities, sub.get("date"), day_index
                )
                performances = table_performances(table, identities, full_cast)
                characters = list(dict.fromkeys(char_id for performance in performances for char_id in performance["character_ids"]))
                session = {
                    "id": f"{event_id}-session-{day_index + 1}",
                    "label": day.get("label") or f"DAY{day_index + 1}",
                    "date": event_date_for_day(sub.get("date"), day_index),
                    "songs": [performance["song"] for performance in performances],
                    "character_ids": characters,
                    "performances": performances,
                }
                if table:
                    session["setlist_html"] = table
                    session["setlist_source"] = {"file": "data/live_data.json", "group": group_index, "performance": performance_index, "day": day_index}
                sessions.append(session)
            no = series_token.replace("-event", "")
            base_legacy = f"/zh-Hans/live/number_series_event/{no}_EVENT"
            legacy = base_legacy if performance_index == 0 else f"{base_legacy}/{performance_index}/0"
            legacy_aliases = []
            for day_index in range(max(1, len(sessions))):
                alias = base_legacy if performance_index == 0 and day_index == 0 else f"{base_legacy}/{performance_index}/{day_index}"
                if alias not in legacy_aliases:
                    legacy_aliases.append(alias)
            if performance_index == 0 and f"{base_legacy}/0/0" not in legacy_aliases:
                legacy_aliases.append(f"{base_legacy}/0/0")
            out.append({
                "id": event_id, "title": sub.get("title") or group.get("group") or "", "date": date,
                "end_date": sessions[-1]["date"] if sessions else date, "kind": "concert", "mode": "onsite",
                "series_id": "numbered-live", "venue": venue_from_date_text(sub.get("date")) if date else "",
                "cast_status": "verified" if event_cast else "partial", "cast": event_cast, "character_ids": [],
                "sessions": sessions, "media": curated_media(sub.get("vids") or []),
                "sources": [{"kind": "curated_live", "label": "站内精调歌单", "url": legacy}],
                "legacy_url": legacy, "legacy_aliases": legacy_aliases, "image": "", "summary": sub.get("tips") or "",
            })
    return out


def cat_series_id(category: str, section_name: str, group_name: str) -> str:
    text = f"{section_name} {group_name}".upper()
    if "WINNING LIVE" in text:
        return "winning-live-release"
    if "STARTING GATE" in text:
        return "starting-gate-release"
    if category == "twinkle":
        return "twinkle-circle"
    return ""


def category_events(data: dict[str, Any], identities: IdentityIndex, used: set[str]) -> list[dict[str, Any]]:
    out = []
    for category, root in data.items():
        if not isinstance(root, dict):
            continue
        sections = root.get("sections") or [{"group": root.get("group") or "", "groups": root.get("groups") or []}]
        has_sections = bool(root.get("sections"))
        for section_index, section in enumerate(sections):
            for group_index, group in enumerate(section.get("groups") or []):
                for performance_index, sub in enumerate(group.get("subs") or [{}]):
                    title = sub.get("title") or group.get("group") or ""
                    date = first_date(sub.get("date"))
                    suffix = stable_title_suffix(title) or f"item-{section_index + 1}-{group_index + 1}"
                    event_id = unique_id(f"live-{category}-{date or 'undated'}-{suffix}", used)
                    legacy = f"/zh-Hans/live/{category}/"
                    if has_sections:
                        legacy += f"{section_index}/{group_index}"
                    else:
                        legacy += str(group_index)
                    if performance_index:
                        legacy += f"/{performance_index}/0"
                    legacy_aliases = [legacy]
                    if performance_index == 0:
                        legacy_aliases.append(f"{legacy}/0/0")
                    for day_index in range(1, max(1, len(sub.get("days") or []))):
                        base = legacy.rsplit("/", 2)[0] if performance_index else legacy
                        alias = f"{base}/{performance_index}/{day_index}"
                        if alias not in legacy_aliases:
                            legacy_aliases.append(alias)
                    sessions = []
                    for day_index, day in enumerate(sub.get("days") or []):
                        table = day.get("table") or ""
                        full_cast = cast_characters_for_session(
                            sub.get("cast") or "", identities, sub.get("date"), day_index
                        )
                        performances = table_performances(table, identities, full_cast)
                        characters = list(dict.fromkeys(char_id for performance in performances for char_id in performance["character_ids"]))
                        session = {
                            "id": f"{event_id}-session-{day_index + 1}", "label": day.get("label") or "本公演",
                            "date": event_date_for_day(sub.get("date"), day_index), "songs": [performance["song"] for performance in performances],
                            "character_ids": characters,
                            "performances": performances,
                        }
                        if table:
                            session["setlist_html"] = table
                            session["setlist_source"] = {"file": "data/live_cat_data.json", "category": category, "section": section_index if has_sections else None, "group": group_index, "performance": performance_index, "day": day_index}
                        sessions.append(session)
                    cast = make_cast(parse_cast_text(sub.get("cast") or ""), identities, "curated_live_cast")
                    venue = venue_from_date_text(sub.get("date")) if date else str(sub.get("date") or "")
                    out.append({
                        "id": event_id, "title": title, "date": date, "end_date": sessions[-1]["date"] if sessions else date,
                        "kind": "concert" if category in ("cd", "twinkle") else "onsite", "mode": "onsite",
                        "series_id": cat_series_id(category, section.get("group") or "", group.get("group") or ""),
                        "venue": venue, "cast_status": "verified" if cast else "partial", "cast": cast, "character_ids": [],
                        "sessions": sessions, "media": curated_media(sub.get("vids") or []),
                        "sources": [{"kind": "curated_live", "label": "站内精调歌单", "url": legacy}],
                        "legacy_url": legacy, "legacy_aliases": legacy_aliases, "image": "", "summary": sub.get("tips") or "",
                    })
    return out


def attach_eventernote(events: list[dict[str, Any]], eventernote_doc: dict[str, Any], identities: IdentityIndex, used: set[str]) -> None:
    by_legacy = {}
    for event in events:
        for legacy in [event.get("legacy_url"), *(event.get("legacy_aliases") or [])]:
            if legacy:
                by_legacy[legacy] = event
    for source in eventernote_doc.get("events") or []:
        legacy = source.get("live") or ""
        linked = by_legacy.get(legacy)
        cast = make_cast(source.get("actors") or [], identities, "eventernote", source.get("link") or "")
        eventernote_id = ""
        match = EVENTERNOTE_ID_RE.search(source.get("link") or "")
        if match:
            eventernote_id = match.group(1)
        if linked:
            has_curated = any(s.get("kind") == "curated_live" for s in linked.get("sources") or [])
            if has_curated:
                linked["cast_status"] = "verified" if linked["cast"] else linked["cast_status"]
            else:
                linked["cast"] = merge_cast_records([*linked["cast"], *cast])
                linked["cast_status"] = "verified" if linked["cast"] else linked["cast_status"]
            linked["sources"].append({"kind": "eventernote", "label": "Eventernote", "url": source.get("link") or ""})
            linked["image"] = linked.get("image") or source.get("img") or ""
            linked["venue"] = linked.get("venue") or source.get("venue") or ""
            continue
        date = first_date(source.get("date"))
        event_id = unique_id(f"eventernote-{eventernote_id or date or 'undated'}", used)
        events.append({
            "id": event_id, "title": source.get("title") or "", "date": date, "end_date": date,
            "kind": "onsite", "mode": "onsite", "series_id": "", "venue": source.get("venue") or "",
            "cast_status": "verified" if cast else "pending", "cast": cast, "character_ids": [], "sessions": [], "media": [],
            "sources": [{"kind": "eventernote", "label": "Eventernote", "url": source.get("link") or ""}],
            "legacy_url": "", "image": source.get("img") or "", "summary": source.get("times") or "",
        })


def add_programs(events: list[dict[str, Any]], programs_doc: dict[str, Any], identities: IdentityIndex, used: set[str]) -> None:
    for source in programs_doc.get("programs") or []:
        event_id = unique_id(source.get("id") or f"program-{source.get('date') or 'undated'}-{stable_suffix(source.get('title') or '')}", used)
        source_kind = source.get("source_kind") or "official_youtube"
        source_url = source.get("source_url") or source.get("url") or ""
        source_sessions = source.get("sessions") or []
        source_cast = list(source.get("cast") or [])
        for source_session in source_sessions:
            source_cast.extend(source_session.get("cast") or [])
        cast = make_cast(source_cast, identities, source_kind, source_url)
        program_media = source.get("media") or ([{"url": source.get("url") or "", "label": "官方视频", "video_id": source.get("video_id") or "", "duration": source.get("duration")}]
                                                  if source.get("url") else [])
        source_labels = {
            "official_announcement": "官方公告",
            "official_youtube": "官方 YouTube",
            "community_archive": "Umamusume Wiki 补档",
            "official_broadcaster": "节目官方页",
        }
        program_sources = source.get("sources") or ([{"kind": source_kind, "label": source_labels.get(source_kind, "资料来源"), "url": source_url}]
                                                     if source_url else [])
        characters = []
        for item in source.get("characters") or []:
            char_id = identities.character_id(str(item))
            if char_id and char_id not in characters:
                characters.append(char_id)
        if source.get("series_id") == "pakatube-character-program":
            for char_id in identities.characters_in_text((source.get("title") or "") + " " + (source.get("summary") or "")):
                if char_id not in characters:
                    characters.append(char_id)
            if re.search(r"ぴすラジッ|ゴルシトーク|ぱかトークっ!|同時視聴", source.get("title") or "", re.I):
                host_id = identities.character_id("ゴールドシップ")
                if host_id and host_id not in characters:
                    characters.append(host_id)
        if characters:
            cast = merge_cast_records([
                *cast,
                *make_character_cast(characters, identities, "official_character_credit", source_url),
            ])
        sessions = []
        for index, source_session in enumerate(source_sessions):
            session_cast = make_cast(source_session.get("cast") or [], identities, source_kind, source_url)
            session_characters = []
            for item in session_cast:
                char_id = item.get("character_id") or ""
                if char_id and char_id not in session_characters:
                    session_characters.append(char_id)
            for item in source_session.get("characters") or []:
                char_id = identities.character_id(str(item))
                if char_id and char_id not in session_characters:
                    session_characters.append(char_id)
            if session_characters:
                session_cast = merge_cast_records([
                    *session_cast,
                    *make_character_cast(session_characters, identities, "official_character_credit", source_url),
                ])
            sessions.append({
                "id": f"{event_id}-session-{index + 1}",
                "label": source_session.get("label") or f"场次 {index + 1}",
                "date": source_session.get("date") or source.get("date") or "",
                "songs": [],
                "character_ids": session_characters,
                "cast": session_cast,
            })
        if not sessions:
            sessions = [{"id": f"{event_id}-session-1", "label": "本期节目", "date": source.get("date") or "", "songs": [], "character_ids": characters, "cast": cast}]
        events.append({
            "id": event_id, "title": source.get("title") or "", "date": source.get("date") or "", "end_date": source.get("end_date") or source.get("date") or "",
            "kind": "official_program", "mode": "online", "series_id": source.get("series_id") or "official-special", "venue": "在线播出",
            "cast_status": "verified" if cast else (source.get("cast_status") or "pending"), "cast": cast, "character_ids": characters,
            "sessions": sessions,
            "media": program_media,
            "sources": program_sources,
            "legacy_url": "", "image": source.get("thumbnail") or "", "summary": concise_program_summary(source.get("summary")),
            "schedule_status": source.get("schedule_status") or ("scheduled" if source.get("date") else "unknown"),
            "metadata_status": source.get("metadata_status") or "complete",
        })


def apply_overrides(events: list[dict[str, Any]], overrides: dict[str, Any], identities: IdentityIndex) -> list[dict[str, Any]]:
    patches = overrides.get("event_patches") or {}
    aliases = overrides.get("event_aliases") or {}
    hidden = set(overrides.get("hidden_event_ids") or [])
    for event in events:
        canonical = aliases.get(event["id"], event["id"])
        event["id"] = canonical
        patch = patches.get(canonical)
        if patch:
            event.update({key: value for key, value in patch.items() if key not in ("cast_add", "sources_add")})
            if "character_ids" in patch:
                allowed_characters = set(patch.get("character_ids") or [])
                event["cast"] = [
                    item for item in event.get("cast") or []
                    if not item.get("character_id") or item.get("character_id") in allowed_characters
                ]
            additions = make_cast(patch.get("cast_add") or [], identities, "curated_correction")
            known_cast = {(item.get("voice_actor_id"), fold_name(item.get("name") or ""), fold_name(item.get("role") or "")) for item in event.get("cast") or []}
            event.setdefault("cast", []).extend(
                item for item in additions
                if (item.get("voice_actor_id"), fold_name(item.get("name") or ""), fold_name(item.get("role") or "")) not in known_cast
            )
            event.setdefault("sources", []).extend(
                source for source in patch.get("sources_add") or [] if source not in event.get("sources", [])
            )
        event_characters = list(dict.fromkeys([
            *(str(item or "") for item in event.get("character_ids") or [] if item),
            *(str(item.get("character_id") or "") for item in event.get("cast") or [] if item.get("character_id")),
        ]))
        if event_characters:
            represented_characters = {
                str(item.get("character_id") or "")
                for item in event.get("cast") or []
                if item.get("voice_actor_id") and item.get("character_id")
            }
            missing_characters = [
                character_id for character_id in event_characters
                if character_id not in represented_characters
            ]
            if missing_characters:
                event["cast"] = merge_cast_records([
                    *(event.get("cast") or []),
                    *make_character_cast(missing_characters, identities, "canonical_character_cast"),
                ])
            if event["cast"]:
                event["cast_status"] = "verified"
    return [event for event in events if event["id"] not in hidden]


def dedupe_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # IDs are merged only after an explicit alias or exact source identity has
    # established equivalence. The richer program record supplies the shell,
    # while curated setlists, legacy links, cast evidence, and media are unioned.
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        grouped[event["id"]].append(event)

    def unique(items: Iterable[Any], key) -> list[Any]:
        out = []
        seen = set()
        for item in items:
            marker = key(item)
            if marker in seen:
                continue
            seen.add(marker)
            out.append(item)
        return out

    def merge_session(target: dict[str, Any], incoming: dict[str, Any]) -> None:
        target["songs"] = unique([*target.get("songs", []), *incoming.get("songs", [])], lambda value: value)
        target["character_ids"] = unique([*target.get("character_ids", []), *incoming.get("character_ids", [])], lambda value: value)
        target["cast"] = merge_cast_records([*target.get("cast", []), *incoming.get("cast", [])])
        target["performances"] = unique(
            [*target.get("performances", []), *incoming.get("performances", [])],
            lambda item: (item.get("song"), tuple(item.get("character_ids") or [])),
        )
        if incoming.get("setlist_source") and not target.get("setlist_source"):
            target["setlist_source"] = incoming["setlist_source"]
            target["setlist_html"] = incoming.get("setlist_html") or ""

    out = []
    for event_id, rows in grouped.items():
        primary = max(
            rows,
            key=lambda row: (
                row.get("kind") == "official_program",
                bool(row.get("date")),
                bool(row.get("image")),
                len(row.get("summary") or ""),
            ),
        )
        merged = dict(primary)
        merged["sources"] = unique(
            [source for row in rows for source in row.get("sources", [])],
            lambda source: (source.get("kind"), source.get("url")),
        )
        merged["media"] = unique(
            [media for row in rows for media in row.get("media", [])],
            lambda media: media.get("video_id") or media.get("url"),
        )
        merged["cast"] = merge_cast_records(item for row in rows for item in row.get("cast", []))
        merged["character_ids"] = unique(
            [character_id for row in rows for character_id in row.get("character_ids", [])],
            lambda character_id: character_id,
        )
        merged["legacy_aliases"] = unique(
            [alias for row in rows for alias in row.get("legacy_aliases", [])],
            lambda alias: alias,
        )
        merged["legacy_url"] = next((row.get("legacy_url") for row in rows if row.get("legacy_url")), "")
        sessions: list[dict[str, Any]] = []
        for row in rows:
            row_sessions = row.get("sessions") or []
            for incoming in row_sessions:
                same = next(
                    (
                        session for session in sessions
                        if session.get("date") == incoming.get("date")
                        and (
                            fold_name(session.get("label") or "") == fold_name(incoming.get("label") or "")
                            or (len(row_sessions) == 1 and len(primary.get("sessions") or []) == 1)
                        )
                    ),
                    None,
                )
                if same:
                    merge_session(same, incoming)
                else:
                    sessions.append(dict(incoming))
        for index, session in enumerate(sessions):
            session["id"] = f"{event_id}-session-{index + 1}"
        merged["sessions"] = sessions
        if len(rows) > 1 and any(row.get("kind") == "official_program" for row in rows):
            merged["kind"] = "official_program"
            merged["mode"] = "online"
            merged["venue"] = "在线播出"
        out.append(merged)
    return out


def build_appearance_index(events: list[dict[str, Any]], songs_catalog: dict[str, Any], identities: IdentityIndex) -> dict[str, Any]:
    voice: dict[str, dict[str, Any]] = {}
    chars: dict[str, dict[str, Any]] = {}
    unresolved = Counter()
    for profile in identities.profiles:
        voice[profile["id"]] = {"events": [], "songs": {}, "performed_songs": {}}
    for char_id in identities.character_by_id:
        chars[char_id] = {"events": [], "songs": {}, "performed_songs": {}}

    def add_release(bucket: dict[str, Any], song: dict[str, Any], version_id: str, release: dict[str, Any]) -> None:
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
        voice_in_event: dict[str, set[str]] = defaultdict(set)
        char_in_event: set[str] = set(event.get("character_ids") or [])
        cast_actor_by_character: dict[str, set[str]] = defaultdict(set)
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
        event_songs: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
        for session in event.get("sessions") or []:
            session_chars = set(session.get("character_ids") or [])
            char_in_event.update(session_chars)
            for performance in session.get("performances") or []:
                song = performance.get("song_title") or performance.get("song") or ""
                song_id = performance.get("song_id") or ""
                version_id = performance.get("version_id") or ""
                if not song or not song_id:
                    continue
                performance_chars = set(performance.get("character_ids") or [])
                for char_id in performance_chars:
                    relation = event_songs[char_id].setdefault(song_id, {
                        "song_id": song_id, "name": song, "event_ids": [], "performance_ids": [], "version_ids": [],
                    })
                    relation["event_ids"].append(event["id"])
                    relation["performance_ids"].append(f"{session.get('id') or event['id']}:{version_id}")
                    relation["version_ids"].append(version_id)
                for char_id in performance_chars:
                    character = identities.character_by_id.get(char_id) or {}
                    actor_ids = cast_actor_by_character.get(char_id) or set()
                    if not actor_ids and not character.get("cv_former"):
                        current_actor = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
                        if current_actor:
                            actor_ids = {current_actor}
                    for actor_id in actor_ids:
                        voice_in_event[actor_id].add("setlist_character")
        base = {"event_id": event["id"], "date": event.get("date") or "", "title": event.get("title") or "", "kind": event.get("kind") or "", "series_id": event.get("series_id") or ""}
        for actor_id, evidence in voice_in_event.items():
            if actor_id not in voice:
                continue
            voice[actor_id]["events"].append({**base, "evidence": sorted(item for item in evidence if item)})
        for char_id in char_in_event:
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
                character = identities.character_by_id.get(char_id) or {}
                actor_ids = cast_actor_by_character.get(char_id) or set()
                if not actor_ids and not character.get("cv_former"):
                    current_actor = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
                    if current_actor:
                        actor_ids = {current_actor}
                for actor_id in actor_ids:
                    if actor_id in voice:
                        actor_relation = voice[actor_id]["performed_songs"].setdefault(song_id, {
                            "song_id": song_id, "name": relation["name"], "event_ids": [], "performance_ids": [], "version_ids": [],
                        })
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


def enrich_profiles(profiles: list[dict[str, Any]], appearance_index: dict[str, Any]) -> list[dict[str, Any]]:
    for profile in profiles:
        history = appearance_index["voice_actors"].get(profile["id"], {"events": [], "songs": []})
        profile["stats"] = {
            "events": len(history["events"]),
            "concerts": sum(1 for event in history["events"] if event["kind"] == "concert"),
            "programs": sum(1 for event in history["events"] if event["kind"] == "official_program"),
            "songs": len(history["songs"]),
        }
    return profiles


def validate(
    catalog: dict[str, Any],
    songs_catalog: dict[str, Any],
    appearances: dict[str, Any],
    profiles: list[dict[str, Any]],
) -> list[str]:
    errors: list[str] = []
    build_ids = {catalog.get("build_id"), songs_catalog.get("build_id"), appearances.get("build_id")}
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
    current_voice_by_character: dict[str, list[str]] = defaultdict(list)
    character_by_voice: dict[str, str] = {}
    for profile in profiles:
        roles = [role for role in profile.get("roles") or [] if role.get("character_id")]
        if len(roles) != 1:
            errors.append(f"voice actor {profile.get('id')} has {len(roles)} canonical characters")
        elif profile.get("id"):
            character_by_voice[str(profile["id"])] = str(roles[0]["character_id"])
        current_roles = [role for role in profile.get("roles") or [] if not role.get("former")]
        if len(current_roles) > 1:
            errors.append(f"voice actor {profile.get('id')} has multiple current characters")
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
    if len(song_ids) != len(known_songs):
        errors.append("duplicate song IDs")
    if len(version_ids) != len(known_versions):
        errors.append("duplicate song version IDs")
    semantic_events: dict[tuple[str, str], list[str]] = defaultdict(list)
    all_session_ids: list[str] = []
    for event in catalog.get("events") or []:
        if not event.get("title"):
            errors.append(f"event {event.get('id')} has no title")
        if not event.get("image"):
            errors.append(f"event {event.get('id')} has no visible cover")
        normalized_title = re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", event.get("title") or "").lower())
        semantic_events[(event.get("date") or "", normalized_title)].append(event.get("id") or "")
        if not event.get("date") and event.get("schedule_status") != "announced_tba":
            errors.append(f"event {event.get('id')} has no date without an announced-TBA status")
        if event.get("date"):
            try:
                dt.date.fromisoformat(event["date"])
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
            if not cast.get("character_id"):
                errors.append(f"event {event['id']} has cast without canonical character {cast.get('name')}")
            if cast.get("voice_actor_id") and cast["voice_actor_id"] not in known_actors:
                errors.append(f"event {event['id']} references unknown actor {cast['voice_actor_id']}")
            if cast.get("voice_actor_id") and not cast.get("character_id"):
                errors.append(f"event {event['id']} has actor without canonical character {cast['voice_actor_id']}")
            if cast.get("character_id") and cast["character_id"] not in known_characters:
                errors.append(f"event {event['id']} references unknown character {cast['character_id']}")
            if cast.get("voice_actor_id") and cast.get("character_id") != character_by_voice.get(str(cast["voice_actor_id"])):
                errors.append(
                    f"event {event['id']} maps actor {cast['voice_actor_id']} to noncanonical character {cast.get('character_id')}"
                )
            cast_keys.append(cast_relation_key(cast))
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
                    json.dumps(session["setlist_source"], ensure_ascii=False, sort_keys=True),
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
    allowed_field_statuses = {"verified", "not_published", "not_applicable"}
    for profile in profiles:
        identity = profile.get("identity") or {}
        for name in (identity.get("zh"), identity.get("ja"), *(identity.get("aliases") or [])):
            if not name:
                continue
            folded = fold_name(str(name))
            owner = identity_owners.setdefault(folded, profile.get("id") or "")
            if owner != profile.get("id"):
                errors.append(f"voice actor identity {name} belongs to both {owner} and {profile.get('id')}")
        details = profile.get("profile") or {}
        current_roles = [role for role in profile.get("roles") or [] if role.get("character_id") and not role.get("former")]
        if len(current_roles) > 1:
            errors.append(f"voice actor {profile.get('id')} has multiple current characters")
        if not details.get("sources"):
            errors.append(f"voice actor {profile.get('id')} has no profile source")
        field_status = details.get("field_status") or {}
        for field in ("birthday", "birthplace", "agency", "official_profile"):
            status = field_status.get(field)
            if status not in allowed_field_statuses:
                errors.append(f"voice actor {profile.get('id')} has unaccounted {field}: {status}")
            if status == "verified" and not details.get(field):
                errors.append(f"voice actor {profile.get('id')} marks empty {field} verified")
    for series_id, baseline in REGULAR_PROGRAM_BASELINES.items():
        ids = {event.get("id") for event in catalog.get("events") or [] if event.get("series_id") == series_id}
        missing = [f"{series_id}-{number:03d}" for number in range(1, baseline + 1) if f"{series_id}-{number:03d}" not in ids]
        if missing:
            errors.append(f"series {series_id} is missing episodes: {', '.join(missing)}")
    for event_id in [*(f"official-special-abema-stakes-{number:02d}" for number in range(1, 7)), *(f"all-night-nippon-gold-{number:03d}" for number in range(1, 7))]:
        if event_id not in event_id_set:
            errors.append(f"required historical or announced program is missing: {event_id}")
    return errors


def program_identity(title: str) -> tuple[str, str]:
    normalized = unicodedata.normalize("NFKC", title or "")
    match = re.search(r"そこそこぱかライブTV\s*Vol\.?\s*(\d+)", normalized, re.I)
    if match:
        number = int(match.group(1))
        return f"sokosoko-paka-live-tv-{number:03d}", "sokosoko-paka-live-tv"
    match = re.search(r"ぱかライブTV\s*['’]\s*#\s*(\d+)", normalized, re.I)
    if match:
        number = int(match.group(1))
        return f"paka-live-tv-prime-{number:03d}", "paka-live-tv-prime"
    match = re.search(r"ぱかライブTV\s*Vol\.?\s*(\d+)", normalized, re.I)
    if match:
        number = int(match.group(1))
        return f"paka-live-tv-{number:03d}", "paka-live-tv"
    return "", ""


def expected_regular_program_ids(rows: Iterable[dict[str, Any]]) -> dict[tuple[str, int], str]:
    observed = {series_id: set() for series_id in REGULAR_PROGRAM_BASELINES}
    for row in rows:
        event_id, series_id = program_identity(row.get("title") or "")
        if not event_id or series_id not in observed:
            continue
        is_channel_inventory = row.get("channel_id") == OFFICIAL_CHANNEL_ID
        is_verified_source = bool(row.get("date") and (row.get("source_url") or row.get("url")))
        if is_channel_inventory or is_verified_source:
            observed[series_id].add(int(event_id.rsplit("-", 1)[1]))
    expected = {}
    for series_id, baseline in REGULAR_PROGRAM_BASELINES.items():
        maximum = baseline
        while maximum + 1 in observed[series_id]:
            maximum += 1
        for number in range(1, maximum + 1):
            expected[(series_id, number)] = f"{series_id}-{number:03d}"
    return expected


def program_text_lines(value: str) -> list[str]:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</?(?:p|div|li|h\d|section|figure|strong)\b[^>]*>", "\n", text, flags=re.I)
    text = HTML_TAG_RE.sub("", text)
    return [line.strip() for line in text.splitlines()]


def parse_program_cast_line(line: str) -> dict[str, str] | None:
    value = re.sub(r"[【\[].*?[】\]]", "", line or "").strip()
    if re.search(r"\.\.\.|…|and more|について|として|決定|更新|情報|コラボ|^[・［\[]|^は", value, re.I):
        return None
    match = re.match(r"([^（(]+?)[（(]([^）)]+?)(?:役)?[）)]", value)
    if match:
        name = re.sub(r"さん$", "", match.group(1).strip())
        role = re.sub(r"役$", "", match.group(2).strip())
        if re.search(r"https?://|公式(?:HP|サイト)|詳細", name + role, re.I):
            return None
        return {"name": name, "role": role} if name else None
    role_first = re.match(r"(.+?)役\s+([^\s]+)$", value)
    if role_first:
        role = role_first.group(1).strip()
        name = re.sub(r"さん$", "", role_first.group(2).strip())
        return {"name": name, "role": role} if name else None
    if value and len(value) < 30 and not re.search(r"[:：]|全員|ほか|予定|変更", value):
        return {"name": value, "role": ""}
    return None


def parse_program_sessions(description: str, default_date: str = "") -> list[dict[str, Any]]:
    lines = program_text_lines(description)
    session_dates: dict[str, str] = {}
    for line in lines:
        schedule = re.match(r"(?:■\s*)?(DAY\s*\d+|前編|後編)\s*[:：]", line, re.I)
        if schedule:
            value = first_date(line)
            if value:
                session_dates[fold_name(schedule.group(1))] = value
    sessions = []
    for index, line in enumerate(lines):
        heading = re.fullmatch(r"(?:■\s*)?(?:(DAY\s*\d+|前編|後編)\s*)?(?:出走者|出演者|出演)[:：]?", line, re.I)
        if not heading:
            continue
        label = (heading.group(1) or "本期节目").strip()
        cast = []
        for candidate in lines[index + 1:]:
            if re.fullmatch(r"(?:■\s*)?(?:(?:DAY\s*\d+|前編|後編)\s*)?(?:出走者|出演者|出演)[:：]?", candidate, re.I):
                break
            if not candidate:
                if cast:
                    break
                continue
            if candidate.startswith(("※", "番組", "放送", "配信", "視聴", "URL", "http", "「ウマ娘", "©")):
                break
            parsed = parse_program_cast_line(candidate)
            if parsed:
                cast.append(parsed)
            elif cast:
                break
        if cast:
            sessions.append({"label": label, "date": session_dates.get(fold_name(label), default_date), "cast": cast})
    return sessions


def parse_program_cast(description: str) -> list[dict[str, str]]:
    out = []
    seen = set()
    for session in parse_program_sessions(description):
        for item in session["cast"]:
            key = (fold_name(item["name"]), fold_name(item["role"]))
            if key not in seen:
                seen.add(key)
                out.append(item)
    return out


def parse_intro_cast(description: str) -> list[dict[str, str]]:
    """Read explicitly credited role pairs before a program-outline section."""
    prefix = re.split(r"(?:番組概要|■番組名)", "\n".join(program_text_lines(description)), maxsplit=1)[0]
    out = []
    seen = set()
    for match in re.finditer(r"([ぁ-ゖァ-ヺー一-龯々〆ヵヶA-Za-z・]+?)(?:さん)?[（(]([^）)\n]+?役)[）)]", prefix):
        item = {"name": match.group(1).strip(), "role": re.sub(r"役$", "", match.group(2).strip())}
        key = (fold_name(item["name"]), fold_name(item["role"]))
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def parse_program_date(description: str) -> str:
    lines = program_text_lines(description)
    for line in lines:
        if re.search(r"(?:放送|配信|公開)(?:日時|日)", line):
            value = first_date(line)
            if value:
                return value
    return ""


def fetch_text_url(url: str, attempts: int = 3) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "uma-live-wiki data updater/1.0"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code == 404 or error.code < 429 or attempt + 1 >= attempts:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt + 1 >= attempts:
                raise
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"unable to fetch {url}")


def plain_wikitext(value: str) -> str:
    text = re.sub(r"<!--.*?-->", "", str(value or ""), flags=re.S)
    text = re.sub(r"<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>", "", text, flags=re.I | re.S)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = re.sub(r"</?(?:del|s|small|span)\b[^>]*>", "", text, flags=re.I)
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[(?:https?://\S+)\s+([^\]]+)\]", r"\1", text)
    text = text.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def wiki_table_rows(source: str, caption: str) -> list[list[str]]:
    marker = "|+ " + caption
    marker_index = source.find(marker)
    if marker_index < 0:
        return []
    start = source.rfind("{|", 0, marker_index)
    end = source.find("|}", marker_index)
    if start < 0 or end < 0:
        return []
    rows = []
    for block in source[start:end].split("|-")[2:]:
        cells: list[str] = []
        current: str | None = None
        for line in block.splitlines():
            if line.startswith("|") and not line.startswith("|}"):
                if current is not None:
                    cells.append(current)
                current = line[1:].strip()
            elif current is not None:
                current += " " + line.strip()
        if current is not None:
            cells.append(current)
        if cells:
            rows.append(cells)
    return rows


def wiki_archive_date(value: str) -> str:
    text = plain_wikitext(value).replace("Sept ", "Sep ").replace("Sept. ", "Sep ")
    for pattern in ("%b %d, %Y", "%B %d, %Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            pass
    return first_date(text)


def english_identity_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKC", value or "").lower())


def historical_cast(value: str, characters: list[dict[str, Any]], source_url: str) -> list[dict[str, str]]:
    by_english = {english_identity_key(str(row.get("en") or "")): row for row in characters if row.get("en")}
    aliases = {
        english_identity_key("Tazuna Hayakawa"): english_identity_key("Hayakawa Tazuna"),
        english_identity_key("Misato Akasaka"): english_identity_key("Akasaka Misato"),
        english_identity_key("Trainer"): english_identity_key("Spica's Trainer"),
        english_identity_key("Yamamin Zephyr"): english_identity_key("Yamanin Zephyr"),
    }
    supplementary = {
        english_identity_key("Belno Light"): ("瀬戸桃子", "ベルノライト"),
        english_identity_key("Fujimasa March"): ("伊瀬茉莉也", "フジマサマーチ"),
    }
    external_names = {
        "Yoohei Kawakami": "川上洋平",
        "Masaki Shirai": "白井眞輝",
        "Junnosuke Ito": "伊藤隼之介",
        "Akihiro Ishihara": "石原章弘",
        "Takeshi Itazu": "板津雄志",
        "Koichi Tsunoda": "角田晃一",
        "Naohide Fukuhara": "福原直英",
        "Tomoki Kondo": "近藤智樹",
        "Keita Matsumoto": "松本圭太",
        "Asakawa": "浅川",
    }
    text = plain_wikitext(value)
    pairs = re.findall(r"([A-Za-zÀ-ž.'’\- ]+?)\s*\(([^()]*)\)", text)
    out: list[dict[str, str]] = []
    seen = set()
    for actor_english, role_english in pairs:
        actor_english = re.sub(r"^(?:Part\s*\d+|Special guests?)\s*:\s*", "", actor_english, flags=re.I).strip(" ,")
        role_english = re.sub(r"^\?+\s*[-=]*>\s*", "", role_english).strip()
        role_key = aliases.get(english_identity_key(role_english), english_identity_key(role_english))
        character = by_english.get(role_key)
        if character:
            item = {
                "name": str(character.get("cv") or character.get("cv_zh") or actor_english),
                "role": str(character.get("ja") or character.get("zh") or role_english),
                "source_kind": "community_archive",
                "source_url": source_url,
            }
        elif role_key in supplementary:
            actor, role = supplementary[role_key]
            item = {"name": actor, "role": role, "source_kind": "community_archive", "source_url": source_url}
        else:
            item = {
                "name": external_names.get(actor_english, actor_english),
                "role": plain_wikitext(role_english),
                "person_type": "external_guest",
                "source_kind": "community_archive",
                "source_url": source_url,
            }
        key = (fold_name(item["name"]), fold_name(item["role"]))
        if key not in seen:
            seen.add(key)
            out.append(item)
    special_match = re.search(r"Special guests?:\s*Yoohei Kawakami and Masaki Shirai", text, re.I)
    if special_match:
        for english_name in ("Yoohei Kawakami", "Masaki Shirai"):
            item = {
                "name": external_names[english_name],
                "role": "[Alexandros]",
                "person_type": "external_guest",
                "source_kind": "community_archive",
                "source_url": source_url,
            }
            key = (fold_name(item["name"]), fold_name(item["role"]))
            if key not in seen:
                seen.add(key)
                out.append(item)
    return out


def historical_programs() -> list[dict[str, Any]]:
    characters = read_window_data(DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    programs: list[dict[str, Any]] = []
    main_source = fetch_text_url(PAKALIVE_ARCHIVE_PAGES["paka-live-tv"] + "?action=raw")
    for cells in wiki_table_rows(main_source, "PakaLive TV Volumes"):
        volume = plain_wikitext(cells[0]) if cells else ""
        if not volume.isdigit() or len(cells) < 5:
            continue
        number = int(volume)
        date = wiki_archive_date(cells[1])
        cast = historical_cast(" ".join(cells[3:5]), characters, PAKALIVE_ARCHIVE_PAGES["paka-live-tv"])
        duration_match = re.search(r"(\d+)\s*min", plain_wikitext(cells[8]) if len(cells) > 8 else "", re.I)
        programs.append({
            "id": f"paka-live-tv-{number:03d}",
            "series_id": "paka-live-tv",
            "title": f"ぱかライブTV Vol.{number}",
            "date": date,
            "video_id": "",
            "url": "",
            "thumbnail": "",
            "duration": int(duration_match.group(1)) * 60 if duration_match else None,
            "cast_status": "verified",
            "cast": cast,
            "characters": [],
            "sessions": [],
            "summary": plain_wikitext(cells[2]),
            "source_kind": "community_archive",
            "source_url": PAKALIVE_ARCHIVE_PAGES["paka-live-tv"],
        })
    for cells in wiki_table_rows(main_source, "Abema Stakes episodes"):
        volume = plain_wikitext(cells[0]) if cells else ""
        match = re.fullmatch(r"(\d+)R", volume, re.I)
        if not match or len(cells) < 4:
            continue
        number = int(match.group(1))
        date = wiki_archive_date(cells[1])
        cast = historical_cast(cells[3], characters, PAKALIVE_ARCHIVE_PAGES["paka-live-tv"])
        duration_match = re.search(r"(\d+)\s*m", plain_wikitext(cells[6]) if len(cells) > 6 else "", re.I)
        programs.append({
            "id": f"official-special-abema-stakes-{number:02d}",
            "series_id": "official-special",
            "title": f"Abemaステークス 第{number}R",
            "date": date,
            "video_id": "",
            "url": "",
            "thumbnail": "",
            "duration": int(duration_match.group(1)) * 60 if duration_match else None,
            "cast_status": "verified",
            "cast": cast,
            "characters": [],
            "sessions": [],
            "summary": plain_wikitext(cells[2]),
            "source_kind": "community_archive",
            "source_url": PAKALIVE_ARCHIVE_PAGES["paka-live-tv"],
        })
    dash_source = fetch_text_url(PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"] + "?action=raw")
    for cells in wiki_table_rows(dash_source, "PakaLive TV Dash Volumes"):
        volume = plain_wikitext(cells[0]) if cells else ""
        if not volume.isdigit() or len(cells) < 6:
            continue
        number = int(volume)
        date = wiki_archive_date(cells[1])
        cast = historical_cast(" ".join(cells[3:5]), characters, PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"])
        guest_text = plain_wikitext(cells[5])
        if guest_text:
            guest_name = re.split(r"\s*\(", guest_text, maxsplit=1)[0].strip()
            guest_map = {"Takeshi Itazu": "板津雄志", "Koichi Tsunoda": "角田晃一", "Naohide Fukuhara": "福原直英", "Tomoki Kondo": "近藤智樹", "Keita Matsumoto": "松本圭太", "Asakawa": "浅川"}
            cast.append({
                "name": guest_map.get(guest_name, guest_name),
                "role": re.search(r"\(([^)]+)\)", guest_text).group(1) if re.search(r"\(([^)]+)\)", guest_text) else "现实嘉宾",
                "person_type": "external_guest",
                "source_kind": "community_archive",
                "source_url": PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"],
            })
        duration_match = re.search(r"(\d+)\s*min", plain_wikitext(cells[9]) if len(cells) > 9 else "", re.I)
        programs.append({
            "id": f"paka-live-tv-prime-{number:03d}",
            "series_id": "paka-live-tv-prime",
            "title": f"ぱかライブTV' #{number}",
            "date": date,
            "video_id": "",
            "url": "",
            "thumbnail": "",
            "duration": int(duration_match.group(1)) * 60 if duration_match else None,
            "cast_status": "verified",
            "cast": cast,
            "characters": [],
            "sessions": [],
            "summary": plain_wikitext(cells[2]),
            "source_kind": "community_archive",
            "source_url": PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"],
        })
    return programs


def official_radio_programs(existing_programs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    series_id = "all-night-nippon-gold"
    first_url = "https://www.allnightnippon.com/umamusume/umamusume_blog/20260428-105161/"
    trailer_url = "https://www.youtube.com/watch?v=k66w0hd_6Ms"
    rows: list[dict[str, Any]] = [
        {
            "id": "all-night-nippon-gold-001",
            "series_id": series_id,
            "title": "ウマ娘のオールナイトニッポンGOLD 第1回",
            "date": "2026-05-08",
            "cast_status": "verified",
            "cast": [
                {"name": "上田瞳", "role": "ゴールドシップ"},
                {"name": "日笠陽子", "role": "オルフェーヴル"},
                {"name": "松田颯水", "role": "ステイゴールド"},
                {"name": "荘口彰久", "role": "アシスタント", "person_type": "external_guest"},
            ],
            "summary": "ニッポン放送をキーステーションに全国19局ネットで生放送。",
            "source_kind": "official_broadcaster",
            "source_url": first_url,
            "sources": [{"kind": "official_broadcaster", "label": "节目官方页", "url": first_url}],
        },
        {
            "id": "all-night-nippon-gold-002",
            "series_id": series_id,
            "title": "ウマ娘のオールナイトニッポンGOLD 第2回",
            "date": "2026-07-24",
            "cast_status": "verified",
            "cast": [
                {"name": "藤本侑里", "role": "ジャングルポケット"},
                {"name": "福嶋晴菜", "role": "ダンツフレーム"},
                {"name": "徳井青空", "role": "テイエムオペラオー"},
                {"name": "オーイシマサヨシ", "role": "ゲスト", "person_type": "external_guest"},
            ],
            "summary": "劇場版『新時代の扉』出演者を中心にしたラジオ特別番組。",
            "source_kind": "official_youtube",
            "source_url": trailer_url,
            "sources": [{"kind": "official_youtube", "label": "官方 YouTube", "url": trailer_url}],
        },
    ]
    known = {row["id"]: row for row in [*existing_programs, *rows] if row.get("series_id") == series_id}
    dated = sorted(row.get("date") for row in known.values() if row.get("date"))
    latest_date = dt.date.fromisoformat(dated[-1]) if dated else dt.date(2026, 5, 8)
    try:
        page = fetch_text_url(ANN_PROGRAM_URL)
        description_match = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', page, re.I)
        description = html.unescape(description_match.group(1)) if description_match else clean_text(page)
        date_match = re.search(r"(\d{1,2})月(\d{1,2})日", description)
        if date_match:
            month, day = int(date_match.group(1)), int(date_match.group(2))
            page_date = None
            for year in range(latest_date.year, latest_date.year + 3):
                try:
                    candidate = dt.date(year, month, day)
                except ValueError:
                    continue
                if candidate > dt.date(2026, 5, 8):
                    page_date = candidate
                    if candidate >= latest_date:
                        break
            if page_date:
                matching_id = next((event_id for event_id, row in known.items() if row.get("date") == page_date.isoformat()), "")
                if not matching_id:
                    matching_id = next(
                        (f"all-night-nippon-gold-{number:03d}" for number in range(1, 7)
                         if not known.get(f"all-night-nippon-gold-{number:03d}", {}).get("date")),
                        "",
                    )
                cast = []
                for role, name in re.findall(r"([ァ-ヺー一-龯々〆ヵヶA-Za-z・]+)役の([ぁ-ゖァ-ヺー一-龯々〆ヵヶA-Za-z・]+)", description):
                    cast.append({"name": name, "role": role})
                assistant = re.search(
                    r"アシスタントは(?:フリーアナウンサーの)?"
                    r"([ぁ-ゖァ-ヺー一-龯々〆ヵヶA-Za-z・]+?)(?:が担当|[、。])",
                    description,
                )
                if assistant:
                    cast.append({"name": assistant.group(1), "role": "アシスタント", "person_type": "external_guest"})
                if matching_id and cast:
                    number = int(matching_id.rsplit("-", 1)[1])
                    rows.append({
                        "id": matching_id,
                        "series_id": series_id,
                        "title": f"ウマ娘のオールナイトニッポンGOLD 第{number}回",
                        "date": page_date.isoformat(),
                        "cast_status": "verified",
                        "cast": cast,
                        "summary": clean_text(description)[:300],
                        "source_kind": "official_broadcaster",
                        "source_url": ANN_PROGRAM_URL,
                        "sources": [{"kind": "official_broadcaster", "label": "节目官方页", "url": ANN_PROGRAM_URL}],
                    })
    except Exception:
        pass
    complete_ids = {row["id"] for row in [*existing_programs, *rows] if row.get("series_id") == series_id and row.get("date")}
    for number in range(3, 7):
        event_id = f"all-night-nippon-gold-{number:03d}"
        if event_id in complete_ids:
            continue
        rows.append({
            "id": event_id,
            "series_id": series_id,
            "title": f"ウマ娘のオールナイトニッポンGOLD 第{number}回",
            "date": "",
            "cast_status": "announced_tba",
            "cast": [],
            "characters": [],
            "sessions": [],
            "schedule_status": "announced_tba",
            "metadata_status": "announced_tba",
            "summary": "全6回的特别广播已由官方宣布；本期日期与出演阵容尚未公布。",
            "source_kind": "official_youtube",
            "source_url": trailer_url,
            "sources": [{"kind": "official_youtube", "label": "官方 YouTube", "url": trailer_url}],
        })
    return rows


def balanced_template(source: str, name: str) -> str:
    start = source.find("{{" + name)
    if start < 0:
        return ""
    depth = 0
    index = start
    while index < len(source) - 1:
        pair = source[index:index + 2]
        if pair == "{{":
            depth += 1
            index += 2
            continue
        if pair == "}}":
            depth -= 1
            index += 2
            if depth == 0:
                return source[start:index]
            continue
        index += 1
    return ""


def template_fields(template: str) -> dict[str, str]:
    matches = list(re.finditer(r"^\|\s*([^=\n]+?)\s*=\s*", template, re.M))
    fields = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(template)
        fields[match.group(1).strip()] = template[match.end():end].strip()
    return fields


def clean_wikipedia_field(value: str) -> str:
    text = re.sub(r"<!--.*?-->", "", str(value or ""), flags=re.S)
    text = re.sub(r"<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>", "", text, flags=re.I | re.S)
    text = re.sub(r"\{\{(?:JPN|Japan)\}\}", "", text, flags=re.I)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("'''", "").replace("''", "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip(" ・")


def wikipedia_raw(title: str) -> str:
    query = urllib.parse.urlencode({"title": title, "action": "raw"})
    return fetch_text_url("https://ja.wikipedia.org/w/index.php?" + query)


def wikipedia_person_template(source: str) -> tuple[str, dict[str, str]]:
    for template_name in ("声優", "ActorActress", "騎手"):
        template = balanced_template(source, template_name)
        if template:
            return template_name, template_fields(template)
    return "", {}


def wikipedia_biography_page(source: str) -> bool:
    if wikipedia_person_template(source)[0]:
        return True
    prefix = source[:6000]
    if re.search(r"[{][{][^{}\n]*(?:aimai|曖昧さ回避)[^{}\n]*[}][}]", prefix, re.I):
        return False
    return bool(re.search(r"'''[^']+'''.{0,800}(?:声優|俳優|歌手|騎手|アナウンサー|プロ野球選手)", prefix, re.S))


def wikipedia_title_key(value: str) -> str:
    base = re.sub(r"\s*[_(（][^)）]+[)）]\s*$", "", value or "")
    return fold_name(base)


def wikipedia_voice_page(candidates: list[str]) -> tuple[str, str]:
    tried = set()
    for candidate in candidates:
        if not candidate or candidate in tried:
            continue
        tried.add(candidate)
        try:
            source = wikipedia_raw(candidate)
        except Exception:
            continue
        redirect = re.match(r"#(?:REDIRECT|転送)\s*\[\[([^\]]+)\]\]", source, re.I)
        if redirect:
            try:
                candidate = redirect.group(1)
                source = wikipedia_raw(candidate)
            except Exception:
                continue
        if wikipedia_biography_page(source):
            return candidate, source
    candidate_keys = {wikipedia_title_key(value) for value in candidates if value}
    query = urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": (candidates[0] if candidates else "") + " 声優",
        "srlimit": 3, "format": "json", "formatversion": 2,
    })
    try:
        result = fetch_json_url("https://ja.wikipedia.org/w/api.php?" + query)
    except Exception:
        return "", ""
    for row in (result.get("query") or {}).get("search") or []:
        title = row.get("title") or ""
        if title in tried or wikipedia_title_key(title) not in candidate_keys:
            continue
        try:
            source = wikipedia_raw(title)
        except Exception:
            continue
        if wikipedia_biography_page(source):
            return title, source
    return "", ""


def voice_detail_from_wikipedia(name_zh: str, name_ja: str, aliases: list[str]) -> dict[str, Any]:
    page_title, source = wikipedia_voice_page([name_ja, *aliases, name_zh])
    template_name, fields = wikipedia_person_template(source) if source else ("", {})
    month = re.sub(r"\D", "", fields.get("生月") or "")
    day = re.sub(r"\D", "", fields.get("生日") or "")
    if not (month and day):
        birthday_source = fields.get("生") or source[:5000]
        birthday_match = re.search(r"(?:生年月日と年齢|birth date and age)\s*\|\s*\d{4}\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", birthday_source, re.I)
        if not birthday_match:
            birthday_match = re.search(r"\[\[(?:19|20)\d{2}年\]\]\s*\[\[(\d{1,2})月\]\]\s*\[\[(\d{1,2})日\]\]", birthday_source)
        if birthday_match:
            month, day = birthday_match.groups()
    birthday = f"{int(month)}月{int(day)}日" if month and day else ""
    birthplace = clean_wikipedia_field(fields.get("出身地") or fields.get("出生地") or fields.get("出") or "")
    agency = clean_wikipedia_field(fields.get("事務所") or "")
    official_field = fields.get("公式サイト") or ""
    official_match = re.search(r"https?://[^\s\]|<]+", official_field)
    official_profile = official_match.group(0) if official_match else ""
    kana = clean_wikipedia_field(fields.get("ふりがな") or "")
    canonical_field = fields.get("名前") or fields.get("芸名") or fields.get("名") or ""
    canonical_ja = re.sub(r"\s+", "", clean_wikipedia_field(canonical_field)) or re.sub(r"\s+", "", re.sub(r"\s*\([^)]*\)$", "", page_title)) or name_ja
    source_url = "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(page_title.replace(" ", "_")) if page_title else ""
    values = {"birthday": birthday, "birthplace": birthplace, "agency": agency, "official_profile": official_profile}
    missing_status = "not_applicable" if source and template_name not in ("声優", "ActorActress") else "not_published"
    return {
        "lookup_name": name_ja,
        "name_zh": name_zh,
        "name_ja": canonical_ja,
        "aliases": list(dict.fromkeys(
            alias for alias in [name_ja, *aliases] if alias and alias not in (name_zh, canonical_ja)
        )),
        "kana": kana,
        **values,
        "field_status": {key: "verified" if value else ("source_unavailable" if not source else missing_status) for key, value in values.items()},
        "status": "complete" if source else "source_unavailable",
        "sources": ([{"kind": "wikipedia", "label": "日文维基百科", "url": source_url}] if source_url else []),
    }


def official_profile_photo(profile_url: str) -> dict[str, str]:
    """Resolve a portrait from a supported official agency profile.

    The profile page remains the cited source even when an agency exposes its
    image through a separate JSON endpoint. Unknown sites use conservative
    page metadata or an explicitly named profile-photo container.
    """
    if not profile_url:
        return {}
    parsed = urllib.parse.urlparse(profile_url)
    image_url = ""
    if parsed.netloc.endswith("across-ent.com"):
        talent_id = (urllib.parse.parse_qs(parsed.query).get("id") or [""])[0]
        if talent_id:
            endpoint = "https://acrossent-admin.sakuraweb.com/_v1.php/talentview?" + urllib.parse.urlencode({
                "query": "view",
                "id": talent_id,
            })
            payload = fetch_json_url(endpoint)
            image_url = str((payload.get("talent") or {}).get("image_path1") or "")
    else:
        source = fetch_text_url(profile_url)
        patterns = (
            r'<div\b[^>]*class=["\'][^"\']*\bphoto\b[^"\']*["\'][^>]*>[\s\S]{0,500}?<img\b[^>]*src=["\']([^"\']+)',
            r'<link\b[^>]*rel=["\']image_src["\'][^>]*href=["\']([^"\']+)',
            r'<meta\b[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)',
            r'<meta\b[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']',
        )
        for pattern in patterns:
            match = re.search(pattern, source, re.I)
            if match:
                image_url = urllib.parse.urljoin(profile_url, html.unescape(match.group(1)))
                break
    if not image_url:
        return {}
    return {
        "photo_url": image_url,
        "photo_source_url": profile_url,
        "photo_source_title": "官方事务所资料页",
    }


def refresh_voice_actor_details() -> dict[str, Any]:
    characters = read_window_data(DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    voice_list = read_window_data(DATA_DIR / "voice_list_data.js", "VA_LIST")
    photos = read_window_data(DATA_DIR / "va_photos_data.js", "VA_PHOTOS")
    overrides = read_json(EVENTS_DIR / "overrides.json")
    identity_registry = read_json(VOICE_IDENTITIES_FILE)
    previous_details = read_json(VOICE_DETAILS_FILE).get("records") or [] if VOICE_DETAILS_FILE.exists() else []
    previous_by_lookup = {
        fold_name(str(record.get("lookup_name") or "")): record
        for record in previous_details
        if record.get("lookup_name") and record.get("sources")
    }
    identities = IdentityIndex(characters, voice_list, photos, overrides, identity_registry)
    reverse_aliases: dict[str, list[str]] = defaultdict(list)
    for alias, canonical in (overrides.get("voice_aliases") or {}).items():
        reverse_aliases[fold_name(str(canonical))].append(str(alias))
    profile_overrides = {
        fold_name(str(name)): value
        for name, value in (overrides.get("voice_actor_profile_overrides") or {}).items()
    }

    def fetch(profile: dict[str, Any]) -> dict[str, Any]:
        identity = profile["identity"]
        aliases = [*identity.get("aliases", []), *reverse_aliases.get(fold_name(identity.get("ja") or ""), [])]
        record = voice_detail_from_wikipedia(identity.get("zh") or "", identity.get("ja") or "", aliases)
        if not record.get("sources"):
            previous = previous_by_lookup.get(fold_name(identity.get("ja") or ""))
            if previous:
                record = dict(previous)
        patch = next(
            (profile_overrides.get(fold_name(name)) for name in (identity.get("ja"), identity.get("zh"), *aliases) if profile_overrides.get(fold_name(name))),
            None,
        )
        if patch:
            record.update({key: value for key, value in patch.items() if key != "sources"})
            record["sources"] = list({
                (source.get("kind"), source.get("url")): source
                for source in [*record.get("sources", []), *patch.get("sources", [])]
                if source.get("url")
            }.values())
            field_status = dict(record.get("field_status") or {})
            for field in ("birthday", "birthplace", "agency", "official_profile"):
                if patch.get(field):
                    field_status[field] = "verified"
            record["field_status"] = field_status
            record["status"] = "complete"
        if not profile.get("photo", {}).get("url") and record.get("official_profile"):
            try:
                record.update(official_profile_photo(str(record["official_profile"])))
            except Exception:
                previous = previous_by_lookup.get(fold_name(identity.get("ja") or "")) or {}
                for field in ("photo_url", "photo_source_url", "photo_source_title"):
                    if previous.get(field):
                        record[field] = previous[field]
        return record

    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        for record in executor.map(fetch, identities.profiles):
            records.append(record)
    records.sort(key=lambda row: fold_name(row.get("name_ja") or row.get("name_zh") or ""))
    return {
        "schema_version": 2,
        "source": "Japanese Wikipedia voice-actor infoboxes, with portraits resolved from cited official agency profiles when the local photo index has no entry",
        "refreshed_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "coverage": {
            "records": len(records),
            "source_pages": sum(bool(row.get("sources")) for row in records),
            "complete_fields": {
                field: sum(bool(row.get(field)) for row in records)
                for field in ("birthday", "birthplace", "agency", "official_profile")
            },
            "official_profile_photos": sum(bool(row.get("photo_url")) for row in records),
            "accounted_fields": {
                field: sum((row.get("field_status") or {}).get(field) in ("verified", "not_published", "not_applicable", "source_unavailable") for row in records)
                for field in ("birthday", "birthplace", "agency", "official_profile")
            },
        },
        "records": records,
    }


def fetch_video_metadata(video_id: str) -> dict[str, Any] | None:
    command = ["yt-dlp", "--skip-download", "--no-warnings", "--dump-single-json", f"https://www.youtube.com/watch?v={video_id}"]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8", timeout=90)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None


def discover_channel_feed(feed: str, limit: int) -> list[dict[str, Any]]:
    command = ["yt-dlp", "--flat-playlist", "--playlist-end", str(limit), "--no-warnings", "--dump-json", f"https://www.youtube.com/@UMAMUSUME_official/{feed}"]
    result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8", timeout=300)
    rows = []
    for line in result.stdout.splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def discover_official_channel() -> list[dict[str, Any]]:
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(discover_channel_feed, "videos", 1600),
            executor.submit(discover_channel_feed, "streams", 400),
        ]
        for future in futures:
            try:
                rows.extend(future.result())
            except (OSError, subprocess.SubprocessError):
                continue
    by_id = {str(row["id"]): row for row in rows if row.get("id")}
    return list(by_id.values())


def is_pakatube_character_program(title: str) -> bool:
    value = unicodedata.normalize("NFKC", title or "")
    if program_identity(value)[0]:
        return False
    if re.search(r"(?:CM|PV|MV|ショート|Shorts|特報|ティザー|トレーラー)", value, re.I):
        return False
    return bool(re.search(
        r"ゲーム実況|ボドゲ実況|お絵かき配信|打ち上げプチ配信|^【配信】|同時視聴|"
        r"ぱかチューブっ!出張版|ぴすラジッ|ゴルシトーク|ぱかトークっ!|"
        r"完全密着|梅雨特別企画|焼肉シミュレーター|メカダービー",
        value,
        re.I,
    ))


def is_official_special_video(title: str) -> bool:
    value = unicodedata.normalize("NFKC", title or "")
    return bool(
        re.fullmatch(r"そこそこぱかライブTV\s*-EXTRA STAGE-", value, re.I)
        or re.search(r"うまよん.*オーディオコメンタリーリレー第\d+回", value, re.I)
    )


def announcement_identity(title: str, message: str, date: str) -> tuple[str, str]:
    regular = program_identity(title)
    if not regular[0]:
        regular = program_identity(clean_text(message))
    if regular[0]:
        return regular
    value = unicodedata.normalize("NFKC", title or "")
    if "ぱかスペース" in value and "同時視聴" in value:
        match = re.search(r"(\d+(?:st|nd|rd|th)\s*EVENT\s*-[A-Z ]+-)", value, re.I)
        suffix = stable_title_suffix(match.group(1) if match else value)
        return f"official-special-paka-space-{suffix}", "official-special"
    if "ウマ娘が出走決定" in value and re.search(r"放送|テレビ|NHK", value, re.I):
        match = re.search(r"[「『]([^」』]+)[」』]", value)
        program_name = match.group(1) if match else value
        return f"official-special-{date.replace('-', '') or 'undated'}-{stable_title_suffix(program_name)}", "official-special"
    return "", ""


def is_official_program_announcement(title: str) -> bool:
    value = unicodedata.normalize("NFKC", title or "")
    regular = bool(program_identity(value)[0] and re.search(r"放送|配信|公開", value) and "発表まとめ" not in value)
    return bool(
        regular
        or ("ぱかスペース" in value and "同時視聴" in value)
        or ("ウマ娘が出走決定" in value and re.search(r"放送|テレビ|NHK", value, re.I))
        or ("そこぱか" in value and "生放送" in value and "振り返りスペシャル" in value)
    )


def fetch_json_url(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "uma-live-wiki event updater"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def official_news_programs() -> list[dict[str, Any]]:
    index_rows = []
    first = fetch_json_url("https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1")
    index_rows.extend(first.get("information_list") or [])
    total_pages = int(first.get("total_page_count") or 1)

    def fetch_page(page: int) -> list[dict[str, Any]]:
        try:
            return fetch_json_url(f"https://umamusume.jp/api/ajax/pr_info_index?format=json&page={page}").get("information_list") or []
        except Exception:
            return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for rows in executor.map(fetch_page, range(2, total_pages + 1)):
            index_rows.extend(rows)
    candidates = []
    for row in index_rows:
        if is_official_program_announcement(row.get("title") or ""):
            candidates.append(row)

    def fetch_detail(row: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            data = fetch_json_url(f"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id={row['announce_id']}")
            return row, data.get("detail") or {}
        except Exception:
            return row, {}

    programs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for row, detail in executor.map(fetch_detail, candidates):
            title = detail.get("title") or row.get("title") or ""
            message = detail.get("message") or ""
            fallback_date = first_date(detail.get("post_at") or row.get("post_at"))
            date = parse_program_date(message) or first_date(message) or fallback_date
            event_id, series_id = announcement_identity(title, message, date)
            if not event_id:
                continue
            youtube_match = re.search(r"https?://(?:www\.)?(?:youtube\.com/(?:live|watch\?v=)|youtu\.be/)([A-Za-z0-9_-]{11})", html.unescape(message))
            video_id = youtube_match.group(1) if youtube_match else ""
            video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else ""
            official_url = f"https://umamusume.jp/news/detail?id={row['announce_id']}"
            program_message = message
            if "プレミアの巣窟" in title or "ONE SONG FES" in title:
                program_message = re.split(r"[「『]TOKYO IDOL FESTIVAL[^」』]*[」』]概要", message, maxsplit=1)[0]
            sessions = parse_program_sessions(program_message, date)
            cast = parse_program_cast(program_message) or parse_intro_cast(program_message)
            if "プレミアの巣窟" in title and not sessions:
                schedule_text = re.split(r"※放送時間|番組概要", "\n".join(program_text_lines(program_message)), maxsplit=1)[0]
                parsed_dates = all_dates(schedule_text)
                if len(parsed_dates) > 1:
                    sessions = [{"label": f"第{index + 1}回", "date": value, "cast": cast} for index, value in enumerate(parsed_dates[:2])]
            programs.append({
                "id": event_id, "series_id": series_id, "title": title, "date": date,
                "end_date": sessions[-1]["date"] if sessions and sessions[-1].get("date") else date,
                "video_id": video_id, "url": video_url, "thumbnail": row.get("image") or "", "duration": None,
                "cast_status": "verified" if cast else "pending", "cast": cast, "characters": [], "sessions": sessions,
                "summary": clean_text(message)[:260], "source_kind": "official_announcement", "source_url": official_url,
            })
    return programs


def refresh_programs() -> dict[str, Any]:
    existing_doc = read_json(EVENTS_DIR / "official_programs.json") if (EVENTS_DIR / "official_programs.json").exists() else {"programs": []}
    existing_programs = list(existing_doc.get("programs") or [])
    youtube_available = bool(shutil_which("yt-dlp"))
    channel_entries = discover_official_channel() if youtube_available else []
    rebuild_regular = int(existing_doc.get("schema_version") or 1) < 2 and bool(channel_entries)
    expected_ids = expected_regular_program_ids([*existing_programs, *channel_entries])
    expected_id_values = set(expected_ids.values())
    programs = []
    for row in existing_programs:
        event_id, series_id = program_identity(row.get("title") or "")
        if rebuild_regular and event_id and series_id in REGULAR_PROGRAM_BASELINES:
            continue
        if event_id and series_id in REGULAR_PROGRAM_BASELINES and "発表まとめ" in (row.get("title") or ""):
            continue
        if not event_id or series_id not in REGULAR_PROGRAM_BASELINES or row.get("id") in expected_id_values:
            programs.append(row)
    existing_video_ids = {
        str(video_id)
        for row in programs
        for video_id in [row.get("video_id"), *(item.get("video_id") for item in row.get("media") or [])]
        if video_id
    }
    candidates = {
        str(row["id"]): row
        for row in channel_entries
        if row.get("id")
        and (
            (program_identity(row.get("title") or "")[0] in expected_id_values and str(row["id"]) not in existing_video_ids)
            or (is_pakatube_character_program(row.get("title") or "") and str(row["id"]) not in existing_video_ids)
            or (is_official_special_video(row.get("title") or "") and str(row["id"]) not in existing_video_ids)
        )
    }
    fetched_metadata = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_video_metadata, video_id): video_id for video_id in candidates}
        for future in concurrent.futures.as_completed(futures):
            metadata = future.result()
            if not metadata or metadata.get("channel_id") != OFFICIAL_CHANNEL_ID:
                continue
            fetched_metadata.append(metadata)
            event_id, series_id = program_identity(metadata.get("title") or "")
            if not event_id:
                continue
            description = metadata.get("description") or ""
            broadcast_date = parse_program_date(description)
            if not broadcast_date:
                raw_date = metadata.get("upload_date") or ""
                broadcast_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}" if len(raw_date) == 8 else ""
            cast = parse_program_cast(description)
            programs.append({
                "id": event_id, "series_id": series_id, "title": metadata.get("title") or "", "date": broadcast_date,
                "video_id": metadata.get("id") or "", "url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}",
                "thumbnail": metadata.get("thumbnail") or "", "duration": metadata.get("duration"),
                "cast_status": "verified" if cast else "pending", "cast": cast, "characters": [],
                "sessions": parse_program_sessions(description, broadcast_date),
                "summary": next((line.strip() for line in description.splitlines() if line.strip()), ""),
                "source_kind": "official_youtube", "source_url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}",
            })
    try:
        news_programs = official_news_programs()
    except Exception:
        news_programs = []
    programs.extend(news_programs)
    try:
        programs.extend(historical_programs())
    except Exception:
        # The committed snapshot remains authoritative when the supplementary
        # archive is temporarily unavailable.
        pass
    programs.extend(official_radio_programs(existing_programs))
    character_metadata = [metadata for metadata in fetched_metadata if is_pakatube_character_program(metadata.get("title") or "")]
    character_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for metadata in character_metadata:
        base_title = re.sub(r"【[^】]*(?:視点)[^】]*】\s*$", "", metadata.get("title") or "").strip()
        raw_date = metadata.get("upload_date") or ""
        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}" if len(raw_date) == 8 else ""
        character_groups[f"{date}\t{base_title}"].append(metadata)
    for group_key, group in character_groups.items():
        metadata = sorted(group, key=lambda row: row.get("id") or "")[0]
        raw_date = metadata.get("upload_date") or ""
        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}" if len(raw_date) == 8 else ""
        description = metadata.get("description") or ""
        base_title = group_key.split("\t", 1)[1]
        suffix = stable_suffix(base_title) or metadata["id"]
        media = [
            {"url": item.get("webpage_url") or f"https://www.youtube.com/watch?v={item['id']}", "label": "官方视频", "video_id": item.get("id") or "", "duration": item.get("duration")}
            for item in sorted(group, key=lambda row: row.get("title") or "")
        ]
        programs.append({
            "id": f"pakatube-{date.replace('-', '') or 'undated'}-{suffix}", "series_id": "pakatube-character-program", "title": base_title,
            "date": date, "video_id": metadata.get("id") or "", "url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata['id']}",
            "thumbnail": metadata.get("thumbnail") or "", "duration": metadata.get("duration"),
            "cast_status": "character_only", "cast": [], "characters": [],
            "summary": clean_text(description)[:500] or "角色出演节目。未将角色配音关系记作声优本人出演。",
            "source_kind": "official_youtube", "source_url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata['id']}",
            "media": media,
            "sources": [{"kind": "official_youtube", "label": "官方 YouTube", "url": item["url"]} for item in media],
        })
    for metadata in fetched_metadata:
        if not is_official_special_video(metadata.get("title") or ""):
            continue
        description = metadata.get("description") or ""
        raw_date = metadata.get("upload_date") or ""
        date = parse_program_date(description) or (f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}" if len(raw_date) == 8 else "")
        cast = parse_program_cast(description)
        url = metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}"
        programs.append({
            "id": f"official-special-{date.replace('-', '') or 'undated'}-{stable_title_suffix(metadata.get('title') or '')}",
            "series_id": "official-special",
            "title": metadata.get("title") or "",
            "date": date,
            "video_id": metadata.get("id") or "",
            "url": url,
            "thumbnail": metadata.get("thumbnail") or "",
            "duration": metadata.get("duration"),
            "cast_status": "verified" if cast else "pending",
            "cast": cast,
            "characters": [],
            "sessions": parse_program_sessions(description, date),
            "summary": next((line.strip() for line in description.splitlines() if line.strip()), ""),
            "source_kind": "official_youtube",
            "source_url": url,
        })

    def implicit_sources(row: dict[str, Any]) -> list[dict[str, str]]:
        if row.get("sources"):
            return list(row["sources"])
        source_url = row.get("source_url") or row.get("url") or ""
        if not source_url:
            return []
        source_kind = row.get("source_kind") or "official_youtube"
        labels = {
            "official_announcement": "官方公告",
            "official_youtube": "官方 YouTube",
            "community_archive": "Umamusume Wiki 补档",
            "official_broadcaster": "节目官方页",
        }
        return [{"kind": source_kind, "label": labels.get(source_kind, "资料来源"), "url": source_url}]

    # Combine archive metadata and announcements under one stable program ID.
    # The richer record supplies presentation fields; all evidence links, cast,
    # media, and session-specific cast remain available.
    by_id: dict[str, dict[str, Any]] = {}
    for program in sorted(programs, key=lambda row: (bool(row.get("cast")), bool(row.get("video_id")), row.get("date") or "", row.get("video_id") or "")):
        event_id = program["id"]
        if event_id not in by_id:
            by_id[event_id] = dict(program)
            by_id[event_id]["sources"] = implicit_sources(program)
            continue
        target = by_id[event_id]
        target_priority = PROGRAM_SOURCE_PRIORITY.get(str(target.get("source_kind") or ""), 0)
        program_priority = PROGRAM_SOURCE_PRIORITY.get(str(program.get("source_kind") or ""), 0)
        richer = program_priority > target_priority or (
            program_priority == target_priority
            and (bool(program.get("cast")) or bool(program.get("video_id")))
        )
        if richer:
            for field in ("title", "date", "end_date", "video_id", "url", "thumbnail", "duration", "summary", "source_kind", "source_url", "schedule_status", "metadata_status"):
                if program.get(field):
                    target[field] = program[field]
        target["sources"] = list({(item.get("kind"), item.get("url")): item for item in [*target.get("sources", []), *implicit_sources(program)] if item.get("url")}.values())
        target["media"] = list({item.get("video_id") or item.get("url"): item for item in [*target.get("media", []), *program.get("media", [])] if item.get("video_id") or item.get("url")}.values())
        target["cast"] = list({(fold_name(item.get("name") or ""), fold_name(item.get("role") or "")): item for item in [*target.get("cast", []), *program.get("cast", [])] if item.get("name")}.values())
        sessions_by_key = {}
        for session in [*target.get("sessions", []), *program.get("sessions", [])]:
            key = (session.get("label"), session.get("date"))
            if key not in sessions_by_key:
                sessions_by_key[key] = dict(session)
                continue
            merged = sessions_by_key[key]
            merged["cast"] = list({
                (fold_name(item.get("name") or ""), fold_name(item.get("role") or "")): item
                for item in [*merged.get("cast", []), *session.get("cast", [])]
                if item.get("name")
            }.values())
        target["sessions"] = list(sessions_by_key.values())
        if target.get("cast"):
            target["cast_status"] = "verified"
    # Keep all known episode identities visible even when a retired archive and
    # expired announcement leave metadata incomplete. These records never create
    # cast relationships and are explicitly marked pending.
    for (_, _), event_id in expected_ids.items():
        if event_id in by_id:
            continue
        series_id = event_id.rsplit("-", 1)[0]
        number = int(event_id.rsplit("-", 1)[1])
        name = {"paka-live-tv": "ぱかライブTV", "paka-live-tv-prime": "ぱかライブTV'", "sokosoko-paka-live-tv": "そこそこぱかライブTV"}[series_id]
        marker = f"#{number}" if series_id == "paka-live-tv-prime" else f"Vol.{number}"
        by_id[event_id] = {
            "id": event_id, "series_id": series_id, "title": f"{name} {marker}", "date": "", "video_id": "", "url": "",
            "thumbnail": "", "duration": None, "cast_status": "pending", "cast": [], "characters": [],
            "summary": "节目条目已建立，播出日期、出演者与官方来源链接待补充。", "metadata_status": "pending",
        }
    ordered = sorted(by_id.values(), key=lambda row: (row["series_id"], row["id"]))
    found_ids = {row["id"] for row in ordered if row["id"] in set(expected_ids.values()) and row.get("date") and (row.get("source_url") or row.get("url"))}
    missing_ids = sorted(set(expected_ids.values()) - found_ids)
    return {
        "schema_version": 2,
        "source": f"official YouTube channel {OFFICIAL_CHANNEL_ID} and official portal announcements",
        "refreshed_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "coverage": {
            "official_youtube_refresh": "verified" if channel_entries else ("tool_unavailable" if not youtube_available else "source_unavailable"),
            "expected_regular_episodes": len(expected_ids),
            "records": len(ordered),
            "source_verified_regular_episodes": len(found_ids),
            "metadata_pending_ids": missing_ids,
            "pakatube_character_programs": sum(row.get("series_id") == "pakatube-character-program" for row in ordered),
            "official_special_programs": sum(row.get("series_id") == "official-special" for row in ordered),
        },
        "programs": ordered,
    }


def value_is_present(value: Any) -> bool:
    return value not in (None, "", [], {})


def merge_program_list(field: str, existing: list[Any], discovered: list[Any]) -> list[Any]:
    """Union additive evidence without rewriting an existing record."""
    if field == "sources":
        key = lambda item: (item.get("kind"), item.get("url")) if isinstance(item, dict) else json.dumps(item, ensure_ascii=False, sort_keys=True)
    elif field == "media":
        key = lambda item: (item.get("video_id") or item.get("url")) if isinstance(item, dict) else json.dumps(item, ensure_ascii=False, sort_keys=True)
    else:
        key = lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True)
    merged: list[Any] = []
    seen: set[Any] = set()
    for item in [*existing, *discovered]:
        item_key = key(item)
        if not item_key or item_key in seen:
            continue
        seen.add(item_key)
        merged.append(item)
    return merged


def apply_additive_program_refresh(
    existing_doc: dict[str, Any],
    discovered_doc: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Accept new records and blank-field fills, but never rewrite known data.

    Official-program discovery is unattended on the server. Existing nonempty
    values may include reviewed corrections, so a differing discovery becomes
    a report entry for a maintainer instead of an automatic overwrite.
    Evidence URLs and media cards are additive and may safely accumulate.
    """
    existing_by_id = {
        str(row.get("id") or ""): row
        for row in existing_doc.get("programs") or []
        if row.get("id")
    }
    discovered_by_id = {
        str(row.get("id") or ""): row
        for row in discovered_doc.get("programs") or []
        if row.get("id")
    }
    added_ids: list[str] = []
    retained_missing_ids: list[str] = []
    filled: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    programs: list[dict[str, Any]] = []

    for program_id in sorted(set(existing_by_id) | set(discovered_by_id)):
        existing = existing_by_id.get(program_id)
        discovered = discovered_by_id.get(program_id)
        if existing is None and discovered is not None:
            programs.append(dict(discovered))
            added_ids.append(program_id)
            continue
        if discovered is None and existing is not None:
            programs.append(dict(existing))
            retained_missing_ids.append(program_id)
            continue
        assert existing is not None and discovered is not None
        merged = dict(existing)
        filled_fields: list[str] = []
        source_upgrade = PROGRAM_SOURCE_PRIORITY.get(str(discovered.get("source_kind") or ""), 0) > PROGRAM_SOURCE_PRIORITY.get(
            str(existing.get("source_kind") or ""), 0
        )
        for field, discovered_value in discovered.items():
            if field == "id":
                continue
            existing_value = existing.get(field)
            if field in ("sources", "media"):
                combined = merge_program_list(
                    field,
                    list(existing_value or []),
                    list(discovered_value or []),
                )
                if comparable(combined) != comparable(existing_value or []):
                    merged[field] = combined
                    filled_fields.append(field)
                continue
            if field in ("source_kind", "source_url") and source_upgrade and value_is_present(discovered_value):
                if comparable(existing_value) != comparable(discovered_value):
                    merged[field] = discovered_value
                    filled_fields.append(field)
                continue
            if not value_is_present(existing_value) and value_is_present(discovered_value):
                merged[field] = discovered_value
                filled_fields.append(field)
            elif (
                value_is_present(existing_value)
                and value_is_present(discovered_value)
                and comparable(existing_value) != comparable(discovered_value)
            ):
                conflicts.append({
                    "id": program_id,
                    "field": field,
                    "existing": existing_value,
                    "discovered": discovered_value,
                })
        if filled_fields:
            filled.append({"id": program_id, "fields": sorted(set(filled_fields))})
        programs.append(merged)

    merged_doc = {
        **discovered_doc,
        "programs": sorted(programs, key=lambda row: (str(row.get("series_id") or ""), str(row.get("id") or ""))),
    }
    report = {
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "policy": "add new records and fill blank fields; preserve conflicting nonempty values",
        "counts": {
            "existing": len(existing_by_id),
            "discovered": len(discovered_by_id),
            "result": len(programs),
            "added": len(added_ids),
            "filled": len(filled),
            "conflicts": len(conflicts),
            "retained_missing": len(retained_missing_ids),
        },
        "added_ids": added_ids,
        "filled": filled,
        "conflicts": conflicts,
        "retained_missing_ids": retained_missing_ids,
    }
    return merged_doc, report


def shutil_which(name: str) -> str | None:
    paths = os.environ.get("PATH", "").split(os.pathsep)
    extensions = [""] if os.name != "nt" else os.environ.get("PATHEXT", ".EXE").split(os.pathsep)
    for directory in paths:
        for extension in extensions:
            candidate = Path(directory) / (name + extension)
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def build(programs_override: dict[str, Any] | None = None, details_override: dict[str, Any] | None = None) -> dict[str, Any]:
    source_hashes = {path.name: sha256(path) for path in IMMUTABLE_LIVE_FILES}
    live_data = read_json(DATA_DIR / "live_data.json")
    live_cat_data = read_json(DATA_DIR / "live_cat_data.json")
    albums = read_json(DATA_DIR / "albums.json")
    eventernote = read_json(DATA_DIR / "events_data.json")
    series = read_json(EVENTS_DIR / "series.json")
    programs = programs_override if programs_override is not None else read_json(EVENTS_DIR / "official_programs.json")
    details = details_override if details_override is not None else (read_json(VOICE_DETAILS_FILE) if VOICE_DETAILS_FILE.exists() else {"records": []})
    overrides = read_json(EVENTS_DIR / "overrides.json")
    characters = read_window_data(DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    voice_list = read_window_data(DATA_DIR / "voice_list_data.js", "VA_LIST")
    photos = read_window_data(DATA_DIR / "va_photos_data.js", "VA_PHOTOS")
    identity_registry = read_json(VOICE_IDENTITIES_FILE)
    identities = IdentityIndex(characters, voice_list, photos, overrides, identity_registry, details)
    used: set[str] = set()
    events = numbered_events(live_data, identities, used, overrides.get("stable_event_ids") or {})
    events.extend(category_events(live_cat_data, identities, used))
    attach_eventernote(events, eventernote, identities, used)
    add_programs(events, programs, identities, used)
    events = apply_overrides(events, overrides, identities)
    events = dedupe_events(events)
    for event in events:
        # Source snapshots may retain every named participant. The public cast
        # has one narrower meaning: a verified Uma voice actor appearing as
        # their one canonical character.
        event["cast"] = [
            item for item in event.get("cast") or []
            if item.get("voice_actor_id") and item.get("character_id")
        ]
        if event["cast"]:
            event["cast_status"] = "verified"
        elif event.get("character_ids"):
            event["cast_status"] = "character_only"
        elif event.get("cast_status") != "announced_tba":
            event["cast_status"] = "partial"
    series_by_id = series_lookup(series)
    for event in events:
        event.pop("image_fallback", None)
        event["image"] = resolve_event_cover(event, series_by_id)
        event["setlist_status"] = "verified" if any(
            session.get("setlist_source") for session in event.get("sessions") or []
        ) else "none"
        for source in event.get("sources") or []:
            if source.get("kind") == "curated_live":
                source["label"] = "站内精调歌单" if event["setlist_status"] == "verified" else "站内精调资料"
        for session in event.get("sessions") or []:
            session["setlist_status"] = "verified" if session.get("setlist_source") else "none"
    events.sort(key=lambda event: (event.get("date") or "0000-00-00", event.get("title") or "", event["id"]), reverse=True)
    generated_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    songs_catalog = build_song_catalog(albums, events, identities, generated_at)
    appearances = build_appearance_index(events, songs_catalog, identities)
    profiles = enrich_profiles(identities.profiles, appearances)
    current_hashes = {path.name: sha256(path) for path in IMMUTABLE_LIVE_FILES}
    if current_hashes != source_hashes:
        raise RuntimeError("curated live sources changed during event build")
    kinds = Counter(event.get("kind") or "unknown" for event in events)
    modes = Counter(event.get("mode") or "unknown" for event in events)
    catalog = {
        "schema_version": 1,
        "generated_at": generated_at,
        "source_integrity": {name: {"sha256": digest, "preserved": True} for name, digest in source_hashes.items()},
        "coverage": {
            "events": len(events), "by_kind": dict(sorted(kinds.items())), "by_mode": dict(sorted(modes.items())),
            "official_programs": len(programs.get("programs") or []), "unresolved_cast_names": len(appearances["unresolved_cast"]),
        },
        "series": series.get("series") or [],
        "events": events,
    }
    profiles_doc = {"schema_version": 1, "generated_at": catalog["generated_at"], "voice_actors": profiles}
    appearances["generated_at"] = catalog["generated_at"]
    build_material = {
        "live": live_data, "live_categories": live_cat_data, "albums": albums,
        "eventernote": eventernote, "series": series, "programs": programs,
        "voice_details": details, "overrides": overrides, "characters": characters,
        "voice_list": voice_list, "voice_photos": photos, "voice_identities": identity_registry,
    }
    build_id = hashlib.sha256(
        json.dumps(build_material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    for document in (catalog, songs_catalog, appearances, profiles_doc):
        document["build_id"] = build_id
    manifest = {
        "schema_version": 1,
        "build_id": build_id,
        "generated_at": generated_at,
        "files": {
            "events": "/data/events_catalog.json",
            "songs": "/data/song_catalog.json",
            "appearances": "/data/appearance_index.json",
            "voice_actors": "/data/voice_actor_profiles.json",
        },
    }
    errors = validate(catalog, songs_catalog, appearances, profiles)
    if errors:
        raise RuntimeError("validation failed:\n- " + "\n- ".join(errors[:30]))
    return {"catalog": catalog, "songs": songs_catalog, "appearances": appearances, "profiles": profiles_doc, "manifest": manifest}


def comparable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: comparable(item) for key, item in value.items() if key not in ("generated_at",)}
    if isinstance(value, list):
        return [comparable(item) for item in value]
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh-programs", action="store_true", help="refresh regular, character, and special programs from official sources")
    mode.add_argument("--refresh-profiles", action="store_true", help="refresh voice-actor biographical fields and cited profile links")
    mode.add_argument("--refresh-all", action="store_true", help="refresh programs and voice-actor profiles, then rebuild all indexes")
    mode.add_argument("--check", action="store_true", help="validate sources and committed generated files without writing")
    parser.add_argument("--dry-run", action="store_true", help="run network discovery and validation without changing source or generated catalogs")
    parser.add_argument("--report", type=Path, default=PROGRAM_REFRESH_REPORT, help="write the ignored official-program refresh report here")
    args = parser.parse_args(argv)
    if args.dry_run and not (args.refresh_programs or args.refresh_all or args.refresh_profiles):
        parser.error("--dry-run requires a refresh mode")
    refreshed_programs = None
    program_report = None
    refreshed_details = None
    if args.refresh_programs or args.refresh_all:
        existing_programs = read_json(EVENTS_DIR / "official_programs.json")
        discovered_programs = refresh_programs()
        refreshed_programs, program_report = apply_additive_program_refresh(existing_programs, discovered_programs)
    if args.refresh_profiles or args.refresh_all:
        refreshed_details = refresh_voice_actor_details()
    built = build(refreshed_programs, refreshed_details)
    if args.check:
        mismatches = []
        for key, path in OUTPUT_FILES.items():
            if not path.exists() or comparable(read_json(path)) != comparable(built[key]):
                mismatches.append(str(path.relative_to(ROOT)))
        if mismatches:
            print("generated files are stale: " + ", ".join(mismatches), file=sys.stderr)
            return 1
        print(f"event data valid: {len(built['catalog']['events'])} events, {len(built['profiles']['voice_actors'])} voice actors")
        return 0
    if program_report is not None:
        program_report["dry_run"] = bool(args.dry_run)
        atomic_json(args.report, program_report)
    if args.dry_run:
        if program_report is not None:
            counts = program_report["counts"]
            print(
                "official program dry run: "
                f"{counts['added']} new, {counts['filled']} filled, "
                f"{counts['conflicts']} conflicts, {counts['retained_missing']} retained"
            )
            print(f"report written: {args.report}")
        if refreshed_details is not None:
            print(f"voice actor profile dry run: {len(refreshed_details['records'])} records")
        return 0
    if refreshed_programs is not None:
        atomic_json(EVENTS_DIR / "official_programs.json", refreshed_programs)
        print(f"official programs refreshed: {len(refreshed_programs['programs'])}")
    if refreshed_details is not None:
        atomic_json(VOICE_DETAILS_FILE, refreshed_details)
        print(f"voice actor details refreshed: {len(refreshed_details['records'])}")
    for key, path in OUTPUT_FILES.items():
        atomic_json(path, built[key])
    coverage = built["catalog"]["coverage"]
    print(f"event data written: {coverage['events']} events, {coverage['official_programs']} official programs, {len(built['profiles']['voice_actors'])} voice actors")
    print("curated live source integrity: " + ", ".join(f"{name}={info['sha256'][:12]}" for name, info in built["catalog"]["source_integrity"].items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
