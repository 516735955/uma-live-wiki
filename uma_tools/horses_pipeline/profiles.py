"""Profiles responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import photos as pipeline_photos
from . import races as pipeline_races
from . import registry as pipeline_registry
from . import text as pipeline_text
from . import transport as pipeline_transport
from . import wikipedia as pipeline_wikipedia


def fetch_horse(horse, use_wiki=True, use_jbis=True):
    record = {
        'id': horse['id'],
        'zh': horse['zh'],
        'ja': horse['ja'],
        'en': horse['en'],
        'sex': horse['sex'],
        'born': horse['born'],
        'country': horse['country'],
        'cids': horse['cids'],
        'jbis': horse['jbis'] or '',
        'netkeiba': horse['netkeiba'] or '',
        'photo': '',
        'birthdate': '',
        'colour': '',
        'death': '',
        'family': {},
        'facts': {},
        'wins': [],
        'yearly': [],
        'major': [],
        'races': [],
        'awards': [],
        'career': [],
        'retirement': [],
        'breeding': [],
        'blood': [],
        'origins': [],
        'intro': '',
        'sources': [],
    }
    if horse['netkeiba'] and 'netkeiba.com' in horse['netkeiba']:
        record['sources'].append({'label': 'netkeiba', 'url': horse['netkeiba']})

    # ---- Wikipedia ----
    wiki = None
    if use_wiki:
        pipeline_common.time.sleep(pipeline_common.WIKI_SLEEP)
        try:
            wiki = pipeline_wikipedia.resolve_wikipedia(horse)
        except RuntimeError as exc:
            print('  [wiki unavailable] %s %s' % (horse['id'], exc))
    if wiki:
        lang, title = wiki['lang'], wiki['title']
        try:
            info = pipeline_wikipedia.wiki_pageinfo(lang, title)
        except Exception as exc:  # noqa: BLE001
            info = {'title': title, 'photo': '', 'extract': ''}
            print('  [wiki info fail] %s %s' % (horse['id'], exc))
        pipeline_common.time.sleep(pipeline_common.WIKI_SLEEP)
        try:
            wikitext = pipeline_wikipedia.wiki_wikitext(lang, title) if use_wiki else ''
        except Exception as exc:  # noqa: BLE001
            print('  [wiki text fail] %s %s' % (horse['id'], exc))
            pipeline_transport.failures.append('wiki text unavailable: %s: %s' % (horse['id'], exc))
            wikitext = ''
        # wiki 首图须像马匹照片（拒绝求图占位/马主纹章/logo 等；只查文件名防误伤 wikimedia 域名）
        photo_name = pipeline_common.urllib.parse.unquote((info['photo'] or '').split('/')[-1])
        if info['photo'] and not pipeline_common._NON_HORSE_PHOTO.search(photo_name):
            record['photo'] = info['photo']
        record['wiki'] = {'lang': lang, 'zh': title if lang == 'zh' else '',
                          'ja': title if lang == 'ja' else ''}
        record['sources'].append({
            'label': 'wikipedia', 'url': 'https://%s.wikipedia.org/wiki/%s' % (
                lang, pipeline_common.urllib.parse.quote(title)),
        })

        fields = pipeline_text.infobox_fields(wikitext) if wikitext else {}
        record['facts']['sire'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['sire'])
        record['facts']['dam'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['dam'])
        record['facts']['damsire'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['damsire'])
        record['facts']['sex'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['sex'])
        if not record.get('birthdate'):
            record['birthdate'] = pipeline_text.valid_date(pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['foaled']))
        record['death'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['death'])
        record['colour'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['colour'])
        record['facts']['owner'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['owner'])
        record['facts']['breeder'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['breeder'])
        record['facts']['farm'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['farm'])
        record['facts']['trainer'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['trainer'])
        record['facts']['stable'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['stable'])
        record['facts']['record'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['record'])
        record['facts']['earnings'] = pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['earnings'])
        record['origins'] = [pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['origin'])] if pipeline_text.field_match(fields, pipeline_common.FIELD_ALIASES['origin']) else []
        infobox = pipeline_text.extract_template(wikitext, 'Infobox racehorse') if wikitext else None
        if infobox:
            record['wins'] = pipeline_text.parse_medals(infobox)

        paragraphs = pipeline_text.collect_paragraphs(
            pipeline_text.split_extract_sections(info['extract']),
            pipeline_common.JA_PATTERNS if lang == 'ja' else pipeline_common.ZH_PATTERNS,
        )
        record['intro'] = pipeline_text.trim_paragraphs(paragraphs['intro'], 2, 320)
        record['career'] = pipeline_text.trim_paragraphs(paragraphs['career'], 14, 500)
        record['retirement'] = pipeline_text.trim_paragraphs(paragraphs['retirement'], 10, 420)
        record['breeding'] = pipeline_text.trim_paragraphs(paragraphs['breeding'], 8, 420)
        record['blood'] = pipeline_text.trim_paragraphs(paragraphs['blood'], 8, 420)

    # ---- JBIS ----
    if use_jbis and not (record['jbis'] and 'jbis.or.jp' in record['jbis']):
        jbis_url = (pipeline_races.search_jbis_url(record['ja'], record['born'])
                    or pipeline_races.search_jbis_url(record['en'], record['born']))
        if jbis_url:
            record['jbis'] = jbis_url
            print('  [jbis found] %s %s' % (horse['id'], jbis_url))
    if use_jbis and record['jbis'] and 'jbis.or.jp' in record['jbis']:
        jbis_identity_ok = True
        try:
            pipeline_common.time.sleep(pipeline_common.JBIS_SLEEP)
            page = pipeline_transport.http_get(record['jbis'])
            parsed = pipeline_races.parse_tables(page)
        except Exception as exc:  # noqa: BLE001
            print('  [jbis fail] %s %s' % (horse['id'], exc))
            parsed = {}
        if parsed:
            profile = parsed.get('profile') or {}
            expected = pipeline_common.re.sub(r'\D', '', str(record.get('born') or ''))[:4]
            actual = pipeline_common.re.sub(r'\D', '', str(profile.get('生年月日') or ''))[:4]
            if expected and actual and expected != actual:
                jbis_identity_ok = False
                print('  [jbis identity mismatch] %s -> discard all derived records' % horse['id'])
                parsed = {}
            if not parsed:
                profile = {}
        if parsed:
            if parsed.get('photo') and not record['photo']:
                record['photo'] = parsed['photo']
            facts = record['facts']
            facts['registration'] = profile.get('登録', '')
            if not facts.get('owner'):
                facts['owner'] = profile.get('馬主', '')
            if not facts.get('breeder'):
                facts['breeder'] = profile.get('生産牧場', '')
            if not facts.get('trainer'):
                facts['trainer'] = profile.get('調教師', '')
            if not facts.get('stable'):
                trainer_text = profile.get('調教師', '')
                stable_match = pipeline_common.re.search(r'\((.*)\)$', trainer_text)
                if stable_match:
                    facts['stable'] = stable_match.group(1).strip()
            if not facts.get('record'):
                facts['record'] = profile.get('戦績', '')
            if not facts.get('earnings'):
                facts['earnings'] = profile.get('総賞金', '')
            if not record.get('birthdate'):
                record['birthdate'] = pipeline_text.valid_date(profile.get('生年月日', ''))
            if not record.get('colour'):
                record['colour'] = profile.get('毛色', '')
            if not facts.get('country'):
                facts['country'] = profile.get('産地', '')
            record['yearly'] = parsed.get('yearly') or record['yearly']
            record['major'] = parsed.get('major') or record['major']
            record['awards'] = parsed.get('awards') or record['awards']
            record['jbis_pedigree'] = parsed.get('pedigree') or []
        if jbis_identity_ok:
            try:
                pipeline_common.time.sleep(pipeline_common.JBIS_SLEEP)
                record['races'] = pipeline_races.parse_races(pipeline_transport.http_get(record['jbis'].rstrip('/') + '/record/'))
            except Exception as exc:  # noqa: BLE001
                print('  [jbis record fail] %s %s' % (horse['id'], exc))
    if not record['photo']:
        record['photo'] = pipeline_photos.fill_missing_photo(record)
    if record['photo'] and not record['photo'].startswith('/uma_tools/'):
        record['photo'] = pipeline_photos.localize_photo(record) or record['photo']
    # 逐场战绩缺口：JBIS 缺/稀时用维基出赛表补全
    record['races'] = pipeline_races.fill_races(record, record.get('races') or [])
    # 生年终检：birthdate 年份与源数据 born 冲突时丢弃（防同名 JBIS 错配日期）
    born_year = pipeline_common.re.sub(r'\D', '', str(record.get('born') or ''))[:4]
    birth_year = pipeline_common.re.sub(r'\D', '', str(record.get('birthdate') or ''))[:4]
    if born_year and birth_year and born_year != birth_year:
        print('  [birth year mismatch] %s born=%s bd=%s -> drop bd' % (
            record['id'], record.get('born'), record.get('birthdate')))
        record['birthdate'] = ''
    return pipeline_registry.birth_precision(record)
