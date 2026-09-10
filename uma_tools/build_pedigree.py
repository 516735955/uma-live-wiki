#!/usr/bin/env python3
"""Build the browser pedigree export from its maintainable source data."""

import argparse
import json
import os
import tempfile
from collections import defaultdict


TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
SOURCE_PATH = os.path.join(ROOT, "data", "pedigree_source.json")
CHARACTER_PATH = os.path.join(ROOT, "data", "character_index_data.js")
EXPORT_PATH = os.path.join(ROOT, "data", "pedigree_data.js")
CHARACTER_PREFIX = "window.CHAR_INDEX = "
EXPORT_PREFIX = "window.PED_REL = "


def load_wrapped_json(path, prefix):
    with open(path, encoding="utf-8") as handle:
        raw = handle.read().strip()
    if not raw.startswith(prefix) or not raw.endswith(";"):
        raise ValueError("unexpected JavaScript data wrapper: %s" % path)
    return json.loads(raw[len(prefix):-1])


def load_source(path=SOURCE_PATH):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_characters(path=CHARACTER_PATH):
    return load_wrapped_json(path, CHARACTER_PREFIX)


def source_index(source):
    records = source.get("nodes") or []
    by_id = {}
    for record in records:
        node_id = record.get("id")
        if not node_id or node_id in by_id:
            raise ValueError("missing or duplicate pedigree source id: %r" % node_id)
        by_id[node_id] = record
    return records, by_id


def make_canonicalizer(by_id):
    def canonical(node_id):
        seen = set()
        while node_id in by_id and by_id[node_id].get("alias_of"):
            if node_id in seen:
                raise ValueError("pedigree alias cycle involving %s" % node_id)
            seen.add(node_id)
            node_id = by_id[node_id]["alias_of"]
        return node_id

    return canonical


def normalized_parentage(source):
    records, by_id = source_index(source)
    canonical = make_canonicalizer(by_id)
    parents = {}
    parent_sources = {}
    for record in records:
        if record.get("alias_of"):
            continue
        node_id = record["id"]
        parentage = record.get("parents") or {}
        sire = parentage.get("sire")
        dam = parentage.get("dam")
        parents[node_id] = {
            "sire": canonical(sire) if sire else None,
            "dam": canonical(dam) if dam else None,
        }
        if parentage.get("source"):
            parent_sources[node_id] = parentage["source"]
    return parents, parent_sources


def ancestor_row(parent_ids, parents):
    result = []
    for parent_id in parent_ids:
        pair = parents.get(parent_id, {}) if parent_id else {}
        result.extend([pair.get("sire"), pair.get("dam")])
    return result


def relationship_link(parent_id, child_id, parents, parent_sources):
    pair = parents.get(child_id) or {}
    if pair.get("sire") == parent_id:
        role = "sire"
        partner = pair.get("dam")
    elif pair.get("dam") == parent_id:
        role = "dam"
        partner = pair.get("sire")
    else:
        raise ValueError("%s is not a parent of %s" % (parent_id, child_id))
    link = {"parent": parent_id, "child": child_id, "role": role}
    if partner:
        link["partner"] = partner
    if parent_sources.get(child_id):
        link["source"] = parent_sources[child_id]
    return link


def character_relationships(character_id, horse_id, character_mappings, parents,
                            children, parent_sources, character_order):
    horse_to_characters = defaultdict(list)
    for other_id in character_order:
        mapping = character_mappings[other_id]
        other_horse = mapping.get("horse")
        if other_horse:
            horse_to_characters[other_horse].append(other_id)

    own = parents.get(horse_id) or {}
    siblings = []
    for other_id in character_order:
        if other_id == character_id:
            continue
        other_horse = character_mappings[other_id].get("horse")
        if not other_horse or other_horse == horse_id:
            continue
        pair = parents.get(other_horse) or {}
        same_sire = bool(own.get("sire") and own.get("sire") == pair.get("sire"))
        same_dam = bool(own.get("dam") and own.get("dam") == pair.get("dam"))
        if not same_sire and not same_dam:
            continue
        if same_sire and same_dam:
            relation = "full"
            shared = [own["sire"], own["dam"]]
        elif same_sire:
            relation = "same_sire"
            shared = [own["sire"]]
        else:
            relation = "same_dam"
            shared = [own["dam"]]
        siblings.append({
            "cid": other_id,
            "horse_id": other_horse,
            "relation": relation,
            "shared_parents": shared,
        })

    descendants = []
    direct_children = children.get(horse_id, [])
    for child_id in direct_children:
        for child_character in horse_to_characters.get(child_id, []):
            descendants.append({
                "cid": child_character,
                "horse_id": child_id,
                "generation": 1,
                "path": [horse_id, child_id],
                "links": [relationship_link(
                    horse_id, child_id, parents, parent_sources
                )],
            })
        for grandchild_id in children.get(child_id, []):
            for grandchild_character in horse_to_characters.get(grandchild_id, []):
                descendants.append({
                    "cid": grandchild_character,
                    "horse_id": grandchild_id,
                    "generation": 2,
                    "path": [horse_id, child_id, grandchild_id],
                    "links": [
                        relationship_link(horse_id, child_id, parents, parent_sources),
                        relationship_link(child_id, grandchild_id, parents, parent_sources),
                    ],
                })

    partners_by_horse = {}
    for descendant in descendants:
        first_link = descendant["links"][0]
        partner_id = first_link.get("partner")
        if not partner_id:
            continue
        partner = partners_by_horse.setdefault(partner_id, {
            "horse_id": partner_id,
            "via": [],
        })
        linked_characters = horse_to_characters.get(partner_id, [])
        if linked_characters:
            partner["cid"] = linked_characters[0]
        via = first_link["child"]
        if via not in partner["via"]:
            partner["via"].append(via)

    return {
        "siblings": siblings,
        "descendants": descendants,
        "partners": list(partners_by_horse.values()),
    }


