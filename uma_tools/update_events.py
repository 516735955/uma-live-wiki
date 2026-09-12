#!/usr/bin/env python3
"""Build the unified event, appearance, and voice-actor indexes.

The two hand-curated live JSON files are immutable inputs. The normal command is
offline and deterministic apart from generated_at. Network discovery is an
explicit maintenance action:

    python3 uma_tools/update_events.py --refresh-programs
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
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent
ROOT = TOOLS_DIR.parent
DATA_DIR = ROOT / "data"
EVENTS_DIR = DATA_DIR / "events"
OFFICIAL_CHANNEL_ID = "UCAWxPGGuIfWME2KTLUmSCHw"
REGULAR_PROGRAM_BASELINES = {"paka-live-tv": 62, "paka-live-tv-prime": 6, "sokosoko-paka-live-tv": 55}
IMMUTABLE_LIVE_FILES = (DATA_DIR / "live_data.json", DATA_DIR / "live_cat_data.json")
OUTPUT_FILES = {
    "catalog": DATA_DIR / "events_catalog.json",
    "appearances": DATA_DIR / "appearance_index.json",
    "profiles": DATA_DIR / "voice_actor_profiles.json",
    "actor_compat": DATA_DIR / "actor_participation.json",
    "voice_compat": DATA_DIR / "voice_participation.json",
}

VFOLD = str.maketrans({"髙": "高", "﨑": "崎", "祥": "祥", "塚": "塚", "濱": "浜", "諸": "諸"})
DATE_RE = re.compile(r"(20\d{2})[.年/-](\d{1,2})[.月/-](\d{1,2})")
SONG_RE = re.compile(r'<td class="setlist-song">([\s\S]*?)</td>')
PERFORMER_RE = re.compile(r'<span class="perf-name">([\s\S]*?)</span>')
ROW_RE = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.I)
HTML_TAG_RE = re.compile(r"<[^>]+>")
EVENTERNOTE_ID_RE = re.compile(r"/events/id/(\d+)")


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
    value = re.sub(r"（[^（）]*）", "", value)
    value = re.sub(r"\([^()]*\)", "", value)
    value = value.replace("\ufe0e", "").replace("\ufe0f", "")
    value = re.sub(r"\s+([!?！？。、,.])", r"\1", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def table_songs(table: str) -> list[str]:
    return [song for song in (clean_song(match.group(1)) for match in SONG_RE.finditer(table or "")) if song]


def table_characters(table: str) -> list[str]:
    return list(dict.fromkeys(clean_text(match.group(1)) for match in PERFORMER_RE.finditer(table or "") if clean_text(match.group(1))))


def table_performances(table: str, identities: "IdentityIndex") -> list[dict[str, Any]]:
    performances = []
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
        performances.append({"song": song, "character_ids": character_ids})
    return performances


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
    def __init__(self, characters: list[dict[str, Any]], voice_list: list[dict[str, Any]], photos: dict[str, Any], overrides: dict[str, Any], previous: list[dict[str, Any]]):
        self.characters = characters
        self.voice_list = voice_list
        self.photos = photos
        self.overrides = overrides
        self.voice_by_alias: dict[str, str] = {}
        self.character_by_alias: dict[str, str] = {}
        self.character_by_id = {str(item.get("id")): item for item in characters if item.get("id")}
        self._prior_ids: dict[str, str] = {}
        for item in previous:
            identity = item.get("identity") or {}
            for name in (identity.get("zh"), identity.get("ja"), *(identity.get("aliases") or [])):
                if name:
                    self._prior_ids[fold_name(str(name))] = str(item.get("id"))
        self.profiles = self._build_profiles()
        self.profile_by_id = {item["id"]: item for item in self.profiles}

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
                for char_name in (char.get("zh"), char.get("ja"), char.get("role_zh")):
                    if char_name:
                        self.character_by_alias[fold_name(str(char_name))] = str(char.get("id"))

        used_ids = {value for value in self._prior_ids.values() if value}
        next_number = max([int(match.group(1)) for item in used_ids if (match := re.fullmatch(r"va-(\d+)", item))] or [0]) + 1
        profiles: list[dict[str, Any]] = []
        for key in sorted(grouped):
            record = grouped[key]
            actor_id = self._prior_ids.get(key)
            if not actor_id:
                while f"va-{next_number:04d}" in used_ids:
                    next_number += 1
                actor_id = f"va-{next_number:04d}"
                used_ids.add(actor_id)
                next_number += 1
            aliases = sorted(set(record["aliases"]), key=lambda value: (value != record["zh"], value))
            photo = self.photos.get(record["zh"]) or self.photos.get(record["ja"]) or {}
            profiles.append({
                "id": actor_id,
                "slug": actor_id,
                "identity": {"zh": record["zh"], "ja": record["ja"], "kana": "", "aliases": aliases},
                "profile": {
                    "birthday": photo.get("birth") or "",
                    "birthplace": "",
                    "agency": "",
                    "official_profile": "",
                    "social": [],
                    "status": "partial",
                },
                "photo": {
                    "url": photo.get("img") or "",
                    "source_url": photo.get("page") or "",
                    "source_title": photo.get("title") or "",
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


def make_cast(items: Iterable[dict[str, Any]], identities: IdentityIndex, evidence: str, source_url: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for item in items:
        name = str(item.get("name") or "").strip()
        role = str(item.get("role") or "").strip()
        actor_id = identities.voice_id(name)
        # Eventernote event pages often list every artist at a mixed festival.
        # Only names connected to this project's voice-actor identity table are
        # a supported Uma Musume relationship; unknown festival guests are not
        # shown as franchise cast.
        if evidence == "eventernote" and not actor_id:
            continue
        character_id = identities.character_id(role)
        key = (actor_id, fold_name(name), character_id or fold_name(role))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "voice_actor_id": actor_id,
            "name": name,
            "character_id": character_id,
            "role": role,
            "evidence": evidence,
            "source_url": source_url,
            "resolution": "resolved" if actor_id else "unresolved",
        })
    return out


def series_lookup(series_doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in series_doc.get("series", [])}


def numbered_events(data: list[dict[str, Any]], identities: IdentityIndex, used: set[str]) -> list[dict[str, Any]]:
    out = []
    for group_index, group in enumerate(data):
        series_match = re.search(r"(\d+(?:st|nd|rd|th)(?:\s*EVENT)?(?:\s*EXTRA)?)", group.get("group") or "", re.I)
        series_token = re.sub(r"\s+", "-", series_match.group(1).lower()) if series_match else f"series-{group_index + 1}"
        for performance_index, sub in enumerate(group.get("subs") or []):
            date = first_date(sub.get("date"))
            event_id = unique_id(f"live-numbered-{series_token}-{date or performance_index + 1}", used)
            sessions = []
            cast_source = parse_cast_text(sub.get("cast") or "")
            event_cast = make_cast(cast_source, identities, "curated_live_cast")
            for day_index, day in enumerate(sub.get("days") or []):
                table = day.get("table") or ""
                performances = table_performances(table, identities)
                characters = list(dict.fromkeys(char_id for performance in performances for char_id in performance["character_ids"]))
                sessions.append({
                    "id": f"{event_id}-session-{day_index + 1}",
                    "label": day.get("label") or f"DAY{day_index + 1}",
                    "date": event_date_for_day(sub.get("date"), day_index),
                    "songs": [performance["song"] for performance in performances],
                    "character_ids": characters,
                    "performances": performances,
                    "setlist_source": {"file": "data/live_data.json", "group": group_index, "performance": performance_index, "day": day_index},
                })
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
                "sessions": sessions, "media": [{"url": item[0], "label": item[1] if len(item) > 1 else "视频"} for item in (sub.get("vids") or []) if item],
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
                        performances = table_performances(table, identities)
                        characters = list(dict.fromkeys(char_id for performance in performances for char_id in performance["character_ids"]))
                        sessions.append({
                            "id": f"{event_id}-session-{day_index + 1}", "label": day.get("label") or "本公演",
                            "date": event_date_for_day(sub.get("date"), day_index), "songs": [performance["song"] for performance in performances],
                            "character_ids": characters,
                            "performances": performances,
                            "setlist_source": {"file": "data/live_cat_data.json", "category": category, "section": section_index if has_sections else None, "group": group_index, "performance": performance_index, "day": day_index},
                        })
                    cast = make_cast(parse_cast_text(sub.get("cast") or ""), identities, "curated_live_cast")
                    venue = venue_from_date_text(sub.get("date")) if date else str(sub.get("date") or "")
                    out.append({
                        "id": event_id, "title": title, "date": date, "end_date": sessions[-1]["date"] if sessions else date,
                        "kind": "concert" if category in ("cd", "twinkle") else "onsite", "mode": "onsite",
                        "series_id": cat_series_id(category, section.get("group") or "", group.get("group") or ""),
                        "venue": venue, "cast_status": "verified" if cast else "partial", "cast": cast, "character_ids": [],
                        "sessions": sessions, "media": [{"url": item[0], "label": item[1] if len(item) > 1 else "视频"} for item in (sub.get("vids") or []) if item],
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
            existing = {(item.get("voice_actor_id"), fold_name(item.get("name") or "")) for item in linked["cast"]}
            linked["cast"].extend(item for item in cast if (item.get("voice_actor_id"), fold_name(item.get("name") or "")) not in existing)
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
        cast_by_identity = {}
        for item in cast:
            key = item.get("voice_actor_id") or fold_name(item.get("name") or "")
            if key:
                cast_by_identity[key] = item
        program_media = source.get("media") or ([{"url": source.get("url") or "", "label": "官方视频", "video_id": source.get("video_id") or "", "duration": source.get("duration")}]
                                                  if source.get("url") else [])
        program_sources = source.get("sources") or ([{"kind": source_kind, "label": "官方公告" if source_kind == "official_announcement" else "官方 YouTube", "url": source_url}]
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
            "cast_status": source.get("cast_status") or ("verified" if cast else "pending"), "cast": list(cast_by_identity.values()), "character_ids": characters,
            "sessions": sessions,
            "media": program_media,
            "sources": program_sources,
            "legacy_url": "", "image": source.get("thumbnail") or "", "summary": source.get("summary") or "",
        })


def apply_overrides(events: list[dict[str, Any]], overrides: dict[str, Any]) -> list[dict[str, Any]]:
    patches = overrides.get("event_patches") or {}
    aliases = overrides.get("event_aliases") or {}
    hidden = set(overrides.get("hidden_event_ids") or [])
    for event in events:
        canonical = aliases.get(event["id"], event["id"])
        event["id"] = canonical
        patch = patches.get(canonical)
        if patch:
            event.update(patch)
    return [event for event in events if event["id"] not in hidden]


def dedupe_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Merge only high-confidence duplicates: same official program id, or an
    # Eventernote row already attached by an explicit legacy URL. Similar titles
    # are intentionally left separate for curator review.
    by_id: dict[str, dict[str, Any]] = {}
    for event in events:
        if event["id"] not in by_id:
            by_id[event["id"]] = event
            continue
        target = by_id[event["id"]]
        target["sources"].extend(source for source in event["sources"] if source not in target["sources"])
        target["cast"].extend(item for item in event["cast"] if item not in target["cast"])
    return list(by_id.values())


def build_appearance_index(events: list[dict[str, Any]], identities: IdentityIndex) -> dict[str, Any]:
    voice: dict[str, dict[str, Any]] = {}
    chars: dict[str, dict[str, Any]] = {}
    unresolved = Counter()
    for profile in identities.profiles:
        voice[profile["id"]] = {"events": [], "songs": {}}
    for char_id in identities.character_by_id:
        chars[char_id] = {"events": [], "songs": {}}
    for event in events:
        voice_in_event: dict[str, set[str]] = defaultdict(set)
        char_in_event: set[str] = set(event.get("character_ids") or [])
        cast_actor_by_character: dict[str, set[str]] = defaultdict(set)
        for cast in event.get("cast") or []:
            actor_id = cast.get("voice_actor_id") or ""
            char_id = cast.get("character_id") or ""
            if actor_id:
                voice_in_event[actor_id].add(cast.get("evidence") or "")
            else:
                unresolved[cast.get("name") or "（空）"] += 1
            if char_id:
                char_in_event.add(char_id)
                if actor_id:
                    cast_actor_by_character[char_id].add(actor_id)
        event_songs: dict[str, set[str]] = defaultdict(set)
        for session in event.get("sessions") or []:
            session_chars = set(session.get("character_ids") or [])
            char_in_event.update(session_chars)
            for performance in session.get("performances") or []:
                song = performance.get("song") or ""
                if not song:
                    continue
                performance_chars = set(performance.get("character_ids") or [])
                for char_id in performance_chars:
                    event_songs[char_id].add(song)
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
            for song in songs:
                chars[char_id]["songs"].setdefault(song, []).append(event["id"])
                character = identities.character_by_id.get(char_id) or {}
                actor_ids = cast_actor_by_character.get(char_id) or set()
                if not actor_ids and not character.get("cv_former"):
                    current_actor = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
                    if current_actor:
                        actor_ids = {current_actor}
                for actor_id in actor_ids:
                    if actor_id in voice:
                        voice[actor_id]["songs"].setdefault(song, []).append(event["id"])
    for bucket in (voice, chars):
        for value in bucket.values():
            value["events"].sort(key=lambda row: (row.get("date") or "0000-00-00", row["event_id"]), reverse=True)
            value["songs"] = [
                {"name": name, "event_ids": list(dict.fromkeys(event_ids)), "performances": len(set(event_ids))}
                for name, event_ids in sorted(value["songs"].items(), key=lambda row: (-len(set(row[1])), row[0]))
            ]
    return {
        "schema_version": 1,
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


def compatibility_files(events: list[dict[str, Any]], appearance_index: dict[str, Any], identities: IdentityIndex) -> tuple[dict[str, Any], dict[str, Any]]:
    actor_entries = []
    voice_events = []
    for event in events:
        actors = []
        for cast in event.get("cast") or []:
            actor_id = cast.get("voice_actor_id") or ""
            if actor_id and actor_id in identities.profile_by_id:
                actors.append(identities.profile_by_id[actor_id]["identity"]["ja"])
        days = []
        for session in event.get("sessions") or []:
            session_actors = []
            if event.get("cast_status") != "character_only":
                for char_id in session.get("character_ids") or []:
                    character = identities.character_by_id.get(char_id) or {}
                    actor_id = identities.voice_id(character.get("cv") or character.get("cv_zh") or "")
                    if actor_id and actor_id in identities.profile_by_id:
                        session_actors.append(identities.profile_by_id[actor_id]["identity"]["ja"])
            days.append({"label": session.get("label") or "", "voice_actors": sorted(set(session_actors or actors)), "songs": session.get("songs") or []})
        cat = "num" if event.get("series_id") == "numbered-live" else ("otherlive" if event.get("kind") == "concert" else "nonlive")
        actor_entries.append({"cat": cat, "actors": sorted(set(actors))})
        voice_events.append({"link": event.get("legacy_url") or f"/zh-Hans/events/{event['id']}", "title": event.get("title") or "", "cat": cat, "days": days})
    return (
        {"schema_version": 2, "generated_at": "source-build", "source": "events_catalog.json", "only_before_today": False, "total_events": len(actor_entries), "entries": actor_entries},
        {"schema_version": 2, "generated_at": "source-build", "source": "events_catalog.json", "total": len(voice_events), "events": voice_events},
    )


def validate(catalog: dict[str, Any], appearances: dict[str, Any], profiles: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    event_ids = [event.get("id") for event in catalog.get("events") or []]
    if len(event_ids) != len(set(event_ids)):
        errors.append("duplicate event IDs")
    actor_ids = [profile.get("id") for profile in profiles]
    if len(actor_ids) != len(set(actor_ids)):
        errors.append("duplicate voice actor IDs")
    known_actors = set(actor_ids)
    known_characters = set(appearances.get("characters") or {})
    for event in catalog.get("events") or []:
        if not event.get("title"):
            errors.append(f"event {event.get('id')} has no title")
        for cast in event.get("cast") or []:
            if cast.get("voice_actor_id") and cast["voice_actor_id"] not in known_actors:
                errors.append(f"event {event['id']} references unknown actor {cast['voice_actor_id']}")
            if cast.get("character_id") and cast["character_id"] not in known_characters:
                errors.append(f"event {event['id']} references unknown character {cast['character_id']}")
        for character_id in event.get("character_ids") or []:
            if character_id not in known_characters:
                errors.append(f"event {event['id']} references unknown character {character_id}")
        for session in event.get("sessions") or []:
            for character_id in session.get("character_ids") or []:
                if character_id not in known_characters:
                    errors.append(f"session {session.get('id')} references unknown character {character_id}")
    for actor_id, value in (appearances.get("voice_actors") or {}).items():
        if actor_id not in known_actors:
            errors.append(f"appearance index has unknown actor {actor_id}")
        for row in value.get("events") or []:
            if row.get("event_id") not in set(event_ids):
                errors.append(f"actor {actor_id} references unknown event {row.get('event_id')}")
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
        heading = re.fullmatch(r"(?:■\s*)?(?:(DAY\s*\d+|前編|後編)\s*)?(?:出走者|出演者)[:：]?", line, re.I)
        if not heading:
            continue
        label = (heading.group(1) or "本期节目").strip()
        cast = []
        for candidate in lines[index + 1:]:
            if re.fullmatch(r"(?:■\s*)?(?:(?:DAY\s*\d+|前編|後編)\s*)?(?:出走者|出演者)[:：]?", candidate, re.I):
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
        r"ぱかチューブっ!出張版|ぴすラジッ|ゴルシトーク|ぱかトークっ!",
        value,
        re.I,
    ))


def is_official_special_video(title: str) -> bool:
    value = unicodedata.normalize("NFKC", title or "")
    return bool(re.fullmatch(r"そこそこぱかライブTV\s*-EXTRA STAGE-", value, re.I))


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
    if not shutil_which("yt-dlp"):
        raise RuntimeError("yt-dlp is required for --refresh-programs")
    existing_doc = read_json(EVENTS_DIR / "official_programs.json") if (EVENTS_DIR / "official_programs.json").exists() else {"programs": []}
    existing_programs = list(existing_doc.get("programs") or [])
    rebuild_regular = int(existing_doc.get("schema_version") or 1) < 2
    channel_entries = discover_official_channel()
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
        return [{"kind": source_kind, "label": "官方公告" if source_kind == "official_announcement" else "官方 YouTube", "url": source_url}]

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
        richer = bool(program.get("cast")) or bool(program.get("video_id"))
        if richer:
            for field in ("title", "date", "end_date", "video_id", "url", "thumbnail", "duration", "summary", "source_kind", "source_url"):
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
            "expected_regular_episodes": len(expected_ids),
            "records": len(ordered),
            "source_verified_regular_episodes": len(found_ids),
            "metadata_pending_ids": missing_ids,
            "pakatube_character_programs": sum(row.get("series_id") == "pakatube-character-program" for row in ordered),
            "official_special_programs": sum(row.get("series_id") == "official-special" for row in ordered),
        },
        "programs": ordered,
    }


def shutil_which(name: str) -> str | None:
    paths = os.environ.get("PATH", "").split(os.pathsep)
    extensions = [""] if os.name != "nt" else os.environ.get("PATHEXT", ".EXE").split(os.pathsep)
    for directory in paths:
        for extension in extensions:
            candidate = Path(directory) / (name + extension)
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def build(programs_override: dict[str, Any] | None = None) -> dict[str, Any]:
    source_hashes = {path.name: sha256(path) for path in IMMUTABLE_LIVE_FILES}
    live_data = read_json(DATA_DIR / "live_data.json")
    live_cat_data = read_json(DATA_DIR / "live_cat_data.json")
    eventernote = read_json(DATA_DIR / "events_data.json")
    series = read_json(EVENTS_DIR / "series.json")
    programs = programs_override if programs_override is not None else read_json(EVENTS_DIR / "official_programs.json")
    overrides = read_json(EVENTS_DIR / "overrides.json")
    characters = read_window_data(DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    voice_list = read_window_data(DATA_DIR / "voice_list_data.js", "VA_LIST")
    photos = read_window_data(DATA_DIR / "va_photos_data.js", "VA_PHOTOS")
    previous_profiles = []
    if OUTPUT_FILES["profiles"].exists():
        previous_doc = read_json(OUTPUT_FILES["profiles"])
        previous_profiles = previous_doc.get("voice_actors") or []
    identities = IdentityIndex(characters, voice_list, photos, overrides, previous_profiles)
    used: set[str] = set()
    events = numbered_events(live_data, identities, used)
    events.extend(category_events(live_cat_data, identities, used))
    attach_eventernote(events, eventernote, identities, used)
    add_programs(events, programs, identities, used)
    events = apply_overrides(events, overrides)
    events = dedupe_events(events)
    for event in events:
        character_ids = list(event.get("character_ids") or [])
        for session in event.get("sessions") or []:
            for character_id in session.get("character_ids") or []:
                if character_id not in character_ids:
                    character_ids.append(character_id)
        event["characters"] = [
            {"id": character_id, "name": identities.character_by_id[character_id].get("zh") or "", "name_ja": identities.character_by_id[character_id].get("ja") or ""}
            for character_id in character_ids if character_id in identities.character_by_id
        ]
    events.sort(key=lambda event: (event.get("date") or "0000-00-00", event.get("title") or "", event["id"]), reverse=True)
    appearances = build_appearance_index(events, identities)
    profiles = enrich_profiles(identities.profiles, appearances)
    actor_compat, voice_compat = compatibility_files(events, appearances, identities)
    current_hashes = {path.name: sha256(path) for path in IMMUTABLE_LIVE_FILES}
    if current_hashes != source_hashes:
        raise RuntimeError("curated live sources changed during event build")
    kinds = Counter(event.get("kind") or "unknown" for event in events)
    modes = Counter(event.get("mode") or "unknown" for event in events)
    catalog = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
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
    errors = validate(catalog, appearances, profiles)
    if errors:
        raise RuntimeError("validation failed:\n- " + "\n- ".join(errors[:30]))
    return {"catalog": catalog, "appearances": appearances, "profiles": profiles_doc, "actor_compat": actor_compat, "voice_compat": voice_compat}


def comparable(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: comparable(item) for key, item in value.items() if key not in ("generated_at",)}
    if isinstance(value, list):
        return [comparable(item) for item in value]
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh-programs", action="store_true", help="refresh regular, character, and special programs from official sources")
    mode.add_argument("--check", action="store_true", help="validate sources and committed generated files without writing")
    args = parser.parse_args()
    refreshed = None
    if args.refresh_programs:
        refreshed = refresh_programs()
    built = build(refreshed)
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
    if refreshed is not None:
        atomic_json(EVENTS_DIR / "official_programs.json", refreshed)
        print(f"official programs refreshed: {len(refreshed['programs'])}")
    for key, path in OUTPUT_FILES.items():
        atomic_json(path, built[key])
    coverage = built["catalog"]["coverage"]
    print(f"event data written: {coverage['events']} events, {coverage['official_programs']} official programs, {len(built['profiles']['voice_actors'])} voice actors")
    print("curated live source integrity: " + ", ".join(f"{name}={info['sha256'][:12]}" for name, info in built["catalog"]["source_integrity"].items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
