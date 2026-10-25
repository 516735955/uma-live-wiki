"""Identities responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import text as pipeline_text


def parse_cast_text(value: str) -> list[dict[str, str]]:
    text = pipeline_common.html.unescape(str(value or ""))
    if 'cast-line' in text:
        from bs4 import BeautifulSoup
        lines = BeautifulSoup(text, 'html.parser').select('.cast-line')
        if len(lines) > 1:
            return [item for line in lines for item in parse_cast_text(str(line))]
    label_match = pipeline_common.CAST_LABEL_RE.search(text)
    label = pipeline_text.clean_text(label_match.group(1)).strip(' ：:') if label_match else ''
    participation = label if pipeline_common.NON_PERFORMER_CAST_LABEL_RE.search(label) else ''
    text = pipeline_common.CAST_LABEL_RE.sub('', text)
    text = pipeline_common.re.sub(r"<br\s*/?>", "、", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"</div>", "、", text, flags=pipeline_common.re.I)
    text = pipeline_text.clean_text(text)
    text = pipeline_common.re.sub(r"^(出演者|出走者|ゲスト|嘉宾)[:：]\s*", "", text)
    out: list[dict[str, str]] = []
    for item in pipeline_common.re.split(r"[、,，／/]|\s{2,}", text):
        item = item.strip(" ：:・")
        if not item:
            continue
        match = pipeline_common.re.match(r"([^（(]+?)[（(]([^）)]+?)(?:役)?[）)]", item)
        if match:
            actor = match.group(1).strip()
            role = pipeline_common.re.sub(r"役$", "", match.group(2).strip())
        else:
            actor = pipeline_common.re.sub(r"^(MC|司会|実況)[:：]", "", item).strip()
            role = ""
        actor = pipeline_common.re.sub(r"[【\[].*?[】\]]", "", actor).strip()
        actor = pipeline_common.re.sub(r"^(?:(?:仅|僅)?\d+日|两日出演|出演|出走者|嘉宾|ゲスト|実況|实况|向导|司会|MC)[:：]\s*", "", actor).strip()
        if actor and len(actor) <= 30 and not pipeline_common.re.search(r"全員|ほか|他\d|出演者", actor):
            row = {"name": actor, "role": role}
            if participation:
                row['participation_label'] = participation
            out.append(row)
    return out


def cast_lines_for_session(value: str, date_value: pipeline_common.Any, day_index: int) -> list[str]:
    """Inherit a day label from nested cast groups, including guests and MCs."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(value or '', 'html.parser')
    lines = soup.select('.cast-line')
    if not lines:
        return [value or '']
    session_date = pipeline_text.event_date_for_day(date_value, day_index)
    session_day = pipeline_common.dt.date.fromisoformat(session_date).day if session_date else 0
    out = []
    for line in lines:
        labels = []
        own = line.select_one('.cast-label')
        if own:
            labels.append(own.get_text(' ', strip=True))
        for group in line.find_parents(class_='cast-group'):
            first = group.select_one('.cast-label')
            if first:
                labels.append(first.get_text(' ', strip=True))
        applies = True
        for label in labels:
            match = pipeline_common.re.search(r'((?:\d{1,2}[、,，/・]?\s*)+)日', label)
            days = {int(number) for number in pipeline_common.re.findall(r'\d+', match.group(1))} if match else set()
            day_number = pipeline_common.re.search(r'DAY\s*(\d+)', label, pipeline_common.re.I)
            if (days and (not session_day or session_day not in days)) or (day_number and int(day_number.group(1)) != day_index + 1):
                applies = False
                break
        if applies:
            out.append(str(line))
    return out


def cast_characters_for_session(
    value: str,
    identities: "IdentityIndex",
    date_value: pipeline_common.Any,
    day_index: int,
) -> list[str]:
    """Resolve the performing character cast for one day of a curated event."""
    lines = cast_lines_for_session(value, date_value, day_index)
    character_ids = []
    for line in lines:
        label_match = pipeline_common.CAST_LABEL_RE.search(line)
        label = pipeline_text.clean_text(label_match.group(1)) if label_match else ""
        if label and pipeline_common.NON_PERFORMER_CAST_LABEL_RE.search(label):
            continue
        for item in parse_cast_text(line):
            character_id = identities.character_id(item.get("role") or "")
            if character_id and character_id not in character_ids:
                character_ids.append(character_id)
    return character_ids


