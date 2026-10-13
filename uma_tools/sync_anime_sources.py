"""Publish additive official anime observations and explicit entity relations."""

import argparse
import datetime as dt
import html
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
    return rows


def collect_new_work(work):
    url = work['official_url']
    markup = fetch(url)
    rows = structured_episodes(markup, work['id'], url)
    soup = BeautifulSoup(markup, 'html.parser')
    links = set()
    for anchor in soup.select('a[href]'):
        link = urllib.parse.urljoin(url, anchor['href'])
        if urllib.parse.urlparse(link).netloc == urllib.parse.urlparse(url).netloc and re.search(r'/(?:episodes?|story)/(?:[a-z_-]*\d+)(?:[./?]|$)', urllib.parse.urlparse(link).path):
            links.add(link)
    for link in sorted(links)[:100]:
        rows.extend(structured_episodes(fetch(link), work['id'], link))
    # No episode list is a legitimate announced work, not an empty replacement.
    return list({row['number']: row for row in rows}.values())


def source(documents, identifier, url, label, kind='official'):
    rows = documents['source_registry']['sources']
    existing = next((row for row in rows if row.get('url') == url and row.get('kind') == kind), None)
    if existing:
        return existing
    if not any(row['id'] == identifier for row in rows):
        rows.append({'id': identifier, 'url': url, 'label': label, 'kind': kind,
                     'observed_at': dt.datetime.now(dt.timezone.utc).date().isoformat()})
    return next(row for row in rows if row['id'] == identifier)


def discover_work(row, documents, *, get=fetch, save_image=write_cover):
    url, title = row['url'], row['title']
    if any(work.get('official_url', '').rstrip('/') == url.rstrip('/') for work in documents['works']['works']):
        return None
    soup = BeautifulSoup(get(url), 'html.parser')
    metadata = lambda name: (soup.select_one('meta[property="' + name + '"]') or {}).get('content', '')
    # Classify only a dedicated work page's title, never the site's global nav.
    name = metadata('og:title') or title
    descriptor = name + ' ' + title
    kind = 'movie' if '劇場版' in descriptor else 'tv' if re.search(r'TVアニメ|Season\s*\d', descriptor, re.I) else 'short' if 'うまゆる' in descriptor else 'unknown'
    slug = urllib.parse.urlparse(url).path.strip('/').split('/')[-1]
    identifier = 'anime-' + (slug if slug and slug != 'anime' else urllib.parse.urlparse(url).hostname.replace('.', '-'))
    if any(work['id'] == identifier for work in documents['works']['works']):
        return None
    evidence = 'official-auto-' + identifier
    evidence = source(documents, evidence, url, title)['id']
    work = {'id': identifier, 'title_ja': title, 'title_zh': title, 'format': kind,
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
            documents['asset_sources']['assets'].append(asset)
        except Exception as error:
            print('work artwork unavailable:', identifier, type(error).__name__, flush=True)
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
    # Do not manufacture intervening released episodes when the source has a gap.
    if number > int(series.get('released_count', 0)) + 1:
        return
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
            work['status'] = 'airing'
    # Existing curated stills remain intact. Source-only images are accepted
    # individually after real decoding and the same HD checks as manual imports.
    if not detail.get('stills'):
        for index, image in enumerate(row.get('stills', []), 1):
            original = image.get('original', image.get('url')) if isinstance(image, dict) else image
            output = f'uma_tools/img/anime/stills/{uid}-auto-{index:02d}.webp'
            asset = {'unit_id': uid, 'mode': 'still', 'output': output, 'source_url': original, 'source_ref': evidence}
            try:
                if not (ROOT / output).exists():
                    save_image(asset)
                detail.setdefault('stills', []).append({'url': '/' + output, 'original': original, 'source_ref': evidence})
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
                'status': 'active', 'content_type': 'full_episode', 'source_ref': evidence})
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
            relations.append({'id': f'{uid}-auto-cast-{order}', 'source_type': 'anime_unit', 'source_id': uid,
                'relation_type': 'credited_cast', 'target_type': 'character', 'target_id': character['id'],
                'voice_actor_id': voice['id'], 'signature': signature, 'display_order': order, 'evidence_refs': [evidence]})
    if checked.get('staff_status') == 'complete':
        return
    credits, people = documents['staff']['credits'], documents['people']['people']
    known_people = unique_names(people, lambda person: [person_name_key(name) for name in [person['name'], *person.get('aliases', [])]])
    organizations = {name for item in credits for name in [item.get('organization', ''), *item.get('institutions', [])] if name}
    existing = {(item.get('unit_id'), role_key(item.get('role', '')), person_name_key(item.get('name', ''))) for item in credits}
    for order, staff in enumerate(row.get('staff', [])):
        role = BeautifulSoup(staff.get('title', ''), 'html.parser').get_text('', strip=True)
        for name in BeautifulSoup(staff.get('name', ''), 'html.parser').get_text('\n', strip=True).splitlines():
            name = name.strip()
            key = (uid, role_key(role), person_name_key(name))
            if not name or not role or key in existing:
                continue
            credit = {'work_id': work_id, 'unit_id': uid, 'role': role, 'name': name, 'order': order, 'source_ref': evidence, 'auto_source': True}
            if name in organizations or re.search(r'株式会社|有限会社|Co\.,?\s*Ltd', name):
                credit['organization'] = name
            else:
                person = known_people.get(person_name_key(name))
                if person is None:
                    person = {'id': 'staff-auto-' + name, 'name': name, 'aliases': [], 'source_refs': [evidence]}
                    if any(item['id'] == person['id'] for item in people):
                        continue
                    people.append(person)
                    known_people[person_name_key(name)] = person
                credit['person_id'] = person['id']
            credits.append(credit)
            existing.add(key)


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
    unit_ids = {f"{series['work_id']}-e{number:02d}" for series in documents['units']['series'] for number in range(1, int(series.get('released_count', 0)) + 1)}
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
        except Exception as error:
            errors.append(label)
            print('anime source unavailable:', label, type(error).__name__, flush=True)
    for work in documents['works']['works']:
        if not work.get('auto_source'):
            continue
        try:
            for row in sorted(collect_new_work(work), key=lambda item: item['number']):
                publish_episode(row, documents, characters, voices, save_image=save)
        except Exception as error:
            errors.append(work['id'])
            print('anime source unavailable:', work['id'], type(error).__name__, flush=True)
    relate_public_entities(documents, read_json(ROOT / 'data/events_catalog.json')['events'], read_json(ROOT / 'data/albums.json'))
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
