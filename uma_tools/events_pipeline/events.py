"""Events responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import identities as pipeline_identities
from . import song_identity as pipeline_song_identity
from . import text as pipeline_text


def curated_media(items: pipeline_common.Iterable[list[pipeline_common.Any] | tuple[pipeline_common.Any, ...]]) -> list[dict[str, str]]:
    """Turn hand-curated video cells into one card per usable URL.

    Some legacy cells contain separate upper/lower-part links and editorial text
    on multiple lines. The catalog stores only complete URLs so the frontend
    never has to interpret source formatting or offer a broken media card.
    """

    media: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        if not item:
            continue
        raw = str(item[0] or "")
        base_label = str(item[1] if len(item) > 1 else "视频").strip() or "视频"
        for line in raw.splitlines() or [raw]:
            part = pipeline_common.re.sub(r"[：:\s]+$", "", line.split("http", 1)[0]).strip()
            for match in pipeline_common.MEDIA_URL_RE.finditer(line):
                url = match.group(0).rstrip(".,，。；;")
                parsed = pipeline_common.urllib.parse.urlparse(url)
                if parsed.scheme not in {"http", "https"} or not parsed.hostname or "." not in parsed.hostname:
                    continue
                if url in seen:
                    continue
                seen.add(url)
                label = f"{base_label} · {part}" if part else base_label
                media.append({"url": url, "label": label})
    return media


def series_lookup(series_doc: dict[str, pipeline_common.Any]) -> dict[str, dict[str, pipeline_common.Any]]:
    return {item["id"]: item for item in series_doc.get("series", [])}


def resolve_event_cover(event: dict[str, pipeline_common.Any], series_by_id: dict[str, dict[str, pipeline_common.Any]]) -> str:
    """Return the one cover URL published for an event."""
    image = str(event.get("image") or "")
    if image and "eventernote.s3.amazonaws.com/" not in image:
        return image
    event_id = str(event.get("id") or "").lower()
    if event.get("series_id") == "numbered-live":
        for token, cover in pipeline_common.NUMBERED_EVENT_COVERS.items():
            if token in event_id:
                return cover
    series = series_by_id.get(str(event.get("series_id") or "")) or {}
    return str(series.get("cover") or pipeline_common.EVENT_COVER_BY_KIND.get(
        str(event.get("kind") or ""), pipeline_common.EVENT_COVER_BY_KIND["onsite"]
    ))


def numbered_events(data: list[dict[str, pipeline_common.Any]], identities: pipeline_identities.IdentityIndex, used: set[str], stable_ids: dict[str, str] | None = None) -> list[dict[str, pipeline_common.Any]]:
    out = []
    for group_index, group in enumerate(data):
        series_match = pipeline_common.re.search(r"(\d+(?:st|nd|rd|th)(?:\s*EVENT)?(?:\s*EXTRA)?)", group.get("group") or "", pipeline_common.re.I)
        series_token = pipeline_common.re.sub(r"\s+", "-", series_match.group(1).lower()) if series_match else f"series-{group_index + 1}"
        for performance_index, sub in enumerate(group.get("subs") or []):
            date = pipeline_text.first_date(sub.get("date"))
            event_id = pipeline_text.unique_id((stable_ids or {}).get(sub.get("title") or "") or f"live-numbered-{series_token}-{date or performance_index + 1}", used)
            sessions = []
            cast_source = pipeline_identities.parse_cast_text(sub.get("cast") or "")
            event_cast = pipeline_identities.make_cast(cast_source, identities, "curated_live_cast", sub.get('cast_source_url') or '')
            for day_index, day in enumerate(sub.get("days") or []):
                table = day.get("table") or ""
                full_cast = pipeline_identities.cast_characters_for_session(
                    sub.get("cast") or "", identities, sub.get("date"), day_index
                )
                performances = pipeline_song_identity.table_performances(table, identities, full_cast)
                characters = list(dict.fromkeys([
                    *full_cast,
                    *(char_id for performance in performances for char_id in performance["character_ids"]),
                ]))
                session = {
                    "id": f"{event_id}-session-{day_index + 1}",
                    "label": day.get("label") or f"DAY{day_index + 1}",
                    "date": pipeline_text.event_date_for_day(sub.get("date"), day_index),
                    "songs": [performance["song"] for performance in performances],
                    "character_ids": characters,
                    "performances": performances,
                    "cast": pipeline_identities.make_cast([item for line in pipeline_identities.cast_lines_for_session(sub.get("cast") or "", sub.get("date"), day_index)
                                       for item in pipeline_identities.parse_cast_text(line)], identities, "curated_live_cast", sub.get('cast_source_url') or ''),
                }
                if table:
                    session["setlist_html"] = table
                    session["setlist_source"] = {"file": "data/live_data.json", "group": group_index, "performance": performance_index, "day": day_index}
                sessions.append(session)
            no = series_token.replace("-event", "")
            base_legacy = f"/zh-Hans/live/number_series_event/{no}_EVENT"
            legacy = base_legacy if performance_index == 0 else f"{base_legacy}/{performance_index}/0"
            legacy_aliases = []
            for day_index in range(max(1, len(sessions))):
                alias = base_legacy if performance_index == 0 and day_index == 0 else f"{base_legacy}/{performance_index}/{day_index}"
                if alias not in legacy_aliases:
                    legacy_aliases.append(alias)
            if performance_index == 0 and f"{base_legacy}/0/0" not in legacy_aliases:
                legacy_aliases.append(f"{base_legacy}/0/0")
            out.append({
                "id": event_id, "title": sub.get("title") or group.get("group") or "", "date": date,
                "end_date": sessions[-1]["date"] if sessions else date, "kind": "concert", "mode": "onsite",
                "series_id": "numbered-live", "venue": pipeline_text.venue_from_date_text(sub.get("date")) if date else "",
                "cast_status": "verified" if event_cast else "partial", "cast": event_cast, "character_ids": [],
                "sessions": sessions, "media": curated_media(sub.get("vids") or []),
                "sources": [{"kind": "curated_live", "label": "站内精调歌单", "url": legacy}] +
                    ([{'kind':'official_cast','label':'官方出演名单','url':sub['cast_source_url']}] if sub.get('cast_source_url') else []),
                "legacy_url": legacy, "legacy_aliases": legacy_aliases, "image": "", "summary": sub.get("tips") or "",
            })
    return out


def cat_series_id(category: str, section_name: str, group_name: str) -> str:
    text = f"{section_name} {group_name}".upper()
    if "WINNING LIVE" in text:
        return "winning-live-release"
    if "STARTING GATE" in text:
        return "starting-gate-release"
    if category == "twinkle":
        return "twinkle-circle"
    return ""


def title_series_id(title: str) -> str:
    """按活动名归类系列（eventernote 等无系列来源的兜底）：
    标题含 WINNING LIVE / STARTING GATE 即归入对应发售纪念系列。"""
    text = (title or "").upper()
    if "WINNING LIVE" in text:
        return "winning-live-release"
    if "STARTING GATE" in text:
        return "starting-gate-release"
    return ""


def category_events(data: dict[str, pipeline_common.Any], identities: pipeline_identities.IdentityIndex, used: set[str]) -> list[dict[str, pipeline_common.Any]]:
    out = []
    for category, root in data.items():
        if not isinstance(root, dict):
            continue
        sections = root.get("sections") or [{"group": root.get("group") or "", "groups": root.get("groups") or []}]
        has_sections = bool(root.get("sections"))
        for section_index, section in enumerate(sections):
            for group_index, group in enumerate(section.get("groups") or []):
                for performance_index, sub in enumerate(group.get("subs") or [{}]):
                    title = sub.get("title") or group.get("group") or ""
                    date = pipeline_text.first_date(sub.get("date"))
                    suffix = pipeline_text.stable_title_suffix(title) or f"item-{section_index + 1}-{group_index + 1}"
                    event_id = pipeline_text.unique_id(f"live-{category}-{date or 'undated'}-{suffix}", used)
                    legacy = f"/zh-Hans/live/{category}/"
                    if has_sections:
                        legacy += f"{section_index}/{group_index}"
                    else:
                        legacy += str(group_index)
                    if performance_index:
                        legacy += f"/{performance_index}/0"
                    legacy_aliases = [legacy]
                    if performance_index == 0:
                        legacy_aliases.append(f"{legacy}/0/0")
                    for day_index in range(1, max(1, len(sub.get("days") or []))):
                        base = legacy.rsplit("/", 2)[0] if performance_index else legacy
                        alias = f"{base}/{performance_index}/{day_index}"
                        if alias not in legacy_aliases:
                            legacy_aliases.append(alias)
                    cast = pipeline_identities.make_cast(pipeline_identities.parse_cast_text(sub.get("cast") or ""), identities, "curated_live_cast")
                    sessions = []
                    for day_index, day in enumerate(sub.get("days") or []):
                        table = day.get("table") or ""
                        full_cast = pipeline_identities.cast_characters_for_session(
                            sub.get("cast") or "", identities, sub.get("date"), day_index
                        )
                        performances = pipeline_song_identity.table_performances(table, identities, full_cast)
                        characters = list(dict.fromkeys([
                            *full_cast,
                            *(char_id for performance in performances for char_id in performance["character_ids"]),
                        ]))
                        session = {
                            "id": f"{event_id}-session-{day_index + 1}", "label": day.get("label") or "本公演",
                            "date": pipeline_text.event_date_for_day(sub.get("date"), day_index), "songs": [performance["song"] for performance in performances],
                            "character_ids": characters,
                            "performances": performances,
                        }
                        if table:
                            session["setlist_html"] = table
                            session["setlist_source"] = {"file": "data/live_cat_data.json", "category": category, "section": section_index if has_sections else None, "group": group_index, "performance": performance_index, "day": day_index}
                        sessions.append(session)
                    venue = pipeline_text.venue_from_date_text(sub.get("date")) if date else str(sub.get("date") or "")
                    out.append({
                        "id": event_id, "title": title, "date": date, "end_date": sessions[-1]["date"] if sessions else date,
                        "kind": "concert" if category in ("cd", "twinkle") else "onsite", "mode": "onsite",
                        "series_id": cat_series_id(category, section.get("group") or "", group.get("group") or ""),
                        "venue": venue, "cast_status": "verified" if cast else "partial", "cast": cast, "character_ids": [],
                        "sessions": sessions, "media": curated_media(sub.get("vids") or []),
                        "sources": [{"kind": "curated_live", "label": "站内精调歌单", "url": legacy}] +
                            ([{'kind': 'eventernote', 'label': 'Eventernote', 'url': sub.get('source_url') or group.get('source_url')}]
                             if str(sub.get('source_url') or group.get('source_url') or '').startswith('https://www.eventernote.com/events/') else []),
                        "legacy_url": legacy, "legacy_aliases": legacy_aliases, "image": "", "summary": sub.get("tips") or "",
                    })
    return out


def attach_eventernote(events: list[dict[str, pipeline_common.Any]], eventernote_doc: dict[str, pipeline_common.Any], identities: pipeline_identities.IdentityIndex, used: set[str]) -> None:
    by_legacy = {}
    by_source = {source['url']: event for event in events for source in event.get('sources', []) if source.get('kind') == 'eventernote'}
    for event in events:
        for legacy in [event.get("legacy_url"), *(event.get("legacy_aliases") or [])]:
            if legacy:
                by_legacy[legacy] = event
    for source in eventernote_doc.get("events") or []:
        legacy = source.get("live") or ""
        linked = by_legacy.get(legacy) or by_source.get(source.get('link'))
        cast = pipeline_identities.make_cast(source.get("actors") or [], identities, "eventernote", source.get("link") or "")
        eventernote_id = ""
        match = pipeline_common.EVENTERNOTE_ID_RE.search(source.get("link") or "")
        if match:
            eventernote_id = match.group(1)
        if linked:
            has_curated = any(s.get("kind") == "curated_live" for s in linked.get("sources") or [])
            if has_curated:
                linked["cast_status"] = "verified" if linked["cast"] else linked["cast_status"]
            else:
                linked["cast"] = pipeline_identities.merge_cast_records([*linked["cast"], *cast])
                linked["cast_status"] = "verified" if linked["cast"] else linked["cast_status"]
            if not any(item.get('kind') == 'eventernote' and item.get('url') == source.get('link') for item in linked['sources']):
                linked["sources"].append({"kind": "eventernote", "label": "Eventernote", "url": source.get("link") or ""})
            linked["image"] = linked.get("image") or source.get("img") or ""
            linked["venue"] = linked.get("venue") or source.get("venue") or ""
            continue
        date = pipeline_text.first_date(source.get("date"))
        event_id = pipeline_text.unique_id(f"eventernote-{eventernote_id or date or 'undated'}", used)
        events.append({
            "id": event_id, "title": source.get("title") or "", "date": date, "end_date": date,
            "kind": "onsite", "mode": "onsite",
            "series_id": title_series_id(source.get("title") or ""),
            "venue": source.get("venue") or "",
            "cast_status": "verified" if cast else "pending", "cast": cast, "character_ids": [], "sessions": [], "media": [],
            "sources": [{"kind": "eventernote", "label": "Eventernote", "url": source.get("link") or ""}],
            "legacy_url": "", "image": source.get("img") or "", "summary": source.get("times") or "",
        })


def add_programs(events: list[dict[str, pipeline_common.Any]], programs_doc: dict[str, pipeline_common.Any], identities: pipeline_identities.IdentityIndex, used: set[str]) -> None:
    for source in programs_doc.get("programs") or []:
        event_id = pipeline_text.unique_id(source.get("id") or f"program-{source.get('date') or 'undated'}-{pipeline_text.stable_suffix(source.get('title') or '')}", used)
        source_kind = source.get("source_kind") or "official_youtube"
        kind = source.get("kind") or "official_program"
        source_url = source.get("source_url") or source.get("url") or ""
        source_sessions = source.get("sessions") or []
        source_cast = list(source.get("cast") or [])
        for source_session in source_sessions:
            source_cast.extend(source_session.get("cast") or [])
        cast = pipeline_identities.make_cast(source_cast, identities, source_kind, source_url)
        program_media = source.get("media") or ([{"url": source.get("url") or "", "label": "官方视频", "video_id": source.get("video_id") or "", "duration": source.get("duration")}]
                                                  if source.get("url") else [])
        source_labels = {
            "official_announcement": "官方公告",
            "official_youtube": "官方 YouTube",
            "community_archive": "Umamusume Wiki 补档",
            "official_broadcaster": "节目官方页",
        }
        program_sources = source.get("sources") or ([{"kind": source_kind, "label": source_labels.get(source_kind, "资料来源"), "url": source_url}]
                                                     if source_url else [])
        characters = []
        for item in source.get("characters") or []:
            char_id = identities.character_id(str(item))
            if char_id and char_id not in characters:
                characters.append(char_id)
        if source.get("series_id") == "pakatube-character-program":
            for char_id in identities.characters_in_text((source.get("title") or "") + " " + (source.get("summary") or "")):
                if char_id not in characters:
                    characters.append(char_id)
            if pipeline_common.re.search(r"ぴすラジッ|ゴルシトーク|ぱかトークっ!|同時視聴", source.get("title") or "", pipeline_common.re.I):
                host_id = identities.character_id("ゴールドシップ")
                if host_id and host_id not in characters:
                    characters.append(host_id)
        if characters:
            cast = pipeline_identities.merge_cast_records([
                *cast,
                *pipeline_identities.make_character_cast(characters, identities, "official_character_credit", source_url),
            ])
        sessions = []
        for index, source_session in enumerate(source_sessions):
            session_cast = pipeline_identities.make_cast(source_session.get("cast") or [], identities, source_kind, source_url)
            session_characters = []
            for item in session_cast:
                char_id = item.get("character_id") or ""
                if char_id and char_id not in session_characters:
                    session_characters.append(char_id)
            for item in source_session.get("characters") or []:
                char_id = identities.character_id(str(item))
                if char_id and char_id not in session_characters:
                    session_characters.append(char_id)
            if session_characters:
                session_cast = pipeline_identities.merge_cast_records([
                    *session_cast,
                    *pipeline_identities.make_character_cast(session_characters, identities, "official_character_credit", source_url),
                ])
            sessions.append({
                "id": f"{event_id}-session-{index + 1}",
                "label": source_session.get("label") or f"场次 {index + 1}",
                "date": source_session.get("date") or source.get("date") or "",
                "songs": [],
                "character_ids": session_characters,
                "cast": session_cast,
                **({"start_time": source_session["start_time"]} if source_session.get("start_time") else {}),
                **({"doors_time": source_session["doors_time"]} if source_session.get("doors_time") else {}),
            })
        if not sessions:
            sessions = [{"id": f"{event_id}-session-1", "label": "本期节目", "date": source.get("date") or "", "songs": [], "character_ids": characters, "cast": cast}]
        events.append({
            "id": event_id, "title": source.get("title") or "", "date": source.get("date") or "", "end_date": source.get("end_date") or source.get("date") or "",
            "kind": kind, "mode": source.get("mode") or "online", "series_id": source.get("series_id") or ("official-special" if kind == "official_program" else ""), "venue": source.get("venue") or "在线播出",
            "cast_status": "verified" if cast else (source.get("cast_status") or "pending"), "cast": cast, "character_ids": characters,
            "sessions": sessions,
            "media": program_media,
            "sources": program_sources,
            "legacy_url": "", "image": source.get("thumbnail") or "", "summary": pipeline_text.concise_program_summary(source.get("summary")),
            "schedule_status": source.get("schedule_status") or ("scheduled" if source.get("date") else "unknown"),
            "metadata_status": source.get("metadata_status") or "complete",
        })


def apply_overrides(events: list[dict[str, pipeline_common.Any]], overrides: dict[str, pipeline_common.Any], identities: pipeline_identities.IdentityIndex) -> list[dict[str, pipeline_common.Any]]:
    patches = overrides.get("event_patches") or {}
    aliases = overrides.get("event_aliases") or {}
    hidden = set(overrides.get("hidden_event_ids") or [])
    for event in events:
        canonical = aliases.get(event["id"], event["id"])
        event["id"] = canonical
        patch = patches.get(canonical)
        if patch:
            if patch.get('title') and patch['title'] != event['title']:
                event.setdefault('title_aliases', []).append(event['title'])
            event.update({key: value for key, value in patch.items() if key not in ("cast_add", "sources_add")})
            if "character_ids" in patch:
                allowed_characters = set(patch.get("character_ids") or [])
                event["cast"] = [
                    item for item in event.get("cast") or []
                    if not item.get("character_id") or item.get("character_id") in allowed_characters
                ]
            additions = pipeline_identities.make_cast(patch.get("cast_add") or [], identities, "curated_correction")
            known_cast = {(item.get("voice_actor_id"), pipeline_text.fold_name(item.get("name") or ""), pipeline_text.fold_name(item.get("role") or "")) for item in event.get("cast") or []}
            event.setdefault("cast", []).extend(
                item for item in additions
                if (item.get("voice_actor_id"), pipeline_text.fold_name(item.get("name") or ""), pipeline_text.fold_name(item.get("role") or "")) not in known_cast
            )
            event.setdefault("sources", []).extend(
                source for source in patch.get("sources_add") or [] if source not in event.get("sources", [])
            )
        event_characters = list(dict.fromkeys([
            *(str(item or "") for item in event.get("character_ids") or [] if item),
            *(str(item.get("character_id") or "") for item in event.get("cast") or [] if item.get("character_id")),
        ]))
        if event_characters:
            represented_characters = {
                str(item.get("character_id") or "")
                for item in event.get("cast") or []
                if item.get("voice_actor_id") and item.get("character_id")
            }
            missing_characters = [
                character_id for character_id in event_characters
                if character_id not in represented_characters
            ]
            if missing_characters:
                event["cast"] = pipeline_identities.merge_cast_records([
                    *(event.get("cast") or []),
                    *pipeline_identities.make_character_cast(missing_characters, identities, "canonical_character_cast"),
                ])
            if event["cast"]:
                event["cast_status"] = "verified"
    return [event for event in events if event["id"] not in hidden]


def dedupe_events(events: list[dict[str, pipeline_common.Any]]) -> list[dict[str, pipeline_common.Any]]:
    # IDs are merged only after an explicit alias or exact source identity has
    # established equivalence. The richer program record supplies the shell,
    # while curated setlists, legacy links, cast evidence, and media are unioned.
    grouped: dict[str, list[dict[str, pipeline_common.Any]]] = pipeline_common.defaultdict(list)
    for event in events:
        grouped[event["id"]].append(event)

    def unique(items: pipeline_common.Iterable[pipeline_common.Any], key) -> list[pipeline_common.Any]:
        out = []
        seen = set()
        for item in items:
            marker = key(item)
            if marker in seen:
                continue
            seen.add(marker)
            out.append(item)
        return out

    def merge_session(target: dict[str, pipeline_common.Any], incoming: dict[str, pipeline_common.Any]) -> None:
        target['id_aliases'] = list(dict.fromkeys([*target.get('id_aliases', []), incoming['id'], *incoming.get('id_aliases', [])]))
        target['alternate_setlist_sources'] = [*target.get('alternate_setlist_sources', []),
                                                *incoming.get('alternate_setlist_sources', [])]
        if incoming.get('setlist_source') and incoming.get('setlist_source') != target.get('setlist_source'):
            target['alternate_setlist_sources'].append(incoming['setlist_source'])
        target["songs"] = unique([*target.get("songs", []), *incoming.get("songs", [])], lambda value: value)
        target["character_ids"] = unique([*target.get("character_ids", []), *incoming.get("character_ids", [])], lambda value: value)
        target["cast"] = pipeline_identities.merge_cast_records([*target.get("cast", []), *incoming.get("cast", [])])
        target["performances"] = unique(
            [*target.get("performances", []), *incoming.get("performances", [])],
            lambda item: (item.get("song"), tuple(item.get("character_ids") or [])),
        )
        if incoming.get("setlist_source") and not target.get("setlist_source"):
            target["setlist_source"] = incoming["setlist_source"]
            target["setlist_html"] = incoming.get("setlist_html") or ""

    out = []
    for event_id, rows in grouped.items():
        primary = max(
            rows,
            key=lambda row: (
                row.get("kind") == "official_program",
                row.get('series_id') == 'numbered-live',
                bool(row.get("date")),
                bool(row.get("image")),
                len(row.get("summary") or ""),
            ),
        )
        merged = dict(primary)
        merged['title_aliases'] = unique([title for row in rows for title in [row['title'], *row.get('title_aliases', [])]
                                          if title != merged['title']], lambda value: value)
        merged['id_aliases'] = unique([alias for row in rows for alias in row.get('id_aliases', [])], lambda value: value)
        merged["sources"] = unique(
            [source for row in rows for source in row.get("sources", [])],
            lambda source: (source.get("kind"), source.get("url")),
        )
        merged["media"] = unique(
            [media for row in rows for media in row.get("media", [])],
            lambda media: media.get("video_id") or media.get("url"),
        )
        merged["cast"] = pipeline_identities.merge_cast_records(item for row in rows for item in row.get("cast", []))
        merged["character_ids"] = unique(
            [character_id for row in rows for character_id in row.get("character_ids", [])],
            lambda character_id: character_id,
        )
        merged["legacy_aliases"] = unique(
            [alias for row in rows for alias in row.get("legacy_aliases", [])],
            lambda alias: alias,
        )
        merged["legacy_url"] = next((row.get("legacy_url") for row in rows if row.get("legacy_url")), "")
        sessions: list[dict[str, pipeline_common.Any]] = []
        for row in rows:
            row_sessions = row.get("sessions") or []
            for incoming in row_sessions:
                same = next(
                    (
                        session for session in sessions
                        if session.get("date") == incoming.get("date")
                        and (
                            pipeline_text.fold_name(session.get("label") or "") == pipeline_text.fold_name(incoming.get("label") or "")
                            or (len(row_sessions) == 1 and len(primary.get("sessions") or []) == 1)
                        )
                    ),
                    None,
                )
                if same:
                    merge_session(same, incoming)
                else:
                    sessions.append(dict(incoming))
        for index, session in enumerate(sessions):
            session['id_aliases'] = unique([session['id'], *session.get('id_aliases', [])], lambda value: value)
            session["id"] = f"{event_id}-session-{index + 1}"
            session['id_aliases'] = [alias for alias in session['id_aliases'] if alias != session['id']]
        merged["sessions"] = sessions
        if len(rows) > 1 and any(row.get("kind") == "official_program" for row in rows):
            merged["kind"] = "official_program"
            merged["mode"] = "online"
            merged["venue"] = "在线播出"
        out.append(merged)
    return out
