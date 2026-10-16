"""Cli responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import photos as pipeline_photos
from . import profiles as pipeline_profiles
from . import races as pipeline_races
from . import registry as pipeline_registry
from . import transport as pipeline_transport


def serialize(prefix, payload):
    return prefix + pipeline_common.json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"


def atomic_write(path, content):
    directory = pipeline_common.os.path.dirname(path)
    fd, temp_path = pipeline_common.tempfile.mkstemp(prefix='.horses-', suffix='.tmp', dir=directory)
    try:
        with pipeline_common.os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(content)
        pipeline_common.os.chmod(temp_path, 0o644)
        pipeline_common.os.replace(temp_path, path)
    except Exception:
        try:
            pipeline_common.os.unlink(temp_path)
        except OSError:
            pass
        raise


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0, help='只跑前 N 匹用于调试')
    parser.add_argument('--no-wiki', action='store_true', help='跳过 Wikipedia 抓取')
    parser.add_argument('--no-jbis', action='store_true', help='跳过 JBIS 抓取')
    parser.add_argument('--resume', action='store_true', help='跳过已有详情缓存的马')
    parser.add_argument('--missing', action='store_true', help='保留现有详情，只补新增原型马和角色映射')
    parser.add_argument('--photos-only', action='store_true',
                        help='只给缺图的马补 photo 字段（不重抓正文）')
    parser.add_argument('--localize-photos', action='store_true',
                        help='把远端照片下载到本地 img/horses 并改写 photo 字段')
    parser.add_argument('--races-only', action='store_true',
                        help='只补 JBIS 逐场战绩 races 字段（不重抓正文）')
    args = parser.parse_args()

    source = pipeline_registry.load_pedigree_source()
    horses = pipeline_registry.build_horses(source)
    print('原型马总数: %d' % len(horses))
    if args.limit:
        horses = horses[:args.limit]

    total = len(horses)
    list_rows = []
    details = {}
    if args.missing:
        from knowledge_io import read_json, write_json, fill_empty
        state_path = pipeline_common.os.path.join(pipeline_common.DATA_DIR, 'auto_update', 'horse_profiles.json')
        profile_state = read_json(state_path, {'attempted_at': {}})
        attempts = profile_state.setdefault('attempted_at', {})
        with open(pipeline_common.OUT_DETAIL, encoding='utf-8') as handle:
            details = pipeline_common.json.loads(handle.read().split('=', 1)[1].strip().rstrip(';'))
        with open(pipeline_common.OUT_LIST, encoding='utf-8') as handle:
            list_rows = pipeline_common.json.loads(handle.read().split('=', 1)[1].strip().rstrip(';'))
        horses.sort(key=lambda horse: (horse['id'] in details, attempts.get(horse['id'], 0)))
    refreshed = 0
    if args.missing:
        pipeline_transport.deadline = pipeline_common.time.monotonic() + 15 * 60

    def checkpoint():
        if args.missing:
            atomic_write(pipeline_common.OUT_DETAIL, serialize(pipeline_common.DETAIL_PREFIX, details))
            atomic_write(pipeline_common.OUT_LIST, serialize(pipeline_common.LIST_PREFIX, list_rows))
            write_json(state_path, profile_state)

    for index, horse in enumerate(horses, 1):
        if args.missing and (refreshed >= 8 or pipeline_common.time.monotonic() >= pipeline_transport.deadline):
            break
        if args.missing and horse['id'] in details:
            record = details[horse['id']]
            record['cids'] = sorted(set(record.get('cids', []) + horse['cids']))
            missing = any(not record.get(field) for field in ('photo', 'intro')) or (pipeline_races.battle_count(record) and len(record.get('races', [])) < pipeline_races.battle_count(record))
            if missing and pipeline_common.time.time() - attempts.get(horse['id'], 0) >= 86400:
                attempts[horse['id']] = pipeline_common.time.time()
                refreshed += 1
                incoming = pipeline_profiles.fetch_horse(horse, use_wiki=not args.no_wiki, use_jbis=not args.no_jbis)
                fill_empty(record, incoming)
                record['races'] = pipeline_races.merge_races(record.get('races', []), incoming.get('races', []))
            if args.localize_photos and record.get('photo') and not record['photo'].startswith('/uma_tools/'):
                record['photo'] = pipeline_photos.localize_photo(record) or record['photo']
            pipeline_registry.birth_precision(record)
            for row in list_rows:
                if row['id'] == horse['id']:
                    row['cids'] = record['cids']
                    fill_empty(row, {field: record.get(field) for field in ('photo', 'sex', 'born', 'birthdate')})
                    pipeline_registry.birth_precision(row)
            checkpoint()
            continue
        done_path = pipeline_common.os.path.join(pipeline_common.CACHE_DIR, 'detail_%s.json' % horse['id'])
        if args.races_only:
            if not pipeline_common.os.path.isfile(done_path):
                continue
            with open(done_path, encoding='utf-8') as handle:
                record = pipeline_common.json.load(handle)
            changed = False
            if not pipeline_races.jbis_birth_matches(record):
                new = (pipeline_races.search_jbis_url(record.get('ja') or '', record.get('born') or '')
                       or pipeline_races.search_jbis_url(record.get('en') or '', record.get('born') or ''))
                if new and new != record.get('jbis'):
                    print('[jbis fix] %s -> %s' % (horse['id'], new))
                    record['jbis'] = new
                    changed = True
                    try:
                        parsed = pipeline_races.parse_tables(pipeline_transport.http_get(new))
                        record['yearly'] = parsed.get('yearly') or record['yearly']
                        record['major'] = parsed.get('major') or record['major']
                        record['awards'] = parsed.get('awards') or record['awards']
                        record['jbis_pedigree'] = parsed.get('pedigree') or []
                    except Exception as exc:  # noqa: BLE001
                        print('  [jbis refetch fail] %s %s' % (horse['id'], exc))
                else:
                    # 无替代：同名错马的档案与其派生数据一并丢弃
                    print('[jbis dropped] %s 生年不符且无替代' % horse['id'])
                    record['jbis'] = ''
                    record['yearly'] = []
                    record['major'] = []
                    record['awards'] = []
                    record['jbis_pedigree'] = []
                    changed = True
            rows = []
            if record.get('jbis') and 'jbis.or.jp' in record['jbis']:
                try:
                    pipeline_common.time.sleep(pipeline_common.JBIS_SLEEP)
                    rows = pipeline_races.parse_races(pipeline_transport.http_get(record['jbis'].rstrip('/') + '/record/'))
                except Exception as exc:  # noqa: BLE001
                    print('[races jbis fail] %s %s' % (horse['id'], exc))
            merged = pipeline_races.fill_races(record, rows)
            if merged != record.get('races'):
                record['races'] = merged
                changed = True
            target = pipeline_races.battle_count(record)
            print('[races] %s -> %d 场 (目标 %s)' % (horse['id'], len(merged), target or '?'))
            if changed:
                with open(done_path, 'w', encoding='utf-8') as handle:
                    pipeline_common.json.dump(record, handle, ensure_ascii=False)
        elif args.missing:
            refreshed += 1
            record = pipeline_profiles.fetch_horse(horse, use_wiki=not args.no_wiki, use_jbis=not args.no_jbis)
            if args.localize_photos and record.get('photo'):
                record['photo'] = pipeline_photos.localize_photo(record) or record['photo']
            attempts[horse['id']] = pipeline_common.time.time()
            pipeline_common.os.makedirs(pipeline_common.CACHE_DIR, exist_ok=True)
            with open(done_path, 'w', encoding='utf-8') as handle:
                pipeline_common.json.dump(record, handle, ensure_ascii=False)
        elif args.localize_photos:
            if not pipeline_common.os.path.isfile(done_path):
                continue
            with open(done_path, encoding='utf-8') as handle:
                record = pipeline_common.json.load(handle)
            photo = record.get('photo') or ''
            if photo and not photo.startswith('/uma_tools/'):
                local = pipeline_photos.localize_photo(record)
                if local:
                    record['photo'] = local
                    with open(done_path, 'w', encoding='utf-8') as handle:
                        pipeline_common.json.dump(record, handle, ensure_ascii=False)
                    print('[localize] %s -> %s' % (horse['id'], local))
                else:
                    print('[localize fail] %s %s' % (horse['id'], photo[:70]))
        elif args.photos_only:
            if not pipeline_common.os.path.isfile(done_path):
                continue
            with open(done_path, encoding='utf-8') as handle:
                record = pipeline_common.json.load(handle)
            if record.get('photo'):
                details[horse['id']] = record
                list_rows.append({
                    'id': record['id'], 'zh': record['zh'], 'ja': record['ja'],
                    'en': record['en'], 'sex': record['sex'], 'born': record['born'],
                    'country': record['country'],
                    'birthdate': record.get('birthdate', ''),
                    'photo': record.get('photo', ''),
                    'cids': record.get('cids', []),
                })
                continue
            photo = pipeline_photos.fill_missing_photo(record)
            if photo:
                record['photo'] = photo
                with open(done_path, 'w', encoding='utf-8') as handle:
                    pipeline_common.json.dump(record, handle, ensure_ascii=False)
                print('[photo] %s -> %s' % (horse['id'], photo))
            else:
                print('[photo miss] %s' % horse['id'])
        elif args.resume and pipeline_common.os.path.isfile(done_path):
            with open(done_path, encoding='utf-8') as handle:
                record = pipeline_common.json.load(handle)
        else:
            record = pipeline_profiles.fetch_horse(horse, use_wiki=not args.no_wiki,
                                 use_jbis=not args.no_jbis)
            pipeline_common.os.makedirs(pipeline_common.CACHE_DIR, exist_ok=True)
            with open(done_path, 'w', encoding='utf-8') as handle:
                pipeline_common.json.dump(record, handle, ensure_ascii=False)
        details[horse['id']] = record
        list_rows.append({
            'id': horse['id'],
            'zh': record['zh'],
            'ja': record['ja'],
            'en': record['en'],
            'sex': record['sex'],
            'born': record['born'],
            'country': record['country'],
            'birthdate': record.get('birthdate', ''),
            'photo': record.get('photo', ''),
            'cids': record.get('cids', []),
        })
        print('[%d/%d] %s %s %s wiki=%s jbis=%s photo=%s' % (
            index, total, horse['id'], record['ja'], record['zh'],
            'yes' if record.get('wiki') else 'no',
            'yes' if record['jbis'] else 'no',
            'yes' if record['photo'] else 'no',
        ))
        if index % 10 == 0:
            print('  ...complete %d/%d' % (index, total))
        checkpoint()

    if args.missing:
        write_json(state_path, profile_state)
    atomic_write(pipeline_common.OUT_LIST, serialize(pipeline_common.LIST_PREFIX, list_rows))
    atomic_write(pipeline_common.OUT_DETAIL, serialize(pipeline_common.DETAIL_PREFIX, details))
    print('wrote %s' % pipeline_common.os.path.relpath(pipeline_common.OUT_LIST, pipeline_common.ROOT))
    print('wrote %s' % pipeline_common.os.path.relpath(pipeline_common.OUT_DETAIL, pipeline_common.ROOT))
