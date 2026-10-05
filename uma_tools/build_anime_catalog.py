#!/usr/bin/env python3
"""Build deterministic anime catalogs from the accepted data/anime sources."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any
from anime_labels import role_label, person_label, group_label


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "data" / "anime"
CATALOG_FILE = ROOT / "data" / "anime_catalog.json"
RELATION_INDEX_FILE = ROOT / "data" / "anime_relation_index.json"
SOURCE_FILES = (
    "works.json",
    "units.json",
    "watch_resources.json",
    "relations.json",
    "staff.json",
    "people.json",
    "source_registry.json",
    "overrides.json",
)


def read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def compact_hash(payload: Any) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()[:16]


def atomic_json(path: Path, payload: Any, *, indent: int = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=indent)
            handle.write("\n")
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def date_for(number: int, blocks: list[dict[str, Any]]) -> str:
    for block in blocks:
        start_number = int(block.get("from") or 1)
        end_number = int(block.get("to") or start_number)
        if not start_number <= number <= end_number:
            continue
        dates = block.get("dates") or []
        if dates:
            offset = number - start_number
            return str(dates[offset]) if offset < len(dates) else ""
        start = dt.date.fromisoformat(str(block["start"]))
        return (start + dt.timedelta(days=(number - start_number) * int(block.get("interval_days") or 7))).isoformat()
    return ""


def unit_label(unit_type: str, number: int) -> str:
    labels = {
        "episode": f"第 {number} 话",
        "short": f"第 {number} 话",
        "bd_short": f"第 {number} 话",
        "ova": f"OVA {number}",
        "special": "特别动画",
        "movie": "电影正片",
    }
    return labels.get(unit_type, f"内容 {number}")


def expand_units(series_rows: list[dict[str, Any]], works_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    units: list[dict[str, Any]] = []
    for series in series_rows:
        work_id = str(series.get("work_id") or "")
        work = works_by_id.get(work_id)
        if not work:
            raise ValueError(f"unit series references unknown work: {work_id}")
        count = int(series.get("count") or 0)
        released_count = int(series.get("released_count") or 0)
        titles_zh = list(series.get("titles_zh") or [])
        titles_ja = list(series.get("titles_ja") or [])
        types = series.get("types") or {}
        labels = series.get("labels") or {}
        for number in range(1, min(count, released_count) + 1):
            key = str(number)
            unit_type = str(types.get(key) or series.get("unit_type") or "episode")
            label = str(labels.get(key) or unit_label(unit_type, number))
            title_ja = str(titles_ja[number - 1]) if number <= len(titles_ja) else ""
            title_zh = str(titles_zh[number - 1]) if number <= len(titles_zh) else (title_ja or label)
            unit_id = f"{work_id}-e{number:02d}"
            units.append({
                "id": unit_id,
                "work_id": work_id,
                "number": number,
                "label": label,
                "unit_type": unit_type,
                "title_zh": title_zh,
                "title_ja": title_ja,
                "summary_zh": "",
                "release_date": date_for(number, list(series.get("date_blocks") or [])),
                "status": "released",
                "stills": [],
                "source_refs": list(series.get("source_refs") or []),
                **(series.get("details") or {}).get(key, {}),
            })
    return units


def validate(
    works: list[dict[str, Any]],
    units: list[dict[str, Any]],
    resources: list[dict[str, Any]],
    relations: list[dict[str, Any]],
    staff: list[dict[str, Any]],
    sources: list[dict[str, Any]],
) -> None:
    errors: list[str] = []

    def unique(rows: list[dict[str, Any]], name: str) -> set[str]:
        values = [str(row.get("id") or "") for row in rows]
        if any(not value for value in values):
            errors.append(f"{name} contains an empty ID")
        if len(values) != len(set(values)):
            errors.append(f"{name} contains duplicate IDs")
        return set(values)

    work_ids = unique(works, "works")
    unit_ids = unique(units, "units")
    source_ids = unique(sources, "sources")
    unique(resources, "watch resources")
    unique(relations, "relations")

    allowed_formats = {"tv", "movie", "web", "short", "web_short", "special"}
    allowed_work_statuses = {"announced", "airing", "completed"}
    for work in works:
        if work.get("format") not in allowed_formats:
            errors.append(f"work {work.get('id')} has invalid format {work.get('format')}")
        if work.get("status") not in allowed_work_statuses:
            errors.append(f"work {work.get('id')} has invalid status {work.get('status')}")
        if not work.get("summary_zh"):
            errors.append(f"work {work.get('id')} has no fixed Chinese summary")
        for source_ref in work.get("source_refs") or []:
            if source_ref not in source_ids:
                errors.append(f"work {work.get('id')} references unknown source {source_ref}")
    for unit in units:
        if unit.get("work_id") not in work_ids:
            errors.append(f"unit {unit.get('id')} references unknown work")
        if unit.get("status") not in {"released", "scheduled"}:
            errors.append(f"unit {unit.get('id')} has invalid status")
        for cue in unit.get("music_cues", []):
            if not cue.get("title") or cue.get("usage_type") not in {"fanfare", "insert", "bgm"}:
                errors.append(f"unit {unit.get('id')} has an invalid music cue")
            if not cue.get("source_refs") or any(ref not in source_ids for ref in cue["source_refs"]):
                errors.append(f"unit {unit.get('id')} has a music cue without registered evidence")
    for resource in resources:
        scope = resource.get("scope") or {}
        target_set = work_ids if scope.get("type") == "work" else unit_ids
        if scope.get("id") not in target_set:
            errors.append(f"resource {resource.get('id')} has invalid scope")
        if resource.get("authority") not in {"official", "licensed", "community"}:
            errors.append(f"resource {resource.get('id')} has invalid authority")
        if resource.get("status") not in {"active", "region_limited", "expired", "removed", "unverified"}:
            errors.append(f"resource {resource.get('id')} has invalid status")
        for unit_id in resource.get("unit_ids") or []:
            if unit_id not in unit_ids:
                errors.append(f"resource {resource.get('id')} references unpublished unit {unit_id}")
        for source_ref in [*(resource.get("source_refs") or []), *([resource["source_ref"]] if resource.get("source_ref") else [])]:
            if source_ref not in source_ids:
                errors.append(f"resource {resource.get('id')} references unknown evidence {source_ref}")
        if not str(resource.get("url") or "").startswith("https://"):
            errors.append(f"resource {resource.get('id')} must use HTTPS")
    for relation in relations:
        source_type = relation.get("source_type")
        source_id = relation.get("source_id")
        if source_type == "anime_work" and source_id not in work_ids:
            errors.append(f"relation {relation.get('id')} references unknown work")
        if source_type == "anime_unit" and source_id not in unit_ids:
            errors.append(f"relation {relation.get('id')} references unknown unit")
        if relation.get("target_type") == "anime_work" and relation.get("target_id") not in work_ids:
            errors.append(f"relation {relation.get('id')} references unknown target work")
        for source_ref in relation.get("evidence_refs") or []:
            if source_ref not in source_ids:
                errors.append(f"relation {relation.get('id')} references unknown evidence {source_ref}")
    for credit in staff:
        if credit.get("work_id") not in work_ids:
            errors.append(f"staff credit references unknown work {credit.get('work_id')}")
        if credit.get("unit_id") and credit["unit_id"] not in unit_ids:
            errors.append(f"staff credit references unpublished unit {credit['unit_id']}")
        if credit.get("source_ref") not in source_ids:
            errors.append(f"staff credit references unknown evidence {credit.get('source_ref')}")
        unit = next((u for u in units if u["id"] == credit.get("unit_id")), None)
        if unit and unit["work_id"] != credit["work_id"]:
            errors.append(f"staff credit has mismatched work and unit: {credit.get('unit_id')}")
    characters = json.loads((ROOT / "data/character_index_data.js").read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
    songs = read_json(ROOT / "data/song_catalog.json")["songs"]
    targets = {
        "character": {row["id"] for row in characters},
        "song": {row["id"] for row in songs},
        "voice_actor": {row["id"] for row in read_json(ROOT / "data/voice_actor_profiles.json")["voice_actors"]},
        "album": {row["id"] for row in read_json(ROOT / "data/albums.json")},
        "event": {row["id"] for row in read_json(ROOT / "data/events_catalog.json")["events"]},
        "creator": {row["id"] for row in read_json(ROOT / "data/creator_catalog.json")["creators"]},
    }
    for unit in units:
        for cue in unit.get("music_cues", []):
            if cue.get("song_id") and cue["song_id"] not in targets["song"]:
                errors.append(f"unit {unit['id']} references a missing cue song")
            for credit in cue.get("credits", []):
                creator_ids = credit.get("creator_ids", [])
                if creator_ids and (len(creator_ids) != len(credit.get("names", []))
                                    or any(value not in targets["creator"] for value in creator_ids)):
                    errors.append(f"unit {unit['id']} has invalid cue creator links")
    for relation in relations:
        kind = relation.get("target_type")
        if kind in targets and relation.get("target_id") not in targets[kind]:
            errors.append(f"relation {relation['id']} references missing {kind}")
        if relation.get("voice_actor_id") and relation["voice_actor_id"] not in targets["voice_actor"]:
            errors.append(f"relation {relation['id']} references missing credited voice actor")
        if relation.get("version_id"):
            song = next((row for row in songs if row["id"] == relation.get("target_id")), {})
            version = next((row for row in song.get("versions", []) if row["id"] == relation["version_id"]), None)
            if not version:
                errors.append(f"relation {relation['id']} references a recording outside its song")
            elif relation.get("release_id") and not any(row["album_id"] == relation["release_id"] for row in version.get("releases", [])):
                errors.append(f"relation {relation['id']} references a release outside its recording")
    if errors:
        raise ValueError("anime data invalid:\n- " + "\n- ".join(errors))


def build() -> tuple[dict[str, Any], dict[str, Any]]:
    documents = {name: read_json(SOURCE_DIR / name) for name in SOURCE_FILES}
    works = list(documents["works.json"].get("works") or [])
    works_by_id = {str(work["id"]): work for work in works}
    units = expand_units(list(documents["units.json"].get("series") or []), works_by_id)
    resources = list(documents["watch_resources.json"].get("resources") or [])
    relations = list(documents["relations.json"].get("relations") or [])
    staff = list(documents["staff.json"].get("credits") or [])
    people = list(documents["people.json"].get("people") or [])
    sources = list(documents["source_registry.json"].get("sources") or [])
    validate(works, units, resources, relations, staff, sources)
    person_ids = {person["id"] for person in people}
    if len(person_ids) != len(people):
        raise ValueError("duplicate staff person IDs")
    for credit in staff:
        if credit.get("person_id") and credit["person_id"] not in person_ids:
            raise ValueError(f"unknown staff person {credit['person_id']}")
    staff = [{**credit, "role_raw": credit["role"], "role": role_label(credit["role"]),
              "group_raw": credit.get("group", ""), "group": group_label(credit.get("group", ""))}
             for credit in staff]
    people = [{**person, "name": person_label(person["name"]),
               "aliases": person.get("aliases") or [],
               "roles": list(dict.fromkeys(credit["role"] for credit in staff if credit.get("person_id") == person["id"])),
               "work_count": len({credit["work_id"] for credit in staff if credit.get("person_id") == person["id"]}),
               "unit_count": len({credit["unit_id"] for credit in staff if credit.get("person_id") == person["id"] and credit.get("unit_id")})}
              for person in people if any(credit.get("person_id") == person["id"] for credit in staff)]

    units_by_work: dict[str, list[dict[str, Any]]] = defaultdict(list)
    resources_by_scope: dict[str, list[dict[str, Any]]] = defaultdict(list)
    relations_by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    staff_by_work: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for unit in units:
        units_by_work[unit["work_id"]].append(unit)
    for resource in resources:
        scope = resource["scope"]
        resources_by_scope[f"{scope['type']}:{scope['id']}"] .append(resource)
    for relation in relations:
        relations_by_source[f"{relation['source_type']}:{relation['source_id']}"] .append(relation)
    for credit in staff:
        staff_by_work[credit["work_id"]].append(credit)

    built_works = []
    for work in works:
        work_units = units_by_work[work["id"]]
        released = [unit for unit in work_units if unit["status"] == "released"]
        scheduled = [unit for unit in work_units if unit["status"] == "scheduled"]
        built_works.append({
            **work,
            "unit_count": len(work_units),
            "released_count": len(released),
            "latest_unit": released[-1] if released else None,
            "next_unit": scheduled[0] if scheduled else None,
            "main_character_ids": [
                relation["target_id"] for relation in relations_by_source.get(f"anime_work:{work['id']}", [])
                if relation.get("target_type") == "character"
            ][:4],
        })

    source_payload = {name: documents[name] for name in SOURCE_FILES}
    build_id = "anime-" + compact_hash(source_payload)
    observed_date = max((source.get("observed_at") or "2026-10-03")[:10] for source in sources)
    generated_at = observed_date + "T00:00:00+08:00"
    catalog = {
        "schema_version": 1,
        "build_id": build_id,
        "generated_at": generated_at,
        "coverage": {
            "works": len(built_works),
            "units": len(units),
            "released_units": sum(unit["status"] == "released" for unit in units),
            "scheduled_units": sum(unit["status"] == "scheduled" for unit in units),
            "watch_resources": len(resources),
            "relations": len(relations),
            "staff_credits": len(staff),
            "staff_people": len(people),
        },
        "works": built_works,
        "units": units,
        "watch_resources": resources,
        "relations": relations,
        "staff": staff,
        "people": people,
        "sources": sources,
    }

    target_index: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for relation in relations:
        row = {
            "relation_id": relation["id"],
            "relation_type": relation["relation_type"],
            "label": relation.get("label") or "",
            "usage_type": relation.get("usage_type") or "",
            "signature": relation.get("signature") or "",
            "voice_actor_id": relation.get("voice_actor_id") or "",
            "source_type": relation["source_type"],
            "source_id": relation["source_id"],
            "work_id": relation["source_id"] if relation["source_type"] == "anime_work" else next(
                (unit["work_id"] for unit in units if unit["id"] == relation["source_id"]), ""
            ),
        }
        target_index[str(relation["target_type"])][str(relation["target_id"])].append(row)
        if relation.get("voice_actor_id") and relation.get("target_type") != "voice_actor":
            target_index["voice_actor"][relation["voice_actor_id"]].append(row)
    relation_index = {
        "schema_version": 1,
        "build_id": build_id,
        "generated_at": generated_at,
        "targets": {kind: dict(rows) for kind, rows in target_index.items()},
    }
    return catalog, relation_index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate committed generated files without writing")
    args = parser.parse_args()
    catalog, relation_index = build()
    outputs = ((CATALOG_FILE, catalog), (RELATION_INDEX_FILE, relation_index))
    if args.check:
        stale = [str(path.relative_to(ROOT)) for path, value in outputs if not path.exists() or read_json(path) != value]
        if stale:
            print("anime generated files are stale: " + ", ".join(stale))
            return 1
        print(f"anime data valid: {catalog['coverage']['works']} works, {catalog['coverage']['units']} units")
        return 0
    for path, value in outputs:
        atomic_json(path, value)
    print(f"anime catalog built: {catalog['coverage']['works']} works, {catalog['coverage']['units']} units")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
