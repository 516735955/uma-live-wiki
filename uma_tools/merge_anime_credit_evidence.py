"""Merge equivalent signatures from separate sources without merging identities."""

import argparse
import json
from pathlib import Path

from anime_labels import group_label, person_label, role_label
from build_anime_catalog import atomic_json

DATA = Path(__file__).resolve().parents[1] / "data/anime"

# The RTTT episode ending and official master list identify these signatures.
PERSON_ALIASES = {"staff-阿部億人": "staff-阿部憶人", "staff-狭田修": "staff-狹田修"}
# Official credits already identify these names as organizations.
ORGANIZATION_PEOPLE = {"staff-" + name for name in (
    "スノーライトスタッフ", "コスモス・アーツ", "ラッドプラス", "チップチューン",
    "リバイバル", "月面", "寿門堂",
)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    document = json.loads((DATA / "staff.json").read_text(encoding="utf-8"))
    people = json.loads((DATA / "people.json").read_text(encoding="utf-8"))
    by_id = {person["id"]: person for person in people["people"]}
    for alias_id, canonical_id in PERSON_ALIASES.items():
        alias = by_id.get(alias_id)
        if not alias:
            continue
        canonical = by_id[canonical_id]
        canonical["aliases"] = list(dict.fromkeys([*canonical.get("aliases", []), alias["name"], *alias.get("aliases", [])]))
        canonical["alias_ids"] = list(dict.fromkeys([*canonical.get("alias_ids", []), alias_id, *alias.get("alias_ids", [])]))
        canonical["source_refs"] = list(dict.fromkeys([*canonical.get("source_refs", []), *alias.get("source_refs", [])]))
    result, seen = [], {}
    removed_headers = 0
    heading_people = {"staff-フランス語監修", "staff-色指定", "staff-筆文字", "staff-予告編演出"}
    # A standalone heading starts a new role and ends the previous institution.
    active_heading = {}
    for row in document["credits"]:
        if row.get("person_id") in ORGANIZATION_PEOPLE:
            row.pop("person_id")
            row["organization"] = row["name"]
        if (row.get("unit_id") == "anime-cinderella-gray-e13"
                and row.get("person_id") == "staff-森下智美"
                and row["role"] == "第二原画"):
            row["institutions"] = ["スノーライトスタッフ"]
        if row.get("person_id") in PERSON_ALIASES:
            row["person_id"] = PERSON_ALIASES[row["person_id"]]
        scope = (row["source_ref"], row.get("unit_id"))
        if row.get("person_id") in heading_people:
            active_heading[scope] = (row["role"], row["name"])
            removed_headers += 1
            continue
        heading = active_heading.get(scope)
        if heading and row["role"] != heading[0]:
            active_heading.pop(scope)
            heading = None
        if heading:
            row["role"] = heading[1]
            row.pop("institutions", None)
            if heading[1] == "色指定" and row["work_id"] == "anime-s1" and row.get("person_id"):
                row["institutions"] = ["stella road"]
        if (row["source_ref"] == "staff-transcript-anime-s1"
                and ((row.get("person_id") == "staff-LucasNainemoutou"
                      and row.get("unit_id") in {"anime-s1-e09", "anime-s1-e11", "anime-s1-e12"})
                     or (row.get("person_id") == "staff-EmilieBARRIERE"
                         and row.get("unit_id") in {"anime-s1-e15", "anime-s1-e16"}))):
            row["role"] = "フランス語監修"
            row.pop("institutions", None)
        key = (row["work_id"], row.get("unit_id"), row.get("edition"),
               role_label(row["role"]), group_label(row.get("group", "")),
               row.get("person_id") or person_label(row.get("organization") or row["name"]),
               tuple(sorted(row.get("institutions", []))))
        previous = seen.get(key)
        if previous is None or previous["source_ref"] == row["source_ref"]:
            result.append(row)
            seen[key] = row
        else:
            previous["evidence_refs"] = list(dict.fromkeys(
                [previous["source_ref"], *previous.get("evidence_refs", []),
                 row["source_ref"], *row.get("evidence_refs", [])]))
    people["people"] = [p for p in people["people"] if p["id"] not in heading_people
                        and p["id"] not in PERSON_ALIASES and p["id"] not in ORGANIZATION_PEOPLE]
    print("Merged repeated source observations:", len(document["credits"]) - len(result) - removed_headers)
    print("Removed non-person headings:", removed_headers)
    document["credits"] = result
    if args.write:
        atomic_json(DATA / "staff.json", document)
        atomic_json(DATA / "people.json", people)


if __name__ == "__main__":
    main()
