"""Rebuild deterministic, self-contained parent event collages.

This is an asset generator, not part of the catalog build.  It reads the
current event catalog and editorial grouping document, embeds each child
thumbnail into the SVG, and atomically replaces only the generated group
assets.  A failed download leaves the previous asset in place.
"""
from __future__ import annotations

import base64
import html
import mimetypes
import os
import tempfile
from pathlib import Path

from . import common


OUT = common.ROOT / "uma_tools" / "img" / "event-groups"


def _data_uri(value: str) -> str:
    if value.startswith("/uma_tools/"):
        path = common.ROOT / value.lstrip("/")
        payload = path.read_bytes()
        mime = "image/svg+xml" if path.suffix == ".svg" else mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    else:
        raise ValueError("Collages use archived local thumbnails; the image collector owns downloads")
    return f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"


def rebuild(events: list[dict] | None = None, groups: list[dict] | None = None) -> int:
    if events is None:
        catalog = common.read_json(common.DATA_DIR / "events_catalog.json")
        events = catalog.get("events") or []
    if groups is None:
        groups = common.read_json(common.EVENTS_DIR / "groupings.json").get("groups") or []
    events = {str(item.get("id")): item for item in events}
    state = common.DATA_DIR / "auto_update" / "event_images.json"
    cached = (common.read_json(state).get("items") or {}) if state.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    rebuilt = 0
    for group in groups:
        if (group.get("image_source") or {}).get("kind") == "official_shared_visual":
            continue
        children = [events.get(str(member.get("event_id"))) for member in group.get("members") or []]
        children = [item for item in children if item]
        if len(children) < 2:
            continue
        tiles = []
        for item in children:
            image = str(item.get("image") or "")
            archived = cached.get(str(item.get("id"))) or {}
            if archived.get("source_image") == image:
                image = archived.get("image_url") or image
            # Generic fallback cards are not official child photographs.
            if "/event-covers/" in image or image.endswith(".svg"):
                continue
            if not image:
                continue
            try:
                tiles.append((str(item.get("title") or item["id"]), _data_uri(image)))
            except Exception:
                # Keep the last known good collage if one child is temporarily
                # unavailable; the next scheduled run will retry it.
                tiles = []
                break
        if not tiles:
            continue
        cols, card_w, card_h, gap = 3, 360, 250, 30
        rows = (len(tiles) + cols - 1) // cols
        width, height = 1200, 100 + rows * (card_h + gap)
        parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">', f'<rect width="{width}" height="{height}" rx="28" fill="#f7f9ff"/>', f'<text x="48" y="62" fill="#15234d" font-family="Arial,sans-serif" font-size="30" font-weight="700">{html.escape(str(group.get("title") or group["id"]))}</text>']
        for index, (title, uri) in enumerate(tiles):
            x = 48 + (index % cols) * (card_w + gap)
            y = 100 + (index // cols) * (card_h + gap)
            parts.extend([f'<rect x="{x}" y="{y}" width="{card_w}" height="{card_h}" rx="18" fill="#fff" stroke="#b9c9f2" stroke-width="3"/>', f'<image href="{uri}" x="{x+12}" y="{y+12}" width="336" height="170" preserveAspectRatio="xMidYMid slice"/>', f'<text x="{x+18}" y="{y+212}" fill="#24345e" font-family="Arial,sans-serif" font-size="20">{html.escape(title[:34])}</text>'])
        parts.append("</svg>\n")
        destination = OUT / f"{group['id']}.svg"
        content = "".join(parts)
        if destination.exists() and destination.read_text(encoding="utf-8") == content:
            continue
        fd, temporary = tempfile.mkstemp(prefix=f".{group['id']}.", suffix=".svg", dir=OUT)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(content)
            os.chmod(temporary, 0o644)
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        rebuilt += 1
    return rebuilt


if __name__ == "__main__":
    print(f"rebuilt {rebuild()} group collages")
