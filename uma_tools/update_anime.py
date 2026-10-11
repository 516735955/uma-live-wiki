#!/usr/bin/env python3
"""Observe official anime sources and emit review candidates without touching accepted data."""

from __future__ import annotations

import argparse
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ANIME_DIR = ROOT / "data" / "anime"
SNAPSHOT_DIR = ANIME_DIR / "source_snapshots"
CANDIDATE_FILE = ANIME_DIR / "update_candidates.json"
PORTAL_URL = "https://umamusume.jp/contents/anime/"
USER_AGENT = "Mozilla/5.0 (compatible; uma-live-wiki anime observer/1.0)"
OBSERVED_FIELDS = ("title_ja", "summary_ja", "staff_ja", "cast", "staff", "music", "stills")


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


def with_field_status(row: dict[str, Any], explicit_status: dict[str, str] | None = None) -> dict[str, Any]:
    """Mark fields returned by the parser; an empty parser value is unknown by default."""
    row = dict(row)
    explicit_status = explicit_status or row.get("field_status") or {}
    row["field_status"] = {
        field: explicit_status.get(field, "unknown" if field not in row or row[field] in (None, "", []) else "observed")
        for field in OBSERVED_FIELDS
    }
    return row


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

    rows = [with_field_status({
        "number": item["number"],
        "title_ja": item["title_ja"],
        "summary_ja": item["summary_ja"],
        "staff_ja": item["staff_text"],
        "stills": item["stills"],
        "source_url": item["source_url"],
    }) for item in collect_cingray()]
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
        if accepted:
            accepted_detail = (cingray_master.get("details") or {}).get(str(number), {})
            for field in ("summary_ja", "stills"):
                observed_value = unit.get(field)
                current_value = accepted_detail.get(field)
                if field == "stills":
                    current_value = [item.get("original", item) if isinstance(item, dict) else item
                                     for item in (current_value or [])]
                if current_value != observed_value:
                    out.append({"kind": "unit_field_changed", "work_id": "anime-cinderella-gray",
                                "unit_number": number, "field": field,
                                "current": current_value, "observed": observed_value,
                                "observed_status": (unit.get("field_status") or {}).get(field, "unknown")})
    master = next((row for row in series if row.get("work_id") == "anime-umayuru-fullgate"), {})
    details = master.get("details") or {}
    for unit in (fullgate or {}).get("units") or []:
        number = int(unit.get("number") or 0)
        if number > int(master.get("released_count") or 0):
            out.append({"kind": "new_unit", "work_id": "anime-umayuru-fullgate", "observed": unit})
        else:
            accepted = details.get(str(number)) or {}
            for field in ("title_ja", "summary_ja", "stills"):
                observed_value = unit.get(field)
                current_value = accepted.get(field)
                if field == "stills":
                    current_value = [item.get("original", item) if isinstance(item, dict) else item
                                     for item in (current_value or [])]
                if current_value != observed_value:
                    out.append({"kind": "unit_content_changed", "work_id": "anime-umayuru-fullgate",
                                "unit_number": number, "field": field,
                                "current": current_value, "observed": observed_value,
                                "observed_status": (unit.get("field_status") or {}).get(field, "unknown")})
    return _append_source_field_changes(out, cingray, fullgate)


