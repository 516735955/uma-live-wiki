"""Publish additive official anime observations and explicit entity relations."""

import argparse
import datetime as dt
import html
import hashlib
import json
import re
import unicodedata
import urllib.parse

from bs4 import BeautifulSoup

from anime_labels import person_name_key, role_key
from knowledge_io import ROOT, fetch, fill_empty, read_json, read_window, unique_names, write_json
from sync_anime_assets import write_cover
from collect_anime_official import collect_cingray, collect_fullgate, collect_season3
from update_anime import observe_portal
from anime_web import episode_records, work_metadata
from anime_credit_text import staff_text_rows, entity_kind

DATA = ROOT / 'data/anime'


def normalized(value):
    return re.sub(r'[\s「」『』【】（）()・:：!！?？～〜~-]', '', unicodedata.normalize('NFKC', value or '')).casefold()


def structured_episodes(markup, work_id, page_url):
    """Read explicit episode metadata used by new official sites."""
    soup = BeautifulSoup(markup, 'html.parser')
    rows = []

    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            kind = value.get('@type', '')
            types = kind if isinstance(kind, list) else [kind]
            if {'TVEpisode', 'Episode'} & set(types):
                number = str(value.get('episodeNumber', ''))
                if number.isdigit() and value.get('name'):
                    images = value.get('image', [])
                    images = images if isinstance(images, list) else [images]
                    actors = value.get('actor', [])
                    actors = actors if isinstance(actors, list) else [actors]
                    rows.append({'work_id': work_id, 'number': int(number), 'title_ja': value['name'],
                        'summary_ja': value.get('description', ''), 'source_url': urllib.parse.urljoin(page_url, value.get('url') or page_url),
                        'release_date': str(value.get('datePublished', ''))[:10],
                        'stills': [urllib.parse.urljoin(page_url, image.get('url', '') if isinstance(image, dict) else image) for image in images if image],
                        'cast': [{'title': item.get('characterName', ''), 'name': item.get('name', '')} for item in actors if isinstance(item, dict)],
                        'staff': [{'title': '監督', 'name': item['name']} for item in (value.get('director', []) if isinstance(value.get('director'), list) else [value.get('director', {})]) if isinstance(item, dict) and item.get('name')]})
            for item in value.values():
                if isinstance(item, (dict, list)):
                    visit(item)

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            visit(json.loads(script.string or script.get_text()))
        except (ValueError, TypeError):
            continue
    return rows + episode_records(markup, work_id, page_url)


def collect_new_work(work):
    url = work['official_url']
    markup = fetch(url)
    metadata = work_metadata(markup)
    if work.get('auto_source'):
        work.update(metadata)
    else:
        fill_empty(work, metadata)
    rows = structured_episodes(markup, work['id'], url)
    soup = BeautifulSoup(markup, 'html.parser')
    links = set()
    for anchor in soup.select('a[href]'):
        link = urllib.parse.urljoin(url, anchor['href'])
        if urllib.parse.urlparse(link).netloc == urllib.parse.urlparse(url).netloc and re.search(r'/(?:episodes?|story)/(?:[a-z_-]*\d+)(?:[./?]|$)', urllib.parse.urlparse(link).path):
            links.add(link)
    for link in sorted(links)[:100]:
        rows.extend(structured_episodes(fetch(link), work['id'], link))
    if not rows and not (work.get('status') == 'announced' and re.search(r'coming\s*soon|近日公開|放送予定|配信予定', markup, re.I)):
        raise ValueError('official episode layout was not recognized: ' + url)
    return merge_episode_records(rows)


def merge_episode_records(rows):
    merged = {}
    for row in rows:
        current = merged.setdefault(row['number'], {})
        for key, value in row.items():
            if not value:
                continue
            if isinstance(value, list):
                existing = current.setdefault(key, [])
                existing.extend(item for item in value if item not in existing)
            elif not current.get(key):
                current[key] = value
    return list(merged.values())


def source(documents, identifier, url, label, kind='official'):
    rows = documents['source_registry']['sources']
    existing = next((row for row in rows if row.get('url') == url and row.get('kind') == kind), None)
    if existing:
        return existing
    base, ordinal = identifier, 2
    while any(row['id'] == identifier for row in rows):
        identifier = base + '-' + str(ordinal)
        ordinal += 1
    rows.append({'id': identifier, 'url': url, 'label': label, 'kind': kind,
                 'observed_at': dt.datetime.now(dt.timezone.utc).date().isoformat()})
    return next(row for row in rows if row['id'] == identifier)


