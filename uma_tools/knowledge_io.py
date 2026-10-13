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
            capture_output=True, text=True, check=True, timeout=10)
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


def fetch(url, *, binary=False, timeout=25):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Language': 'ja,en;q=0.8'})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                data = response.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                raise ValueError('source exceeds 20 MiB: ' + url)
            return data if binary else data.decode('utf-8', 'replace')
        except (OSError, urllib.error.URLError):
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


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
