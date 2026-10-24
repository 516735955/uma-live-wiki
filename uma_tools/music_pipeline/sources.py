"""Sources responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from knowledge_io import bounded_read


def fetch_track(track: str, tries: int = 3) -> tuple[str, dict[str, pipeline_common.Any] | None, str]:
    url = pipeline_common.LYRIC_URL.format(track_id=pipeline_common.urllib.parse.quote(track))
    last_error = ""
    for attempt in range(tries):
        try:
            request = pipeline_common.urllib.request.Request(url, headers={"User-Agent": pipeline_common.UA, "Referer": "https://music.163.com/"})
            with pipeline_common.urllib.request.urlopen(request, timeout=20) as response:
                payload = pipeline_common.json.loads(bounded_read(response, limit=8 * 1024 * 1024).decode("utf-8", errors="replace"))
            if not isinstance(payload, dict) or payload.get('code', 200) != 200:
                raise ValueError('NetEase business response: ' + str(payload.get('code') if isinstance(payload, dict) else 'invalid payload'))
            return track, payload, ""
        except (OSError, pipeline_common.urllib.error.URLError, ValueError) as error:
            last_error = str(error)
            if attempt + 1 < tries:
                pipeline_common.time.sleep(0.4 * (attempt + 1))
    return track, None, last_error


def fetch_text(url: str) -> str:
    request = pipeline_common.urllib.request.Request(url, headers={"User-Agent": pipeline_common.UA})
    with pipeline_common.urllib.request.urlopen(request, timeout=30) as response:
        return bounded_read(response, limit=8 * 1024 * 1024).decode("utf-8", errors="replace")


def wiki_api(params: dict[str, pipeline_common.Any]) -> dict[str, pipeline_common.Any]:
    url = pipeline_common.UMAMUSU_WIKI_API + "?" + pipeline_common.urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    return pipeline_common.json.loads(fetch_text(url))


def wiki_song_pages() -> list[dict[str, pipeline_common.Any]]:
    rows: list[dict[str, pipeline_common.Any]] = []
    continuation = ""
    while True:
        params: dict[str, pipeline_common.Any] = {
            "action": "query", "list": "categorymembers", "cmtitle": pipeline_common.UMAMUSU_WIKI_CATEGORY,
            "cmlimit": "max", "cmnamespace": 0,
        }
        if continuation:
            params["cmcontinue"] = continuation
        payload = wiki_api(params)
        rows.extend(payload.get("query", {}).get("categorymembers", []))
        continuation = str(payload.get("continue", {}).get("cmcontinue") or "")
        if not continuation:
            return rows


def wiki_page_wikitext(page_ids: list[int]) -> tuple[list[dict[str, pipeline_common.Any]], list[str]]:
    pages: list[dict[str, pipeline_common.Any]] = []
    errors: list[str] = []
    for offset in range(0, len(page_ids), 25):
        batch = page_ids[offset:offset + 25]
        try:
            payload = wiki_api({
                "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                "pageids": "|".join(str(page_id) for page_id in batch),
            })
        except (pipeline_common.urllib.error.URLError, TimeoutError, pipeline_common.json.JSONDecodeError) as error:
            errors.extend(f"{page_id}: {error}" for page_id in batch)
            continue
        for page in payload.get("query", {}).get("pages", []):
            revision = ((page.get("revisions") or [{}])[0].get("slots") or {}).get("main") or {}
            pages.append({
                "pageid": int(page.get("pageid") or 0),
                "title": str(page.get("title") or ""),
                "wikitext": str(revision.get("content") or ""),
            })
    return pages, errors
