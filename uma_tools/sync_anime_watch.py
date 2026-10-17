"""Recheck public viewing resources and preserve known links during transient failures."""
import argparse
import concurrent.futures
import datetime as dt
import json
import html
import re
import subprocess
import time
import threading
import urllib.error
import urllib.request
import urllib.parse
from knowledge_io import ROOT, read_json, write_json, USER_AGENT
from public_video import yt_command, error_reason

FILE = ROOT / 'data/anime/watch_resources.json'
STATE = ROOT / 'data/auto_update/anime_watch.json'


def check_resource(resource, run=subprocess.run):
    url = resource['url']
    parsed = urllib.parse.urlparse(url)
    if resource.get('platform') == 'youtube' and parsed.hostname in ('youtu.be', 'www.youtube.com', 'youtube.com', 'm.youtube.com'):
        video_id = parsed.path.strip('/') if parsed.hostname == 'youtu.be' else urllib.parse.parse_qs(parsed.query).get('v', [''])[0]
        if not video_id and parsed.path.startswith(('/shorts/', '/embed/', '/live/')):
            video_id = parsed.path.strip('/').split('/')[-1]
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
            return 'source_unavailable', 'provider video identity was not recognized'
        url = 'https://www.youtube.com/watch?v=' + video_id
        result = run(yt_command(['--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '12', '--dump-single-json', url]),
                     capture_output=True, text=True, encoding='utf-8', timeout=60)
        if result.returncode:
            error = result.stderr or ''
            if re.search(r'not available in your country|geo.restricted', error, re.I):
                return 'region_limited', 'provider reports a region restriction'
            if re.search(r'video (?:has been )?removed|private video|does not exist|account.*terminated', error, re.I):
                return 'expired', 'provider reports an unavailable video'
            return 'source_unavailable', error_reason(subprocess.CalledProcessError(result.returncode, 'yt-dlp', stderr=error))
        metadata = json.loads(result.stdout)
        if metadata.get('id') != video_id:
            return 'source_unavailable', 'provider returned a different video identity'
        if metadata.get('availability') in ('needs_auth', 'subscriber_only', 'premium_only'):
            return 'membership', 'provider requires an account or membership'
        if metadata.get('availability') == 'private':
            return 'expired', 'public access is unavailable'
        if not metadata.get('id') or not metadata.get('title') or not metadata.get('formats'):
            return 'source_unavailable', 'public media metadata was incomplete'
        return 'active', 'public video metadata and formats are available'
    request = urllib.request.Request(url, headers={'User-Agent':USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(1024 * 1024).decode('utf-8', 'replace')
            title = re.search(r'<title[^>]*>(.*?)</title>', body, re.I | re.S)
            title = html.unescape(re.sub(r'<[^>]+>', '', title.group(1))).strip() if title else ''
            blocked = re.search(r'404|not found|access denied|sign[ -]?in|log[ -]?in|登录|登入|驗證|验证|エラー|ページが見つかりません', title, re.I)
            final = urllib.parse.urlparse(response.geturl())
            same_provider = (final.hostname or '').removeprefix('www.') == (parsed.hostname or '').removeprefix('www.')
            requested_ids = set(re.findall(r'[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*', parsed.path))
            final_ids = set(re.findall(r'[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*', final.path))
            same_resource = not requested_ids or requested_ids.issubset(final_ids)
            identity = re.search(r'ウマ娘|赛马娘|賽馬娘|[Uu]ma\s*[Mm]usume', title)
            if response.status == 200 and identity and not blocked and same_provider and same_resource:
                return 'active', 'provider title identifies the requested series; existing access and region terms apply'
            return 'source_unavailable', 'provider page metadata was not recognized'
    except urllib.error.HTTPError as error:
        return ('expired' if error.code in (404, 410) else 'source_unavailable'), 'provider HTTP ' + str(error.code)
    except (OSError, TimeoutError):
        return 'source_unavailable', 'provider request failed'


def refresh(document, state, check=check_resource, now=None, limit=12):
    now = time.time() if now is None else now
    attempts = state.setdefault('attempted_at', {})
    rows = [row for row in document['resources'] if now - attempts.get(row['id'], 0) >= 86400]
    rows.sort(key=lambda row: (row.get('status') != 'unverified', attempts.get(row['id'], 0)))
    failures = []
    network_failed = threading.Event()
    def probe(row):
        if row.get('platform') == 'youtube' and network_failed.is_set():
            return 'source_unavailable', 'public video network unavailable in this update; retry later'
        try:
            result = check(row)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            result = ('source_unavailable', error_reason(error))
        if row.get('platform') == 'youtube' and result[0] == 'source_unavailable' and 'network' in result[1]:
            network_failed.set()
        return result
    selected = rows[:limit]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for row, (status, evidence) in zip(selected, pool.map(probe, selected)):
            attempts[row['id']] = now
            row['availability_check'] = {'checked_at':dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(), 'status':status, 'evidence':evidence}
            if status == 'source_unavailable':
                failures.append(row['id'])
                attempts[row['id']] = now - 86400 + 3600
            else:
                row['status'] = status
                row['verified_at'] = row['availability_check']['checked_at']
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--limit', type=int, default=12)
    args = parser.parse_args()
    document = read_json(FILE)
    state = read_json(STATE, {'attempted_at':{}})
    failures = refresh(document, state, limit=args.limit)
    if not args.dry_run:
        write_json(FILE, document); write_json(STATE, state)
    print('watch resources: %d retryable sources' % len(failures))
    return bool(failures)


if __name__ == '__main__':
    raise SystemExit(main())
