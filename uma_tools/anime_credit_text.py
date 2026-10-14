"""Parse explicit staff and music signatures without inferring affiliations."""
import re
import unicodedata
from bs4 import BeautifulSoup
from anime_labels import ROLES


def staff_text_rows(markup, roles=()):
    soup = BeautifulSoup(markup or '', 'html.parser')
    known = sorted(set(ROLES) | set(roles), key=len, reverse=True)
    pattern = re.compile(r'^(' + '|'.join(re.escape(role) for role in known) + r')\s*[：:／/\s]*([^：:].*)$')
    rows = []
    for term in soup.select('dt'):
        value = term.find_next_sibling('dd')
        if value:
            rows.append({'title': term.get_text(' ', strip=True), 'name': value.get_text('\n', strip=True)})
    text = soup.get_text('\n', strip=True)
    active = ''
    for line in text.splitlines():
        line = unicodedata.normalize('NFKC', line).strip()
        if line in known:
            active = line
            continue
        match = pattern.match(line)
        if match:
            rows.append({'title': match.group(1), 'name': match.group(2)})
            active = ''
        elif active and line:
            rows.append({'title': active, 'name': line})
    return rows


def entity_kind(entry, name, known_people, organizations):
    kind = str(entry.get('entity_type') or entry.get('@type') or '').lower()
    if kind == 'person':
        return 'person'
    if kind in ('organization', 'institution'):
        return 'organization'
    if name in known_people and name in organizations:
        return 'unresolved'
    if name in known_people:
        return 'person'
    if name in organizations or re.search(r'株式会社|有限会社|組合|協会|委員会|Co\.,?\s*Ltd|\bStudio\b|スタジオ|プロダクション', name, re.I):
        return 'organization'
    return 'unresolved'


def music_rows(markup):
    soup = BeautifulSoup(markup or '', 'html.parser')
    rows = []
    labels = {'オープニング':'opening', 'OP':'opening', 'エンディング':'ending', 'ED':'ending', '挿入歌':'insert', '主題歌':'theme', 'BGM':'bgm', '背景音楽':'bgm'}
    for item in soup.select('[data-music-usage], .episode-music li, .music-list li'):
        text = item.get_text(' ', strip=True)
        usage = item.get('data-music-usage') or next((value for label, value in labels.items() if label in text), '')
        title = item.select_one('.song-title')
        quoted = re.search(r'[「『](.+?)[」』]', text)
        name = title.get_text(' ', strip=True) if title else quoted.group(1) if quoted else ''
        if name and usage in set(labels.values()):
            rows.append({'title':name, 'usage_type':usage})
    for line in soup.get_text('\n', strip=True).splitlines():
        match = re.search(r'(オープニング(?:テーマ)?|エンディング(?:テーマ)?|挿入歌|主題歌|BGM|背景音楽)\s*[「『](.+?)[」』]', line)
        if match:
            label = match.group(1).replace('テーマ', '')
            rows.append({'title':match.group(2), 'usage_type':labels[label]})
    return rows
