"""Extract explicitly published Japanese broadcast times for programmes.

This module is deliberately conservative: a date without a clock remains
date-only, and video duration is never used as an end time.  All clock times
from official Japanese announcements and YouTube live metadata are JST.
"""
from __future__ import annotations

import datetime as _datetime
import re
from typing import Any

JST = _datetime.timezone(_datetime.timedelta(hours=9), name="Asia/Tokyo")

_CLOCK = re.compile(r"(?<!\d)(?P<hour>\d{1,2})(?:時(?:(?P<minute>\d{1,2})分?)?|:(?P<colon_minute>\d{2}))(?:\s*(?:から|より|に|放送|配信|公開|開始))?")
_BROADCAST_WORDS = re.compile(r"放送|配信|公開|生放送|ライブ|実況|stream|live", re.I)
_NOISE_WORDS = re.compile(r"chapter|チャプター|締切|期限|応募|抽選|受付|購入|販売|終了|メンテ", re.I)


def _clock(hour: Any, minute: Any = None) -> str | None:
    try:
        h, m = int(hour), int(minute or 0)
    except (TypeError, ValueError):
        return None
    if not 0 <= h <= 47 or not 0 <= m < 60:
        return None
    return f"{h:02d}:{m:02d}"


def _attach_date(schedule: dict[str, str] | None, broadcast_date: str = "") -> dict[str, str] | None:
    if not schedule or not broadcast_date:
        return schedule
    try:
        date = _datetime.date.fromisoformat(broadcast_date)
    except ValueError:
        return schedule
    hour = int(schedule["broadcast_time"][:2])
    if hour >= 24:
        schedule = dict(schedule)
        schedule["broadcast_time"] = f"{hour - 24:02d}:{schedule['broadcast_time'][3:]}"
        schedule["broadcast_date"] = (date + _datetime.timedelta(days=1)).isoformat()
    else:
        schedule = dict(schedule)
        schedule["broadcast_date"] = date.isoformat()
    return schedule


def _extract_from_text(text: str, *, require_context: bool) -> dict[str, str] | None:
    for line in str(text or "").splitlines():
        if _NOISE_WORDS.search(line) or (require_context and not _BROADCAST_WORDS.search(line)):
            continue
        for match in _CLOCK.finditer(line):
            # Avoid matching image dimensions, URLs, IDs, or ordinary dates.
            start = max(0, match.start() - 12)
            context = line[start:match.start()]
            if re.search(r"(?:https?://|[/-]\d{2,4}[/-]?$)", context):
                continue
            value = _clock(match.group("hour"), match.group("minute") or match.group("colon_minute"))
            if value:
                return {"broadcast_time": value, "broadcast_time_zone": "Asia/Tokyo", "broadcast_time_kind": "announced",
                        "time_precision": "minute" if match.group("minute") or match.group("colon_minute") else "hour"}
    return None


def extract_announced_time(source_title: str = "", source_description: str = "") -> dict[str, str] | None:
    """Return a clock only when the source makes its broadcast context clear."""
    return _extract_from_text(source_title, require_context=True) or _extract_from_text(source_description, require_context=True)


def extract_metadata_time(metadata: dict[str, Any] | None) -> dict[str, str] | None:
    """Convert an explicit live start/release timestamp to JST.

    The caller should only pass metadata verified to belong to the official
    programme.  A date-only release string intentionally produces no time.
    """
    if not isinstance(metadata, dict):
        return None
    # The watch-page fallback can only expose a calendar date. Older caches
    # converted that date to JST midnight; never reinterpret that synthetic
    # timestamp as a confirmed broadcast clock.
    if metadata.get("metadata_origin") == "official_watch_page" and metadata.get("release_precision") not in {"minute", "second"}:
        return None
    raw = metadata.get("startTimestamp") or metadata.get("live_start_timestamp") or metadata.get("release_timestamp")
    if raw in (None, ""):
        return None
    try:
        if isinstance(raw, str) and not raw.strip().replace('.', '', 1).isdigit():
            value = _datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if value.tzinfo is None:
                value = value.replace(tzinfo=JST)
            value = value.astimezone(JST)
        else:
            value = _datetime.datetime.fromtimestamp(float(raw), _datetime.timezone.utc).astimezone(JST)
    except (TypeError, ValueError, OverflowError, OSError):
        return None
    return {"broadcast_time": value.strftime("%H:%M"), "broadcast_date": value.date().isoformat(), "source_time_text": str(raw), "broadcast_time_zone": "Asia/Tokyo", "broadcast_time_kind": "metadata",
            "time_precision": "minute", **({"time_source_url": str(metadata.get("webpage_url") or metadata.get("source_url"))} if metadata.get("webpage_url") or metadata.get("source_url") else {})}


def schedule_for_program(*, source_title: str = "", source_description: str = "", metadata: dict[str, Any] | None = None, broadcast_date: str = "", source_url: str = "") -> dict[str, str]:
    """Merge schedules: explicit title > verified metadata > description."""
    title_schedule = _extract_from_text(source_title, require_context=True)
    if title_schedule:
        result = _attach_date(title_schedule, broadcast_date) or {}
        if source_url: result["time_source_url"] = source_url
        return result
    metadata_schedule = extract_metadata_time(metadata)
    if metadata_schedule:
        return metadata_schedule
    result = _attach_date(_extract_from_text(source_description, require_context=True), broadcast_date) or {}
    if result and source_url: result["time_source_url"] = source_url
    return result
