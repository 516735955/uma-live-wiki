"""Apply the released Full Gate episode 2 from its official CMS and video."""

import argparse
import json
from pathlib import Path

from build_anime_catalog import atomic_json
from collect_anime_official import collect_fullgate

DATA = Path(__file__).resolve().parents[1] / "data/anime"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    episode = next(row for row in collect_fullgate() if row["number"] == 2)
    if episode["youtube_id"] != "COwezDS-R3s":
        raise ValueError("official episode video changed")
    documents = {name: json.loads((DATA / (name + ".json")).read_text(encoding="utf-8"))
                 for name in ("units", "watch_resources", "source_registry")}
    work = episode["work_id"]
    unit = work + "-e02"
    source = "official-story-" + unit
    series = next(row for row in documents["units"]["series"] if row["work_id"] == work)
    series["released_count"] = max(series["released_count"], 2)
    if not any(row["from"] == 2 for row in series["date_blocks"]):
        series["date_blocks"].append({"from": 2, "to": 2, "dates": ["2026-10-04"]})
    detail = series["details"].setdefault("2", {})
    detail.update(title_ja=episode["title_ja"], title_zh="白热化！比手画脚对决！",
                  summary_ja=episode["summary_ja"],
                  summary_zh="圣蹄祭当天，BNW与樱花千代王等三强展开比手画脚比赛。同期伙伴之间的默契，让这场对决变成了高水平的较量。",
                  release_date="2026-10-04", duration="3分04秒",
                  dates=[{"label": "YouTube公开", "date": "2026-10-04", "display": "2026-10-04 21:00", "timezone": "JST"}])
    detail["source_refs"] = list(dict.fromkeys(detail.get("source_refs", []) + [source]))
    detail["stills"] = [{"url": url, "original_url": url, "source_ref": source} for url in episode["stills"]]
    sources = documents["source_registry"]["sources"]
    if not any(row["id"] == source for row in sources):
        sources.append({"id": source, "kind": "official", "label": "Full Gate第2话官网剧情与署名",
                        "url": episode["source_url"], "observed_at": "2026-10-05"})
    resources = documents["watch_resources"]["resources"]
    resource_id = "watch-official-" + unit
    resource = next((row for row in resources if row["id"] == resource_id), None)
    if resource is None:
        resource = {"id": resource_id}
        resources.append(resource)
    resource.update(scope={"type": "unit", "id": unit}, platform="youtube", authority="official",
                    content_type="full_episode", status="active", access="free",
                    url="https://www.youtube.com/watch?v=" + episode["youtube_id"],
                    source_ref=source, verified_at="2026-10-05")
    directory = next(row for row in resources if row["id"] == "watch-official-directory-" + work)
    directory["url"] = "https://umamusume.jp/contents/anime/umayuru-fullgate/"
    directory["unit_ids"] = list(dict.fromkeys(directory["unit_ids"] + [unit]))
    print("Full Gate episode 2: published video, synopsis and 5 original stills")
    if args.write:
        for name, document in documents.items():
            atomic_json(DATA / (name + ".json"), document)


if __name__ == "__main__":
    main()
