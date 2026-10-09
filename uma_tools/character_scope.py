"""Apply the site's selected character scope to animation imports."""

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def normalized(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))


def exclusions():
    document = json.loads((ROOT / "data/anime/overrides.json").read_text(encoding="utf-8"))
    return document.get("excluded_characters", [])


def selected_characters(records):
    excluded = {row["id"] for row in exclusions()}
    return [row for row in records if row["id"] not in excluded]


def excluded_signature(signature):
    name = normalized(signature)
    names = {normalized(value) for row in exclusions() for value in row["names"]}
    generic = (re.fullmatch(r"(?:ウマ娘|記者)[A-D]?", name)
               or re.fullmatch(r".+のウマ娘", name)
               or re.fullmatch(r".+のトレーナー", name)
               or re.fullmatch(r".+の(?:母|父|祖母|祖父|妹|姉|兄|弟)", name)
               or name in {"大将", "女将", "おっちゃん", "観客", "霊の声", "幽霊", "ファインのSP", "スタッフ"})
    return bool(generic or name in names or name == "細江さん" or any(token in name for token in ("実況", "解説")))
