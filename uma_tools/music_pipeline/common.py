"""Common responsibilities for the canonical catalog pipeline."""
from __future__ import annotations



import argparse


import concurrent.futures


import hashlib


import html


from html.parser import HTMLParser


import json


import os


import re


import time


import unicodedata


import urllib.error


import urllib.parse


import urllib.request


from pathlib import Path


from typing import Any


ROOT = Path(__file__).resolve().parents[2]


DATA_DIR = ROOT / "data"


MUSIC_DIR = DATA_DIR / "music"


SONGS_FILE = DATA_DIR / "song_catalog.json"


CREATORS_FILE = MUSIC_DIR / "creators.json"


CREDITS_FILE = MUSIC_DIR / "credits.json"


LYRICS_FILE = MUSIC_DIR / "lyrics.json"


TIMINGS_FILE = MUSIC_DIR / "lyric_timings.json"


OVERRIDES_FILE = MUSIC_DIR / "version_overrides.json"


SOURCE_STATE_FILE = MUSIC_DIR / "source_status.json"


LYRIC_URL = "https://music.163.com/api/song/lyric?id={track_id}&lv=1&kv=1&tv=-1"


UTATEN_SEARCH_URL = "https://utaten.com/lyric/search?title={title}"


LRCLIB_SEARCH_URL = "https://lrclib.net/api/search?track_name={title}"


OSHIKATSU_URL = "https://oshikatsu-techo.com/games/umamusume/songs"


UMAMUSU_WIKI_API = "https://umamusu.wiki/w/api.php"


UMAMUSU_WIKI_CATEGORY = "Category:Songs"


UA = "UmaLiveWiki/1.0 (hobby metadata maintenance)"


ROLE_LABELS = {
    "作詞": "lyricist",
    "作词": "lyricist",
    "詞": "lyricist",
    "词": "lyricist",
    "lyricist": "lyricist",
    "lyrics": "lyricist",
    "作曲": "composer",
    "composer": "composer",
    "編曲": "arranger",
    "编曲": "arranger",
    "arranger": "arranger",
    "ストリングスアレンジ": "strings_arranger",
    "弦乐编曲": "strings_arranger",
    "strings_arranger": "strings_arranger",
    "リミックス": "remixer",
    "remix": "remixer",
    "remixer": "remixer",
    "プロデュース": "producer",
    "producer": "producer",
    "オーケストレーション": "orchestrator",
    "orchestration": "orchestrator",
    "orchestrator": "orchestrator",
}


ROLE_ORDER = {
    "lyricist": 0, "composer": 1, "arranger": 2, "remixer": 3,
    "producer": 4, "orchestrator": 5, "strings_arranger": 6,
}


ROLE_SOURCE_LABEL = (
    r"ストリングスアレンジ|strings_arranger|弦乐编曲|作詞|作词|詞|词|作曲|編曲|编曲|リミックス|"
    r"プロデュース|オーケストレーション|lyricist|lyrics|composer|arranger|"
    r"remixer?|producer|orchestrat(?:ion|or)"
)


SUPPORTED_ROLES = frozenset(ROLE_ORDER)


TIMED_LINE_RE = re.compile(r"^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$")


CREDIT_LINE_RE = re.compile(rf"^\s*({ROLE_SOURCE_LABEL})\s*[:：]\s*(.+?)\s*$", re.I)


COMBINED_CREDIT_RE = re.compile(r"^\s*(作詞|作词|作曲|編曲|编曲)(?:[・/&、](作詞|作词|作曲|編曲|编曲))+\s*[:：]\s*(.+?)\s*$", re.I)


NO_LYRIC_RE = re.compile(r"^(?:纯音乐|純音楽|instrumental|off\s*vocal|暂无歌词|暂无歌詞)$", re.I)


NAME_VARIANTS = str.maketrans({
    "髙": "高", "﨑": "崎", "祥": "祥", "塚": "塚", "濱": "浜", "諸": "諸",
    "’": "'", "‘": "'", "`": "'",
})


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.replace(temp, path)
