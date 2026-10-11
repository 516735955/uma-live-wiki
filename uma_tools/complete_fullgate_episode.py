"""Apply reviewed released Full Gate episodes from their official CMS and video."""

import argparse
import json
from pathlib import Path

from build_anime_catalog import atomic_json
from collect_anime_official import collect_fullgate

DATA = Path(__file__).resolve().parents[1] / "data/anime"
EPISODES = {
    2: {
        "video": "COwezDS-R3s", "date": "2026-10-04", "verified_at": "2026-10-05",
        "title_zh": "白热化！比手画脚对决！",
        "summary_zh": "圣蹄祭当天，BNW与樱花千代王等三强展开比手画脚比赛。同期伙伴之间的默契，让这场对决变成了高水平的较量。",
    },
    3: {
        "video": "OuXP2GipwAE", "date": "2026-10-11", "verified_at": "2026-10-12",
        "title_zh": "把不输给任何人的热情化作艺术！",
        "summary_zh": "赛马娘们为粉丝活动准备艺术作品时，热血的黄金船师范代现身。争夺最富热情作品的较量，就此开始！",
    },
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--episode", type=int, choices=sorted(EPISODES), default=2)
    args = parser.parse_args()
    reviewed = EPISODES[args.episode]
    episode = next(row for row in collect_fullgate() if row["number"] == args.episode)
    if episode["youtube_id"] != reviewed["video"]:
        raise ValueError("official episode video changed")
    documents = {name: json.loads((DATA / (name + ".json")).read_text(encoding="utf-8"))
                 for name in ("units", "watch_resources", "source_registry")}
    work = episode["work_id"]
    unit = f"{work}-e{args.episode:02d}"
    source = "official-story-" + unit
    series = next(row for row in documents["units"]["series"] if row["work_id"] == work)
    series["released_count"] = max(series["released_count"], args.episode)
    if not any(row["from"] <= args.episode <= row["to"] for row in series["date_blocks"]):
        series["date_blocks"].append({"from": args.episode, "to": args.episode, "dates": [reviewed["date"]]})
    detail = series["details"].setdefault(str(args.episode), {})
    detail.update(title_ja=episode["title_ja"], title_zh=reviewed["title_zh"],
                  summary_ja=episode["summary_ja"],
                  summary_zh=reviewed["summary_zh"],
                  release_date=reviewed["date"], duration="3分04秒",
                  dates=[{"label": "YouTube公开", "date": reviewed["date"], "display": reviewed["date"] + " 21:00", "timezone": "JST"}])
    detail["source_refs"] = list(dict.fromkeys(detail.get("source_refs", []) + [source]))
    detail["stills"] = [{"url": url, "original": url, "source_ref": source} for url in episode["stills"]]
    sources = documents["source_registry"]["sources"]
    if not any(row["id"] == source for row in sources):
        sources.append({"id": source, "kind": "official", "label": f"Full Gate第{args.episode}话官网剧情与署名",
                        "url": episode["source_url"], "observed_at": reviewed["verified_at"]})
    resources = documents["watch_resources"]["resources"]
    resource_id = "watch-official-" + unit
    resource = next((row for row in resources if row["id"] == resource_id), None)
    if resource is None:
        resource = {"id": resource_id}
        resources.append(resource)
    resource.update(scope={"type": "unit", "id": unit}, platform="youtube", authority="official",
                    content_type="full_episode", status="active", access="free",
                    url="https://www.youtube.com/watch?v=" + episode["youtube_id"],
                    source_ref=source, verified_at=reviewed["verified_at"])
    directory = next(row for row in resources if row["id"] == "watch-official-directory-" + work)
    directory["url"] = "https://umamusume.jp/contents/anime/umayuru-fullgate/"
    directory["unit_ids"] = list(dict.fromkeys(directory["unit_ids"] + [unit]))
    print(f"Full Gate episode {args.episode}: published video, synopsis and {len(episode['stills'])} original stills")
    if args.write:
        for name, document in documents.items():
            atomic_json(DATA / (name + ".json"), document)


if __name__ == "__main__":
    main()