def _append_source_field_changes(out: list[dict[str, Any]], cingray: dict[str, Any], fullgate: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Compare current source payloads with the prior snapshots without applying them."""
    previous = {
        "anime-cinderella-gray": _read_snapshot_units("cingray_story.json"),
        "anime-umayuru-fullgate": _read_snapshot_units("fullgate_story.json"),
    }
    for document in (cingray, fullgate or {}):
        default_work = "anime-cinderella-gray" if document is cingray else "anime-umayuru-fullgate"
        for unit in document.get("units") or []:
            work_id = unit.get("work_id") or default_work
            number = int(unit.get("number") or 0)
            old = previous.get(work_id, {}).get(number)
            if not old:
                continue
            for field in OBSERVED_FIELDS:
                if field not in unit or field not in old or unit.get(field) == old.get(field):
                    continue
                if any(row.get("kind") == "source_field_changed" and row.get("work_id") == work_id
                       and row.get("unit_number") == number and row.get("field") == field for row in out):
                    continue
                out.append({"kind": "source_field_changed", "work_id": work_id,
                            "unit_number": number, "field": field,
                            "current": old.get(field), "observed": unit.get(field),
                            "observed_status": (unit.get("field_status") or {}).get(field, "unknown"),
                            "source": document.get("source_url", "")})
    return out


def _read_snapshot_units(filename: str) -> dict[int, dict[str, Any]]:
    path = SNAPSHOT_DIR / filename
    if not path.exists():
        return {}
    try:
        rows = read_json(path).get("units") or []
        return {int(row["number"]): row for row in rows if row.get("number") is not None}
    except (OSError, ValueError, TypeError, KeyError):
        return {}


def _classify_link_status(status: int | None, error: str = "") -> str:
    if status is None:
        return "transient"
    if 200 <= status < 400:
        return "reachable"
    if status in (401, 403):
        return "auth_or_region"
    if status == 429:
        return "transient"
    if status in (404, 410):
        return "invalid"
    if 500 <= status < 600:
        return "transient"
    return "unverified"


def _unit_work_map() -> dict[str, str]:
    try:
        from build_anime_catalog import expand_units
    except ModuleNotFoundError:
        from uma_tools.build_anime_catalog import expand_units
    works = read_json(ANIME_DIR / "works.json").get("works") or []
    series = read_json(ANIME_DIR / "units.json").get("series") or []
    return {str(unit["id"]): str(unit["work_id"])
            for unit in expand_units(series, {str(work.get("id")): work for work in works})}


def _resource_scope_metadata(resource: dict[str, Any], unit_to_work: dict[str, str]) -> tuple[dict[str, Any], str | None, list[str]]:
    scope = dict(resource.get("scope") or {})
    unit_ids = list(dict.fromkeys(str(unit_id) for unit_id in resource.get("unit_ids") or []))
    if scope.get("type") == "unit" and scope.get("id"):
        unit_id = str(scope["id"])
        if unit_id not in unit_ids:
            unit_ids.insert(0, unit_id)
        return scope, unit_to_work.get(unit_id), unit_ids
    if scope.get("type") == "work":
        return scope, str(scope.get("id")) if scope.get("id") else None, unit_ids
    return scope, None, unit_ids


def check_watch_links(observed_at: str) -> dict[str, Any]:
    resources = read_json(ANIME_DIR / "watch_resources.json").get("resources") or []
    unit_to_work = _unit_work_map()
    def check_one(resource: dict[str, Any], url: str | None = None) -> dict[str, Any]:
        url = str(resource.get("url") or "")
        if not url:
            return {"resource_id": resource.get("id"), "work_id": resource.get("work_id"),
                    "unit_id": resource.get("unit_id"), "url": url, "http_status": None,
                    "status": "unknown", "error": "missing URL"}
        status = None
        error = ""
        final_url = url
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT}, method="HEAD")
            with urllib.request.urlopen(request, timeout=8) as response:
                status = int(response.status)
                final_url = response.geturl()
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            error = str(exc.reason or "HTTP error")
            final_url = exc.geturl() or url
            if status in (405, 501):
                try:
                    fallback = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": "bytes=0-1023"})
                    with urllib.request.urlopen(fallback, timeout=8) as response:
                        status = int(response.status)
                        final_url = response.geturl()
                        response.read(4096)
                        error = "HEAD unsupported; checked with bounded GET"
                except urllib.error.HTTPError as fallback_error:
                    status = int(fallback_error.code)
                    error = str(fallback_error.reason or "HTTP error")
                    final_url = fallback_error.geturl() or url
                except (OSError, urllib.error.URLError, TimeoutError) as fallback_error:
                    status = None
                    error = f"HEAD unsupported; GET failed: {fallback_error}"
        except (OSError, urllib.error.URLError, TimeoutError) as exc:
            error = str(exc)
        scope, work_id, unit_ids = _resource_scope_metadata(resource, unit_to_work)
        return {"resource_id": resource.get("id"), "scope": scope,
                "work_id": work_id, "unit_ids": unit_ids, "url": url,
                "final_url": final_url, "http_status": status,
                "status": _classify_link_status(status, error), "access": resource.get("access"),
                "regions": list(resource.get("regions") or []), "error": error}
    unique_urls = {}
    for resource in resources:
        unique_urls.setdefault(str(resource.get("url") or ""), resource)
    with ThreadPoolExecutor(max_workers=4) as pool:
        checked = dict(zip(unique_urls, pool.map(lambda item: check_one(item[1], item[0]), unique_urls.items())))
    rows = []
    for resource in resources:
        url_key = str(resource.get("url") or "")
        row = dict(checked[url_key]) if url_key in checked else check_one(resource)
        scope, work_id, unit_ids = _resource_scope_metadata(resource, unit_to_work)
        row["resource_id"] = resource.get("id")
        row["scope"] = scope
        row["work_id"] = work_id
        row["unit_ids"] = unit_ids
        row["access"] = resource.get("access")
        row["regions"] = list(resource.get("regions") or [])
        rows.append(row)
    return {"schema_version": 1, "observed_at": observed_at, "resources": rows,
            "note": "HTTP reachability only; this does not establish full playback availability."}


def link_candidates(current: dict[str, Any]) -> list[dict[str, Any]]:
    previous_path = SNAPSHOT_DIR / "watch_resources_status.json"
    if not previous_path.exists():
        return []
    previous_document = remap_watch_status_document(read_json(previous_path))
    previous = {str(row.get("resource_id")): row for row in previous_document.get("resources") or []}
    out = []
    for row in current.get("resources") or []:
        old = previous.get(str(row.get("resource_id")))
        if old and (old.get("status"), old.get("http_status")) != (row.get("status"), row.get("http_status")):
            out.append({"kind": "watch_resource_status_changed", "resource_id": row.get("resource_id"),
                        "work_id": row.get("work_id"), "unit_ids": row.get("unit_ids") or [],
                        "current": {"status": old.get("status"), "http_status": old.get("http_status")},
                        "observed": {"status": row.get("status"), "http_status": row.get("http_status")},
                        "error": row.get("error", "")})
    return out


def remap_watch_status_document(document: dict[str, Any]) -> dict[str, Any]:
    """Rebuild relation metadata from the accepted resource master without HTTP."""
    resources = {str(row.get("id")): row for row in read_json(ANIME_DIR / "watch_resources.json").get("resources") or []}
    unit_to_work = _unit_work_map()
    document = dict(document)
    rows = []
    for old in document.get("resources") or []:
        row = dict(old)
        resource = resources.get(str(old.get("resource_id")))
        if resource:
            scope, work_id, unit_ids = _resource_scope_metadata(resource, unit_to_work)
            row["scope"] = scope
            row["work_id"] = work_id
            row["unit_ids"] = unit_ids
            row["access"] = resource.get("access")
            row["regions"] = list(resource.get("regions") or [])
        row.setdefault("final_url", row.get("url", ""))
        rows.append(row)
    document["resources"] = rows
    return document


def observe_sources(observed_at: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    portal = observe_portal(observed_at)
    cingray = observe_cingray(observed_at)
    from collect_anime_official import collect_fullgate
    fullgate = {"schema_version": 1, "observed_at": observed_at,
                "source_url": "https://umamusume.jp/contents/anime/umayuru-fullgate/",
                "units": [with_field_status(row) for row in collect_fullgate()]}
    return portal, cingray, fullgate


def _safe_observe(label: str, observer: Any, snapshot_name: str, observed_at: str) -> tuple[dict[str, Any], dict[str, str] | None]:
    try:
        return observer(observed_at), None
    except Exception as exc:
        path = SNAPSHOT_DIR / snapshot_name
        try:
            fallback = read_json(path) if path.exists() else {"schema_version": 1, "observed_at": observed_at, "units": []}
        except Exception as snapshot_error:
            fallback = {"schema_version": 1, "observed_at": observed_at, "units": []}
            exc = RuntimeError(f"{exc}; previous snapshot unavailable: {snapshot_error}")
        return fallback, {"source": label, "error": f"{type(exc).__name__}: {exc}", "snapshot": snapshot_name}


def _candidate_key(row: dict[str, Any]) -> tuple[Any, ...]:
    kind = row.get("kind")
    observed = row.get("observed") or {}
    if kind == "new_work":
        return (kind, row.get("source"), observed.get("url"), None, None)
    if kind == "new_unit":
        return (kind, row.get("work_id"), observed.get("number"), None, None)
    return (kind, row.get("work_id"), row.get("unit_number"), row.get("field"), row.get("resource_id"))


def _unknown_source_keys(*documents: dict[str, Any]) -> set[tuple[Any, ...]]:
    keys = set()
    for document in documents:
        default_work = "anime-cinderella-gray" if document.get("source_url", "").find("cinderella") >= 0 else "anime-umayuru-fullgate"
        for unit in document.get("units") or []:
            work_id = unit.get("work_id") or default_work
            number = int(unit.get("number") or 0)
            for field, status in (unit.get("field_status") or {}).items():
                if status == "unknown":
                    keys.add((None, work_id, number, field, None))
    return keys


def _accepted_source_matches(row: dict[str, Any]) -> bool:
    """Resolve source changes only where accepted data has a comparable field."""
    field = row.get("field")
    if field not in {"title_ja", "summary_ja", "stills"}:
        return False
    series = read_json(ANIME_DIR / "units.json").get("series") or []
    master = next((item for item in series if item.get("work_id") == row.get("work_id")), None)
    if not master:
        return False
    detail = (master.get("details") or {}).get(str(row.get("unit_number")), {})
    accepted = detail.get(field)
    if field == "title_ja":
        titles = master.get("titles_ja") or []
        number = int(row.get("unit_number") or 0)
        accepted = titles[number - 1] if 0 < number <= len(titles) else accepted
    if field == "stills":
        accepted = [item.get("original", item) if isinstance(item, dict) else item for item in (accepted or [])]
    return accepted == row.get("observed")


def _candidate_marker(row: dict[str, Any]) -> str:
    key = _candidate_key(row)
    if any(value is not None for value in key):
        return json.dumps(key, ensure_ascii=False, sort_keys=True)
    return json.dumps(row, ensure_ascii=False, sort_keys=True)


def merge_candidates(previous: list[dict[str, Any]], current: list[dict[str, Any]], errors: list[dict[str, str]], *documents: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep unresolved candidates through a failed source observation."""
    unknown_keys = _unknown_source_keys(*documents)
    unresolved_previous = [row for row in previous if (None, row.get("work_id"), row.get("unit_number"), row.get("field"), None) in unknown_keys
                           or (row.get("kind") == "source_field_changed" and not _accepted_source_matches(row))]
    if errors:
        merged_by_key: dict[str, dict[str, Any]] = {}
        for row in previous:
            if row.get("kind") == "source_field_changed" and _accepted_source_matches(row):
                continue
            merged_by_key[_candidate_marker(row)] = row
        for row in current:
            # Current observation wins for a key, including a changed status or error.
            merged_by_key[_candidate_marker(row)] = row
        return list(merged_by_key.values())
    merged = list(current)
    reverted = set()
    current_by_key = {_candidate_key(row): row for row in current}
    for old in previous:
        key = _candidate_key(old)
        new = current_by_key.get(key)
        if old.get("kind") == "source_field_changed" and new and new.get("observed") == old.get("current"):
            reverted.add(key)
    merged = [row for row in merged if _candidate_key(row) not in reverted]
    known = {_candidate_key(row) for row in merged}
    for row in unresolved_previous:
        if _candidate_key(row) not in known and _candidate_key(row) not in reverted:
            merged.append(row)
    return merged


def accepted_coverage() -> dict[str, Any]:
    try:
        from build_anime_catalog import expand_units
    except ModuleNotFoundError:
        from uma_tools.build_anime_catalog import expand_units

    works = read_json(ANIME_DIR / "works.json").get("works") or []
    series = read_json(ANIME_DIR / "units.json").get("series") or []
    units = expand_units(series, {str(row.get("id")): row for row in works})
    relations = read_json(ANIME_DIR / "relations.json").get("relations") or []
    staff = read_json(ANIME_DIR / "staff.json").get("credits") or []
    watch = read_json(ANIME_DIR / "watch_resources.json").get("resources") or []
    cast = read_json(ANIME_DIR / "episode_cast.json").get("episodes") or []
    relation_by_unit: dict[str, list[dict[str, Any]]] = {}
    staff_by_unit: dict[str, list[dict[str, Any]]] = {}
    for relation in relations:
        if relation.get("source_type") == "anime_unit":
            relation_by_unit.setdefault(str(relation.get("source_id")), []).append(relation)
    for credit in staff:
        if credit.get("unit_id"):
            staff_by_unit.setdefault(str(credit["unit_id"]), []).append(credit)
    cast_by_unit = {f"{row.get('work')}-e{int(row.get('number') or 0):02d}": row for row in cast if row.get("work")}
    watch_by_unit: set[str] = set()
    for resource in watch:
        scope = resource.get("scope") or {}
        if scope.get("type") == "unit" and scope.get("id"):
            watch_by_unit.add(str(scope["id"]))
        watch_by_unit.update(str(unit_id) for unit_id in resource.get("unit_ids") or [])

    def empty_counts() -> dict[str, int]:
        return {"present": 0, "confirmed_empty": 0, "unknown": 0}

    result: dict[str, Any] = {}
    for unit in units:
        unit_id = str(unit.get("id"))
        work_id = str(unit.get("work_id"))
        details = unit
        relations_for_unit = relation_by_unit.get(unit_id, [])
        statuses = {
            "title_ja": "present" if details.get("title_ja") else "unknown",
            "summary_ja": "present" if details.get("summary_ja") else "unknown",
            "music": "present" if details.get("music_cues") or any(r.get("relation_type") == "uses_song" for r in relations_for_unit) else "unknown",
            "cast": "present" if any(r.get("relation_type") == "credited_cast" for r in relations_for_unit) or cast_by_unit.get(unit_id, {}).get("cast") else "unknown",
            "staff": "present" if details.get("staff_status") == "complete" and staff_by_unit.get(unit_id) else "unknown",
            "official_watch": "present" if unit_id in watch_by_unit else "unknown",
            "hq_stills": "present" if details.get("stills") else "unknown",
        }
        work_result = result.setdefault(work_id, {"units": 0, "fields": {field: empty_counts() for field in statuses}})
        work_result["units"] += 1
        for field, status in statuses.items():
            work_result["fields"][field][status] += 1
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--refresh", action="store_true", help="observe official sources and write snapshots/candidates")
    modes.add_argument("--observe", action="store_true", help="explicitly observe official sources; write only snapshots/candidates")
    modes.add_argument("--check", action="store_true", help="validate local catalog, snapshots, and candidates; never use the network")
    parser.add_argument("--check-links", action="store_true", help="with --refresh/--observe, check official watch URL HTTP reachability only")
    args = parser.parse_args()
    if args.check_links and args.check:
        parser.error("--check-links requires --refresh or --observe")
    if args.check:
        from build_anime_catalog import build

        catalog, _ = build()
        candidate_document = read_json(CANDIDATE_FILE)
        if candidate_document.get("schema_version") != 1 or not isinstance(candidate_document.get("candidates"), list):
            raise ValueError("update_candidates.json has an invalid schema")
        for filename in ("cingray_story.json", "fullgate_story.json"):
            snapshot = read_json(SNAPSHOT_DIR / filename)
            for row in snapshot.get("units") or []:
                statuses = row.get("field_status") or {}
                if not statuses:
                    # Snapshots made before field-level status tracking remain readable;
                    # the next explicit observation upgrades them in place.
                    continue
                for field in OBSERVED_FIELDS:
                    if statuses.get(field) not in {"observed", "confirmed_empty", "unknown"}:
                        raise ValueError(f"{filename} unit {row.get('number')} has invalid field status for {field}")
        print(
            "anime update boundary valid: "
            f"{catalog['coverage']['works']} accepted works, "
            f"{catalog['coverage']['units']} accepted units; local-only check (no network)"
        )
        return 0

    observed_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    portal, portal_error = _safe_observe("official-anime-portal", observe_portal, "official_anime_portal.json", observed_at)
    cingray, cingray_error = _safe_observe("official-cingray", observe_cingray, "cingray_story.json", observed_at)
    def collect_fullgate_observation(at: str) -> dict[str, Any]:
        from collect_anime_official import collect_fullgate
        return {"schema_version": 1, "observed_at": at,
                "source_url": "https://umamusume.jp/contents/anime/umayuru-fullgate/",
                "units": [with_field_status(row) for row in collect_fullgate()]}
    fullgate, fullgate_error = _safe_observe("official-fullgate", collect_fullgate_observation, "fullgate_story.json", observed_at)
    source_errors = [error for error in (portal_error, cingray_error, fullgate_error) if error]
    rows = candidates(portal, cingray, fullgate)
    if args.check_links:
        link_status = check_watch_links(observed_at)
        rows.extend(link_candidates(link_status))
        transient_links = sum(row.get("status") in {"transient", "unknown"} for row in link_status.get("resources") or [])
        if transient_links:
            source_errors.append({"source": "watch-links", "error": f"{transient_links} link checks were transient or unknown"})
        atomic_json(SNAPSHOT_DIR / "watch_resources_status.json", link_status)
    previous_candidates = read_json(CANDIDATE_FILE).get("candidates") or [] if CANDIDATE_FILE.exists() else []
    rows = merge_candidates(previous_candidates, rows, source_errors, cingray, fullgate)
    # A failed source never replaces its last good snapshot. Write the candidate
    # document last so a partial run cannot erase unresolved differences.
    if not portal_error:
        atomic_json(SNAPSHOT_DIR / "official_anime_portal.json", portal)
    if not cingray_error:
        atomic_json(SNAPSHOT_DIR / "cingray_story.json", cingray)
    if not fullgate_error:
        atomic_json(SNAPSHOT_DIR / "fullgate_story.json", fullgate)
    atomic_json(CANDIDATE_FILE, {"schema_version": 1, "observed_at": observed_at,
                                 "candidates": rows, "observation_errors": source_errors,
                                 "accepted_coverage": accepted_coverage()})
    action = "refreshed" if args.refresh else "observed"
    print(f"anime observations {action}: {len(portal.get('works') or [])} works, {len(cingray.get('units') or [])} Cingray units, {len(rows)} candidates, {len(source_errors)} source errors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
