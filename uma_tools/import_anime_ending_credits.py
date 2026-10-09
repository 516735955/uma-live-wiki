"""Import manually checked on-screen credits with individual scope."""

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
    version_labels = {v["id"]: v.get("version_label", "") for song in song_doc["songs"] for v in song["versions"]}
    character_names = {normalized(name): c for c in characters for name in (c["ja"], *c.get("aliases", []))}
    character_names["沖田トレーナー"] = next(c for c in characters if c["id"] == "narita_trainer")
    character_names["ウィニングチケット"] = next(c for c in characters if c["id"] == "winningticket")
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
    superseded_cast = 0
    superseded_staff = 0
    for episode in documents["ending_credits"]["episodes"]:
        work = episode["work_id"]
        edition = episode.get("edition", "")
        work_scope = episode.get("scope") == "work" or (episode.get("number") == 0 and edition)
        unit = f"{work}-e{episode['number']:02d}"
        scope_id = f"{work}-{edition}" if work_scope else unit
        if args.unit and scope_id not in args.unit and unit not in args.unit:
            continue
        ref = "official-ending-" + scope_id
        if not any(s["id"] == ref for s in sources):
            sources.append({"id": ref, "kind": episode.get("source_kind", "official"),
                            "label": "作品版原始片尾职员表" if work_scope else "单集原始片尾职员表", "url": episode["url"],
                            "observed_at": documents["ending_credits"]["observed_at"]})
        signatures = list(episode.get("staff", []))
        for block in episode.get("staff_groups", []):
            common = {key: block[key] for key in ("role", "time", "group", "institutions", "source_ref") if key in block}
            signatures.extend({**common, "organization": name} for name in block.get("organizations", []))
            signatures.extend({**common, "name": name} for name in block.get("names", []))
        affiliations = {}
        for signature in signatures:
            if signature.get("name") and signature.get("institutions"):
                key = (normalized(signature["name"]), role_label(signature["role"]), group_label(signature.get("group", "")))
                affiliations.setdefault(key, {})[tuple(signature["institutions"])] = signature
        for order, signature in enumerate(signatures):
            # Repeated opening and ending credits retain the explicit affiliation for this unit and role.
            if signature.get("name") and not signature.get("institutions"):
                key = (normalized(signature["name"]), role_label(signature["role"]), group_label(signature.get("group", "")))
                declared = affiliations.get(key, {})
                if len(declared) == 1:
                    signature = {**signature, **{key: value for key, value in next(iter(declared.values())).items()
                                                if key in ("institutions", "time")}}
            signature_ref = signature.get("source_ref", ref)
            if not any(source["id"] == signature_ref for source in sources):
                raise ValueError(f"{unit}: unknown credit source {signature_ref}")
            row = {"work_id": work, "source_ref": signature_ref, "order": order,
                   "role": signature["role"], "group": signature.get("group", ""),
                   "name": signature.get("name", signature.get("organization")),
                   "source_time": signature["time"]}
            if work_scope:
                row["edition"] = edition
            else:
                row["unit_id"] = unit
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
                if name in creator_names and ("音乐" in role_label(signature["role"]) or group_label(signature.get("group", "")) == "音乐"):
                    person["creator_id"] = creator_names[name]
                if signature_ref not in person.setdefault("source_refs", []):
                    person["source_refs"].append(signature_ref)
                row["person_id"] = person["id"]
                if signature.get("institutions"):
                    row["institutions"] = signature["institutions"]
            checked_roles = set(role_label(row["role"]).split("／"))
            matches = [c for c in credits if c.get("work_id") == work and
                       ((not work_scope and c.get("unit_id") == unit) or
                        (work_scope and not c.get("unit_id") and
                         (c.get("edition") == edition or edition in c.get("editions", [])))) and
                       set(role_label(c["role"]).split("／")) <= checked_roles and normalized(c["name"]) == normalized(row["name"]) and
                       group_label(c.get("group", "")) == group_label(row["group"])]
            if matches:
                existing = matches[0]
                row["evidence_refs"] = list(dict.fromkeys([signature_ref, *[source for c in matches for source in
                    [c.get("source_ref"), *c.get("evidence_refs", [])] if source]]))
                if row["evidence_refs"] == [signature_ref] and not any(c.get("evidence_refs") for c in matches):
                    row.pop("evidence_refs")
                existing.update(row)
                for key in ("organization", "person_id"):
                    if key not in row:
                        existing.pop(key, None)
                if "institutions" not in row:
                    existing.pop("institutions", None)
                duplicate_ids = {id(c) for c in matches[1:]}
                credits[:] = [c for c in credits if id(c) not in duplicate_ids]
            else:
                credits.append(row)
                added += 1
        if episode.get("staff_status") == "complete":
            # A corrected full roll replaces stale spellings from its own earlier transcription.
            checked_staff = {(role_label(s["role"]), normalized(s.get("name", s.get("organization", ""))),
                              group_label(s.get("group", ""))) for s in signatures}
            checked_sources = {ref, *(s.get("source_ref", ref) for s in signatures)}
            obsolete = [c for c in credits if c.get("unit_id") == unit
                        and not work_scope
                        and (c.get("source_ref", "").startswith("staff-transcript-") or
                             c.get("source_ref") in checked_sources and
                             (role_label(c["role"]), normalized(c["name"]), group_label(c.get("group", "")))
                             not in checked_staff)]
            if obsolete:
                episode.setdefault("superseded_transcript", []).extend(obsolete)
            superseded_staff += len(obsolete)
            if work_scope:
                obsolete = [c for c in credits if c.get("work_id") == work and not c.get("unit_id") and
                            (c.get("edition") == edition or edition in c.get("editions", [])) and
                            (c.get("source_ref", "").startswith("staff-transcript-") or
                             c.get("source_ref") in checked_sources and
                             (role_label(c["role"]), normalized(c["name"]), group_label(c.get("group", ""))) not in checked_staff)]
                superseded_staff += len(obsolete)
            obsolete_rows = {id(c) for c in obsolete}
            credits[:] = [c for c in credits if id(c) not in obsolete_rows]
        checked_cast = set()
        for order, (signature, actor) in enumerate(episode["cast"]):
            if excluded_signature(signature):
                continue
            narrator = signature == "ナレーション"
            if signature == "トレーナー" and work in {"anime-s1", "anime-s2", "anime-s3", "anime-1st-anniversary"}:
                character = next(c for c in characters if c["id"] == "spica_trainer")
            else:
                if narrator:
                    character = None
                else:
                    key = normalized(signature)
                    # A credited costume name follows the explicitly named character.
                    if key not in character_names:
                        key = re.split(r"[（(]", key, maxsplit=1)[0]
                    character = character_names[key]
            voice = voice_names[normalized(actor)]
            target = character["id"] if character else voice["id"]
            checked_cast.add((target, voice["id"]))
            existing = next((r for r in relations if r["source_id"] == (work if work_scope else unit) and
                             r.get("relation_type") == "credited_cast" and
                             ((not work_scope and r.get("source_type") == "anime_unit") or
                              (work_scope and r.get("source_type") == "anime_work" and
                               (r.get("edition") == edition or edition in r.get("editions", []))))
                             and r.get("target_id") == target and r.get("voice_actor_id") == voice["id"]), None)
            if existing:
                existing["evidence_refs"] = list(dict.fromkeys([*existing.get("evidence_refs", []), ref]))
                existing.update(signature=signature, display_order=order)
                if work_scope and not existing.get("editions"):
                    existing["edition"] = edition
            else:
                relations.append({"id": f"{scope_id}-official-ending-cast-{order:02d}",
                                  "source_type": "anime_work" if work_scope else "anime_unit",
                                  "source_id": work if work_scope else unit,
                                  "relation_type": "credited_cast", "target_type": "character" if character else "voice_actor", "target_id": target,
                                  "voice_actor_id": voice["id"], "signature": signature, "display_order": order,
                                  "label": "", "evidence_refs": [ref], **({"edition": edition} if work_scope else {})})
                if narrator:
                    relations[-1].update(label="旁白", role_name="旁白")
        if episode.get("cast_status") == "complete":
            obsolete = [r for r in relations if r["source_id"] == (work if work_scope else unit) and
                        r.get("relation_type") == "credited_cast" and
                        ((not work_scope and r.get("source_type") == "anime_unit") or
                         (work_scope and r.get("source_type") == "anime_work" and
                          (r.get("edition") == edition or edition in r.get("editions", [])))) and
                        (not work_scope or r.get("source_ref", "").startswith("staff-transcript-") or
                         r.get("source_ref") in {ref, *checked_sources} or
                         any(source.startswith("staff-transcript-") or source in {ref, *checked_sources}
                             for source in r.get("evidence_refs", []))) and
                        (r.get("target_id"), r.get("voice_actor_id")) not in checked_cast]
            superseded_cast += len(obsolete)
            obsolete_ids = {r["id"] for r in obsolete}
            relations[:] = [r for r in relations if r["id"] not in obsolete_ids]
        detail = None
        if not work_scope:
            series = next(s for s in documents["units"]["series"] if s["work_id"] == work)
            detail = series.setdefault("details", {}).setdefault(str(episode["number"]), {})
            detail["staff_status"] = episode["staff_status"]
            detail["source_refs"] = list(dict.fromkeys([*detail.get("source_refs", []), ref]))
        for cue in episode.get("music_cues", []):
            usage = cue.get("usage_type") or ("fanfare" if "ファンファーレ" in cue["title"] else "insert")
            relation_source = work if work_scope else unit
            relation_type = "anime_work" if work_scope else "anime_unit"
            if cue.get("song_id"):
                linked = False
                for relation in relations:
                    if relation["source_id"] == relation_source and relation.get("source_type") == relation_type and relation.get("relation_type") == "uses_song" and relation.get("target_id") == cue["song_id"] and (not work_scope or relation.get("edition") == edition):
                        relation.update(usage_type=usage, label="")
                        relation["evidence_refs"] = list(dict.fromkeys([*relation.get("evidence_refs", []), ref]))
                        linked = True
                if not linked:
                    relations.append({"id": f"{scope_id}-ending-cue-{cue['song_id']}-{usage}",
                                      "source_type": relation_type, "source_id": relation_source,
                                      "relation_type": "uses_song", "target_type": "song",
                                      "target_id": cue["song_id"], "usage_type": usage,
                                      "label": "", "evidence_refs": [ref], **({"edition": edition} if work_scope else {})})
            names = cue.get("names", [])
            creator_ids = [creator_names[normalized(name)] for name in names]
            credit = {"role": role_label(cue["role"]), "names": names,
                      "institutions": cue.get("institutions", []), "creator_ids": creator_ids}
            matches = [row for row in detail.get("music_cues", []) if normalized(row["title"]) == normalized(cue["title"])] if detail is not None else []
            if matches:
                for row in matches:
                    row["source_refs"] = list(dict.fromkeys([*row.get("source_refs", []), ref]))
                    row["usage_type"] = usage
                    if cue.get("song_id"):
                        row["song_id"] = cue["song_id"]
                    if credit not in row.setdefault("credits", []):
                        row["credits"].append(credit)
                continue
            if detail is not None:
                detail.setdefault("music_cues", []).append({
                    "title": cue["title"], "usage_type": usage,
                    "credits": [credit],
                    "institutions": [], "source_refs": [ref], "source_time": cue["time"]})
                if cue.get("song_id"):
                    detail["music_cues"][-1]["song_id"] = cue["song_id"]
        # Recording mappings are reviewed explicitly; titles and album order
        # never establish an episode's music use by themselves.
        for usage in episode.get("music_uses", []):
            version = usage["version_id"]
            if versions.get(version) != usage["song_id"]:
                raise ValueError("unknown recording mapping: " + version)
            relation_id = f"{scope_id}-ending-music-{version}"
            relation = {"id": relation_id, "source_type": "anime_work" if work_scope else "anime_unit", "source_id": work if work_scope else unit,
                        "relation_type": "uses_song", "target_type": "song", "target_id": usage["song_id"],
                        "version_id": version, "release_id": usage["release_id"], "version_label": version_labels[version],
                        "usage_type": usage["usage_type"], "label": "", "evidence_refs": [ref], **({"edition": edition} if work_scope else {})}
            existing = next((r for r in relations if r["source_id"] == (work if work_scope else unit) and
                             r.get("source_type") == ("anime_work" if work_scope else "anime_unit") and
                             r.get("relation_type") == "uses_song" and r.get("version_id") == version and
                             r.get("usage_type", usage["usage_type"]) == usage["usage_type"] and
                             (not work_scope or r.get("edition") == edition)), None)
            if existing is None:
                existing = next((r for r in relations if r["source_id"] == (work if work_scope else unit) and
                                 r.get("source_type") == ("anime_work" if work_scope else "anime_unit") and
                                 r.get("relation_type") == "uses_song" and not r.get("version_id") and
                                 r.get("target_id") == usage["song_id"] and
                                 r.get("usage_type") == usage["usage_type"] and
                                 (not work_scope or r.get("edition") == edition)), None)
            if existing:
                existing.update(version_id=version, release_id=usage["release_id"],
                                version_label=version_labels[version], usage_type=usage["usage_type"], label="")
                existing["evidence_refs"] = list(dict.fromkeys([*existing.get("evidence_refs", []), ref]))
            else:
                relations.append(relation)
            source_kind = episode.get("source_kind", "official_ending")
            music = music_doc["versions"].setdefault(version, {"credits": [], "source": source_kind, "manual": True})
            for signature in episode.get("music_signatures", []):
                if signature["title"] != usage["title"]:
                    continue
                roles = {"作詞": ("lyricist",), "作曲": ("composer",), "編曲": ("arranger",),
                         "作詞・作曲": ("lyricist", "composer"),
                         "作曲・編曲": ("composer", "arranger"),
                         "作詞・作曲・編曲": ("lyricist", "composer", "arranger"),
                         "ストリングスアレンジ": ("arranger",)}.get(signature["role"], ())
                if not roles:
                    continue
                for name in signature["names"]:
                    key = normalized(name)
                    creator_id = creator_names.get(key)
                    if not creator_id:
                        creator_id = stable_creator_id(name)
                        creators.append({"id": creator_id, "name": name, "aliases": [], "type": "person", "affiliations": []})
                        creator_names[key] = creator_id
                    for role in roles:
                        credit = next((c for c in music["credits"] if c["role"] == role and normalized(c["name"]) == key), None)
                        if credit is None:
                            credit = {"role": role, "name": name, "creator_id": creator_id}
                            music["credits"].append(credit)
                        if signature.get("institutions"):
                            credit["affiliation"] = signature["institutions"][0]
            source = {"source": source_kind, "source_url": episode["url"]}
            supplements = music.setdefault("supplemental_sources", [])
            for entry in supplements:
                if entry.get("source_url") == episode["url"]:
                    entry["source"] = source_kind
            if source not in supplements:
                supplements.append(source)
        if work_scope and episode.get("staff_status") == "complete":
            checked_music = {(usage.get("song_id"), usage.get("usage_type"))
                             for usage in episode.get("music_uses", [])}
            checked_music.update((cue.get("song_id"), cue.get("usage_type"))
                                 for cue in episode.get("music_cues", []) if cue.get("song_id"))
            obsolete_music = [r for r in relations
                              if r.get("source_type") == "anime_work" and r.get("source_id") == work
                              and r.get("relation_type") == "uses_song" and r.get("edition") == edition
                              and (r.get("target_id"), r.get("usage_type")) not in checked_music
                              and (r.get("source_ref", "").startswith("staff-transcript-") or
                                   r.get("source_ref") in {ref, *checked_sources} or
                                   any(source.startswith("staff-transcript-") or source in {ref, *checked_sources}
                                       for source in r.get("evidence_refs", [])))]
            obsolete_ids = {r["id"] for r in obsolete_music}
            relations[:] = [r for r in relations if r["id"] not in obsolete_ids]
    print("New individually checked ending credits:", added)
    print("Superseded partial staff observations:", superseded_staff)
    print("Superseded cast relations:", superseded_cast)
    if args.write:
        for name in ("ending_credits", "people", "staff", "units", "relations", "source_registry"):
            atomic_json(DATA / (name + ".json"), documents[name])
        atomic_json(ROOT / "data/music/creators.json", creator_doc)
        atomic_json(ROOT / "data/music/credits.json", music_doc)


if __name__ == "__main__":
    main()