def discover_work(row, documents, *, get=fetch, save_image=write_cover):
    url, title = row['url'], row['title']
    existing = next((work for work in documents['works']['works'] if work.get('official_url', '').rstrip('/') == url.rstrip('/')), None)
    if existing and existing.get('cover'):
        return None
    soup = BeautifulSoup(get(url), 'html.parser')
    metadata = lambda name: (soup.select_one('meta[property="' + name + '"]') or {}).get('content', '')
    # Classify only a dedicated work page's title, never the site's global nav.
    name = metadata('og:title') or title
    descriptor = name + ' ' + title
    kind = 'movie' if '劇場版' in descriptor else 'tv' if re.search(r'TVアニメ|Season\s*\d', descriptor, re.I) else 'short' if 'うまゆる' in descriptor else 'unknown'
    slug = urllib.parse.urlparse(url).path.strip('/').split('/')[-1]
    identifier = 'anime-' + (slug if slug and slug != 'anime' else urllib.parse.urlparse(url).hostname.replace('.', '-'))
    if existing:
        identifier = existing['id']
    else:
        identifier += '-' + hashlib.sha256(url.rstrip('/').encode('utf-8')).hexdigest()[:12]
    evidence = 'official-auto-' + identifier
    evidence = source(documents, evidence, url, title)['id']
    work = existing or {'id': identifier, 'title_ja': title, 'title_zh': title, 'format': kind,
            'distribution': 'web' if kind in {'short', 'web'} else kind, 'status': 'announced',
            'official_url': url, 'source_refs': [evidence], 'auto_source': True,
            'summary_ja': metadata('og:description') or (soup.select_one('meta[name="description"]') or {}).get('content', '')}
    image = metadata('og:image')
    if image:
        output = 'uma_tools/img/anime/' + identifier + '.webp'
        asset = {'work_id': identifier, 'output': output, 'source_url': urllib.parse.urljoin(url, image), 'source_ref': evidence}
        try:
            save_image(asset)
            work.update(cover='/' + output, cover_original=asset['source_url'])
            if not any(item['output'] == output for item in documents['asset_sources']['assets']):
                documents['asset_sources']['assets'].append(asset)
        except Exception as error:
            print('work artwork unavailable:', identifier, type(error).__name__, flush=True)
    if not existing:
        documents['works']['works'].append(work)
        documents['units']['series'].append({'work_id': identifier, 'count': 0, 'released_count': 0, 'unit_type': 'episode', 'details': {}})
    return work


