"""Documents responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import credits as pipeline_credits
from . import lyrics as pipeline_lyrics
from . import recordings as pipeline_recordings


def build_documents(
    recordings: dict[str, dict[str, pipeline_common.Any]],
    fetched: dict[str, dict[str, pipeline_common.Any] | None],
    refresh: set[str],
    documents: tuple[dict[str, pipeline_common.Any], dict[str, pipeline_common.Any], dict[str, pipeline_common.Any], dict[str, pipeline_common.Any]] | None = None,
) -> tuple[dict[str, pipeline_common.Any], ...]:
    creators, credits, lyrics, timings = documents or (
        pipeline_common.read_json(pipeline_common.CREATORS_FILE, {"schema_version": 1, "creators": []}),
        pipeline_common.read_json(pipeline_common.CREDITS_FILE, {"schema_version": 1, "versions": {}}),
        pipeline_common.read_json(pipeline_common.LYRICS_FILE, {"schema_version": 1, "versions": {}}),
        pipeline_common.read_json(pipeline_common.TIMINGS_FILE, {"schema_version": 1, "versions": {}}),
    )
    credit_versions = credits.setdefault("versions", {})
    lyric_versions = lyrics.setdefault("versions", {})
    timing_versions = timings.setdefault("versions", {})
    for version_id, recording in recordings.items():
        source_track, lines, credit_rows = pipeline_recordings.choose_candidate(recording, fetched)
        inferred = pipeline_credits.inferred_remix_credit(recording.get("version_title") or "")
        if inferred and not any(row.get("role") == "remixer" for row in credit_rows):
            credit_rows.append(inferred)
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
                "language": pipeline_lyrics.language_of(lines),
                "lines": [line["text"] for line in lines],
                "source": "netease_recording_metadata",
                "source_track_id": source_track,
            }
            timing_versions[version_id] = {
                "lines": lines,
                "source": "netease_recording_metadata",
                "source_track_id": source_track,
            }
    pipeline_credits.normalize_automatic_credit_rows(credits)
    creators["creators"] = pipeline_credits.creator_rows(credits, creators)
    return creators, credits, lyrics, timings


def apply_utaten_results(
    recordings: dict[str, dict[str, pipeline_common.Any]],
    results: dict[str, dict[str, pipeline_common.Any] | None],
    creators: dict[str, pipeline_common.Any],
    credits: dict[str, pipeline_common.Any],
    lyrics: dict[str, pipeline_common.Any],
    timings: dict[str, pipeline_common.Any],
    refresh: set[str] | None = None,
) -> tuple[dict[str, pipeline_common.Any], ...]:
    credit_versions = credits.setdefault("versions", {})
    lyric_versions = lyrics.setdefault("versions", {})
    refresh = refresh or set()
    for version_id, result in results.items():
        if not result:
            continue
        recording = recordings[version_id]
        if result.get("credits") and not (credit_versions.get(version_id) or {}).get("manual"):
            current = credit_versions.get(version_id) or {}
            credit_key = lambda row: (row.get("role"), row.get("creator_id") or row.get("name") or row.get("creator"))
            current_keys = {credit_key(row) for row in current.get("credits") or []}
            additions = [row for row in result["credits"] if credit_key(row) not in current_keys]
            if additions or not current:
                credit_versions[version_id] = {
                    **current,
                    "credits": list(current.get("credits") or []) + additions,
                    "source": current.get("source") or "utaten",
                    "source_url": current.get("source_url") or result["source_url"],
                }
        if result.get("lines") and (version_id not in lyric_versions or version_id in refresh) and not recording["instrumental"]:
            lyric_versions[version_id] = {
                "language": pipeline_lyrics.language_of([{"text": line} for line in result["lines"]]),
                "lines": list(result["lines"]),
                "source": "utaten",
                "source_url": result["source_url"],
            }
    pipeline_credits.normalize_automatic_credit_rows(credits)
    creators["creators"] = pipeline_credits.creator_rows(credits, creators)
    return creators, credits, lyrics, timings
