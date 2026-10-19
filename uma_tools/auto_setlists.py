# -*- coding: utf-8 -*-
"""Publish sourced sessions and fill uniquely matched empty setlists.

Existing nonempty cast, dates and song tables retain their curated values.
New sessions require one exact public event, date and explicit performer list.
"""

import argparse
import datetime as dt
import html
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata
import urllib.request
import urllib.error
import zipfile
from xml.etree.ElementTree import ParseError


ROOT = Path(__file__).resolve().parent.parent
LIVE_CAT = ROOT / "data" / "live_cat_data.json"
REPORT = ROOT / "data" / "events" / "sheet_apply_report.json"
SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1HU5lkpjmz3_tXtJnHLvBcbeUXe_2LliD9AagFdwhDvk/export?format=xlsx"
)
PUBLISHED_URLS = (
    'https://raw.githubusercontent.com/516735955/uma-live-wiki/main/data/live_cat_data.json',
    'https://cdn.jsdelivr.net/gh/516735955/uma-live-wiki@main/data/live_cat_data.json',
)
SONG_RE = re.compile(r"^M\s*(\d+)[.\s]\s*(.*)$", re.I)
TITLE_SPLIT_RE = re.compile(r"[＠@]", re.I)
REGION_RE = re.compile(r"\s*[（(][^()（）]*[）)]\s*$")
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
PERFORMER_SPLIT_RE = re.compile(r"[、，,､/・\r\n]+")
ALL_CAST_RE = re.compile(r'^(?:(?:他)?(?:出演)?(?:キャスト|出演者)?全[員员](?:\s*[（(]\d+人[）)])?|ALL|全体出演者|全出演者)$', re.I)


def normalized_title(value):
    title = TITLE_SPLIT_RE.split(str(value or "").strip(), 1)[0]
    title = REGION_RE.sub(lambda match: '' if re.search(r'東京|大阪|京都|北海道|[都府県区]|ホール|会館|会場|メッセ|アリーナ|ドーム|Hall|Stadium', match.group(0), re.I)
                          and not re.search(r'昼|夜|公演|DAY|部|限定', match.group(0), re.I) else match.group(0), title).strip()
    return re.sub(r"\s+", "", unicodedata.normalize('NFKC', title)).casefold()


def event_date(value):
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()[:10]
    match = DATE_RE.search(str(value or ""))
    if match:
        return match.group(0)
    match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', str(value or ''))
    return dt.date(*map(int, match.groups())).isoformat() if match else ''


def numbered_key(title):
    match = re.search(r'(?<!\d)(\d+)(?:st|nd|rd|th)\s*EVENT\b', unicodedata.normalize('NFKC', title or ''), re.I)
    return int(match.group(1)) if match else None


def numbered_match(block, events):
    number = numbered_key(block['title'])
    if number is None:
        return None
    matches = [event for event in events
               if (event.get('series_id') == 'numbered-live' or event.get('id', '').startswith('live-numbered-'))
               and numbered_key(event.get('title')) == number
               and block['date'] in {event.get('date'), *(session.get('date') for session in event.get('sessions', []))}]
    primary = [event for event in matches if event.get('series_id') == 'numbered-live']
    matches = primary or matches
    return matches[0] if len(matches) == 1 else None


def canonical_match(block, events):
    event = numbered_match(block, events)
    if event:
        return event
    volume = re.search(r'ぱかライブTV\s*Vol\.?\s*(\d+)', block['title'], re.I)
    if not volume or re.search(r'そこそこ|Prime|プライム', block['title'], re.I):
        return None
    identifier = f'paka-live-tv-{int(volume.group(1)):03d}'
    matches = [event for event in events if event['id'] == identifier and event.get('kind') == 'official_program'
               and block['date'] in {event.get('date'), *(session.get('date') for session in event.get('sessions', []))}]
    return matches[0] if len(matches) == 1 else None


def session_label(title):
    match = re.search(r"(?:DAY\s*\d+|[1-3]部|第[一二三四]部|アフターパート|昼公演|夜公演|昼の部|夜の部)", title or "", re.I)
    return match.group(0) if match else "本公演"


def split_performers(value):
    return [item.strip() for item in PERFORMER_SPLIT_RE.split(str(value)) if item.strip()]


def parse_sheet(data):
    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        blocks = []
        for sheet in workbook.worksheets:
            blocks.extend(parse_worksheet(sheet))
        return [block for block in blocks if block["songs"]]
    finally:
        workbook.close()


