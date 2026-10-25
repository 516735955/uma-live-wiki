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
STEP_TIMEOUTS = {'events': 300, 'programs': 1200, 'catalogs': 120,
                 'event-localization': 300, 'event-images': 300, 'entity-localization': 300}
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
    ('event-localization', ['localize_events.js']),
    ('event-images', ['sync_event_images.py']),
    ('music-metadata', ['sync_music_metadata.py', '--workers', '3', '--limit', '40', '--utaten']),
    ('voice-profiles', ['update_events.py', '--refresh-profiles']),
    ('music-build', ['update_events.py', '--music-only']),
    ('anime', ['sync_anime_sources.py']),
    ('anime-watch', ['sync_anime_watch.py']),
    ('anime-credits', ['sync_anime_credits.py']),
    ('anime-build', ['build_anime_catalog.py']),
    ('entity-localization', ['localize_entities.js']),
    ('search-pronunciations', ['build_search_pronunciations.js']),
]

STEP_OUTPUTS = {
    'characters': ['character_index_data.js', 'character_detail_data.js'],
    'pedigree-source': ['pedigree_source.json'],
    'horse-profiles': ['horses_details.js', 'horses_list.js'],
    'pedigree-build': ['pedigree_data.js', 'character_pedigree_meta.js'],
    'events': ['events_data.json'], 'programs': ['events/official_programs.json'],
    'albums': ['albums.json'], 'setlists': ['live_cat_data.json', 'events/赛马娘LIVE歌单导出.csv'],
    'catalogs': ['events_catalog.json', 'song_catalog.json', 'voice_actor_profiles.json',
                 'creator_catalog.json', 'appearance_index.json', 'catalog_manifest.json'],
    'event-localization': ['auto_update/event_localizations.json'],
    'event-images': ['auto_update/event_images.json'],
    'entity-localization': ['auto_update/entity_localizations.json', 'character_detail_data.js',
                            'horses_details.js', 'anime/works.json', 'anime/units.json',
                            'anime_catalog.json', 'anime_relation_index.json'],
    'music-metadata': ['music/credits.json', 'music/creators.json', 'music/lyrics.json', 'music/lyric_timings.json'],
    'voice-profiles': ['events/voice_actor_details.json'],
    'music-build': ['song_catalog.json', 'creator_catalog.json', 'appearance_index.json'],
    'anime': ['anime/*.json'], 'anime-build': ['anime_catalog.json'],
    'anime-watch': ['anime/watch_resources.json'],
    'anime-credits': ['anime/ending_credits.json', 'anime/staff.json', 'anime/people.json', 'anime/relations.json'],
}


def output_contents(name):
    """Compare published inputs, excluding refresh bookkeeping, within one run."""
    import json
    contents = {}
    for pattern in STEP_OUTPUTS.get(name, []):
        for path in (ROOT / 'data').glob(pattern):
            raw = path.read_bytes()
            if path.suffix == '.json':
                try:
                    value = json.loads(raw)
                    if isinstance(value, dict):
                        value = {key: item for key, item in value.items() if key not in ('generated_at', 'refreshed_at', 'observed_at', 'build_id')}
                    raw = value
                except ValueError:
                    pass
            contents[str(path)] = raw
    return contents


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
    pending_dependencies = set(state.get('pending_dependencies', []))
    results = []
    executed = set()
    for name, arguments in STEPS:
        if only and name not in only:
            continue
        previous = state['steps'].get(name, {})
        dependencies = {
            'pedigree-source': {'characters'}, 'horse-profiles': {'pedigree-source'},
            'pedigree-build': {'characters', 'pedigree-source'}, 'voice-profiles': {'characters'},
            'catalogs': {'characters', 'events', 'programs', 'albums', 'setlists'},
            'event-localization': {'catalogs'},
            'event-images': {'catalogs'},
            'entity-localization': {'characters', 'horse-profiles', 'anime', 'anime-build'},
            'music-build': {'catalogs', 'music-metadata', 'voice-profiles'},
            'anime-build': {'anime', 'anime-watch', 'anime-credits', 'music-build'},
            'search-pronunciations': {'catalogs', 'event-localization', 'entity-localization', 'music-build', 'anime-build'},
        }
        dependency_changed = name in pending_dependencies or bool(dependencies.get(name, set()) & executed)
        if not force and not dependency_changed and float(previous.get('next_at', 0)) > clock():
            continue
        started = clock()
        before = output_contents(name)
        try:
            github_owner = os.environ.get('GITHUB_ACTIONS') == 'true'
            # Activity translation belongs to Actions. News and entity
            # descriptions share the production archive/cache owner.
            read_archive_only = (name == 'event-localization' and not github_owner) or (name == 'entity-localization' and github_owner)
            step_arguments = [*arguments, *(['--no-api'] if read_archive_only else [])]
            executable = 'node' if arguments[0].endswith('.js') else sys.executable
            completed = run([executable, str(ROOT / 'uma_tools' / step_arguments[0]), *step_arguments[1:]],
                            cwd=ROOT, capture_output=True, text=True, encoding='utf-8',
                            errors='replace', timeout=STEP_TIMEOUTS.get(name, 20 * 60),
                            env={**os.environ, 'PYTHON_BIN': sys.executable})
            ok = completed.returncode == 0
            lines = (completed.stdout if ok else completed.stderr or completed.stdout).strip().splitlines()
            message = lines[-1][:500] if lines else ('complete' if ok else 'source update failed')
        except (OSError, subprocess.TimeoutExpired) as error:
            ok, message = False, type(error).__name__
        finished = clock()
        changed = output_contents(name) != before
        entry = {'status': 'ok' if ok else 'failed', 'started_at': started,
                 'finished_at': finished, 'next_at': finished + (DAY if ok else RETRY),
                 'last_success_at': finished if ok else previous.get('last_success_at'), 'message': message,
                 'changed': changed}
        state['steps'][name] = entry
        if ok:
            pending_dependencies.discard(name)
            if changed:
                pending_dependencies.update(
                    dependent for dependent, required in dependencies.items() if name in required
                )
        elif changed:
            pending_dependencies.add(name)
        state['pending_dependencies'] = sorted(pending_dependencies)
        state['updated_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        write_json(STATE, state)
        results.append(entry)
        # A source may publish a usable subset before reporting another failed
        # page. Its dependent builders must still publish that usable subset.
        if changed:
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
