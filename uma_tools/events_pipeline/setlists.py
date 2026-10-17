"""Apply the Google song-sheet credits to uniquely identified live sessions."""
import csv
import html
import re

from auto_setlists import ALL_CAST_RE, normalized_title, canonical_match, parse_rows, session_label, song_table
from . import identities as identity_tools
from .song_identity import clean_song, fold_song_key, table_performances, split_song_version

SHEET_URL = 'https://docs.google.com/spreadsheets/d/1HU5lkpjmz3_tXtJnHLvBcbeUXe_2LliD9AagFdwhDvk/edit'
SOURCE_FILE = 'data/events/赛马娘LIVE歌单导出.csv'
ALL_CAST = ALL_CAST_RE


def song_key(value, identities):
    return fold_song_key(split_song_version(value, identities, set())[0])


def curated_performances(table, performances, identities, cast):
    """Retain curated rows and their labels while applying sheet credits."""
    if 'setlist-src' not in (table or ''):
        return performances
    original = table_performances(table, identities, [row.get('character_id') for row in cast])
    for row in original:
        matches = [item for item in performances if song_key(item['song'], identities) == song_key(row['song'], identities)]
        exact = [item for item in matches if item.get('setlist_no') == row.get('setlist_no')]
        # A curated finale can group several Google team rows into one entry.
        full = re.search(r'全[员員]', next((part for part in re.findall(r'<tr\b[^>]*>[\s\S]*?</tr>', table)
                                          if re.search(r'class=["\']setlist-no["\']>\s*' + re.escape(row.get('setlist_no', '')) + r'\s*</td>', part)), ''))
        selected = matches if full else (exact or matches[:1])
        if selected:
            for field in ('voice_actor_ids', 'character_ids', 'guest_performers'):
                row[field] = list(dict.fromkeys(value for item in selected for value in item.get(field, [])))
            row['full_cast'] = bool(full) or any(item.get('full_cast') for item in selected)
    return original


def display_table(original, block, known_cast, identities):
    """Keep curated roles and notes; expand full-cast credits in place."""
    from bs4 import BeautifulSoup

    roles = {}
    for item in known_cast:
        if item.get('voice_actor_id') and item.get('character_id'):
            roles.setdefault(item['voice_actor_id'], set()).add(item['character_id'])

    def character_chip(character_id):
        character = identities.character_by_id[character_id]
        label = html.escape(character.get('zh') or character.get('ja') or character_id, quote=True)
        image = character.get('av') or ''
        avatar = '<img class="char-avatar" src="%s" alt="%s">' % (html.escape(image, quote=True), label) if image else ''
        return '<span class="perf-item">%s<span class="perf-name">%s</span></span>' % (avatar, label)

    def person_chip(name):
        actor_roles = roles.get(identities.voice_id(name), set())
        if len(actor_roles) == 1:
            return character_chip(next(iter(actor_roles)))
        return '<span class="guest-performer">%s</span>' % html.escape(name, quote=True)

    def title_key(value):
        return song_key(value, identities)

    def update_row(match):
        row = match.group(0)
        soup = BeautifulSoup(row, 'html.parser')
        song, performers = soup.select_one('.setlist-song'), soup.select_one('.setlist-perf')
        if song is None or performers is None:
            return row
        body = re.search(r'(<td\b[^>]*class=["\']setlist-perf["\'][^>]*>)([\s\S]*?)(</td>)', row, re.I)
        if body is None:
            return row
        content = body.group(2)
        if re.search(r'全[员員]|全体出演者|全出演者', performers.get_text()):
            names = list(dict.fromkeys(name for entry in block['songs']
                                       if title_key(entry['name']) == title_key(song.get_text())
                                       for name in entry['performers']))
            if names:
                content += '<div class="performer-chip-list">%s</div>' % ''.join(person_chip(name) for name in names)
        else:
            content = re.sub(r'<span class=["\']guest-performer["\']>([^<]*)</span>',
                             lambda part: person_chip(html.unescape(part.group(1))), content)
            content = re.sub(r'<span class=["\']perf-item["\']><span class=["\']perf-name["\']>([^<]*)</span></span>',
                             lambda part: character_chip(identities.character_id(html.unescape(part.group(1))))
                             if identities.character_id(html.unescape(part.group(1))) else part.group(0), content)
        return row[:body.start(2)] + content + row[body.end(2):]

    return re.sub(r'<tr\b[^>]*>[\s\S]*?</tr>', update_row, original or song_table(block, ''), flags=re.I)


def read_blocks(root):
    with (root / SOURCE_FILE).open(encoding='utf-8-sig', newline='') as handle:
        return parse_rows(csv.reader(handle))


