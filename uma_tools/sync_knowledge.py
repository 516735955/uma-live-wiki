"""Run daily incremental knowledge updates using the existing source builders."""

import argparse
from contextlib import contextmanager
import datetime as dt
import os
import subprocess
import sys
import time

from knowledge_io import ROOT, read_json, write_json

STATE = ROOT / 'data/auto_update/runner.json'
DAY = 24 * 60 * 60
RETRY = 60 * 60
# Source order makes new identities available before resolving their relations.
STEPS = [
    ('characters', ['sync_character_sources.py']),
    ('pedigree-source', ['sync_pedigree_sources.py']),
    ('horse-profiles', ['crawl_horses.py', '--missing', '--localize-photos']),
    ('pedigree-build', ['build_pedigree.py']),
    ('events', ['crawl_events.py']),
    ('programs', ['crawl_official_programs.py']),
    ('albums', ['auto_albums.py']),
    ('setlists', ['auto_setlists.py']),
    ('catalogs', ['update_events.py']),
    ('music-metadata', ['sync_music_metadata.py', '--workers', '3', '--limit', '40', '--utaten', '--lrclib']),
    ('voice-profiles', ['update_events.py', '--refresh-profiles']),
    ('music-build', ['update_events.py', '--music-only']),
    ('anime', ['sync_anime_sources.py']),
    ('anime-build', ['build_anime_catalog.py']),
]


@contextmanager
def update_lock():
    """One process owns source updates, including manually started runs."""
    STATE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE.parent / '.lock', 'a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            handle.seek(0)
            handle.write(b'0')
            handle.flush()
            handle.seek(0)
            acquire = lambda: msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            release = lambda: msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            acquire = lambda: fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            release = lambda: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        try:
            acquire()
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            release()


def run_updates(*, force=False, only=None, run=subprocess.run, clock=time.time):
    state = read_json(STATE, {'schema_version': 1, 'steps': {}})
    results = []
    executed = set()
    for name, arguments in STEPS:
        if only and name not in only:
            continue
        previous = state['steps'].get(name, {})
        dependencies = {
            'pedigree-source': {'characters'}, 'horse-profiles': {'pedigree-source'},
            'pedigree-build': {'pedigree-source'}, 'voice-profiles': {'characters'},
            'catalogs': {'characters', 'events', 'programs', 'albums', 'setlists'},
            'music-build': {'catalogs', 'music-metadata', 'voice-profiles'},
            'anime-build': {'anime', 'music-build'},
        }
        dependency_changed = bool(dependencies.get(name, set()) & executed)
        if not force and not dependency_changed and float(previous.get('next_at', 0)) > clock():
            continue
        started = clock()
        try:
            completed = run([sys.executable, str(ROOT / 'uma_tools' / arguments[0]), *arguments[1:]],
                            cwd=ROOT, capture_output=True, text=True, encoding='utf-8',
                            errors='replace', timeout=20 * 60)
            ok = completed.returncode == 0
            lines = (completed.stdout if ok else completed.stderr or completed.stdout).strip().splitlines()
            message = lines[-1][:500] if lines else ('complete' if ok else 'source update failed')
        except (OSError, subprocess.TimeoutExpired) as error:
            ok, message = False, type(error).__name__
        finished = clock()
        entry = {'status': 'ok' if ok else 'failed', 'started_at': started,
                 'finished_at': finished, 'next_at': finished + (DAY if ok else RETRY),
                 'last_success_at': finished if ok else previous.get('last_success_at'), 'message': message}
        state['steps'][name] = entry
        state['updated_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        write_json(STATE, state)
        results.append(entry)
        # A source may publish a usable subset before reporting another failed
        # page. Its dependent builders must still publish that usable subset.
        executed.add(name)
        print(f'[knowledge:{name}] {entry["status"]} {int(finished-started)}s | {message}', flush=True)
    return sum(row['status'] == 'failed' for row in results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true', help='run selected steps without waiting for their daily deadline')
    parser.add_argument('--only', nargs='+', choices=[name for name, _ in STEPS])
    parser.add_argument('--status', action='store_true', help='print the latest state without starting network requests')
    args = parser.parse_args()
    if args.status:
        import json
        print(json.dumps(read_json(STATE, {'schema_version': 1, 'steps': {}}), ensure_ascii=False, indent=2))
        return 0
    with update_lock() as acquired:
        if not acquired:
            print('knowledge update already running')
            return 0
        return bool(run_updates(force=args.force, only=args.only))


if __name__ == '__main__':
    raise SystemExit(main())
