#!/usr/bin/env python3
"""Observe official anime sources and emit review candidates without touching accepted data."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ANIME_DIR = ROOT / "data" / "anime"
SNAPSHOT_DIR = ANIME_DIR / "source_snapshots"
CANDIDATE_FILE = ANIME_DIR / "update_candidates.json"
PORTAL_URL = "https://umamusume.jp/contents/anime/"
USER_AGENT = "Mozilla/5.0 (compatible; uma-live-wiki anime observer/1.0)"


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def fetch(url: str, headers: dict[str, str] | None = None) -> bytes:
    request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers=request_headers)
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except Exception as current:
            error = current
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed to observe {url}: {error}")


def observe_portal(observed_at: str) -> dict[str, Any]:
    from bs4 import BeautifulSoup

    html = fetch(PORTAL_URL).decode("utf-8", "replace")
    rows = []
    seen = set()
    for anchor in BeautifulSoup(html, "html.parser").select("a.btn-viewmore[href]"):
        image = anchor.find("img", alt=True)
        if image is None:
            continue
        title = re.sub(r"\s+", " ", image["alt"]).strip()
        href = urllib.parse.urljoin(PORTAL_URL, anchor["href"])
        key = (title, href)
        if not title or key in seen:
            continue
        seen.add(key)
        rows.append({"title": title, "url": href})
    if not rows:
        raise RuntimeError("official anime portal returned no recognizable entries")
    return {"schema_version": 1, "source_url": PORTAL_URL, "observed_at": observed_at, "works": rows}


def observe_cingray(observed_at: str) -> dict[str, Any]:
    from collect_anime_official import collect_cingray

    rows = [{
        "number": item["number"],
        "title_ja": item["title_ja"],
        "summary_ja": item["summary_ja"],
        "staff_ja": item["staff_text"],
        "stills": item["stills"],
        "source_url": item["source_url"],
    } for item in collect_cingray()]
    rows.sort(key=lambda row: row["number"])
    if not rows:
        raise RuntimeError("Cinderella Gray official source returned no episodes")
    return {"schema_version": 1, "source_url": "https://anime-cinderellagray.com/story/", "observed_at": observed_at, "units": rows}


def candidates(portal: dict[str, Any], cingray: dict[str, Any], fullgate: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    works = read_json(ANIME_DIR / "works.json").get("works") or []
    series = read_json(ANIME_DIR / "units.json").get("series") or []
    known_urls = {str(work.get("official_url") or "").rstrip("/") for work in works}
    out: list[dict[str, Any]] = []
    for row in portal.get("works") or []:
        if str(row.get("url") or "").rstrip("/") not in known_urls:
            out.append({"kind": "new_work", "source": "official-anime-portal", "observed": row})
    cingray_master = next((row for row in series if row.get("work_id") == "anime-cinderella-gray"), {})
    titles = list(cingray_master.get("titles_ja") or [])
    for unit in cingray.get("units") or []:
        number = int(unit.get("number") or 0)
        accepted = titles[number - 1] if 0 < number <= len(titles) else ""
        if not accepted:
            out.append({"kind": "new_unit", "work_id": "anime-cinderella-gray", "observed": unit})
        elif accepted != unit.get("title_ja"):
            out.append({
                "kind": "unit_title_changed",
                "work_id": "anime-cinderella-gray",
                "unit_number": number,
                "current": accepted,
                "observed": unit.get("title_ja"),
                "source": "official-cingray",
            })
    master = next((row for row in series if row.get("work_id") == "anime-umayuru-fullgate"), {})
    details = master.get("details") or {}
    for unit in (fullgate or {}).get("units") or []:
        number = int(unit.get("number") or 0)
        if number > int(master.get("released_count") or 0):
            out.append({"kind": "new_unit", "work_id": "anime-umayuru-fullgate", "observed": unit})
        else:
            accepted = details.get(str(number)) or {}
            for field in ("title_ja", "summary_ja"):
                if accepted.get(field) != unit.get(field):
                    out.append({"kind": "unit_content_changed", "work_id": "anime-umayuru-fullgate",
                                "unit_number": number, "field": field,
                                "current": accepted.get(field), "observed": unit.get(field)})
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="write source snapshots and update candidates")
    parser.add_argument("--check", action="store_true", help="observe and validate without writing")
    args = parser.parse_args()
    if not args.refresh and not args.check:
        parser.error("choose --refresh or --check")
    if args.check:
        from build_anime_catalog import build

        catalog, _ = build()
        candidate_document = read_json(CANDIDATE_FILE)
        if candidate_document.get("schema_version") != 1 or not isinstance(candidate_document.get("candidates"), list):
            raise ValueError("update_candidates.json has an invalid schema")
        print(
            "anime update boundary valid: "
            f"{catalog['coverage']['works']} accepted works, "
            f"{catalog['coverage']['units']} accepted units; observer writes snapshots and candidates only"
        )
        return 0

    observed_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    portal = observe_portal(observed_at)
    cingray = observe_cingray(observed_at)
    from collect_anime_official import collect_fullgate
    fullgate = {"schema_version": 1, "observed_at": observed_at, "units": collect_fullgate()}
    rows = candidates(portal, cingray, fullgate)
    atomic_json(SNAPSHOT_DIR / "official_anime_portal.json", portal)
    atomic_json(SNAPSHOT_DIR / "cingray_story.json", cingray)
    atomic_json(SNAPSHOT_DIR / "fullgate_story.json", fullgate)
    atomic_json(CANDIDATE_FILE, {"schema_version": 1, "observed_at": observed_at, "candidates": rows})
    print(f"anime observations refreshed: {len(portal['works'])} works, {len(cingray['units'])} Cingray units, {len(rows)} candidates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
