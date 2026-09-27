#!/usr/bin/env python3
"""Synchronize version-level creator credits and lyrics from recording metadata.

The committed files under ``data/music`` are source inputs for
``update_events.py``.  This command only fills blank version records by
default, so hand-corrected non-empty data is never replaced accidentally.

Usage::

    python3 uma_tools/sync_music_metadata.py
    python3 uma_tools/sync_music_metadata.py --check
    python3 uma_tools/sync_music_metadata.py --refresh VERSION_ID
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
from html.parser import HTMLParser
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
MUSIC_DIR = DATA_DIR / "music"
SONGS_FILE = DATA_DIR / "song_catalog.json"
CREATORS_FILE = MUSIC_DIR / "creators.json"
CREDITS_FILE = MUSIC_DIR / "credits.json"
LYRICS_FILE = MUSIC_DIR / "lyrics.json"
TIMINGS_FILE = MUSIC_DIR / "lyric_timings.json"
OVERRIDES_FILE = MUSIC_DIR / "version_overrides.json"
SOURCE_STATE_FILE = MUSIC_DIR / "source_status.json"
LYRIC_URL = "https://music.163.com/api/song/lyric?id={track_id}&lv=1&kv=1&tv=-1"
UTATEN_SEARCH_URL = "https://utaten.com/lyric/search?title={title}"
LRCLIB_SEARCH_URL = "https://lrclib.net/api/search?track_name={title}"
OSHIKATSU_URL = "https://oshikatsu-techo.com/games/umamusume/songs"
UMAMUSU_WIKI_API = "https://umamusu.wiki/w/api.php"
UMAMUSU_WIKI_CATEGORY = "Category:Songs"
UA = "UmaLiveWiki/1.0 (hobby metadata maintenance)"

ROLE_LABELS = {
    "作詞": "lyricist",
    "作词": "lyricist",
    "詞": "lyricist",
    "词": "lyricist",
    "lyricist": "lyricist",
    "lyrics": "lyricist",
    "作曲": "composer",
    "composer": "composer",
    "編曲": "arranger",
    "编曲": "arranger",
    "arranger": "arranger",
}
ROLE_ORDER = {"lyricist": 0, "composer": 1, "arranger": 2}
TIMED_LINE_RE = re.compile(r"^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$")
CREDIT_LINE_RE = re.compile(
    r"^\s*(作詞|作词|詞|词|作曲|編曲|编曲|lyricist|lyrics|composer|arranger)\s*[:：]\s*(.+?)\s*$",
    re.I,
)
COMBINED_CREDIT_RE = re.compile(r"^\s*(作詞|作词|作曲|編曲|编曲)(?:[・/&、](作詞|作词|作曲|編曲|编曲))+\s*[:：]\s*(.+?)\s*$", re.I)
NO_LYRIC_RE = re.compile(r"^(?:纯音乐|純音楽|instrumental|off\s*vocal|暂无歌词|暂无歌詞)$", re.I)
NAME_VARIANTS = str.maketrans({
    "髙": "高", "﨑": "崎", "祥": "祥", "塚": "塚", "濱": "浜", "諸": "諸",
    "’": "'", "‘": "'", "`": "'",
})


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.replace(temp, path)


def track_id(url: str) -> str:
    match = re.search(r"[?&]id=(\d+)", str(url or ""))
    return match.group(1) if match else ""


def normalized_name(value: str) -> str:
    return re.sub(r"[\s　・･._\-]+", "", unicodedata.normalize("NFKC", value or "").translate(NAME_VARIANTS)).lower()


def creator_identity(raw_name: str) -> tuple[str, list[str]]:
    name = unicodedata.normalize("NFKC", raw_name or "").strip(" \t:：")
    affiliations: list[str] = []
    prefix = re.match(r"^(Cygames|MONACA|Arte Refact|Lantis)\s*[（(](.+?)[）)]$", name, re.I)
    suffix = re.match(r"^(.+?)\s*[（(]([^()（）]+)[）)]$", name, re.I)
    if prefix:
        affiliations.append(prefix.group(1))
        name = prefix.group(2).strip()
    elif suffix:
        name = suffix.group(1).strip()
        affiliation = re.sub(r"^from\s+", "", suffix.group(2).strip(), flags=re.I)
        if affiliation:
            affiliations.append(affiliation)
    return name, affiliations


def stable_creator_id(name: str) -> str:
    readable = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKC", name).lower()).strip("-")[:28]
    digest = hashlib.sha1(normalized_name(name).encode("utf-8")).hexdigest()[:10]
    return "creator-" + ((readable + "-") if readable else "") + digest


def split_creators(value: str) -> list[str]:
    cleaned = re.sub(r"\s+(?:and|＆)\s+", "、", value.strip(), flags=re.I)
    parts = re.split(r"\s*(?:/|／|、|，|,|;|；|・)\s*", cleaned)
    out: list[str] = []
    for part in parts:
        part = re.sub(r"\s+(?:arranged|composed|written)\s+by\s+", "", part, flags=re.I).strip()
        if part and part not in out:
            out.append(part)
    return out


def milliseconds(minutes: str, seconds: str, fraction: str | None) -> int:
    digits = fraction or "0"
    fraction_ms = int((digits + "000")[:3])
    return (int(minutes) * 60 + int(seconds)) * 1000 + fraction_ms


def parse_lyric(raw: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    timed: list[dict[str, Any]] = []
    credits: list[dict[str, str]] = []
    seen_credits: set[tuple[str, str]] = set()
    for source_line in str(raw or "").replace("\r", "").split("\n"):
        match = TIMED_LINE_RE.match(source_line.strip())
        if not match:
            continue
        text = match.group(4).strip()
        if not text:
            continue
        credit_match = CREDIT_LINE_RE.match(text)
        if credit_match:
            role = ROLE_LABELS.get(credit_match.group(1).lower(), ROLE_LABELS.get(credit_match.group(1), ""))
            for raw_name in split_creators(credit_match.group(2)):
                name, affiliations = creator_identity(raw_name)
                key = (role, normalized_name(name))
                if not role or not name or key in seen_credits:
                    continue
                seen_credits.add(key)
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
            continue
        if COMBINED_CREDIT_RE.match(text):
            # Rare combined labels are kept out rather than assigning the same
            # person to roles that cannot be separated with confidence.
            continue
        if re.match(r"^(?:纯音乐|純音楽|instrumental|off\s*vocal)$", text, re.I):
            continue
        if NO_LYRIC_RE.match(text):
            continue
        timed.append({
            "start_ms": milliseconds(match.group(1), match.group(2), match.group(3)),
            "text": text,
        })
    return timed, credits


def fetch_track(track: str, tries: int = 3) -> tuple[str, dict[str, Any] | None, str]:
    url = LYRIC_URL.format(track_id=urllib.parse.quote(track))
    last_error = ""
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://music.163.com/"})
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
            return track, payload, ""
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = str(error)
            if attempt + 1 < tries:
                time.sleep(0.4 * (attempt + 1))
    return track, None, last_error


def version_recordings(songs: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
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
                })
                for artist in re.split(r"[、,，／/&＋+]", str(release.get("artist") or "")):
                    artist = re.sub(r"[()（）]", " ", artist).strip()
                    if artist and artist not in artists:
                        artists.append(artist)
            rows[version["id"]] = {
                "version_id": version["id"],
                "song_id": song["id"],
                "song_title": song["title"],
                "version_title": version.get("title") or song["title"],
                "instrumental": bool(version.get("instrumental")) or bool(
                    re.search(r"(?:off[ -]?vocal|instrumental)", " ".join([
                        str(version.get("title") or ""), str(version.get("version_label") or "")
                    ]), re.I)
                ),
                "tracks": releases,
                "releases": release_rows,
                "artists": artists,
            }
    return rows


def clean_markup(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).replace("\xa0", " ").strip()


def catalog_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", unicodedata.normalize("NFKC", value or "").upper())


def parse_credit_text(value: str) -> list[dict[str, str]]:
    text = clean_markup(value).split("歌：", 1)[0]
    text = text.replace("\n", "　")
    text = re.sub(r"(?:ファンファーレ)?作曲\s*[・/&]\s*編曲", "作曲・編曲", text)
    text = re.sub(r"(?:ストリングス|ブラス|ファンファーレ)\s*(?:アレンジ|編曲)", "編曲", text, flags=re.I)
    label_pattern = r"(?:作詞|作词|作曲|編曲|编曲)(?:\s*[・/&、]\s*(?:作詞|作词|作曲|編曲|编曲))*"
    matches = list(re.finditer(rf"({label_pattern})\s*[:：]\s*(.*?)(?=\s+{label_pattern}\s*[:：]|$)", text, re.I))
    credits: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for match in matches:
        labels = re.findall(r"作詞|作词|作曲|編曲|编曲", match.group(1), re.I)
        roles = list(dict.fromkeys(ROLE_LABELS.get(label, "") for label in labels))
        for raw_name in split_creators(match.group(2).strip(" 　")):
            name, affiliations = creator_identity(raw_name)
            for role in roles:
                key = (role, normalized_name(name))
                if not role or not name or key in seen:
                    continue
                seen.add(key)
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
    credits.sort(key=lambda row: (ROLE_ORDER.get(row["role"], 99), normalized_name(row["name"])))
    return credits


def official_credit_rows(goods: list[dict[str, Any]], recordings: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_catalog_title: dict[tuple[str, str], list[str]] = {}
    for version_id, recording in recordings.items():
        for release in recording["releases"]:
            key = (catalog_key(release.get("catalog") or ""), folded_title(recording["version_title"]))
            if key[0] and version_id not in by_catalog_title.setdefault(key, []):
                by_catalog_title[key].append(version_id)
    out: dict[str, dict[str, Any]] = {}
    for item in goods:
        page = item.get("html") or ""
        catalog_match = re.search(r"品番[:：]\s*([A-Za-z0-9_\-/～〜 ]+)", clean_markup(page))
        if not catalog_match:
            continue
        catalog = catalog_key(catalog_match.group(1))
        blocks = re.findall(r"<h4\b[^>]*>([\s\S]*?)</h4>([\s\S]*?)(?=<h4\b|$)", page, re.I)
        for title_markup, body in blocks:
            title = re.sub(r"^\s*(?:\d+[.．、]\s*)", "", clean_markup(title_markup)).strip()
            if not title or title.startswith("["):
                continue
            matched_ids = by_catalog_title.get((catalog, folded_title(title))) or []
            if len(matched_ids) != 1:
                continue
            credit_rows = parse_credit_text(body)
            if not credit_rows:
                continue
            out[matched_ids[0]] = {
                "credits": credit_rows,
                "source": "official_lantis_catalog",
                "source_catalog": catalog_match.group(1).strip(),
            }
    return out


def merge_credit_rows(
    existing: dict[str, Any],
    incoming_rows: dict[str, dict[str, Any]],
    refresh: set[str] | None = None,
) -> None:
    """Fill missing roles while preserving every existing non-empty role by default."""
    versions = existing.setdefault("versions", {})
    refresh = refresh or set()
    for version_id, incoming in incoming_rows.items():
        current = versions.get(version_id) or {}
        if current.get("manual"):
            continue
        if version_id in refresh:
            versions[version_id] = incoming
            continue
        current_credits = list(current.get("credits") or [])
        current_roles = {row.get("role") for row in current_credits if row.get("role")}
        additions = [row for row in incoming.get("credits") or [] if row.get("role") not in current_roles]
        if not additions:
            continue
        if not current_credits:
            versions[version_id] = incoming
            continue
        supplemental = list(current.get("supplemental_sources") or [])
        source = incoming.get("source")
        if source and source not in supplemental:
            supplemental.append(source)
        versions[version_id] = {
            **current,
            "credits": current_credits + additions,
            **({"supplemental_sources": supplemental} if supplemental else {}),
        }


def match_recording_version(
    title: str,
    recordings: dict[str, dict[str, Any]],
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


def parse_oshikatsu_credits(page: str, recordings: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for block in re.findall(r'<article\s+class="static-entry"[^>]*>([\s\S]*?)</article>', page, re.I):
        title_match = re.search(r'<h3\b[^>]*class="[^"]*static-entry-title[^"]*"[^>]*>([\s\S]*?)</h3>', block, re.I)
        if not title_match:
            continue
        title = clean_markup(title_match.group(1))
        release_name = ""
        track_number = None
        release_match = re.search(r'<p>\s*収録先[:：]\s*([\s\S]*?)</p>', block, re.I)
        if release_match:
            release_text = clean_markup(release_match.group(1))
            parts = re.split(r"\s*/\s*", release_text, maxsplit=1)
            release_name = parts[0].strip()
            if len(parts) > 1:
                number_match = re.search(r"(\d+)\s*曲目", parts[1])
                track_number = int(number_match.group(1)) if number_match else None
        version_id = match_recording_version(title, recordings, release_name, track_number)
        if not version_id:
            continue
        credits: list[dict[str, str]] = []
        for label_markup, names_markup in re.findall(r'<li>\s*<strong>([\s\S]*?)</strong>\s*([\s\S]*?)</li>', block, re.I):
            role = ROLE_LABELS.get(clean_markup(label_markup))
            if not role:
                continue
            for raw_name in split_creators(clean_markup(names_markup)):
                name, affiliations = creator_identity(raw_name)
                if not name:
                    continue
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
        if credits:
            out[version_id] = {
                "credits": credits,
                "source": "oshikatsu_techo_catalog",
                "source_url": OSHIKATSU_URL,
            }
    return out


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def wiki_api(params: dict[str, Any]) -> dict[str, Any]:
    url = UMAMUSU_WIKI_API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    return json.loads(fetch_text(url))


def wiki_song_pages() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    continuation = ""
    while True:
        params: dict[str, Any] = {
            "action": "query", "list": "categorymembers", "cmtitle": UMAMUSU_WIKI_CATEGORY,
            "cmlimit": "max", "cmnamespace": 0,
        }
        if continuation:
            params["cmcontinue"] = continuation
        payload = wiki_api(params)
        rows.extend(payload.get("query", {}).get("categorymembers", []))
        continuation = str(payload.get("continue", {}).get("cmcontinue") or "")
        if not continuation:
            return rows


def wiki_page_wikitext(page_ids: list[int]) -> tuple[list[dict[str, Any]], list[str]]:
    pages: list[dict[str, Any]] = []
    errors: list[str] = []
    for offset in range(0, len(page_ids), 25):
        batch = page_ids[offset:offset + 25]
        try:
            payload = wiki_api({
                "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                "pageids": "|".join(str(page_id) for page_id in batch),
            })
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            errors.extend(f"{page_id}: {error}" for page_id in batch)
            continue
        for page in payload.get("query", {}).get("pages", []):
            revision = ((page.get("revisions") or [{}])[0].get("slots") or {}).get("main") or {}
            pages.append({
                "pageid": int(page.get("pageid") or 0),
                "title": str(page.get("title") or ""),
                "wikitext": str(revision.get("content") or ""),
            })
    return pages, errors


def clean_wiki_lyric_cell(value: str) -> list[str]:
    text = re.sub(r"<ref\b[^>]*>[\s\S]*?</ref>|<ref\b[^>]*/>", "", value, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"\{\{\s*(?:ruby|furigana)\s*\|\s*([^|{}]+)\|[^{}]*\}\}", r"\1", text, flags=re.I)
    text = re.sub(r"\{\{\s*(?:color|lang)\s*\|[^{}|]+\|\s*([^{}]+)\}\}", r"\1", text, flags=re.I)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"\[\[[^]|]+\|([^]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^]]+)\]\]", r"\1", text)
    text = clean_markup(text.replace("'''", "").replace("''", ""))
    return [re.sub(r"[\t ]+", " ", line).strip() for line in text.splitlines() if line.strip()]


def parse_wiki_song(page: dict[str, Any], original_versions: dict[str, str]) -> tuple[str, list[str]]:
    source = page.get("wikitext") or ""
    title_match = re.search(r"^\s*\|\s*title_jp\s*=\s*(.+?)\s*$", source, re.I | re.M)
    if not title_match:
        return "", []
    version_id = original_versions.get(folded_title(clean_markup(title_match.group(1)))) or ""
    if not version_id:
        return "", []
    section_match = re.search(r"^==\s*Lyrics\s*==\s*$([\s\S]*?)(?=^==[^=]|\Z)", source, re.I | re.M)
    if not section_match:
        return "", []
    table_match = re.search(r"\{\|[^\n]*\blyrics\b[^\n]*\n([\s\S]*?)\n\|\}", section_match.group(1), re.I)
    if not table_match:
        return "", []
    lines: list[str] = []
    for row in re.split(r"\n\|-\s*\n", table_match.group(1)):
        row = row.strip()
        if not row or row.startswith("!"):
            continue
        cell_lines = row.splitlines()
        first_index = next((index for index, line in enumerate(cell_lines) if line.startswith("|") and not line.startswith("|-")), -1)
        if first_index < 0:
            continue
        first_cell: list[str] = [cell_lines[first_index][1:].lstrip()]
        for line in cell_lines[first_index + 1:]:
            if line.startswith("|"):
                break
            first_cell.append(line)
        lines.extend(clean_wiki_lyric_cell("\n".join(first_cell).split("||", 1)[0]))
    if len(lines) < 4 or not re.search(r"[ぁ-ゟ゠-ヿ一-龯]", "".join(lines)):
        return "", []
    return version_id, lines


def language_of(lines: list[dict[str, Any]]) -> str:
    text = "".join(str(line.get("text") or "") for line in lines)
    if re.search(r"[ぁ-ゟ゠-ヿ]", text):
        return "ja"
    if re.search(r"[一-龯]", text):
        return "zh-Hans"
    return "en"


def choose_candidate(recording: dict[str, Any], fetched: dict[str, dict[str, Any] | None]) -> tuple[str, list[dict[str, Any]], list[dict[str, str]]]:
    best_track = ""
    best_lines: list[dict[str, Any]] = []
    combined_credits: list[dict[str, str]] = []
    seen_credits: set[tuple[str, str]] = set()
    for source_track in recording["tracks"]:
        payload = fetched.get(source_track) or {}
        raw = ((payload.get("lrc") or {}).get("lyric") or "") if isinstance(payload, dict) else ""
        lines, credits = parse_lyric(raw)
        for credit in credits:
            key = (credit["role"], normalized_name(credit["name"]))
            if key not in seen_credits:
                combined_credits.append(credit)
                seen_credits.add(key)
        if len(lines) > len(best_lines):
            best_track = source_track
            best_lines = lines
    combined_credits.sort(key=lambda row: (ROLE_ORDER.get(row["role"], 99), normalized_name(row["name"])))
    return best_track, best_lines, combined_credits


def folded_title(value: str) -> str:
    text = unicodedata.normalize("NFKC", html.unescape(value or ""))
    text = re.sub(r"[（(][^）)]*(?:主題歌|テーマ|挿入歌)[^）)]*[）)]", "", text, flags=re.I)
    return re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龯]+", "", text.lower())


def folded_lyric(lines: list[str]) -> str:
    return re.sub(
        r"[^0-9a-zぁ-んァ-ヶ一-龯]+",
        "",
        unicodedata.normalize("NFKC", "".join(lines)).lower(),
    )


class UtaTenLyricParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lyric_depth = 0
        self.ruby_text_depth = 0
        self.current = ""
        self.lines: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        classes = set(attr.get("class", "").split())
        if tag == "div" and "hiragana" in classes and not self.lyric_depth:
            self.lyric_depth = 1
            return
        if self.lyric_depth:
            if tag == "div":
                self.lyric_depth += 1
            if tag == "span" and "rt" in classes:
                self.ruby_text_depth += 1
            if tag == "br":
                self.flush_line()

    def handle_endtag(self, tag: str) -> None:
        if not self.lyric_depth:
            return
        if tag == "span" and self.ruby_text_depth:
            self.ruby_text_depth -= 1
        if tag == "div":
            self.lyric_depth -= 1
            if not self.lyric_depth:
                self.flush_line()

    def handle_data(self, data: str) -> None:
        if self.lyric_depth and not self.ruby_text_depth:
            self.current += data

    def flush_line(self) -> None:
        value = re.sub(r"[\t\r ]+", " ", self.current).strip()
        if value:
            self.lines.append(value)
        self.current = ""


def utaten_search_result(page: str, title: str) -> str:
    target = folded_title(title)
    candidates: list[tuple[int, str]] = []
    for match in re.finditer(r'<a\s+href="(/lyric/[^"/?#]+/)"[^>]*>([\s\S]*?)</a>', page, re.I):
        label = re.sub(r"<[^>]+>", "", match.group(2))
        folded = folded_title(label)
        score = 100 if folded == target else 0
        if not score and target and (folded.startswith(target) or target.startswith(folded)):
            difference = abs(len(folded) - len(target))
            score = 75 - min(50, difference)
        if score >= 75:
            candidates.append((score, match.group(1)))
    candidates.sort(key=lambda row: (-row[0], len(row[1]), row[1]))
    return candidates[0][1] if candidates else ""


def json_ld_composition(page: str) -> dict[str, Any]:
    for raw in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>', page, re.I):
        try:
            value = json.loads(raw.strip())
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("@type") == "MusicComposition":
            return value
    return {}


def credit_names(value: Any) -> list[str]:
    if isinstance(value, dict):
        return [str(value.get("name") or "").strip()] if value.get("name") else []
    if isinstance(value, list):
        return [name for item in value for name in credit_names(item)]
    return []


def utaten_artist_names(composition: dict[str, Any]) -> list[str]:
    recorded = composition.get("recordedAs") or {}
    recordings = recorded if isinstance(recorded, list) else [recorded]
    return [
        name
        for item in recordings
        if isinstance(item, dict)
        for name in credit_names(item.get("byArtist"))
        if name
    ]


def artist_match(recording: dict[str, Any], composition: dict[str, Any]) -> bool:
    source = "".join(normalized_name(name) for name in utaten_artist_names(composition))
    if not source:
        return False
    for name in recording.get("artists") or []:
        key = normalized_name(name)
        if len(key) >= 3 and key in source:
            return True
    return False


def fetch_utaten(recording: dict[str, Any]) -> tuple[str, dict[str, Any] | None, str]:
    version_id = recording["version_id"]
    try:
        search_url = UTATEN_SEARCH_URL.format(title=urllib.parse.quote(recording["version_title"]))
        request = urllib.request.Request(search_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=25) as response:
            search_page = response.read().decode("utf-8", errors="replace")
        result_path = utaten_search_result(search_page, recording["version_title"])
        if not result_path:
            return version_id, None, ""
        source_url = urllib.parse.urljoin("https://utaten.com", result_path)
        request = urllib.request.Request(source_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=25) as response:
            page = response.read().decode("utf-8", errors="replace")
        parser = UtaTenLyricParser()
        parser.feed(page)
        composition = json_ld_composition(page)
        if not artist_match(recording, composition):
            return version_id, None, ""
        credits: list[dict[str, str]] = []
        for role, key in (("lyricist", "lyricist"), ("composer", "composer")):
            for raw_name in credit_names(composition.get(key)):
                name, affiliations = creator_identity(raw_name)
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
        arranger_match = re.search(r'<dt[^>]*>\s*編曲\s*</dt>\s*<dd[^>]*>([\s\S]*?)</dd>', page, re.I)
        if arranger_match:
            arranger_text = re.sub(r"<[^>]+>", "", arranger_match.group(1))
            for raw_name in split_creators(html.unescape(arranger_text)):
                name, affiliations = creator_identity(raw_name)
                credit = {"role": "arranger", "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
        return version_id, {"source_url": source_url, "lines": parser.lines, "credits": credits}, ""
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        return version_id, None, str(error)


def verify_utaten_source(recording: dict[str, Any], source_url: str) -> tuple[str, bool, str]:
    version_id = recording["version_id"]
    try:
        request = urllib.request.Request(source_url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=25) as response:
            page = response.read().decode("utf-8", errors="replace")
        return version_id, artist_match(recording, json_ld_composition(page)), ""
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        return version_id, False, str(error)


def fetch_lrclib_timing(
    recording: dict[str, Any], lyric_lines: list[str]
) -> tuple[str, dict[str, Any] | None, str]:
    """Return timing only when LRCLIB text exactly matches the accepted lyric.

    LRCLIB is an open source, user-maintained timing source.  It never decides
    which lyric belongs to a version here: the already accepted plain lyric is
    the identity check, so similarly named recordings cannot overwrite it.
    """
    version_id = recording["version_id"]
    expected = folded_lyric(lyric_lines)
    if not expected:
        return version_id, None, ""
    try:
        request = urllib.request.Request(
            LRCLIB_SEARCH_URL.format(title=urllib.parse.quote(recording["version_title"])),
            headers={"User-Agent": UA},
        )
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
        candidates: list[tuple[int, int, list[dict[str, Any]]]] = []
        for item in payload if isinstance(payload, list) else []:
            if folded_title(str(item.get("trackName") or "")) != folded_title(recording["version_title"]):
                continue
            timed, _ = parse_lyric(str(item.get("syncedLyrics") or ""))
            if not timed or folded_lyric([line["text"] for line in timed]) != expected:
                continue
            album = str(item.get("albumName") or "")
            album_score = max(
                [
                    1
                    for release in recording.get("releases") or []
                    if folded_title(str(release.get("album_name") or ""))
                    and folded_title(str(release.get("album_name") or "")) in folded_title(album)
                ]
                or [0]
            )
            candidates.append((album_score, int(item.get("id") or 0), timed))
        if not candidates:
            return version_id, None, ""
        candidates.sort(key=lambda row: (-row[0], row[1]))
        return version_id, {"source_id": candidates[0][1], "lines": candidates[0][2]}, ""
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        return version_id, None, str(error)


def creator_rows(credits_doc: dict[str, Any], existing: dict[str, Any]) -> list[dict[str, Any]]:
    existing_by_key: dict[str, dict[str, Any]] = {}
    for creator in existing.get("creators") or []:
        for name in [creator.get("name") or "", *(creator.get("aliases") or [])]:
            if name:
                existing_by_key.setdefault(normalized_name(name), creator)
    collected: dict[str, dict[str, Any]] = {}
    for row in (credits_doc.get("versions") or {}).values():
        automatic = not row.get("manual")
        for credit in row.get("credits") or []:
            name, affiliations = creator_identity(credit.get("name") or "")
            key = normalized_name(name)
            if not key:
                continue
            existing_creator = existing_by_key.get(key)
            creator_id = (existing_creator or {}).get("id") or stable_creator_id(name)
            creator = collected.setdefault(creator_id, {
                "id": creator_id,
                "name": (existing_creator or {}).get("name") or name,
                "aliases": list((existing_creator or {}).get("aliases") or []),
                "type": (existing_creator or {}).get("type") or "person",
                "affiliations": list((existing_creator or {}).get("affiliations") or []),
            })
            if name != creator["name"] and name not in creator["aliases"]:
                creator["aliases"].append(name)
            for affiliation in [credit.get("affiliation") or "", *affiliations]:
                if affiliation and affiliation not in creator["affiliations"]:
                    creator["affiliations"].append(affiliation)
            if automatic:
                credit["name"] = creator["name"]
                if affiliations and not credit.get("affiliation"):
                    credit["affiliation"] = affiliations[0]
            credit["creator_id"] = creator_id
    for creator in existing.get("creators") or []:
        if creator.get("manual") and creator.get("id") not in collected:
            collected[creator["id"]] = creator
    rows = list(collected.values())
    for row in rows:
        row["aliases"] = sorted(set(row.get("aliases") or []), key=normalized_name)
        row["affiliations"] = sorted(set(row.get("affiliations") or []), key=normalized_name)
    rows.sort(key=lambda row: (normalized_name(row.get("name") or ""), row["id"]))
    return rows


def build_documents(
    recordings: dict[str, dict[str, Any]],
    fetched: dict[str, dict[str, Any] | None],
    refresh: set[str],
    documents: tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], ...]:
    creators, credits, lyrics, timings = documents or (
        read_json(CREATORS_FILE, {"schema_version": 1, "creators": []}),
        read_json(CREDITS_FILE, {"schema_version": 1, "versions": {}}),
        read_json(LYRICS_FILE, {"schema_version": 1, "versions": {}}),
        read_json(TIMINGS_FILE, {"schema_version": 1, "versions": {}}),
    )
    credit_versions = credits.setdefault("versions", {})
    lyric_versions = lyrics.setdefault("versions", {})
    timing_versions = timings.setdefault("versions", {})
    for version_id, recording in recordings.items():
        source_track, lines, credit_rows = choose_candidate(recording, fetched)
        if credit_rows and (version_id not in credit_versions or version_id in refresh):
            credit_versions[version_id] = {
                "credits": credit_rows,
                "source": "netease_recording_metadata",
                "source_track_id": source_track or (recording["tracks"][0] if recording["tracks"] else ""),
            }
        if recording["instrumental"]:
            continue
        if lines and (version_id not in lyric_versions or version_id in refresh):
            lyric_versions[version_id] = {
                "language": language_of(lines),
                "lines": [line["text"] for line in lines],
                "source": "netease_recording_metadata",
                "source_track_id": source_track,
            }
            timing_versions[version_id] = {
                "lines": lines,
                "source": "netease_recording_metadata",
                "source_track_id": source_track,
            }
    creators["creators"] = creator_rows(credits, creators)
    return creators, credits, lyrics, timings


def apply_utaten_results(
    recordings: dict[str, dict[str, Any]],
    results: dict[str, dict[str, Any] | None],
    creators: dict[str, Any],
    credits: dict[str, Any],
    lyrics: dict[str, Any],
    timings: dict[str, Any],
) -> tuple[dict[str, Any], ...]:
    credit_versions = credits.setdefault("versions", {})
    lyric_versions = lyrics.setdefault("versions", {})
    for version_id, result in results.items():
        if not result:
            continue
        recording = recordings[version_id]
        if result.get("credits") and not (credit_versions.get(version_id) or {}).get("manual"):
            current = credit_versions.get(version_id) or {}
            current_roles = {row.get("role") for row in current.get("credits") or []}
            additions = [row for row in result["credits"] if row.get("role") not in current_roles]
            if additions or not current:
                credit_versions[version_id] = {
                    **current,
                    "credits": list(current.get("credits") or []) + additions,
                    "source": current.get("source") or "utaten",
                    "source_url": current.get("source_url") or result["source_url"],
                }
        if result.get("lines") and version_id not in lyric_versions and not recording["instrumental"]:
            lyric_versions[version_id] = {
                "language": language_of([{"text": line} for line in result["lines"]]),
                "lines": list(result["lines"]),
                "source": "utaten",
                "source_url": result["source_url"],
            }
    creators["creators"] = creator_rows(credits, creators)
    return creators, credits, lyrics, timings


def apply_lrclib_results(results: dict[str, dict[str, Any] | None], timings: dict[str, Any]) -> None:
    timing_versions = timings.setdefault("versions", {})
    for version_id, result in results.items():
        if not result or version_id in timing_versions:
            continue
        timing_versions[version_id] = {
            "lines": result["lines"],
            "source": "lrclib_verified_timing",
            "source_id": result["source_id"],
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=12, help="maximum concurrent metadata requests")
    parser.add_argument("--limit", type=int, default=0, help="fetch at most this many track IDs (development only)")
    parser.add_argument("--refresh", action="append", default=[], metavar="VERSION_ID", help="replace one version from its recording source")
    parser.add_argument("--utaten", action="store_true", help="also fill missing plain lyrics and credits from UtaTen")
    parser.add_argument("--utaten-only", action="store_true", help="skip NetEase and only run the UtaTen fallback")
    parser.add_argument("--lrclib", action="store_true", help="also add LRCLIB timings whose text matches accepted lyrics")
    parser.add_argument("--lrclib-only", action="store_true", help="skip other network sources and only run the LRCLIB timing fallback")
    parser.add_argument("--community", action="store_true", help="also fill exact matches from the community music catalog and Umamusume Wiki")
    parser.add_argument("--community-only", action="store_true", help="skip other network sources and only run the community fallbacks")
    parser.add_argument("--revalidate-utaten", action="store_true", help="remove prior UtaTen matches whose credited artist does not match this recording")
    parser.add_argument("--skip-official", action="store_true", help="skip the official Lantis credit refresh")
    parser.add_argument("--check", action="store_true", help="validate committed music source documents without network access")
    args = parser.parse_args(argv)

    songs = read_json(SONGS_FILE, {"songs": []})
    recordings = version_recordings(songs)
    source_state = read_json(SOURCE_STATE_FILE, {
        "schema_version": 1, "netease_checked": [], "utaten_checked": [], "lrclib_checked": [],
        "umamusu_wiki_checked": [],
    })
    netease_checked = set(source_state.get("netease_checked") or [])
    utaten_checked = set(source_state.get("utaten_checked") or [])
    lrclib_checked = set(source_state.get("lrclib_checked") or [])
    umamusu_wiki_checked = {int(value) for value in source_state.get("umamusu_wiki_checked") or [] if str(value).isdigit()}
    overrides = read_json(OVERRIDES_FILE, {"schema_version": 1, "versions": {}})
    if not isinstance(overrides.get("versions"), dict):
        raise RuntimeError("data/music/version_overrides.json must contain a versions object")
    if args.check:
        creators = read_json(CREATORS_FILE, {})
        credits = read_json(CREDITS_FILE, {})
        lyrics = read_json(LYRICS_FILE, {})
        timings = read_json(TIMINGS_FILE, {})
        known = set(recordings)
        unknown = sorted((set((credits.get("versions") or {})) | set((lyrics.get("versions") or {})) | set((timings.get("versions") or {}))) - known)
        if unknown:
            raise RuntimeError("music metadata references unknown versions: " + ", ".join(unknown[:10]))
        creator_ids = [str(row.get("id") or "") for row in creators.get("creators") or []]
        if not all(creator_ids) or len(creator_ids) != len(set(creator_ids)):
            raise RuntimeError("music creators contain blank or duplicate stable IDs")
        creator_names = [normalized_name(str(row.get("name") or "")) for row in creators.get("creators") or []]
        if not all(creator_names) or len(creator_names) != len(set(creator_names)):
            raise RuntimeError("music creators contain blank or duplicate canonical names")
        creator_id_set = set(creator_ids)
        missing_creator_ids = sorted({
            str(credit.get("creator_id") or "")
            for row in (credits.get("versions") or {}).values()
            for credit in row.get("credits") or []
            if not credit.get("creator_id") or str(credit.get("creator_id")) not in creator_id_set
        })
        if missing_creator_ids:
            raise RuntimeError("music credits reference unknown creators: " + ", ".join(missing_creator_ids[:10]))
        instrumental_lyrics = sorted(
            version_id for version_id in lyrics.get("versions") or {}
            if (recordings.get(version_id) or {}).get("instrumental")
        )
        if instrumental_lyrics:
            raise RuntimeError("instrumental versions must not contain lyrics: " + ", ".join(instrumental_lyrics[:10]))
        unknown_override_refs = sorted({
            str(reference)
            for version_id, row in (overrides.get("versions") or {}).items()
            for reference in [version_id, row.get("parent_version_id"), row.get("lyrics_from")]
            if reference and str(reference) not in known
        })
        if unknown_override_refs:
            raise RuntimeError("music overrides reference unknown versions: " + ", ".join(unknown_override_refs[:10]))
        print(
            "music metadata valid: "
            f"{len(known)} versions, {len((credits.get('versions') or {}))} credited, "
            f"{len((lyrics.get('versions') or {}))} with lyrics, {len((timings.get('versions') or {}))} timed"
        )
        return 0

    refresh = set(args.refresh)
    creators = read_json(CREATORS_FILE, {"schema_version": 1, "creators": []})
    credits = read_json(CREDITS_FILE, {"schema_version": 1, "versions": {}})
    lyrics = read_json(LYRICS_FILE, {"schema_version": 1, "versions": {}})
    timings = read_json(TIMINGS_FILE, {"schema_version": 1, "versions": {}})

    if args.revalidate_utaten:
        source_urls: dict[str, str] = {}
        for document in (credits, lyrics):
            for version_id, row in (document.get("versions") or {}).items():
                source_url = str(row.get("source_url") or "")
                if source_url.startswith("https://utaten.com/lyric/") and version_id in recordings:
                    source_urls[version_id] = source_url
        mismatches: set[str] = set()
        audit_errors: list[tuple[str, str]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as pool:
            futures = [pool.submit(verify_utaten_source, recordings[version_id], url) for version_id, url in source_urls.items()]
            for future in concurrent.futures.as_completed(futures):
                version_id, verified, error = future.result()
                if error:
                    audit_errors.append((version_id, error))
                elif not verified:
                    mismatches.add(version_id)
        for version_id in mismatches:
            (credits.get("versions") or {}).pop(version_id, None)
            (lyrics.get("versions") or {}).pop(version_id, None)
            (timings.get("versions") or {}).pop(version_id, None)
            refresh.add(version_id)
            for source_track in recordings[version_id]["tracks"]:
                netease_checked.discard(source_track)
        print(
            f"UtaTen revalidated: {len(source_urls) - len(audit_errors)} checked, "
            f"{len(mismatches)} rejected, {len(audit_errors)} retryable errors"
        )

    if not args.skip_official and not args.lrclib_only and not args.community_only:
        from auto_albums import get_official_goods
        official = official_credit_rows(get_official_goods(), recordings)
        merge_credit_rows(credits, official, refresh)
        print(f"official credits matched: {len(official)} versions")

    errors: list[tuple[str, str]] = []
    if not args.utaten_only and not args.lrclib_only and not args.community_only:
        existing_credits = credits.get("versions") or {}
        existing_lyrics = lyrics.get("versions") or {}
        target_versions = {
            version_id: row for version_id, row in recordings.items()
            if row["tracks"] and (
                version_id in refresh
                or version_id not in existing_credits
                or (not row["instrumental"] and version_id not in existing_lyrics)
            )
        }
        targets = sorted({source_track for row in target_versions.values() for source_track in row["tracks"] if source_track not in netease_checked})
        if args.limit:
            targets = targets[: max(0, args.limit)]
        fetched: dict[str, dict[str, Any] | None] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = [pool.submit(fetch_track, source_track) for source_track in targets]
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                source_track, payload, error = future.result()
                fetched[source_track] = payload
                if error:
                    errors.append((source_track, error))
                else:
                    netease_checked.add(source_track)
                if index % 100 == 0 or index == len(futures):
                    print(f"recording metadata fetched: {index}/{len(futures)}", flush=True)
        creators, credits, lyrics, timings = build_documents(
            target_versions, fetched, refresh, (creators, credits, lyrics, timings)
        )

    if args.utaten or args.utaten_only:
        target_utaten = [
            row for version_id, row in recordings.items()
            if not row["instrumental"]
            and (version_id in refresh or version_id not in utaten_checked)
            and (version_id not in (lyrics.get("versions") or {}) or version_id not in (credits.get("versions") or {}))
        ]
        if args.limit:
            target_utaten = target_utaten[: max(0, args.limit)]
        results: dict[str, dict[str, Any] | None] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as pool:
            futures = [pool.submit(fetch_utaten, row) for row in target_utaten]
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                version_id, payload, error = future.result()
                results[version_id] = payload
                if error:
                    errors.append((version_id, error))
                else:
                    utaten_checked.add(version_id)
                if index % 50 == 0 or index == len(futures):
                    print(f"UtaTen checked: {index}/{len(futures)}", flush=True)
        creators, credits, lyrics, timings = apply_utaten_results(recordings, results, creators, credits, lyrics, timings)

    if args.community or args.community_only:
        try:
            community_credits = parse_oshikatsu_credits(fetch_text(OSHIKATSU_URL), recordings)
            merge_credit_rows(credits, community_credits, refresh)
            print(f"community catalog credits matched: {len(community_credits)} versions")
        except (urllib.error.URLError, TimeoutError) as error:
            errors.append((OSHIKATSU_URL, str(error)))

        try:
            category_pages = wiki_song_pages()
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            category_pages = []
            errors.append((UMAMUSU_WIKI_CATEGORY, str(error)))
        pending_pages = [row for row in category_pages if int(row.get("pageid") or 0) not in umamusu_wiki_checked]
        if args.limit:
            pending_pages = pending_pages[: max(0, args.limit)]
        fetched_pages, wiki_errors = wiki_page_wikitext([int(row["pageid"]) for row in pending_pages])
        errors.extend(("umamusu-wiki-" + error.split(":", 1)[0], error) for error in wiki_errors)
        original_versions: dict[str, str] = {}
        duplicate_titles: set[str] = set()
        for song in songs.get("songs") or []:
            key = folded_title(str(song.get("title") or ""))
            version_id = str(song.get("original_version_id") or "")
            if not key or not version_id:
                continue
            if key in original_versions and original_versions[key] != version_id:
                duplicate_titles.add(key)
            else:
                original_versions[key] = version_id
        for key in duplicate_titles:
            original_versions.pop(key, None)
        lyric_versions = lyrics.setdefault("versions", {})
        accepted = 0
        for page in fetched_pages:
            page_id = int(page.get("pageid") or 0)
            umamusu_wiki_checked.add(page_id)
            version_id, lines = parse_wiki_song(page, original_versions)
            if not version_id or not lines or (version_id in lyric_versions and version_id not in refresh):
                continue
            lyric_versions[version_id] = {
                "language": "ja",
                "lines": lines,
                "source": "umamusu_wiki",
                "source_url": "https://umamusu.wiki/" + urllib.parse.quote(str(page.get("title") or "").replace(" ", "_")),
            }
            accepted += 1
        print(f"Umamusume Wiki checked: {len(fetched_pages)}, accepted lyrics: {accepted}")

    if args.lrclib or args.lrclib_only:
        lyric_versions = lyrics.get("versions") or {}
        timing_versions = timings.get("versions") or {}
        target_lrclib = [
            (row, list((lyric_versions.get(version_id) or {}).get("lines") or []))
            for version_id, row in recordings.items()
            if not row["instrumental"]
            and (version_id in refresh or version_id not in lrclib_checked)
            and version_id in lyric_versions
            and version_id not in timing_versions
        ]
        if args.limit:
            target_lrclib = target_lrclib[: max(0, args.limit)]
        results: dict[str, dict[str, Any] | None] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as pool:
            futures = [pool.submit(fetch_lrclib_timing, row, lines) for row, lines in target_lrclib]
            for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
                version_id, payload, error = future.result()
                results[version_id] = payload
                if error:
                    errors.append((version_id, error))
                else:
                    lrclib_checked.add(version_id)
                if index % 50 == 0 or index == len(futures):
                    print(f"LRCLIB checked: {index}/{len(futures)}", flush=True)
        apply_lrclib_results(results, timings)

    creators["creators"] = creator_rows(credits, creators)
    for row in (credits.get("versions") or {}).values():
        if row.get("source") == "oshikatsu_techo_catalog":
            row["source_url"] = OSHIKATSU_URL
    for version_id, recording in recordings.items():
        if recording["instrumental"]:
            (lyrics.get("versions") or {}).pop(version_id, None)
            (timings.get("versions") or {}).pop(version_id, None)
    write_json(CREATORS_FILE, creators)
    write_json(CREDITS_FILE, credits)
    write_json(LYRICS_FILE, lyrics)
    write_json(TIMINGS_FILE, timings)
    write_json(SOURCE_STATE_FILE, {
        "schema_version": 1,
        "netease_checked": sorted(netease_checked),
        "utaten_checked": sorted(utaten_checked),
        "lrclib_checked": sorted(lrclib_checked),
        "umamusu_wiki_checked": sorted(umamusu_wiki_checked),
    })
    print(
        f"music metadata written: {len(credits['versions'])} credited versions, "
        f"{len(lyrics['versions'])} lyric versions, {len(creators['creators'])} creators"
    )
    if errors:
        print(f"metadata requests failed: {len(errors)} (rerun retries only unresolved network errors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