def publish_episode(row, documents, characters, voices, *, save_image=write_cover):
    work_id, number = row['work_id'], int(row['number'])
    if not row.get('title_ja') or number < 1:
        return
    if row.get('release_date') and row['release_date'] > dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date().isoformat():
        return
    series = next((item for item in documents['units']['series'] if item['work_id'] == work_id), None)
    if series is None:
        return
    published = series.setdefault('published_numbers', list(range(1, int(series.get('released_count', 0)) + 1)))
    if number not in published:
        published.append(number)
        published.sort()
    uid = f'{work_id}-e{number:02d}'
    evidence = 'official-auto-' + uid
    evidence = source(documents, evidence, row['source_url'], '官方剧集资料')['id']
    detail = series.setdefault('details', {}).setdefault(str(number), {})
    fill_empty(detail, {key: row.get(key) for key in ('title_ja', 'summary_ja', 'release_date')})
    detail['source_refs'] = list(dict.fromkeys([*detail.get('source_refs', []), evidence]))
    if number > int(series.get('released_count', 0)):
        series['released_count'] = number
        series['count'] = max(number, int(series.get('count', 0)))
        detail['auto_source'] = True
        work = next(item for item in documents['works']['works'] if item['id'] == work_id)
        if work.get('auto_source'):
            if work.get('status') != 'completed':
                work['status'] = 'airing'
    work = next(item for item in documents['works']['works'] if item['id'] == work_id)
    if row.get('release_date'):
        if work.get('auto_source'):
            work['start_date'] = min(work.get('start_date') or row['release_date'], row['release_date'])
            if row.get('is_final') or re.search(r'最終話|最終回', row['title_ja']):
                work.update(status='completed', end_date=row['release_date'])
    # Existing curated stills remain intact. Source-only images are accepted
    # individually after real decoding and the same HD checks as manual imports.
    if row.get('stills'):
        known_images = {item['original'] for item in detail.get('stills', [])}
        for index, image in enumerate(row.get('stills', []), 1):
            original = image.get('original', image.get('url')) if isinstance(image, dict) else image
            if original in known_images:
                continue
            sequence = 1
            outputs = {asset['output']: asset for asset in documents['asset_sources']['assets']}
            while True:
                output = f'uma_tools/img/anime/stills/{uid}-auto-{sequence:02d}.webp'
                if output not in outputs or outputs[output].get('source_url') == original:
                    break
                sequence += 1
            asset = {'unit_id': uid, 'mode': 'still', 'output': output, 'source_url': original, 'source_ref': evidence}
            try:
                if output not in outputs or not (ROOT / output).exists():
                    save_image(asset)
                detail.setdefault('stills', []).append({'url': '/' + output, 'original': original, 'source_ref': evidence})
                known_images.add(original)
                if not any(item['output'] == output for item in documents['asset_sources']['assets']):
                    documents['asset_sources']['assets'].append(asset)
            except Exception as error:
                print('episode artwork unavailable:', uid, index, type(error).__name__, flush=True)
    if not detail.get('cover') and detail.get('stills'):
        detail['cover'] = detail['stills'][0]['url']
        detail['cover_original'] = detail['stills'][0]['original']
    video = row.get('youtube_id', '')
    if re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
        rid = 'watch-auto-' + uid
        video_url = 'https://www.youtube.com/watch?v=' + video
        if not any(item['id'] == rid or (item.get('scope', {}).get('id') == uid and item.get('url') == video_url)
                   for item in documents['watch_resources']['resources']):
            documents['watch_resources']['resources'].append({'id': rid, 'scope': {'type': 'unit', 'id': uid},
                'url': video_url, 'platform': 'youtube', 'authority': 'official',
                'status': 'unverified', 'content_type': 'full_episode', 'source_ref': evidence})
    checked = next((item for item in documents['ending_credits']['episodes'] if item.get('work_id') == work_id and item.get('number') == number), {})
    if checked.get('cast_status') != 'complete':
        for order, cast in enumerate(row.get('cast', [])):
            signature = BeautifulSoup(cast.get('title', ''), 'html.parser').get_text('', strip=True)
            actor = BeautifulSoup(cast.get('name', ''), 'html.parser').get_text('', strip=True)
            character, voice = characters.get(normalized(signature)), voices.get(normalized(actor))
            if not character or not voice:
                continue
            relations = documents['relations']['relations']
            if any(item['source_id'] == uid and item.get('relation_type') == 'credited_cast' and item.get('target_id') == character['id'] and item.get('voice_actor_id') == voice['id'] for item in relations):
                continue
            relations.append({'id': f"{uid}-auto-cast-{character['id']}-{voice['id']}", 'source_type': 'anime_unit', 'source_id': uid,
                'relation_type': 'credited_cast', 'target_type': 'character', 'target_id': character['id'],
                'voice_actor_id': voice['id'], 'signature': signature, 'display_order': order, 'evidence_refs': [evidence]})
    if checked.get('staff_status') == 'complete':
        return
    credits, people = documents['staff']['credits'], documents['people']['people']
    known_people = unique_names(people, lambda person: [person_name_key(name) for name in [person['name'], *person.get('aliases', [])]])
    organizations = {name for item in credits for name in [item.get('organization', ''), *item.get('institutions', [])] if name}
    existing = {(item.get('unit_id'), role_key(item.get('role', '')), person_name_key(item.get('name', '')), item.get('group', '')) for item in credits}
    signatures = [*row.get('staff', []), *staff_text_rows(row.get('staff_text', ''), [item.get('role', '') for item in credits])]
    for order, staff in enumerate(signatures):
        role = BeautifulSoup(staff.get('title', ''), 'html.parser').get_text('', strip=True)
        for name in BeautifulSoup(staff.get('name', ''), 'html.parser').get_text('\n', strip=True).splitlines():
            name = name.strip()
            key = (uid, role_key(role), person_name_key(name), staff.get('group', ''))
            previous = next((item for item in credits if (item.get('unit_id'), role_key(item.get('role', '')), person_name_key(item.get('name', '')), item.get('group', '')) == key), None) if key in existing else None
            if not name or not role or previous and (not previous.get('auto_source') or previous.get('entity_type') != 'unresolved'):
                continue
            credit = previous or {'work_id': work_id, 'unit_id': uid, 'role': role, 'name': name, 'order': order, 'source_ref': evidence, 'auto_source': True}
            for field in ('group', 'source_time'):
                if staff.get(field) is not None:
                    credit[field] = staff[field]
            kind = entity_kind(staff, name, {person['name'] for person in people}, organizations)
            if kind == 'organization':
                credit['organization'] = name
                credit.pop('entity_type', None)
            elif kind == 'person':
                person = known_people.get(person_name_key(name))
                if person is None:
                    person = {'id': 'staff-auto-' + name, 'name': name, 'aliases': [], 'source_refs': [evidence]}
                    if any(item['id'] == person['id'] for item in people):
                        continue
                    people.append(person)
                    known_people[person_name_key(name)] = person
                credit['person_id'] = person['id']
                credit.pop('entity_type', None)
            else:
                credit['entity_type'] = 'unresolved'
            if previous is None:
                credits.append(credit)
            existing.add(key)


