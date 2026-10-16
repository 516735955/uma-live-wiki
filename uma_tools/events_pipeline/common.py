"""Common responsibilities for the canonical catalog pipeline."""
from __future__ import annotations



import argparse


import concurrent.futures


import datetime as dt


import hashlib


import html


import json


import os


import re


import subprocess


import sys


import tempfile


import time


import unicodedata


import urllib.error


import urllib.parse


import urllib.request


from collections import Counter, defaultdict


from pathlib import Path


from typing import Any, Iterable


TOOLS_DIR = Path(__file__).resolve().parent.parent


ROOT = TOOLS_DIR.parent


DATA_DIR = ROOT / "data"


EVENTS_DIR = DATA_DIR / "events"


MUSIC_DIR = DATA_DIR / "music"


PROGRAM_REFRESH_REPORT = EVENTS_DIR / "program_refresh_report.json"


OFFICIAL_CHANNEL_ID = "UCAWxPGGuIfWME2KTLUmSCHw"


REGULAR_PROGRAM_BASELINES = {"paka-live-tv": 62, "paka-live-tv-prime": 6, "sokosoko-paka-live-tv": 55}


PROGRAM_SOURCE_PRIORITY = {
    "community_archive": 1,
    "official_broadcaster": 2,
    "official_announcement": 3,
    "official_youtube": 4,
}


PAKALIVE_ARCHIVE_PAGES = {
    "paka-live-tv": "https://umamusu.wiki/PakaLive_TV",
    "paka-live-tv-prime": "https://umamusu.wiki/PakaLive_TV_Dash",
}


ANN_PROGRAM_URL = "https://www.allnightnippon.com/umamusume/"


VOICE_DETAILS_FILE = EVENTS_DIR / "voice_actor_details.json"


VOICE_IDENTITIES_FILE = EVENTS_DIR / "voice_actor_identities.json"


IMMUTABLE_LIVE_FILES = (DATA_DIR / "live_data.json", DATA_DIR / "live_cat_data.json")


OUTPUT_FILES = {
    "catalog": DATA_DIR / "events_catalog.json",
    "songs": DATA_DIR / "song_catalog.json",
    "creators": DATA_DIR / "creator_catalog.json",
    "appearances": DATA_DIR / "appearance_index.json",
    "profiles": DATA_DIR / "voice_actor_profiles.json",
    "manifest": DATA_DIR / "catalog_manifest.json",
}


MUSIC_SOURCE_FILES = {
    "creators": MUSIC_DIR / "creators.json",
    "credits": MUSIC_DIR / "credits.json",
    "lyrics": MUSIC_DIR / "lyrics.json",
    "timings": MUSIC_DIR / "lyric_timings.json",
    "overrides": MUSIC_DIR / "version_overrides.json",
}


CREATOR_ROLE_LABELS = {
    "lyricist": "作词",
    "composer": "作曲",
    "arranger": "编曲",
    "remixer": "混音改编",
    "producer": "制作",
    "orchestrator": "配器",
}


CREATOR_ROLE_ORDER = {role: index for index, role in enumerate(CREATOR_ROLE_LABELS)}


EVENT_COVER_BY_KIND = {
    "concert": "/uma_tools/img/event-covers/concert.svg",
    "official_program": "/uma_tools/img/event-covers/official-program.svg",
    "onsite": "/uma_tools/img/event-covers/onsite.svg",
}


NUMBERED_EVENT_COVERS = {
    "1st-event": "/uma_tools/img/event-covers/numbered/1st.png",
    "2nd-event": "/uma_tools/img/event-covers/numbered/2nd.png",
    "3rd-event": "/uma_tools/img/event-covers/numbered/3rd.png",
    "4th-event-extra": "/uma_tools/img/event-covers/numbered/4th-extra.png",
    "4th-event": "/uma_tools/img/event-covers/numbered/4th.png",
    "5th-event": "/uma_tools/img/event-covers/numbered/5th.png",
    "6th-event": "/uma_tools/img/event-covers/numbered/6th.png",
    "7th-event": "/uma_tools/img/event-covers/numbered/7th.png",
}


