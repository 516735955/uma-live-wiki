"""Profiles responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import identities as pipeline_identities
from . import program_discovery as pipeline_program_discovery
from . import program_merge as pipeline_program_merge
from . import text as pipeline_text


def balanced_template(source: str, name: str) -> str:
    start = source.find("{{" + name)
    if start < 0:
        return ""
    depth = 0
    index = start
    while index < len(source) - 1:
        pair = source[index:index + 2]
        if pair == "{{":
            depth += 1
            index += 2
            continue
        if pair == "}}":
            depth -= 1
            index += 2
            if depth == 0:
                return source[start:index]
            continue
        index += 1
    return ""


def template_fields(template: str) -> dict[str, str]:
    matches = list(pipeline_common.re.finditer(r"^\|\s*([^=\n]+?)\s*=\s*", template, pipeline_common.re.M))
    fields = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(template)
        fields[match.group(1).strip()] = template[match.end():end].strip()
    return fields


def clean_wikipedia_field(value: str) -> str:
    text = pipeline_common.re.sub(r"<!--.*?-->", "", str(value or ""), flags=pipeline_common.re.S)
    text = pipeline_common.re.sub(r"<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>", "", text, flags=pipeline_common.re.I | pipeline_common.re.S)
    text = pipeline_common.re.sub(r"\{\{(?:JPN|Japan)\}\}", "", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = pipeline_common.re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = pipeline_common.re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = pipeline_common.re.sub(r"<[^>]+>", "", text)
    text = text.replace("'''", "").replace("''", "")
    return pipeline_common.re.sub(r"\s+", " ", pipeline_common.html.unescape(text)).strip(" ・")


def wikipedia_raw(title: str) -> str:
    query = pipeline_common.urllib.parse.urlencode({"title": title, "action": "raw"})
    return pipeline_common.fetch_text_url("https://ja.wikipedia.org/w/index.php?" + query)


def wikipedia_person_template(source: str) -> tuple[str, dict[str, str]]:
    for template_name in ("声優", "ActorActress", "騎手"):
        template = balanced_template(source, template_name)
        if template:
            return template_name, template_fields(template)
    return "", {}


def wikipedia_biography_page(source: str) -> bool:
    if wikipedia_person_template(source)[0]:
        return True
    prefix = source[:6000]
    if pipeline_common.re.search(r"[{][{][^{}\n]*(?:aimai|曖昧さ回避)[^{}\n]*[}][}]", prefix, pipeline_common.re.I):
        return False
    return bool(pipeline_common.re.search(r"'''[^']+'''.{0,800}(?:声優|俳優|歌手|騎手|アナウンサー|プロ野球選手)", prefix, pipeline_common.re.S))


def wikipedia_title_key(value: str) -> str:
    base = pipeline_common.re.sub(r"\s*[_(（][^)）]+[)）]\s*$", "", value or "")
    return pipeline_text.fold_name(base)


def wikipedia_voice_page(candidates: list[str]) -> tuple[str, str]:
    tried = set()
    for candidate in candidates:
        if not candidate or candidate in tried:
            continue
        tried.add(candidate)
        try:
            source = wikipedia_raw(candidate)
        except Exception:
            continue
        redirect = pipeline_common.re.match(r"#(?:REDIRECT|転送)\s*\[\[([^\]]+)\]\]", source, pipeline_common.re.I)
        if redirect:
            try:
                candidate = redirect.group(1)
                source = wikipedia_raw(candidate)
            except Exception:
                continue
        if wikipedia_biography_page(source):
            return candidate, source
    candidate_keys = {wikipedia_title_key(value) for value in candidates if value}
    query = pipeline_common.urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": (candidates[0] if candidates else "") + " 声優",
        "srlimit": 3, "format": "json", "formatversion": 2,
    })
    try:
        result = pipeline_program_discovery.fetch_json_url("https://ja.wikipedia.org/w/api.php?" + query)
    except Exception:
        return "", ""
    for row in (result.get("query") or {}).get("search") or []:
        title = row.get("title") or ""
        if title in tried or wikipedia_title_key(title) not in candidate_keys:
            continue
        try:
            source = wikipedia_raw(title)
        except Exception:
            continue
        if wikipedia_biography_page(source):
            return title, source
    return "", ""


def voice_detail_from_wikipedia(name_zh: str, name_ja: str, aliases: list[str]) -> dict[str, pipeline_common.Any]:
    page_title, source = wikipedia_voice_page([name_ja, *aliases, name_zh])
    template_name, fields = wikipedia_person_template(source) if source else ("", {})
    month = pipeline_common.re.sub(r"\D", "", fields.get("生月") or "")
    day = pipeline_common.re.sub(r"\D", "", fields.get("生日") or "")
    if not (month and day):
        birthday_source = fields.get("生") or source[:5000]
        birthday_match = pipeline_common.re.search(r"(?:生年月日と年齢|birth date and age)\s*\|\s*\d{4}\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", birthday_source, pipeline_common.re.I)
        if not birthday_match:
            birthday_match = pipeline_common.re.search(r"\[\[(?:19|20)\d{2}年\]\]\s*\[\[(\d{1,2})月\]\]\s*\[\[(\d{1,2})日\]\]", birthday_source)
        if birthday_match:
            month, day = birthday_match.groups()
    birthday = f"{int(month)}月{int(day)}日" if month and day else ""
    birthplace = clean_wikipedia_field(fields.get("出身地") or fields.get("出生地") or fields.get("出") or "")
    agency = clean_wikipedia_field(fields.get("事務所") or "")
    official_field = fields.get("公式サイト") or ""
    official_match = pipeline_common.re.search(r"https?://[^\s\]|<]+", official_field)
    official_profile = official_match.group(0) if official_match else ""
    kana = clean_wikipedia_field(fields.get("ふりがな") or "")
    canonical_field = fields.get("名前") or fields.get("芸名") or fields.get("名") or ""
    canonical_ja = pipeline_common.re.sub(r"\s+", "", clean_wikipedia_field(canonical_field)) or pipeline_common.re.sub(r"\s+", "", pipeline_common.re.sub(r"\s*\([^)]*\)$", "", page_title)) or name_ja
    source_url = "https://ja.wikipedia.org/wiki/" + pipeline_common.urllib.parse.quote(page_title.replace(" ", "_")) if page_title else ""
    values = {"birthday": birthday, "birthplace": birthplace, "agency": agency, "official_profile": official_profile}
    missing_status = "not_applicable" if source and template_name not in ("声優", "ActorActress") else "not_published"
    return {
        "lookup_name": name_ja,
        "name_zh": name_zh,
        "name_ja": canonical_ja,
        "aliases": list(dict.fromkeys(
            alias for alias in [name_ja, *aliases] if alias and alias not in (name_zh, canonical_ja)
        )),
        "kana": kana,
        **values,
        "field_status": {key: "verified" if value else ("source_unavailable" if not source else missing_status) for key, value in values.items()},
        "status": "complete" if source else "source_unavailable",
        "sources": ([{"kind": "wikipedia", "label": "日文维基百科", "url": source_url}] if source_url else []),
    }


def official_profile_photo(profile_url: str) -> dict[str, str]:
    """Resolve a portrait from a supported official agency profile.

    The profile page remains the cited source even when an agency exposes its
    image through a separate JSON endpoint. Unknown sites use conservative
    page metadata or an explicitly named profile-photo container.
    """
    if not profile_url:
        return {}
    parsed = pipeline_common.urllib.parse.urlparse(profile_url)
    image_url = ""
    if parsed.netloc.endswith("across-ent.com"):
        talent_id = (pipeline_common.urllib.parse.parse_qs(parsed.query).get("id") or [""])[0]
        if talent_id:
            endpoint = "https://acrossent-admin.sakuraweb.com/_v1.php/talentview?" + pipeline_common.urllib.parse.urlencode({
                "query": "view",
                "id": talent_id,
            })
            payload = pipeline_program_discovery.fetch_json_url(endpoint)
            image_url = str((payload.get("talent") or {}).get("image_path1") or "")
    else:
        source = pipeline_common.fetch_text_url(profile_url)
        patterns = (
            r'<div\b[^>]*class=["\'][^"\']*\bphoto\b[^"\']*["\'][^>]*>[\s\S]{0,500}?<img\b[^>]*src=["\']([^"\']+)',
            r'<link\b[^>]*rel=["\']image_src["\'][^>]*href=["\']([^"\']+)',
            r'<meta\b[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)',
            r'<meta\b[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']',
        )
        for pattern in patterns:
            match = pipeline_common.re.search(pattern, source, pipeline_common.re.I)
            if match:
                image_url = pipeline_common.urllib.parse.urljoin(profile_url, pipeline_common.html.unescape(match.group(1)))
                break
    if not image_url:
        return {}
    image_name = pipeline_common.Path(pipeline_common.urllib.parse.urlparse(image_url).path).name.lower()
    if pipeline_common.re.search(r"(?:^|[-_])(ogp|ogimage|logo|og)(?:[-_.]|$)", image_name):
        return {}
    return {
        "photo_url": image_url,
        "photo_source_url": profile_url,
        "photo_source_title": "官方事务所资料页",
    }


def refresh_voice_actor_details(*, persist=True) -> dict[str, pipeline_common.Any]:
    from knowledge_io import read_json, write_json
    state_path = pipeline_common.DATA_DIR / 'auto_update' / 'voice_profiles.json'
    state = read_json(state_path, {'attempted_at': {}})
    attempts = state.setdefault('attempted_at', {})
    characters = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    voice_list = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "voice_list_data.js", "VA_LIST")
    photos = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "va_photos_data.js", "VA_PHOTOS")
    overrides = pipeline_common.read_json(pipeline_common.EVENTS_DIR / "overrides.json")
    identity_registry = pipeline_common.read_json(pipeline_common.VOICE_IDENTITIES_FILE)
    previous_details = pipeline_common.read_json(pipeline_common.VOICE_DETAILS_FILE).get("records") or [] if pipeline_common.VOICE_DETAILS_FILE.exists() else []

    def has_generic_photo(record: dict[str, pipeline_common.Any]) -> bool:
        image_name = pipeline_common.Path(pipeline_common.urllib.parse.urlparse(str(record.get("photo_url") or "")).path).name.lower()
        return bool(image_name and pipeline_common.re.search(r"(?:^|[-_])(ogp|ogimage|logo|og)(?:[-_.]|$)", image_name))

    accepted_lookups = {
        pipeline_text.fold_name(str(record.get("lookup_name") or record.get("name_ja") or record.get("name_zh") or ""))
        for record in previous_details
        if record.get("status") == "complete" and not has_generic_photo(record)
        and all(record.get(field) or (record.get('field_status') or {}).get(field) == 'not_applicable'
                for field in ('birthday', 'birthplace', 'agency', 'official_profile'))
    }
    previous_by_lookup = {
        pipeline_text.fold_name(str(record.get("lookup_name") or "")): record
        for record in previous_details
        if record.get("lookup_name") and record.get("sources")
    }
    identities = pipeline_identities.IdentityIndex(characters, voice_list, photos, overrides, identity_registry)
    reverse_aliases: dict[str, list[str]] = pipeline_common.defaultdict(list)
    for alias, canonical in (overrides.get("voice_aliases") or {}).items():
        reverse_aliases[pipeline_text.fold_name(str(canonical))].append(str(alias))
    profile_overrides = {
        pipeline_text.fold_name(str(name)): value
        for name, value in (overrides.get("voice_actor_profile_overrides") or {}).items()
    }

    def fetch(profile: dict[str, pipeline_common.Any]) -> dict[str, pipeline_common.Any]:
        retryable = False
        identity = profile["identity"]
        aliases = [*identity.get("aliases", []), *reverse_aliases.get(pipeline_text.fold_name(identity.get("ja") or ""), [])]
        patch = next(
            (profile_overrides.get(pipeline_text.fold_name(name)) for name in (identity.get("ja"), identity.get("zh"), *aliases) if profile_overrides.get(pipeline_text.fold_name(name))),
            None,
        )
        if patch:
            record = {
                "lookup_name": identity.get("ja") or "",
                "name_zh": identity.get("zh") or "",
                "name_ja": identity.get("ja") or "",
                "aliases": list(dict.fromkeys(alias for alias in aliases if alias and alias not in (identity.get("zh"), identity.get("ja")))),
                "kana": "",
                "birthday": "",
                "birthplace": "",
                "agency": "",
                "official_profile": "",
                "field_status": {field: "source_unavailable" for field in ("birthday", "birthplace", "agency", "official_profile")},
                "status": "source_unavailable",
                "sources": [],
            }
        else:
            record = voice_detail_from_wikipedia(identity.get("zh") or "", identity.get("ja") or "", aliases)
            if not record.get("sources"):
                retryable = True
                previous = previous_by_lookup.get(pipeline_text.fold_name(identity.get("ja") or ""))
                if previous:
                    record = dict(previous)
        if patch:
            record.update({key: value for key, value in patch.items() if key != "sources"})
            record["sources"] = list({
                (source.get("kind"), source.get("url")): source
                for source in [*record.get("sources", []), *patch.get("sources", [])]
                if source.get("url")
            }.values())
            field_status = dict(record.get("field_status") or {})
            for field in ("birthday", "birthplace", "agency", "official_profile"):
                if patch.get(field):
                    field_status[field] = "verified"
            record["field_status"] = field_status
            record["status"] = "complete"
        if not profile.get("photo", {}).get("url") and record.get("official_profile"):
            try:
                record.update(official_profile_photo(str(record["official_profile"])))
            except Exception:
                retryable = True
                previous = previous_by_lookup.get(pipeline_text.fold_name(identity.get("ja") or "")) or {}
                for field in ("photo_url", "photo_source_url", "photo_source_title"):
                    if previous.get(field):
                        record[field] = previous[field]
        record['_source_retryable'] = retryable
        return record

    records = []
    source_errors = []
    profiles_to_fetch = [
        profile for profile in identities.profiles
        if pipeline_text.fold_name(str((profile.get("identity") or {}).get("ja") or "")) not in accepted_lookups
        and pipeline_common.time.time() - attempts.get((profile.get('identity') or {}).get('ja') or '', 0) >= 86400
    ]
    profiles_to_fetch.sort(key=lambda profile: attempts.get(profile['identity'].get('ja') or '', 0))
    profiles_to_fetch = profiles_to_fetch[:6]
    with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fetch, profile): profile for profile in profiles_to_fetch}
        for future in pipeline_common.concurrent.futures.as_completed(futures):
            record = future.result()
            retryable = record.pop('_source_retryable', False)
            records.append(record)
            lookup = futures[future]['identity'].get('ja') or ''
            attempts[lookup] = pipeline_common.time.time() - (86400 - 3600 if retryable else 0)
            if retryable:
                source_errors.append('voice profile source unavailable: ' + lookup)
            state['source_errors'] = source_errors
            merged = apply_additive_voice_detail_refresh({'records': previous_details}, {'records': records})
            if persist:
                write_json(pipeline_common.VOICE_DETAILS_FILE, merged)
                write_json(state_path, state)
    records.sort(key=lambda row: pipeline_text.fold_name(row.get("name_ja") or row.get("name_zh") or ""))
    return {
        "schema_version": 2,
        "source": "Japanese Wikipedia voice-actor infoboxes, with portraits resolved from cited official agency profiles when the local photo index has no entry",
        "refreshed_at": pipeline_common.dt.datetime.now(pipeline_common.dt.timezone.utc).replace(microsecond=0).isoformat(),
        "coverage": {
            "source_errors": source_errors,
            "records": len(records),
            "source_pages": sum(bool(row.get("sources")) for row in records),
            "complete_fields": {
                field: sum(bool(row.get(field)) for row in records)
                for field in ("birthday", "birthplace", "agency", "official_profile")
            },
            "official_profile_photos": sum(bool(row.get("photo_url")) for row in records),
            "accounted_fields": {
                field: sum((row.get("field_status") or {}).get(field) in ("verified", "not_published", "not_applicable", "source_unavailable") for row in records)
                for field in ("birthday", "birthplace", "agency", "official_profile")
            },
        },
        "records": records,
    }


def apply_additive_voice_detail_refresh(existing: dict[str, pipeline_common.Any], discovered: dict[str, pipeline_common.Any]) -> dict[str, pipeline_common.Any]:
    """Fill missing profile facts while preserving accepted values and sources."""
    existing_records = list(existing.get("records") or [])
    by_lookup = {
        pipeline_text.fold_name(str(record.get("lookup_name") or record.get("name_ja") or record.get("name_zh") or "")): record
        for record in existing_records
    }
    added = 0
    upgraded = 0
    repaired_photos = 0

    def has_generic_photo(record: dict[str, pipeline_common.Any]) -> bool:
        image_name = pipeline_common.Path(pipeline_common.urllib.parse.urlparse(str(record.get("photo_url") or "")).path).name.lower()
        return bool(image_name and pipeline_common.re.search(r"(?:^|[-_])(ogp|ogimage|logo|og)(?:[-_.]|$)", image_name))

    for record in discovered.get("records") or []:
        lookup = pipeline_text.fold_name(str(record.get("lookup_name") or record.get("name_ja") or record.get("name_zh") or ""))
        previous = by_lookup.get(lookup)
        if previous is None:
            by_lookup[lookup] = record
            added += 1
        elif previous.get("status") == "source_unavailable" and record.get("status") != "source_unavailable":
            previous['status'] = record['status']
            upgraded += 1
        elif has_generic_photo(previous) and record.get('photo_url') and not has_generic_photo(record):
            previous.update({key: value for key, value in record.items() if key.startswith('photo_') and value})
            repaired_photos += 1
        if previous is not None:
            for field in ('birthday', 'birthplace', 'agency', 'official_profile', 'kana', 'photo_url', 'photo_source_url', 'photo_source_title'):
                if not previous.get(field) and record.get(field):
                    previous[field] = record[field]
                    previous.setdefault('field_status', {})[field] = 'verified'
                    upgraded += 1
            previous['sources'] = pipeline_program_merge.merge_program_list('sources', previous.get('sources') or [], record.get('sources') or [])
    records = sorted(by_lookup.values(), key=lambda row: pipeline_text.fold_name(row.get("name_ja") or row.get("name_zh") or ""))
    return {
        "schema_version": max(int(existing.get("schema_version") or 1), int(discovered.get("schema_version") or 1)),
        "source": existing.get("source") or discovered.get("source") or "",
        "refreshed_at": discovered.get("refreshed_at") or existing.get("refreshed_at") or "",
        "refresh_policy": "fill missing fields and sources; preserve accepted nonempty facts",
        "coverage": {
            "records": len(records),
            "source_pages": sum(bool(row.get("sources")) for row in records),
            "complete_fields": {
                field: sum(bool(row.get(field)) for row in records)
                for field in ("birthday", "birthplace", "agency", "official_profile")
            },
            "official_profile_photos": sum(bool(row.get("photo_url")) for row in records),
            "accounted_fields": {
                field: sum((row.get("field_status") or {}).get(field) in ("verified", "not_published", "not_applicable", "source_unavailable") for row in records)
                for field in ("birthday", "birthplace", "agency", "official_profile")
            },
            "added_in_refresh": added,
            "upgraded_in_refresh": upgraded,
            "repaired_profile_photos": repaired_photos,
        },
        "records": records,
    }
