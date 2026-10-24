"""Apply archived Chinese event copy without changing source identities."""
from __future__ import annotations

import json
import re
from pathlib import Path


def read_records(path: Path) -> dict:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        return document.get("records") or {}
    except FileNotFoundError:
        return {}


def apply_localizations(events: list[dict], data_dir: Path) -> None:
    reviewed = read_records(data_dir / "events/localizations.json")
    automatic = read_records(data_dir / "auto_update/event_localizations.json")
    for event in events:
        original_title = str(event.get("title") or "")
        original_summary = str(event.get("summary") or "")
        event["title_ja"] = original_title
        event["summary_ja"] = original_summary
        manual = reviewed.get(event["id"], {})
        saved = automatic.get(event["id"], {})
        title_zh = (manual.get("title_zh") if manual.get("title_ja") == original_title else "") or (
            saved.get("title_zh") if saved.get("title_ja") == original_title else ""
        )
        summary_zh = ""
        # A changed introduction needs a new translation; an old approved
        # translation must not silently replace new official information.
        if manual.get("summary_ja", original_summary) == original_summary:
            summary_zh = manual.get("summary_zh") or ""
        if not summary_zh and saved.get("summary_ja") == original_summary:
            summary_zh = saved.get("summary_zh") or ""
        if title_zh:
            event["title"] = event["title_zh"] = title_zh
        if summary_zh:
            event["summary"] = event["summary_zh"] = summary_zh
        event["localization_state"] = "complete" if (
            (title_zh or not re.search(r"[\u3040-\u30ff]", original_title))
            and (summary_zh or not re.search(r"[\u3040-\u30ff]", original_summary))
        ) else "pending"
