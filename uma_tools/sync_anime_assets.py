#!/usr/bin/env python3
"""Download reviewed anime artwork and build stable local cover thumbnails."""

import argparse
import io
import json
import os
import tempfile
import time
import urllib.request
import urllib.parse

from PIL import Image, ImageOps


TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
SOURCE_PATH = os.path.join(ROOT, "data", "anime", "asset_sources.json")
TARGET_SIZE = (720, 960)


def load_assets():
    with open(SOURCE_PATH, encoding="utf-8") as handle:
        return json.load(handle).get("assets") or []


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "uma-live-wiki asset sync/1.0"})
    error = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except Exception as caught:
            error = caught
            if attempt < 3:
                time.sleep(attempt + 1)
    raise error


def write_cover(asset):
    output_path = os.path.join(ROOT, asset["output"])
    source_url = asset["source_url"]
    if asset.get("mode") == "still" and urllib.parse.urlparse(source_url).hostname == "images.microcms-assets.io":
        parts = urllib.parse.urlsplit(source_url)
        query = dict(urllib.parse.parse_qsl(parts.query))
        query.update({"w": "1280", "q": "90"})
        source_url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
    body = fetch(source_url)
    source = Image.open(io.BytesIO(body)).convert("RGB")
    focus_y = max(0.0, min(1.0, float(asset.get("focus_y", 0.5))))
    if asset.get("mode") == "still":
        cover = source.copy()
        cover.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
    else:
        cover = ImageOps.fit(source, TARGET_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, focus_y))
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".anime-cover-", suffix=".webp", dir=os.path.dirname(output_path))
    os.close(fd)
    try:
        cover.save(temp_path, format="WEBP", quality=88, method=6)
        os.replace(temp_path, output_path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def validate(assets):
    errors = []
    for asset in assets:
        output_path = os.path.join(ROOT, asset["output"])
        if not os.path.exists(output_path):
            errors.append("missing cover: %s" % asset["output"])
            continue
        try:
            with Image.open(output_path) as image:
                if (asset.get("mode") != "still" and image.size != TARGET_SIZE) or image.format != "WEBP":
                    errors.append("unexpected cover format: %s" % asset["output"])
        except Exception as caught:
            errors.append("invalid cover %s: %s" % (asset["output"], caught))
    if errors:
        raise SystemExit("\n".join(errors))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="download and rebuild every cover")
    parser.add_argument("--check", action="store_true", help="validate local cover files")
    parser.add_argument("--missing", action="store_true", help="download only assets missing locally")
    args = parser.parse_args()
    assets = load_assets()
    if args.write:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        selected = [asset for asset in assets if not args.missing or not os.path.exists(os.path.join(ROOT, asset["output"]))]
        failed = []
        with ThreadPoolExecutor(max_workers=4) as pool:
            pending = {pool.submit(write_cover, asset): asset for asset in selected}
            for future in as_completed(pending):
                try:
                    future.result()
                except Exception as error:
                    failed.append(pending[future]["output"])
                    print("Asset failed: %s (%s)" % (pending[future]["output"], type(error).__name__), flush=True)
        if failed:
            raise SystemExit("%d assets unavailable; rerun --write --missing to retry" % len(failed))
    if args.check or not args.write:
        validate(assets)
    print("Anime covers: %d ready" % len(assets))


if __name__ == "__main__":
    main()
