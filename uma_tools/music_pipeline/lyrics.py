"""Lyrics responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import credits as pipeline_credits
from . import recordings as pipeline_recordings


def normalize_lyric_line(value: str) -> str:
    """Normalize source typography without changing lyric wording or casing."""
    text = pipeline_common.unicodedata.normalize("NFC", pipeline_common.html.unescape(str(value or "")))
    text = text.translate(str.maketrans({
        chr(code): chr(code - 0xFEE0)
        for code in [*range(ord("０"), ord("９") + 1), *range(ord("Ａ"), ord("Ｚ") + 1), *range(ord("ａ"), ord("ｚ") + 1)]
    }))
    text = text.translate(str.maketrans({"’": "'", "‘": "'", "`": "'", "´": "'"}))
    text = pipeline_common.re.sub(r"(?:\.{3,}|…{2,})", "…", text)
    text = text.replace("!", "！").replace("?", "？")
    text = pipeline_common.re.sub(r"[\t\r\n\u00a0 ]+", " ", text).strip()
    text = pipeline_common.re.sub(r"\s+([,，。.!！?？:：;；])", r"\1", text)
    text = pipeline_common.re.sub(r"[,，]\s*", ", ", text).rstrip()
    text = pipeline_common.re.sub(r"(?i)([A-Za-z])'(til|cause|em)\b", r"\1 '\2", text)
    return text


def normalize_lyric_lines(lines: list[str]) -> list[str]:
    raw = [str(line or "").strip() for line in lines if str(line or "").strip()]
    if not raw:
        return []
    appended_punctuation = sum(bool(pipeline_common.re.search(r"[,，。.]\s*$", line)) for line in raw) / len(raw) >= 0.8
    normalized = []
    for line in raw:
        value = normalize_lyric_line(line)
        if appended_punctuation:
            value = pipeline_common.re.sub(r"[,，。.]\s*$", "", value).rstrip()
        if value:
            normalized.append(value)
    return normalized


def lyric_document_lines(lyrics: dict[str, pipeline_common.Any], version_id: str) -> list[str]:
    row = (lyrics.get("versions") or {}).get(version_id) or {}
    if isinstance(row.get("lines"), list):
        return normalize_lyric_lines([str(line) for line in row.get("lines") or []])
    document = (lyrics.get("documents") or {}).get(str(row.get("document_id") or "")) or {}
    document_lines = list(document.get("lines") or [])
    by_id = {str(line.get("id") or ""): str(line.get("text") or "") for line in document_lines}
    line_ids = row.get("line_ids") or ([line.get("id") for line in document_lines] if row.get("uses_all_lines") else [])
    return [by_id[line_id] for line_id in line_ids if line_id in by_id]


def lyric_line_key(value: str) -> str:
    # Keep every Unicode letter/number.  The previous ASCII/Japanese allow-list
    # silently removed accented Latin (for example ``café`` became ``caf``),
    # causing distinct lyric lines to collide during timing alignment.
    normalized = pipeline_common.unicodedata.normalize("NFKC", str(value or "")).lower()
    return "".join(char for char in normalized if char.isalnum() or char == "ー")


def lyric_subsequence(needle: list[str], haystack: list[str]) -> list[int] | None:
    """Return the occurrence-aware positions of one exact lyric sequence."""
    positions: list[int] = []
    cursor = 0
    haystack_keys = [lyric_line_key(line) for line in haystack]
    for line in needle:
        key = lyric_line_key(line)
        try:
            index = haystack_keys.index(key, cursor)
        except ValueError:
            return None
        positions.append(index)
        cursor = index + 1
    return positions


def stable_lyric_line_id(document_id: str, text: str, occurrence: int) -> str:
    digest = pipeline_common.hashlib.sha1(f"{document_id}\0{text}\0{occurrence}".encode("utf-8")).hexdigest()[:12]
    return f"lyric-line-{digest}"


def timing_line_positions(lines: list[str], document: list[str]) -> list[int | None]:
    """Match ordered timing text, including one source line split in the document."""
    keys = [lyric_line_key(line) for line in document]
    positions: list[int | None] = []
    cursor = 0
    for line in lines:
        target = lyric_line_key(line)
        found = None
        if target:
            for start in range(cursor, len(keys)):
                joined = ""
                for end in range(start, len(keys)):
                    joined += keys[end]
                    if joined == target:
                        found = start
                        cursor = end + 1
                        break
                    if not target.startswith(joined):
                        break
                if found is not None:
                    break
        positions.append(found)
    return positions


def canonicalize_lyrics(
    recordings: dict[str, dict[str, pipeline_common.Any]],
    lyrics: dict[str, pipeline_common.Any],
    timings: dict[str, pipeline_common.Any],
) -> tuple[dict[str, pipeline_common.Any], dict[str, pipeline_common.Any]]:
    """Build shared lyric documents and migrate per-recording timing references."""
    source_versions = lyrics.get("versions") or {}
    source_documents = lyrics.get("documents") or {}
    raw_by_version: dict[str, list[str]] = {}
    metadata_by_version: dict[str, dict[str, pipeline_common.Any]] = {}
    for version_id, row in source_versions.items():
        raw_lines = list(row.get("raw_lines") or [])
        if not raw_lines:
            if isinstance(row.get("lines"), list):
                raw_lines = [str(line) for line in row.get("lines") or []]
            else:
                document = source_documents.get(str(row.get("document_id") or "")) or {}
                document_lines = list(document.get("lines") or [])
                by_id = {str(line.get("id") or ""): str(line.get("text") or "") for line in document_lines}
                line_ids = row.get("line_ids") or ([line.get("id") for line in document_lines] if row.get("uses_all_lines") else [])
                raw_lines = [by_id[line_id] for line_id in line_ids if line_id in by_id]
                for index, text in (row.get("raw_line_overrides") or {}).items():
                    position = int(index)
                    if 0 <= position < len(raw_lines):
                        raw_lines[position] = str(text)
        raw_by_version[version_id] = raw_lines
        metadata_by_version[version_id] = {
            key: value for key, value in row.items()
            if key not in {"lines", "raw_lines", "raw_line_overrides", "document_id", "line_ids", "uses_all_lines"}
        }

    versions_by_song: dict[str, list[str]] = {}
    for version_id in raw_by_version:
        recording = recordings.get(version_id) or {}
        song_id = str(recording.get("song_id") or version_id)
        versions_by_song.setdefault(song_id, []).append(version_id)

    documents: dict[str, dict[str, pipeline_common.Any]] = {}
    migrated_versions: dict[str, dict[str, pipeline_common.Any]] = {}
    for song_id, version_ids in sorted(versions_by_song.items()):
        ordered = sorted(version_ids, key=lambda item: (-len(normalize_lyric_lines(raw_by_version[item])), item))
        clusters: list[dict[str, pipeline_common.Any]] = []
        for version_id in ordered:
            normalized = normalize_lyric_lines(raw_by_version[version_id])
            if not normalized:
                continue
            sequence = lyric_line_key("".join(normalized))
            match = next((cluster for cluster in clusters if
                          (sequence == lyric_line_key("".join(cluster["lines"])) and not any(key.startswith('translat') for key in metadata_by_version[version_id]))
                          or lyric_subsequence(normalized, cluster["lines"]) is not None), None)
            if match is None:
                match = {"lines": normalized, "versions": []}
                clusters.append(match)
            match["versions"].append(version_id)

        for cluster_index, cluster in enumerate(clusters):
            normalized = cluster["lines"]
            if cluster_index == 0:
                document_id = f"{song_id}-lyrics"
            else:
                digest = pipeline_common.hashlib.sha1("\n".join(normalized).encode("utf-8")).hexdigest()[:10]
                document_id = f"{song_id}-lyrics-{digest}"
            occurrences: dict[str, int] = {}
            document_lines = []
            for text in normalized:
                occurrences[text] = occurrences.get(text, 0) + 1
                document_lines.append({
                    "id": stable_lyric_line_id(document_id, text, occurrences[text]),
                    "text": text,
                })
            documents[document_id] = {
                "language": metadata_by_version[cluster["versions"][0]].get("language") or "",
                "lines": document_lines,
            }
            for version_id in cluster["versions"]:
                source_lines = normalize_lyric_lines(raw_by_version[version_id])
                positions = lyric_subsequence(source_lines, normalized)
                reflowed = positions is None and lyric_line_key("".join(source_lines)) == lyric_line_key("".join(normalized))
                if reflowed:
                    positions = list(range(len(normalized)))
                if positions is None:
                    continue
                row = dict(metadata_by_version[version_id])
                row["document_id"] = document_id
                selected_ids = [document_lines[index]["id"] for index in positions]
                if positions == list(range(len(document_lines))):
                    row["uses_all_lines"] = True
                else:
                    row["line_ids"] = selected_ids
                raw_lines = raw_by_version[version_id]
                canonical_lines = [document_lines[index]["text"] for index in positions]
                raw_overrides = {
                    str(index): raw
                    for index, (raw, canonical) in enumerate(zip(raw_lines, canonical_lines))
                    if raw != canonical
                }
                if reflowed:
                    row["raw_lines"] = raw_lines
                elif raw_overrides:
                    row["raw_line_overrides"] = raw_overrides
                migrated_versions[version_id] = row

    timing_versions: dict[str, pipeline_common.Any] = {}
    for version_id, source in (timings.get("versions") or {}).items():
        lyric_row = migrated_versions.get(version_id) or {}
        document_id = str(lyric_row.get("document_id") or "")
        document = documents.get(document_id) or {}
        text_by_id = {str(line.get("id") or ""): str(line.get("text") or "") for line in document.get("lines") or []}
        expected_ids = list(lyric_row.get("line_ids") or ([line.get("id") for line in document.get("lines") or []] if lyric_row.get("uses_all_lines") else []))
        expected_text = [text_by_id.get(line_id, "") for line_id in expected_ids]
        raw_timing_lines = list(source.get("lines") or [])
        previous_document = source_documents.get(str(source.get("lyric_document_id") or "")) or {}
        previous_text_by_id = {
            str(line.get("id") or ""): str(line.get("text") or "")
            for line in previous_document.get("lines") or []
        }
        raw_timing_text = [
            str(
                line.get("text")
                or line.get("source_text")
                or previous_text_by_id.get(str(line.get("line_id") or ""))
                or ""
            )
            for line in raw_timing_lines
        ]
        normalized_timing = [normalize_lyric_line(text) for text in raw_timing_text]
        positions = timing_line_positions(normalized_timing, expected_text)
        aligned_ids = [expected_ids[index] if index is not None else "" for index in positions]
        lines = []
        for index, item in enumerate(raw_timing_lines):
            raw_text = raw_timing_text[index]
            normalized_text = normalized_timing[index] if index < len(normalized_timing) else ""
            line_id = aligned_ids[index] if index < len(aligned_ids) else ""
            migrated = {"start_ms": int(item.get("start_ms") or 0), "line_id": line_id}
            canonical_text = text_by_id.get(line_id, "")
            if not line_id or not normalized_text or normalized_text != canonical_text or raw_text != canonical_text:
                migrated["source_text"] = raw_text
            lines.append(migrated)
        starts = [line["start_ms"] for line in lines]
        monotonic = all(current >= previous for previous, current in zip(starts, starts[1:]))
        matched = sum(bool(line.get("line_id")) for line in lines)
        alignment = "complete" if lines and matched == len(lines) and monotonic else ("partial" if matched else "review")
        timing_versions[version_id] = {
            **{key: value for key, value in source.items() if key != "lines"},
            "recording_id": version_id,
            "lyric_document_id": document_id,
            "alignment": alignment,
            "lines": lines,
        }

    return (
        {"schema_version": 2, "documents": documents, "versions": migrated_versions},
        {"schema_version": 2, "versions": timing_versions},
    )


def milliseconds(minutes: str, seconds: str, fraction: str | None) -> int:
    digits = fraction or "0"
    fraction_ms = int((digits + "000")[:3])
    return (int(minutes) * 60 + int(seconds)) * 1000 + fraction_ms


def parse_lyric(raw: str) -> tuple[list[dict[str, pipeline_common.Any]], list[dict[str, str]]]:
    timed: list[dict[str, pipeline_common.Any]] = []
    credits: list[dict[str, str]] = []
    seen_credits: set[tuple[str, str]] = set()
    offset_match = pipeline_common.re.search(r'\[offset:\s*([+-]?\d+)\]', str(raw or ''), pipeline_common.re.I)
    offset = int(offset_match.group(1)) if offset_match else 0
    # UTF-8 BOMs are occasionally present in downloaded LRC files.  Treat the
    # marker as transport metadata so the first timestamp is not discarded.
    for source_line in str(raw or "").lstrip("\ufeff").replace("\r", "").split("\n"):
        match = pipeline_common.TIMED_LINE_RE.match(source_line.strip())
        if not match:
            continue
        stamps = list(pipeline_common.re.finditer(r'\[(\d+):(\d{1,2})(?:[.:](\d+))?\]', source_line))
        text = source_line[stamps[-1].end():].strip() if stamps else match.group(4).strip()
        if not text:
            continue
        credit_match = pipeline_common.CREDIT_LINE_RE.match(text)
        if credit_match:
            role = pipeline_common.ROLE_LABELS.get(credit_match.group(1).lower(), pipeline_common.ROLE_LABELS.get(credit_match.group(1), ""))
            for raw_name in pipeline_credits.split_creators(credit_match.group(2)):
                name, affiliations = pipeline_credits.creator_identity(raw_name)
                key = (role, pipeline_recordings.normalized_name(name))
                if not role or not name or key in seen_credits:
                    continue
                seen_credits.add(key)
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
            continue
        if pipeline_common.COMBINED_CREDIT_RE.match(text):
            # Rare combined labels are kept out rather than assigning the same
            # person to roles that cannot be separated with confidence.
            continue
        if pipeline_common.re.match(r"^(?:纯音乐|純音楽|instrumental|off\s*vocal)$", text, pipeline_common.re.I):
            continue
        if pipeline_common.NO_LYRIC_RE.match(text):
            continue
        for stamp in stamps:
            timed.append({"start_ms": max(0, milliseconds(*stamp.groups()) - offset), "text": text})
    timed.sort(key=lambda row: row['start_ms'])
    return timed, credits


def clean_wiki_lyric_cell(value: str) -> list[str]:
    text = pipeline_common.re.sub(r"<ref\b[^>]*>[\s\S]*?</ref>|<ref\b[^>]*/>", "", value, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"<br\s*/?>", "\n", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"\{\{\s*(?:ruby|furigana)\s*\|\s*([^|{}]+)\|[^{}]*\}\}", r"\1", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"\{\{\s*(?:color|lang)\s*\|[^{}|]+\|\s*([^{}]+)\}\}", r"\1", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = pipeline_common.re.sub(r"\[\[[^]|]+\|([^]]+)\]\]", r"\1", text)
    text = pipeline_common.re.sub(r"\[\[([^]]+)\]\]", r"\1", text)
    text = pipeline_recordings.clean_markup(text.replace("'''", "").replace("''", ""))
    return [pipeline_common.re.sub(r"[\t ]+", " ", line).strip() for line in text.splitlines() if line.strip()]


def parse_wiki_song(page: dict[str, pipeline_common.Any], original_versions: dict[str, str]) -> tuple[str, list[str]]:
    source = page.get("wikitext") or ""
    title_match = pipeline_common.re.search(r"^\s*\|\s*title_jp\s*=\s*(.+?)\s*$", source, pipeline_common.re.I | pipeline_common.re.M)
    if not title_match:
        return "", []
    version_id = original_versions.get(pipeline_recordings.folded_title(pipeline_recordings.clean_markup(title_match.group(1)))) or ""
    if not version_id:
        return "", []
    section_match = pipeline_common.re.search(r"^==\s*Lyrics\s*==\s*$([\s\S]*?)(?=^==[^=]|\Z)", source, pipeline_common.re.I | pipeline_common.re.M)
    if not section_match:
        return "", []
    table_match = pipeline_common.re.search(r"\{\|[^\n]*\blyrics\b[^\n]*\n([\s\S]*?)\n\|\}", section_match.group(1), pipeline_common.re.I)
    if not table_match:
        return "", []
    lines: list[str] = []
    for row in pipeline_common.re.split(r"\n\|-\s*\n", table_match.group(1)):
        row = row.strip()
        if not row or row.startswith("!"):
            continue
        cell_lines = row.splitlines()
        first_index = next((index for index, line in enumerate(cell_lines) if line.startswith("|") and not line.startswith("|-")), -1)
        if first_index < 0:
            continue
        first_cell: list[str] = [cell_lines[first_index][1:].lstrip()]
        for line in cell_lines[first_index + 1:]:
            if line.startswith("|"):
                break
            first_cell.append(line)
        lines.extend(clean_wiki_lyric_cell("\n".join(first_cell).split("||", 1)[0]))
    if len(lines) < 4 or not pipeline_common.re.search(r"[ぁ-ゟ゠-ヿ一-龯]", "".join(lines)):
        return "", []
    return version_id, lines


def language_of(lines: list[dict[str, pipeline_common.Any]]) -> str:
    text = "".join(str(line.get("text") or "") for line in lines)
    if pipeline_common.re.search(r"[ぁ-ゟ゠-ヿ]", text):
        return "ja"
    if pipeline_common.re.search(r"[一-龯]", text):
        return "zh-Hans"
    return "en"


def folded_lyric(lines: list[str]) -> str:
    return pipeline_common.re.sub(
        r"[^0-9a-zぁ-んァ-ヶー一-龯]+",
        "",
        pipeline_common.unicodedata.normalize("NFKC", "".join(lines)).lower(),
    )
