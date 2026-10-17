"""Resolve new prototype horses and cited parentage through exact public pages."""

import argparse
import json
import re
import unicodedata
import urllib.parse

from knowledge_io import ROOT, fetch, fill_empty, read_json, read_window, write_json


def normalized(value):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', value or '')).casefold()


def plain(value):
    value = re.sub(r'<ref\b[^>]*>.*?</ref>|<ref[^>]*/>|<!--.*?-->', '', value, flags=re.S)
    value = re.sub(r'\[\[([^]|]+)\|([^]]+)\]\]', r'\2', value)
    value = re.sub(r'\[\[([^]]+)\]\]', r'\1', value)
    return re.sub(r'<[^>]+>|\{\{[^{}]*\}\}', '', value).strip()


def horse_page(name):
    for title in (name, name + ' (競走馬)'):
        query = urllib.parse.urlencode({'action': 'parse', 'page': title, 'prop': 'wikitext', 'format': 'json', 'redirects': '1'})
        response = json.loads(fetch('https://ja.wikipedia.org/w/api.php?' + query))
        page = response.get('parse') or {}
        if normalized(re.sub(r'\s*\([^)]*\)$', '', page.get('title', ''))) != normalized(name):
            continue
        raw = (page.get('wikitext') or {}).get('*', '')
        if not re.search(r'\{\{\s*(?:競走馬|Infobox racehorse)\b', raw, re.I):
            continue
        # Stop at the outer infobox boundary instead of picking fields from
        # later race tables or unrelated horses mentioned in the article.
        start = re.search(r'\{\{\s*(?:競走馬|Infobox racehorse)', raw, re.I).start()
        depth, end = 0, start
        for token in re.finditer(r'\{\{|\}\}', raw[start:]):
            depth += 1 if token.group() == '{{' else -1
            end = start + token.end()
            if not depth:
                break
        raw_fields = {key.strip(): value for key, value in re.findall(r'^\s*\|\s*([^=\n]+)=\s*([^\n]*)', raw[start:end], re.M)}
        fields = {key: plain(value) for key, value in raw_fields.items()}
        birth = raw_fields.get('生', raw_fields.get('生年月日', raw_fields.get('foaled', '')))
        year = re.search(r'(?:17|18|19|20)\d{2}', birth)
        if not year:
            continue
        sex_value = fields.get('性', fields.get('性別', fields.get('sex', '')))
        sex = 'gelding' if re.search(r'騸|セン|Gelding', sex_value, re.I) else 'female' if re.search(r'牝|Mare|Filly', sex_value, re.I) else 'male' if re.search(r'牡|Stallion|Colt', sex_value, re.I) else ''
        url = 'https://ja.wikipedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ', '_'))
        jbis = re.search(r'https://www\.jbis\.(?:or\.jp|jp)/horse/\d+/', raw)
        netkeiba = re.search(r'https://db\.netkeiba\.com/horse/\d+/', raw)
        return {'ja': name, 'en': fields.get('英', fields.get('name', '')), 'born': int(year.group()), 'sex': sex,
                'metadata_source_url': jbis.group() if jbis else url,
                'profile_url': netkeiba.group() if netkeiba else url,
                'sire_name': fields.get('父', fields.get('sire', '')),
                'dam_name': fields.get('母', fields.get('dam', '')), 'source_url': url}
    return None


