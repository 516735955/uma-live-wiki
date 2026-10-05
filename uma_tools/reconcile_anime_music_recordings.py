"""Reconcile the officially documented first/second-season TV recordings."""

import argparse
import copy
import json
from pathlib import Path

from build_anime_catalog import atomic_json
from update_events import stable_version_id

ROOT = Path(__file__).resolve().parents[1]
SONG = "song-228f943b49"
ORIGINAL = "song-228f943b49-v-6303aaaad6"
SECOND_LABEL = "TV Size / 第二季第13话"
SECOND = stable_version_id(SONG, f"うまぴょい伝説 (TV Size) ({SECOND_LABEL})")
FIRST_SOURCE = "https://anime-umamusume.jp/archive/1st/music/derby03.html"
SECOND_SOURCE = "https://anime-umamusume.jp/archive/2nd/music/detail_936.html"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    albums = json.loads((ROOT / "data/albums.json").read_text(encoding="utf-8"))
    by_album = {album["id"]: album for album in albums}
    first = by_album["album-laca-9637"]["songs"]
    single = by_album["album-lacm-14779"]
    # The official single page names the same 18/7/32 singers as these
    # first-season soundtrack tracks. The single's one-person artist metadata
    # belongs to none of these three group recordings.
    for single_number, soundtrack_number in [(1, 60), (2, 59), (3, 61)]:
        single["songs"][single_number - 1]["artist"] = first[soundtrack_number - 1]["artist"]
    single["source_url"] = FIRST_SOURCE
    for number in [4, 5]:
        single["songs"][number - 1].update(artist="", instrumental=True)
    second = by_album["album-laca-9814"]["songs"][30]
    if second["name"] != "うまぴょい伝説 (TV Size)":
        raise ValueError("Second-season soundtrack track does not match")
    second["version_label"] = SECOND_LABEL
    credits = json.loads((ROOT / "data/music/credits.json").read_text(encoding="utf-8"))
    # Official pages credit Honda for all three authoring jobs in both
    # recordings. Lyrics and timing data are not copied between recordings.
    rows = copy.deepcopy(credits["versions"][ORIGINAL]["credits"])
    credits["versions"][ORIGINAL].update(source="official_release", source_url=FIRST_SOURCE,
                                          source_catalog="LACM-14779", manual=True)
    credits["versions"][SECOND] = {"credits": rows, "source": "official_release",
                                     "source_url": SECOND_SOURCE, "source_catalog": "LACA-9814", "manual": True}
    relations = json.loads((ROOT / "data/anime/relations.json").read_text(encoding="utf-8"))
    updated = 0
    for row in relations["relations"]:
        if row.get("version_id") == ORIGINAL and row.get("release_id") == "album-laca-9814":
            row.update(version_id=SECOND, version_label=SECOND_LABEL)
            updated += 1
    print(f"Second-season recording: {SECOND}; corrected anime links: {updated}")
    if args.write:
        atomic_json(ROOT / "data/albums.json", albums, indent=1)
        atomic_json(ROOT / "data/music/credits.json", credits)
        atomic_json(ROOT / "data/anime/relations.json", relations)


if __name__ == "__main__":
    main()
