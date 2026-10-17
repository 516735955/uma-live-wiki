"""Publish catalog files while keeping the previous complete set readable."""
from contextlib import contextmanager
import json
import os
from pathlib import Path


@contextmanager
def publication_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.catalog-publish.lock').open('a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            if handle.tell() == 0:
                handle.write(b'0'); handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            release = lambda: (handle.seek(0), msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1))
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            release = lambda: fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        try:
            yield
        finally:
            release()


def publish_catalog(outputs, built, atomic_json):
    directory = next(iter(outputs.values())).parent / 'auto_update'
    pending = directory / 'catalog_pending.json'
    with publication_lock(directory):
        if pending.exists():
            previous = json.loads(pending.read_text(encoding='utf-8'))
        else:
            previous = {path.name: json.loads(path.read_text(encoding='utf-8'))
                        for path in outputs.values() if path.exists()}
        ids = {value.get('build_id') for value in previous.values()}
        if len(previous) == len(outputs) and len(ids) == 1 and None not in ids:
            atomic_json(pending, previous)
        for key, path in outputs.items():
            atomic_json(path, built[key])
        pending.unlink(missing_ok=True)
