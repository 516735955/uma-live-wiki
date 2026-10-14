"""Text responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common


def clean_text(value: pipeline_common.Any) -> str:
    return pipeline_common.re.sub(r"\s+", " ", pipeline_common.html.unescape(pipeline_common.HTML_TAG_RE.sub("", str(value or "")))).strip()


def concise_program_summary(value: pipeline_common.Any, limit: int = 300) -> str:
    """Keep the editorial introduction and discard channel-wide YouTube boilerplate."""
    text = clean_text(value)
    if not text:
        return ""
    text = pipeline_common.re.split(
        r"\s+(?:https?://|[-+]{5,}|チャンネル登録はこちら|"
        r"【ウマ娘 プリティーダービー(?:公式| 公式)|【ぱかチューブっ！公式)",
        text,
        maxsplit=1,
    )[0].strip()
    if len(text) <= limit:
        return text
    shortened = text[:limit].rstrip()
    sentence_end = max(shortened.rfind("。"), shortened.rfind("！"), shortened.rfind("？"))
    return shortened[: sentence_end + 1] if sentence_end >= limit // 2 else shortened + "……"


def fold_name(value: str) -> str:
    return pipeline_common.unicodedata.normalize("NFKC", value or "").translate(pipeline_common.VFOLD).replace(" ", "").strip()


def first_date(value: pipeline_common.Any) -> str:
    match = pipeline_common.DATE_RE.search(str(value or ""))
    if not match:
        return ""
    try:
        return pipeline_common.dt.date(*(int(part) for part in match.groups())).isoformat()
    except ValueError:
        return ""


def all_dates(value: pipeline_common.Any) -> list[str]:
    current_year = None
    out = []
    for match in pipeline_common.re.finditer(r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日", str(value or "")):
        if match.group(1):
            current_year = int(match.group(1))
        if current_year is None:
            continue
        try:
            parsed = pipeline_common.dt.date(current_year, int(match.group(2)), int(match.group(3))).isoformat()
        except ValueError:
            continue
        if parsed not in out:
            out.append(parsed)
    return out


def event_date_for_day(value: pipeline_common.Any, offset: int) -> str:
    base = first_date(value)
    if not base:
        return ""
    try:
        return (pipeline_common.dt.date.fromisoformat(base) + pipeline_common.dt.timedelta(days=offset)).isoformat()
    except ValueError:
        return base


def venue_from_date_text(value: pipeline_common.Any) -> str:
    text = str(value or "").strip()
    text = pipeline_common.re.sub(r"^20\d{2}[./-]\d{1,2}[./-]\d{1,2}(?:\s*[-–—]\s*\d{1,2})?\s*", "", text)
    return text.strip(" -–—./")


def stable_suffix(value: str) -> str:
    ascii_words = pipeline_common.re.findall(r"[A-Za-z0-9]+", pipeline_common.unicodedata.normalize("NFKC", value or ""))
    text = "-".join(word.lower() for word in ascii_words[:8])
    text = pipeline_common.re.sub(r"-+", "-", text).strip("-")
    return text[:64]


def stable_title_suffix(value: str) -> str:
    readable = stable_suffix(value)
    if readable:
        return readable
    normalized = pipeline_common.unicodedata.normalize("NFKC", value or "").strip()
    return "title-" + pipeline_common.hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12] if normalized else ""


def unique_id(base: str, used: set[str]) -> str:
    candidate = pipeline_common.re.sub(r"[^a-z0-9-]+", "-", base.lower()).strip("-")
    candidate = pipeline_common.re.sub(r"-+", "-", candidate) or "event"
    if candidate not in used:
        used.add(candidate)
        return candidate
    number = 2
    while f"{candidate}-{number}" in used:
        number += 1
    candidate = f"{candidate}-{number}"
    used.add(candidate)
    return candidate