class IdentityIndex:
    def __init__(self, characters: list[dict[str, pipeline_common.Any]], voice_list: list[dict[str, pipeline_common.Any]], photos: dict[str, pipeline_common.Any], overrides: dict[str, pipeline_common.Any], identity_registry: dict[str, pipeline_common.Any], details: dict[str, pipeline_common.Any] | None = None):
        self.characters = characters
        self.voice_list = voice_list
        self.photos = photos
        self.overrides = overrides
        self.profile_details = details or {"records": []}
        self.non_voice_people = {
            pipeline_text.fold_name(str(alias)): str(kind)
            for kind, aliases in (overrides.get("non_voice_people") or {}).items()
            for alias in aliases
        }
        self.voice_by_alias: dict[str, str] = {}
        self.character_by_alias: dict[str, str] = {}
        self.character_by_id = {str(item.get("id")): item for item in characters if item.get("id")}
        self._canonical_ids: dict[str, str] = {}
        registry_ids: set[str] = set()
        for item in identity_registry.get("voice_actors") or []:
            actor_id = str(item.get("id") or "")
            if not actor_id or actor_id in registry_ids:
                raise ValueError(f"invalid or duplicate canonical voice-actor ID: {actor_id!r}")
            registry_ids.add(actor_id)
            for name in item.get("names") or []:
                alias = pipeline_text.fold_name(str(name))
                owner = self._canonical_ids.get(alias)
                if owner and owner != actor_id:
                    raise ValueError(f"voice-actor alias {name!r} belongs to both {owner} and {actor_id}")
                if alias:
                    self._canonical_ids[alias] = actor_id
        self.profiles = self._build_profiles()
        self.profile_by_id = {item["id"]: item for item in self.profiles}
        self.current_role_by_voice_id: dict[str, dict[str, pipeline_common.Any]] = {}
        self.current_roles_by_voice_id: dict[str, list[dict[str, pipeline_common.Any]]] = {}
        self.current_voice_by_character_id: dict[str, str] = {}
        for profile in self.profiles:
            current_roles = [
                role for role in profile.get("roles") or []
                if role.get("character_id") and not role.get("former")
            ]
            self.current_roles_by_voice_id[profile["id"]] = current_roles
            if len(current_roles) == 1:
                self.current_role_by_voice_id[profile["id"]] = current_roles[0]
            for role in current_roles:
                self.current_voice_by_character_id[role["character_id"]] = profile["id"]

    def _build_profiles(self) -> list[dict[str, pipeline_common.Any]]:
        grouped: dict[str, dict[str, pipeline_common.Any]] = {}
        alias_to_group: dict[str, str] = {}
        for row in self.voice_list:
            zh = str(row.get("zh") or "").strip()
            ja = str(row.get("ja") or "").strip()
            key = alias_to_group.get(pipeline_text.fold_name(ja)) or alias_to_group.get(pipeline_text.fold_name(zh)) or pipeline_text.fold_name(ja or zh)
            if not key:
                continue
            grouped.setdefault(key, {"zh": zh or ja, "ja": ja or zh, "aliases": set(), "roles": []})
            grouped[key]["aliases"].update(name for name in (zh, ja) if name)
            for name in (zh, ja):
                if name:
                    alias_to_group[pipeline_text.fold_name(name)] = key
        for row in self.overrides.get("additional_voice_actors") or []:
            zh = str(row.get("zh") or row.get("ja") or "").strip()
            ja = str(row.get("ja") or row.get("zh") or "").strip()
            aliases = [zh, ja, *(row.get("aliases") or [])]
            key = next((alias_to_group.get(pipeline_text.fold_name(name)) for name in aliases if name and alias_to_group.get(pipeline_text.fold_name(name))), "") or pipeline_text.fold_name(ja or zh)
            if not key:
                continue
            record = grouped.setdefault(key, {"zh": zh or ja, "ja": ja or zh, "aliases": set(), "roles": []})
            record["aliases"].update(name for name in aliases if name)
            record.setdefault("anime_credit_sources", []).extend(row.get("anime_credit_sources") or [])
            for name in aliases:
                if name:
                    alias_to_group[pipeline_text.fold_name(name)] = key
            for role in row.get("roles") or []:
                if role.get("character_id") and role["character_id"] not in self.character_by_id:
                    continue
                record["roles"].append({
                    "character_id": str(role.get("character_id") or ""),
                    "name": str(role.get("name") or role.get("name_ja") or ""),
                    "name_ja": str(role.get("name_ja") or role.get("name") or ""),
                    "former": False,
                    "image": str(role.get("image") or ""),
                    "color_main": str(role.get("color_main") or ""),
                    "color_sub": str(role.get("color_sub") or ""),
                })
        for char in self.characters:
            current_ja = str(char.get("cv") or "").strip()
            current_zh = str(char.get("cv_zh") or current_ja).strip()
            for former, former_ja, is_former in (
                (current_zh, current_ja, False),
                (str(char.get("cv_former") or "").strip(), str(char.get("cv_former_ja") or "").strip(), True),
            ):
                if not former and not former_ja:
                    continue
                key = alias_to_group.get(pipeline_text.fold_name(former_ja)) or alias_to_group.get(pipeline_text.fold_name(former)) or pipeline_text.fold_name(former_ja or former)
                record = grouped.setdefault(key, {"zh": former or former_ja, "ja": former_ja or former, "aliases": set(), "roles": []})
                record["aliases"].update(name for name in (former, former_ja) if name)
                for name in (former, former_ja):
                    if name:
                        alias_to_group[pipeline_text.fold_name(name)] = key
                record["roles"].append({
                    "character_id": char.get("id", ""),
                    "name": char.get("role_zh") or char.get("zh") or "",
                    "name_ja": char.get("ja") or "",
                    "former": is_former,
                    "image": char.get("img") or "",
                    "color_main": char.get("main") or "",
                    "color_sub": char.get("sub") or "",
                })
                for char_name in (char.get("zh"), char.get("ja"), char.get("en"), char.get("role_zh")):
                    if char_name:
                        self.character_by_alias[pipeline_text.fold_name(str(char_name))] = str(char.get("id"))

        used_ids = {value for value in self._canonical_ids.values() if value}
        assigned_ids: set[str] = set()
        profiles: list[dict[str, pipeline_common.Any]] = []
        details_by_alias = {}
        for detail in self.profile_details.get("records") or []:
            for name in (detail.get("name_ja"), detail.get("name_zh"), *(detail.get("aliases") or [])):
                if name:
                    details_by_alias[pipeline_text.fold_name(str(name))] = detail
        for key in sorted(grouped):
            record = grouped[key]
            actor_id = next((
                self._canonical_ids.get(pipeline_text.fold_name(name))
                for name in (record["ja"], record["zh"], *record["aliases"])
                if self._canonical_ids.get(pipeline_text.fold_name(name))
            ), "")
            if actor_id in assigned_ids:
                actor_id = ""
            if not actor_id:
                identity_key = pipeline_text.fold_name(record["ja"] or record["zh"])
                actor_id = "va-auto-" + pipeline_common.hashlib.sha1(identity_key.encode("utf-8")).hexdigest()[:12]
                if actor_id in used_ids:
                    raise ValueError(f"deterministic voice-actor ID collision for {record['ja'] or record['zh']}")
                used_ids.add(actor_id)
            assigned_ids.add(actor_id)
            aliases = sorted(set(record["aliases"]), key=lambda value: (value != record["zh"], value))
            detail = next((details_by_alias.get(pipeline_text.fold_name(name)) for name in (record["ja"], record["zh"], *aliases) if details_by_alias.get(pipeline_text.fold_name(name))), {})
            detail = dict(detail)
            photo = self.photos.get(record["zh"]) or self.photos.get(record["ja"]) or {}
            profile_patch = next(
                ((self.overrides.get("voice_actor_profile_overrides") or {}).get(name) for name in (record["ja"], record["zh"], *aliases) if (self.overrides.get("voice_actor_profile_overrides") or {}).get(name)),
                None,
            )
            if profile_patch:
                detail.update({field: value for field, value in profile_patch.items() if field != "sources"})
                detail["sources"] = list({
                    (source.get("kind"), source.get("url")): source
                    for source in [*detail.get("sources", []), *profile_patch.get("sources", [])]
                    if source.get("url")
                }.values())
                statuses = dict(detail.get("field_status") or {})
                for field in ("birthday", "birthplace", "agency", "official_profile"):
                    if profile_patch.get(field):
                        statuses[field] = "verified"
                detail["field_status"] = statuses
                detail["status"] = profile_patch.get("status") or detail.get("status") or "partial"
            profiles.append({
                "id": actor_id,
                "slug": actor_id,
                "identity": {"zh": detail.get("name_zh") or record["zh"], "ja": detail.get("name_ja") or record["ja"], "kana": detail.get("kana") or "", "aliases": aliases},
                "profile": {
                    "birthday": detail.get("birthday") or photo.get("birth") or "",
                    "birthplace": detail.get("birthplace") or "",
                    "agency": detail.get("agency") or "",
                    "official_profile": detail.get("official_profile") or "",
                    "social": detail.get("social") or [],
                    "field_status": detail.get("field_status") or {},
                    "sources": detail.get("sources") or [],
                    "status": detail.get("status") or "partial",
                },
                "photo": {
                    "url": (profile_patch or {}).get("photo_url") or photo.get("img") or detail.get("photo_url") or "",
                    "source_url": (profile_patch or {}).get("photo_source_url") or photo.get("page") or detail.get("photo_source_url") or "",
                    "source_title": (profile_patch or {}).get("photo_source_title") or photo.get("title") or detail.get("photo_source_title") or "",
                },
                "roles": sorted(record["roles"], key=lambda role: (role["former"], role["name"])),
                **({"anime_credit_sources": record["anime_credit_sources"]} if record.get("anime_credit_sources") else {}),
            })
        profiles.sort(key=lambda item: item["id"])
        for profile in profiles:
            names = [profile["identity"]["zh"], profile["identity"]["ja"], *profile["identity"]["aliases"]]
            for name in names:
                if name:
                    self.voice_by_alias[pipeline_text.fold_name(name)] = profile["id"]
        for alias, canonical in (self.overrides.get("voice_aliases") or {}).items():
            resolved = self.voice_by_alias.get(pipeline_text.fold_name(str(canonical)))
            if resolved:
                self.voice_by_alias[pipeline_text.fold_name(str(alias))] = resolved
                profile = next(item for item in profiles if item['id'] == resolved)
                profile['identity']['aliases'] = sorted(set([*profile['identity']['aliases'], str(alias)]),
                    key=lambda value: (value != profile['identity']['zh'], value))
        for alias, character_id in (self.overrides.get("character_aliases") or {}).items():
            if character_id in self.character_by_id:
                self.character_by_alias[pipeline_text.fold_name(str(alias))] = str(character_id)
        return profiles

    def voice_id(self, value: str) -> str:
        text = pipeline_common.re.sub(r"[【\[].*?[】\]]", "", str(value or "")).strip()
        text = pipeline_common.re.sub(r"^(?:(?:仅|僅)?\d+日|两日出演|出演|出走者|嘉宾|ゲスト|実況|实况|向导|司会|MC)[:：]\s*", "", text).strip()
        text = pipeline_common.re.split(r"[（(]", text, maxsplit=1)[0].strip()
        return self.voice_by_alias.get(pipeline_text.fold_name(text), "")

    def character_id(self, value: str) -> str:
        text = pipeline_common.re.sub(r"役$", "", str(value or "")).strip()
        return self.character_by_alias.get(pipeline_text.fold_name(text), "")

    def current_character_id(self, voice_actor_id: str, role_label: str = "") -> str:
        roles = [
            role for role in (self.profile_by_id.get(voice_actor_id) or {}).get("roles") or []
            if role.get("character_id")
        ]
        if role_label:
            matching = [role for role in roles if pipeline_text.fold_name(role_label) in {
                pipeline_text.fold_name(role.get("name") or ""), pipeline_text.fold_name(role.get("name_ja") or "")
            }]
            if len(matching) == 1:
                return str(matching[0]["character_id"])
            requested = self.character_id(role_label)
            if requested:
                return requested if any(str(role.get("character_id") or "") == requested for role in roles) else ""
        current = str((self.current_role_by_voice_id.get(voice_actor_id) or {}).get("character_id") or "")
        if current:
            return current
        return str(roles[0]["character_id"]) if len(roles) == 1 else ""

    def current_voice_id(self, character_id: str) -> str:
        return self.current_voice_by_character_id.get(str(character_id or ""), "")

    def character_payload(self, character_id: str) -> dict[str, pipeline_common.Any]:
        character = self.character_by_id.get(character_id) or {}
        return {
            "id": character_id,
            "name": character.get("zh") or "",
            "name_ja": character.get("ja") or "",
            "name_en": character.get("en") or "",
            "image": character.get("img") or "",
            "color_main": character.get("main") or "",
            "color_sub": character.get("sub") or "",
        }

    def characters_in_text(self, value: str) -> list[str]:
        folded = pipeline_common.unicodedata.normalize("NFKC", value or "").translate(pipeline_common.VFOLD).replace(" ", "")
        name_char = pipeline_common.re.compile(r"[A-Za-z0-9ぁ-ゖァ-ヺー一-龯々〆ヵヶ]")
        boundary_particles = set("とでがはをの")
        matches = []
        for alias, character_id in self.character_by_alias.items():
            if len(alias) < 2 or alias not in folded:
                continue
            for found in pipeline_common.re.finditer(pipeline_common.re.escape(alias), folded):
                start, end = found.span()
                if len(alias) <= 4:
                    left = folded[start - 1] if start else ""
                    right = folded[end] if end < len(folded) else ""
                    left_ok = not left or not name_char.fullmatch(left) or left in boundary_particles
                    right_ok = not right or not name_char.fullmatch(right) or right in boundary_particles
                    if not (left_ok and right_ok):
                        continue
                matches.append((len(alias), start, end, character_id))
        matches.sort(reverse=True)
        chosen = []
        occupied: list[tuple[int, int]] = []
        for _, start, end, character_id in matches:
            if any(start < occupied_end and end > occupied_begin for occupied_begin, occupied_end in occupied):
                continue
            occupied.append((start, end))
            if character_id not in chosen:
                chosen.append(character_id)
        return chosen

    def non_voice_person_type(self, value: str) -> str:
        return self.non_voice_people.get(pipeline_text.fold_name(value), "")