def build_export(source, characters):
    records, by_id = source_index(source)
    canonical = make_canonicalizer(by_id)
    parents, parent_sources = normalized_parentage(source)
    mappings = source.get("character_mappings") or {}
    normalized_mappings = {}
    for character_id, mapping in mappings.items():
        normalized = dict(mapping)
        if normalized.get("horse"):
            normalized["horse"] = canonical(normalized["horse"])
        normalized_mappings[character_id] = normalized
    character_order = [character["id"] for character in characters]

    children = defaultdict(list)
    for child_id, pair in parents.items():
        for parent_id in (pair.get("sire"), pair.get("dam")):
            if parent_id and child_id not in children[parent_id]:
                children[parent_id].append(child_id)

    horse_to_characters = defaultdict(list)
    for character_id in character_order:
        horse_id = (normalized_mappings.get(character_id) or {}).get("horse")
        if horse_id:
            horse_to_characters[canonical(horse_id)].append(character_id)

    def compatible_descendant_id(horse_id):
        linked_characters = horse_to_characters.get(canonical(horse_id), [])
        return linked_characters[0] if linked_characters else horse_id

    output = []
    for record in records:
        runtime_id = record["id"]
        horse_id = canonical(runtime_id)
        target = by_id.get(horse_id) or {}
        display = dict(target)
        display.update(record)
        pair = parents.get(horse_id) or {"sire": None, "dam": None}
        row0 = [pair.get("sire"), pair.get("dam")]
        row1 = ancestor_row(row0, parents)
        row2 = ancestor_row(row1, parents)
        direct_children = [
            compatible_descendant_id(child_id)
            for child_id in children.get(horse_id, [])
        ]
        grandchildren = []
        for child_id in children.get(horse_id, []):
            for grandchild_id in children.get(child_id, []):
                display_id = compatible_descendant_id(grandchild_id)
                if display_id not in grandchildren:
                    grandchildren.append(display_id)

        node = {
            "cid": runtime_id,
            "zh": display.get("zh", ""),
            "ja": display.get("ja", ""),
            "en": display.get("en", ""),
            "av": display.get("avatar"),
            "up": [row0, row1, row2],
            "children": direct_children,
            "grandchildren": grandchildren,
            "horse_id": horse_id,
            "parents": {"sire": row0[0], "dam": row0[1]},
        }
        if display.get("pure"):
            node["pure"] = True
        if display.get("real_name"):
            node["real"] = display["real_name"]
        if display.get("real_name_en"):
            node["real_en"] = display["real_name_en"]
        if target.get("country"):
            node["country"] = target["country"]
        if target.get("born"):
            node["born"] = target["born"]
        if parent_sources.get(horse_id):
            node["parentage_source"] = parent_sources[horse_id]
        source_url = (target.get("parents") or {}).get("source_url")
        if source_url:
            node["parentage_source_url"] = source_url
        if target.get("profile_url"):
            node["profile_url"] = target["profile_url"]
        if target.get("metadata_source_url"):
            node["metadata_source_url"] = target["metadata_source_url"]
        if target.get("sex"):
            node["sex"] = target["sex"]
        if target.get("breeding_partners"):
            node["breeding_partners"] = [
                dict(partner, horse_id=canonical(partner["horse_id"]))
                for partner in target["breeding_partners"]
            ]
        if record.get("alias_of"):
            node["alias_of"] = horse_id
        if horse_to_characters.get(horse_id):
            node["character_id"] = horse_to_characters[horse_id][0]

        mapping = normalized_mappings.get(runtime_id)
        if mapping is not None:
            node["character_id"] = runtime_id
            node["mapping_kind"] = mapping.get("kind")
            if mapping.get("horse"):
                mapped_horse = canonical(mapping["horse"])
                node["horse_id"] = mapped_horse
                node["character_relations"] = character_relationships(
                    runtime_id,
                    mapped_horse,
                    normalized_mappings,
                    parents,
                    children,
                    parent_sources,
                    character_order,
                )
            else:
                node["horse_id"] = None
                node["character_relations"] = {
                    "siblings": [], "descendants": [], "partners": []
                }
        output.append(node)
    return output


def serialize_export(nodes):
    return EXPORT_PREFIX + json.dumps(
        nodes, ensure_ascii=False, separators=(",", ":")
    ) + ";\n"


def atomic_write(path, content):
    directory = os.path.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix=".pedigree-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the checked-in browser export is not current",
    )
    args = parser.parse_args()
    output = serialize_export(build_export(load_source(), load_characters()))
    if args.check:
        with open(EXPORT_PATH, encoding="utf-8") as handle:
            current = handle.read()
        if current != output:
            raise SystemExit("pedigree_data.js is stale; run build_pedigree.py")
        print("pedigree export is current")
        return
    atomic_write(EXPORT_PATH, output)
    print("wrote %s" % os.path.relpath(EXPORT_PATH, ROOT))


if __name__ == "__main__":
    main()
