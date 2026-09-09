#!/usr/bin/env python3
"""Check pedigree source facts, generated fields, and character-only relations."""

import json
import os
import sys
from collections import Counter, defaultdict

import build_pedigree


def main():
    source = build_pedigree.load_source()
    characters = build_pedigree.load_characters()
    records, by_id = build_pedigree.source_index(source)
    canonical = build_pedigree.make_canonicalizer(by_id)
    parents, parent_sources = build_pedigree.normalized_parentage(source)
    mappings = source.get("character_mappings") or {}
    errors = []
    warnings = []

    source_ids = set(by_id)
    canonical_ids = {
        node_id for node_id, record in by_id.items() if not record.get("alias_of")
    }
    character_ids = [character.get("id") for character in characters]
    character_id_set = set(character_ids)

    if set(mappings) != character_id_set:
        for missing in sorted(character_id_set - set(mappings)):
            errors.append("character mapping missing: %s" % missing)
        for extra in sorted(set(mappings) - character_id_set):
            errors.append("mapping has no character page: %s" % extra)

    for character_id, mapping in mappings.items():
        horse_id = mapping.get("horse")
        kind = mapping.get("kind")
        if kind not in ("namesake", "fan_consensus", "original", "non_uma"):
            errors.append("invalid mapping kind for %s: %r" % (character_id, kind))
        if horse_id and canonical(horse_id) not in canonical_ids:
            errors.append("mapped horse is missing: %s -> %s" % (
                character_id, horse_id
            ))
        if horse_id is None and kind not in ("original", "non_uma"):
            errors.append("horse mapping missing for %s" % character_id)

    role_usage = defaultdict(set)
    for node_id, pair in parents.items():
        sire = pair.get("sire")
        dam = pair.get("dam")
        if sire and sire not in canonical_ids:
            errors.append("missing sire: %s <- %s" % (node_id, sire))
        if dam and dam not in canonical_ids:
            errors.append("missing dam: %s <- %s" % (node_id, dam))
        if sire == node_id or dam == node_id:
            errors.append("self parent: %s" % node_id)
        if sire and sire == dam:
            errors.append("same sire and dam: %s" % node_id)
        if sire:
            role_usage[sire].add("sire")
        if dam:
            role_usage[dam].add("dam")
        parentage = by_id[node_id].get("parents") or {}
        source_id = parentage.get("source")
        if (sire or dam) and source_id not in (source.get("sources") or {}):
            errors.append("missing parentage source: %s" % node_id)

    for parent_id, roles in role_usage.items():
        if len(roles) > 1:
            errors.append("horse used as both sire and dam: %s" % parent_id)

    state = {}

    def visit(node_id, trail):
        if state.get(node_id) == 2:
            return
        if state.get(node_id) == 1:
            start = trail.index(node_id) if node_id in trail else 0
            errors.append("parent cycle: %s" % " -> ".join(
                trail[start:] + [node_id]
            ))
            return
        state[node_id] = 1
        pair = parents.get(node_id) or {}
        for parent_id in (pair.get("sire"), pair.get("dam")):
            if parent_id in parents:
                visit(parent_id, trail + [node_id])
        state[node_id] = 2

    for node_id in canonical_ids:
        visit(node_id, [])

    expected = build_pedigree.build_export(source, characters)
    actual = build_pedigree.load_wrapped_json(
        build_pedigree.EXPORT_PATH, build_pedigree.EXPORT_PREFIX
    )
    if actual != expected:
        errors.append("pedigree_data.js is stale; run build_pedigree.py")

    runtime_ids = [node.get("cid") for node in actual]
    runtime_by_id = {node.get("cid"): node for node in actual}
    runtime_counts = Counter(runtime_ids)
    for node_id, count in runtime_counts.items():
        if not node_id:
            errors.append("runtime node without cid")
        elif count > 1:
            errors.append("duplicate runtime cid: %s" % node_id)
    if set(runtime_ids) != source_ids:
        errors.append("runtime/source node sets differ")
    for character_id in character_ids:
        if character_id not in runtime_by_id:
            errors.append("character has no runtime pedigree node: %s" % character_id)

    for node in actual:
        node_id = node.get("cid")
        if [len(row) for row in (node.get("up") or [])] != [2, 4, 8]:
            errors.append("invalid ancestor rows: %s" % node_id)
        horse_id = node.get("horse_id")
        pair = node.get("parents") or {}
        if horse_id and horse_id in parents and pair != parents[horse_id]:
            errors.append("runtime parent roles drift: %s" % node_id)
        avatar = node.get("av")
        if avatar and not str(avatar).startswith(("http://", "https://", "data:")):
            local = str(avatar).lstrip("/").replace("/", os.sep)
            if not os.path.isfile(os.path.join(build_pedigree.ROOT, local)):
                errors.append("missing avatar for %s: %s" % (node_id, avatar))

        relations = node.get("character_relations")
        if relations is None:
            continue
        for sibling in relations.get("siblings") or []:
            sibling_id = sibling.get("cid")
            if sibling_id not in character_id_set:
                errors.append("non-character sibling on %s: %s" % (
                    node_id, sibling_id
                ))
                continue
            sibling_horse = canonical((mappings.get(sibling_id) or {}).get("horse"))
            own_pair = parents.get(horse_id) or {}
            sibling_pair = parents.get(sibling_horse) or {}
            shared = []
            if own_pair.get("sire") and own_pair.get("sire") == sibling_pair.get("sire"):
                shared.append(own_pair["sire"])
            if own_pair.get("dam") and own_pair.get("dam") == sibling_pair.get("dam"):
                shared.append(own_pair["dam"])
            expected_relation = (
                "full" if len(shared) == 2
                else "same_sire" if shared and shared[0] == own_pair.get("sire")
                else "same_dam" if shared
                else None
            )
            if not expected_relation:
                errors.append("unrelated character listed as sibling on %s: %s" % (
                    node_id, sibling_id
                ))
            elif sibling.get("relation") != expected_relation:
                errors.append("invalid sibling relation on %s" % node_id)
            if sibling.get("horse_id") != sibling_horse:
                errors.append("sibling horse mapping drift on %s: %s" % (
                    node_id, sibling_id
                ))
            if sibling.get("shared_parents") != shared:
                errors.append("sibling shared parents drift on %s: %s" % (
                    node_id, sibling_id
                ))
        for descendant in relations.get("descendants") or []:
            generation = descendant.get("generation")
            path = descendant.get("path") or []
            descendant_id = descendant.get("cid")
            if descendant_id not in character_id_set:
                errors.append("non-character descendant on %s" % node_id)
                continue
            if generation not in (1, 2) or len(path) != generation + 1:
                errors.append("invalid descendant path on %s" % node_id)
            if path and path[0] != horse_id:
                errors.append("descendant path starts at wrong horse: %s" % node_id)
            descendant_horse = canonical(
                (mappings.get(descendant_id) or {}).get("horse")
            )
            if descendant.get("horse_id") != descendant_horse:
                errors.append("descendant horse mapping drift on %s: %s" % (
                    node_id, descendant_id
                ))
            if path and path[-1] != descendant_horse:
                errors.append("descendant path ends at wrong horse on %s: %s" % (
                    node_id, descendant_id
                ))
            links = descendant.get("links") or []
            if len(links) != generation:
                errors.append("descendant links drift on %s" % node_id)
            for link_index, link in enumerate(links):
                if link_index + 1 >= len(path):
                    continue
                try:
                    expected_link = build_pedigree.relationship_link(
                        path[link_index], path[link_index + 1],
                        parents, parent_sources
                    )
                except ValueError:
                    errors.append("broken descendant edge on %s: %s" % (
                        node_id, descendant_id
                    ))
                    continue
                if link != expected_link:
                    errors.append("descendant edge metadata drift on %s: %s" % (
                        node_id, descendant_id
                    ))

        expected_partners = {}
        for descendant in relations.get("descendants") or []:
            links = descendant.get("links") or []
            if not links or not links[0].get("partner"):
                continue
            partner_id = links[0]["partner"]
            partner = expected_partners.setdefault(
                partner_id, {"horse_id": partner_id, "via": []}
            )
            partner_characters = [
                character_id for character_id in character_ids
                if canonical((mappings.get(character_id) or {}).get("horse")) == partner_id
            ]
            if partner_characters:
                partner["cid"] = partner_characters[0]
            via = links[0].get("child")
            if via not in partner["via"]:
                partner["via"].append(via)
        if (relations.get("partners") or []) != list(expected_partners.values()):
            errors.append("partner scope drift on %s" % node_id)

    for field in ("zh", "ja", "en"):
        labels = defaultdict(list)
        for node in records:
            value = str(node.get(field) or "").strip().casefold()
            if value:
                labels[value].append(node["id"])
        duplicate_groups = [ids for ids in labels.values() if len(ids) > 1]
        if duplicate_groups:
            warnings.append("%s duplicate label groups: %d" % (
                field, len(duplicate_groups)
            ))

    if warnings:
        print("warnings:")
        for warning in warnings:
            print("  - " + warning)
    if errors:
        print("errors:")
        for error in errors:
            print("  - " + error)
        return 1

    relation_nodes = [node for node in actual if node.get("character_relations")]
    sibling_links = sum(
        len(node["character_relations"]["siblings"]) for node in relation_nodes
    )
    descendant_paths = sum(
        len(node["character_relations"]["descendants"]) for node in relation_nodes
    )
    print(
        "pedigree integrity ok: %d source nodes, %d character mappings, "
        "%d sibling links, %d descendant paths" % (
            len(records), len(mappings), sibling_links, descendant_paths
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