def publish_episode_music(row, documents, songs):
    from anime_credit_text import music_rows
    music_signatures = [*row.get('music', []), *music_rows(row.get('music_text', '')), *music_rows(row.get('staff_text', ''))]
    if not music_signatures:
        return
    uid = f"{row['work_id']}-e{int(row['number']):02d}"
    if not any(int(row['number']) in series.get('published_numbers', range(1, int(series.get('released_count', 0)) + 1))
               for series in documents['units']['series'] if series['work_id'] == row['work_id']):
        return
    work = next(work for work in documents['works']['works'] if work['id'] == row['work_id'])
    names = [normalized(work.get('title_ja', '')), *map(normalized, work.get('aliases', []))]
    for music in music_signatures:
        if not music.get('title') or music.get('usage_type') not in {'opening','ending','insert','theme','bgm'}:
            continue
        valid_refs = {entry['id'] for entry in documents['source_registry']['sources']}
        evidence = next((ref for ref in music.get('source_refs', []) if ref in valid_refs), None)
        if not evidence:
            evidence = source(documents, 'official-auto-music-' + uid, row['source_url'], '官方剧集音乐署名')['id']
        series = next(series for series in documents['units']['series'] if series['work_id']==row['work_id'])
        cues = series.setdefault('details', {}).setdefault(str(row['number']), {}).setdefault('music_cues', [])
        if not any(normalized(cue.get('title'))==normalized(music['title']) and cue.get('usage_type')==music['usage_type'] for cue in cues):
            cues.append({'title':music['title'], 'usage_type':music['usage_type'], 'credits':[], 'institutions':[], 'source_refs':[evidence],
                         **({field:music[field] for field in ('version_label','source_time') if field in music})})
        matches = []
        for song in songs:
            for version in song.get('versions', []):
                if normalized(music.get('title')) not in {normalized(version.get('title')), normalized(song.get('title'))}:
                    continue
                releases = [release for release in version.get('releases', []) if any(name and name in normalized(release.get('album_name')) for name in names)]
                if music.get('version_label') and normalized(version.get('version_label')) != normalized(music['version_label']):
                    continue
                if releases:
                    matches.append((song, version, releases[0]))
        identities = {(song['id'], version['id']): (song, version, release) for song, version, release in matches}
        if len(identities) != 1 or music.get('usage_type') not in {'opening','ending','insert','theme','bgm'}:
            continue
        song, version, release = next(iter(identities.values()))
        existing = next((relation for relation in documents['relations']['relations'] if relation.get('source_id')==uid
                         and relation.get('relation_type')=='uses_song' and relation.get('target_id')==song['id']
                         and relation.get('version_id')==version['id'] and relation.get('usage_type')==music['usage_type']),None)
        if existing:
            existing['evidence_refs'] = list(dict.fromkeys([*existing.get('evidence_refs', []),evidence]))
            continue
        identifier = uid + '-auto-music-' + version['id'] + '-' + music['usage_type']
        if any(relation['id'] == identifier for relation in documents['relations']['relations']):
            continue
        documents['relations']['relations'].append({'id':identifier,'source_type':'anime_unit','source_id':uid,
            'relation_type':'uses_song','target_type':'song','target_id':song['id'],'version_id':version['id'],
            'release_id':release['album_id'],'usage_type':music['usage_type'], 'evidence_refs':[evidence]})


