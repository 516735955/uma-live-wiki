"""Program discovery responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import archives as pipeline_archives
from . import common as pipeline_common
from . import program_text as pipeline_program_text
from . import text as pipeline_text
import sqlite3
import datetime as _datetime
from html.parser import HTMLParser


PAKATUBE_MOVIE_INDEX = "https://pakatube.umamusume.jp/data/movie.json"
PROGRAM_METADATA_CACHE = pipeline_common.DATA_DIR / "auto_update/event-refresh/metadata"
IGNORED_PROGRAM_CANDIDATES = pipeline_common.DATA_DIR / "auto_update/event-refresh/ignored-candidates.jsonl"
METADATA_TTL_UPCOMING = 60 * 60
METADATA_TTL_UNDATED = 24 * 60 * 60
METADATA_TTL_PUBLISHED = 7 * 24 * 60 * 60
METADATA_ERRORS: dict[str, str] = {}
EXTERNAL_OFFICIAL_CHANNELS = (
    # The source is restricted to explicit Uma/collaboration titles below;
    # this is not a general-purpose partner-channel crawler.
    {"name": "priconne_redive", "channel_id": "UCiPSajGFI4ja74nYPU1MexA", "feed": "https://www.youtube.com/@priconne_redive/videos"},
)


def _approximate_date(row: dict[str, pipeline_common.Any]) -> str:
    # Prefer the platform's release date (or timestamp) over upload_date.  A
    # scheduled premiere can be uploaded days earlier, and using upload_date
    # moves the canonical programme onto the wrong calendar day.  Keep the
    # upload date as a final fallback for inventory rows that have no release
    # metadata at all.
    for value in (row.get("release_date"), row.get("date"), row.get("published_at")):
        date = pipeline_text.first_date(value)
        if date:
            return date
    timestamp = row.get("release_timestamp")
    if timestamp:
        try:
            return _datetime.datetime.fromtimestamp(float(timestamp), _datetime.timezone.utc).astimezone(
                _datetime.timezone(_datetime.timedelta(hours=9))
            ).date().isoformat()
        except (TypeError, ValueError, OverflowError, OSError):
            pass
    date = pipeline_text.first_date(row.get("approximate_date"))
    if date:
        return date
    raw_upload = str(row.get("upload_date") or "")
    date = pipeline_text.first_date(raw_upload)
    if not date and len(raw_upload) == 8 and raw_upload.isdigit():
        try:
            date = _datetime.date(int(raw_upload[:4]), int(raw_upload[4:6]), int(raw_upload[6:])).isoformat()
        except ValueError:
            date = ""
    if date:
        return date
    return ""


def valid_video_metadata(value: pipeline_common.Any, video_id: str) -> bool:
    return bool(isinstance(value, dict) and value.get('id') == video_id
                and value.get('title') and value.get('channel_id')
                and _approximate_date({key: value.get(key) for key in ('release_date', 'release_timestamp', 'upload_date')}))


def cached_video_metadata(video_id: str, max_age: int) -> dict[str, pipeline_common.Any] | None:
    cache_file = PROGRAM_METADATA_CACHE / f"{video_id}.json"
    try:
        if pipeline_common.time.time() - cache_file.stat().st_mtime <= max_age:
            value = pipeline_common.read_json(cache_file)
            if valid_video_metadata(value, video_id):
                return value
    except (OSError, ValueError):
        pass
    return None


def public_watch_metadata(video_id: str, expected_channel: str = "") -> dict[str, pipeline_common.Any]:
    """Read published metadata from the official watch page without a player session."""
    url = f'https://www.youtube.com/watch?v={video_id}&hl=ja'
    request = pipeline_common.urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with pipeline_common.urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError('public watch page exceeds metadata limit')
    text = raw.decode('utf-8', 'replace')
    match = pipeline_common.re.search(r'ytInitialPlayerResponse\s*=\s*', text)
    player = {}
    if match:
        try:
            player = pipeline_common.json.JSONDecoder().raw_decode(text[match.end():])[0]
        except pipeline_common.json.JSONDecodeError:
            player = {}
    details = player.get('videoDetails') or {}
    micro = (player.get('microformat') or {}).get('playerMicroformatRenderer') or {}
    class PageMetadata(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.values = {}
            self.canonical = ''
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == 'meta' and attrs.get('content'):
                self.values[attrs.get('itemprop') or attrs.get('name') or attrs.get('property')] = attrs['content']
            if tag == 'link' and attrs.get('rel') == 'canonical':
                self.canonical = attrs.get('href') or ''
    page = PageMetadata()
    page.feed(text)
    def meta(name):
        return page.values.get(name, '')
    if not details.get('videoId') and page.canonical:
        canonical_id = pipeline_common.urllib.parse.parse_qs(pipeline_common.urllib.parse.urlparse(page.canonical).query).get('v', [''])[0]
        if canonical_id == video_id:
            details['videoId'] = canonical_id
    published = micro.get('publishDate') or micro.get('uploadDate') or meta('datePublished') or meta('uploadDate')
    if not published:
        for block in pipeline_common.re.findall(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>', text, pipeline_common.re.I):
            try:
                payload = pipeline_common.json.loads(pipeline_common.html.unescape(block))
                candidates = payload if isinstance(payload, list) else [payload]
                video = next((item for item in candidates if isinstance(item, dict) and item.get('@type') in ('VideoObject', ['VideoObject'])), {})
                published = video.get('uploadDate') or video.get('datePublished') or ''
                details['title'] = details.get('title') or video.get('name') or ''
                details['shortDescription'] = details.get('shortDescription') or video.get('description') or ''
                if published: break
            except (ValueError, TypeError):
                continue
    if not details.get('title'):
        details['title'] = meta('name') or meta('title')
    if not details.get('shortDescription'):
        details['shortDescription'] = meta('description')
    if not details.get('channelId'):
        # Discovery only supplies this value for an owned official-channel
        # feed. Never read a recommended video's channel from arbitrary JSON.
        details['channelId'] = meta('channelId') or expected_channel
    live = micro.get('liveBroadcastDetails') or {}
    released = live.get('startTimestamp') or published
    try:
        stamp = _datetime.datetime.fromisoformat(released.replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=_datetime.timezone(_datetime.timedelta(hours=9)))
    except (ValueError, AttributeError):
        raise ValueError('public watch date unavailable')
    thumbnails = (details.get('thumbnail') or {}).get('thumbnails') or []
    result = {
        'id': details.get('videoId'), 'channel_id': details.get('channelId'),
        'title': details.get('title'), 'description': details.get('shortDescription') or '',
        'release_timestamp': stamp.timestamp(),
        'thumbnail': thumbnails[-1].get('url', '') if thumbnails else (meta('thumbnailUrl') or meta('og:image')),
        'webpage_url': f'https://www.youtube.com/watch?v={video_id}',
        'duration': int(details.get('lengthSeconds') or 0), 'metadata_origin': 'official_watch_page',
    }
    missing = [field for field, value in (('canonical video id', result.get('id')), ('title', result.get('title')), ('channel id', result.get('channel_id')), ('published date', released)) if not value]
    if missing:
        raise ValueError('public watch missing ' + ', '.join(missing))
    if not valid_video_metadata(result, video_id):
        raise ValueError('public watch canonical identity/date mismatch')
    if expected_channel and result.get('channel_id') != expected_channel:
        raise ValueError('public watch channel mismatch: expected ' + expected_channel)
    return result


def fetch_video_metadata(video_id: str, max_age: int = METADATA_TTL_PUBLISHED, expected_channel: str = "") -> dict[str, pipeline_common.Any] | None:
    """Read verified metadata cache first; failed fetches are never cached."""
    cache_file = PROGRAM_METADATA_CACHE / f"{video_id}.json"
    def usable(value: dict[str, pipeline_common.Any]) -> bool:
        return valid_video_metadata(value, video_id)
    try:
        if cache_file.is_file() and pipeline_common.time.time() - cache_file.stat().st_mtime <= max_age:
            cached = pipeline_common.json.loads(cache_file.read_text(encoding="utf-8"))
            if usable(cached):
                return cached
    except (OSError, pipeline_common.json.JSONDecodeError, AttributeError):
        pass
    stale = None
    try:
        if cache_file.is_file():
            candidate = pipeline_common.json.loads(cache_file.read_text(encoding="utf-8"))
            if usable(candidate):
                stale = candidate
    except (OSError, pipeline_common.json.JSONDecodeError, AttributeError):
        pass
    from public_video import yt_command
    reasons = []
    from public_video import error_reason
    for client in ('default', 'android'):
        extractor = 'youtube:lang=ja' + (';player_client=android' if client == 'android' else '')
        command = yt_command(["--skip-download", "--ignore-no-formats-error", "--extractor-args", extractor, "--no-warnings", "--socket-timeout", "12", "--dump-single-json", f"https://www.youtube.com/watch?v={video_id}"])
        try:
            result = pipeline_common.subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8", timeout=30)
            metadata = pipeline_common.json.loads(result.stdout)
            if not usable(metadata):
                missing = [name for name, ok in (
                    ('identity', metadata.get('id') == video_id), ('title', metadata.get('title')),
                    ('channel', metadata.get('channel_id')),
                    ('date', _approximate_date({key: metadata.get(key) for key in ('release_date', 'release_timestamp', 'upload_date')})),
                ) if not ok]
                reasons.append(client + ': missing ' + ','.join(missing))
                continue
            try:
                PROGRAM_METADATA_CACHE.mkdir(parents=True, exist_ok=True)
                temporary = cache_file.with_suffix(".json.tmp")
                temporary.write_text(pipeline_common.json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
                temporary.replace(cache_file)
            except OSError:
                pass
            METADATA_ERRORS.pop(video_id, None)
            return metadata
        except (OSError, pipeline_common.subprocess.SubprocessError, pipeline_common.json.JSONDecodeError) as error:
            reasons.append(client + ': ' + error_reason(error))
    try:
        metadata = public_watch_metadata(video_id, expected_channel)
        pipeline_common.atomic_json(cache_file, metadata)
        METADATA_ERRORS.pop(video_id, None)
        return metadata
    except (OSError, ValueError, TimeoutError, AttributeError) as error:
        reasons.append('official watch page: ' + str(error)[:180])
    METADATA_ERRORS[video_id] = '; '.join(reasons)
    if stale:
        stale['_metadata_stale'] = True
    return stale


def discover_channel_feed(feed: str, limit: int) -> list[dict[str, pipeline_common.Any]]:
    from public_video import yt_command
    url = feed if feed.startswith("http") else f"https://www.youtube.com/@UMAMUSUME_official/{feed}"
    command = yt_command(["--flat-playlist", "--playlist-end", str(limit), "--no-warnings", "--socket-timeout", "12", "--dump-json", url])
    result = pipeline_common.subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=120)
    rows = []
    for line in result.stdout.splitlines():
        try:
            rows.append(pipeline_common.json.loads(line))
        except pipeline_common.json.JSONDecodeError:
            continue
    errors = []
    if not rows:
        errors.append('official channel ' + feed + ': no readable public entries')
    if result.returncode:
        from public_video import error_reason
        errors.append('official channel ' + feed + ': ' + error_reason(pipeline_common.subprocess.CalledProcessError(result.returncode, command, stderr=result.stderr)))
    return DiscoveryRows(rows, errors)


class DiscoveryRows(list):
    def __init__(self, rows=(), errors=()):
        super().__init__(rows)
        self.errors = list(errors)


def discover_official_channel() -> list[dict[str, pipeline_common.Any]]:
    rows, errors = [], []
    with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(discover_channel_feed, "videos", 1600),
            executor.submit(discover_channel_feed, "streams", 400),
        ]
        for future in futures:
            try:
                discovered = future.result()
                rows.extend(discovered)
                errors.extend(getattr(discovered, 'errors', []))
            except (OSError, pipeline_common.subprocess.SubprocessError) as error:
                from public_video import error_reason
                errors.append('official channel feed: ' + error_reason(error))
    for external in EXTERNAL_OFFICIAL_CHANNELS:
        for feed_name in ("videos", "streams"):
            try:
                channel_base = external["feed"].split("/videos", 1)[0].rstrip("/")
                discovered = discover_channel_feed(channel_base + "/" + feed_name, 400)
                for row in discovered:
                    row["source_channel"] = external["name"]
                    row["source_channel_id"] = external["channel_id"]
                rows.extend(discovered)
                errors.extend(getattr(discovered, "errors", []))
            except (OSError, pipeline_common.subprocess.SubprocessError) as error:
                errors.append(f"{external['name']} {feed_name}: " + str(error))
    try:
        movie_index = fetch_json_url(PAKATUBE_MOVIE_INDEX)
        for group in (movie_index.get("latest") or [], movie_index.get("shorts") or []):
            for movie in group:
                if movie.get("url"):
                    rows.append({"id": movie["url"], "title": movie.get("title") or "", "source": "pakatube_movie_index"})
    except Exception as error:
        errors.append("pakatube movie index unavailable: " + type(error).__name__)
    by_id = {str(row["id"]): row for row in rows if row.get("id")}
    for row in by_id.values():
        row["approximate_date"] = _approximate_date(row)
    try:
        IGNORED_PROGRAM_CANDIDATES.parent.mkdir(parents=True, exist_ok=True)
        with IGNORED_PROGRAM_CANDIDATES.open("w", encoding="utf-8") as stream:
            for row in by_id.values():
                title = str(row.get("title") or "")
                if "【ウマ娘の日常】" in title or "同時視聴" in title:
                    stream.write(pipeline_common.json.dumps({"id": row.get("id"), "title": title, "approximate_date": row.get("approximate_date")}, ensure_ascii=False) + "\n")
    except OSError:
        errors.append("program candidate report could not be written")
    return DiscoveryRows(by_id.values(), errors)


def is_pakatube_character_program(title: str) -> bool:
    value = pipeline_common.unicodedata.normalize("NFKC", title or "")
    if pipeline_program_text.program_identity(value)[0]:
        return False
    if pipeline_common.re.search(r"(?:CM|PV|MV|ショート|Shorts|特報|ティザー|トレーラー)", value, pipeline_common.re.I):
        return False
    return bool(pipeline_common.re.search(
        r"ゲーム実況|ボドゲ実況|お絵かき配信|打ち上げプチ配信|^【配信】|同時視聴|"
        r"ぱかチューブっ!出張版|ぴすラジッ|ゴルシトーク|ぱかトークっ!|"
        r"完全密着|梅雨特別企画|焼肉シミュレーター|メカダービー",
        value,
        pipeline_common.re.I,
    ))


def is_official_special_video(title: str) -> bool:
    value = pipeline_common.unicodedata.normalize("NFKC", title or "")
    return bool(
        pipeline_common.re.fullmatch(r"そこそこぱかライブTV\s*-EXTRA STAGE-", value, pipeline_common.re.I)
        or pipeline_common.re.search(r"うまよん.*オーディオコメンタリーリレー第\d+回", value, pipeline_common.re.I)
        or pipeline_common.re.search(r"【ウマ娘の日常】", value)
        or pipeline_common.re.search(r"同時視聴", value)
        or pipeline_common.re.search(r"ゴルシちゃんのGW計画.*Vol\.?\s*564", value, pipeline_common.re.I)
    )


def announcement_identity(title: str, message: str, date: str) -> tuple[str, str]:
    regular = pipeline_program_text.program_identity(title)
    if not regular[0]:
        regular = pipeline_program_text.program_identity(pipeline_text.clean_text(message))
    if regular[0]:
        return regular
    value = pipeline_common.unicodedata.normalize("NFKC", title or "")
    if "ぱかスペース" in value and "同時視聴" in value:
        match = pipeline_common.re.search(r"(\d+(?:st|nd|rd|th)\s*EVENT\s*-[A-Z ]+-)", value, pipeline_common.re.I)
        suffix = pipeline_text.stable_title_suffix(match.group(1) if match else value)
        return f"official-special-paka-space-{suffix}", "official-special"
    if "ウマ娘が出走決定" in value and pipeline_common.re.search(r"放送|テレビ|NHK", value, pipeline_common.re.I):
        match = pipeline_common.re.search(r"[「『]([^」』]+)[」』]", value)
        program_name = match.group(1) if match else value
        return f"official-special-{date.replace('-', '') or 'undated'}-{pipeline_text.stable_title_suffix(program_name)}", "official-special"
    if is_official_collaboration_program(value, message):
        name = pipeline_text.stable_title_suffix(value) or "collaboration-program"
        return f"official-special-{date.replace('-', '') or 'undated'}-{name}", "official-special"
    return "", ""


def is_official_program_announcement(title: str) -> bool:
    value = pipeline_common.unicodedata.normalize("NFKC", title or "")
    regular = bool(pipeline_program_text.program_identity(value)[0] and pipeline_common.re.search(r"放送|配信|公開", value) and "発表まとめ" not in value)
    return bool(
        regular
        or ("ぱかスペース" in value and "同時視聴" in value)
        or ("ウマ娘が出走決定" in value and pipeline_common.re.search(r"放送|テレビ|NHK", value, pipeline_common.re.I))
        or ("そこぱか" in value and "生放送" in value and "振り返りスペシャル" in value)
        or is_official_collaboration_program(value)
    )


def is_official_collaboration_program(value: str, message: str = "") -> bool:
    text = pipeline_common.unicodedata.normalize("NFKC", f"{value} {message}")
    partner = pipeline_common.re.search(r"プリコネ|プリンセスコネクト|Re\s*:\s*Dive|Cygames\s*Fes|Cygamesフェス", text, pipeline_common.re.I)
    uma = pipeline_common.re.search(r"ウマ娘|ぱか|スペシャルウィーク|ゴールドシップ", text, pipeline_common.re.I)
    broadcast = pipeline_common.re.search(r"生放送|配信|放送|公開録音|番組|チャンネル", text, pipeline_common.re.I)
    return bool(partner and uma and broadcast)


def is_official_program_candidate(title: str, message: str = "") -> bool:
    """Recognize programme-shaped official material without collecting PV/MV/shorts."""
    value = pipeline_common.unicodedata.normalize("NFKC", f"{title} {message}")
    if 'トレセン学園生徒紹介' in value:
        return False
    if pipeline_common.re.search(r'Acoustic|切り抜き|ダイジェスト|生演奏|歌唱映像', title or '', pipeline_common.re.I):
        return False
    if pipeline_common.re.search(r"(?:CM|PV|MV|ショート|Shorts|特報|ティザー|トレーラー)", value, pipeline_common.re.I):
        return False
    if pipeline_common.re.search(r"アニメ.*第\d+話", value, pipeline_common.re.I) and "同時視聴" not in value:
        return False
    return bool(
        pipeline_program_text.program_identity(title)[0]
        or is_pakatube_character_program(title)
        or is_official_special_video(title)
        or is_official_collaboration_program(title, message)
    )


def fetch_json_url(url: str) -> dict[str, pipeline_common.Any]:
    request = pipeline_common.urllib.request.Request(url, headers={"User-Agent": "uma-live-wiki event updater"})
    with pipeline_common.urllib.request.urlopen(request, timeout=30) as response:
        return pipeline_common.json.load(response)


def _metadata_ttl(row: dict[str, pipeline_common.Any]) -> int:
    """Use shorter revalidation windows for upcoming or undated broadcasts."""
    date = pipeline_text.first_date(row.get("date") or row.get("approximate_date"))
    if not date:
        return METADATA_TTL_UNDATED
    try:
        return METADATA_TTL_UPCOMING if pipeline_common.dt.date.fromisoformat(date) >= pipeline_common.dt.date.today() else METADATA_TTL_PUBLISHED
    except ValueError:
        return METADATA_TTL_UNDATED


def _video_ids(row: dict[str, pipeline_common.Any]) -> set[str]:
    return {
        str(video_id) for video_id in [row.get("video_id"), *(item.get("video_id") for item in row.get("media") or [] if isinstance(item, dict))]
        if video_id
    }


def _inventory_title(value: str) -> str:
    value = pipeline_program_text.canonical_program_title(value)
    return pipeline_common.re.sub(r'【[^】]*視点[^】]*】\s*$', '', value).strip()


def existing_metadata_is_due(existing: dict, listing: dict) -> bool:
    """Use the official listing as the change signal for complete past episodes."""
    if not is_official_program_candidate(str(listing.get('title') or '')):
        return False  # Supplementary performance clips do not redefine episodes.
    if cached_video_metadata(str(listing['id']), _metadata_ttl(existing)):
        return True
    if _inventory_title(str(existing.get('title') or '')) != _inventory_title(str(listing.get('title') or '')):
        return True
    checked = float(existing.get('metadata_checked_at') or 0)
    if checked and pipeline_common.time.time() - checked >= METADATA_TTL_PUBLISHED:
        return True
    return bool(not existing.get('date') or str(existing['date']) >= pipeline_common.dt.date.today().isoformat()
                or existing.get('metadata_status') == 'pending' or existing.get('cast_status') in {'pending', 'partial'})


def official_news_programs() -> list[dict[str, pipeline_common.Any]]:
    errors = []
    index_rows = []
    first = fetch_json_url("https://umamusume.jp/api/ajax/pr_info_index?format=json&page=1")
    if first.get('response_code') != 1:
        raise ValueError('Official announcement index unavailable')
    index_rows.extend(first.get("information_list") or [])
    total_pages = int(first.get("total_page_count") or 1)

    def fetch_page(page: int) -> list[dict[str, pipeline_common.Any]]:
        try:
            data = fetch_json_url(f"https://umamusume.jp/api/ajax/pr_info_index?format=json&page={page}")
            if data.get('response_code') != 1:
                raise ValueError('Official announcement page unavailable')
            return data.get("information_list") or []
        except Exception:
            errors.append('official announcement index page unavailable: ' + str(page))
            return []

    with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for rows in executor.map(fetch_page, range(2, total_pages + 1)):
            index_rows.extend(rows)
    candidates = []
    for row in index_rows:
        if is_official_program_announcement(row.get("title") or ""):
            candidates.append(row)

    archived = {}
    archive_file = pipeline_common.DATA_DIR / 'auto_update/news.sqlite'
    if archive_file.exists():
        from news_database import NewsDatabase
        archive = None
        try:
            archive = NewsDatabase(archive_file)
            for row in candidates:
                data = archive.get('official-' + str(row['announce_id']))
                if data and (not row.get('update_at') or data['detail'].get('update_at') == row['update_at']):
                    archived[str(row['announce_id'])] = data['detail']
        except (OSError, sqlite3.Error, ValueError):
            errors.append('news archive could not be read; collecting announcements directly')
        finally:
            if archive:
                archive.db.close()

    def fetch_detail(row: dict[str, pipeline_common.Any]) -> tuple[dict[str, pipeline_common.Any], dict[str, pipeline_common.Any]]:
        if str(row['announce_id']) in archived:
            return row, archived[str(row['announce_id'])]
        try:
            data = fetch_json_url(f"https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id={row['announce_id']}")
            return row, data.get("detail") or {}
        except Exception:
            errors.append('official announcement detail unavailable: ' + str(row['announce_id']))
            return row, {}

    programs = []
    with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for row, detail in executor.map(fetch_detail, candidates):
            if not detail.get('message'):
                errors.append('official announcement body unavailable: ' + str(row['announce_id']))
                continue
            title = detail.get("title") or row.get("title") or ""
            message = detail.get("message") or ""
            fallback_date = pipeline_text.first_date(detail.get("post_at") or row.get("post_at"))
            date = pipeline_program_text.parse_program_date(message) or pipeline_text.first_date(message) or fallback_date
            event_id, series_id = announcement_identity(title, message, date)
            if not event_id:
                continue
            youtube_match = pipeline_common.re.search(r"https?://(?:www\.)?(?:youtube\.com/(?:live|watch\?v=)|youtu\.be/)([A-Za-z0-9_-]{11})", pipeline_common.html.unescape(message))
            video_id = youtube_match.group(1) if youtube_match else ""
            video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else ""
            official_url = f"https://umamusume.jp/news/detail?id={row['announce_id']}"
            program_message = message
            if "プレミアの巣窟" in title or "ONE SONG FES" in title:
                program_message = pipeline_common.re.split(r"[「『]TOKYO IDOL FESTIVAL[^」』]*[」』]概要", message, maxsplit=1)[0]
            sessions = pipeline_program_text.parse_program_sessions(program_message, date)
            cast = pipeline_program_text.parse_program_cast(program_message) or pipeline_program_text.parse_intro_cast(program_message)
            if "プレミアの巣窟" in title and not sessions:
                schedule_text = pipeline_common.re.split(r"※放送時間|番組概要", "\n".join(pipeline_program_text.program_text_lines(program_message)), maxsplit=1)[0]
                parsed_dates = pipeline_text.all_dates(schedule_text)
                if len(parsed_dates) > 1:
                    sessions = [{"label": f"第{index + 1}回", "date": value, "cast": cast} for index, value in enumerate(parsed_dates[:2])]
            display_title = pipeline_program_text.canonical_program_title(title)
            programs.append({
                "id": event_id, "series_id": series_id, "title": display_title,
                **({"source_title": title} if display_title != title else {}), "date": date,
                "end_date": sessions[-1]["date"] if sessions and sessions[-1].get("date") else date,
                "video_id": video_id, "url": video_url, "thumbnail": row.get("image") or "", "duration": None,
                "cast_status": "verified" if cast else "pending", "cast": cast, "characters": [], "sessions": sessions,
                "summary": pipeline_text.clean_text(message)[:260], "source_kind": "official_announcement", "source_url": official_url,
            })
    return DiscoveryRows(programs, errors)


def refresh_programs() -> dict[str, pipeline_common.Any]:
    existing_doc = pipeline_common.read_json(pipeline_common.EVENTS_DIR / "official_programs.json") if (pipeline_common.EVENTS_DIR / "official_programs.json").exists() else {"programs": []}
    existing_programs = list(existing_doc.get("programs") or [])
    youtube_available = bool(pipeline_common.shutil_which("yt-dlp"))
    channel_entries = discover_official_channel() if youtube_available else []
    source_errors = list(getattr(channel_entries, 'errors', []))
    metadata_rechecks = []
    if not youtube_available:
        source_errors.append('required program collector yt-dlp is unavailable')
    rebuild_regular = int(existing_doc.get("schema_version") or 1) < 2 and bool(channel_entries)
    expected_ids = pipeline_program_text.expected_regular_program_ids([*existing_programs, *channel_entries])
    expected_id_values = set(expected_ids.values())
    programs = []
    for row in existing_programs:
        event_id, series_id = pipeline_program_text.program_identity(row.get("title") or "")
        if rebuild_regular and event_id and series_id in pipeline_common.REGULAR_PROGRAM_BASELINES:
            continue
        if event_id and series_id in pipeline_common.REGULAR_PROGRAM_BASELINES and "発表まとめ" in (row.get("title") or ""):
            continue
        if not event_id or series_id not in pipeline_common.REGULAR_PROGRAM_BASELINES or row.get("id") in expected_id_values:
            programs.append(row)
    existing_video_ids = {
        str(video_id)
        for row in programs
        for video_id in [row.get("video_id"), *(item.get("video_id") for item in row.get("media") or [])]
        if video_id
    }
    existing_by_video = {
        video_id: row
        for row in programs
        for video_id in _video_ids(row)
    }

    candidates = {
        str(row["id"]): row
        for row in channel_entries
        if row.get("id")
        and (
            (str(row["id"]) in existing_video_ids and existing_metadata_is_due(existing_by_video[str(row['id'])], row))
            or (pipeline_program_text.program_identity(row.get("title") or "")[0] in expected_id_values and str(row["id"]) not in existing_video_ids)
            or (is_pakatube_character_program(row.get("title") or "") and str(row["id"]) not in existing_video_ids)
            or (is_official_special_video(row.get("title") or "") and str(row["id"]) not in existing_video_ids)
            or (is_official_program_candidate(row.get("title") or "") and str(row["id"]) not in existing_video_ids)
            or (row.get("source_channel") and is_official_collaboration_program(row.get("title") or "") and str(row["id"]) not in existing_video_ids)
        )
    }
    fetched_metadata = []
    all_candidate_rows = sorted(candidates.values(), key=lambda row: (row.get("approximate_date") or "", str(row.get("id") or "")), reverse=True)
    fresh_rows, network_rows = [], []
    for row in all_candidate_rows:
        if cached_video_metadata(row['id'], _metadata_ttl(existing_by_video.get(row['id'], row))):
            fresh_rows.append(row)
        else:
            network_rows.append(row)
    # Persist attempts so unreachable records cannot occupy the same network
    # slots forever. New releases precede historical TTL revalidation.
    batch_size = min(64, len(network_rows))
    # New and pending records have priority; older TTL refreshes use the
    # remaining network slots. Fresh cache rows are unlimited and local.
    attempts_file = PROGRAM_METADATA_CACHE.parent / 'metadata-attempts.json'
    try:
        attempts = pipeline_common.read_json(attempts_file)
    except (OSError, ValueError):
        attempts = {}
    def priority(row):
        try:
            date_order = pipeline_common.dt.date.fromisoformat(row.get('approximate_date') or '').toordinal()
        except ValueError:
            date_order = 0
        return (str(row['id']) in existing_video_ids, attempts.get(row['id'], 0), -date_order, str(row['id']))
    network_rows.sort(key=priority)
    for row in network_rows[:batch_size]:
        attempts[row['id']] = pipeline_common.time.time()
    pipeline_common.atomic_json(attempts_file, attempts)
    candidate_rows = [*fresh_rows, *network_rows[:batch_size]]
    fetched_video_ids: set[str] = set()
    with pipeline_common.concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(
            fetch_video_metadata,
            row["id"],
            _metadata_ttl(existing_by_video.get(row["id"], row)),
            row.get("source_channel_id") or row.get("channel_id") or pipeline_common.OFFICIAL_CHANNEL_ID,
        ): row["id"] for row in candidate_rows}
        for future in pipeline_common.concurrent.futures.as_completed(futures):
            metadata = future.result()
            source_row = next((row for row in candidate_rows if row.get("id") == futures[future]), {})
            if source_row.get("source_channel"):
                channel_url = str(metadata.get("channel_url") or metadata.get("uploader_url") or "") if metadata else ""
                if not metadata or (
                    metadata.get("channel_id") != source_row.get("source_channel_id")
                    and source_row["source_channel"] not in channel_url.lower()
                ):
                    reason = 'external video metadata unavailable or channel mismatch: ' + futures[future] + ': ' + METADATA_ERRORS.get(futures[future], 'unexpected channel')
                    (metadata_rechecks if futures[future] in existing_by_video else source_errors).append(reason)
                    continue
            elif not metadata or metadata.get("channel_id") != pipeline_common.OFFICIAL_CHANNEL_ID:
                reason = 'official video metadata unavailable: ' + futures[future] + ': ' + METADATA_ERRORS.get(futures[future], 'unexpected channel')
                (metadata_rechecks if futures[future] in existing_by_video else source_errors).append(reason)
                continue
            if metadata.get("_metadata_stale"):
                (metadata_rechecks if futures[future] in existing_by_video else source_errors).append("stale metadata retained after refresh failure: " + futures[future])
            fetched_metadata.append(metadata)
            try:
                metadata['_metadata_checked_at'] = (PROGRAM_METADATA_CACHE / (str(metadata['id']) + '.json')).stat().st_mtime
            except OSError:
                metadata['_metadata_checked_at'] = pipeline_common.time.time()
            fetched_video_ids.add(str(metadata.get("id") or futures[future]))
            if not is_official_program_candidate(metadata.get('title') or ''):
                continue
            event_id, series_id = pipeline_program_text.program_identity(metadata.get("title") or "")
            description = metadata.get("description") or ""
            broadcast_date = pipeline_program_text.parse_program_date(description)
            if not broadcast_date:
                broadcast_date = _approximate_date(metadata)
            cast = pipeline_program_text.parse_program_cast(description)
            source_title = metadata.get("title") or ""
            display_title = pipeline_program_text.canonical_program_title(source_title)
            if not event_id and not is_pakatube_character_program(source_title) and (is_official_special_video(source_title) or is_official_collaboration_program(source_title)):
                series_id = "official-special"
                suffix = pipeline_text.stable_title_suffix(source_title) or str(metadata.get("id") or futures[future])
                event_id = f"official-special-{broadcast_date.replace('-', '') or 'undated'}-{suffix}"
                display_title = source_title.strip()
            if not event_id:
                continue
            programs.append({
                "id": event_id, "series_id": series_id, "title": display_title, **({"source_title": source_title} if display_title != source_title else {}), "date": broadcast_date,
                "metadata_checked_at": metadata['_metadata_checked_at'],
                "video_id": metadata.get("id") or "", "url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}",
                "thumbnail": metadata.get("thumbnail") or "", "duration": metadata.get("duration"),
                "cast_status": "verified" if cast else "pending", "cast": cast, "characters": [],
                "sessions": pipeline_program_text.parse_program_sessions(description, broadcast_date),
                "summary": next((line.strip() for line in description.splitlines() if line.strip()), ""),
                "source_kind": "official_external" if source_row.get("source_channel") else "official_youtube", "source_url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}",
                "sources": [{
                    "kind": "official_external" if source_row.get("source_channel") else "official_youtube",
                    "label": "联动方官方频道" if source_row.get("source_channel") else "官方 YouTube",
                    "url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}",
                }],
            })
    try:
        news_programs = official_news_programs()
    except Exception as error:
        news_programs = []
        source_errors.append('official announcement discovery: ' + type(error).__name__)
    programs.extend(news_programs)
    source_errors.extend(getattr(news_programs, 'errors', []))
    try:
        programs.extend(pipeline_archives.historical_programs())
    except Exception as error:
        # The committed snapshot remains authoritative when the supplementary
        # archive is temporarily unavailable.
        source_errors.append('supplementary program archive: ' + type(error).__name__)
    programs.extend(pipeline_archives.official_radio_programs(existing_programs))
    character_metadata = [metadata for metadata in fetched_metadata if is_pakatube_character_program(metadata.get("title") or "")]
    character_groups: dict[str, list[dict[str, pipeline_common.Any]]] = pipeline_common.defaultdict(list)
    for metadata in character_metadata:
        base_title = pipeline_common.re.sub(r"【[^】]*(?:視点)[^】]*】\s*$", "", metadata.get("title") or "").strip()
        date = _approximate_date(metadata)
        character_groups[f"{date}\t{base_title}"].append(metadata)
    for group_key, group in character_groups.items():
        metadata = sorted(group, key=lambda row: row.get("id") or "")[0]
        date = _approximate_date(metadata)
        description = metadata.get("description") or ""
        base_title = group_key.split("\t", 1)[1]
        suffix = pipeline_text.stable_suffix(base_title) or metadata["id"]
        media = [
            {"url": item.get("webpage_url") or f"https://www.youtube.com/watch?v={item['id']}", "label": "官方视频", "video_id": item.get("id") or "", "duration": item.get("duration")}
            for item in sorted(group, key=lambda row: row.get("title") or "")
        ]
        programs.append({
            "id": f"pakatube-{date.replace('-', '') or 'undated'}-{suffix}", "series_id": "pakatube-character-program", "title": base_title,
            "date": date, "video_id": metadata.get("id") or "", "url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata['id']}",
            "metadata_checked_at": metadata['_metadata_checked_at'],
            "thumbnail": metadata.get("thumbnail") or "", "duration": metadata.get("duration"),
            "cast_status": "character_only", "cast": [], "characters": [],
            "summary": pipeline_text.clean_text(description)[:500] or "角色出演节目。未将角色配音关系记作声优本人出演。",
            "source_kind": "official_youtube", "source_url": metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata['id']}",
            "media": media,
            "sources": [{"kind": "official_youtube", "label": "官方 YouTube", "url": item["url"]} for item in media],
        })
    for metadata in fetched_metadata:
        if not is_official_special_video(metadata.get("title") or "") or is_pakatube_character_program(metadata.get('title') or ''):
            continue
        description = metadata.get("description") or ""
        date = pipeline_program_text.parse_program_date(description) or _approximate_date(metadata)
        cast = pipeline_program_text.parse_program_cast(description)
        url = metadata.get("webpage_url") or f"https://www.youtube.com/watch?v={metadata.get('id')}"
        programs.append({
            "id": f"official-special-{date.replace('-', '') or 'undated'}-{pipeline_text.stable_title_suffix(metadata.get('title') or '')}",
            "series_id": "official-special",
            "title": metadata.get("title") or "",
            "date": date,
            "metadata_checked_at": metadata['_metadata_checked_at'],
            "video_id": metadata.get("id") or "",
            "url": url,
            "thumbnail": metadata.get("thumbnail") or "",
            "duration": metadata.get("duration"),
            "cast_status": "verified" if cast else ("character_only" if '【ウマ娘の日常】' in str(metadata.get('title') or '') else "pending"),
            "cast": cast,
            "characters": [],
            "sessions": pipeline_program_text.parse_program_sessions(description, date),
            "summary": description.split('▼', 1)[0].strip() if '【ウマ娘の日常】' in str(metadata.get('title') or '') else next((line.strip() for line in description.splitlines() if line.strip()), ""),
            "source_kind": "official_youtube",
            "source_url": url,
        })

    def implicit_sources(row: dict[str, pipeline_common.Any]) -> list[dict[str, str]]:
        if row.get("sources"):
            return list(row["sources"])
        source_url = row.get("source_url") or row.get("url") or ""
        if not source_url:
            return []
        source_kind = row.get("source_kind") or "official_youtube"
        labels = {
            "official_announcement": "官方公告",
            "official_youtube": "官方 YouTube",
            "community_archive": "Umamusume Wiki 补档",
            "official_broadcaster": "节目官方页",
        }
        return [{"kind": source_kind, "label": labels.get(source_kind, "资料来源"), "url": source_url}]

    # Combine archive metadata and announcements under one stable program ID.
    # The richer record supplies presentation fields; all evidence links, cast,
    # media, and session-specific cast remain available.
    by_id: dict[str, dict[str, pipeline_common.Any]] = {}
    for program in sorted(programs, key=lambda row: (bool(row.get("cast")), bool(row.get("video_id")), row.get("date") or "", row.get("video_id") or "")):
        event_id = program["id"]
        if event_id not in by_id:
            by_id[event_id] = dict(program)
            by_id[event_id]["sources"] = implicit_sources(program)
            continue
        target = by_id[event_id]
        target_priority = pipeline_common.PROGRAM_SOURCE_PRIORITY.get(str(target.get("source_kind") or ""), 0)
        program_priority = pipeline_common.PROGRAM_SOURCE_PRIORITY.get(str(program.get("source_kind") or ""), 0)
        richer = program_priority > target_priority or (
            program_priority == target_priority
            and (bool(program.get("cast")) or bool(program.get("video_id")))
        )
        if richer:
            for field in ("title", "date", "end_date", "video_id", "url", "thumbnail", "duration", "summary", "source_kind", "source_url", "schedule_status", "metadata_status", "metadata_checked_at"):
                if program.get(field):
                    target[field] = program[field]
        target["sources"] = list({(item.get("kind"), item.get("url")): item for item in [*target.get("sources", []), *implicit_sources(program)] if item.get("url")}.values())
        target["media"] = list({item.get("video_id") or item.get("url"): item for item in [*target.get("media", []), *program.get("media", [])] if item.get("video_id") or item.get("url")}.values())
        target["cast"] = list({(pipeline_text.fold_name(item.get("name") or ""), pipeline_text.fold_name(item.get("role") or "")): item for item in [*target.get("cast", []), *program.get("cast", [])] if item.get("name")}.values())
        sessions_by_key = {}
        for session in [*target.get("sessions", []), *program.get("sessions", [])]:
            key = (session.get("label"), session.get("date"))
            if key not in sessions_by_key:
                sessions_by_key[key] = dict(session)
                continue
            merged = sessions_by_key[key]
            merged["cast"] = list({
                (pipeline_text.fold_name(item.get("name") or ""), pipeline_text.fold_name(item.get("role") or "")): item
                for item in [*merged.get("cast", []), *session.get("cast", [])]
                if item.get("name")
            }.values())
        target["sessions"] = list(sessions_by_key.values())
        if target.get("cast"):
            target["cast_status"] = "verified"
    # Keep all known episode identities visible even when a retired archive and
    # expired announcement leave metadata incomplete. These records never create
    # cast relationships and are explicitly marked pending.
    for (_, _), event_id in expected_ids.items():
        if event_id in by_id:
            continue
        series_id = event_id.rsplit("-", 1)[0]
        number = int(event_id.rsplit("-", 1)[1])
        name = {"paka-live-tv": "ぱかライブTV", "paka-live-tv-prime": "ぱかライブTV'", "sokosoko-paka-live-tv": "そこそこぱかライブTV"}[series_id]
        marker = f"#{number}" if series_id == "paka-live-tv-prime" else f"Vol.{number}"
        by_id[event_id] = {
            "id": event_id, "series_id": series_id, "title": f"{name} {marker}", "date": "", "video_id": "", "url": "",
            "thumbnail": "", "duration": None, "cast_status": "pending", "cast": [], "characters": [],
            "summary": "节目条目已建立，播出日期、出演者与官方来源链接待补充。", "metadata_status": "pending",
        }
    ordered = sorted(by_id.values(), key=lambda row: (row["series_id"], row["id"]))
    found_ids = {row["id"] for row in ordered if row["id"] in set(expected_ids.values()) and row.get("date") and (row.get("source_url") or row.get("url"))}
    missing_ids = sorted(set(expected_ids.values()) - found_ids)
    pending_video_ids = sorted(
        set(candidates) - fetched_video_ids - existing_video_ids,
        key=lambda value: (candidates[value].get("approximate_date") or "", value),
        reverse=True,
    )
    return {
        "schema_version": 2,
        "source": f"official YouTube channel {pipeline_common.OFFICIAL_CHANNEL_ID} and official portal announcements",
        "refreshed_at": pipeline_common.dt.datetime.now(pipeline_common.dt.timezone.utc).replace(microsecond=0).isoformat(),
        "coverage": {
            "official_youtube_refresh": ("metadata_recheck_pending" if metadata_rechecks else "verified") if channel_entries else ("tool_unavailable" if not youtube_available else "source_unavailable"),
            "source_errors": source_errors,
            "metadata_recheck_pending": metadata_rechecks,
            "expected_regular_episodes": len(expected_ids),
            "records": len(ordered),
            "source_verified_regular_episodes": len(found_ids),
            "metadata_pending_ids": missing_ids,
            "metadata_candidate_count": len(candidates),
            "metadata_batch_count": len(candidate_rows),
            "metadata_pending_video_ids": pending_video_ids,
            "pakatube_character_programs": sum(row.get("series_id") == "pakatube-character-program" for row in ordered),
            "official_special_programs": sum(row.get("series_id") == "official-special" for row in ordered),
        },
        "programs": ordered,
    }
