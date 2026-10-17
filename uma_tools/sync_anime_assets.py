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

from PIL import Image


TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
SOURCE_PATH = os.path.join(ROOT, "data", "anime", "asset_sources.json")
# Covers are source artwork, not a poster-shaped crop.  Keep the complete
# composition while limiting the local derivative to a reasonable size for
# cards and the detail hero.  The original URL remains available in metadata.
MAX_COVER_SIZE = (1600, 1600)


def load_assets():
    with open(SOURCE_PATH, encoding="utf-8") as handle:
        return json.load(handle).get("assets") or []


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
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


def write_cover(asset, *, fetch_image=fetch):
    output_path = os.path.join(ROOT, asset["output"])
    source_url = asset["source_url"]
    if asset.get("mode") == "still" and not asset.get("original_output") and urllib.parse.urlparse(source_url).hostname == "images.microcms-assets.io":
        parts = urllib.parse.urlsplit(source_url)
        query = dict(urllib.parse.parse_qsl(parts.query))
        query.update({"q": "90"})
        source_url = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))
    body = fetch_image(source_url)
    image = Image.open(io.BytesIO(body)).convert("RGBA")
    source = Image.new("RGB", image.size, "white")
    source.paste(image, mask=image.getchannel("A"))
    if asset.get("mode") == "episode" and (source.width < 300 or source.height < 160):
        raise ValueError("episode artwork is unavailable: %s" % asset["output"])
    if asset.get("mode") == "still" and (source.width < 1280 or source.height < 720):
        raise ValueError("official still has no HD original: %s" % asset["output"])
    if asset.get("original_output"):
        original_path = os.path.join(ROOT, asset["original_output"])
        os.makedirs(os.path.dirname(original_path), exist_ok=True)
        with open(original_path + '.tmp', 'wb') as handle:
            handle.write(body)
        os.replace(original_path + '.tmp', original_path)
    if asset.get("mode") == "still":
        cover = source.copy()
        cover.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
    else:
        cover = source.copy()
        cover.thumbnail(MAX_COVER_SIZE, Image.Resampling.LANCZOS)
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
                if asset.get("mode") != "still" and (image.width < 1 or image.height < 1):
                    errors.append("empty cover: %s" % asset["output"])
                if image.format != "WEBP":
                    errors.append("unexpected cover format: %s" % asset["output"])
                if asset.get("mode") == "still" and max(image.size) < 1280:
                    errors.append("low-resolution still: %s" % asset["output"])
        except Exception as caught:
            errors.append("invalid cover %s: %s" % (asset["output"], caught))
        if asset.get("original_output") and not os.path.isfile(os.path.join(ROOT, asset["original_output"])):
            errors.append("missing original: %s" % asset["original_output"])
    if errors:
        raise SystemExit("\n".join(errors))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="download and rebuild every cover")
    parser.add_argument("--covers-only", action="store_true", help="limit --write/--check to work cover assets")
    parser.add_argument("--check", action="store_true", help="validate local cover files")
    parser.add_argument("--missing", action="store_true", help="download only assets missing locally")
    args = parser.parse_args()
    assets = load_assets()
    if args.covers_only:
        assets = [asset for asset in assets if asset.get("work_id")]
    if args.write:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        selected = [asset for asset in assets if not args.missing
                    or not os.path.exists(os.path.join(ROOT, asset["output"]))
                    or (asset.get('original_output') and not os.path.exists(os.path.join(ROOT, asset['original_output'])))]
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