def relate_public_entities(documents, events, albums):
    works = documents['works']['works']
    relations = documents['relations']['relations']
    keys = {(row['source_id'], row['relation_type'], row['target_id']) for row in relations}

    def match(title):
        matches = [(len(normalized(name)), work) for work in works for name in [work.get('title_ja', ''), *work.get('aliases', [])]
                   if len(normalized(name)) >= 8 and normalized(name) in normalized(title)
                   and (normalized(work.get('title_ja', '')) != normalized('ウマ娘 プリティーダービー')
                        or re.search(r'第?1期|Season\s*1\b|TVアニメ[「『]ウマ娘\s*プリティーダービー[」』]', title, re.I))]
        if not matches:
            return None
        longest = max(size for size, _ in matches)
        selected = {work['id']: work for size, work in matches if size == longest}
        return next(iter(selected.values())) if len(selected) == 1 else None

    for event in events:
        title = event.get('title', '')
        work = match(title)
        category = 'stage' if '舞台挨拶' in title else 'screening' if re.search(r'上映|プレミア', title) else 'program' if re.search(r'振り返り|アニメ.*(?:特番|スペシャル|生放送)', title) else ''
        if not work or not category:
            continue
        key = (work['id'], 'related_event', event['id'])
        if key in keys:
            continue
        cited = next((row['url'] for row in event.get('sources', []) if row.get('url', '').startswith('https://')), '')
        if not cited:
            continue
        ref = 'public-auto-event-' + event['id']
        ref = source(documents, ref, cited, '公开活动资料', kind='reference' if 'eventernote.com' in cited else 'official')['id']
        labels = {'screening': '上映', 'stage': '舞台见面会', 'program': '作品专题'}
        relations.append({'id': work['id'] + '-auto-' + event['id'], 'source_type': 'anime_work', 'source_id': work['id'],
            'relation_type': 'related_event', 'target_type': 'event', 'target_id': event['id'], 'label': labels[category],
            'event_category': category, 'evidence_refs': [ref]})
        keys.add(key)

    for album in albums:
        title = album.get('name', '')
        work = match(title)
        if not work or not re.search(r'サウンドトラック|Soundtrack|OST', title, re.I):
            continue
        key = (work['id'], 'soundtrack_album', album['id'])
        if key in keys:
            continue
        cited = album.get('source_url') or album.get('link') or album.get('official_url') or ''
        if not cited.startswith('https://'):
            continue
        ref = 'public-auto-album-' + album['id']
        ref = source(documents, ref, cited, '原声专辑发行资料')['id']
        relations.append({'id': work['id'] + '-auto-' + album['id'], 'source_type': 'anime_work', 'source_id': work['id'],
            'relation_type': 'soundtrack_album', 'target_type': 'album', 'target_id': album['id'], 'label': '原声专辑', 'evidence_refs': [ref]})
        keys.add(key)


