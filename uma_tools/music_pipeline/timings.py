"""Timings responsibilities for the canonical catalog pipeline."""
from __future__ import annotations
import math

from . import common as pipeline_common
from knowledge_io import bounded_read
from . import lyrics as pipeline_lyrics
from . import recordings as pipeline_recordings


def fetch_lrclib_timing(
    recording: dict[str, pipeline_common.Any], lyric_lines: list[str]
) -> tuple[str, dict[str, pipeline_common.Any] | None, str]:
    """Accept a unique recording with exact lyrics, release and performer evidence."""
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
            payload = pipeline_common.json.loads(bounded_read(response, limit=8 * 1024 * 1024).decode("utf-8", errors="replace"))
        candidates = {}
        for item in payload if isinstance(payload, list) else []:
            if not isinstance(item, dict):
                continue
            if pipeline_recordings.folded_title(str(item.get("trackName") or "")) != pipeline_recordings.folded_title(recording["version_title"]):
                continue
            timed, _ = pipeline_lyrics.parse_lyric(str(item.get("syncedLyrics") or ""))
            if not timed or pipeline_lyrics.folded_lyric([line["text"] for line in timed]) != expected:
                continue
            album = str(item.get("albumName") or "")
            releases = [release for release in recording.get('releases') or []
                        if pipeline_recordings.folded_title(str(release.get('album_name') or ''))
                        and pipeline_recordings.folded_title(str(release.get('album_name') or '')) == pipeline_recordings.folded_title(album)]
            incoming_artists = {pipeline_recordings.normalized_name(artist) for artist in pipeline_common.re.split(
                r'[、,，／/&＋+]', str(item.get('artistName') or '')) if artist.strip()}
            releases = [release for release in releases if
                        {pipeline_recordings.normalized_name(artist) for artist in release.get('artists', recording.get('artists') or []) if artist} == incoming_artists and incoming_artists]
            if not releases:
                continue
            durations = [float(release['duration']) for release in releases if release.get('duration')]
            if recording.get('duration'):
                durations.append(float(recording['duration']))
            duration = float(item.get('duration') or 0)
            if durations and (not math.isfinite(duration) or duration <= 0 or any(
                    not math.isfinite(accepted) or accepted <= 0 or abs(duration - accepted) > 2 for accepted in durations)):
                continue
            source_id = int(item.get('id') or 0)
            if source_id > 0:
                candidates[source_id] = timed
        if len(candidates) != 1:
            return version_id, None, ""
        source_id, lines = next(iter(candidates.items()))
        return version_id, {"source_id": source_id, "lines": lines}, ""
    except (pipeline_common.urllib.error.URLError, TimeoutError, ValueError, TypeError) as error:
        return version_id, None, str(error)


def apply_lrclib_results(results: dict[str, dict[str, pipeline_common.Any] | None], timings: dict[str, pipeline_common.Any], refresh: set[str] | None = None) -> None:
    timing_versions = timings.setdefault("versions", {})
    for version_id, result in results.items():
        current = timing_versions.get(version_id) or {}
        if not result or (current and (version_id not in (refresh or set()) or current.get('manual') or current.get('source') == 'manual')):
            continue
        timing_versions[version_id] = {
            "lines": result["lines"],
            "source": "lrclib_verified_timing",
            "source_id": result["source_id"],
        }