def cast_relation_key(item: dict[str, pipeline_common.Any]) -> tuple[str, ...]:
    actor_id = str(item.get("voice_actor_id") or "")
    character_id = str(item.get("character_id") or "")
    if actor_id and character_id:
        return ("voice_character", actor_id, character_id)
    if actor_id:
        return ("voice_role", actor_id, pipeline_text.fold_name(item.get("role") or ""))
    return (
        "person_role",
        str(item.get("person_type") or ""),
        pipeline_text.fold_name(item.get("name") or ""),
        character_id or pipeline_text.fold_name(item.get("role") or ""),
    )


def merge_cast_records(items: pipeline_common.Iterable[dict[str, pipeline_common.Any]]) -> list[dict[str, pipeline_common.Any]]:
    """Merge one real appearance while retaining every supporting source."""
    out: list[dict[str, pipeline_common.Any]] = []
    by_relation: dict[tuple[str, ...], dict[str, pipeline_common.Any]] = {}
    for raw in items:
        item = dict(raw)
        evidence_sources = [dict(source) for source in item.get("evidence_sources") or []]
        if item.get("evidence"):
            evidence_sources.append({"kind": item["evidence"], "url": item.get("source_url") or ""})
        evidence_sources = list({(source.get("kind"), source.get("url")): source for source in evidence_sources}.values())
        item["evidence_sources"] = evidence_sources
        key = cast_relation_key(item)
        existing = by_relation.get(key)
        if existing is None:
            by_relation[key] = item
            out.append(item)
            continue
        existing["evidence_sources"] = list({
            (source.get("kind"), source.get("url")): source
            for source in [*existing.get("evidence_sources", []), *evidence_sources]
        }.values())
        if not existing.get("source_url") and item.get("source_url"):
            existing["source_url"] = item["source_url"]
        if not existing.get("role") and item.get("role"):
            existing["role"] = item["role"]
        if not existing.get("character_id") and item.get("character_id"):
            existing["character_id"] = item["character_id"]
        if not existing.get('participation_label') and item.get('participation_label'):
            existing['participation_label'] = item['participation_label']

    # Eventernote often confirms only the person while a hand-curated setlist
    # supplies that same person's character. When exactly one richer relation
    # exists, fold the person-only evidence into it instead of showing the cast
    # member twice. Keep the generic row when one actor genuinely has multiple
    # roles and the source does not say which one it supports.
    actor_relations: dict[str, list[dict[str, pipeline_common.Any]]] = pipeline_common.defaultdict(list)
    for item in out:
        actor_id = str(item.get("voice_actor_id") or "")
        if actor_id and (item.get("character_id") or item.get("role")):
            actor_relations[actor_id].append(item)
    merged_generic_ids: set[int] = set()
    for item in out:
        actor_id = str(item.get("voice_actor_id") or "")
        if not actor_id or item.get("character_id") or item.get("role"):
            continue
        richer = actor_relations.get(actor_id) or []
        if len(richer) != 1:
            continue
        target = richer[0]
        target["evidence_sources"] = list({
            (source.get("kind"), source.get("url")): source
            for source in [*target.get("evidence_sources", []), *item.get("evidence_sources", [])]
        }.values())
        if not target.get("source_url") and item.get("source_url"):
            target["source_url"] = item["source_url"]
        merged_generic_ids.add(id(item))
    return [item for item in out if id(item) not in merged_generic_ids]


