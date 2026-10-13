"""Merge accepted identity aliases and equivalent credit observations."""

import argparse
import json
from pathlib import Path

from anime_labels import group_label, person_label, role_key
from build_anime_catalog import atomic_json

DATA = Path(__file__).resolve().parents[1] / "data/anime"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    document = json.loads((DATA / "staff.json").read_text(encoding="utf-8"))
    people = json.loads((DATA / "people.json").read_text(encoding="utf-8"))
    by_id = {person["id"]: person for person in people["people"]}
    # Canonical people are the sole identity authority. Historical IDs are
    # retained in alias_ids and never recreated as active people.
    canonical_ids = {person["id"]: person["id"] for person in people["people"]}
    for person in people["people"]:
        for alias_id in person.get("alias_ids", []):
            canonical_ids[alias_id] = person["id"]
    result, seen = [], {}
    for row in document["credits"]:
        if row.get("person_id") in canonical_ids:
            row["person_id"] = canonical_ids[row["person_id"]]
        key = (row["work_id"], row.get("unit_id"), row.get("edition"),
               role_key(row["role"], row.get("group", "")), group_label(row.get("group", "")),
               row.get("person_id") or person_label(row.get("organization") or row["name"]))
        institutions = set(row.get("institutions", []))
        candidates = [previous for previous in seen.get(key, [])
                      if row["source_ref"] not in [previous["source_ref"], *previous.get("evidence_refs", [])]
                      and (not institutions or not previous.get("institutions")
                           or institutions == set(previous["institutions"]))]
        # An unreported institution can supplement one matching signature;
        # conflicting institutions and repeated signatures in one source remain separate.
        if len(candidates) != 1:
            result.append(row)
            seen.setdefault(key, []).append(row)
        else:
            previous = candidates[0]
            if institutions and not previous.get("institutions"):
                previous["institutions"] = row["institutions"]
            previous["evidence_refs"] = list(dict.fromkeys(
                [previous["source_ref"], *previous.get("evidence_refs", []),
                 row["source_ref"], *row.get("evidence_refs", [])]))
    retired_ids = {alias_id for alias_id in canonical_ids
                   if alias_id in by_id and canonical_ids[alias_id] != alias_id}
    people["people"] = [p for p in people["people"] if p["id"] not in retired_ids]
    print("Merged repeated source observations:", len(document["credits"]) - len(result))
    document["credits"] = result
    if args.write:
        atomic_json(DATA / "staff.json", document)
        atomic_json(DATA / "people.json", people)


if __name__ == "__main__":
    main()
