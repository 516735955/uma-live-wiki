"""Print evidence candidates from the existing news archive for editorial review."""

import argparse
import datetime as dt
import json
from pathlib import Path
import sqlite3
import unicodedata
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

from news_database import plain_text


ROOT = Path(__file__).resolve().parent.parent


def fold(value):
    return unicodedata.normalize("NFKC", value or "").casefold()


def catalog_names(catalog):
    raw = (ROOT / "data/character_index_data.js").read_text(encoding="utf-8")
    characters = json.JSONDecoder().raw_decode(raw.split("=", 1)[1].lstrip())[0]
    profiles = json.loads((ROOT / "data/voice_actor_profiles.json").read_text(encoding="utf-8"))
    for kind, rows in (("character", characters), ("voice", profiles["voice_actors"])):
        for row in rows:
            name = (row.get("identity") or row).get("ja")
            if name:
                yield kind, row["id"], name
    for row in [*catalog["event_groups"], *catalog["events"]]:
        name = row.get("title_ja")
        if name and len(name) >= 8:
            yield "event", row["id"], name


def candidates(article, names):
    title = fold(article.get("title"))
    body = plain_text(article.get("message", ""))
    lines = [(line, fold(line)) for line in body.splitlines()]
    for kind, key, name in names:
        match = fold(name)
        if match in title:
            yield [kind, key, name, "标题"]
            continue
        for line, normalized in lines:
            start = normalized.find(match)
            if start >= 0:
                yield [kind, key, name, line[max(0, start - 35):start + len(name) + 40]]
                break


def event_sources(catalog):
    by_url = {}
    for row in catalog["events"]:
        for source in row.get("sources", []):
            if source.get("kind") not in {"official_announcement", "official_youtube", "eventernote"}:
                continue
            url = source.get("url", "")
            if url:
                by_url.setdefault(url.rstrip("/"), set()).add(row["id"])
    return by_url


def event_candidates(key, article, by_url):
    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.urls = set()

        def handle_starttag(self, tag, attrs):
            if tag == "a":
                href = dict(attrs).get("href") or ""
                if href.startswith("https://"):
                    self.urls.add(href.rstrip("/"))

    links = Links()
    links.feed(article.get("message") or "")
    own_url = article.get("url") or ""
    if key.startswith("official-"):
        own_url = "https://umamusume.jp/news/detail?id=" + key.removeprefix("official-")
    if own_url:
        links.urls.add(own_url.rstrip("/"))
    for url in sorted(links.urls):
        parsed = urlsplit(url)
        if parsed.hostname == "umamusume.jp" and parsed.path == "/news/detail":
            ids = parse_qs(parsed.query).get("id", [])
            url = "https://umamusume.jp/news/detail?id=" + ids[0] if ids else url
        for event in sorted(by_url.get(url, ())):
            yield ["event", event, event, url]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--since", default=(dt.date.today() - dt.timedelta(days=90)).isoformat())
    parser.add_argument("--include", action="append", default=[])
    args = parser.parse_args()
    catalog = json.loads((ROOT / "data/events_catalog.json").read_text(encoding="utf-8"))
    names = tuple(catalog_names(catalog))
    by_url = event_sources(catalog)
    with sqlite3.connect(args.archive.resolve().as_uri() + "?mode=ro", uri=True) as db:
        rows = db.execute("""
            SELECT a.key, v.original FROM articles a
            JOIN versions v ON v.article_key = a.key AND v.revision = a.revision
            WHERE substr(json_extract(v.original,'$.detail.post_at'),1,10) >= ?
               OR a.key IN (SELECT value FROM json_each(?))
            ORDER BY a.key
        """, (args.since, json.dumps(args.include)))
        for key, original in rows:
            detail = json.loads(original)["detail"]
            print(json.dumps({"key": key, "title": detail.get("title"),
                              "candidates": [*candidates(detail, names), *event_candidates(key, detail, by_url)]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