def parse_worksheet(sheet):
    return parse_rows(sheet.iter_rows(values_only=True))


def parse_rows(rows):
    blocks, current, current_date = [], None, ''
    for row in rows:
        date, title, song, performers = (list(row[:4]) + [None] * 4)[:4]
        incoming_date = event_date(date) if date else ''
        changed_date = bool(incoming_date and incoming_date != current_date)
        if incoming_date:
            current_date = incoming_date
        if title is not None and str(title).strip():
            current = {'date': current_date, 'title': str(title).strip(), 'songs': []}
            blocks.append(current)
        elif changed_date and current is not None:
            current = {'date': current_date, 'title': current['title'], 'songs': []}
            blocks.append(current)
        if song is not None and str(song).strip() and current is not None:
            text = str(song).strip()
            match = SONG_RE.match(text)
            current['songs'].append({'no': (match.group(1).lstrip('0') or '0') if match else '',
                                    'name': match.group(2).strip() if match else text,
                                    'performers': split_performers(performers) if performers else []})
        elif performers is not None and str(performers).strip() and current and current['songs']:
            if not current['songs'][-1]['performers']:
                current['songs'][-1]['performers'] = split_performers(performers)
    return blocks


def curated_slots(catalog):
    slots = []
    for category in ("cd", "other", "twinkle"):
        root = catalog.get(category) or {}
        for section in root.get("sections") or [root]:
            for group in section.get("groups") or []:
                for sub in group.get("subs") or []:
                    for day_index, day in enumerate(sub.get("days") or []):
                        from events_pipeline.text import event_date_for_day
                        slots.append({
                            "group": group.get("group") or "",
                            "title": sub.get("title") or "",
                            "date": event_date(day.get('date')) or event_date_for_day(sub.get('date'), day_index) or event_date(sub.get('date')),
                            "label": day.get("label") or "本公演",
                            "cast": sub.get("cast") or "",
                            "day": day,
                        })
    return slots


def confirmed_cast(cast):
    """Only explicitly credited Uma performers may receive character avatars."""
    out = {}
    for actor, character in re.findall(r"([^、（）<>]+)（([^（）<>]+)）", cast or ""):
        out[actor.strip()] = character.strip()
    return out


def song_table(block, cast):
    from_map = confirmed_cast(cast)
    rows = []
    for index, song in enumerate(block["songs"], 1):
        performers = []
        for name in song["performers"]:
            safe = html.escape(name, quote=True)
            if name in from_map:
                # The canonical character identity is derived from the verified
                # event cast, never from a global actor-to-character lookup.
                character = html.escape(from_map[name], quote=True)
                performers.append('<span class="perf-item"><span class="perf-name">%s</span></span>' % character)
            else:
                performers.append('<span class="guest-performer">%s</span>' % safe)
        rows.append(
            '<tr><td class="setlist-no">%s</td><td class="setlist-song">%s</td><td class="setlist-perf">%s</td></tr>'
            % (html.escape(song["no"] or str(index)), html.escape(song["name"]), "".join(performers))
        )
    return (
        '<table class="setlist-table">\n'
        '<thead><tr><th>#</th><th>曲名</th><th>出演者</th></tr></thead>\n'
        '<tbody>\n%s\n</tbody>\n</table>' % "\n".join(rows)
    )


def table_summary(value):
    return [html.unescape(re.sub(r"<[^>]+>", "", item)).strip()
            for item in re.findall(r'<td class="setlist-song">([\s\S]*?)</td>', value or "")]


def table_credits(value, cast):
    by_character = {character: actor for actor, character in confirmed_cast(cast).items()}
    credits = []
    for row in re.findall(r"<tr\b[^>]*>([\s\S]*?)</tr>", value or "", re.I):
        if 'class="setlist-song"' not in row:
            continue
        names = [html.unescape(name).strip() for name in
                 re.findall(r'<span class="(?:perf-name|guest-performer)">([\s\S]*?)</span>', row)]
        credits.append([by_character.get(name, name) for name in names])
    return credits


