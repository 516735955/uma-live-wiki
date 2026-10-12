"""Import individually documented broadcast credits, preserving raw signatures."""

import argparse
import json
import re
from pathlib import Path

from build_anime_catalog import atomic_json
from character_scope import excluded_signature
from anime_labels import person_name_key

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/anime"


normalized = person_name_key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    snapshot = json.loads((DATA / "episode_cast.json").read_text(encoding="utf-8"))
    endings = json.loads((DATA / "ending_credits.json").read_text(encoding="utf-8"))
    checked_units = {f"{e['work_id']}-e{e['number']:02d}" for e in endings["episodes"]
                     if e.get("cast_status") == "complete"}
    characters = json.loads((ROOT / "data/character_index_data.js").read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
    voice_document = json.loads((ROOT / "data/voice_actor_profiles.json").read_text(encoding="utf-8"))
    voices = voice_document["voice_actors"]
    character_names = {normalized(name): character for character in characters for name in [character["ja"], *character.get("aliases", [])]}
    voice_names = {normalized(name): voice for voice in voices for name in [voice["identity"]["ja"], *voice["identity"].get("aliases", [])]}
    voice_names[normalized("高橋未奈美")] = next(voice for voice in voices if voice["id"] == "va-0180")
    character_names.update({normalized(name): next(character for character in characters if character["id"] == cid) for name, cid in {
        "沖田トレーナー": "narita_trainer", "ウィニングチケット": "winningticket",
        "乙名史悦子記者": "otonashietsuko", "秋川やよい理事長": "akikawayayoi",
    }.items()})
    relations_doc = json.loads((DATA / "relations.json").read_text(encoding="utf-8"))
    relations = relations_doc["relations"]
    source_doc = json.loads((DATA / "source_registry.json").read_text(encoding="utf-8"))
    source_ids = {source["id"] for source in source_doc["sources"]}
    existing = {(relation["source_id"], relation.get("signature"), relation.get("voice_actor_id")) for relation in relations if relation.get("relation_type") == "credited_cast"}
    imported = 0
    unresolved = {}
    for episode in snapshot["episodes"]:
        unit = f"{episode['work']}-e{episode['number']:02d}"
        if unit in checked_units:
            continue
        source_id = "broadcast-cast-" + unit
        if not episode["cast"]:
            raise ValueError("empty episode transcription: " + unit)
        if source_id not in source_ids:
            source_doc["sources"].append({"id": source_id, "kind": "credit_transcription", "label": "单集播出署名转录", "url": episode["url"], "observed_at": snapshot["observed_at"]})
            source_ids.add(source_id)
        for order, (signature, actor) in enumerate(episode["cast"]):
            if excluded_signature(signature):
                continue
            name = normalized(signature)
            character = character_names.get(name)
            if name == "トレーナー" and episode["work"] in {"anime-s1", "anime-s2", "anime-s3"}:
                character = next(c for c in characters if c["id"] == "spica_trainer")
            # Costume aliases retain their exact credited signature. They do
            # not create a second identity for the same character.
            if episode["work"] == "anime-umayon" and "(" in name:
                character = character_names.get(name.split("(", 1)[0])
            narrator = name == "ナレーション"
            if character is None and not narrator:
                unresolved.setdefault(signature, set()).add(episode["work"])
                continue
            voice = voice_names.get(normalized(actor))
            if voice is None:
                raise ValueError(f"unresolved voice actor: {unit}: {signature}: {actor}")
            key = (unit, signature, voice["id"])
            if key in existing:
                continue
            same = next((r for r in relations if r["source_id"] == unit and r.get("relation_type") == "credited_cast" and r.get("voice_actor_id") == voice["id"] and r.get("target_id") == (character["id"] if character else voice["id"])), None)
            if same:
                same.setdefault("evidence_refs", []).append(source_id)
                same["evidence_refs"] = list(dict.fromkeys(same["evidence_refs"]))
                same.setdefault("signature", signature)
                continue
            relation = {"id": f"{unit}-broadcast-cast-{order:02d}", "source_type": "anime_unit", "source_id": unit,
                        "relation_type": "credited_cast", "target_type": "character" if character else "voice_actor",
                        "target_id": character["id"] if character else voice["id"], "voice_actor_id": voice["id"],
                        "signature": signature, "label": "", "display_order": order, "evidence_refs": [source_id]}
            if narrator:
                relation.update(label="旁白", role_name="旁白")
            relations.append(relation)
            existing.add(key)
            imported += 1
            if character and not any(role.get("character_id") == character["id"] for role in voice.get("roles", [])):
                voice.setdefault("roles", []).append({"character_id": character["id"], "name": character["zh"], "name_ja": character["ja"], "former": False,
                                                     "image": character["img"], "color_main": character["main"], "color_sub": character["sub"]})
    print(f"Episode transcriptions: {len(snapshot['episodes'])}; new verified identity relations: {imported}")
    print("Unmatched signatures (not imported): " + ", ".join(sorted(unresolved)))
    if args.write:
        atomic_json(DATA / "relations.json", relations_doc)
        atomic_json(DATA / "source_registry.json", source_doc)
        atomic_json(ROOT / "data/voice_actor_profiles.json", voice_document)


if __name__ == "__main__":
    main()
