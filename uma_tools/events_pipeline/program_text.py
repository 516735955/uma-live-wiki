"""Program text responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import text as pipeline_text


def program_identity(title: str) -> tuple[str, str]:
    normalized = pipeline_common.unicodedata.normalize("NFKC", title or "")
    # Gold Ship's GW parody is a special, not the 564th regular episode.
    if pipeline_common.re.search(r'ゴルシちゃんのGW計画.*Vol\.?\s*564', normalized, pipeline_common.re.I):
        return '', ''
    match = pipeline_common.re.search(r"そこそこぱかライブTV\s*Vol\.?\s*(\d+)", normalized, pipeline_common.re.I)
    if match:
        number = int(match.group(1))
        return f"sokosoko-paka-live-tv-{number:03d}", "sokosoko-paka-live-tv"
    match = pipeline_common.re.search(r"ぱかライブTV\s*['’]\s*#\s*(\d+)", normalized, pipeline_common.re.I)
    if match:
        number = int(match.group(1))
        return f"paka-live-tv-prime-{number:03d}", "paka-live-tv-prime"
    match = pipeline_common.re.search(r"ぱかライブTV\s*Vol\.?\s*(\d+)", normalized, pipeline_common.re.I)
    if match:
        number = int(match.group(1))
        return f"paka-live-tv-{number:03d}", "paka-live-tv"
    return "", ""


def canonical_program_title(title: str) -> str:
    """Return the stable Japanese display title for numbered programmes."""
    identity, series_id = program_identity(title)
    if not identity:
        return (title or "").strip()
    number = identity.rsplit("-", 1)[-1].lstrip("0") or "0"
    names = {
        "paka-live-tv": "ぱかライブTV",
        "paka-live-tv-prime": "ぱかライブTV'",
        "sokosoko-paka-live-tv": "そこそこぱかライブTV",
    }
    base = f"{names[series_id]} {'#' if series_id == 'paka-live-tv-prime' else 'Vol.'}{number}"
    normalized = pipeline_common.unicodedata.normalize("NFKC", title or "")
    # Preserve real special-edition subtitles while discarding announcement
    # prose around the numbered programme name.
    episode = pipeline_common.re.search(r"(?:Vol\.?|#)\s*\d+", normalized, pipeline_common.re.I)
    suffix = normalized[episode.end():].strip(' 「」『』　!！') if episode else ''
    if (suffix and pipeline_common.re.search(r'周年|スペシャル|振り返り|特別|出張', suffix)
            and not pipeline_common.re.search(r'決定|お届け|日時|放送します|配信します', suffix)):
        return f"{base} {suffix}"
    return base


def expected_regular_program_ids(rows: pipeline_common.Iterable[dict[str, pipeline_common.Any]]) -> dict[tuple[str, int], str]:
    observed = {series_id: set() for series_id in pipeline_common.REGULAR_PROGRAM_BASELINES}
    for row in rows:
        event_id, series_id = program_identity(row.get("title") or "")
        if not event_id or series_id not in observed:
            continue
        is_channel_inventory = row.get("channel_id") == pipeline_common.OFFICIAL_CHANNEL_ID
        is_verified_source = bool(row.get("date") and (row.get("source_url") or row.get("url")))
        if is_channel_inventory or is_verified_source:
            observed[series_id].add(int(event_id.rsplit("-", 1)[1]))
    expected = {}
    for series_id, baseline in pipeline_common.REGULAR_PROGRAM_BASELINES.items():
        maximum = baseline
        while maximum + 1 in observed[series_id]:
            maximum += 1
        for number in range(1, maximum + 1):
            expected[(series_id, number)] = f"{series_id}-{number:03d}"
    return expected


def program_text_lines(value: str) -> list[str]:
    text = pipeline_common.html.unescape(str(value or ""))
    text = pipeline_common.re.sub(r"<br\s*/?>", "\n", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"</?(?:p|div|li|h\d|section|figure|strong)\b[^>]*>", "\n", text, flags=pipeline_common.re.I)
    text = pipeline_common.HTML_TAG_RE.sub("", text)
    return [line.strip() for line in text.splitlines()]


def parse_program_cast_line(line: str) -> dict[str, str] | None:
    value = pipeline_common.re.sub(r"[【\[].*?[】\]]", "", line or "").strip()
    if pipeline_common.re.search(r"\.\.\.|…|and more|について|として|決定|更新|情報|コラボ|^[・［\[]|^は", value, pipeline_common.re.I):
        return None
    match = pipeline_common.re.match(r"([^（(]+?)[（(]([^）)]+?)(?:役)?[）)]", value)
    if match:
        name = pipeline_common.re.sub(r"さん$", "", match.group(1).strip())
        role = pipeline_common.re.sub(r"役$", "", match.group(2).strip())
        if pipeline_common.re.search(r"https?://|公式(?:HP|サイト)|詳細", name + role, pipeline_common.re.I):
            return None
        return {"name": name, "role": role} if name else None
    role_first = pipeline_common.re.match(r"(.+?)役\s+([^\s]+)$", value)
    if role_first:
        role = role_first.group(1).strip()
        name = pipeline_common.re.sub(r"さん$", "", role_first.group(2).strip())
        return {"name": name, "role": role} if name else None
    if value and len(value) < 30 and not pipeline_common.re.search(r"[:：]|全員|ほか|予定|変更", value):
        return {"name": value, "role": ""}
    return None


def parse_program_sessions(description: str, default_date: str = "") -> list[dict[str, pipeline_common.Any]]:
    lines = program_text_lines(description)
    session_dates: dict[str, str] = {}
    for line in lines:
        schedule = pipeline_common.re.match(r"(?:■\s*)?(DAY\s*\d+|前編|後編)\s*[:：]", line, pipeline_common.re.I)
        if schedule:
            value = pipeline_text.first_date(line)
            if value:
                session_dates[pipeline_text.fold_name(schedule.group(1))] = value
    sessions = []
    for index, line in enumerate(lines):
        heading = pipeline_common.re.fullmatch(r"(?:■\s*)?(?:(DAY\s*\d+|前編|後編)\s*)?(?:出走者|出演者|出演)[:：]?", line, pipeline_common.re.I)
        if not heading:
            continue
        label = (heading.group(1) or "本期节目").strip()
        cast = []
        for candidate in lines[index + 1:]:
            if pipeline_common.re.fullmatch(r"(?:■\s*)?(?:(?:DAY\s*\d+|前編|後編)\s*)?(?:出走者|出演者|出演)[:：]?", candidate, pipeline_common.re.I):
                break
            if not candidate:
                if cast:
                    break
                continue
            if candidate.startswith(("※", "番組", "放送", "配信", "視聴", "URL", "http", "「ウマ娘", "©")):
                break
            parsed = parse_program_cast_line(candidate)
            if parsed:
                cast.append(parsed)
            elif cast:
                break
        if cast:
            sessions.append({"label": label, "date": session_dates.get(pipeline_text.fold_name(label), default_date), "cast": cast})
    return sessions


def parse_program_cast(description: str) -> list[dict[str, str]]:
    out = []
    seen = set()
    for session in parse_program_sessions(description):
        for item in session["cast"]:
            key = (pipeline_text.fold_name(item["name"]), pipeline_text.fold_name(item["role"]))
            if key not in seen:
                seen.add(key)
                out.append(item)
    return out


def parse_intro_cast(description: str) -> list[dict[str, str]]:
    """Read explicitly credited role pairs before a program-outline section."""
    prefix = pipeline_common.re.split(r"(?:番組概要|■番組名)", "\n".join(program_text_lines(description)), maxsplit=1)[0]
    out = []
    seen = set()
    for match in pipeline_common.re.finditer(r"([ぁ-ゖァ-ヺー一-龯々〆ヵヶA-Za-z・]+?)(?:さん)?[（(]([^）)\n]+?役)[）)]", prefix):
        item = {"name": match.group(1).strip(), "role": pipeline_common.re.sub(r"役$", "", match.group(2).strip())}
        key = (pipeline_text.fold_name(item["name"]), pipeline_text.fold_name(item["role"]))
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def parse_program_date(description: str) -> str:
    lines = program_text_lines(description)
    for line in lines:
        if pipeline_common.re.search(r"(?:放送|配信|公開)(?:日時|日)", line):
            value = pipeline_text.first_date(line)
            if value:
                return value
    return ""
