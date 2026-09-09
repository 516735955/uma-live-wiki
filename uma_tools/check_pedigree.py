#!/usr/bin/env python3
"""Run focused integrity checks against the generated pedigree data."""

import json
import os
import sys
from collections import Counter, defaultdict


TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
DATA_PATH = os.path.join(ROOT, "data", "pedigree_data.js")
REPAIRS_PATH = os.path.join(TOOLS_DIR, "pedigree_repairs.json")
PREFIX = "window.PED_REL = "


def load_export():
    raw = open(DATA_PATH, encoding="utf-8").read().strip()
    if not raw.startswith(PREFIX) or not raw.endswith(";"):
        raise ValueError("unexpected pedigree_data.js wrapper")
    return json.loads(raw[len(PREFIX):-1])


def main():
    nodes = load_export()
    repairs = json.load(open(REPAIRS_PATH, encoding="utf-8"))
    aliases = repairs.get("aliases", {})
    errors = []
    warnings = []

    def canonical(cid):
        seen = set()
        while cid in aliases:
            if cid in seen:
                errors.append("alias cycle: %s" % cid)
                break
            seen.add(cid)
            cid = aliases[cid]
        return cid

    ids = [node.get("cid") for node in nodes]
    counts = Counter(ids)
    for cid, count in counts.items():
        if not cid:
            errors.append("node without cid")
        elif count > 1:
            errors.append("duplicate cid: %s" % cid)
    by_cid = {node["cid"]: node for node in nodes if node.get("cid")}

    canonical_children = defaultdict(list)
    alias_ids = {cid for cid in by_cid if canonical(cid) != cid}
    for cid, node in by_cid.items():
        up = node.get("up")
        if not isinstance(up, list) or [len(row) for row in up] != [2, 4, 8]:
            errors.append("invalid ancestor row shape: %s" % cid)
            continue
        direct = [ref for ref in up[0] if ref]
        if len(direct) != len(set(direct)):
            errors.append("duplicate direct parent: %s" % cid)
        for ref in direct:
            if ref == cid:
                errors.append("self parent: %s" % cid)
            if ref not in by_cid:
                errors.append("missing parent %s -> %s" % (cid, ref))
        if cid not in alias_ids:
            for parent_id in direct:
                if cid not in canonical_children[parent_id]:
                    canonical_children[parent_id].append(cid)

        avatar = node.get("av")
        if avatar and not str(avatar).startswith(("http://", "https://", "data:")):
            local = str(avatar).lstrip("/").replace("/", os.sep)
            if not os.path.isfile(os.path.join(ROOT, local)):
                errors.append("missing avatar for %s: %s" % (cid, avatar))

    expected_children = {}
    for cid in by_cid:
        expected_children[cid] = list(canonical_children.get(canonical(cid), []))
    for cid, node in by_cid.items():
        actual_children = node.get("children") or []
        if actual_children != expected_children[cid]:
            errors.append("children drift: %s" % cid)
        expected_grandchildren = []
        for child_id in expected_children[cid]:
            for grandchild_id in expected_children.get(child_id, []):
                if grandchild_id not in expected_grandchildren:
                    expected_grandchildren.append(grandchild_id)
        if (node.get("grandchildren") or []) != expected_grandchildren:
            errors.append("grandchildren drift: %s" % cid)

    state = {}

    def visit(cid, trail):
        if state.get(cid) == 2:
            return
        if state.get(cid) == 1:
            start = trail.index(cid) if cid in trail else 0
            errors.append("parent cycle: %s" % " -> ".join(trail[start:] + [cid]))
            return
        state[cid] = 1
        for parent_id in (by_cid[cid].get("up") or [[]])[0]:
            if parent_id and parent_id in by_cid:
                visit(parent_id, trail + [cid])
        state[cid] = 2

    for cid in by_cid:
        visit(cid, [])

    for field in ("zh", "ja", "en"):
        labels = defaultdict(list)
        for node in nodes:
            value = str(node.get(field) or "").strip().casefold()
            if value:
                labels[value].append(node["cid"])
        duplicate_groups = [group for group in labels.values() if len(group) > 1]
        if duplicate_groups:
            warnings.append("%s duplicate label groups: %d" % (field, len(duplicate_groups)))

    if warnings:
        print("warnings:")
        for warning in warnings:
            print("  - " + warning)
    if errors:
        print("errors:")
        for error in errors:
            print("  - " + error)
        return 1
    print("pedigree integrity ok: %d nodes, %d direct relationships" % (
        len(nodes),
        sum(1 for node in nodes for ref in node["up"][0] if ref),
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
