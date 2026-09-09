#!/usr/bin/env python3
"""Repair the pedigree export and rebuild its derived relationship fields.

The browser still receives the existing ``window.PED_REL`` array. This script
only makes its first parent row authoritative, then derives the remaining
ancestor rows, children, and grandchildren from those direct relationships.
"""

import json
import os
import tempfile
from collections import defaultdict


TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
DATA_PATH = os.path.join(ROOT, "data", "pedigree_data.js")
REPAIRS_PATH = os.path.join(TOOLS_DIR, "pedigree_repairs.json")
PREFIX = "window.PED_REL = "


def load_export(path):
    raw = open(path, encoding="utf-8").read().strip()
    if not raw.startswith(PREFIX) or not raw.endswith(";"):
        raise ValueError("unexpected pedigree_data.js wrapper")
    return json.loads(raw[len(PREFIX):-1])


def canonicalizer(aliases):
    def canonical(cid):
        seen = set()
        while cid in aliases:
            if cid in seen:
                raise ValueError("alias cycle involving %s" % cid)
            seen.add(cid)
            cid = aliases[cid]
        return cid

    return canonical


def unique_refs(refs, canonical, own_cid=None):
    result = []
    for ref in refs or []:
        if not ref:
            continue
        ref = canonical(ref)
        if ref == own_cid or ref in result:
            continue
        result.append(ref)
    return result


def ancestor_row(parent_ids, parents):
    result = []
    for parent_id in parent_ids:
        if parent_id:
            direct = list(parents.get(parent_id, []))[:2]
            result.extend(direct + [None] * (2 - len(direct)))
        else:
            result.extend([None, None])
    return result


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
    nodes = load_export(DATA_PATH)
    repairs = json.load(open(REPAIRS_PATH, encoding="utf-8"))
    aliases = repairs.get("aliases", {})
    canonical = canonicalizer(aliases)

    by_cid = {}
    ordered_ids = []
    for node in nodes:
        cid = node.get("cid")
        if not cid or cid in by_cid:
            raise ValueError("missing or duplicate cid: %r" % cid)
        by_cid[cid] = node
        ordered_ids.append(cid)

    for cid, label in repairs.get("new_nodes", {}).items():
        if cid in by_cid:
            continue
        node = {"cid": cid, "zh": label, "ja": "", "en": label, "av": None}
        by_cid[cid] = node
        ordered_ids.append(cid)

    known_ids = set(by_cid)
    for alias, target in aliases.items():
        if alias in known_ids and canonical(target) not in known_ids:
            raise ValueError("alias target is missing: %s -> %s" % (alias, target))

    # Preserve the old reverse links long enough to recover direct parents that
    # were present only in a parent's children list.
    inverse_children = defaultdict(list)
    for node in nodes:
        parent_id = canonical(node["cid"])
        for child_id in node.get("children", []):
            child_id = canonical(child_id)
            if child_id in known_ids and child_id != parent_id:
                if parent_id not in inverse_children[child_id]:
                    inverse_children[child_id].append(parent_id)

    parents = {}
    for cid in ordered_ids:
        if canonical(cid) != cid:
            continue
        node = by_cid[cid]
        direct = (node.get("up") or [[]])[0]
        direct = unique_refs(direct, canonical, canonical(cid))
        parents[cid] = direct[:2] if len(direct) <= 2 else []

    for cid, refs in repairs.get("parents", {}).items():
        cid = canonical(cid)
        if cid not in known_ids:
            raise ValueError("repair target is missing: %s" % cid)
        refs = unique_refs(refs, canonical, cid)
        if len(refs) > 2:
            raise ValueError("too many direct parents for %s" % cid)
        missing = [ref for ref in refs if ref not in known_ids]
        if missing:
            raise ValueError("unknown parents for %s: %s" % (cid, ", ".join(missing)))
        parents[cid] = refs

    recovered = 0
    for cid in ordered_ids:
        cid = canonical(cid)
        if parents.get(cid):
            continue
        candidates = unique_refs(inverse_children.get(cid, []), canonical, cid)
        if 0 < len(candidates) <= 2:
            parents[cid] = candidates
            recovered += 1

    # Ensure aliases expose the same family as their canonical horse while
    # preserving every old cid for stale links and character routes.
    for cid in ordered_ids:
        target = canonical(cid)
        if target != cid:
            parents[cid] = list(parents.get(target, []))
        else:
            parents.setdefault(cid, [])

    canonical_children = defaultdict(list)
    alias_ids = {cid for cid in ordered_ids if canonical(cid) != cid}
    for child_id in ordered_ids:
        if child_id in alias_ids:
            continue
        for parent_id in parents.get(child_id, []):
            if child_id not in canonical_children[parent_id]:
                canonical_children[parent_id].append(child_id)

    children = {}
    for cid in ordered_ids:
        children[cid] = list(canonical_children.get(canonical(cid), []))

    for cid in ordered_ids:
        direct = list(parents.get(cid, []))[:2]
        row0 = direct + [None] * (2 - len(direct))
        row1 = ancestor_row(row0, parents)
        row2 = ancestor_row(row1, parents)
        node = by_cid[cid]
        node["up"] = [row0, row1, row2]
        node["children"] = children[cid]
        grand = []
        for child_id in children[cid]:
            for grandchild_id in children.get(child_id, []):
                if grandchild_id not in grand:
                    grand.append(grandchild_id)
        node["grandchildren"] = grand

    output_nodes = [by_cid[cid] for cid in ordered_ids]
    output = PREFIX + json.dumps(output_nodes, ensure_ascii=False, separators=(",", ":")) + ";\n"
    atomic_write(DATA_PATH, output)
    print("pedigree nodes: %d; recovered direct parent rows: %d" % (len(output_nodes), recovered))


if __name__ == "__main__":
    main()
