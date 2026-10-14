"""Registry responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common


def load_pedigree_source():
    with open(pipeline_common.PEDIGREE_SOURCE, encoding='utf-8') as handle:
        return pipeline_common.json.load(handle)


def build_horses(source):
    by_id = {}
    for node in source.get('nodes') or []:
        node_id = node.get('id')
        if node_id:
            by_id[node_id] = node

    def canonical(node_id):
        seen = set()
        while node_id in by_id and by_id[node_id].get('alias_of'):
            node_id = by_id[node_id]['alias_of']
            if node_id in seen:
                break
            seen.add(node_id)
        return node_id

    horse_cids = {canonical(hid): [] for hid in source.get('horse_pages', [])}
    for cid, mapping in (source.get('character_mappings') or {}).items():
        horse = mapping.get('horse')
        if not horse:
            continue
        check_kind = mapping.get('kind')
        if check_kind and check_kind != 'horse':
            continue
        hid = canonical(horse)
        if hid not in by_id:
            continue
        horse_cids.setdefault(hid, []).append(cid)

    rows = []
    for hid, cids in horse_cids.items():
        node = by_id[hid]
        sex = node.get('sex')
        born = node.get('born')
        if not sex or not born:
            continue  # 无性/无出生年 -> 训练员、工作人员等非马角色
        rows.append({
            'id': hid,
            'zh': node.get('zh') or '',
            'ja': node.get('ja') or '',
            'en': node.get('en') or '',
            'sex': sex,
            'born': born,
            'country': node.get('country') or '',
            'jbis': node.get('metadata_source_url') or '',
            'netkeiba': node.get('profile_url') or '',
            'cids': sorted(set(cids)),
        })
    rows.sort(key=lambda r: (born_sort(r['born']), r['ja'] or r['en'] or r['zh']))
    return rows


def born_sort(value):
    if isinstance(value, (int, float)):
        return int(value)
    digits = pipeline_common.re.sub(r'\D', '', str(value))
    return int(digits) if digits else 999999


def birth_precision(record):
    """Ancestors known only by year do not acquire a synthetic January 1."""
    date = str(record.get('birthdate') or '')
    year = pipeline_common.re.search(r'\d{4}', str(record.get('born') or ''))
    if year and int(year.group()) < 1800:
        record['birthdate'] = ''
        record['birth_precision'] = 'approximate_year' if pipeline_common.re.search(r'約|约|circa|c\.', str(record.get('born')), pipeline_common.re.I) else 'year'
    else:
        record['birth_precision'] = 'day' if pipeline_common.re.search(r'\d{4}[./年-]\d{1,2}[./月-]\d{1,2}', date) else 'year'
    return record