def compare(blocks, catalog):
    slots = curated_slots(catalog)
    report = {"sheet_blocks": len(blocks), "filled": [], "review": [], "unchanged": 0}
    for block in blocks:
        title = normalized_title(block["title"])
        date = block["date"]
        label = session_label(block["title"])
        # No fuzzy guesses: a single title/date/session match is required.
        matches = [slot for slot in slots if normalized_title(slot["title"]) == title
                   and slot["date"] == date and slot["label"] == label]
        descriptor = {"sheet_title": block["title"], "date": date, "session": label}
        if len(matches) != 1:
            report["review"].append({**descriptor, "reason": "unmatched_or_ambiguous", "matches": len(matches)})
            continue
        slot = matches[0]
        existing = slot["day"].get("table") or ""
        sheet_songs = [song["name"] for song in block["songs"]]
        if existing.strip():
            published_credits = table_credits(existing, slot["cast"])
            sheet_credits = [song["performers"] for song in block["songs"]]
            same_credits = len(published_credits) == len(sheet_credits) and all(
                sorted(published) == sorted(source)
                for published, source in zip(published_credits, sheet_credits)
            )
            if table_summary(existing) == sheet_songs and same_credits:
                report["unchanged"] += 1
            else:
                report["review"].append({**descriptor, "reason": "nonempty_setlist_differs",
                                         "published_songs": table_summary(existing), "sheet_songs": sheet_songs,
                                         "published_performers": published_credits,
                                         "sheet_performers": sheet_credits})
            continue
        if not slot["cast"].strip() or not confirmed_cast(slot["cast"]):
            report["review"].append({**descriptor, "reason": "cast_not_confirmed"})
            continue
        if any(not song["performers"] for song in block["songs"]):
            report["review"].append({**descriptor, "reason": "missing_song_performers"})
            continue
        slot["day"]["table"] = song_table(block, slot["cast"])
        report["filled"].append({**descriptor, "published_title": slot["title"], "songs": len(sheet_songs)})
    return report


def attach_discovered_sessions(blocks, catalog, events, existing_events=()):
    """Create a session only when event and performer evidence identifies it uniquely."""
    slots = curated_slots(catalog)
    groups = catalog.setdefault('other', {}).setdefault('groups', [])
    added = []
    # A single-session event can put DAY/part in its title and use the generic
    # session label. Explicit multi-session labels still distinguish sessions.
    published = {(normalized_title(event.get('title')), row.get('date') or event.get('date'),
                  row['label'] if row.get('label') not in (None, '', '本公演') else session_label(event.get('title')))
                 for event in existing_events for row in event.get('sessions') or [{'date': event.get('date'), 'label': session_label(event.get('title'))}]}
    for block in blocks:
        key = (normalized_title(block['title']), block['date'], session_label(block['title']))
        if not block['date'] or any((normalized_title(slot['title']), slot['date'], slot['label']) == key for slot in slots):
            continue
        if canonical_match(block, existing_events):
            continue
        if key in published:
            continue
        matches = [event for event in events if (normalized_title(event.get('title')), event.get('date'), session_label(event.get('title'))) == key
                   and event.get('link', '').startswith('https://www.eventernote.com/events/')]
        if len(matches) != 1:
            continue
        event = matches[0]
        actors = list(dict.fromkeys(actor['name'] for actor in event.get('actors', [])
                                   if actor.get('name') and not re.search(r'gal.?up|ウマ娘\s*プリティーダービー', actor['name'], re.I)))
        singers = {name for song in block['songs'] for name in song['performers'] if not ALL_CAST_RE.fullmatch(name)}
        if not actors or not singers or not singers <= set(actors) or any(not song['performers'] for song in block['songs']):
            continue
        cast = '、'.join(html.escape(name) for name in actors)
        sub = {'title': event['title'], 'date': event['date'], 'cast': cast, 'source_url': event['link'],
               'vids': [], 'tips': '出处：' + event['link'],
               'days': [{'label': key[2], 'table': song_table(block, cast)}]}
        groups.append({'group': event['title'], 'subs': [sub], 'source_url': event['link']})
        slots = curated_slots(catalog)
        added.append({'sheet_title': block['title'], 'date': block['date'], 'session': key[2], 'songs': len(block['songs'])})
    return added


