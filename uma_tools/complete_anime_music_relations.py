"""Supplement episode music uses explicitly identified by accepted public sources."""

import argparse
import json
from pathlib import Path

from build_anime_catalog import atomic_json
from sync_music_metadata import stable_creator_id

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/anime"
SOURCES = {
    "moegirl-umayon-episode-music": ("赛马娘四格逐集音乐", "https://moegirl.icu/赛马娘四格"),
    "moegirl-umayuru-episode-music": ("摇曳马娘逐集音乐", "https://moegirl.icu/摇曳马娘"),
    "moegirl-cingray-episode-music": ("芦毛灰姑娘逐集音乐", "https://moegirl.uk/赛马娘_芦毛灰姑娘"),
    "moegirl-tv-episode-music": ("电视动画逐集音乐", "https://moegirl.uk/赛马娘_Pretty_Derby/动画"),
}
OFFICIAL_SOURCES = {
    "official-cingray-e22-winning-live": ("芦灰第22话胜者舞台官方视频", "https://www.youtube.com/watch?v=167895lxqW4"),
}
CUE_CREATORS = {
    "高田龙一": ("高田龍一", ["髙田龍一"], "https://monaca.jp/en/member/takada"),
    "椎名豪": ("椎名豪", [], "https://www.dokkyo-mejiro.com/wp/wp-content/uploads/2021/06/96.pdf"),
    "小林启树": ("小林啓樹", [], "https://www.bandainamcoent.co.jp/asobimotto/page/ac_symphony.html"),
}
CUE_PORTRAITS = {
    "高田龙一": ("ryuichi-takada.jpg", "https://monaca.jp/en/member/takada",
                 "https://monaca.jp/test_newmncHP_test/wp-content/uploads/2023/03/230222-1_2371-edited-scaled.jpg"),
    "小林启树": ("keiki-kobayashi.jpg", "https://ace7.acecombat.jp/special/message.php",
                 "https://ace7.acecombat.jp/assets/images/special/message/ph_28.jpg"),
}
# Each range is stated in the source. The four-panel episode 11 has no
# identified ending use here; Blu-ray episodes 13–24 do not inherit TV endings.
USES = [
    ("anime-umayon", "song-cdf2727e54", "ed", range(1, 5), "moegirl-umayon-episode-music"),
    ("anime-umayon", "song-ring-ring-c9bdb0e414", "ed", range(5, 9), "moegirl-umayon-episode-music"),
    ("anime-umayon", "song-fallin-love-9a20ebe280", "ed", [9, 10, 12], "moegirl-umayon-episode-music"),
    ("anime-umayuru", "song-happy-days-01845306a9", "ed", range(1, 5), "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-f4ab00a70a", "ed", range(5, 9), "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-dance-2-endless-beat-8c6c92b99d", "ed", range(9, 13), "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-rap-24bd84173c", "ed", range(13, 17), "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-bright-melody-bd728589b5", "ed", range(17, 21), "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-496f508d38", "ed", range(21, 24), "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-228f943b49", "ed", [24], "moegirl-umayuru-episode-music"),
    ("anime-umayuru", "song-7427a5b772", "insert", [13], "moegirl-umayuru-episode-music"),
    ("anime-cinderella-gray", "song-1aba5caa02", "insert", [3], "moegirl-cingray-episode-music"),
    ("anime-cinderella-gray", "song-brightest-heart-dd824b4715", "insert", [4, 6], "moegirl-cingray-episode-music"),
    ("anime-cinderella-gray", "song-82faef5370", "op", range(1, 14), "staff-transcript-anime-cinderella-gray"),
    ("anime-cinderella-gray", "song-38f64525a9", "ed", range(1, 14), "staff-transcript-anime-cinderella-gray"),
    ("anime-cinderella-gray", "song-42bd0bc92d", "op", range(14, 24), "staff-transcript-anime-cinderella-gray"),
    ("anime-cinderella-gray", "song-864b1bb2e9", "ed", [*range(14, 22), 23], "staff-transcript-anime-cinderella-gray"),
    ("anime-cinderella-gray", "song-next-frontier-5267707c1b", "winning_live", [22], "staff-transcript-anime-cinderella-gray"),
    ("anime-s1", "song-endless-dream-eabbcc4d12", "insert", [2], "moegirl-tv-episode-music"),
    ("anime-s2", "song-18aa53485d", "insert", [8], "moegirl-tv-episode-music"),
    ("anime-s2", "song-b90b0841b4", "insert", [13], "moegirl-tv-episode-music"),
    ("anime-s3", "song-bd297fdbbe", "insert", [1], "moegirl-tv-episode-music"),
]
FANFARES = [
    ("anime-cinderella-gray", "笠松競馬 ファンファーレ（重賞）", [4, 6], [], ["笠松赛马场"], ""),
    ("anime-cinderella-gray", "ウマ娘 ファンファーレ I GI", [9, 12], ["高田龙一"], ["MONACA"], "作曲／编曲"),
    ("anime-cinderella-gray", "ウマ娘 ファンファーレ VI GI", [10], ["椎名豪"], [], "作曲／编曲"),
    ("anime-cinderella-gray", "ウマ娘 ファンファーレ I 重賞", [11], ["高田龙一"], ["MONACA"], "作曲／编曲"),
    ("anime-s1", "ウマ娘 ファンファーレ I 一般", [1, 15], ["高田龙一"], ["MONACA"], "作曲"),
    ("anime-s1", "ウマ娘 ファンファーレ I GI", [3, 4, 5, 7, 10, 11, 12], ["高田龙一"], ["MONACA"], "作曲／编曲"),
    ("anime-s1", "ウマ娘 ファンファーレ I 重賞", [6], ["高田龙一"], ["MONACA"], "作曲／编曲"),
    ("anime-s1", "ウマ娘 ファンファーレ II GI", [16], ["小林启树"], [], "作曲／编曲"),
    ("anime-s2", "ウマ娘 ファンファーレ I GI", [1, 4, 13], ["高田龙一"], ["MONACA"], "作曲／编曲"),
    ("anime-s2", "ウマ娘 ファンファーレ II GI", [2, 5, 8], ["小林启树"], [], "作曲／编曲"),
    ("anime-s2", "ウマ娘 ファンファーレ II 重賞", [3], ["小林启树"], [], "作曲／编曲"),
    ("anime-s3", "ウマ娘 ファンファーレ I GI", [1, 3, 7, 11, 12, 13], ["高田龙一"], ["MONACA"], "作曲／编曲"),
    ("anime-s3", "ウマ娘 ファンファーレ II GI", [2, 6, 9], ["小林启树"], [], "作曲／编曲"),
    ("anime-s3", "ウマ娘 ファンファーレ VI GI", [5, 10], ["椎名豪"], [], "作曲／编曲"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    document = json.loads((DATA / "relations.json").read_text(encoding="utf-8"))
    registry = json.loads((DATA / "source_registry.json").read_text(encoding="utf-8"))
    units = json.loads((DATA / "units.json").read_text(encoding="utf-8"))
    creators = json.loads((ROOT / "data/music/creators.json").read_text(encoding="utf-8"))
    songs = {song["id"] for song in json.loads((ROOT / "data/song_catalog.json").read_text(encoding="utf-8"))["songs"]}
    known_sources = {source["id"] for source in registry["sources"]}
    for source_id, (label, url) in SOURCES.items():
        if source_id not in known_sources:
            registry["sources"].append({"id": source_id, "kind": "community", "label": label,
                                        "url": url, "observed_at": "2026-10-05"})
    for source_id, (label, url) in OFFICIAL_SOURCES.items():
        if source_id not in known_sources:
            registry["sources"].append({"id": source_id, "kind": "official", "label": label,
                                        "url": url, "observed_at": "2026-10-05"})
    added = supplemented = 0
    for work_id, song_id, usage, episodes, source_id in USES:
        if song_id not in songs:
            raise ValueError(f"Unknown song: {song_id}")
        for number in episodes:
            unit_id = f"{work_id}-e{number:02d}"
            existing = [row for row in document["relations"]
                        if row["source_type"] == "anime_unit" and row["source_id"] == unit_id
                        and row["relation_type"] == "uses_song" and row["target_id"] == song_id
                        and row.get("usage_type") == usage]
            if existing:
                for row in existing:
                    if source_id not in row.get("evidence_refs", []):
                        row.setdefault("evidence_refs", []).append(source_id)
                        supplemented += 1
                continue
            # A named use proves the song, not an arbitrary full-length or
            # album recording. Existing verified recording links remain intact.
            document["relations"].append({
                "id": f"{unit_id}-{usage}-{song_id}", "source_type": "anime_unit",
                "source_id": unit_id, "relation_type": "uses_song", "target_type": "song",
                "target_id": song_id, "usage_type": usage,
                "label": {"op": "片头曲", "ed": "片尾曲", "insert": "插入曲", "winning_live": "胜者舞台", "bgm": "背景配乐"}[usage],
                "display_order": 20, "evidence_refs": [source_id],
            })
            added += 1
    # The official episode 22 clip names all three performers. The official
    # soundtrack lists the same anime recording and performers on disc 2/33.
    for row in document["relations"]:
        if (row["source_id"] == "anime-cinderella-gray-e22"
                and row["relation_type"] == "uses_song"
                and row["target_id"] == "song-next-frontier-5267707c1b"
                and row.get("usage_type") == "winning_live"):
            row.update(version_id="song-next-frontier-5267707c1b-v-c739868dd5",
                       version_label="Anime Size", release_id="album-laca-19146")
            row["evidence_refs"] = list(dict.fromkeys([*row["evidence_refs"],
                "official-cingray-e22-winning-live", "official-ost-anime-cinderella-gray"]))
    # These explicitly named cues have no identified release in the song
    # catalog. They remain episode music facts without a fabricated recording.
    by_work = {series["work_id"]: series for series in units["series"]}
    added_cues = 0
    for work_id, title, episodes, names, institutions, role in FANFARES:
        for number in episodes:
            cues = by_work[work_id]["details"][str(number)].setdefault("music_cues", [])
            if any(cue["title"] == title for cue in cues):
                continue
            cues.append({"title": title, "usage_type": "fanfare",
                         "credits": [{"role": role, "names": names, "institutions": institutions}] if names else [],
                         "institutions": institutions if not names else [],
                         "source_refs": ["moegirl-cingray-episode-music" if work_id=="anime-cinderella-gray" else "moegirl-tv-episode-music"]})
            added_cues += 1
    # Cue authors have music creator pages. An identified cue does not create
    # a recording or make its author part of the animation Staff index.
    creator_ids = {}
    for name, (original, aliases, url) in CUE_CREATORS.items():
        identities = {name, original, *aliases}
        person = next((row for row in creators["creators"]
                       if identities.intersection({row["name"], *row.get("aliases", [])})), None)
        if person is None:
            person = {"id": stable_creator_id(original), "name": name,
                      "aliases": [alias for alias in [original, *aliases] if alias != name],
                      "type": "person", "affiliations": [], "manual": True,
                      "source_urls": [url]}
            creators["creators"].append(person)
        person["anime_music"] = True
        person["anime_music_roles"] = ["composer", "arranger"]
        person["source_urls"] = list(dict.fromkeys([*person.get("source_urls", []), url]))
        if name in CUE_PORTRAITS:
            filename, source_url, original = CUE_PORTRAITS[name]
            person.update(image=f"/uma_tools/img/creators/{filename}",
                          image_source_url=source_url, image_original_url=original)
        creator_ids[name] = person["id"]
    for series in units["series"]:
        for detail in series.get("details", {}).values():
            for cue in detail.get("music_cues", []):
                for credit in cue.get("credits", []):
                    credit["creator_ids"] = [creator_ids[name] for name in credit["names"]]
    print(f"Added episode music uses: {added}; supplemented evidence: {supplemented}")
    print(f"Added explicitly identified cues without recording links: {added_cues}")
    if args.write:
        atomic_json(DATA / "relations.json", document)
        atomic_json(DATA / "source_registry.json", registry)
        atomic_json(DATA / "units.json", units)
        atomic_json(ROOT / "data/music/creators.json", creators)


if __name__ == "__main__":
    main()