def add_horse(source, character, *, lookup=horse_page, generations=3):
    """Resolve only exact names and retain stable existing horse identities."""
    by_id = {row['id']: row for row in source['nodes']}
    matches = {}
    for row in source['nodes']:
        canonical, seen = row, set()
        while canonical.get('alias_of') in by_id and canonical['id'] not in seen:
            seen.add(canonical['id'])
            canonical = by_id[canonical['alias_of']]
        for name in (row.get('ja'), row.get('en')):
            if name:
                matches.setdefault(normalized(name), {})[canonical['id']] = canonical
    by_name = {key: next(iter(values.values())) for key, values in matches.items() if len(values) == 1}
    visiting = set()

    def resolve(name, depth, cid=None):
        key = normalized(name)
        if not key or key in visiting:
            return None
        if key in matches and len(matches[key]) > 1:
            return None
        old_node = by_name.get(key)
        if old_node and all(old_node.get(field) for field in ('born', 'sex')) and (not depth or all((old_node.get('parents') or {}).get(role) for role in ('sire', 'dam'))):
            return old_node['id']
        facts = lookup(name)
        if not facts:
            return old_node['id'] if old_node else None
        identifier = old_node['id'] if old_node else cid or 'horse-auto-' + name
        if not old_node and any(row['id'] == identifier for row in source['nodes']):
            return None
        visiting.add(key)
        node = old_node or {'id': identifier, 'zh': character.get('zh') if cid else name, 'auto_source': True}
        fill_empty(node, {k: v for k, v in facts.items() if k not in {'sire_name', 'dam_name', 'source_url'} and v})
        if character.get('page') and node.get('metadata_source_url') == character.get('page') and facts.get('metadata_source_url'):
            node['metadata_source_url'] = facts['metadata_source_url']
        if not old_node:
            source['nodes'].append(node)
        by_name[key] = node
        if depth:
            parents = {}
            for role in ('sire', 'dam'):
                parent_name = facts.get(role + '_name', '')
                if parent_name:
                    try:
                        parent = resolve(parent_name, depth - 1)
                    except Exception:
                        parent = None
                    if parent and parent != identifier:
                        parents[role] = parent
            if parents:
                parents.update(source='wikipedia', source_url=facts['source_url'])
                fill_empty(node.setdefault('parents', {}), parents)
        visiting.remove(key)
        return identifier

    horse = resolve(character.get('ja', ''), generations, character['id'])
    if horse:
        source['character_mappings'][character['id']] = {'horse': horse, 'kind': 'horse', 'auto_source': True}
        if horse not in source.setdefault('horse_pages', []):
            source['horse_pages'].append(horse)
    else:
        source['character_mappings'].setdefault(character['id'], {'horse': None, 'kind': 'unknown', 'auto_source': True})
    if not any(row['id'] == character['id'] for row in source['nodes']):
        node = {'id': character['id'], 'zh': character.get('zh', ''), 'ja': character.get('ja', ''),
                'en': character.get('en', ''), 'auto_source': True, 'metadata_source_url': character.get('page', '')}
        if horse:
            node['alias_of'] = horse
        source['nodes'].append(node)
    return horse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'data/pedigree_source.json'
    source = read_json(path)
    source['sources'].setdefault('wikipedia', {'name': 'Wikipedia cited racehorse infobox', 'url': 'https://ja.wikipedia.org/'})
    characters = read_window(ROOT / 'data/character_index_data.js')
    resolved, failed = 0, []
    for character in characters:
        previous = source['character_mappings'].get(character['id'])
        if previous and not previous.get('auto_source'):
            continue
        if character.get('role_type') == 'human':
            source['character_mappings'].setdefault(character['id'], {'horse': None, 'kind': 'non_uma', 'auto_source': True})
            if not any(row['id'] == character['id'] for row in source['nodes']):
                source['nodes'].append({'id': character['id'], 'zh': character.get('zh', ''), 'ja': character.get('ja', ''),
                    'en': character.get('en', ''), 'auto_source': True, 'metadata_source_url': character.get('page', '')})
            continue
        try:
            resolved += bool(add_horse(source, character))
        except Exception as error:
            source['character_mappings'].setdefault(character['id'], {'horse': None, 'kind': 'unknown', 'auto_source': True})
            failed.append(character['id'])
            print('prototype unavailable:', character['id'], type(error).__name__, flush=True)
            if not any(row['id'] == character['id'] for row in source['nodes']):
                source['nodes'].append({'id': character['id'], 'zh': character.get('zh', ''), 'ja': character.get('ja', ''),
                    'en': character.get('en', ''), 'auto_source': True, 'metadata_source_url': character.get('page', '')})
    if not args.dry_run:
        write_json(path, source)
    print(f'prototype mappings: {resolved} added, {len(failed)} source failures; existing mappings preserved')
    return bool(failed)


if __name__ == '__main__':
    raise SystemExit(main())
