"""Credits responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import recordings as pipeline_recordings


def creator_identity(raw_name: str) -> tuple[str, list[str]]:
    name = pipeline_common.unicodedata.normalize("NFKC", raw_name or "").strip(" \t:：")
    affiliations: list[str] = []
    prefix = pipeline_common.re.match(r"^(Cygames|MONACA|Arte Refact|Lantis)\s*[（(](.+?)[）)]$", name, pipeline_common.re.I)
    suffix = pipeline_common.re.match(r"^(.+?)\s*[（(]([^()（）]+)[）)]$", name, pipeline_common.re.I)
    unclosed_suffix = pipeline_common.re.match(r"^(.+?)\s*\(([^()]+)$", name)
    if prefix:
        affiliations.append(prefix.group(1))
        name = prefix.group(2).strip()
    elif suffix:
        name = suffix.group(1).strip()
        affiliation = pipeline_common.re.sub(r"^from\s+", "", suffix.group(2).strip(), flags=pipeline_common.re.I)
        if affiliation:
            affiliations.append(affiliation)
    elif unclosed_suffix:
        name = unclosed_suffix.group(1).strip()
        affiliation = pipeline_common.re.sub(r"^from\s+", "", unclosed_suffix.group(2).strip(), flags=pipeline_common.re.I)
        if affiliation:
            affiliations.append(affiliation)
    elif name.count("(") < name.count(")"):
        name = name.rstrip(" )")
    return name, affiliations


def stable_creator_id(name: str) -> str:
    readable = pipeline_common.re.sub(r"[^a-z0-9]+", "-", pipeline_common.unicodedata.normalize("NFKC", name).lower()).strip("-")[:28]
    digest = pipeline_common.hashlib.sha1(pipeline_recordings.normalized_name(name).encode("utf-8")).hexdigest()[:10]
    return "creator-" + ((readable + "-") if readable else "") + digest


def split_creators(value: str) -> list[str]:
    cleaned = pipeline_common.re.sub(r"\s+(?:and|＆)\s+", "、", value.strip(), flags=pipeline_common.re.I)
    parts, current, depth = [], [], 0
    for char in cleaned:
        if char in '(（[【':
            depth += 1
        elif char in ')）]】':
            depth = max(0, depth - 1)
        if not depth and char in '/／、，,;；・':
            parts.append(''.join(current))
            current = []
        else:
            current.append(char)
    parts.append(''.join(current))
    out: list[str] = []
    for part in parts:
        part = pipeline_common.re.sub(r"\s+(?:arranged|composed|written)\s+by\s+", "", part, flags=pipeline_common.re.I).strip()
        if part and part not in out:
            out.append(part)
    return out


def normalize_automatic_credit_rows(credits_doc: dict[str, pipeline_common.Any]) -> None:
    """Split combined source names and deduplicate them without touching manual rows."""
    for row in (credits_doc.get("versions") or {}).values():
        if row.get("manual"):
            continue
        normalized: list[dict[str, pipeline_common.Any]] = []
        seen: dict[tuple[str, str], dict[str, pipeline_common.Any]] = {}
        for credit in row.get("credits") or []:
            raw_name = str(credit.get("name") or "").strip()
            names = split_creators(raw_name) or [raw_name]
            for raw_part in names:
                name, affiliations = creator_identity(raw_part)
                key = (str(credit.get("role") or ""), pipeline_recordings.normalized_name(name))
                if not key[0] or not key[1]:
                    continue
                existing = seen.get(key)
                affiliation = (affiliations[0] if affiliations else "") or str(credit.get("affiliation") or "")
                if existing:
                    if affiliation and not existing.get("affiliation"):
                        existing["affiliation"] = affiliation
                    continue
                clean = {key_name: value for key_name, value in credit.items() if key_name != "creator_id"}
                clean["name"] = name
                if affiliation:
                    clean["affiliation"] = affiliation
                else:
                    clean.pop("affiliation", None)
                normalized.append(clean)
                seen[key] = clean
        row["credits"] = normalized


def parse_credit_text(value: str) -> list[dict[str, str]]:
    text = pipeline_recordings.clean_markup(value).split("歌：", 1)[0]
    text = text.replace("\n", "　")
    text = pipeline_common.re.sub(r"(?:ファンファーレ)?作曲\s*[・/&]\s*編曲", "作曲・編曲", text)
    text = pipeline_common.re.sub(r"(?:ストリングス|ブラス|ファンファーレ)\s*(?:アレンジ|編曲)", "編曲", text, flags=pipeline_common.re.I)
    label_pattern = rf"(?:{pipeline_common.ROLE_SOURCE_LABEL})(?:\s*[・/&、]\s*(?:{pipeline_common.ROLE_SOURCE_LABEL}))*"
    matches = list(pipeline_common.re.finditer(rf"({label_pattern})\s*[:：]\s*(.*?)(?=\s+{label_pattern}\s*[:：]|$)", text, pipeline_common.re.I))
    credits: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for match in matches:
        labels = pipeline_common.re.findall(pipeline_common.ROLE_SOURCE_LABEL, match.group(1), pipeline_common.re.I)
        roles = list(dict.fromkeys(pipeline_common.ROLE_LABELS.get(label.lower(), pipeline_common.ROLE_LABELS.get(label, "")) for label in labels))
        for raw_name in split_creators(match.group(2).strip(" 　")):
            name, affiliations = creator_identity(raw_name)
            for role in roles:
                key = (role, pipeline_recordings.normalized_name(name))
                if not role or not name or key in seen:
                    continue
                seen.add(key)
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
    credits.sort(key=lambda row: (pipeline_common.ROLE_ORDER.get(row["role"], 99), pipeline_recordings.normalized_name(row["name"])))
    return credits


def inferred_remix_credit(title: str) -> dict[str, str] | None:
    """Infer only an explicitly named remix credit from the recording title."""
    value = pipeline_common.unicodedata.normalize("NFKC", title or "")
    matches = pipeline_common.re.findall(r"(?:\(|\[|\{|[-–—]\s*)([^()\[\]{}]+?)\s+Remix(?:er)?\s*(?:\)|\]|\}|$)", value, pipeline_common.re.I)
    if not matches:
        return None
    raw_name = matches[-1].strip(" -–—:：")
    if not raw_name or pipeline_recordings.normalized_name(raw_name) in {"remix", "remixver", "remixversion"}:
        return None
    name, affiliations = creator_identity(raw_name)
    if not name or pipeline_recordings.normalized_name(name) in {"ver", "version"}:
        return None
    credit = {"role": "remixer", "name": name}
    if affiliations:
        credit["affiliation"] = affiliations[0]
    return credit


def official_credit_rows(goods: list[dict[str, pipeline_common.Any]], recordings: dict[str, dict[str, pipeline_common.Any]]) -> dict[str, dict[str, pipeline_common.Any]]:
    by_catalog_title: dict[tuple[str, str], list[str]] = {}
    for version_id, recording in recordings.items():
        for release in recording["releases"]:
            key = (pipeline_recordings.catalog_key(release.get("catalog") or ""), pipeline_recordings.folded_title(recording["version_title"]))
            if key[0] and version_id not in by_catalog_title.setdefault(key, []):
                by_catalog_title[key].append(version_id)
    out: dict[str, dict[str, pipeline_common.Any]] = {}
    for item in goods:
        page = item.get("html") or ""
        catalog_match = pipeline_common.re.search(r"品番[:：]\s*([A-Za-z0-9_\-/～〜 ]+)", pipeline_recordings.clean_markup(page))
        if not catalog_match:
            continue
        catalog = pipeline_recordings.catalog_key(catalog_match.group(1))
        blocks = pipeline_common.re.findall(r"<h4\b[^>]*>([\s\S]*?)</h4>([\s\S]*?)(?=<h4\b|$)", page, pipeline_common.re.I)
        for title_markup, body in blocks:
            title = pipeline_common.re.sub(r"^\s*(?:\d+[.．、]\s*)", "", pipeline_recordings.clean_markup(title_markup)).strip()
            if not title or title.startswith("["):
                continue
            matched_ids = by_catalog_title.get((catalog, pipeline_recordings.folded_title(title))) or []
            if len(matched_ids) != 1:
                continue
            credit_rows = parse_credit_text(body)
            if not credit_rows:
                continue
            out[matched_ids[0]] = {
                "credits": credit_rows,
                "source": "official_lantis_catalog",
                "source_catalog": catalog_match.group(1).strip(),
            }
    return out


def merge_credit_rows(
    existing: dict[str, pipeline_common.Any],
    incoming_rows: dict[str, dict[str, pipeline_common.Any]],
    refresh: set[str] | None = None,
) -> None:
    """Fill missing roles while preserving every existing non-empty role by default."""
    versions = existing.setdefault("versions", {})
    refresh = refresh or set()
    for version_id, incoming in incoming_rows.items():
        current = versions.get(version_id) or {}
        if current.get("manual"):
            continue
        if version_id in refresh:
            versions[version_id] = incoming
            continue
        current_credits = list(current.get("credits") or [])
        current_roles = {row.get("role") for row in current_credits if row.get("role")}
        additions = [row for row in incoming.get("credits") or [] if row.get("role") not in current_roles]
        if not additions:
            continue
        if not current_credits:
            versions[version_id] = incoming
            continue
        supplemental = list(current.get("supplemental_sources") or [])
        source = incoming.get("source")
        if source and source not in supplemental:
            supplemental.append(source)
        versions[version_id] = {
            **current,
            "credits": current_credits + additions,
            **({"supplemental_sources": supplemental} if supplemental else {}),
        }


def parse_oshikatsu_credits(page: str, recordings: dict[str, dict[str, pipeline_common.Any]]) -> dict[str, dict[str, pipeline_common.Any]]:
    out: dict[str, dict[str, pipeline_common.Any]] = {}
    for block in pipeline_common.re.findall(r'<article\s+class="static-entry"[^>]*>([\s\S]*?)</article>', page, pipeline_common.re.I):
        title_match = pipeline_common.re.search(r'<h3\b[^>]*class="[^"]*static-entry-title[^"]*"[^>]*>([\s\S]*?)</h3>', block, pipeline_common.re.I)
        if not title_match:
            continue
        title = pipeline_recordings.clean_markup(title_match.group(1))
        release_name = ""
        track_number = None
        release_match = pipeline_common.re.search(r'<p>\s*収録先[:：]\s*([\s\S]*?)</p>', block, pipeline_common.re.I)
        if release_match:
            release_text = pipeline_recordings.clean_markup(release_match.group(1))
            parts = pipeline_common.re.split(r"\s*/\s*", release_text, maxsplit=1)
            release_name = parts[0].strip()
            if len(parts) > 1:
                number_match = pipeline_common.re.search(r"(\d+)\s*曲目", parts[1])
                track_number = int(number_match.group(1)) if number_match else None
        version_id = pipeline_recordings.match_recording_version(title, recordings, release_name, track_number)
        if not version_id:
            continue
        credits: list[dict[str, str]] = []
        for label_markup, names_markup in pipeline_common.re.findall(r'<li>\s*<strong>([\s\S]*?)</strong>\s*([\s\S]*?)</li>', block, pipeline_common.re.I):
            role = pipeline_common.ROLE_LABELS.get(pipeline_recordings.clean_markup(label_markup))
            if not role:
                continue
            for raw_name in split_creators(pipeline_recordings.clean_markup(names_markup)):
                name, affiliations = creator_identity(raw_name)
                if not name:
                    continue
                credit = {"role": role, "name": name}
                if affiliations:
                    credit["affiliation"] = affiliations[0]
                credits.append(credit)
        if credits:
            out[version_id] = {
                "credits": credits,
                "source": "oshikatsu_techo_catalog",
                "source_url": pipeline_common.OSHIKATSU_URL,
            }
    return out


def credit_names(value: pipeline_common.Any) -> list[str]:
    if isinstance(value, dict):
        return [str(value.get("name") or "").strip()] if value.get("name") else []
    if isinstance(value, list):
        return [name for item in value for name in credit_names(item)]
    return []


def creator_rows(credits_doc: dict[str, pipeline_common.Any], existing: dict[str, pipeline_common.Any]) -> list[dict[str, pipeline_common.Any]]:
    existing_by_key: dict[str, dict[str, pipeline_common.Any]] = {}
    existing_by_id = {row['id']: row for row in existing.get('creators') or []}
    for creator in existing.get("creators") or []:
        for name in [creator.get("name") or "", *(creator.get("aliases") or [])]:
            if name:
                existing_by_key.setdefault(pipeline_recordings.normalized_name(name), creator)
    collected: dict[str, dict[str, pipeline_common.Any]] = {}
    for row in (credits_doc.get("versions") or {}).values():
        automatic = not row.get("manual")
        for credit in row.get("credits") or []:
            name, affiliations = creator_identity(credit.get("name") or "")
            key = pipeline_recordings.normalized_name(name)
            if not key:
                continue
            explicit_id = credit.get('creator_id') or ''
            existing_creator = existing_by_id.get(explicit_id) or existing_by_key.get(key)
            creator_id = (existing_creator or {}).get("id") or (explicit_id if not automatic else '') or stable_creator_id(name)
            creator = collected.setdefault(creator_id, {
                **(existing_creator or {}),
                "id": creator_id,
                "name": (existing_creator or {}).get("name") or name,
                "aliases": list((existing_creator or {}).get("aliases") or []),
                "type": (existing_creator or {}).get("type") or "person",
                "affiliations": list((existing_creator or {}).get("affiliations") or []),
            })
            if name != creator["name"] and name not in creator["aliases"]:
                creator["aliases"].append(name)
            for affiliation in [credit.get("affiliation") or "", *affiliations]:
                if affiliation and affiliation not in creator["affiliations"]:
                    creator["affiliations"].append(affiliation)
            if automatic:
                credit["name"] = creator["name"]
                if affiliations and not credit.get("affiliation"):
                    credit["affiliation"] = affiliations[0]
            credit["creator_id"] = creator_id
            existing_by_key[key] = creator
            existing_by_id[creator_id] = creator
    for creator in existing.get("creators") or []:
        canonical = existing_by_key.get(pipeline_recordings.normalized_name(creator.get("name") or ""))
        if creator.get("id") not in collected and (creator.get("manual") or canonical is creator):
            collected[creator["id"]] = dict(creator)
            collected[creator["id"]].setdefault("type", "person")
    rows = list(collected.values())
    for row in rows:
        row["aliases"] = sorted(set(row.get("aliases") or []), key=pipeline_recordings.normalized_name)
        row["affiliations"] = sorted(set(row.get("affiliations") or []), key=pipeline_recordings.normalized_name)
    rows.sort(key=lambda row: (pipeline_recordings.normalized_name(row.get("name") or ""), row["id"]))
    return rows