def fill_from_published_catalog(published, catalog):
    """Reuse the existing GitHub sheet job without replacing live curated tables."""
    slots = curated_slots(catalog)
    report = {'source': 'github-main', 'sheet_blocks': 0, 'filled': [], 'review': [], 'unchanged': 0}
    incoming = curated_slots(published)
    for slot in slots:
        if (slot['day'].get('table') or '').strip():
            report['unchanged'] += 1
            continue
        key = (normalized_title(slot['title']), slot['date'], slot['label'])
        matches = [row for row in incoming if (normalized_title(row['title']), row['date'], row['label']) == key]
        local_matches = [row for row in slots if (normalized_title(row['title']), row['date'], row['label']) == key]
        if len(matches) != 1 or len(local_matches) != 1:
            continue
        row = matches[0]
        table = row['day'].get('table') or ''
        # Character-marked song rows have meaning only under the same confirmed
        # performer-to-role mapping. A differing cast is not silently rewritten.
        cast = confirmed_cast(slot['cast'])
        if not cast or cast != confirmed_cast(row['cast']) or not table_summary(table):
            continue
        slot['day']['table'] = table
        report['filled'].append({'published_title': slot['title'], 'date': slot['date'], 'session': slot['label'], 'songs': len(table_summary(table))})
    report['sheet_blocks'] = len(incoming)
    return report


def published_catalog():
    failure = None
    for url in PUBLISHED_URLS:
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'uma-live-wiki sheet-sync'})
            with urllib.request.urlopen(request, timeout=30) as response:
                value = json.loads(response.read(20 * 1024 * 1024).decode('utf-8'))
            if not curated_slots(value):
                raise ValueError('published setlist catalog has no recognizable slots')
            return value
        except (OSError, ValueError) as error:
            failure = error
            # curl's IPv4 transport handles hosts where urllib's TLS or IPv6
            # route fails. The same public repository URL remains the source.
            try:
                response = subprocess.run(['curl', '--ipv4', '--fail', '--location', '--silent', '--show-error',
                    '--connect-timeout', '10', '--max-time', '35', url], capture_output=True, check=True, timeout=40)
                value = json.loads(response.stdout.decode('utf-8'))
                if curated_slots(value):
                    return value
            except (OSError, ValueError, subprocess.SubprocessError) as current:
                failure = current
    raise RuntimeError('Google sheet and GitHub setlist fallback are unavailable') from failure


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sheet-xlsx", type=Path, help="Use a local workbook instead of downloading")
    parser.add_argument("--live-cat", type=Path, default=LIVE_CAT)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    catalog = json.loads(args.live_cat.read_text(encoding="utf-8"))
    primary_available = True
    try:
        if args.sheet_xlsx:
            data = args.sheet_xlsx.read_bytes()
        else:
            request = urllib.request.Request(SHEET_URL, headers={"User-Agent": "uma-live-wiki sheet-sync"})
            with urllib.request.urlopen(request, timeout=45) as response:
                data = response.read()
        if not data.startswith(b"PK"):
            raise ValueError("Google sheet response is not an xlsx workbook")
        blocks = parse_sheet(data)
        if not blocks:
            raise ValueError("Google sheet has no setlists; refusing to update curated data")
        if not args.dry_run:
            import csv
            # The checked-in Google export is the primary, portable setlist source.
            output = io.StringIO(newline='')
            writer = csv.writer(output, lineterminator='\n')
            for block in blocks:
                writer.writerow([block['date'], block['title'], '', ''])
                for song in block['songs']:
                    writer.writerow(['', '', 'M' + (song['no'] or '') + '. ' + song['name'], '、'.join(song['performers'])])
            from knowledge_io import write_text
            write_text(ROOT / 'data/events/赛马娘LIVE歌单导出.csv', output.getvalue())
        events_file = ROOT / 'data/events_data.json'
        events = json.loads(events_file.read_text(encoding='utf-8')).get('events', []) if events_file.exists() else []
        published_file = ROOT / 'data/events_catalog.json'
        published = json.loads(published_file.read_text(encoding='utf-8')).get('events', []) if published_file.exists() else []
        added = attach_discovered_sessions(blocks, catalog, events, published)
        report = compare(blocks, catalog)
        report['filled'].extend(added)
    except (OSError, ValueError, zipfile.BadZipFile, ParseError, EOFError):
        if args.sheet_xlsx:
            raise
        report = fill_from_published_catalog(published_catalog(), catalog)
        primary_available = False
        print('sheet-sync: using the existing GitHub published setlists', flush=True)
    if report["filled"] and not args.dry_run:
        write_json(args.live_cat, catalog)
    report['primary_source_available'] = primary_available
    write_json(args.report, report)
    print("sheet-sync: %d blocks, %d filled, %d unchanged, %d preserved without a unique empty match" %
          (report["sheet_blocks"], len(report["filled"]), report["unchanged"], len(report["review"])))
    return 0 if primary_available else 1


if __name__ == "__main__":
    raise SystemExit(main())
