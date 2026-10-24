"""Publish daily event source changes without merging generated JSON as text."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ["data/events/official_programs.json", "data/events_data.json", "data/events/localizations.json"]
GENERATED = ["data/" + name for name in (
    "events_catalog.json", "song_catalog.json", "creator_catalog.json",
    "appearance_index.json", "catalog_manifest.json", "voice_actor_profiles.json",
)]


def git(*args: str, capture: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, text=True, capture_output=capture, check=True)
    return result.stdout.strip() if capture else ""


def revision_json(revision: str, name: str) -> dict:
    try:
        return json.loads(git("show", f"{revision}:{name}"))
    except subprocess.CalledProcessError:
        return {}


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
    collected = {name: json.loads((ROOT / name).read_text(encoding="utf-8")) for name in SOURCES}
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
        (ROOT / name).write_text(json.dumps(collected[name], ensure_ascii=False, indent=1 if name.endswith('events_data.json') else 2) + "\n", encoding="utf-8")
    for attempt in range(3):
        if attempt:
            git("fetch", "origin", "main")
            git("switch", "-c", f"event-sync-retry-{attempt}", "origin/main")
            for name in SOURCES:
                merged = preserve_collaborator_changes(before[name], collected[name], revision_json("HEAD", name))
                (ROOT / name).write_text(json.dumps(merged, ensure_ascii=False, indent=1 if name.endswith('events_data.json') else 2) + "\n", encoding="utf-8")
        subprocess.run([sys.executable, str(ROOT / "uma_tools/update_events.py")], cwd=ROOT, check=True)
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
