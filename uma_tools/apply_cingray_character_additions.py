#!/usr/bin/env python3
"""Merge the reviewed Cinderella Gray cast additions into the character index."""

import argparse
import io
import json
import os
import tempfile
import time
import urllib.request

from PIL import Image


TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
SOURCE_PATH = os.path.join(ROOT, "data", "anime", "cingray_character_additions.json")
INDEX_PATH = os.path.join(ROOT, "data", "character_index_data.js")
PEDIGREE_PATH = os.path.join(ROOT, "data", "pedigree_source.json")
PREFIX = "window.CHAR_INDEX = "


def load_wrapped_json(path):
    with open(path, encoding="utf-8") as handle:
        raw = handle.read().strip()
    if not raw.startswith(PREFIX) or not raw.endswith(";"):
        raise ValueError("unexpected character index wrapper")
    return json.loads(raw[len(PREFIX):-1])


def load_additions():
    with open(SOURCE_PATH, encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload.get("characters") or []


def browser_record(source):
    return {
        "id": source["id"],
        "zh": source["zh"],
        "ja": source["ja"],
        "en": source["en"],
        "cv_zh": source["cv_zh"],
        "cv": source["cv"],
        "img": source["img"],
        "page": "https://anime-cinderellagray.com/character/",
        "main": source["main"],
        "sub": source["sub"],
        "role_zh": source["zh"],
        "role_type": source["role_type"],
        "summary_zh": source["summary_zh"],
        "birth": "",
        "height": "",
        "weight": "",
        "sankak": "",
    }


def merged_index(current, additions):
    existing = {record.get("id") for record in current}
    output = list(current)
    for source in additions:
        if source["id"] not in existing:
            output.append(browser_record(source))
            existing.add(source["id"])
    humans = {"female_trainer", "male_trainer", "akikawa", "tazuna", "etsuko", "kiryuin", "hayakawa"}
    humans.update(record["id"] for record in additions if record.get("role_type") == "human")
    output.sort(key=lambda record: record.get("id") in humans or any(token in str(record.get("id")) for token in ("trainer", "commentator")))
    return output


def serialize(records):
    return PREFIX + json.dumps(records, ensure_ascii=False, separators=(",", ":")) + ";\n"


def atomic_write(path, content):
    fd, temp_path = tempfile.mkstemp(prefix=".cingray-", suffix=".tmp", dir=os.path.dirname(path))
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


def merge_pedigree_nodes(additions):
    with open(PEDIGREE_PATH, encoding="utf-8") as handle:
        pedigree = json.load(handle)
    nodes = pedigree.get("nodes") or []
    by_id = {node.get("id"): node for node in nodes}
    mappings = pedigree.get("character_mappings") or {}
    added = 0
    for source in additions:
        if source["id"] in by_id:
            continue
        mapping = mappings.get(source["id"]) or {}
        horse_id = mapping.get("horse")
        node = {
            "id": source["id"],
            "zh": source["zh"],
            "ja": source["ja"],
            "en": source["en"],
            "avatar": source["img"].lstrip("/"),
        }
        if horse_id:
            horse = by_id.get(horse_id)
            if not horse:
                raise ValueError("mapped horse is missing: %s" % horse_id)
            node.update({
                "alias_of": horse_id,
                "real_name_zh": horse.get("real_name_zh") or horse.get("zh"),
                "real_name": horse.get("real_name") or horse.get("ja"),
                "real_name_en": horse.get("real_name_en") or horse.get("en"),
            })
        else:
            node["pure"] = True
        nodes.append(node)
        by_id[node["id"]] = node
        added += 1
    atomic_write(PEDIGREE_PATH, json.dumps(pedigree, ensure_ascii=False, indent=2) + "\n")
    return added


def download_asset(source):
    output_path = os.path.join(ROOT, source["img"].lstrip("/"))
    if os.path.exists(output_path):
        return False
    request = urllib.request.Request(
        source["image_source"],
        headers={"User-Agent": "uma-live-wiki asset sync/1.0"},
    )
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
            break
        except Exception as caught:
            error = caught
            if attempt < 3:
                time.sleep(attempt + 1)
    else:
        raise error
    image = Image.open(io.BytesIO(body)).convert("RGBA")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".cingray-image-", suffix=".png", dir=os.path.dirname(output_path))
    os.close(fd)
    try:
        image.save(temp_path, format="PNG", optimize=True)
        os.replace(temp_path, output_path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise
    return True


def validate(records, additions, require_assets=False):
    by_id = {record.get("id"): record for record in records}
    errors = []
    for source in additions:
        record = by_id.get(source["id"])
        if not record:
            errors.append("missing character: %s" % source["id"])
            continue
        for field in ("zh", "ja", "en", "cv", "cv_zh", "role_type", "summary_zh", "img"):
            if record.get(field) != browser_record(source).get(field):
                errors.append("field drift: %s.%s" % (source["id"], field))
        if require_assets and not os.path.exists(os.path.join(ROOT, source["img"].lstrip("/"))):
            errors.append("missing image: %s" % source["img"])
    if errors:
        raise SystemExit("\n".join(errors))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write missing cast records")
    parser.add_argument("--write-pedigree", action="store_true", help="write matching pedigree display nodes")
    parser.add_argument("--download-assets", action="store_true", help="download reviewed official images")
    parser.add_argument("--check", action="store_true", help="validate records and local images")
    args = parser.parse_args()

    additions = load_additions()
    current = load_wrapped_json(INDEX_PATH)
    output = merged_index(current, additions)
    if args.write:
        atomic_write(INDEX_PATH, serialize(output))

    pedigree_added = merge_pedigree_nodes(additions) if args.write_pedigree else 0

    downloaded = 0
    download_errors = []
    if args.download_assets:
        for source in additions:
            try:
                downloaded += int(download_asset(source))
            except Exception as caught:
                download_errors.append("%s: %s" % (source["id"], caught))

    records = load_wrapped_json(INDEX_PATH) if args.write else current
    if args.check:
        validate(records, additions, require_assets=True)
    print("Cinderella Gray cast: %d records, %d pedigree node(s), %d image(s) downloaded" % (
        len(additions), pedigree_added, downloaded
    ))
    if download_errors:
        raise SystemExit("image download failures:\n" + "\n".join(download_errors))


if __name__ == "__main__":
    main()
