"""Add official characters without waiting for a community translation page."""

import argparse
import html
import io
import json
import re
import urllib.parse

from bs4 import BeautifulSoup
from PIL import Image

from knowledge_io import ROOT, fetch, fill_empty, read_json, read_window, write_json, write_text, write_window

OFFICIAL = 'https://umamusume.jp/character/'
PROFILE_FIELDS = {'誕生日': 'birth', '身長': 'height', '体重': 'weight', 'スリーサイズ': 'sankak'}


def official_character_ids(markup):
    soup = BeautifulSoup(markup, 'html.parser')
    payload = soup.select_one('#__NUXT_DATA__')
    if payload is None:
        raise ValueError('official character category data was not recognized')
    values = json.loads(payload.string or payload.get_text())
    records = {}
    for item in values:
        if not isinstance(item, dict) or not {'id', 'name', 'category', 'cv'} <= item.keys():
            continue
        cid = values[item['id']]
        categories = [values[index] for index in values[item['category']]]
        if 'ウマ娘' in categories or 'トレセン学園関係者' in categories:
            records[cid] = 'uma' if 'ウマ娘' in categories else 'human'
    if not records:
        raise ValueError('official listing returned no explicitly classified Uma characters')
    return records


def parse_character(markup, cid):
    soup = BeautifulSoup(markup, 'html.parser')
    body = soup.select_one('.character-detail__text')
    if body is None or body.select_one('.name') is None:
        raise ValueError('official character layout was not recognized: ' + cid)
    text = lambda selector: body.select_one(selector).get_text(' ', strip=True) if body.select_one(selector) else ''
    ja = text('.name')
    record = {'id': cid, 'ja': ja, 'zh': ja, 'en': text('.en'),
              'cv': re.sub(r'^CV\s*[：:]\s*', '', text('.cv p')), 'page': OFFICIAL + cid + '/'}
    record['cv_zh'] = record['cv']
    for label in body.select('.profile dt'):
        key = PROFILE_FIELDS.get(label.get_text(strip=True))
        value = label.find_next_sibling('dd')
        if key and value:
            record[key] = value.get_text(' ', strip=True)
    urls = list(dict.fromkeys(html.unescape(url) for url in re.findall(r'https://images\.microcms-assets\.io[^"\s<>]+', markup)))
    art = next((url for url in urls if urllib.parse.urlparse(url).path.rsplit('/', 1)[-1].startswith(cid + '_01.')), '')
    avatar = next((url for url in urls if urllib.parse.urlparse(url).path.rsplit('/', 1)[-1].startswith(cid + '_icon.')), '')
    detail = {'zh': ja, 'ja': ja, 'en': record['en'], 'cv_zh': record['cv'],
              'html': '<div class="uma-description"><p>' + html.escape(text('.detail-text')).replace('\n', '<br>') + '</p></div>',
              'source_url': record['page'], 'language': 'ja'}
    return record, detail, art, avatar


def save_art(url, path, size):
    image = Image.open(io.BytesIO(fetch(url, binary=True))).convert('RGBA')
    image.thumbnail(size, Image.Resampling.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    try:
        image.save(temporary, 'PNG', optimize=True)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_details(path, details):
    previous = read_window(path)
    additions = {key: value for key, value in details.items() if key not in previous}
    if additions and all(details.get(key) == value for key, value in previous.items()):
        text = path.read_text(encoding='utf-8')
        closing = text.rfind('}')
        head = text[:closing].rstrip()
        if not head.endswith(('{', ',')):
            head += ','
        entries = ',\n'.join('  ' + json.dumps(key, ensure_ascii=False) + ': ' + json.dumps(value, ensure_ascii=False) for key, value in additions.items())
        write_text(path, head + '\n' + entries + '\n' + text[closing:])
    else:
        write_window(path, 'CHAR_DETAIL', details)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    index_path = ROOT / 'data/character_index_data.js'
    detail_path = ROOT / 'data/character_detail_data.js'
    characters, details = read_window(index_path), read_window(detail_path)
    existing = {row['id']: row for row in characters}
    profiles = read_json(ROOT / 'data/voice_actor_profiles.json', {'voice_actors': []})['voice_actors']
    names = {row['identity']['ja']: row['identity']['zh'] for row in profiles if row['identity'].get('ja')}
    page = fetch(OFFICIAL)
    categories = official_character_ids(page)
    ids = list(categories)
    colors = {cid: (main.upper(), sub.upper()) for cid, main, sub in re.findall(
        r'href="/character/([a-z0-9_]+)/?"[^>]*style="[^\"]*--color-main:\s*(#[0-9a-fA-F]{6});\s*--color-sub:\s*(#[0-9a-fA-F]{6})', page)}
    # Existing identities participate in missing-field refresh while retaining curated values.
    state_path = ROOT / 'data/auto_update/characters.json'
    state = read_json(state_path, {'ids': []})
    added, failed = 0, []
    for cid in ids:
        old = existing.get(cid, {})
        fields = ('ja', 'cv', 'img', 'av') + (tuple(PROFILE_FIELDS.values()) if categories[cid] == 'uma' else ())
        assets_ok = all((not old.get(field)) or (ROOT / str(old[field]).lstrip('/')).exists()
                        for field in ('img', 'av'))
        if old and all(old.get(field) for field in fields) and assets_ok and details.get(cid, {}).get('html'):
            continue
        try:
            record, detail, art, avatar = parse_character(fetch(OFFICIAL + cid + '/'), cid)
            record['role_type'] = categories[cid]
            record['zh'] = names.get(record['ja'], record['zh'])
            record['cv_zh'] = names.get(record['cv'], record['cv'])
            detail.update(zh=record['zh'], cv_zh=record['cv_zh'])
            record['main'], record['sub'] = colors.get(cid, ('#3355FF', '#FFFFFF'))
            if not args.dry_run:
                if art:
                    image_path = ROOT / 'uma_official' / (cid + '.png')
                    if not image_path.exists():
                        save_art(art, image_path, (720, 1056))
                    record['img'] = '/uma_official/' + cid + '.png'
                if avatar:
                    image_path = ROOT / 'uma_avatars' / (cid + '.png')
                    if not image_path.exists():
                        save_art(avatar, image_path, (240, 240))
                    record['av'] = '/uma_avatars/' + cid + '.png'
                    record.setdefault('img', record['av'])
            if cid not in existing:
                characters.append(record)
                existing[cid] = record
                state['ids'].append(cid)
                added += 1
            else:
                fill_empty(existing[cid], record)
            fill_empty(details.setdefault(cid, {}), detail)
        except Exception as error:
            failed.append(cid)
            print('character unavailable:', cid, type(error).__name__, flush=True)
    if not args.dry_run:
        write_details(detail_path, details)
        write_window(index_path, 'CHAR_INDEX', characters)
        write_json(state_path, state)
        # The official member classification supersedes older exclusions of
        # that same named member; unrelated background-role exclusions remain.
        scope_path = ROOT / 'data/anime/overrides.json'
        scope = read_json(scope_path, {})
        excluded = scope.get('excluded_characters', [])
        confirmed_ids = {cid for cid, category in categories.items() if category == 'uma'}
        retained = [row for row in excluded if row['id'] not in confirmed_ids]
        if retained != excluded:
            scope['excluded_characters'] = retained
            write_json(scope_path, scope)
    print(f'official characters: {added} added, {len(failed)} unavailable; existing curated entries preserved')
    return bool(failed)


if __name__ == '__main__':
    raise SystemExit(main())
