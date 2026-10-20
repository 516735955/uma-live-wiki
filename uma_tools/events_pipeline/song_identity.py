"""Song identity responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import text as pipeline_text
from album_identity import stable_album_id


def clean_song(raw: str) -> str:
    value = pipeline_text.clean_text(raw)
    if not value or value == "安可" or "曲名不明" in value or pipeline_common.re.fullmatch(r"MC\d*", value, pipeline_common.re.I):
        return ""
    value = value.replace("\ufe0e", "").replace("\ufe0f", "")
    value = pipeline_common.re.sub(r"\s+([!?！？。、,.])", r"\1", value)
    value = pipeline_common.re.sub(r"\s+", " ", value).strip()
    return value


def table_songs(table: str) -> list[str]:
    return [song for song in (clean_song(match.group(1)) for match in pipeline_common.SONG_RE.finditer(table or "")) if song]


def table_characters(table: str) -> list[str]:
    return list(dict.fromkeys(pipeline_text.clean_text(match.group(1)) for match in pipeline_common.PERFORMER_RE.finditer(table or "") if pipeline_text.clean_text(match.group(1))))


def table_performances(
    table: str,
    identities: "IdentityIndex",
    full_cast_character_ids: pipeline_common.Iterable[str] = (),
) -> list[dict[str, pipeline_common.Any]]:
    performances = []
    full_cast = list(dict.fromkeys(character_id for character_id in full_cast_character_ids if character_id))
    for row_match in pipeline_common.ROW_RE.finditer(table or ""):
        row = row_match.group(1)
        song_match = pipeline_common.SONG_RE.search(row)
        if not song_match:
            continue
        song = clean_song(song_match.group(1))
        if not song:
            continue
        character_ids = []
        for name in table_characters(row):
            character_id = identities.character_id(name)
            if character_id and character_id not in character_ids:
                character_ids.append(character_id)
        if pipeline_common.FULL_CAST_RE.search(pipeline_text.clean_text(row)):
            character_ids = list(dict.fromkeys([*full_cast, *character_ids]))
        performance = {"song": song, "character_ids": character_ids}
        if pipeline_common.SETLIST_NO_RE.search(row):
            performance["setlist_no"] = pipeline_text.clean_text(pipeline_common.SETLIST_NO_RE.search(row).group(1)).strip()
        guest_performers = list(dict.fromkeys(
            pipeline_text.clean_text(match.group(1))
            for match in pipeline_common.GUEST_PERFORMER_RE.finditer(row)
            if pipeline_text.clean_text(match.group(1))
        ))
        if guest_performers:
            performance["guest_performers"] = guest_performers
        performances.append(performance)
    return performances


def fold_song_key(value: str) -> str:
    normalized = pipeline_common.unicodedata.normalize("NFKC", clean_song(value)).lower()
    normalized = normalized.replace("’", "'").replace("‘", "'").replace("・", "·")
    return pipeline_common.re.sub(r"\s+", "", normalized)


def pop_trailing_song_group(value: str) -> tuple[str, str] | None:
    """Return the final balanced ASCII/full-width parenthetical group."""
    text = value.strip()
    if not text or text[-1] not in ")）":
        return None
    closing = text[-1]
    opening = "(" if closing == ")" else "（"
    depth = 0
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        if char == closing:
            depth += 1
        elif char == opening:
            depth -= 1
            if depth == 0:
                candidate = text[:index].strip()
                label = text[index + 1:-1].strip()
                return (candidate, label) if candidate and label else None
    return None


def split_song_version(title: str, identities: "IdentityIndex", known_titles: set[str]) -> tuple[str, str]:
    """Split only explicit version/performer suffixes; preserve ambiguous title text."""
    base = clean_song(title)
    labels: list[str] = []
    while base:
        bracket_match = pipeline_common.re.match(r"^(.*?)\s*\[([^\[\]]+)\]\s*$", base)
        if (
            bracket_match
            and bracket_match.group(1).strip()
            and (
                pipeline_common.SONG_VERSION_HINT_RE.search(bracket_match.group(2))
                or pipeline_common.SONG_VERSION_HINT_RE.search(bracket_match.group(1))
                or fold_song_key(bracket_match.group(1)) in known_titles
            )
        ):
            base = bracket_match.group(1).strip()
            labels.insert(0, bracket_match.group(2).strip())
            continue
        note_match = pipeline_common.re.match(r"^(.*?)\s*※\s*(.+)$", base)
        if note_match and note_match.group(1).strip():
            base = note_match.group(1).strip()
            labels.insert(0, note_match.group(2).strip())
            continue
        dash_match = pipeline_common.re.match(r"^(.*?)\s+[-‐‑–—―]\s*(.+?)\s*[-‐‑–—―]?\s*$", base)
        if (
            dash_match
            and dash_match.group(1).strip()
            and fold_song_key(dash_match.group(1)) in known_titles
            and pipeline_common.SONG_VERSION_HINT_RE.search(dash_match.group(2))
        ):
            base = dash_match.group(1).strip()
            labels.insert(0, dash_match.group(2).strip())
            continue
        suffix = pop_trailing_song_group(base)
        if not suffix:
            break
        candidate, label = suffix
        character_id = identities.character_id(label)
        should_split = bool(
            pipeline_common.SONG_VERSION_HINT_RE.search(label)
            or character_id
            or fold_song_key(candidate) in known_titles
        )
        if not should_split:
            break
        base = candidate
        labels.insert(0, f"角色独唱：{label}" if character_id else label)
    normalized_labels = []
    for label in labels:
        value = pipeline_common.re.sub(r"(?i)\bshort\s+ver(?:sion)?\.?", "Short Ver.", label).strip()
        normalized_labels.append(value)
    return base or clean_song(title), " / ".join(label for label in normalized_labels if label)


def song_version_override(title: str, overrides: dict[str, pipeline_common.Any] | None) -> tuple[str, str] | None:
    """Resolve an explicit base/label split declared in overrides['song_versions']."""
    table = (overrides or {}).get("song_versions") or {}
    if not table:
        return None
    key = fold_song_key(title)
    for alias, target in table.items():
        if fold_song_key(str(alias)) != key:
            continue
        if isinstance(target, dict):
            base = str(target.get("base") or "").strip()
            label = str(target.get("label") or title).strip()
        else:
            base = str(target or "").strip()
            label = clean_song(title)
        if base:
            return base, label
    return None


def song_version_config(title: str, overrides: dict[str, pipeline_common.Any] | None) -> dict[str, pipeline_common.Any]:
    """Return the full exact-title override while keeping the tuple API stable."""
    table = (overrides or {}).get("song_versions") or {}
    key = fold_song_key(title)
    for alias, target in table.items():
        if fold_song_key(str(alias)) != key:
            continue
        if isinstance(target, dict):
            return dict(target)
        return {"base": str(target or ""), "label": clean_song(title)}
    return {}


def stable_song_id(title: str) -> str:
    normalized = pipeline_common.unicodedata.normalize("NFKC", title or "").strip()
    folded = fold_song_key(normalized)
    readable = pipeline_text.stable_suffix(folded)[:40]
    digest = pipeline_common.hashlib.sha1(folded.encode("utf-8")).hexdigest()[:10]
    return "song-" + ((readable + "-") if readable else "") + digest


def stable_version_id(song_id: str, title: str) -> str:
    digest = pipeline_common.hashlib.sha1(fold_song_key(title).encode("utf-8")).hexdigest()[:10]
    return f"{song_id}-v-{digest}"


def is_instrumental_track(title: str, artist: str) -> bool:
    value = pipeline_common.unicodedata.normalize("NFKC", f"{title} {artist}")
    return bool(pipeline_common.re.search(r"(?:off[ -]?vocal|instrumental|\binst\.?\b|\bBGM\b|纯音乐|伴奏)", value, pipeline_common.re.I))


def is_short_recording(title: str, label: str = "") -> bool:
    value = pipeline_common.unicodedata.normalize("NFKC", f"{title} {label}")
    return bool(pipeline_common.re.search(r"(?:game|tv|anime|short|1\s*chorus|ワンコーラス|ゲーム|アニメ)\s*(?:size|ver(?:sion)?\.?)?", value, pipeline_common.re.I))


def select_original_version(work: dict[str, pipeline_common.Any], overrides: dict[str, pipeline_common.Any]) -> str:
    versions = list(work["versions"].values())
    version_overrides = overrides.get("versions") or {}
    marked = [version for version in versions if (version_overrides.get(version["id"]) or {}).get("original_for_song")]
    if marked:
        return marked[0]["id"]
    exact = [
        version for version in versions
        if fold_song_key(version["title"]) == fold_song_key(work["title"])
        and not version.get("instrumental")
        and version.get("releases")
    ]
    if exact:
        return min(
            exact,
            key=lambda row: (min((release.get("release_date") or "9999-99-99") for release in row["releases"]), fold_song_key(row["title"]), row["id"]),
        )["id"]
    released = [version for version in versions if not version.get("instrumental") and version.get("releases")]
    if released:
        return min(
            released,
            key=lambda row: (min((release.get("release_date") or "9999-99-99") for release in row["releases"]), fold_song_key(row["title"]), row["id"]),
        )["id"]
    vocal = [version for version in versions if not version.get("instrumental")]
    return (vocal or versions)[0]["id"] if versions else ""


def effective_music_metadata(
    work: dict[str, pipeline_common.Any],
    credits_doc: dict[str, pipeline_common.Any],
    lyrics_doc: dict[str, pipeline_common.Any],
    timings_doc: dict[str, pipeline_common.Any],
    overrides_doc: dict[str, pipeline_common.Any],
) -> str:
    versions = list(work["versions"].values())
    versions_by_id = {version["id"]: version for version in versions}
    source_credits = credits_doc.get("versions") or {}
    source_lyrics = lyrics_doc.get("versions") or {}
    source_timings = timings_doc.get("versions") or {}
    overrides = overrides_doc.get("versions") or {}
    original_id = select_original_version(work, overrides_doc)
    original_credits = list((source_credits.get(original_id) or {}).get("credits") or [])

    def inherited_document(source: dict[str, pipeline_common.Any], version_id: str, fallback=None):
        """Resolve override parent chains transitively, with cycle protection."""
        seen: set[str] = set()
        current = version_id
        merged = []
        while current and current not in seen:
            seen.add(current)
            row = source.get(current) or {}
            values = list(row.get("credits") or []) if "credits" in row else list(row.get("lines") or [])
            if values:
                merged = values + merged
            current = str((overrides.get(current) or {}).get("parent_version_id") or "")
        return merged or list(fallback or [])

    for version in versions:
        version_id = version["id"]
        version_override = overrides.get(version_id) or {}
        parent_id = version_override.get("parent_version_id") or original_id
        parent_credits = inherited_document(source_credits, parent_id, original_credits)
        explicit = list((source_credits.get(version_id) or {}).get("credits") or [])
        explicit_roles = {row.get("role") for row in explicit if row.get("role")}
        credits = explicit + [row for row in parent_credits if row.get("role") not in explicit_roles]
        deduped: list[dict[str, pipeline_common.Any]] = []
        seen_credit: set[tuple[str, str]] = set()
        for credit in credits:
            key = (str(credit.get("role") or ""), str(credit.get("creator_id") or credit.get("name") or ""))
            if not key[0] or not key[1] or key in seen_credit:
                continue
            seen_credit.add(key)
            deduped.append({
                "role": credit["role"],
                "role_label": pipeline_common.CREATOR_ROLE_LABELS.get(credit["role"], credit["role"]),
                "creator_id": credit.get("creator_id") or "",
                **({"institution": credit["affiliation"]} if credit.get("affiliation") else {}),
                **({"organization": credit["organization"]} if credit.get("organization") else {}),
            })
        deduped.sort(key=lambda row: (pipeline_common.CREATOR_ROLE_ORDER.get(row["role"], 99), row.get("creator_id") or ""))
        # The catalog stores compact stable references. Creator names and the
        # lyric document are joined only for one song-detail response by the
        # local server, rather than copied into every generated catalog row.
        version["credits"] = deduped
        version["creator_ids"] = sorted({row["creator_id"] for row in deduped if row.get("creator_id")})

        lyric_source_id = str(version_override.get("lyrics_from") or version_id)
        lyric = source_lyrics.get(lyric_source_id)
        timing = source_timings.get(lyric_source_id)
        if (
            not lyric
            and not version.get("instrumental")
            and not is_short_recording(version.get("title") or "", version.get("version_label") or "")
        ):
            lyric_source_id = str(version_override.get("lyrics_from") or parent_id)
            lyric = source_lyrics.get(lyric_source_id)
            timing = source_timings.get(lyric_source_id)
            visited = set()
            while not lyric and lyric_source_id and lyric_source_id not in visited:
                visited.add(lyric_source_id)
                source_override = overrides.get(lyric_source_id) or {}
                next_id = str(source_override.get("lyrics_from") or source_override.get("parent_version_id") or "")
                if not next_id:
                    break
                lyric_source_id = next_id
                lyric = source_lyrics.get(lyric_source_id)
                timing = source_timings.get(lyric_source_id)
        if version.get("instrumental") or version_override.get("no_lyrics"):
            lyric = None
            timing = None
        version["lyrics_ref"] = lyric_source_id if lyric and (lyric.get("uses_all_lines") or lyric.get("line_ids") or lyric.get("lines")) else ""
        version["has_lyrics"] = bool(version["lyrics_ref"])
        version["has_timing"] = bool(version["lyrics_ref"] and timing and timing.get("lines"))
    return original_id