def make_cast(items: pipeline_common.Iterable[dict[str, pipeline_common.Any]], identities: IdentityIndex, evidence: str, source_url: str = "") -> list[dict[str, pipeline_common.Any]]:
    out: list[dict[str, pipeline_common.Any]] = []
    for item in items:
        name = str(item.get("name") or "").strip()
        role = str(item.get("role") or "").strip()
        actor_id = identities.voice_id(name)
        # Known franchise actors can participate without a catalogued character.
        # Actors with character roles still require an unambiguous casting link.
        if not actor_id:
            if evidence not in {"official_youtube", "official_external", "official_announcement"} and item.get("source_kind") not in {"official_youtube", "official_external", "official_announcement"}:
                continue
            # Preserve an official source's named participant without inventing
            # a voice-actor identity or character relationship.  This is
            # consumed as an unresolved/guest row by the event UI and can be
            # resolved later when the canonical registry gains an alias.
            out.append({
                "voice_actor_id": "",
                "name": name,
                "character_id": "",
                "role": role,
                "evidence": str(item.get("source_kind") or evidence),
                "source_url": str(item.get("source_url") or source_url),
                "person_type": "unresolved_cast",
                "resolution": "unresolved",
                **({'participation_label': item['participation_label']} if item.get('participation_label') else {}),
            })
            continue
        item_evidence = str(item.get("source_kind") or evidence)
        item_source_url = str(item.get("source_url") or source_url)
        character_id = identities.current_character_id(actor_id, role)
        profile = identities.profile_by_id.get(actor_id) or {}
        if not character_id and profile.get("roles"):
            continue
        # A source-side role label disambiguates actors who voice more than one
        # franchise character. Ambiguous rows stay unpublished instead of
        # selecting whichever role happens to sort first.
        character = identities.character_by_id.get(character_id) or {}
        out.append({
            "voice_actor_id": actor_id,
            "name": (profile.get("identity") or {}).get("zh") or name,
            "character_id": character_id,
            "role": character.get("zh") or "",
            "evidence": item_evidence,
            "source_url": item_source_url,
            "person_type": "voice_actor",
            "resolution": "resolved",
            **({'participation_label': item['participation_label']} if item.get('participation_label') else {}),
        })
    return merge_cast_records(out)


def make_character_cast(character_ids: pipeline_common.Iterable[str], identities: IdentityIndex, evidence: str, source_url: str = "") -> list[dict[str, pipeline_common.Any]]:
    """Resolve an official character credit through the canonical current cast."""
    rows = []
    for character_id in dict.fromkeys(str(item or "") for item in character_ids if item):
        actor_id = identities.current_voice_id(character_id)
        profile = identities.profile_by_id.get(actor_id) or {}
        character = identities.character_by_id.get(character_id) or {}
        actor_name = (profile.get("identity") or {}).get("zh") or ""
        character_name = character.get("zh") or ""
        if not actor_name or not character_name:
            continue
        rows.append({
            "name": actor_name,
            "role": character_name,
            "source_kind": evidence,
            "source_url": source_url,
        })
    return make_cast(rows, identities, evidence, source_url)
