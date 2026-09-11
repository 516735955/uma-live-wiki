#!/usr/bin/env python3
"""Check pedigree source facts, generated fields, and character-only relations."""

import json
import os
import re
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
        if kind not in ("horse", "original", "non_uma"):
            errors.append("invalid mapping kind for %s: %r" % (character_id, kind))
        if horse_id and canonical(horse_id) not in canonical_ids:
            errors.append("mapped horse is missing: %s -> %s" % (
                character_id, horse_id
            ))
        if horse_id is None and kind not in ("original", "non_uma"):
            errors.append("horse mapping missing for %s" % character_id)
        if horse_id is not None and kind != "horse":
            errors.append("horse mapping kind drift for %s" % character_id)

    mapped_horses = {
        canonical(mapping["horse"])
        for mapping in mappings.values()
        if mapping.get("kind") == "horse" and mapping.get("horse")
    }
    breeding_pairs = set()
    breeding_records = 0
    for mare_id in sorted(mapped_horses):
        mare = by_id.get(mare_id) or {}
        if mare.get("sex") != "female":
            continue
        if not mare.get("breeding_source_url"):
            errors.append("mapped mare has no breeding source: %s" % mare_id)
        if "breeding_partners" not in mare:
            errors.append("mapped mare has no breeding review result: %s" % mare_id)
            continue
        seen_partners = set()
        for relation in mare.get("breeding_partners") or []:
            partner_id = canonical(relation.get("horse_id"))
            if not partner_id or partner_id not in mapped_horses:
                errors.append("breeding partner has no character: %s -> %s" % (
                    mare_id, partner_id
                ))
                continue
            if partner_id == mare_id:
                errors.append("self breeding relation: %s" % mare_id)
            if partner_id in seen_partners:
                errors.append("duplicate breeding partner: %s -> %s" % (
                    mare_id, partner_id
                ))
            seen_partners.add(partner_id)
            if (by_id.get(partner_id) or {}).get("sex") != "male":
                errors.append("breeding partner is not male: %s -> %s" % (
                    mare_id, partner_id
                ))
            if not relation.get("source_url"):
                errors.append("breeding relation has no source: %s -> %s" % (
                    mare_id, partner_id
                ))
            pair_records = relation.get("records") or []
            if not pair_records:
                errors.append("breeding relation has no records: %s -> %s" % (
                    mare_id, partner_id
                ))
            seen_years = set()
            for event in pair_records:
                year = event.get("year")
                outcome = event.get("outcome")
                if not isinstance(year, int) or year < mare.get("born", 0):
                    errors.append("invalid breeding year: %s -> %s: %r" % (
                        mare_id, partner_id, year
                    ))
                if year in seen_years:
                    errors.append("duplicate breeding year: %s -> %s: %s" % (
                        mare_id, partner_id, year
                    ))
                seen_years.add(year)
                if outcome not in ("foal", "no_foal"):
                    errors.append("invalid breeding outcome: %s -> %s: %r" % (
                        mare_id, partner_id, outcome
                    ))
            if pair_records != sorted(
                    pair_records, key=lambda event: (event.get("year", 0),
                                                     event.get("outcome", ""))):
                errors.append("unsorted breeding records: %s -> %s" % (
                    mare_id, partner_id
                ))
            breeding_pairs.add(tuple(sorted((mare_id, partner_id))))
            breeding_records += len(pair_records)

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

    for record in records:
        real_name_fields = ("real_name_zh", "real_name", "real_name_en")
        if any(record.get(field) for field in real_name_fields):
            for field in real_name_fields:
                if not record.get(field):
                    errors.append("incomplete real horse identity %s: %s" % (
                        record["id"], field
                    ))

    visual_horses = set()
    for character_id, mapping in mappings.items():
        mapped_horse = mapping.get("horse")
        if not mapped_horse:
            continue
        mapped_horse = canonical(mapped_horse)
        visual_horses.add(mapped_horse)
        runtime = runtime_by_id[character_id]
        for row in runtime.get("up") or []:
            visual_horses.update(canonical(node_id) for node_id in row if node_id)
        relations = runtime.get("character_relations") or {}
        for sibling in relations.get("siblings") or []:
            if sibling.get("horse_id"):
                visual_horses.add(canonical(sibling["horse_id"]))
        for descendant in relations.get("descendants") or []:
            visual_horses.update(
                canonical(node_id) for node_id in (descendant.get("path") or [])
                if node_id
            )
            for link in descendant.get("links") or []:
                if link.get("partner"):
                    visual_horses.add(canonical(link["partner"]))
        for partner in relations.get("partners") or []:
            if partner.get("horse_id"):
                visual_horses.add(canonical(partner["horse_id"]))
        for partner in runtime.get("breeding_partners") or []:
            if partner.get("horse_id"):
                visual_horses.add(canonical(partner["horse_id"]))

    direct_parents = set()
    for node_id in visual_horses:
        pair = parents.get(node_id) or {}
        direct_parents.update(
            parent_id for parent_id in (pair.get("sire"), pair.get("dam"))
            if parent_id
        )
    complete_scope = visual_horses | direct_parents
    foundation_ids = {"darleyarabian", "godolphinbarb", "byerleyturk"}
    japanese_text = re.compile(r"[\u3040-\u30fa\u30fc-\u30ff]")
    latin_text = re.compile(r"[A-Za-z]")
    han_text = re.compile(r"[\u3400-\u9fff]")
    for node_id in sorted(complete_scope):
        record = by_id.get(node_id) or {}
        for field in ("zh", "ja", "en", "sex", "born", "country"):
            if not record.get(field):
                errors.append("incomplete visualization horse %s: %s" % (
                    node_id, field
                ))
        chinese = str(record.get("zh") or "")
        if (not han_text.search(chinese) or latin_text.search(chinese)
                or japanese_text.search(chinese) or "/" in chinese):
            errors.append("non-Chinese visualization label %s: %s" % (
                node_id, chinese
            ))
        if not (
            record.get("metadata_source_url") or record.get("profile_url")
            or (record.get("parents") or {}).get("source_url")
        ):
            errors.append("visualization horse has no source URL: %s" % node_id)
        if node_id in visual_horses and node_id not in foundation_ids:
            pair = parents.get(node_id) or {}
            if not pair.get("sire") or not pair.get("dam"):
                errors.append("visualization horse has incomplete parents: %s" % node_id)
    for field in ("zh", "ja", "en"):
        labels = defaultdict(list)
        for node in records:
            value = str(node.get(field) or "").strip().casefold()
            if value:
                labels[value].append(node)
        duplicate_groups = []
        for group in labels.values():
            if len(group) < 2:
                continue
            if len({canonical(node["id"]) for node in group}) == 1:
                continue
            born = [node.get("born") for node in group]
            if all(born) and len(set(born)) == len(born):
                continue
            if all(
                (mappings.get(node["id"]) or {}).get("kind") == "non_uma"
                for node in group
            ):
                continue
            duplicate_groups.append([node["id"] for node in group])
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
        "%d visual horses, %d sibling links, %d descendant paths, "
        "%d breeding pairs, %d breeding records" % (
            len(records), len(mappings), len(visual_horses), sibling_links,
            descendant_paths, len(breeding_pairs), breeding_records
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
