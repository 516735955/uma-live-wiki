"""Utaten responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from knowledge_io import bounded_read
from . import credits as pipeline_credits
from . import recordings as pipeline_recordings


class UtaTenLyricParser(pipeline_common.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.lyric_depth = 0
        self.ruby_text_depth = 0
        self.current = ""
        self.lines: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        classes = set(attr.get("class", "").split())
        if tag == "div" and "hiragana" in classes and not self.lyric_depth:
            self.lyric_depth = 1
            return
        if self.lyric_depth:
            if tag == "div":
                self.lyric_depth += 1
            if tag == "span" and "rt" in classes:
                self.ruby_text_depth += 1
            if tag == "br":
                self.flush_line()

    def handle_endtag(self, tag: str) -> None:
        if not self.lyric_depth:
            return
        if tag == "span" and self.ruby_text_depth:
            self.ruby_text_depth -= 1
        if tag == "div":
            self.lyric_depth -= 1
            if not self.lyric_depth:
                self.flush_line()

    def handle_data(self, data: str) -> None:
        if self.lyric_depth and not self.ruby_text_depth:
            self.current += data

    def flush_line(self) -> None:
        value = pipeline_common.re.sub(r"[\t\r ]+", " ", self.current).strip()
        if value:
            self.lines.append(value)
        self.current = ""


def utaten_search_result(page: str, title: str) -> str:
    return next(iter(utaten_search_results(page, title)), '')


def utaten_search_results(page: str, title: str) -> list[str]:
    target = pipeline_recordings.folded_title(title)
    candidates: list[tuple[int, str]] = []
    for match in pipeline_common.re.finditer(r'<a\s+href="(/lyric/[^"/?#]+/)"[^>]*>([\s\S]*?)</a>', page, pipeline_common.re.I):
        label = pipeline_common.re.sub(r"<[^>]+>", "", match.group(2))
        folded = pipeline_recordings.folded_title(label)
        score = 100 if folded == target else 0
        if not score and target and (folded.startswith(target) or target.startswith(folded)):
            difference = abs(len(folded) - len(target))
            score = 75 - min(50, difference)
        if score >= 75:
            candidates.append((score, match.group(1)))
    candidates.sort(key=lambda row: (-row[0], len(row[1]), row[1]))
    return list(dict.fromkeys(row[1] for row in candidates))[:8]


def json_ld_composition(page: str) -> dict[str, pipeline_common.Any]:
    for raw in pipeline_common.re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>', page, pipeline_common.re.I):
        try:
            value = pipeline_common.json.loads(raw.strip())
        except pipeline_common.json.JSONDecodeError:
            continue
        pending = [value]
        while pending:
            item = pending.pop(0)
            if isinstance(item, list):
                pending.extend(item)
            elif isinstance(item, dict):
                kinds = item.get('@type', [])
                if 'MusicComposition' in ([kinds] if isinstance(kinds, str) else kinds):
                    return item
                pending.extend(value for value in item.values() if isinstance(value, (dict, list)))
    return {}


def utaten_artist_names(composition: dict[str, pipeline_common.Any]) -> list[str]:
    recorded = composition.get("recordedAs") or {}
    recordings = recorded if isinstance(recorded, list) else [recorded]
    return [
        name
        for item in recordings
        if isinstance(item, dict)
        for name in pipeline_credits.credit_names(item.get("byArtist"))
        if name
    ]


def artist_match(recording: dict[str, pipeline_common.Any], composition: dict[str, pipeline_common.Any]) -> bool:
    source = {pipeline_recordings.normalized_name(name) for name in utaten_artist_names(composition)}
    if not source:
        return False
    for name in recording.get("artists") or []:
        key = pipeline_recordings.normalized_name(name)
        if key and key in source:
            return True
    return False


def fetch_utaten(recording: dict[str, pipeline_common.Any]) -> tuple[str, dict[str, pipeline_common.Any] | None, str]:
    version_id = recording["version_id"]
    try:
        search_url = pipeline_common.UTATEN_SEARCH_URL.format(title=pipeline_common.urllib.parse.quote(recording["version_title"]))
        request = pipeline_common.urllib.request.Request(search_url, headers={"User-Agent": pipeline_common.UA})
        try:
            with pipeline_common.urllib.request.urlopen(request, timeout=25) as response:
                search_page = bounded_read(response, limit=8 * 1024 * 1024).decode("utf-8", errors="replace")
        except pipeline_common.urllib.error.HTTPError as error:
            if error.code != 400:
                raise
            # Search operators in composite soundtrack titles may be rejected;
            # the result matcher still checks the complete original title.
            query = pipeline_common.re.sub(r'[^\w\s\u3040-\u30ff\u3400-\u9fff]', ' ', recording['version_title'])
            request = pipeline_common.urllib.request.Request(pipeline_common.UTATEN_SEARCH_URL.format(title=pipeline_common.urllib.parse.quote(query.strip())), headers={'User-Agent': pipeline_common.UA})
            with pipeline_common.urllib.request.urlopen(request, timeout=25) as response:
                search_page = bounded_read(response, limit=8 * 1024 * 1024).decode('utf-8', errors='replace')
        matches = []
        for result_path in utaten_search_results(search_page, recording["version_title"]):
            source_url = pipeline_common.urllib.parse.urljoin("https://utaten.com", result_path)
            request = pipeline_common.urllib.request.Request(source_url, headers={"User-Agent": pipeline_common.UA})
            with pipeline_common.urllib.request.urlopen(request, timeout=25) as response:
                page = bounded_read(response, limit=8 * 1024 * 1024).decode("utf-8", errors="replace")
            composition = json_ld_composition(page)
            if artist_match(recording, composition):
                matches.append((source_url, page, composition))
        if len(matches) != 1:
            return version_id, None, ""
        source_url, page, composition = matches[0]
        parser = UtaTenLyricParser()
        parser.feed(page)
        credits: list[dict[str, str]] = []
        for role, key in (("lyricist", "lyricist"), ("composer", "composer")):
            for raw_name in pipeline_credits.credit_names(composition.get(key)):
                name, affiliations = pipeline_credits.creator_identity(raw_name)
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
        arranger_match = pipeline_common.re.search(r'<dt[^>]*>\s*編曲\s*</dt>\s*<dd[^>]*>([\s\S]*?)</dd>', page, pipeline_common.re.I)
        if arranger_match:
            arranger_text = pipeline_common.re.sub(r"<[^>]+>", "", arranger_match.group(1))
            for raw_name in pipeline_credits.split_creators(pipeline_common.html.unescape(arranger_text)):
                name, affiliations = pipeline_credits.creator_identity(raw_name)
                credit = {"role": "arranger", "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
        return version_id, {"source_url": source_url, "lines": parser.lines, "credits": credits}, ""
    except (OSError, ValueError, pipeline_common.urllib.error.URLError) as error:
        return version_id, None, str(error)


def verify_utaten_source(recording: dict[str, pipeline_common.Any], source_url: str) -> tuple[str, bool, str]:
    version_id = recording["version_id"]
    try:
        request = pipeline_common.urllib.request.Request(source_url, headers={"User-Agent": pipeline_common.UA})
        with pipeline_common.urllib.request.urlopen(request, timeout=25) as response:
            page = bounded_read(response, limit=8 * 1024 * 1024).decode("utf-8", errors="replace")
        return version_id, artist_match(recording, json_ld_composition(page)), ""
    except (OSError, ValueError, pipeline_common.urllib.error.URLError) as error:
        return version_id, False, str(error)
