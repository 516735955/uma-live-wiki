"""Archives responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import text as pipeline_text


def plain_wikitext(value: str) -> str:
    text = pipeline_common.re.sub(r"<!--.*?-->", "", str(value or ""), flags=pipeline_common.re.S)
    text = pipeline_common.re.sub(r"<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>", "", text, flags=pipeline_common.re.I | pipeline_common.re.S)
    text = pipeline_common.re.sub(r"<br\s*/?>", " ", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"</?(?:del|s|small|span)\b[^>]*>", "", text, flags=pipeline_common.re.I)
    text = pipeline_common.re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", text)
    text = pipeline_common.re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = pipeline_common.re.sub(r"\[(?:https?://\S+)\s+([^\]]+)\]", r"\1", text)
    text = text.replace("'''", "").replace("''", "")
    return pipeline_common.re.sub(r"\s+", " ", pipeline_common.html.unescape(text)).strip()


def wiki_table_rows(source: str, caption: str) -> list[list[str]]:
    marker = "|+ " + caption
    marker_index = source.find(marker)
    if marker_index < 0:
        return []
    start = source.rfind("{|", 0, marker_index)
    end = source.find("|}", marker_index)
    if start < 0 or end < 0:
        return []
    rows = []
    for block in source[start:end].split("|-"):
        cells: list[str] = []
        current: str | None = None
        for line in block.splitlines():
            if line.startswith("|") and not line.startswith(("|}", '|+', '{|')):
                if current is not None:
                    cells.append(current)
                pieces = line[1:].split('||')
                cells.extend(piece.strip() for piece in pieces[:-1])
                current = pieces[-1].strip()
            elif current is not None:
                current += " " + line.strip()
        if current is not None:
            cells.append(current)
        if cells:
            rows.append(cells)
    return rows


def wiki_archive_date(value: str) -> str:
    text = plain_wikitext(value).replace("Sept ", "Sep ").replace("Sept. ", "Sep ")
    for pattern in ("%b %d, %Y", "%B %d, %Y", "%Y/%m/%d"):
        try:
            return pipeline_common.dt.datetime.strptime(text, pattern).date().isoformat()
        except ValueError:
            pass
    return pipeline_text.first_date(text)


def english_identity_key(value: str) -> str:
    return pipeline_common.re.sub(r"[^a-z0-9]", "", pipeline_common.unicodedata.normalize("NFKC", value or "").lower())


def historical_cast(value: str, characters: list[dict[str, pipeline_common.Any]], source_url: str) -> list[dict[str, str]]:
    by_english = {english_identity_key(str(row.get("en") or "")): row for row in characters if row.get("en")}
    aliases = {
        english_identity_key("Tazuna Hayakawa"): english_identity_key("Hayakawa Tazuna"),
        english_identity_key("Misato Akasaka"): english_identity_key("Akasaka Misato"),
        english_identity_key("Trainer"): english_identity_key("Spica's Trainer"),
        english_identity_key("Yamamin Zephyr"): english_identity_key("Yamanin Zephyr"),
    }
    supplementary = {
        english_identity_key("Belno Light"): ("瀬戸桃子", "ベルノライト"),
        english_identity_key("Fujimasa March"): ("伊瀬茉莉也", "フジマサマーチ"),
    }
    external_names = {
        "Yoohei Kawakami": "川上洋平",
        "Masaki Shirai": "白井眞輝",
        "Junnosuke Ito": "伊藤隼之介",
        "Akihiro Ishihara": "石原章弘",
        "Takeshi Itazu": "板津雄志",
        "Koichi Tsunoda": "角田晃一",
        "Naohide Fukuhara": "福原直英",
        "Tomoki Kondo": "近藤智樹",
        "Keita Matsumoto": "松本圭太",
        "Asakawa": "浅川",
    }
    text = plain_wikitext(value)
    pairs = pipeline_common.re.findall(r"([A-Za-zÀ-ž.'’\- ]+?)\s*\(([^()]*)\)", text)
    out: list[dict[str, str]] = []
    seen = set()
    for actor_english, role_english in pairs:
        actor_english = pipeline_common.re.sub(r"^(?:Part\s*\d+|Special guests?)\s*:\s*", "", actor_english, flags=pipeline_common.re.I).strip(" ,")
        role_english = pipeline_common.re.sub(r"^\?+\s*[-=]*>\s*", "", role_english).strip()
        role_key = aliases.get(english_identity_key(role_english), english_identity_key(role_english))
        character = by_english.get(role_key)
        if character:
            item = {
                "name": str(character.get("cv") or character.get("cv_zh") or actor_english),
                "role": str(character.get("ja") or character.get("zh") or role_english),
                "source_kind": "community_archive",
                "source_url": source_url,
            }
        elif role_key in supplementary:
            actor, role = supplementary[role_key]
            item = {"name": actor, "role": role, "source_kind": "community_archive", "source_url": source_url}
        else:
            item = {
                "name": external_names.get(actor_english, actor_english),
                "role": plain_wikitext(role_english),
                "person_type": "external_guest",
                "source_kind": "community_archive",
                "source_url": source_url,
            }
        key = (pipeline_text.fold_name(item["name"]), pipeline_text.fold_name(item["role"]))
        if key not in seen:
            seen.add(key)
            out.append(item)
    special_match = pipeline_common.re.search(r"Special guests?:\s*Yoohei Kawakami and Masaki Shirai", text, pipeline_common.re.I)
    if special_match:
        for english_name in ("Yoohei Kawakami", "Masaki Shirai"):
            item = {
                "name": external_names[english_name],
                "role": "[Alexandros]",
                "person_type": "external_guest",
                "source_kind": "community_archive",
                "source_url": source_url,
            }
            key = (pipeline_text.fold_name(item["name"]), pipeline_text.fold_name(item["role"]))
            if key not in seen:
                seen.add(key)
                out.append(item)
    return out


def historical_programs() -> list[dict[str, pipeline_common.Any]]:
    characters = pipeline_common.read_window_data(pipeline_common.DATA_DIR / "character_index_data.js", "CHAR_INDEX")
    programs: list[dict[str, pipeline_common.Any]] = []
    main_source = pipeline_common.fetch_text_url(pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv"] + "?action=raw")
    for cells in wiki_table_rows(main_source, "PakaLive TV Volumes"):
        volume = plain_wikitext(cells[0]) if cells else ""
        if not volume.isdigit() or len(cells) < 5:
            continue
        number = int(volume)
        date = wiki_archive_date(cells[1])
        cast = historical_cast(" ".join(cells[3:5]), characters, pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv"])
        duration_match = pipeline_common.re.search(r"(\d+)\s*min", plain_wikitext(cells[8]) if len(cells) > 8 else "", pipeline_common.re.I)
        programs.append({
            "id": f"paka-live-tv-{number:03d}",
            "series_id": "paka-live-tv",
            "title": f"ぱかライブTV Vol.{number}",
            "date": date,
            "video_id": "",
            "url": "",
            "thumbnail": "",
            "duration": int(duration_match.group(1)) * 60 if duration_match else None,
            "cast_status": "verified",
            "cast": cast,
            "characters": [],
            "sessions": [],
            "summary": plain_wikitext(cells[2]),
            "source_kind": "community_archive",
            "source_url": pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv"],
        })
    for cells in wiki_table_rows(main_source, "Abema Stakes episodes"):
        volume = plain_wikitext(cells[0]) if cells else ""
        match = pipeline_common.re.fullmatch(r"(\d+)R", volume, pipeline_common.re.I)
        if not match or len(cells) < 4:
            continue
        number = int(match.group(1))
        date = wiki_archive_date(cells[1])
        cast = historical_cast(cells[3], characters, pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv"])
        duration_match = pipeline_common.re.search(r"(\d+)\s*m", plain_wikitext(cells[6]) if len(cells) > 6 else "", pipeline_common.re.I)
        programs.append({
            "id": f"official-special-abema-stakes-{number:02d}",
            "series_id": "official-special",
            "title": f"Abemaステークス 第{number}R",
            "date": date,
            "video_id": "",
            "url": "",
            "thumbnail": "",
            "duration": int(duration_match.group(1)) * 60 if duration_match else None,
            "cast_status": "verified",
            "cast": cast,
            "characters": [],
            "sessions": [],
            "summary": plain_wikitext(cells[2]),
            "source_kind": "community_archive",
            "source_url": pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv"],
        })
    dash_source = pipeline_common.fetch_text_url(pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"] + "?action=raw")
    for cells in wiki_table_rows(dash_source, "PakaLive TV Dash Volumes"):
        volume = plain_wikitext(cells[0]) if cells else ""
        if not volume.isdigit() or len(cells) < 6:
            continue
        number = int(volume)
        date = wiki_archive_date(cells[1])
        cast = historical_cast(" ".join(cells[3:5]), characters, pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"])
        guest_text = plain_wikitext(cells[5])
        if guest_text:
            guest_name = pipeline_common.re.split(r"\s*\(", guest_text, maxsplit=1)[0].strip()
            guest_map = {"Takeshi Itazu": "板津雄志", "Koichi Tsunoda": "角田晃一", "Naohide Fukuhara": "福原直英", "Tomoki Kondo": "近藤智樹", "Keita Matsumoto": "松本圭太", "Asakawa": "浅川"}
            cast.append({
                "name": guest_map.get(guest_name, guest_name),
                "role": pipeline_common.re.search(r"\(([^)]+)\)", guest_text).group(1) if pipeline_common.re.search(r"\(([^)]+)\)", guest_text) else "现实嘉宾",
                "person_type": "external_guest",
                "source_kind": "community_archive",
                "source_url": pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"],
            })
        duration_match = pipeline_common.re.search(r"(\d+)\s*min", plain_wikitext(cells[9]) if len(cells) > 9 else "", pipeline_common.re.I)
        programs.append({
            "id": f"paka-live-tv-prime-{number:03d}",
            "series_id": "paka-live-tv-prime",
            "title": f"ぱかライブTV' #{number}",
            "date": date,
            "video_id": "",
            "url": "",
            "thumbnail": "",
            "duration": int(duration_match.group(1)) * 60 if duration_match else None,
            "cast_status": "verified",
            "cast": cast,
            "characters": [],
            "sessions": [],
            "summary": plain_wikitext(cells[2]),
            "source_kind": "community_archive",
            "source_url": pipeline_common.PAKALIVE_ARCHIVE_PAGES["paka-live-tv-prime"],
        })
    return programs


def official_radio_programs(existing_programs: list[dict[str, pipeline_common.Any]]) -> list[dict[str, pipeline_common.Any]]:
    series_id = "all-night-nippon-gold"
    first_url = "https://www.allnightnippon.com/umamusume/umamusume_blog/20260428-105161/"
    trailer_url = "https://www.youtube.com/watch?v=k66w0hd_6Ms"
    rows: list[dict[str, pipeline_common.Any]] = [
        {
            "id": "all-night-nippon-gold-001",
            "series_id": series_id,
            "title": "ウマ娘のオールナイトニッポンGOLD 第1回",
            "date": "2026-05-08",
            "cast_status": "verified",
            "cast": [
                {"name": "上田瞳", "role": "ゴールドシップ"},
                {"name": "日笠陽子", "role": "オルフェーヴル"},
                {"name": "松田颯水", "role": "ステイゴールド"},
                {"name": "荘口彰久", "role": "アシスタント", "person_type": "external_guest"},
            ],
            "summary": "ニッポン放送をキーステーションに全国19局ネットで生放送。",
            "source_kind": "official_broadcaster",
            "source_url": first_url,
            "sources": [{"kind": "official_broadcaster", "label": "节目官方页", "url": first_url}],
        },
        {
            "id": "all-night-nippon-gold-002",
            "series_id": series_id,
            "title": "ウマ娘のオールナイトニッポンGOLD 第2回",
            "date": "2026-07-24",
            "cast_status": "verified",
            "cast": [
                {"name": "藤本侑里", "role": "ジャングルポケット"},
                {"name": "福嶋晴菜", "role": "ダンツフレーム"},
                {"name": "徳井青空", "role": "テイエムオペラオー"},
                {"name": "オーイシマサヨシ", "role": "ゲスト", "person_type": "external_guest"},
            ],
            "summary": "劇場版『新時代の扉』出演者を中心にしたラジオ特別番組。",
            "source_kind": "official_youtube",
            "source_url": trailer_url,
            "sources": [{"kind": "official_youtube", "label": "官方 YouTube", "url": trailer_url}],
        },
    ]
    known = {row["id"]: row for row in [*existing_programs, *rows] if row.get("series_id") == series_id}
    dated = sorted(row.get("date") for row in known.values() if row.get("date"))
    latest_date = pipeline_common.dt.date.fromisoformat(dated[-1]) if dated else pipeline_common.dt.date(2026, 5, 8)
    try:
        page = pipeline_common.fetch_text_url(pipeline_common.ANN_PROGRAM_URL)
        description_match = pipeline_common.re.search(r'<meta\s+name="description"\s+content="([^"]*)"', page, pipeline_common.re.I)
        description = pipeline_common.html.unescape(description_match.group(1)) if description_match else pipeline_text.clean_text(page)
        date_match = pipeline_common.re.search(r"(\d{1,2})月(\d{1,2})日", description)
        if date_match:
            month, day = int(date_match.group(1)), int(date_match.group(2))
            page_date = None
            for year in range(latest_date.year, latest_date.year + 3):
                try:
                    candidate = pipeline_common.dt.date(year, month, day)
                except ValueError:
                    continue
                if candidate > pipeline_common.dt.date(2026, 5, 8):
                    page_date = candidate
                    if candidate >= latest_date:
                        break
            if page_date:
                matching_id = next((event_id for event_id, row in known.items() if row.get("date") == page_date.isoformat()), "")
                if not matching_id:
                    matching_id = next(
                        (f"all-night-nippon-gold-{number:03d}" for number in range(1, 7)
                         if not known.get(f"all-night-nippon-gold-{number:03d}", {}).get("date")),
                        "",
                    )
                cast = []
                for role, name in pipeline_common.re.findall(r"([ァ-ヺー一-龯々〆ヵヶA-Za-z・]+)役の([ぁ-ゖァ-ヺー一-龯々〆ヵヶA-Za-z・]+)", description):
                    cast.append({"name": name, "role": role})
                assistant = pipeline_common.re.search(
                    r"アシスタントは(?:フリーアナウンサーの)?"
                    r"([ぁ-ゖァ-ヺー一-龯々〆ヵヶA-Za-z・]+?)(?:が担当|[、。])",
                    description,
                )
                if assistant:
                    cast.append({"name": assistant.group(1), "role": "アシスタント", "person_type": "external_guest"})
                if matching_id and cast:
                    number = int(matching_id.rsplit("-", 1)[1])
                    rows.append({
                        "id": matching_id,
                        "series_id": series_id,
                        "title": f"ウマ娘のオールナイトニッポンGOLD 第{number}回",
                        "date": page_date.isoformat(),
                        "cast_status": "verified",
                        "cast": cast,
                        "summary": pipeline_text.clean_text(description)[:300],
                        "source_kind": "official_broadcaster",
                        "source_url": pipeline_common.ANN_PROGRAM_URL,
                        "sources": [{"kind": "official_broadcaster", "label": "节目官方页", "url": pipeline_common.ANN_PROGRAM_URL}],
                    })
    except Exception:
        pass
    complete_ids = {row["id"] for row in [*existing_programs, *rows] if row.get("series_id") == series_id and row.get("date")}
    for number in range(3, 7):
        event_id = f"all-night-nippon-gold-{number:03d}"
        if event_id in complete_ids:
            continue
        rows.append({
            "id": event_id,
            "series_id": series_id,
            "title": f"ウマ娘のオールナイトニッポンGOLD 第{number}回",
            "date": "",
            "cast_status": "announced_tba",
            "cast": [],
            "characters": [],
            "sessions": [],
            "schedule_status": "announced_tba",
            "metadata_status": "announced_tba",
            "summary": "全6回的特别广播已由官方宣布；本期日期与出演阵容尚未公布。",
            "source_kind": "official_youtube",
            "source_url": trailer_url,
            "sources": [{"kind": "official_youtube", "label": "官方 YouTube", "url": trailer_url}],
        })
    return rows
