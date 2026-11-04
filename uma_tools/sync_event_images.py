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
import urllib.parse
import warnings
from pathlib import Path

from PIL import Image, ImageFile, ImageOps
from knowledge_io import bounded_read

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CATALOG = DATA / "events_catalog.json"
STATE = DATA / "auto_update" / "event_images.json"
CACHE = ROOT / "uma_tools" / "img" / "event-cache"
Image.MAX_IMAGE_PIXELS = 40_000_000
ImageFile.LOAD_TRUNCATED_IMAGES = False
warnings.filterwarnings("error", category=Image.DecompressionBombWarning)
REFRESH_AFTER_SECONDS = 7 * 24 * 60 * 60


def atomic(path: Path, payload: bytes, *, public: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if public:
            os.chmod(temporary, 0o644)
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
        request_url = urllib.parse.quote(candidate, safe=":/?&=%#+@;,!$'()*[]~")
        request = urllib.request.Request(request_url, headers={"User-Agent": "UmaLiveWiki/1.0", "Accept": "image/*"})
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = bounded_read(response, limit=8*1024*1024, deadline=time.monotonic()+12)
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


def run(root: Path = ROOT, force: bool = False, event_ids: set[str] | None = None,
        *, missing_only=False, limit=12, budget_seconds=90) -> dict:
    catalog = json.loads((root / "data/events_catalog.json").read_text(encoding="utf-8"))
    state_file = root / "data/auto_update/event_images.json"
    cache = root / "uma_tools/img/event-cache"
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {"schema_version": 1, "items": {}}
    items = dict(state.get("items") or {})
    errors = dict(state.get('failures') or {})
    source_cache: dict[str, bytes] = {}
    updated = failed = checked = deferred = 0
    candidates = []
    deadline = time.monotonic() + budget_seconds
    def checkpoint():
        payload = {**state, 'items':items, 'failures':errors,
                   'last_run':{'updated':updated,'failed':failed,'deferred':deferred}}
        atomic(state_file, (json.dumps(payload,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    events = sorted(catalog.get('events',[]),key=lambda event:str(event.get('date') or ''),reverse=True)
    for event in events:
        event_id, source = str(event.get("id") or ""), str(event.get("image") or "")
        if event_ids is not None and event_id not in event_ids:
            continue
        if not event_id or not source.startswith(("http://", "https://")):
            continue
        old = items.get(event_id)
        def cached_file(key: str) -> Path:
            return root / str(old.get(key, "")).lstrip("/")
        if old:
            for key in ("image_url", "hero_image_url", "original_url"):
                file = cached_file(key)
                if file.is_file() and file.resolve().is_relative_to(cache.resolve()):
                    # Existing archives can contain mkstemp's private 0600 mode.
                    # nginx must be able to serve these public image files too.
                    file.chmod(0o644)
        checked_at = float(old.get("checked_at", old.get("fetched_at", 0)) or 0) if old else 0
        complete = bool(old and old.get('source_image') == source and
                        all(cached_file(key).is_file() for key in ('image_url','hero_image_url','original_url')))
        if not force and complete and (missing_only or (checked_at > 0 and time.time()-checked_at < REFRESH_AFTER_SECONDS)):
            continue
        previous_error = errors.get(event_id,{})
        if not force and previous_error.get('source_image') == source and previous_error.get('next_at',0)>time.time():
            deferred += 1
            continue
        candidates.append((complete,event))
    candidates.sort(key=lambda item:item[0])
    for _,event in candidates:
        event_id,source=event['id'],event['image']
        if checked>=limit or time.monotonic()>=deadline:
            deferred += 1
            continue
        checked += 1
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
            atomic(original_path, original, public=True)
            atomic(small_path, small, public=True)
            atomic(hero_path, hero, public=True)
            items[event_id] = {"source_image": source, "image_url": "/uma_tools/img/" + str(small_path.relative_to(root / "uma_tools/img")), "hero_image_url": "/uma_tools/img/" + str(hero_path.relative_to(root / "uma_tools/img")), "original_url": "/uma_tools/img/" + str(original_path.relative_to(root / "uma_tools/img")), "sha256": hashlib.sha256(original).hexdigest()}
            items[event_id]["checked_at"] = time.time()
            errors.pop(event_id,None)
            updated += 1
        except Exception as error:
            failed += 1
            previous = errors.get(event_id,{})
            count = min(9,previous.get('attempts',0)+1) if previous.get('source_image')==source else 1
            errors[event_id]={'source_image':source,'error':str(error)[:250],'attempts':count,
                              'checked_at':time.time(),'next_at':time.time()+min(7*86400,3600*2**(count-1))}
            print(f"event image retained: {event_id}: {error}")
        checkpoint()
    checkpoint()
    return {"updated": updated, "failed": failed, "deferred":deferred,"total": len(items)}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--missing-only", action="store_true", help="reuse complete cached artwork during publication")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--event-id", action="append", help="refresh only the selected event or parent IDs")
    args = parser.parse_args()
    result = run(force=args.force, event_ids=set(args.event_id) if args.event_id else None,
                 missing_only=args.missing_only, limit=max(1,args.limit))
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(bool(result['failed'] or result['deferred']))
