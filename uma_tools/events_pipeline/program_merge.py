"""Program merge responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from .program_text import program_identity


def value_is_present(value: pipeline_common.Any) -> bool:
    return value not in (None, "", [], {})


def _announcement_title(value: str) -> bool:
    return bool(pipeline_common.re.search(
        r"放送|配信|公開|決定|お届け|発表|日時|時から|生放送|予告",
        value or "",
        pipeline_common.re.I,
    ))


def _field_is_manual(row: dict[str, pipeline_common.Any], field: str) -> bool:
    protected = set(row.get("manual_fields") or [])
    return bool(
        field in protected
        or row.get("metadata_status") in {"manual", "reviewed", "curated"}
        or row.get("title_source") == "manual" and field in {"title", "source_title"}
    )


def merge_program_list(field: str, existing: list[pipeline_common.Any], discovered: list[pipeline_common.Any]) -> list[pipeline_common.Any]:
    """Union additive evidence without rewriting an existing record."""
    if field == "sources":
        key = lambda item: (item.get("kind"), item.get("url")) if isinstance(item, dict) else pipeline_common.json.dumps(item, ensure_ascii=False, sort_keys=True)
    elif field == "media":
        key = lambda item: (item.get("video_id") or item.get("url")) if isinstance(item, dict) else pipeline_common.json.dumps(item, ensure_ascii=False, sort_keys=True)
    else:
        key = lambda item: pipeline_common.json.dumps(item, ensure_ascii=False, sort_keys=True)
    merged: list[pipeline_common.Any] = []
    seen: set[pipeline_common.Any] = set()
    for item in [*existing, *discovered]:
        item_key = key(item)
        if not item_key or item_key in seen:
            continue
        seen.add(item_key)
        merged.append(item)
    return merged


def apply_additive_program_refresh(
    existing_doc: dict[str, pipeline_common.Any],
    discovered_doc: dict[str, pipeline_common.Any],
) -> tuple[dict[str, pipeline_common.Any], dict[str, pipeline_common.Any]]:
    """Preserve reviewed fields while reconciling changes from official evidence."""
    existing_by_id = {
        str(row.get("id") or ""): row
        for row in existing_doc.get("programs") or []
        if row.get("id")
    }
    existing_by_video = {
        str(video_id): str(row.get("id"))
        for row in existing_by_id.values()
        for video_id in [row.get("video_id"), *(item.get("video_id") for item in row.get("media") or [])]
        if video_id
    }
    discovered_by_id = {}
    for original in discovered_doc.get("programs") or []:
        if not original.get("id"):
            continue
        row = dict(original)
        video_ids = [row.get('video_id'), *(item.get('video_id') for item in row.get('media') or [])]
        canonical_ids = {existing_by_video[str(value)] for value in video_ids if value and str(value) in existing_by_video}
        canonical_id = next(iter(canonical_ids)) if len(canonical_ids) == 1 else None
        if canonical_id and canonical_id != str(row["id"]):
            row["id_aliases"] = list(dict.fromkeys([*row.get("id_aliases", []), str(row["id"])]))
            row["id"] = canonical_id
        previous = discovered_by_id.get(str(row['id']))
        if previous:
            for field in ('sources', 'media', 'id_aliases'):
                row[field] = merge_program_list(field, previous.get(field) or [], row.get(field) or [])
        discovered_by_id[str(row["id"])] = row
    added_ids: list[str] = []
    retained_missing_ids: list[str] = []
    filled: list[dict[str, pipeline_common.Any]] = []
    conflicts: list[dict[str, pipeline_common.Any]] = []
    programs: list[dict[str, pipeline_common.Any]] = []

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
        if discovered.get("id_aliases"):
            merged["id_aliases"] = list(dict.fromkeys([*existing.get("id_aliases", []), *discovered["id_aliases"]]))
        filled_fields: list[str] = []
        source_upgrade = pipeline_common.PROGRAM_SOURCE_PRIORITY.get(str(discovered.get("source_kind") or ""), 0) > pipeline_common.PROGRAM_SOURCE_PRIORITY.get(
            str(existing.get("source_kind") or ""), 0
        )
        same_evidence = bool(
            ({str(existing.get('video_id') or '')} - {''}) & ({str(discovered.get('video_id') or '')} - {''})
            or (existing.get('source_url') and existing.get('source_url') == discovered.get('source_url'))
        )
        reliable_update = (
            str(discovered.get('source_kind') or '').startswith('official_')
            and (same_evidence or source_upgrade)
            and pipeline_common.PROGRAM_SOURCE_PRIORITY.get(str(discovered.get('source_kind') or ''), 0)
            >= pipeline_common.PROGRAM_SOURCE_PRIORITY.get(str(existing.get('source_kind') or ''), 0)
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
                if pipeline_common.comparable(combined) != pipeline_common.comparable(existing_value or []):
                    merged[field] = combined
                    filled_fields.append(field)
                continue
            if field == "cast":
                # Official refreshes may add newly announced participants, but
                # never remove curated or Google Sheet evidence.
                can_add_official_cast = reliable_update and not _field_is_manual(existing, field)
                combined = merge_program_list("cast", list(existing_value or []), list(discovered_value or [])) if can_add_official_cast else list(existing_value or [])
                if pipeline_common.comparable(combined) != pipeline_common.comparable(existing_value or []):
                    merged[field] = combined
                    filled_fields.append(field)
                    continue
            if field in ("source_kind", "source_url") and source_upgrade and value_is_present(discovered_value):
                if pipeline_common.comparable(existing_value) != pipeline_common.comparable(discovered_value):
                    merged[field] = discovered_value
                    filled_fields.append(field)
                continue
            # A canonical official title may safely replace a stale press
            # release sentence when the human record is not marked curated.
            # Other non-empty fields remain protected unless explicitly
            # reviewed; evidence is still retained through source_title and
            # sources/media unioning.
            if (
                field == "title"
                and value_is_present(discovered_value)
                and value_is_present(existing_value)
                and (_announcement_title(str(existing_value)) or (
                    program_identity(str(existing_value))[0]
                    and program_identity(str(existing_value))[0] == program_identity(str(discovered_value))[0]
                ))
                and not _field_is_manual(existing, field)
                and str(discovered_value) != str(existing_value)
                and reliable_update
            ):
                merged[field] = discovered_value
                filled_fields.append(field)
                continue
            if (
                field in {"date", "end_date", "thumbnail", "duration", "summary"}
                and value_is_present(discovered_value)
                and value_is_present(existing_value)
                and reliable_update
                and not _field_is_manual(existing, field)
                and pipeline_common.comparable(existing_value) != pipeline_common.comparable(discovered_value)
            ):
                merged[field] = discovered_value
                filled_fields.append(field)
                if field == "summary":
                    merged["summary_translation_status"] = "stale"
                continue
            if not value_is_present(existing_value) and value_is_present(discovered_value):
                merged[field] = discovered_value
                filled_fields.append(field)
            elif (
                value_is_present(existing_value)
                and value_is_present(discovered_value)
                and pipeline_common.comparable(existing_value) != pipeline_common.comparable(discovered_value)
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
        "generated_at": pipeline_common.dt.datetime.now(pipeline_common.dt.timezone.utc).replace(microsecond=0).isoformat(),
        "policy": "preserve reviewed fields; reconcile matching official evidence; retain conflicting lower-priority values",
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
