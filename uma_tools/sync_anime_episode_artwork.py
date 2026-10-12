"""Resolve episode artwork from existing official stills, videos and attributed wiki pages."""

import argparse
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, unquote, urlencode, urlsplit

from bs4 import BeautifulSoup
from build_anime_catalog import atomic_json
from sync_anime_assets import ROOT, fetch, write_cover
from pathlib import Path

DATA = Path(ROOT) / "data/anime"


def wiki_page(title):
    url = "https://umamusu.wiki/w/api.php?" + urlencode({
        "action": "parse", "page": title, "prop": "text", "format": "json"})
    result = json.loads(fetch(url))
    return BeautifulSoup(result["parse"]["text"]["*"], "html.parser")


def season_pages(title):
    soup = wiki_page(title)
    rows = []
    for table in soup.select("table.wikitable"):
        if "Episode" not in table.get_text()[:100]:
            continue
        for row in table.select("tr"):
            cells = row.find_all("td", recursive=False)
            if len(cells) < 2:
                continue
            number = cells[0].get_text(strip=True)
            if not number.isdigit() and not number.startswith("OVA"):
                continue
            link = cells[1].find("a", href=True)
            if link:
                rows.append(unquote(link["href"].lstrip("/")).replace("_", " "))
    return rows


def wiki_image(title):
    soup = wiki_page(title)
    image = soup.select_one(".gallerybox img") or soup.select_one(".infobox-image img")
    if image is None:
        raise ValueError("no episode image on " + title)
    link = image.find_parent("a")
    filename = unquote(link["href"].split("File:", 1)[1])
    api = "https://umamusu.wiki/w/api.php?" + urlencode({
        "action": "query", "titles": "File:" + filename, "prop": "imageinfo",
        "iiprop": "url|size", "format": "json"})
    result = json.loads(fetch(api))
    info = next(iter(result["query"]["pages"].values()))["imageinfo"][0]
    if info["width"] < 300 or info["height"] < 160:
        raise ValueError("episode image too small on " + title)
    return info["url"], "https://umamusu.wiki/" + title.replace(" ", "_"), info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    video_opener = urllib.request.build_opener()

    def fetch_video(url):
        error = None
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with video_opener.open(request, timeout=15) as response:
                    return response.read()
            except Exception as caught:
                error = caught
        raise error
    units = json.loads((DATA / "units.json").read_text(encoding="utf-8"))
    catalog = json.loads((Path(ROOT) / "data/anime_catalog.json").read_text(encoding="utf-8"))
    sources = json.loads((DATA / "source_registry.json").read_text(encoding="utf-8"))
    assets = json.loads((DATA / "asset_sources.json").read_text(encoding="utf-8"))
    works = json.loads((DATA / "works.json").read_text(encoding="utf-8"))
    source_by_id = {row["id"]: row for row in sources["sources"]}
    details = {series["work_id"]: series["details"] for series in units["series"]}
    pages = {}
    for work_id, title, count in [("anime-s1", "Season 1", 16), ("anime-s2", "Season 2", 13)]:
        if any(not detail.get("cover") for detail in details[work_id].values()):
            pages[work_id] = season_pages(title)
            if len(pages[work_id]) != count:
                raise ValueError("episode table does not match the catalog: " + work_id)

    def resolve(unit):
        if details[unit["work_id"]][str(unit["number"])].get("cover"):
            return None
        original = None
        source_ref = None
        source = None
        if unit.get("stills"):
            still = unit["stills"][0]
            original, source_ref = still["original"], still.get("source_ref")
            if still["url"].startswith("/uma_tools/"):
                return unit, {"cover": still["url"], "cover_original": original,
                              "cover_source_ref": source_ref}, None, None
        elif unit["work_id"] in pages or unit["work_id"] == "anime-umayon":
            if unit["work_id"] in pages:
                page = pages[unit["work_id"]][unit["number"] - 1]
            else:
                evidence = next(source_by_id[ref] for ref in unit["source_refs"]
                                if ref in source_by_id and "umamusu.wiki/" in source_by_id[ref].get("url", ""))
                page = unquote(urlsplit(evidence["url"]).path.lstrip("/")).replace("_", " ")
            original, url, _ = wiki_image(page)
            source_ref = "episode-artwork-" + unit["id"]
            source = {"id": source_ref, "kind": "reference", "label": unit["label"] + "·单集画面",
                      "url": url, "observed_at": "2026-10-13"}
        elif unit["work_id"] in {"anime-umayuru", "anime-1st-anniversary"}:
            resource = next(row for row in catalog["watch_resources"]
                            if row["platform"] == "youtube" and row["scope"]["id"] in {unit["id"], unit["work_id"]})
            video = parse_qs(urlsplit(resource["url"]).query)["v"][0]
            original = "https://i.ytimg.com/vi/" + video + "/maxresdefault.jpg"
            source_ref = resource.get("source_ref") or (resource.get("source_refs") or [None])[0]
        else:
            raise ValueError("no attributable image for " + unit["id"])
        output = "uma_tools/img/anime/episodes/" + unit["id"] + ".webp"
        asset = {"unit_id": unit["id"], "source_url": original, "output": output,
                 "mode": "episode", "source_ref": source_ref}
        if args.write:
            reader = fetch_video if urlsplit(original).hostname in {'i.ytimg.com', 'prcdn.freetls.fastly.net'} else fetch
            try:
                write_cover(asset, fetch_image=reader)
            except Exception:
                if not original.endswith('/maxresdefault.jpg'):
                    raise
                original = original.replace('/maxresdefault.jpg', '/hqdefault.jpg')
                asset['source_url'] = original
                write_cover(asset, fetch_image=reader)
        fields = {"cover": "/" + output, "cover_original": original, "cover_source_ref": source_ref}
        return unit, fields, asset, source

    failures = []

    def resolve_available(unit):
        try:
            return resolve(unit)
        except Exception as error:
            failures.append(unit["id"])
            print("Artwork unavailable: %s (%s)" % (unit["id"], type(error).__name__), flush=True)
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        resolved = list(pool.map(resolve_available, catalog["units"]))
    for result in filter(None, resolved):
        unit, fields, asset, source = result
        details[unit["work_id"]][str(unit["number"])].update(fields)
        if asset:
            existing = next((row for row in assets["assets"] if row["output"] == asset["output"]), None)
            if existing:
                existing.update(asset)
            else:
                assets["assets"].append(asset)
        if source and source["id"] not in source_by_id:
            sources["sources"].append(source)
            source_by_id[source["id"]] = source
    remote_stills = []
    for work in works["works"]:
        remote_stills.extend((work["id"], index, still) for index, still in enumerate(work.get("film_stills", []), 1)
                             if not still["url"].startswith("/uma_tools/"))
    for series in units["series"]:
        for number, detail in series["details"].items():
            owner = series["work_id"] + "-e%02d" % int(number)
            remote_stills.extend((owner, index, still) for index, still in enumerate(detail.get("stills", []), 1)
                                 if not still["url"].startswith("/uma_tools/"))

    def localize(row):
        owner, index, still = row
        output = "uma_tools/img/anime/stills/%s-%02d.webp" % (owner, index)
        asset = {"source_url": still["original"], "output": output, "mode": "episode",
                 "source_ref": still.get("source_ref")}
        if args.write:
            write_cover(asset, fetch_image=fetch_video if urlsplit(still["original"]).hostname in {'i.ytimg.com', 'prcdn.freetls.fastly.net'} else fetch)
        return still, asset

    with ThreadPoolExecutor(max_workers=4) as pool:
        for still, asset in pool.map(localize, remote_stills):
            still["url"] = "/" + asset["output"]
            existing = next((row for row in assets["assets"] if row["output"] == asset["output"]), None)
            if existing:
                existing.update(asset)
            else:
                assets["assets"].append(asset)
    if args.write:
        for filename, document in [("units", units), ("works", works), ("asset_sources", assets), ("source_registry", sources)]:
            atomic_json(DATA / (filename + ".json"), document)
    print("Episode artwork resolved:", sum(row is not None for row in resolved))
    if failures:
        raise SystemExit("Unresolved artwork: " + ", ".join(failures))


if __name__ == "__main__":
    main()
