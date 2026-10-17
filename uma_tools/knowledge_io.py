"""Small atomic I/O helpers for incremental public-source updates."""

import json
import os
import re
import subprocess
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.request
import threading
import socket

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = 'Mozilla/5.0 (compatible; UmaLiveWiki/1.0; public source updater)'


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def read_window(path):
    text = Path(path).read_text(encoding='utf-8')
    try:
        return json.loads(text.split('=', 1)[1].strip().rstrip(';'))
    except json.JSONDecodeError:
        # Historical repository data uses single-quoted JavaScript object keys.
        name = re.search(r'window\.([A-Z_]+)\s*=', text).group(1)
        result = subprocess.run(['node', '-e',
            'const vm=require("vm"),fs=require("fs");const window={};'
            'vm.runInNewContext(fs.readFileSync(process.argv[1],"utf8"),{window},{timeout:1000});'
            'process.stdout.write(JSON.stringify(window[process.argv[2]]));', str(path), name],
            capture_output=True, text=True, encoding='utf-8', check=True, timeout=10)
        return json.loads(result.stdout)


def write_text(path, text):
    path = Path(path)
    if path.exists() and path.read_text(encoding='utf-8') == text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(text)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_json(path, value):
    write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def write_window(path, name, value):
    if Path(path).exists() and read_window(path) == value:
        return
    write_text(path, 'window.' + name + ' = ' + json.dumps(value, ensure_ascii=False, separators=(',', ':')) + ';\n')


def bounded_read(response, *, limit=20 * 1024 * 1024, deadline=None):
    """Read a bounded response within an absolute wall-clock deadline."""
    deadline = deadline if deadline is not None else time.monotonic() + 30
    def interrupt():
        try:
            connection = response.fp.raw._sock
            connection.shutdown(socket.SHUT_RDWR)
        except (AttributeError, OSError):
            response.close()
    timer = threading.Timer(max(0, deadline - time.monotonic()), interrupt)
    timer.daemon = True
    timer.start()
    data, size = [], 0
    try:
        read = getattr(response, 'read1', response.read)
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError('source response deadline exceeded')
            chunk = read(min(65536, limit + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise ValueError('source response exceeds byte limit')
            data.append(chunk)
        if time.monotonic() >= deadline:
            raise TimeoutError('source response deadline exceeded')
        return b''.join(data)
    finally:
        timer.cancel()


def fetch(url, *, binary=False, timeout=25):
    deadline = time.monotonic() + timeout * 3
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'ja,en;q=0.8'})
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('source fetch deadline exceeded')
            with urllib.request.urlopen(request, timeout=min(timeout, remaining)) as response:
                data = bounded_read(response, deadline=min(deadline, time.monotonic() + timeout))
            return data if binary else data.decode('utf-8', 'replace')
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(min(2 * (attempt + 1), max(0, deadline - time.monotonic())))
        except (OSError, urllib.error.URLError):
            if attempt == 2:
                raise
            time.sleep(min(2 * (attempt + 1), max(0, deadline - time.monotonic())))


def fill_empty(target, incoming):
    """A later observation fills missing facts and never replaces accepted values."""
    for key, value in incoming.items():
        if target.get(key) in (None, '', [], {}) and value not in (None, '', [], {}):
            target[key] = value


def unique_names(rows, names):
    index = {}
    for row in rows:
        for name in names(row):
            if name:
                index.setdefault(name, []).append(row)
    return {name: values[0] for name, values in index.items() if len({row['id'] for row in values}) == 1}
