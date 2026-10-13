#!/usr/bin/env python3
"""Extract public official episode material; never overwrite accepted catalogs."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "UmaLiveWiki/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read().decode("utf-8")
        except (OSError, urllib.error.URLError):
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def cms(domain: str, key: str, endpoint: str) -> dict:
    request = urllib.request.Request(
        f"https://{domain}.microcms.io/api/v1/{endpoint}?limit=100",
        headers={"X-MICROCMS-API-KEY": key},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.load(response)
    if not isinstance(data.get("contents"), list) or len(data["contents"]) != data.get("totalCount"):
        raise ValueError("incomplete official CMS response")
    return data


def archived_episode(work: str, number: int) -> dict:
    base = f"https://anime-umamusume.jp/archive/{'1st' if work == 'anime-s1' else '2nd'}/story/"
    filename = (f"{number:02d}.html" if number < 13 else "extra.html") if work == "anime-s1" else f"id_{number:02d}.html"
    url = base + filename
    soup = BeautifulSoup(fetch(url), "html.parser")
    if work == "anime-s1":
        body = soup.select_one("#storyOnce p")
        summary = body.get_text("", strip=True) if body else ""
        images = [urllib.parse.urljoin(url, img["src"]) for img in soup.find_all("img")
                  if re.search(r"/story/\d+_\d+\.(?:png|jpg)", img.get("src", ""))]
        staff = ""
    else:
        body = soup.select_one(".story-text") or soup.select_one(".story-detail")
        summary_node = soup.select_one(".story")
        # The archived site uses content text in .story__description.
        summary_node = soup.select_one(".story__contents.type-story")
        summary = summary_node.get_text("", strip=True) if summary_node else ""
        images = [urllib.parse.urljoin(url, img["src"]) for img in soup.find_all("img")
                  if re.search(r"/uploads/.*\.(?:jpg|jpeg)", img.get("src", ""))]
        staff = "\n".join(f"{dt.get_text(strip=True)}：{dt.find_next_sibling('dl').get_text(' ', strip=True)}"
                          for dt in soup.find_all("dt") if dt.find_next_sibling("dl"))
    return {"work_id": work, "number": number, "source_url": url, "summary_ja": summary,
            "stills": list(dict.fromkeys(images)), "staff_text": staff}


def collect_cingray() -> list[dict]:
    rows = []
    # Public read configuration is extracted at runtime from each official
    # site's shipped browser bundle. No browser configuration is persisted.
    site = "https://anime-cinderellagray.com"
    html = fetch(site + "/story/")
    app_path = re.search(r'import\("([^\"]*/entry/app\.[^\"]+)"\)', html).group(1)
    app = fetch(urllib.parse.urljoin(site + "/story/", app_path))
    node_path = re.search(r'\.\./nodes/14\.[A-Za-z0-9_-]+\.js', app).group(0)
    node = fetch(urllib.parse.urljoin(urllib.parse.urljoin(site + "/story/", app_path), node_path))
    cms_path = re.search(r'\.\./chunks/cms\.[A-Za-z0-9_-]+\.js', node).group(0)
    node_url = urllib.parse.urljoin(urllib.parse.urljoin(site + "/story/", app_path), node_path)
    cms_source = fetch(urllib.parse.urljoin(node_url, cms_path))
    import_path = re.search(r'from"([^\"]+)"', cms_source).group(1)
    config = fetch(urllib.parse.urljoin(urllib.parse.urljoin(node_url, cms_path), import_path))
    exports = dict(re.findall(r'([A-Za-z_$][\w$]*) as ([Pk])(?=,|})', config[config.rfind("export{"):]))
    domain_symbol = next(name for name, alias in exports.items() if alias == "P")
    key_symbol = next(name for name, alias in exports.items() if alias == "k")
    domain = json.loads(re.search(r'\b' + re.escape(domain_symbol) + r'=("[^\"]+")', config).group(1))
    key = json.loads(re.search(r'\b' + re.escape(key_symbol) + r'=("[^\"]+")', config).group(1))
    for item in cms(domain, key, "story")["contents"]:
        rows.append({"work_id": "anime-cinderella-gray", "number": item["num"],
                     "title_ja": item["title"], "summary_ja": item.get("story", ""),
                     "staff_text": item.get("staff", ""),
                     "stills": [scene["image"]["url"] for scene in item.get("scene", []) if scene.get("image")],
                     "source_url": site + "/story/?ep=" + str(item["num"])})
    return rows


def collect_season3() -> list[dict]:
    rows = []
    html = fetch("https://anime-umamusume.jp/story/")
    domain = re.search(r'serviceDomain:"([^\"]+)"', html).group(1)
    key = re.search(r'apiKey:"([^\"]+)"', html).group(1)
    for item in cms(domain, key, "story")["contents"]:
        rows.append({"work_id": "anime-s3", "number": item["episode_id"],
                     "title_ja": item["title"], "summary_ja": item.get("story", ""),
                     "staff_text": item.get("staff", ""), "stills": [image["url"] for image in item.get("images", [])],
                     "source_url": "https://anime-umamusume.jp/story/?ep=" + str(item["episode_id"])})
    return rows


def collect_fullgate() -> list[dict]:
    site = "https://umamusume.jp/contents/anime/umayuru-fullgate/"
    html = fetch(site)
    app_path = re.search(r'import\("([^\"]*/entry/app\.[^\"]+)"\)', html).group(1)
    app_url = urllib.parse.urljoin(site, app_path)
    app = fetch(app_url)
    node_path = re.search(r'\.\./nodes/0\.[A-Za-z0-9_-]+\.js', app).group(0)
    node = fetch(urllib.parse.urljoin(app_url, node_path))
    domain = re.search(r'serviceDomain:[\w$]+\.serviceDomain\|\|`([^`]+)`', node).group(1)
    key = re.search(r'apiKey:[\w$]+\.apiKey\|\|`([^`]+)`', node).group(1)
    return [{"work_id": "anime-umayuru-fullgate", "number": item["no"],
             "title_ja": item["title"], "summary_ja": item.get("text", ""),
             "cast": item.get("cast", []), "staff": item.get("staff", []),
             "stills": [image["url"] for image in item.get("images", [])],
             "youtube_id": item.get("movie_id", ""),
             "source_url": site + "episodes/" + str(item["no"]) + "/"}
            for item in cms(domain, key, "episodes")["contents"]]


def collect() -> list[dict]:
    rows = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = [(work, number) for work in ("anime-s1", "anime-s2") for number in range(1, 14)]
        rows.extend(pool.map(lambda pair: archived_episode(*pair), tasks))
    rows.extend(collect_cingray())
    rows.extend(collect_season3())
    rows.extend(collect_fullgate())
    return sorted(rows, key=lambda row: (row["work_id"], row["number"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="write extraction candidates to this file")
    args = parser.parse_args()
    payload = json.dumps({"episodes": collect()}, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
        print("Official episode candidates written; accepted data is unchanged.")
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
