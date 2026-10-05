"""Supplement verified prototype-horse profiles without replacing race data."""

import argparse
import json
from pathlib import Path

from crawl_horses import atomic_write, parse_tables, serialize
from collect_anime_official import fetch

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {
    "dyna_actress": {
        "photo": "/uma_tools/img/horses/dyna_actress.jpg",
        "photo_original_url": "https://cdnv2.netkeiba.com/img.en/db/show_photo.html?horse_id=1983104087&no=12164&tn=&tmp=no",
        "photo_credit": "Seabirdfly / netkeiba",
        "photo_source": {"label": "netkeiba", "url": "https://en.netkeiba.com/db/horse/horse_photo_detail.html?horse_id=1983104087&photo_id=12164"},
    },
    "moon_madness": {
        "photo": "/uma_tools/img/horses/moon_madness.jpg",
        "photo_original_url": "https://cdnv2.netkeiba.com/img.en/db/show_photo.html?horse_id=1983109003&no=11142&tn=&tmp=no",
        "photo_credit": "Yassy / netkeiba",
        "photo_source": {"label": "netkeiba", "url": "https://en.netkeiba.com/db/horse/horse_photo_detail.html?horse_id=1983109003&photo_id=11142"},
    },
    "legend_teio": {
        "photo": "/uma_tools/img/horses/legend_teio.jpg",
        "photo_original_url": "https://cdnv2.netkeiba.com/img.en/db/show_photo.html?horse_id=1983105000&no=11482&tn=&tmp=no",
        "photo_credit": "アデ夫 / netkeiba",
        "photo_source": {"label": "netkeiba", "url": "https://en.netkeiba.com/db/horse/horse_photo_detail.html?horse_id=1983105000&photo_id=11482"},
    },
    "bonecrusher": {
        "intro": ["碎骨机是新西兰出生的栗毛赛马，由弗兰克·里奇训练，生涯44战18胜，其中包括9场一级赛。1986年考克斯碟与Waverley Star的激烈争夺，是其代表性比赛。"],
        "retirement": ["退役后曾多次公开亮相，2015年去世，享年32岁。安葬于艾勒斯利赛马场，场内以铜像纪念。"],
        "photo": "/uma_tools/img/horses/bonecrusher.jpg",
        "photo_original_url": "https://www.aucklandracing.co.nz/wp-content/uploads/2025/12/BONECRUSHER-Credit-Race-Images.jpg",
        "photo_credit": "Race Images",
        "source": {"label": "Auckland Thoroughbred Racing", "url": "https://www.aucklandracing.co.nz/remembering-bonecrusher-the-great-bonecrusher-stakes-day/"},
    },
    "pay_the_butler": {
        "photo": "/uma_tools/img/horses/pay_the_butler.jpg",
        "photo_original_url": "https://taw.or.jp/wp/wp-content/themes/taw/assets/img/page/taw-gallery/202510/img08-origin.jpg",
        "photo_source": {"label": "TAW", "url": "https://taw.or.jp/column/taw-gallery/article-16/"},
        "intro": ["管家侍从于1984年出生在美国，先后在法国、美国与日本出赛，生涯40战5胜。1988年日本杯击败玉藻十字、小栗帽等对手夺冠，同年赢得美国二级赛红史密斯让赛。"],
        "breeding": ["1991年在日本开始种牡马生涯，同年因事故去世，仅留下一个世代的后代。其中Pal Bright赢得函馆纪念、大井纪念及东京三岁优骏牝马。"],
        "death": "1991-07-01",
        "source": {"label": "競走馬のふるさと案内所", "url": "https://uma-furusato.com/search_horse/0000171988.html"},
    },
}


def read_data(path):
    return json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--refresh-major", action="store_true", help="核对新原型马的JBIS主要成绩")
    args = parser.parse_args()
    detail_path = ROOT / "data/horses_details.js"
    list_path = ROOT / "data/horses_list.js"
    details, rows = read_data(detail_path), read_data(list_path)
    changed = []
    identifiers = list(PROFILES)
    if args.refresh_major:
        identifiers = list(dict.fromkeys([*identifiers, "moon_madness", "my_big_boy", "dyna_actress", "rugger_black", "fujino_northern", "legend_teio"]))
    for identifier in identifiers:
        profile = PROFILES.get(identifier, {})
        record = details[identifier]
        before = json.dumps(record, ensure_ascii=False, sort_keys=True)
        if args.refresh_major:
            major = parse_tables(fetch(record["jbis"]))["major"]
            if major:
                # An observed row retains its exact date and race identity.
                old_keys = {(row["date"], row["race"]) for row in record.get("major", [])}
                new_keys = {(row["date"], row["race"]) for row in major}
                if not old_keys.issubset(new_keys):
                    raise ValueError(f"JBIS major results lost existing rows: {identifier}")
                record["major"] = major
        for key, value in profile.items():
            if key not in {"source", "photo_source"}:
                # Existing independently maintained text remains intact.
                if not record.get(key) or record[key] == value:
                    record[key] = value
        sources = record.setdefault("sources", [])
        for source in [*(profile[key] for key in ("source", "photo_source") if profile.get(key)), {"label": "JBIS", "url": record["jbis"]}]:
            if not any(item.get("url") == source["url"] for item in sources):
                sources.append(source)
        if record.get("photo"):
            if not (ROOT / record["photo"].lstrip("/")).is_file():
                raise ValueError(f"Missing verified photograph: {identifier}")
            next(row for row in rows if row["id"] == identifier)["photo"] = record["photo"]
        if before != json.dumps(record, ensure_ascii=False, sort_keys=True):
            changed.append(identifier)
        if args.write:
            cache = ROOT / f"data/horses_cache/detail_{identifier}.json"
            if cache.exists():
                atomic_write(str(cache), json.dumps(record, ensure_ascii=False))
    print("Supplemented horse profiles: " + (", ".join(changed) or "0"))
    if args.write:
        atomic_write(str(detail_path), serialize("window.HORSES_DETAIL = ", details))
        atomic_write(str(list_path), serialize("window.HORSES = ", rows))


if __name__ == "__main__":
    main()
