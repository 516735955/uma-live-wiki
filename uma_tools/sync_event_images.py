"""Cache remote event artwork and bounded local display variants."""
from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import sys
import time
import urllib.error
import urllib.request
import warnings
from pathlib import Path

from PIL import Image, ImageFile, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG = DATA / "events_catalog.json"
STATE = DATA / "auto_update" / "event_images.json"
CACHE = ROOT / "uma_tools" / "img" / "event-cache"
Image.MAX_IMAGE_PIXELS = 40_000_000
ImageFile.LOAD_TRUNCATED_IMAGES = False
warnings.filterwarnings("error", category=Image.DecompressionBombWarning)
REFRESH_AFTER_SECONDS = 7 * 24 * 60 * 60


def atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def encode(source: bytes, width: int) -> bytes:
    with Image.open(io.BytesIO(source)) as image:
        image.verify()
    with Image.open(io.BytesIO(source)) as image:
        image.seek(0)
        image = ImageOps.exif_transpose(image).convert("RGBA")
        image.thumbnail((width, width * 8), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, "WEBP", quality=78, method=4)
        return output.getvalue()


def fetch(url: str) -> bytes:
    candidates = [url]
    if "i.ytimg.com" in url and "/maxresdefault." in url:
        candidates.append(url.replace("/maxresdefault.", "/hqdefault."))
    last_error = None
    for candidate in candidates:
        request = urllib.request.Request(candidate, headers={"User-Agent": "UmaLiveWiki/1.0", "Accept": "image/*"})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = response.read(8 * 1024 * 1024 + 1)
            break
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code != 404:
                raise
    else:
        raise last_error
    if len(payload) > 8 * 1024 * 1024:
        raise ValueError("event image too large")
    return payload


def run(root: Path = ROOT, force: bool = False) -> dict:
    catalog = json.loads((root / "data/events_catalog.json").read_text(encoding="utf-8"))
    state_file = root / "data/auto_update/event_images.json"
    cache = root / "uma_tools/img/event-cache"
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {"schema_version": 1, "items": {}}
    items = dict(state.get("items") or {})
    source_cache: dict[str, bytes] = {}
    updated = failed = 0
    for event in catalog.get("events", []):
        event_id, source = str(event.get("id") or ""), str(event.get("image") or "")
        if not event_id or not source.startswith(("http://", "https://")):
            continue
        old = items.get(event_id)
        def cached_file(key: str) -> Path:
            return root / str(old.get(key, "")).lstrip("/")
        checked_at = float(old.get("checked_at", old.get("fetched_at", 0)) or 0) if old else 0
        if (not force and old and old.get("source_image") == source
                and all(cached_file(key).is_file() for key in ("image_url", "hero_image_url", "original_url"))
                and checked_at > 0
                and time.time() - checked_at < REFRESH_AFTER_SECONDS):
            continue
        try:
            original = source_cache.get(source)
            if original is None:
                original = fetch(source)
                source_cache[source] = original
            digest = hashlib.sha256(original).hexdigest()[:16]
            source_key = hashlib.sha256(source.encode("utf-8")).hexdigest()[:32]
            original_name = Path(source.split("?", 1)[0]).suffix.lower() or ".img"
            original_path = cache / f"{source_key}-{digest}-original{original_name}"
            small_path = cache / f"{source_key}-{digest}-480.webp"
            hero_path = cache / f"{source_key}-{digest}-960.webp"
            # Generate and validate every representation before replacing any file.
            small = encode(original, 480)
            hero = encode(original, 960)
            atomic(original_path, original)
            atomic(small_path, small)
            atomic(hero_path, hero)
            items[event_id] = {"source_image": source, "image_url": "/uma_tools/img/" + str(small_path.relative_to(root / "uma_tools/img")), "hero_image_url": "/uma_tools/img/" + str(hero_path.relative_to(root / "uma_tools/img")), "original_url": "/uma_tools/img/" + str(original_path.relative_to(root / "uma_tools/img")), "sha256": hashlib.sha256(original).hexdigest()}
            items[event_id]["checked_at"] = time.time()
            updated += 1
        except Exception as error:
            failed += 1
            print(f"event image retained: {event_id}: {error}")
    payload = {"schema_version": 1, "items": items}
    atomic(state_file, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return {"updated": updated, "failed": failed, "total": len(items)}


if __name__ == "__main__":
    print(json.dumps(run(force="--force" in sys.argv), ensure_ascii=False))