VFOLD = str.maketrans({"髙": "高", "﨑": "崎", "祥": "祥", "塚": "塚", "濱": "浜", "諸": "諸"})


DATE_RE = re.compile(r"(20\d{2})[.年/-](\d{1,2})[.月/-](\d{1,2})")


SONG_RE = re.compile(r'<td class="setlist-song">([\s\S]*?)</td>')


SETLIST_NO_RE = re.compile(r'<td class="setlist-no">([\s\S]*?)</td>')


PERFORMER_RE = re.compile(r'<span class="perf-name">([\s\S]*?)</span>')


GUEST_PERFORMER_RE = re.compile(
    r'<span\b[^>]*class=["\'][^"\']*\bguest-performer\b[^"\']*["\'][^>]*>([\s\S]*?)</span>',
    re.I,
)


ROW_RE = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.I)


HTML_TAG_RE = re.compile(r"<[^>]+>")


EVENTERNOTE_ID_RE = re.compile(r"/events/id/(\d+)")


MEDIA_URL_RE = re.compile(r'https?://[^\s<>"\'\]\[）)]+', re.I)


CAST_LINE_RE = re.compile(
    r'<div\b[^>]*class=["\'][^"\']*\bcast-line\b[^"\']*["\'][^>]*>([\s\S]*?)</div>', re.I
)


CAST_LABEL_RE = re.compile(
    r'<span\b[^>]*class=["\'][^"\']*\bcast-label\b[^"\']*["\'][^>]*>([\s\S]*?)</span>', re.I
)


FULL_CAST_RE = re.compile(r"(?:全员|全員)")


NON_PERFORMER_CAST_LABEL_RE = re.compile(r"实况|實況|嘉宾|ゲスト|向导|案内|解说|解説|司会|MC", re.I)


SONG_VERSION_HINT_RE = re.compile(
    r"(?:ver(?:sion)?\.?|size|remaster|remix|mix|off[ -]?vocal|instrumental|"
    r"acoustic|symphonic|revision|arrange|edit|solo|feat\.|short|long|game|tv|"
    r"anime|pv|mv|舞台|剧中|劇中|歌词版|歌詞版|アドリブ|メロ)",
    re.I,
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def read_window_data(path: Path, global_name: str) -> Any:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"window\." + re.escape(global_name) + r"\s*=\s*([\[{][\s\S]*[\]}])\s*;\s*$", source)
    if not match:
        raise ValueError(f"{global_name} not found in {path}")
    return json.loads(match.group(1))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        # mkstemp creates 0600 files; nginx and Node may use different users.
        os.chmod(temp_name, 0o644)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def fetch_text_url(url: str, attempts: int = 2) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "uma-live-wiki data updater/1.0"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                return response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as error:
            if error.code == 404 or error.code < 429 or attempt + 1 >= attempts:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt + 1 >= attempts:
                raise
        time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"unable to fetch {url}")


def shutil_which(name: str) -> str | None:
    paths = os.environ.get("PATH", "").split(os.pathsep)
    extensions = [""] if os.name != "nt" else os.environ.get("PATHEXT", ".EXE").split(os.pathsep)
    for directory in paths:
        for extension in extensions:
            candidate = Path(directory) / (name + extension)
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    return None


def comparable(value: Any) -> Any:
    if isinstance(value, dict):
        # Byte digests describe this checkout's LF/CRLF representation. The
        # build still verifies unchanged source bytes before and after reading.
        return {
            key: ({name: {"preserved": info.get("preserved")} for name, info in item.items()}
                  if key == "source_integrity" else comparable(item))
            for key, item in value.items() if key not in ("generated_at", "build_id")
        }
    if isinstance(value, list):
        return [comparable(item) for item in value]
    return value
