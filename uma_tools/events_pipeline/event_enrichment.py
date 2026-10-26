"""Deterministic, source-preserving enrichment for event groupings and venues.

Grouping is an editorial relationship, not an identity merge.  Every source
event remains addressable; the relationship only gives the catalog and UI a
stable parent/child view when the official evidence supports it.
"""
from __future__ import annotations

from . import common


GROUPINGS_FILE = common.EVENTS_DIR / "groupings.json"
VENUES_FILE = common.EVENTS_DIR / "venues.json"
NEWS_SNAPSHOT_FILE = common.DATA_DIR / "news_snapshot.json"
EVENTERNOTE_FILE = common.DATA_DIR / "events_data.json"
GROUP_IMAGE_DIR = common.ROOT / "uma_tools" / "img" / "event-groups"


def apply_classification(events: list[dict], series_document: dict) -> list[dict]:
    """Use one editorial primary category per series, independent of source and mode."""
    series = series_document.get("series") or []
    by_id = {item["id"]: item for item in series}
    for event in events:
        text = " ".join(str(event.get(key) or "") for key in ("title", "title_ja"))
        current = by_id.get(event.get("series_id"))
        if not current:
            current = next((item for item in series if any(
                common.re.search(pattern, text, common.re.I)
                for pattern in item.get("title_patterns") or []
            )), None)
        if current:
            event["series_id"] = current["id"]
            event["kind"] = current["kind"]
        if event.get("series_id") in {"winning-live-release", "starting-gate-release"}:
            prefix = "WINNING LIVE" if event["series_id"] == "winning-live-release" else "STARTING GATE"
            match = common.re.search(prefix + r"\s*(\d{1,2}(?:(?:\s*[&＆/・、]\s*|\s+)(?:WINNING LIVE\s*|STARTING GATE\s*)?\d{1,2})*)", text, common.re.I)
            if match:
                numbers = common.re.findall(r"\d+", match.group(1))
                title = prefix + " " + "&".join(f"{int(number):02d}" for number in numbers) + " 发售纪念活动"
                event["display_title"] = title
                if event.get("group_label") and event.get("group_id"):
                    title += " " + str(event["group_label"])
                if event["title"] != title:
                    event["title_aliases"] = list(dict.fromkeys([*event.get("title_aliases", []), event["title"]]))
                    event["title"] = event["title_zh"] = title
        title = str(event.get("title") or "")
        compact = common.re.sub(r"^(?:赛马娘|ウマ娘)\s*(?:Pretty Derby|プリティーダービー)\s*", "", title, flags=common.re.I)
        if compact.startswith('×'):
            compact = '赛马娘' + compact
        compact = common.re.sub(r'^赛马娘\s+(?=\d+(?:st|nd|rd|th) EVENT)', '', compact)
        if common.re.search(r'EVENT WORLD TOUR\s*[「『\"]?THE STAGE', compact, common.re.I):
            compact = common.re.sub(r'(\d+(?:th|st|nd|rd)) EVENT WORLD TOUR\s*[「『\"]?THE STAGE[」』\"]?\s*[－–—-]\s*', r'\1 EVENT THE STAGE ', compact, flags=common.re.I)
            for city, label in {'TOKYO': '东京公演', 'OSAKA': '大阪公演', 'LOS ANGELES': '洛杉矶公演', 'YOKOHAMA': '横滨公演', 'SEOUL': '首尔公演', 'LONDON': '伦敦公演'}.items():
                compact = compact.replace(city, label)
        compact = compact.replace(" · ", " ").strip()
        if compact and compact != title:
            event["title_aliases"] = list(dict.fromkeys([*event.get("title_aliases", []), title]))
            event["title"] = event["title_zh"] = compact
            if not event.get("title_ja"):
                event["title_ja"] = title
    return events


def _read(path):
    if not path.exists():
        return {}
    return common.read_json(path)


