"""Publish daily event source changes without merging generated JSON as text."""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ["data/events/official_programs.json", "data/events_data.json", "data/events/localizations.json",
           "data/character_detail_data.js", "data/horses_details.js", "data/anime/works.json", "data/anime/units.json"]
JS_GLOBALS = {'data/character_detail_data.js': 'CHAR_DETAIL', 'data/horses_details.js': 'HORSES_DETAIL'}
GENERATED = ["data/" + name for name in (
    "events_catalog.json", "song_catalog.json", "creator_catalog.json",
    "appearance_index.json", "catalog_manifest.json", "voice_actor_profiles.json",
    "anime_catalog.json", "anime_relation_index.json",
)]


def git(*args: str, capture: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=capture, check=True)
    return result.stdout.strip() if capture else ""


def revision_json(revision: str, name: str) -> dict:
    try:
        return parse_source(name, git("show", f"{revision}:{name}"))
    except subprocess.CalledProcessError:
        return {}


def parse_source(name: str, text: str) -> dict:
    original = text
    if name in JS_GLOBALS:
        match = re.fullmatch(r'\s*window\.' + JS_GLOBALS[name] + r'\s*=\s*([\s\S]*?)\s*;?\s*', text)
        if not match:
            raise ValueError('Unrecognized source assignment: ' + name)
        text = match.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        if name not in JS_GLOBALS:
            raise
        command = "const vm=require('vm'),fs=require('fs');const c={window:{}};vm.runInNewContext(fs.readFileSync(0,'utf8'),c,{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});process.stdout.write(JSON.stringify(c.window[process.argv[1]]));"
        result = subprocess.run(['node', '-e', command, JS_GLOBALS[name]], input=original,
                                text=True, capture_output=True, check=True, timeout=10)
        return json.loads(result.stdout)


def write_source(name: str, value: dict) -> None:
    file = ROOT / name
    if file.exists() and parse_source(name, file.read_text(encoding='utf-8')) == value:
        return
    body = json.dumps(value, ensure_ascii=False, indent=1 if name.endswith('events_data.json') else 2)
    if name in JS_GLOBALS:
        body = 'window.' + JS_GLOBALS[name] + ' = ' + body + ';'
    file.write_text(body + '\n', encoding='utf-8')


def preserve_collaborator_changes(before: dict, collected: dict, latest: dict) -> dict:
    # The existing structured three-way merger keeps disjoint source changes.
    # Latest main is the incoming side so a collaborator's explicit correction
    # wins when both it and the automated collector changed the same field.
    command = "const fs=require('fs');const {merge}=require('./deploy/data-sync');const [b,c,l]=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(merge(b,l,c)))"
    result = subprocess.run(["node", "-e", command], cwd=ROOT,
                            input=json.dumps([before, collected, latest], ensure_ascii=False),
                            text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def main() -> int:
    baseline = git("rev-parse", "HEAD")
    before = {name: revision_json(baseline, name) for name in SOURCES}
    collected = {name: parse_source(name, (ROOT / name).read_text(encoding="utf-8")) for name in SOURCES}
    runtime = ROOT / "data/auto_update/event_localizations.json"
    if runtime.exists():
        for event_id, record in json.loads(runtime.read_text(encoding="utf-8")).get("records", {}).items():
            target = collected[SOURCES[2]].setdefault("records", {}).setdefault(event_id, {})
            for field in ("title", "summary"):
                if not record.get(field + "_zh"):
                    continue
                if target.get(field + "_zh") and target.get(field + "_ja") == record.get(field + "_ja"):
                    continue
                target[field + "_ja"] = record.get(field + "_ja", "")
                target[field + "_zh"] = record[field + "_zh"]
                target[field + "_translator"] = "baidu"
    # Preserve the collected result in a normal commit before following a
    # collaborator's newer main. This runs only in the clean CI checkout.
    for name in SOURCES:
        write_source(name, collected[name])
    for attempt in range(3):
        if attempt:
            git("fetch", "origin", "main")
            git("switch", "-c", f"event-sync-retry-{attempt}", "origin/main")
            for name in SOURCES:
                merged = preserve_collaborator_changes(before[name], collected[name], revision_json("HEAD", name))
                write_source(name, merged)
        subprocess.run([sys.executable, str(ROOT / "uma_tools/update_events.py")], cwd=ROOT, check=True)
        subprocess.run([sys.executable, str(ROOT / "uma_tools/build_anime_catalog.py")], cwd=ROOT, check=True)
        subprocess.run(["node", str(ROOT / "uma_tools/test_catalog_store.js")], cwd=ROOT, check=True)
        git("add", "--", *SOURCES, *GENERATED)
        if not git("diff", "--cached", "--name-only"):
            print("No event data changes to publish.")
            return 0
        date = dt.datetime.now(dt.timezone.utc).date().isoformat()
        git("commit", "-m", f"chore(events): sync official programs and appearances {date}", capture=False)
        pushed = subprocess.run(["git", "push", "origin", "HEAD:main"], cwd=ROOT)
        if pushed.returncode == 0:
            return 0
    print("main changed repeatedly; collected data remains in the CI commits.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
