"""Timings responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import lyrics as pipeline_lyrics
from . import recordings as pipeline_recordings


def fetch_lrclib_timing(
    recording: dict[str, pipeline_common.Any], lyric_lines: list[str]
) -> tuple[str, dict[str, pipeline_common.Any] | None, str]:
    """Return timing only when LRCLIB text exactly matches the accepted lyric.

    LRCLIB is an open source, user-maintained timing source.  It never decides
    which lyric belongs to a version here: the already accepted plain lyric is
    the identity check, so similarly named recordings cannot overwrite it.
    """
    version_id = recording["version_id"]
    expected = pipeline_lyrics.folded_lyric(lyric_lines)
    if not expected:
        return version_id, None, ""
    try:
        request = pipeline_common.urllib.request.Request(
            pipeline_common.LRCLIB_SEARCH_URL.format(title=pipeline_common.urllib.parse.quote(recording["version_title"])),
            headers={"User-Agent": pipeline_common.UA},
        )
        with pipeline_common.urllib.request.urlopen(request, timeout=25) as response:
            payload = pipeline_common.json.loads(response.read().decode("utf-8", errors="replace"))
        candidates: list[tuple[int, int, list[dict[str, pipeline_common.Any]]]] = []
        for item in payload if isinstance(payload, list) else []:
            if pipeline_recordings.folded_title(str(item.get("trackName") or "")) != pipeline_recordings.folded_title(recording["version_title"]):
                continue
            timed, _ = pipeline_lyrics.parse_lyric(str(item.get("syncedLyrics") or ""))
            if not timed or pipeline_lyrics.folded_lyric([line["text"] for line in timed]) != expected:
                continue
            album = str(item.get("albumName") or "")
            album_score = max(
                [
                    1
                    for release in recording.get("releases") or []
                    if pipeline_recordings.folded_title(str(release.get("album_name") or ""))
                    and pipeline_recordings.folded_title(str(release.get("album_name") or "")) in pipeline_recordings.folded_title(album)
                ]
                or [0]
            )
            candidates.append((album_score, int(item.get("id") or 0), timed))
        if not candidates:
            return version_id, None, ""
        candidates.sort(key=lambda row: (-row[0], row[1]))
        return version_id, {"source_id": candidates[0][1], "lines": candidates[0][2]}, ""
    except (pipeline_common.urllib.error.URLError, TimeoutError, pipeline_common.json.JSONDecodeError) as error:
        return version_id, None, str(error)


def apply_lrclib_results(results: dict[str, dict[str, pipeline_common.Any] | None], timings: dict[str, pipeline_common.Any]) -> None:
    timing_versions = timings.setdefault("versions", {})
    for version_id, result in results.items():
        if not result or version_id in timing_versions:
            continue
        timing_versions[version_id] = {
            "lines": result["lines"],
            "source": "lrclib_verified_timing",
            "source_id": result["source_id"],
        }
