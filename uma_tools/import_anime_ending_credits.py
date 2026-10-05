"""Import manually checked official ending credits with individual scope."""

import argparse
import json
import re
from pathlib import Path

from build_anime_catalog import atomic_json
from import_anime_episode_cast import normalized
from sync_music_metadata import stable_creator_id
from anime_labels import role_label, group_label
from character_scope import excluded_signature

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/anime"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--unit", action="append", help="Import only these unit IDs; repeat to select several.")
    args = parser.parse_args()
    documents = {name: json.loads((DATA / (name + ".json")).read_text(encoding="utf-8"))
                 for name in ("ending_credits", "people", "staff", "units", "relations", "source_registry")}
    people = documents["people"]["people"]
    credits = documents["staff"]["credits"]
    relations = documents["relations"]["relations"]
    sources = documents["source_registry"]["sources"]
    characters = json.loads((ROOT / "data/character_index_data.js").read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
    voices = json.loads((ROOT / "data/voice_actor_profiles.json").read_text(encoding="utf-8"))["voice_actors"]
    creator_doc = json.loads((ROOT / "data/music/creators.json").read_text(encoding="utf-8"))
    creators = creator_doc["creators"]
    music_doc = json.loads((ROOT / "data/music/credits.json").read_text(encoding="utf-8"))
    song_doc = json.loads((ROOT / "data/song_catalog.json").read_text(encoding="utf-8"))
    versions = {v["id"]: song["id"] for song in song_doc["songs"] for v in song["versions"]}
    character_names = {normalized(name): c for c in characters for name in (c["ja"], *c.get("aliases", []))}
    character_names["沖田トレーナー"] = next(c for c in characters if c["id"] == "narita_trainer")
    voice_names = {normalized(name): v for v in voices
                   for name in (v["identity"]["ja"], *v["identity"].get("aliases", []))}
    voice_names[normalized("高橋未奈美")] = next(v for v in voices if v["id"] == "va-0180")
    creator_names = {normalized(name): c["id"] for c in creators if c["type"] != "organization"
                     for name in (c["name"], *c.get("aliases", []))}
    people_names = {normalized(name): p for p in people for name in (p["name"], *p.get("aliases", []))}
    latin_names = {}
    for name, person in people_names.items():
        if re.fullmatch(r"[A-Za-z-]+", name):
            key = name.casefold().replace("-", "")
            latin_names.setdefault(key, {})[person["id"]] = person
    added = 0
    for episode in documents["ending_credits"]["episodes"]:
        work = episode["work_id"]
        unit = f"{work}-e{episode['number']:02d}"
        if args.unit and unit not in args.unit:
            continue
        ref = "official-ending-" + unit
        if not any(s["id"] == ref for s in sources):
            sources.append({"id": ref, "kind": "official", "label": "官方单集片尾职员表", "url": episode["url"],
                            "observed_at": documents["ending_credits"]["observed_at"]})
        signatures = list(episode.get("staff", []))
        for block in episode.get("staff_groups", []):
            common = {key: block[key] for key in ("role", "time", "group", "institutions") if key in block}
            signatures.extend({**common, "organization": name} for name in block.get("organizations", []))
            signatures.extend({**common, "name": name} for name in block.get("names", []))
        for order, signature in enumerate(signatures):
            row = {"work_id": work, "unit_id": unit, "source_ref": ref, "order": order,
                   "role": signature["role"], "group": signature.get("group", ""),
                   "name": signature.get("name", signature.get("organization")),
                   "source_time": signature["time"]}
            if "organization" in signature:
                row["organization"] = signature["organization"]
            else:
                name = normalized(signature["name"])
                person = people_names.get(name)
                if person is None and re.fullmatch(r"[A-Za-z-]+", name):
                    candidates = latin_names.get(name.casefold().replace("-", ""), {})
                    if len(candidates) == 1:
                        person = next(iter(candidates.values()))
                        if signature["name"] not in person.setdefault("aliases", []):
                            person["aliases"].append(signature["name"])
                if person is None:
                    person = {"id": "staff-" + name, "name": signature["name"], "aliases": [], "source_refs": []}
                    people.append(person)
                    people_names[name] = person
                    if re.fullmatch(r"[A-Za-z-]+", name):
                        latin_names.setdefault(name.casefold().replace("-", ""), {})[person["id"]] = person
                if name in creator_names and "音乐" in role_label(signature["role"]):
                    person["creator_id"] = creator_names[name]
                if ref not in person.setdefault("source_refs", []):
                    person["source_refs"].append(ref)
                row["person_id"] = person["id"]
                if signature.get("institutions"):
                    row["institutions"] = signature["institutions"]
            matches = [c for c in credits if c.get("unit_id") == unit and
                       role_label(c["role"]) == role_label(row["role"]) and normalized(c["name"]) == normalized(row["name"]) and
                       group_label(c.get("group", "")) == group_label(row["group"])]
            if matches:
                existing = matches[0]
                row["evidence_refs"] = list(dict.fromkeys([ref, *[source for c in matches for source in
                    [c.get("source_ref"), *c.get("evidence_refs", [])] if source]]))
                existing.update(row)
                duplicate_ids = {id(c) for c in matches[1:]}
                credits[:] = [c for c in credits if id(c) not in duplicate_ids]
            else:
                credits.append(row)
                added += 1
        for order, (signature, actor) in enumerate(episode["cast"]):
            if excluded_signature(signature):
                continue
            narrator = signature == "ナレーション"
            if signature == "トレーナー" and work in {"anime-s1", "anime-s2", "anime-s3", "anime-1st-anniversary"}:
                character = next(c for c in characters if c["id"] == "spica_trainer")
            else:
                character = None if narrator else character_names[normalized(signature)]
            voice = voice_names[normalized(actor)]
            target = character["id"] if character else voice["id"]
            existing = next((r for r in relations if r["source_id"] == unit and r.get("relation_type") == "credited_cast"
                             and r.get("target_id") == target and r.get("voice_actor_id") == voice["id"]), None)
            if existing:
                existing["evidence_refs"] = list(dict.fromkeys([*existing.get("evidence_refs", []), ref]))
            else:
                relations.append({"id": f"{unit}-official-ending-cast-{order:02d}", "source_type": "anime_unit", "source_id": unit,
                                  "relation_type": "credited_cast", "target_type": "character" if character else "voice_actor", "target_id": target,
                                  "voice_actor_id": voice["id"], "signature": signature, "display_order": order,
                                  "label": "", "evidence_refs": [ref]})
                if narrator:
                    relations[-1].update(label="旁白", role_name="旁白")
        series = next(s for s in documents["units"]["series"] if s["work_id"] == work)
        detail = series.setdefault("details", {}).setdefault(str(episode["number"]), {})
        detail["staff_status"] = episode["staff_status"]
        detail["source_refs"] = list(dict.fromkeys([*detail.get("source_refs", []), ref]))
        for cue in episode.get("music_cues", []):
            usage = cue.get("usage_type") or ("fanfare" if "ファンファーレ" in cue["title"] else "insert")
            if cue.get("song_id"):
                for relation in relations:
                    if relation["source_id"] == unit and relation.get("relation_type") == "uses_song" and relation.get("target_id") == cue["song_id"]:
                        relation.update(usage_type=usage, label="")
                        relation["evidence_refs"] = list(dict.fromkeys([*relation.get("evidence_refs", []), ref]))
            matches = [row for row in detail.get("music_cues", []) if normalized(row["title"]) == normalized(cue["title"])]
            if matches:
                for row in matches:
                    row["source_refs"] = list(dict.fromkeys([*row.get("source_refs", []), ref]))
                    row["usage_type"] = usage
                    if cue.get("song_id"):
                        row["song_id"] = cue["song_id"]
                continue
            names = cue.get("names", [])
            creator_ids = [creator_names[normalized(name)] for name in names]
            detail.setdefault("music_cues", []).append({
                "title": cue["title"], "usage_type": usage,
                "credits": [{"role": role_label(cue["role"]), "names": names,
                             "institutions": cue.get("institutions", []), "creator_ids": creator_ids}],
                "institutions": [], "source_refs": [ref], "source_time": cue["time"]})
            if cue.get("song_id"):
                detail["music_cues"][-1]["song_id"] = cue["song_id"]
        # Recording mappings are reviewed explicitly; titles and album order
        # never establish an episode's music use by themselves.
        for usage in episode.get("music_uses", []):
            version = usage["version_id"]
            if versions.get(version) != usage["song_id"]:
                raise ValueError("unknown recording mapping: " + version)
            relation_id = f"{unit}-ending-music-{version}"
            relation = {"id": relation_id, "source_type": "anime_unit", "source_id": unit,
                        "relation_type": "uses_song", "target_type": "song", "target_id": usage["song_id"],
                        "version_id": version, "release_id": usage["release_id"], "version_label": usage["title"],
                        "usage_type": usage["usage_type"], "label": "", "evidence_refs": [ref]}
            existing = next((r for r in relations if r["source_id"] == unit and
                             r.get("relation_type") == "uses_song" and r.get("version_id") == version), None)
            if existing:
                existing["evidence_refs"] = list(dict.fromkeys([*existing.get("evidence_refs", []), ref]))
            else:
                relations.append(relation)
            music = music_doc["versions"].setdefault(version, {"credits": [], "source": "official_ending", "manual": True})
            for signature in episode.get("music_signatures", []):
                if signature["title"] != usage["title"]:
                    continue
                role = {"作詞": "lyricist", "作曲": "composer", "編曲": "arranger"}.get(signature["role"])
                if not role:
                    continue
                for name in signature["names"]:
                    key = normalized(name)
                    creator_id = creator_names.get(key)
                    if not creator_id:
                        creator_id = stable_creator_id(name)
                        creators.append({"id": creator_id, "name": name, "aliases": [], "type": "person", "affiliations": []})
                        creator_names[key] = creator_id
                    credit = next((c for c in music["credits"] if c["role"] == role and normalized(c["name"]) == key), None)
                    if credit is None:
                        credit = {"role": role, "name": name, "creator_id": creator_id}
                        music["credits"].append(credit)
                    if signature.get("institutions"):
                        credit["affiliation"] = signature["institutions"][0]
            source = {"source": "official_ending", "source_url": episode["url"]}
            if source not in music.setdefault("supplemental_sources", []):
                music["supplemental_sources"].append(source)
    print("New individually checked ending credits:", added)
    if args.write:
        for name in ("people", "staff", "units", "relations", "source_registry"):
            atomic_json(DATA / (name + ".json"), documents[name])
        atomic_json(ROOT / "data/music/creators.json", creator_doc)
        atomic_json(ROOT / "data/music/credits.json", music_doc)


if __name__ == "__main__":
    main()