def publish_verified_cast(documents, characters, voices):
    """Connect newly registered named roles to existing verified signatures."""
    relations = documents['relations']['relations']
    known = {(row['source_id'], row.get('target_id'), row.get('voice_actor_id')) for row in relations if row['relation_type'] == 'credited_cast'}
    unit_ids = {f"{series['work_id']}-e{number:02d}" for series in documents['units']['series'] for number in series.get('published_numbers', range(1, int(series.get('released_count', 0)) + 1))}
    refs = {row['id']: row for row in documents['source_registry']['sources']}
    for episode in documents['ending_credits']['episodes']:
        uid = f"{episode['work_id']}-e{int(episode['number']):02d}"
        ref = 'official-ending-' + uid
        if uid not in unit_ids or ref not in refs:
            continue
        for order, (signature, actor) in enumerate(episode.get('cast', [])):
            character = characters.get(normalized(signature))
            if character is None:
                # A named role in parentheses is an explicit signature, unlike
                # matching a generic commentator solely by the actor's name.
                names = re.findall(r'[（(]([^）)]+)[）)]', signature)
                matched = {characters[normalized(name)]['id']: characters[normalized(name)] for name in names if normalized(name) in characters}
                character = next(iter(matched.values())) if len(matched) == 1 else None
            voice = voices.get(normalized(actor))
            if not character or not voice or (uid, character['id'], voice['id']) in known:
                continue
            relations.append({'id': f'{uid}-auto-verified-cast-{order}', 'source_type': 'anime_unit', 'source_id': uid,
                'relation_type': 'credited_cast', 'target_type': 'character', 'target_id': character['id'],
                'voice_actor_id': voice['id'], 'signature': signature, 'display_order': order, 'evidence_refs': [ref]})
            known.add((uid, character['id'], voice['id']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    names = ('works', 'units', 'relations', 'staff', 'people', 'source_registry', 'watch_resources', 'asset_sources', 'ending_credits')
    documents = {name: read_json(DATA / (name + '.json')) for name in names}
    before = json.dumps(documents, ensure_ascii=False, sort_keys=True)
    characters = unique_names(read_window(ROOT / 'data/character_index_data.js'), lambda row: [normalized(name) for name in [row.get('ja', ''), *row.get('aliases', [])]])
    voices = unique_names(read_json(ROOT / 'data/voice_actor_profiles.json')['voice_actors'], lambda row: [normalized(name) for name in [row['identity'].get('ja', ''), *row['identity'].get('aliases', [])]])
    songs = read_json(ROOT / 'data/song_catalog.json')['songs']
    errors = []
    save = (lambda asset: None) if args.dry_run else write_cover
    try:
        portal = observe_portal(dt.datetime.now(dt.timezone.utc).isoformat())
        for work in portal['works']:
            discover_work(work, documents, save_image=save)
    except Exception as error:
        errors.append('portal')
        print('anime source unavailable: portal', type(error).__name__, flush=True)
    for label, collector in (('fullgate', collect_fullgate), ('cingray', collect_cingray), ('season3', collect_season3)):
        try:
            rows = collector()
            for row in sorted(rows, key=lambda item: int(item['number'])):
                publish_episode(row, documents, characters, voices, save_image=save)
                publish_episode_music(row, documents, songs)
        except Exception as error:
            errors.append(label)
            print('anime source unavailable:', label, type(error).__name__, flush=True)
    for work in documents['works']['works']:
        if not work.get('auto_source'):
            continue
        try:
            for row in sorted(collect_new_work(work), key=lambda item: item['number']):
                publish_episode(row, documents, characters, voices, save_image=save)
                publish_episode_music(row, documents, songs)
        except Exception as error:
            errors.append(work['id'])
            print('anime source unavailable:', work['id'], type(error).__name__, flush=True)
    relate_public_entities(documents, read_json(ROOT / 'data/events_catalog.json')['events'], read_json(ROOT / 'data/albums.json'))
    # A recording can become available after its episode. Re-resolve accepted
    # cues from persisted source facts without requiring another video download.
    for series in documents['units']['series']:
        for number, detail in list(series.get('details', {}).items()):
            if detail.get('music_cues'):
                cited = next((entry['url'] for entry in documents['source_registry']['sources']
                              if entry['id'] in detail['music_cues'][0].get('source_refs',[])), '')
                if cited:
                    publish_episode_music({'work_id':series['work_id'], 'number':int(number), 'music':list(detail['music_cues']),
                                           'source_url':cited}, documents, songs)
    publish_verified_cast(documents, characters, voices)
    if not args.dry_run:
        for name in names:
            if name != 'ending_credits':
                write_json(DATA / (name + '.json'), documents[name])
    changed = before != json.dumps(documents, ensure_ascii=False, sort_keys=True)
    print(f'official anime: changed={changed}, {len(errors)} failed sources; accepted fields preserved')
    return bool(errors)


if __name__ == '__main__':
    raise SystemExit(main())
