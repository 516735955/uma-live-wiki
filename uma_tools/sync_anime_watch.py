"""Recheck public viewing resources and preserve known links during transient failures."""
import argparse
import concurrent.futures
import datetime as dt
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from knowledge_io import ROOT, read_json, write_json, USER_AGENT
from public_video import yt_command

FILE = ROOT / 'data/anime/watch_resources.json'
STATE = ROOT / 'data/auto_update/anime_watch.json'


def check_resource(resource, run=subprocess.run):
    url = resource['url']
    if resource.get('platform') == 'youtube' and 'watch?' in url:
        result = run(yt_command(['--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '12', '--dump-single-json', url]),
                     capture_output=True, text=True, encoding='utf-8', timeout=60)
        if result.returncode:
            error = result.stderr or ''
            if re.search(r'not available in your country|geo.restricted', error, re.I):
                return 'region_limited', 'provider reports a region restriction'
            if re.search(r'video (?:has been )?removed|private video|does not exist|account.*terminated', error, re.I):
                return 'expired', 'provider reports an unavailable video'
            return 'source_unavailable', 'metadata request failed'
        metadata = json.loads(result.stdout)
        if metadata.get('availability') in ('private', 'needs_auth', 'subscriber_only', 'premium_only'):
            return 'expired', 'public access is unavailable'
        if not metadata.get('id') or not metadata.get('title') or not metadata.get('formats'):
            return 'source_unavailable', 'public media metadata was incomplete'
        return 'active', 'public video metadata and formats are available'
    request = urllib.request.Request(url, headers={'User-Agent':USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(1024 * 1024).decode('utf-8', 'replace')
            if response.status == 200 and re.search(r'<title\b|property=["\']og:title', body, re.I) and not re.search(r'<title[^>]*>\s*(?:404|Page not found)', body, re.I):
                return 'active', 'provider page is available; existing access and region terms apply'
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
    def probe(row):
        try: return check(row)
        except (OSError, ValueError, subprocess.SubprocessError): return 'source_unavailable', 'resource metadata request failed'
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