def apply_groupings(events: list[dict], document: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Attach validated editorial group metadata without changing event IDs."""
    document = document if document is not None else _read(GROUPINGS_FILE)
    groups = document.get("groups") or []
    by_event: dict[str, list[tuple[dict, dict]]] = {}
    output_groups: list[dict] = []
    for group in groups:
        group_id = str(group.get("id") or "").strip()
        members = group.get("members") or []
        if not group_id or not members:
            continue
        clean_members = []
        for member in members:
            event_id = str(member.get("event_id") or "").strip()
            if not event_id:
                continue
            item = {
                "event_id": event_id,
                "role": str(member.get("role") or "child"),
                "label": str(member.get("label") or ""),
                "source_urls": list(dict.fromkeys(str(url) for url in member.get("source_urls") or [] if url)),
            }
            by_event.setdefault(event_id, []).append((group, item))
            clean_members.append(item)
        if not clean_members:
            continue
        output_group = {
            "id": group_id,
            "kind": str(group.get("kind") or "program_group"),
            "title": str(group.get("title") or group_id),
            "title_ja": str(group.get("title_ja") or ""),
            "summary": str(group.get("summary") or ""),
            "source_urls": list(dict.fromkeys(str(url) for url in group.get("source_urls") or [] if url)),
            "source_identity": dict(group.get("source_identity") or {}),
            "members": clean_members,
        }
        # Preserve editorial scheduling/image facts supplied by the source
        # document; enrichment may fill missing values, but must not discard
        # an explicitly confirmed end date or parent cover.
        for key in ("image", "image_strategy", "image_source", "date_start", "date_end", "confirmed_end_date", "session_days"):
            if key in group:
                output_group[key] = group[key]
        output_groups.append(output_group)
    known_by_id = {str(event.get("id") or ""): event for event in events}
    known = set(known_by_id)
    # Apply only explicit, source-backed identities.  This is deliberately
    # narrower than title similarity: the official source must identify the
    # same competition, and its own title must identify the actual stage.
    output_by_id = {group["id"]: group for group in output_groups}
    for event in events:
        event_id = str(event.get("id") or "")
        evidence = " ".join(str(event.get(key) or "") for key in ("title", "source_title", "source_description", "summary"))
        for group in output_groups:
            identity = group.get("source_identity") or {}
            phrase = str(identity.get("match") or "")
            if not phrase or phrase not in evidence:
                continue
            rule = str(identity.get("rule") or "")
            label = ""
            if "A-G" in rule or "qualifier" in rule:
                if not any(source.get("kind") == "official_youtube" for source in event.get("sources") or []):
                    continue
                title = str(event.get("source_title") or event.get("title") or "")
                if common.re.search(r"予告|预告|告知|振り返り|回顾|ダイジェスト|ハイライト", title):
                    continue
                marker = common.re.search(r"(?:预选|予選)(?:リーグ)?\s*([A-G])|([A-G])\s*[組组]", title, common.re.I)
                stages = ((r"準々決勝|四分之一决赛", "四分之一决赛"), (r"準決勝|半决赛", "半决赛"), (r"敗者復活|复活赛", "复活赛"), (r"決勝|决赛", "决赛"))
                label = next((label for pattern, label in stages if common.re.search(pattern, title)), "")
                if not label and marker:
                    label = f"预选{(marker.group(1) or marker.group(2)).upper()}组"
                if not label:
                    continue
            if any(member["event_id"] == event_id for member in group["members"]):
                continue
            member = {"event_id": event_id, "role": "child", "label": label or group["title"], "source_urls": []}
            group["members"].append(member)
            by_event.setdefault(event_id, []).append((group, member))
            output_by_id[group["id"]] = group
    enriched = []
    for event in events:
        row = dict(event)
        memberships = by_event.get(str(event.get("id") or ""), [])
        if memberships:
            group, member = memberships[0]
            row["group_id"] = group["id"]
            row["group_ids"] = [item[0]["id"] for item in memberships]
            row["group_role"] = member["role"]
            row["group_label"] = member["label"] or group.get("title") or group["id"]
            if group.get("image"):
                row["group_image"] = str(group["image"])
                # A shared official KV may stand in for a child only when the
                # child still has the generic placeholder.  Independent
                # artwork remains untouched and its provenance stays intact.
                if "/event-covers/" in str(row.get("image") or "") and str(row.get("image") or "").endswith(".svg"):
                    source = dict(group.get("image_source") or {})
                    row["image"] = str(group["image"])
                    row["image_source"] = {
                        "kind": "official_shared_visual",
                        "group_id": group["id"],
                        "url": source.get("url") or str(group["image"]),
                    }
            row["group_date_start"] = str(group.get("date_start") or "")
            row["group_date_end"] = str(group.get("date_end") or "")
            if member["source_urls"]:
                row["group_source_urls"] = member["source_urls"]
        enriched.append(row)
    # Keep stale editorial members visible in coverage, but never attach them
    # to a different event or silently invent an event record.
    for group in output_groups:
        group["missing_event_ids"] = [m["event_id"] for m in group["members"] if m["event_id"] not in known]
        children = []
        for member in group["members"]:
            event = known_by_id.get(member["event_id"])
            if not event:
                continue
            children.append({
                "event_id": event["id"],
                "label": member["label"] or event.get("title") or event["id"],
                "date": event.get("date") or "",
                "date_end": event.get("end_date") or event.get("date") or "",
                "image": event.get("image") or "",
            })
        group["children"] = children
        dates = [item["date"] for item in children if item["date"]]
        ends = [item["date_end"] for item in children if item["date_end"]]
        group["date_start"] = group.get("date_start") or (min(dates) if dates else "")
        group["date_end"] = group.get("date_end") or (max(ends) if ends else "")
        group["image"] = children[0]["image"] if children else ""
        group["image_strategy"] = "default_session"
    return enriched, output_groups


def apply_venues(events: list[dict], document: dict | None = None) -> list[dict]:
    """Add a stable venue key and display aliases; preserve raw venue text."""
    document = document if document is not None else _read(VENUES_FILE)
    by_raw = {str(alias): item for item in document.get("venues") or []
              for alias in [item.get("raw"), *(item.get("aliases") or [])] if alias}
    by_raw.update({item['raw']: item for item in document.get('venues') or [] if item.get('raw')})
    output = []
    for event in events:
        row = dict(event)
        raw = str(event.get("venue_raw") or event.get("venue") or "")
        item = by_raw.get(raw)
        if item:
            row["venue_raw"] = raw
            row["venue_id"] = "" if item.get("normalization_status") in {"channel", "region_placeholder"} else str(item.get("id") or "")
            row["venue_zh"] = str(item.get("name_zh") or "")
            row["venue_ja"] = str(item.get("name_ja") or "")
            row["venue_city"] = str(item.get("city") or "")
            row["venue_country"] = str(item.get("country") or "")
            row["venue_aliases"] = list(dict.fromkeys([raw, item.get("name_ja") or '', *(item.get("aliases") or [])]))
            row["venue_sources"] = item.get("sources") or []
            if item.get("display"):
                row["venue"] = str(item["display"])
            for name in item.get('display_history') or []:
                if row.get('date') and row['date'] < name.get('before', ''):
                    row['venue'] = name['display']
                    row['venue_zh'] = name['display']
                    row['venue_ja'] = name.get('name_ja') or row['venue_ja']
                    break
        output.append(row)
    return output


def apply_news_images(events: list[dict], snapshot: dict | None = None) -> list[dict]:
    """Reuse already archived official-news images for matching program cards.

    This is deliberately title/number constrained: a generic keyword match
    must never replace a curated event image with an unrelated news banner.
    """
    snapshot = snapshot if snapshot is not None else (_read(NEWS_SNAPSHOT_FILE) if NEWS_SNAPSHOT_FILE.exists() else {})
    news = snapshot.get("information_list") or []
    output = []
    for event in events:
        row = dict(event)
        if not str(row.get("image") or "").endswith(".svg"):
            output.append(row)
            continue
        title = str(row.get("title") or "")
        match = common.re.search(r"(?:PakaLive TV'?|ぱかライブTV'?)\s*(?:Vol\.?\s*|#\s*)(\d+)", title, common.re.I)
        if not match:
            output.append(row)
            continue
        number = match.group(1)
        candidates = []
        for item in news:
            news_title = str(item.get("title") or "")
            if not common.re.search(r"ぱかライブTV", news_title, common.re.I):
                continue
            # Equal episode numbers from the three regular programmes are
            # different identities, including their official artwork.
            source_series = "sokosoko-paka-live-tv" if "そこそこ" in news_title else (
                "paka-live-tv-prime" if common.re.search(r"ぱかライブTV\s*['’′＇]", news_title) else "paka-live-tv")
            if row.get("series_id") and row["series_id"] != source_series:
                continue
            if not common.re.search(rf"(?:Vol\.?\s*{number}\b|#\s*{number}\b)", news_title, common.re.I):
                continue
            if item.get("image"):
                candidates.append(item)
        if candidates:
            item = candidates[0]
            row["image"] = item["image"]
            row["image_source"] = {"kind": "official_news", "announce_id": item.get("announce_id"), "title": item.get("title")}
        output.append(row)
    return output


def apply_source_times(events: list[dict]) -> list[dict]:
    """Promote explicitly published clock times without deriving an end time."""
    patterns = {field: common.re.compile(rf"(?:{labels})\s*([0-3]?\d|4[0-7]):([0-5]\d)", common.re.I)
                for field, labels in (("doors_time", "开场|開場|入場"), ("start_time", "开演|開演|開始|start"), ("end_time", "终演|終演|終了|end"))}
    title_time = common.re.compile(r"(?:^|[\s【\[（(])([01]?\d|2[0-3]):([0-5]\d)(?:$|[\s】\]）)])")
    archived = _read(EVENTERNOTE_FILE) if EVENTERNOTE_FILE.exists() else {}
    archived_by_link = {str(item.get("link")): item for item in archived.get("events") or [] if item.get("link")}
    output = []
    for event in events:
        row = dict(event)
        source_text = " ".join(str(row.get(key) or "") for key in ("title", "source_title", "summary", "source_date", "source_time_text"))
        event_source = next((item for item in row.get("sources") or [] if item.get("kind") == "eventernote"), None)
        archived_item = archived_by_link.get(str(event_source.get("url"))) if event_source else None
        if archived_item and archived_item.get("times"):
            source_text = f"{source_text} {archived_item['times']}"
        title_match = title_time.search(str(row.get("title") or ""))
        if not row.get("sessions") and (any(pattern.search(source_text) for pattern in patterns.values()) or title_match):
            row["sessions"] = [{
                "id": f"{row.get('id', 'event')}-session-1",
                "label": "本场",
                "date": row.get("date") or "",
                "songs": [],
                "character_ids": list(row.get("character_ids") or []),
                "cast": list(row.get("cast") or []),
                "setlist_status": "none",
            }]
        multiple = len(row.get("sessions") or []) > 1
        for session in row.get("sessions") or []:
            child = dict(session)
            manual = (row.get("session_patches") or {}).get(child.get("id"), {})
            child.update(manual)
            own_source = next((item for item in child.get("sources") or [] if item.get("kind") == "eventernote"), None)
            own_archive = archived_by_link.get(str(own_source.get("url"))) if own_source else None
            text = " ".join([str(child.get("source_time_text") or ""), str((own_archive or {}).get("times") or ""), "" if multiple else source_text])
            filled = False
            for field, pattern in patterns.items():
                match = pattern.search(text)
                if match and not child.get(field) and field not in manual:
                    child[field] = f"{int(match.group(1)):02d}:{match.group(2)}"
                    filled = True
                    # Eventernote labels its end clock as an estimate even
                    # when the archived compact times omit that page note.
                    if field == "end_time" and (own_archive or (archived_item if not multiple else None) or common.re.search(r"目安|预计|預計|予定|预定", text)):
                        child["end_time_estimated"] = True
            if not multiple and title_match and not child.get("start_time") and "start_time" not in manual:
                child["start_time"] = f"{int(title_match.group(1)):02d}:{title_match.group(2)}"
                filled = True
            if filled:
                evidence = own_archive or (archived_item if not multiple else None)
                child.setdefault("time_source", "eventernote" if evidence else "event_source_text")
                child.setdefault("time_precision", "minute")
                child.setdefault("source_time_text", text.strip())
                if evidence:
                    child.setdefault("time_source_url", evidence.get("link") or "")
            row.setdefault("time_source", child.get("time_source"))
            row.setdefault("time_precision", child.get("time_precision"))
            session.clear(); session.update(child)
        output.append(row)
    return output


def apply_video_times(events: list[dict]) -> list[dict]:
    """Keep archived official upload clocks separate from live broadcast clocks."""
    from .program_discovery import PROGRAM_METADATA_CACHE, valid_video_metadata
    from .program_schedule import extract_metadata_time, metadata_is_live
    for event in events:
        sources = [item for item in event.get("sources") or [] if item.get("kind") == "official_youtube"]
        if len(event.get("sessions") or []) != 1:
            continue
        for source in sources:
            match = common.re.search(r"(?:[?&]v=|youtu\.be/)([\w-]{11})", source.get("url") or "")
            if not match:
                continue
            video_id = match.group(1)
            path = PROGRAM_METADATA_CACHE / (video_id + ".json")
            metadata = _read(path)
            if not valid_video_metadata(metadata, video_id) or metadata.get("channel_id") != "UCAWxPGGuIfWME2KTLUmSCHw":
                continue
            schedule = extract_metadata_time(metadata)
            if not schedule:
                continue
            session = event["sessions"][0]
            manual = event.get('session_patches', {}).get(session.get('id'), {})
            if metadata_is_live(metadata):
                for key, value in schedule.items():
                    if key not in session and key not in manual:
                        session[key] = value
            else:
                for key, value in (('published_time', schedule['broadcast_time']), ('published_date', schedule['broadcast_date']),
                                   ('publication_source_url', source['url'])):
                    if key not in manual:
                        session.setdefault(key, value)
                if 'broadcast_time' not in manual and session.get("broadcast_time_kind") == "metadata" and session.get("broadcast_time") == schedule["broadcast_time"]:
                    session.pop("broadcast_time", None)
                if event.get("broadcast_time_kind") == "metadata" and event.get("broadcast_time") == schedule["broadcast_time"]:
                    event.pop("broadcast_time", None)
            break
    return events


def enrich(events: list[dict], groupings: dict | None = None, venues: dict | None = None) -> tuple[list[dict], list[dict]]:
    events, groups = apply_groupings(events, groupings)
    return apply_video_times(apply_source_times(apply_news_images(apply_venues(events, venues)))), groups