def merge_numbered_sources(events):
    """Keep numbered lives and numbered programs when also imported as categories."""
    for event in events:
        if event.get('series_id') == 'numbered-live' or not any(
                source.get('kind') == 'curated_live' for source in event.get('sources', [])):
            continue
        target = canonical_match({'title': event['title'], 'date': event.get('date')}, events)
        if target is None or target is event:
            continue
        target.setdefault('id_aliases', []).append(event['id'])
        event['id'] = target['id']
    return events


def apply_sheet(events, blocks, identities, eventernote=None):
    applied = []
    for block in blocks:
        event = canonical_match(block, events)
        if event is None:
            matches = [row for row in events if (any(normalized_title(title) == normalized_title(block['title'])
                                                     for title in [row['title'], *row.get('title_aliases', [])]))
                       and any(session.get('date') == block['date'] for session in row.get('sessions', []))]
            if len(matches) != 1:
                continue
            event = matches[0]
        sessions = [session for session in event.get('sessions', []) if session.get('date') == block['date']]
        if len(sessions) > 1:
            sessions = [session for session in sessions if session.get('label') == session_label(block['title'])]
        if len(sessions) != 1:
            continue
        session = sessions[0]
        names = list(dict.fromkeys(name for song in block['songs'] if clean_song(song['name']) for name in song['performers'] if not ALL_CAST.fullmatch(name)))
        known_cast = session.get('cast') or event.get('cast') or []
        full_names = list(names)
        source_urls = {source.get('url') for source in event.get('sources', [])}
        legacy_urls = {event.get('legacy_url'), *event.get('legacy_aliases', [])}
        for row in (eventernote or {}).get('events', []):
            if str(row.get('date', ''))[:10] != block['date'] or not (
                    row.get('link') in source_urls or row.get('live') in legacy_urls):
                continue
            for actor in row.get('actors', []):
                name = actor.get('name', '').strip()
                if name and not re.search(r'ウマ娘.*(?:gal|プリティーダービー)', name, re.I) and name not in full_names:
                    full_names.append(name)
        for item in known_cast:
            if item.get('participation_label') or not item.get('voice_actor_id'):
                continue
            profile = identities.profile_by_id.get(item['voice_actor_id'], {})
            name = (profile.get('identity') or {}).get('ja') or item.get('name')
            if name and identities.voice_id(name) not in {identities.voice_id(value) for value in full_names if identities.voice_id(value)}:
                full_names.append(name)
        performances, rendered = [], []
        session_cast = []
        for song in block['songs']:
            full = any(ALL_CAST.fullmatch(name) for name in song['performers'])
            singers = list(dict.fromkeys([name for name in song['performers'] if not ALL_CAST.fullmatch(name)] + (full_names if full else [])))
            rendered.append({**song, 'performers': singers})
            title = clean_song(song['name'])
            if not title:
                continue
            actors, characters, guests = [], [], []
            for name in singers:
                actor_id = identities.voice_id(name)
                if not actor_id:
                    guests.append(name)
                    continue
                if actor_id in actors:
                    continue
                actors.append(actor_id)
                cast_roles = {item['character_id'] for item in known_cast if item.get('voice_actor_id') == actor_id and item.get('character_id')}
                character_id = next(iter(cast_roles)) if len(cast_roles) == 1 else ''
                if character_id and character_id not in characters:
                    characters.append(character_id)
                profile = identities.profile_by_id[actor_id]
                session_cast.append({'voice_actor_id': actor_id, 'character_id': character_id,
                                     'name': profile['identity']['zh'], 'role': (identities.character_by_id.get(character_id) or {}).get('zh', ''),
                                     'evidence': 'google_sheet', 'source_url': SHEET_URL, 'person_type': 'voice_actor', 'resolution': 'resolved'})
            performances.append({'song': title, 'setlist_no': song['no'], 'voice_actor_ids': actors,
                                 'character_ids': characters, 'guest_performers': guests, 'full_cast': full})
        performances = curated_performances(session.get('setlist_html'), performances, identities, known_cast)
        session['performances'] = performances
        session['songs'] = [song['song'] for song in performances]
        session['cast'] = identity_tools.merge_cast_records(session_cast)
        session['character_ids'] = list(dict.fromkeys(cid for row in performances for cid in row['character_ids']))
        session['setlist_html'] = display_table(session.get('setlist_html'), {**block, 'songs': rendered}, known_cast, identities)
        if session.get('setlist_source'):
            session.setdefault('alternate_setlist_sources', []).append(session['setlist_source'])
        session['setlist_source'] = {'file': SOURCE_FILE, 'url': SHEET_URL, 'sheet_title': block['title']}
        event['sources'] = [source for source in event.get('sources', []) if source.get('kind') != 'google_sheet'] + [
            {'kind': 'google_sheet', 'label': 'Google 歌单', 'url': SHEET_URL}]
        event['cast'] = identity_tools.merge_cast_records(item for row in event['sessions'] for item in row.get('cast', []))
        applied.append((event['id'], session['id']))
    return applied
